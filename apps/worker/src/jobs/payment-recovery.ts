// The payment recovery (#112; D127 §The route, 3.9, 3.15; design §5, §6).
//
//   payment-recovery-tick  every minute, and once when the worker starts: two passes a minute,
//                          30 s apart, over every organisation's open payments
//
// Each payment goes on from its last recorded step, so a worker that died at any step leaves
// nothing behind: the prepare step reads what was recorded and acts from there (a hold asked for
// once, a close never sent twice, an unknown write read back). A pass:
// - queues `payment-prepare` for a payment the worker has a step for and nobody touched for a
//   minute (a crashed run, a lost job), and tells Restro's team once when one stays in any state a
//   run can be left in for 10 minutes all the same (not one that waits for a table);
// - queues `payment-check` for a payment at the card form nobody looked at for a minute, and for a
//   hold past its capture deadline while it waits for a table or a manager's answer (it settles
//   `released`, reason `expired`, when the provider shows the hold gone);
// - reads the payment table of a final payment whose lines are still on it 5 minutes later, not at
//   once (#166), so a table that stays busy spends the POS's call budget only every 5 minutes;
// - reads a cancelled payment whose release the provider refused back every 10 minutes, never
//   releasing it again, and likewise one whose hold the last check could not read (RR-18);
// - names a payment table held by a payment that no longer owns it (it has no deadline): logged
//   for Restro's team, never freed by guess;
// - probes a paused payment provider when its breaker says one is due (./payment-breaker.ts).
// The queues are stately per payment, so a payment already queued is not queued twice. One worker
// runs for the pilot: "a close is sent once" holds within one process (the close's `attempting`
// row is checked inside the instance's turn), so a second worker is not started beside it.

import { JOB_NAMES, prepareJob, providerRef } from '@restro/core'
import {
  applyService,
  HOLD_UNREAD_REASON,
  isFinalPaymentState,
  PAYMENT_UNCONFIRMED_REASONS,
  RECEIPT_EMAIL_KEPT_MS,
} from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  locks,
  paymentAccounts,
  payments,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, isNotNull, isNull, like, or, sql } from 'drizzle-orm'

import { describeError, type SafeError } from '../errors'
import type { Logger } from '../logger'
import { SHARED_PAYMENT_BREAKERS } from './payment-breaker'
import { hasNextStep, type PaymentJobDeps } from './payments'
import { defineJob, type JobDefinition, type JobQueue } from './types'

/** A payment nobody touched for this long is taken on again. */
export const PAYMENT_STALE_MS = 60_000
/** A payment a run can be left in, this long after its last change all the same, is stuck. */
export const PAYMENT_STUCK_MS = 10 * 60_000
/** How often a hold whose release the provider refused is read back. */
export const RELEASE_READ_BACK_SECONDS = 10 * 60
/**
 * How long a final payment's table is left before its payment table is read again (#166): each
 * read spends the POS's call budget, and nothing about the lines is urgent.
 */
export const FINAL_TABLE_READ_SECONDS = 5 * 60
/** The gap between the two passes of one tick. */
export const RECOVERY_EVERY_MS = 30_000

/** What one pass reads of a payment. */
export interface RecoveryRow {
  /** `on_bill` or `pay_first` (#113): a queued pay-first payment is entered, not moved. */
  readonly kind: string
  readonly state: string
  readonly reason: string | null
  readonly paymentTableId: string | null
  /** Since its last change or its last recorded step. */
  readonly idleMs: number
  /** Since its last change. */
  readonly changedMs: number
  /** Its hold's capture deadline has passed. */
  readonly captureDue: boolean
  /** Its latest release was refused (not `not_found`): it is read back, never released again. */
  readonly releaseRefused: boolean
  /** The last check could not read its hold: released only once a read shows it (`cancel`). */
  readonly holdUnread: boolean
}

/** What a pass does about a payment. */
export type RecoveryAction = 'prepare' | 'read_back_later' | 'free_later' | 'check' | 'stuck'

/** What a pass does about one payment (pure: the clock tests drive it). */
export function recoveryActions(row: RecoveryRow): readonly RecoveryAction[] {
  if (row.state === 'awaiting_guest') return row.idleMs >= PAYMENT_STALE_MS ? ['check'] : []
  if (row.state === 'cancelling' && row.releaseRefused) return ['read_back_later']
  if (row.state === 'cancelling' && row.holdUnread) {
    return row.changedMs >= PAYMENT_STUCK_MS ? ['read_back_later', 'stuck'] : ['read_back_later']
  }
  const waiting = (row.state === 'held' || row.state === 'queued') && row.paymentTableId === null
  const asking =
    row.state === 'unconfirmed' &&
    (PAYMENT_UNCONFIRMED_REASONS as readonly (string | null)[]).includes(row.reason)
  if (asking) return row.captureDue ? ['check'] : []
  if (waiting && row.captureDue) return ['check']
  if (!hasNextStep(row) || row.idleMs < PAYMENT_STALE_MS) return []
  // A final payment whose lines are still on its payment table: that table is read again
  // minutes later, not on every pass (#166).
  if (
    row.state !== 'unconfirmed' &&
    isFinalPaymentState(row.state) &&
    row.paymentTableId !== null
  ) {
    return ['free_later']
  }
  // Every state a run can be left in; a payment waiting for a table has nothing wrong with it.
  return !waiting && !isFinalPaymentState(row.state) && row.changedMs >= PAYMENT_STUCK_MS
    ? ['prepare', 'stuck']
    : ['prepare']
}

