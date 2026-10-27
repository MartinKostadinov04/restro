// The payment provider's breakers of this process (#112; D127 3.8, D120's rule): one per venue
// account (a venue's account at its provider, `payment_accounts`). The pure breaker (`stepBreaker`
// in core) decides; this registry feeds it every provider call of the payment jobs and writes what
// it answers through `applyService` (`paying.breaker`):
// - a pause: paying in the app pauses at the venue (`payment_accounts.paying_paused_at`), and the
//   owners, managers and Restro's team are told; ordering goes on;
// - a probe's progress: the breaker's state, so a restarted worker restores it;
// - a lift: paying is back.
// A call that answered counts as good, a refusal too (the provider answered); one that threw,
// answered `unknown`, or read incomplete counts as failed. The database stays the gate: the hold
// step, `pay.start` and the queue read `paying_paused_at`.
// Probes (`readConnection`, read-only) run from the payment recovery tick when one is due, so they
// come at most every 30 s (the breaker asks for 15 s gaps; lifting takes a little longer).
// Steps of one account run one at a time; a process runs one registry (`SHARED_PAYMENT_BREAKERS`).

import { randomUUID } from 'node:crypto'

import type { PaymentProvider, ProviderRef } from '@restro/core'
import {
  applyService,
  BREAKER,
  BREAKER_CAUSES,
  type BreakerAction,
  type BreakerEvent,
  type BreakerState,
  BreakerStateSchema,
  closedBreaker,
  probeDue,
  stepBreaker,
} from '@restro/core/service'
import { type DbPool, paymentAccounts, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import type { Logger } from '../logger'

/** What a breaker step needs: the database, a log and the clock. */
export interface PayingBreakerEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
}

/** One venue account: the venue's account at its payment provider. */
export interface PayingRef {
  readonly tenantId: string
  readonly venueId: string
}

/** The cause a paying pause records when no call to the provider succeeded. */
export const PROVIDER_UNREACHABLE_CAUSE = 'provider_unreachable'

const keyOf = (ref: PayingRef) => `${ref.tenantId}:${ref.venueId}`

/**
 * The breaker as the database left it: its saved state; a pause with no saved state is rebuilt
 * from when it started, and probes at once.
 */
export async function restorePayingBreaker(
  pool: DbPool,
  ref: PayingRef,
  now: number,
): Promise<BreakerState> {
  const [row] = await withTenant(pool, ref.tenantId, (tx) =>
    tx
      .select({ pausedAt: paymentAccounts.payingPausedAt, breaker: paymentAccounts.breaker })
      .from(paymentAccounts)
      .where(eq(paymentAccounts.venueId, ref.venueId)),
  )
  if (row === undefined) return closedBreaker()
  const saved = BreakerStateSchema.safeParse(row.breaker)
  if (row.pausedAt !== null) {
    if (saved.success && saved.data.open !== null) return saved.data
    const since = row.pausedAt.getTime()
    return {
      ...closedBreaker(),
      autoPauses: [since],
      open: {
        since,
        cause: PROVIDER_UNREACHABLE_CAUSE,
        refused: false,
        holdUntil: since + BREAKER.minPauseMs,
        goodInRow: 0,
        attempt: 0,
        nextProbeAt: now,
      },
    }
  }
  if (!saved.success) return closedBreaker()
  // Saved open but not paused in the database: the pause was never written; start closed.
  return saved.data.open === null
    ? saved.data
    : { ...closedBreaker(), autoPauses: saved.data.autoPauses }
}

/** The breakers of this process, one per venue account. */
export class PaymentBreakers {
  readonly #states = new Map<string, BreakerState>()
  readonly #chains = new Map<string, Promise<unknown>>()
  readonly #random: () => number

  constructor(random: () => number = Math.random) {
    this.#random = random
  }

