// The connection breakers of this process (#79; D120, D122 §6): one per POS instance (the
// instance's login owns the connection, not a venue). The pure breaker (`stepBreaker` in core)
// decides; this registry feeds it what happens on the connection and writes what it answers
// through `applyService`:
// - a pause: `connection.pause` for each venue the instance serves (one row, the venues joining
//   it), which settles their waiting sent orders as Not sent and pauses Send;
// - a probe's progress: `pause.transition` (the state, the probe count, the next probe time);
// - a lift: `pause.transition` with `lift`, for each venue the row covers.
// The breaker's state is kept on the active pause row, so a restarted worker restores it from
// there: it neither lifts nor doubles a pause, and probes at the time the row says. Without a row
// it restores what pauses the next one faster: the automatic pauses of the last 30 minutes and the
// watch after the last lift.
// A pause Restro's team lifted by hand answers `already`: the breaker closes and watches.
// The database stays the gate for orders (`connectionPaused`); the registry only adds the hold
// after a write timed out (the next order waits for a good probe).
// Steps of one instance run one at a time; a process runs one registry (`SHARED_BREAKERS`).

import { randomUUID } from 'node:crypto'

import { ConnectionProbeJobSchema, JOB_NAMES, prepareJob } from '@restro/core'
import {
  applyService,
  BREAKER,
  type BreakerAction,
  type BreakerEvent,
  type BreakerGate,
  type BreakerState,
  BreakerStateSchema,
  breakerGate,
  closedBreaker,
  nextProbeAt,
  stepBreaker,
} from '@restro/core/service'
import { type DbPool, pauses, venues, withTenant } from '@restro/db'
import { and, eq, gte, isNull } from 'drizzle-orm'

import { tillVenueLinks } from '../connectors'
import type { Logger } from '../logger'
import type { JobQueue } from './types'

/** What a breaker step needs: the database, a log, the clock, and the queue for the next probe. */
export interface BreakerEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
  /** Queues the next probe; without it the minute tick does (`connection-tick`). */
  readonly queue?: JobQueue | undefined
}

/** One connection: a POS instance of an organisation. */
export interface ConnectionRef {
  readonly tenantId: string
  readonly integrationId: string
}

/** The instance's active connection pause, as the breaker needs it. */
interface ActivePause {
  readonly id: string
  readonly venueId: string
  readonly venueIds: readonly string[]
  readonly cause: string
  readonly startedAt: Date
  readonly nextProbeAt: Date | null
  readonly probeCount: number
  readonly details: Readonly<Record<string, unknown>>
}

async function activePause(pool: DbPool, ref: ConnectionRef): Promise<ActivePause | null> {
  const [row] = await withTenant(pool, ref.tenantId, (tx) =>
    tx
      .select()
      .from(pauses)
      .where(
        and(
          eq(pauses.scope, 'connection'),
          eq(pauses.targetId, ref.integrationId),
          isNull(pauses.liftedAt),
        ),
      )
      .limit(1),
  )
  if (row === undefined) return null
  const listed = row.details.venueIds
  const covered = Array.isArray(listed)
    ? listed.filter((id): id is string => typeof id === 'string')
    : []
  return {
    id: row.id,
    venueId: row.venueId,
    venueIds: [...new Set([row.venueId, ...covered])],
    cause: row.cause,
    startedAt: row.startedAt,
    nextProbeAt: row.nextProbeAt,
    probeCount: row.probeCount,
    details: row.details,
  }
}

/** The live venues the instance serves: each gets the pause. */
async function linkedVenues(pool: DbPool, ref: ConnectionRef): Promise<string[]> {
  const rows = await withTenant(pool, ref.tenantId, (tx) =>
    tx
      .selectDistinct({ venueId: venues.id })
      .from(tillVenueLinks)
      .innerJoin(venues, eq(venues.id, tillVenueLinks.venueId))
      .where(and(eq(tillVenueLinks.integrationId, ref.integrationId), isNull(venues.archivedAt))),
  )
  return rows.map((row) => row.venueId).sort()
}

/**
 * The breaker as the database left it. An active pause: its saved state, or one rebuilt from the
 * row. None: closed, with the automatic pauses of the last 30 minutes and the watch after the last
 * lift, if it still runs.
 */
