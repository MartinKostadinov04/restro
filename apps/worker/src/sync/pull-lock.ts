// One pull of an integration at a time: a Postgres advisory lock held for the whole pull (brief
// S2-08, Copilot finding on PR #2).
//
// pg-boss's `exclusive` policy keeps two jobs of one queue and singleton key apart, so a full pull
// and an incremental run of the same integration (two queues) could both be active. Both handlers
// therefore run inside `withPullLock`, which takes a session-level advisory lock named after the
// integration on a connection of its own and keeps that connection until the pull has ended
// (`finally`). If the process dies, its connection closes and Postgres drops the lock, so a
// crashed worker never leaves an integration locked, and a second worker process (a deploy that
// overlaps the old one) is kept out too.
//
// Session locks need the same connection for as long as they are held: this works through a direct
// connection or the Supabase SESSION pooler (port 5432), NOT the transaction pooler (port 6543).
// restro_app needs no extra privilege for advisory locks.
//
// The lock is per integration: another integration's pull is never blocked by it in Postgres. But
// the lock's connection comes out of the worker's small app pool (APP_POOL_MAX = 2, a hard budget
// of five connections with pg-boss's), and a pull needs another connection of that pool for its
// own queries. Were every connection held as a lock, two pulls would wait for each other for ever.
// So a process holds at most `PULL_LOCKS_MAX` (pool size minus one) pull locks at a time, and a
// pull that finds them all taken is treated like a pull that found its integration busy. With the
// queues as they are (one full pull and one incremental run at a time) this only matters when the
// two run for different integrations at once.

import { type DbPool, tryAdvisoryLock } from '@restro/db'

import { APP_POOL_MAX } from '../connection'
import type { Logger } from '../logger'
import { SyncError } from './errors'

/** How long a full pull waits for a pull that is already running. */
export const PULL_LOCK_WAIT_MS = 60_000
/** How often a waiting pull asks for the lock again. */
export const PULL_LOCK_POLL_MS = 2_000
/** Pull locks one process holds at once: one connection of the app pool stays free for queries. */
export const PULL_LOCKS_MAX = APP_POOL_MAX - 1

/** The lock's name in Postgres (hashed there with `hashtextextended`). */
export const pullLockName = (integrationId: string) => `restro:barsy-pull:${integrationId}`

export interface PullLockOptions {
  /** How long to wait for the lock: 0 asks once and gives up (the incremental run). */
  readonly waitMs: number
  /** Pause between two asks while waiting. Default {@link PULL_LOCK_POLL_MS}. */
  readonly pollMs?: number | undefined
  /** Pull locks this process may hold at once. Default {@link PULL_LOCKS_MAX}; tests with a bigger pool raise it. */
  readonly maxHeld?: number | undefined
}

/** `acquired: false`: another pull held the lock for the whole wait. */
export type PullLockResult<T> = { readonly acquired: true; readonly value: T } | { acquired: false }

/** Pull locks this process holds right now (including one being taken). */
let heldHere = 0

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs `fn` while holding the integration's pull lock. Waits up to `options.waitMs` (real time, not
 * the injected clock) for another pull to end. Whatever `fn` does, even throwing, the lock is
 * released afterwards.
 */
export async function withPullLock<T>(
  env: {
    readonly pool: DbPool
    readonly log: Logger
    readonly signal?: AbortSignal | undefined
  },
  integrationId: string,
  fn: () => Promise<T>,
  options: PullLockOptions,
): Promise<PullLockResult<T>> {
  const pollMs = options.pollMs ?? PULL_LOCK_POLL_MS
  const maxHeld = options.maxHeld ?? PULL_LOCKS_MAX
  const name = pullLockName(integrationId)
  const onError = (error: Error) =>
    env.log.error({ err: error, integrationId }, 'the pull lock’s connection failed')

  /** One ask: null when this process has no lock to spare or another pull holds this one. */
  const ask = async () => {
    if (heldHere >= maxHeld) return null
    heldHere += 1
    try {
      const lock = await tryAdvisoryLock(env.pool, name, onError)
      if (lock === null) heldHere -= 1
      return lock
    } catch (error) {
      heldHere -= 1
      throw error
    }
  }

  const deadline = performance.now() + options.waitMs
  let lock = await ask()
  while (lock === null) {
    const remaining = deadline - performance.now()
    if (remaining <= 0) return { acquired: false }
    if (env.signal?.aborted) throw new SyncError('aborted', 'The worker is shutting down.')
    await sleep(Math.min(pollMs, remaining))
    lock = await ask()
  }
  try {
    return { acquired: true, value: await fn() }
  } finally {
    await lock.release()
    heldHere -= 1
  }
}