/** What a pass needs. */
export interface RecoveryEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
  readonly queue: JobQueue
}

/** What a pass did. */
export interface RecoverySummary {
  readonly prepared: number
  readonly checked: number
  readonly stuck: number
  readonly orphanTables: number
  readonly probed: number
}

/**
 * What a failure says about itself without its message, which Postgres can fill with a value: the
 * types and SQLSTATE codes down its cause chain (Drizzle wraps the Postgres error).
 */
function failureKind(error: unknown): { types: string[]; codes: string[] } {
  const types: string[] = []
  const codes: string[] = []
  for (let link: SafeError | undefined = describeError(error); link; link = link.cause) {
    types.push(link.type)
    if (link.code !== undefined) codes.push(link.code)
  }
  return { types, codes }
}

const ms = (value: string | null) => Number(value ?? 0)

/** One pass over every organisation's open payments. A payment that fails is logged and skipped. */
export async function recoverPayments(
  env: RecoveryEnvironment,
  deps: PaymentJobDeps,
): Promise<RecoverySummary> {
  const organisations = await withSystem(env.pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  let prepared = 0
  let checked = 0
  let stuck = 0
  let orphanTables = 0
  let probed = 0
  for (const { id: tenantId } of organisations) {
    try {
      const rows = await withTenant(env.pool, tenantId, (tx) =>
        tx
          .select({
            id: payments.id,
            venueId: payments.venueId,
            kind: payments.kind,
            state: payments.state,
            reason: payments.reason,
            paymentTableId: payments.paymentTableId,
            idleMs: sql<string>`(extract(epoch from now() - greatest(${payments.updatedAt},
            (select max(s.at) from restro.payment_steps s where s.payment_id = ${payments.id})))
            * 1000)::text`,
            changedMs: sql<string>`(extract(epoch from now() - ${payments.updatedAt}) * 1000)::text`,
            captureDue: sql<boolean>`coalesce(${payments.captureBefore} <= now(), false)`,
            // The guest's email, kept past any payment's time (#186): erased below.
            emailKept: sql<boolean>`(${payments.receiptEmail} is not null
              and ${payments.createdAt} < now() - make_interval(secs => ${RECEIPT_EMAIL_KEPT_MS / 1000}))`,
            releaseRefused: sql<boolean>`coalesce((select s.outcome = 'refused'
              and s.answer is distinct from 'not_found'
            from restro.payment_steps s
            where s.payment_id = ${payments.id} and s.step = 'release'
            order by s.seq desc limit 1), false)`,
            holdUnread: sql<boolean>`${payments.state} = 'cancelling' and exists (select 1
            from restro.log_entries l
            where l.venue_id = ${payments.venueId} and l.payment_id = ${payments.id}
              and l.kind = 'payment.state' and l.reason = ${HOLD_UNREAD_REASON})`,
          })
          .from(payments)
          .where(
            or(
              isNull(payments.settledAt),
              eq(payments.state, 'unconfirmed'),
              isNotNull(payments.paymentTableId),
            ),
          )
          .orderBy(payments.id),
      )
      for (const row of rows) {
        const target = { tenantId, venueId: row.venueId, paymentId: row.id } as const
        try {
          if (row.emailKept === true) {
            // Its own try: an erase that fails must never block this payment's recovery.
            try {
              await applyService(
                env.pool,
                { type: 'payment.erase_receipt_email', paymentId: row.id },
                {
                  tenantId,
                  venueId: row.venueId,
                  origin: 'worker',
                  actor: { kind: 'system' },
                  jobId: `payment-recovery-${row.id}`,
                },
              )
            } catch (error) {
              env.log.warn(
                { paymentId: row.id, error: error instanceof Error ? error.name : 'error' },
                'the guest’s receipt email could not be erased',
              )
            }
          }
          const actions = recoveryActions({
            kind: row.kind,
            state: row.state,
            reason: row.reason,
            paymentTableId: row.paymentTableId,
            idleMs: ms(row.idleMs),
            changedMs: ms(row.changedMs),
            captureDue: row.captureDue === true,
            releaseRefused: row.releaseRefused === true,
            holdUnread: row.holdUnread === true,
          })
          for (const action of actions) {
            if (action === 'check') {
              await send(env, JOB_NAMES.paymentCheck, target, 0)
              checked += 1
            } else if (action === 'stuck') {
              const { result } = await applyService(
                env.pool,
                { type: 'payment.stuck', paymentId: row.id },
                {
                  tenantId,
                  venueId: row.venueId,
                  origin: 'worker',
                  actor: { kind: 'system' },
                  jobId: `payment-recovery-${row.id}`,
                },
              )
              if (result.status === 'accepted' && result.details.changed === true) stuck += 1
            } else {
              const queued = await send(
                env,
                JOB_NAMES.paymentPrepare,
                target,
                action === 'read_back_later'
                  ? RELEASE_READ_BACK_SECONDS
                  : action === 'free_later'
                    ? FINAL_TABLE_READ_SECONDS
                    : 0,
              )
              // A payment already queued (stately) answers no job id: nothing new was queued.
              if (queued) prepared += 1
            }
          }
        } catch (error) {
          env.log.warn({ paymentId: row.id, err: error }, 'a payment could not be recovered')
        }
      }

      // A payment table's lease has no deadline: one held by a payment that no longer owns it is
      // found through its holder and that payment's state, and reported.
      const orphans = await withTenant(env.pool, tenantId, (tx) =>
        tx
          .select({ key: locks.key, holder: locks.holder, owns: payments.paymentTableId })
          .from(locks)
          .leftJoin(payments, eq(payments.id, locks.holder))
          .where(and(eq(locks.scope, 'payment_table'), like(locks.holder, 'py\\_%'))),
      )
      for (const lease of orphans) {
        if (lease.owns === lease.key) continue
        orphanTables += 1
        env.log.error(
          { paymentTableId: lease.key, paymentId: lease.holder },
          'a payment table is held by a payment that does not own it',
        )
      }

      // The paused providers' probes.
      const accounts = await withTenant(env.pool, tenantId, (tx) =>
        tx
          .select({
            venueId: paymentAccounts.venueId,
            providerKind: paymentAccounts.providerKind,
            accountRef: paymentAccounts.accountRef,
          })
          .from(paymentAccounts)
          .where(
            and(
              isNotNull(paymentAccounts.accountRef),
              or(isNotNull(paymentAccounts.payingPausedAt), isNotNull(paymentAccounts.breaker)),
            ),
          ),
      )
      for (const account of accounts) {
        const provider = deps.providers.get(account.providerKind)
        if (provider === undefined || account.accountRef === null) continue
        try {
          const breakers = deps.breakers ?? SHARED_PAYMENT_BREAKERS
          const ref = { tenantId, venueId: account.venueId }
          if (await breakers.probeIfDue(env, ref, provider, providerRef(account.accountRef))) {
            probed += 1
          }
        } catch (error) {
          env.log.warn({ venueId: account.venueId, err: error }, 'the paying probe failed')
        }
      }
    } catch (error) {
      // One organisation's failed query never stops the run for the ones after it (#166). Only the
      // organisation's id and the failure's types and SQLSTATE codes are logged: no message, no row.
      env.log.warn(
        { tenantId, failure: failureKind(error) },
        'the payment recovery of an organisation failed',
      )
    }
  }
  return { prepared, checked, stuck, orphanTables, probed }
}

async function send(
  env: RecoveryEnvironment,
  name: typeof JOB_NAMES.paymentPrepare | typeof JOB_NAMES.paymentCheck,
  target: { readonly tenantId: string; readonly venueId: string; readonly paymentId: string },
  afterSeconds: number,
): Promise<boolean> {
  const job = prepareJob(name, target)
  const id = await env.queue.send(name, job.data, {
    singletonKey: job.singletonKey,
    ...(job.group === undefined ? {} : { group: job.group }),
    ...(afterSeconds > 0 ? { startAfter: afterSeconds } : {}),
  })
  return id !== null
}

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

/** `payment-recovery-tick`: two passes a minute. */
export function createPaymentRecoveryJob(deps: PaymentJobDeps): JobDefinition {
  return defineJob({
    name: JOB_NAMES.paymentRecoveryTick,
    schedule: { cron: '* * * * *', tz: 'Europe/Sofia' },
    options: {
      queue: {
        retryLimit: 0,
        expireInSeconds: 120,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
    },
    async handler(jobs, context) {
      const signal = jobs[0]?.signal
      const env = { pool: context.pool, log: context.log, now: context.now, queue: context.queue }
      const first = await recoverPayments(env, deps)
      context.log.debug({ ...first }, JOB_NAMES.paymentRecoveryTick)
      await sleepFor(RECOVERY_EVERY_MS, signal)
      if (signal?.aborted === true) return
      const second = await recoverPayments(env, deps)
      context.log.debug({ ...second }, JOB_NAMES.paymentRecoveryTick)
    },
  })
}