export async function restoreBreaker(
  pool: DbPool,
  ref: ConnectionRef,
  now: number,
): Promise<BreakerState> {
  const pause = await activePause(pool, ref)
  if (pause !== null) {
    const saved = BreakerStateSchema.safeParse(pause.details.breaker)
    if (saved.success && saved.data.open !== null) return saved.data
    const since = pause.startedAt.getTime()
    return {
      ...closedBreaker(),
      autoPauses: [since],
      open: {
        since,
        cause: pause.cause,
        refused: false,
        holdUntil: since + BREAKER.minPauseMs,
        goodInRow: 0,
        attempt: 0,
        nextProbeAt: pause.nextProbeAt?.getTime() ?? now,
      },
    }
  }
  const recent = await withTenant(pool, ref.tenantId, (tx) =>
    tx
      .select({ startedAt: pauses.startedAt, liftedAt: pauses.liftedAt })
      .from(pauses)
      .where(
        and(
          eq(pauses.scope, 'connection'),
          eq(pauses.targetId, ref.integrationId),
          eq(pauses.restroStarted, true),
          gte(pauses.startedAt, new Date(now - BREAKER.unstableWindowMs)),
        ),
      ),
  )
  const lifts = recent.flatMap((row) => (row.liftedAt === null ? [] : [row.liftedAt.getTime()]))
  const lastLift = lifts.length === 0 ? null : Math.max(...lifts)
  const watchUntil =
    lastLift !== null && lastLift + BREAKER.watchMs > now ? lastLift + BREAKER.watchMs : null
  return {
    ...closedBreaker(),
    autoPauses: recent.map((row) => row.startedAt.getTime()).sort((a, b) => a - b),
    watchUntil,
    nextProbeAt: watchUntil === null ? null : now,
  }
}

/** Closed after a lift: probes go on through the watch. */
function closedAfterLift(state: BreakerState, now: number): BreakerState {
  return {
    ...closedBreaker(),
    autoPauses: state.autoPauses,
    watchUntil: now + BREAKER.watchMs,
    nextProbeAt: now + BREAKER.goodGapMs,
  }
}

/** The breakers of this process, one per instance. */
export class ConnectionBreakers {
  readonly #states = new Map<string, BreakerState>()
  readonly #chains = new Map<string, Promise<unknown>>()
  readonly #random: () => number

  constructor(random: () => number = Math.random) {
    this.#random = random
  }

  /** Runs `work` after the instance's earlier steps. */
  #serial<T>(ref: ConnectionRef, work: () => Promise<T>): Promise<T> {
    const key = `${ref.tenantId}:${ref.integrationId}`
    const run = (this.#chains.get(key) ?? Promise.resolve()).then(work, work)
    this.#chains.set(
      key,
      run.catch(() => undefined),
    )
    return run
  }

  async #load(env: BreakerEnvironment, ref: ConnectionRef): Promise<BreakerState> {
    const key = `${ref.tenantId}:${ref.integrationId}`
    const known = this.#states.get(key)
    if (known !== undefined) return known
    const restored = await restoreBreaker(env.pool, ref, env.now().getTime())
    this.#states.set(key, restored)
    return restored
  }

  /** The instance's breaker (restored from the database on first use). */
  state(env: BreakerEnvironment, ref: ConnectionRef): Promise<BreakerState> {
    return this.#serial(ref, () => this.#load(env, ref))
  }

  /** Whether an order may go: `hold` means a probe must be good first. */
  async gate(env: BreakerEnvironment, ref: ConnectionRef): Promise<BreakerGate> {
    return breakerGate(await this.state(env, ref), env.now().getTime())
  }

  /** Feeds the breaker what happened, writes what it answers, and queues the next probe. */
  record(env: BreakerEnvironment, ref: ConnectionRef, event: BreakerEvent): Promise<BreakerState> {
    return this.#serial(ref, async () => {
      const before = await this.#load(env, ref)
      const now = env.now().getTime()
      const stepped = stepBreaker(before, event, now, this.#random)
      let after = stepped.state
      try {
        for (const action of stepped.actions) {
          after = await act(env, ref, after, action, event, now)
        }
        if (
          stepped.actions.length === 0 &&
          after.open !== null &&
          JSON.stringify(after.open) !== JSON.stringify(before.open)
        ) {
          after = await progress(env, ref, after, event, now)
        }
      } catch (error) {
        // The step is kept in memory; the next one writes again.
        env.log.error({ integrationId: ref.integrationId, err: error }, 'a breaker step failed')
      }
      this.#states.set(`${ref.tenantId}:${ref.integrationId}`, after)
      const at = nextProbeAt(after)
      if (at !== null && at !== nextProbeAt(before)) await queueProbe(env, ref, at)
      return after
    })
  }
}