  /** Runs `work` after the account's earlier steps. */
  #serial<T>(ref: PayingRef, work: () => Promise<T>): Promise<T> {
    const key = keyOf(ref)
    const run = (this.#chains.get(key) ?? Promise.resolve()).then(work, work)
    this.#chains.set(
      key,
      run.catch(() => undefined),
    )
    return run
  }

  async #load(env: PayingBreakerEnvironment, ref: PayingRef): Promise<BreakerState> {
    const known = this.#states.get(keyOf(ref))
    if (known !== undefined) return known
    const restored = await restorePayingBreaker(env.pool, ref, env.now().getTime())
    this.#states.set(keyOf(ref), restored)
    return restored
  }

  /** The account's breaker (restored from the database on first use). */
  state(env: PayingBreakerEnvironment, ref: PayingRef): Promise<BreakerState> {
    return this.#serial(ref, () => this.#load(env, ref))
  }

  /** Feeds the breaker what happened and writes what it answers. Never throws. */
  record(
    env: PayingBreakerEnvironment,
    ref: PayingRef,
    event: BreakerEvent,
  ): Promise<BreakerState | null> {
    return this.#serial(ref, async () => {
      let before: BreakerState
      try {
        before = await this.#load(env, ref)
      } catch (error) {
        env.log.warn({ venueId: ref.venueId, err: error }, 'the paying breaker could not be read')
        return null
      }
      const now = env.now().getTime()
      const stepped = stepBreaker(before, event, now, this.#random)
      const after = stepped.state
      try {
        for (const action of stepped.actions) await act(env, ref, after, action)
        if (
          stepped.actions.length === 0 &&
          after.open !== null &&
          JSON.stringify(after.open) !== JSON.stringify(before.open)
        ) {
          await write(env, ref, { action: 'progress', cause: null, breaker: after })
        }
      } catch (error) {
        // The step is kept in memory; the next one writes again.
        env.log.error({ venueId: ref.venueId, err: error }, 'a paying breaker step failed')
      }
      this.#states.set(keyOf(ref), after)
      return after
    })
  }

  /** Probes the account when a probe is due: a read of the account, good when quick and whole. */
  async probeIfDue(
    env: PayingBreakerEnvironment,
    ref: PayingRef,
    provider: PaymentProvider,
    accountRef: ProviderRef,
  ): Promise<boolean> {
    const state = await this.state(env, ref)
    if (!probeDue(state, env.now().getTime())) return false
    const started = Date.now()
    let good = false
    try {
      const reading = await provider.readConnection(accountRef)
      good = reading.complete && Date.now() - started <= BREAKER.probeBudgetMs
    } catch (error) {
      env.log.warn({ venueId: ref.venueId, err: error }, 'the paying probe threw')
    }
    await this.record(env, ref, { kind: 'probe', outcome: good ? 'good' : 'bad', cause: null })
    return true
  }
}

/** The registry every payment job of this process shares. */
export const SHARED_PAYMENT_BREAKERS = new PaymentBreakers()

async function write(
  env: PayingBreakerEnvironment,
  ref: PayingRef,
  command: {
    readonly action: 'pause' | 'progress' | 'lift'
    readonly cause: string | null
    readonly breaker: BreakerState
  },
): Promise<void> {
  const { result } = await applyService(
    env.pool,
    { type: 'paying.breaker', ...command },
    {
      tenantId: ref.tenantId,
      venueId: ref.venueId,
      origin: 'worker',
      actor: { kind: 'system' },
      jobId: `paying-breaker-${randomUUID()}`,
    },
  )
  if (result.status === 'refused') {
    env.log.warn({ venueId: ref.venueId, code: result.code }, 'a paying breaker step was refused')
  }
}

/** Writes a pause or a lift. */
async function act(
  env: PayingBreakerEnvironment,
  ref: PayingRef,
  state: BreakerState,
  action: BreakerAction,
): Promise<void> {
  if (action.kind === 'pause') {
    const cause =
      action.cause === BREAKER_CAUSES.unreachable ? PROVIDER_UNREACHABLE_CAUSE : action.cause
    await write(env, ref, { action: 'pause', cause, breaker: state })
    env.log.warn({ venueId: ref.venueId, cause }, 'paying in the app is paused')
    return
  }
  await write(env, ref, { action: 'lift', cause: null, breaker: state })
  env.log.info({ venueId: ref.venueId }, 'paying in the app is back')
}

/**
 * The provider with every call fed to the account's breaker: answered (a refusal too) is good;
 * thrown, `unknown` or an incomplete reading is a failed call.
 */
export function watchedProvider(
  provider: PaymentProvider,
  feed: (ok: boolean) => Promise<unknown>,
): PaymentProvider {
  const watch =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>, ok: (answer: R) => boolean) =>
    async (...args: A): Promise<R> => {
      let answer: R
      try {
        answer = await call(...args)
      } catch (error) {
        await feed(false)
        throw error
      }
      await feed(ok(answer))
      return answer
    }
  const wrote = (answer: { readonly kind: string }) => answer.kind !== 'unknown'
  const read = (answer: { readonly complete: boolean }) => answer.complete
  return {
    kind: provider.kind,
    capabilities: provider.capabilities,
    startConnection: watch(provider.startConnection.bind(provider), wrote),
    readConnection: watch(provider.readConnection.bind(provider), read),
    prepareDomain: watch(provider.prepareDomain.bind(provider), wrote),
    createHold: watch(provider.createHold.bind(provider), wrote),
    findByPaymentId: watch(provider.findByPaymentId.bind(provider), read),
    readPayment: watch(provider.readPayment.bind(provider), read),
    readNoticeSubject: watch(provider.readNoticeSubject.bind(provider), read),
    capture: watch(provider.capture.bind(provider), wrote),
    release: watch(provider.release.bind(provider), wrote),
  }
}