/** The registry every job of this process shares. */
export const SHARED_BREAKERS = new ConnectionBreakers()

/** Runs one breaker command for a venue; the details, or null when refused (logged). */
async function breakerStep(
  env: BreakerEnvironment,
  ref: ConnectionRef,
  venueId: string,
  command: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>> | null> {
  const { result } = await applyService(env.pool, command, {
    tenantId: ref.tenantId,
    venueId,
    origin: 'worker',
    actor: { kind: 'integration', integrationId: ref.integrationId },
    jobId: `breaker-${randomUUID()}`,
  })
  if (result.status === 'refused') {
    env.log.warn({ code: result.code, type: command.type }, 'a breaker step was refused')
    return null
  }
  return result.details
}

const isoOrNull = (at: number | null) => (at === null ? null : new Date(at).toISOString())

/** Writes a pause or a lift. */
async function act(
  env: BreakerEnvironment,
  ref: ConnectionRef,
  state: BreakerState,
  action: BreakerAction,
  event: BreakerEvent,
  now: number,
): Promise<BreakerState> {
  if (action.kind === 'pause') {
    const served = await linkedVenues(env.pool, ref)
    if (served.length === 0) env.log.warn({ integrationId: ref.integrationId }, 'no venue to pause')
    for (const venueId of served) {
      await breakerStep(env, ref, venueId, {
        type: 'connection.pause',
        integrationId: ref.integrationId,
        cause: action.cause,
        unstable: action.unstable,
        nextProbeAt: isoOrNull(nextProbeAt(state)),
        breaker: state,
      })
    }
    env.log.warn(
      { integrationId: ref.integrationId, cause: action.cause, unstable: action.unstable },
      'the connection is paused',
    )
    return state
  }
  const pause = await activePause(env.pool, ref)
  if (pause === null) return state
  for (const venueId of pause.venueIds) {
    await breakerStep(env, ref, venueId, {
      type: 'pause.transition',
      pauseId: pause.id,
      probeCount: pause.probeCount + (event.kind === 'probe' ? 1 : 0),
      nextProbeAt: null,
      breaker: state,
      lift: true,
    })
  }
  env.log.info({ integrationId: ref.integrationId, now }, 'the connection pause is lifted')
  return state
}

/** Writes a paused breaker's progress; a pause already lifted by hand closes it. */
async function progress(
  env: BreakerEnvironment,
  ref: ConnectionRef,
  state: BreakerState,
  event: BreakerEvent,
  now: number,
): Promise<BreakerState> {
  const pause = await activePause(env.pool, ref)
  if (pause === null) return closedAfterLift(state, now)
  const details = await breakerStep(env, ref, pause.venueId, {
    type: 'pause.transition',
    pauseId: pause.id,
    probeCount: pause.probeCount + (event.kind === 'probe' ? 1 : 0),
    nextProbeAt: isoOrNull(nextProbeAt(state)),
    breaker: state,
    lift: false,
  })
  return details?.already === true ? closedAfterLift(state, now) : state
}

/** Queues the instance's next probe to start at `at`. */
async function queueProbe(env: BreakerEnvironment, ref: ConnectionRef, at: number): Promise<void> {
  if (env.queue === undefined) return
  try {
    const job = prepareJob(
      JOB_NAMES.connectionProbe,
      ConnectionProbeJobSchema.parse({ tenantId: ref.tenantId, integrationId: ref.integrationId }),
    )
    await env.queue.send(JOB_NAMES.connectionProbe, job.data, {
      singletonKey: job.singletonKey,
      startAfter: Math.max(0, Math.ceil((at - env.now().getTime()) / 1000)),
    })
  } catch (error) {
    env.log.warn({ integrationId: ref.integrationId, err: error }, 'a probe could not be queued')
  }
}
