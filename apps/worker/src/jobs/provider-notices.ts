// The provider notices job (#108; D127 1.4, D125 3.5 and 3.8, design §8).
//
//   provider-notices  every minute: handle the stored notices not handled yet, in the order stored
//
// The notice route only stores a verified notice (the row is the job: a transactional outbox).
// This job acts on it, and never on the notice's own content:
// - its handler is picked by the platform's kind (`refund`, `dispute`, `payment`); a kind with no
//   handler (`other`) is marked handled with no action;
// - the account it names is mapped to its venue through `payment_accounts`; a notice for no
//   account of ours is marked handled, and logged. An `account` or `access_lost` notice may come
//   before its account is recorded as the venue's, so one about an unknown account waits
//   `ACCOUNT_NOTICE_GRACE_MS` first;
// - the payment is read back from the provider (`readNoticeSubject`), which gives the refund
//   total and the dispute as they stand now, so a notice that comes twice, late or out of order
//   records the same values; an incomplete reading concludes nothing and the notice waits;
// - what the reading says is recorded through core/service (`payment.observe`), as the worker;
//   a `payment` notice (the guest at the card form, #110) queues the payment's check instead,
//   which reads the provider again and moves the payment on;
// - an `account` notice (the venue's account changed) reads the connection back and records it; an
//   `access_lost` notice (the venue took Restro's access away) pauses paying at once and alerts the
//   venue's owners and managers, with no reading in the way (#109);
// - Restro never refunds: no provider call here moves money.
// A notice whose reading failed or found our side not ready stays for the next run; one still
// waiting after a day is logged as an error, once a day. A notice of a provider this worker does
// not have is not read at all: it waits, unlooked at, until that provider is wired.
//
// A run pages through the waiting notices by `seq`, so notices that keep waiting never hide the
// ones stored after them. It looks at most `NOTICE_RUN_CAP` notices, or as many as it gets
// through in `NOTICE_RUN_BUDGET_MS`; the next run goes on from where it stopped.
//
// One run at a time (`exclusive`): two runs reading the same payment could otherwise record an
// older reading after a newer one.

import {
  JOB_NAMES,
  type PaymentProvider,
  type ProviderNotice,
  prepareJob,
  providerRef,
} from '@restro/core'
import {
  type AccountVenue,
  applyService,
  markProviderNoticeHandled,
  paymentAccountVenues,
  type StoredProviderNotice,
  unhandledProviderNotices,
} from '@restro/core/service'
import type { DbPool } from '@restro/db'

import type { Logger } from '../logger'
import { type ConnectionProvider, readAccount, recordLostAccess } from '../payments/connection'
import { defineJob, type JobDefinition, type JobQueue } from './types'

/** The notices read in one page. */
export const NOTICE_PAGE = 100

/** The most notices one run looks at; the next run goes on from there. */
export const NOTICE_RUN_CAP = 1_000

/** A run takes no new page after this long (the next run starts a minute after this one). */
export const NOTICE_RUN_BUDGET_MS = 45_000

/** A notice still waiting after this long is logged as an error. */
export const NOTICE_LATE_MS = 24 * 60 * 60 * 1000

/**
 * An `account` or `access_lost` notice can arrive before the account it names is recorded (the provider's account is
 * made, the notice is sent, and only then does the worker record it as the venue's). One about an
 * account not ours is given this long to be recorded before it is marked handled and dropped.
 */
export const ACCOUNT_NOTICE_GRACE_MS = 10 * 60 * 1000

/** Refusals that a later run may get past: a lock held elsewhere, our capture not recorded yet. */
const TRANSIENT_REFUSALS: readonly string[] = ['busy', 'payment_not_captured']

/** The providers this worker reads notices back from, by kind (#107 adds the first real one). */
export type NoticeProviders = ReadonlyMap<
  string,
  Pick<PaymentProvider, 'readNoticeSubject'> & Partial<ConnectionProvider>
>

/** The providers that can also be asked about a venue's account (an account notice needs one). */
export function connectionProviders(
  providers: NoticeProviders,
): ReadonlyMap<string, ConnectionProvider> {
  const found = new Map<string, ConnectionProvider>()
  for (const [kind, provider] of providers) {
    if (
      provider.kind !== undefined &&
      provider.startConnection !== undefined &&
      provider.readConnection !== undefined &&
      provider.prepareDomain !== undefined
    ) {
      // Bound, so a provider that is a class instance keeps its `this`.
      found.set(kind, {
        kind: provider.kind,
        startConnection: provider.startConnection.bind(provider),
        readConnection: provider.readConnection.bind(provider),
        prepareDomain: provider.prepareDomain.bind(provider),
      })
    }
  }
  return found
}

export interface ProviderNoticesDeps {
  readonly providers: NoticeProviders
  /** The page size and the per-run cap; the defaults above unless a test sets them. */
  readonly limits?: { readonly page: number; readonly perRun: number }
}

/** What the job keeps from one run to the next, in memory (a restart starts over). */
export interface NoticeRunState {
  /** The next run starts after this `seq`; 0 for the start. */
  resumeAfter: number
  /** When each late notice was last logged, by `seq`, so each is logged once a day. */
  readonly lateLoggedAt: Map<number, number>
}

export const newNoticeRunState = (): NoticeRunState => ({ resumeAfter: 0, lateLoggedAt: new Map() })

/** What became of one notice. */
export type NoticeOutcome =
  /** Recorded: the payment's refund total or dispute changed. */
  | 'recorded'
  /** A guest payment's notice: its check was queued. */
  | 'queued'
  /** A venue's account notice: the connection was read back (or the lost access recorded). */
  | 'connection'
  /** The reading matched what we had. */
  | 'unchanged'
  /** A kind with no handler, marked handled with no action. */
  | 'no_handler'
  /** No account named, or none of ours: marked handled. */
  | 'unknown_account'
  /** The provider found no payment of ours behind it: marked handled. */
  | 'not_ours'
  /** Refused for good (another payment, another amount, an archived venue): marked handled. */
  | 'refused'
  /** Left for the next run: no provider here, a failed or incomplete reading, a transient refusal. */
  | 'waiting'

function asNotice(stored: StoredProviderNotice): ProviderNotice {
  return {
    id: stored.eventId,
    type: stored.type,
    kind: stored.kind,
    accountRef: stored.accountRef === null ? null : providerRef(stored.accountRef),
    objectRef: stored.objectRef === null ? null : providerRef(stored.objectRef),
  }
}

/** Handles one stored notice. Never throws for what a provider or a refusal causes. */
export async function handleProviderNotice(
  env: {
    readonly pool: DbPool
    readonly log: Logger
    readonly jobId: string
    readonly accounts: (providerKind: string) => Promise<ReadonlyMap<string, AccountVenue>>
    /** Where a guest payment's check is queued; without it a `payment` notice waits. */
    readonly queue?: JobQueue
    /** The clock; the real one unless a test sets it. */
    readonly now?: () => Date
  },
  stored: StoredProviderNotice,
  deps: ProviderNoticesDeps,
): Promise<NoticeOutcome> {
  const { pool, log } = env
  const about = { seq: stored.seq, providerKind: stored.providerKind, kind: stored.kind }
  const handled = async (outcome: NoticeOutcome): Promise<NoticeOutcome> => {
    await markProviderNoticeHandled(pool, stored.seq)
    return outcome
  }

  const HANDLED_KINDS: readonly string[] = [
    'refund',
    'dispute',
    'payment',
    'account',
    'access_lost',
  ]
  if (!HANDLED_KINDS.includes(stored.kind)) return handled('no_handler')

  const provider = deps.providers.get(stored.providerKind)
  if (provider === undefined) return 'waiting'

  const venue =
    stored.accountRef === null
      ? undefined
      : (await env.accounts(stored.providerKind)).get(stored.accountRef)
  if (
    (stored.kind === 'account' || stored.kind === 'access_lost') &&
    stored.accountRef !== null &&
    venue === undefined &&
    (env.now?.() ?? new Date()).getTime() - stored.receivedAt.getTime() < ACCOUNT_NOTICE_GRACE_MS
  ) {
    // Not ours yet: the account may still be about to be recorded. Wait, then drop it.
    return 'waiting'
  }
  if (stored.accountRef === null || venue === undefined) {
    log.warn(about, 'a provider notice names no account of ours; marked handled')
    return handled('unknown_account')
  }

  if (stored.kind === 'account' || stored.kind === 'access_lost') {
    // The venue's account, not a payment: read the connection back, never the notice's copy.
    const target = { tenantId: venue.tenantId, venueId: venue.venueId }
    const connection = { pool, log, jobId: env.jobId }
    const providers = connectionProviders(deps.providers)
    try {
      // Lost access pauses paying at once on the signed notice alone: no reading gates it.
      if (stored.kind === 'access_lost') {
        const outcome = await recordLostAccess(connection, target, stored.accountRef)
        return handled(outcome === 'unknown_account' ? 'unknown_account' : 'connection')
      }
      if (!providers.has(stored.providerKind)) return 'waiting'
      const read = await readAccount(connection, target, providers, {
        afterReturn: false,
        guestHost: null,
      })
      if (read.kind === 'read') return handled('connection')
      if (read.kind === 'refused' || read.kind === 'no_account') return handled('refused')
      return 'waiting'
    } catch (error) {
      log.warn({ ...about, err: error }, "a provider notice's account could not be recorded")
      return 'waiting'
    }
  }

  let reading: Awaited<ReturnType<PaymentProvider['readNoticeSubject']>>
  try {
    reading = await provider.readNoticeSubject(providerRef(stored.accountRef), asNotice(stored))
  } catch (error) {
    log.warn({ ...about, err: error }, "a provider notice's payment could not be read back")
    return 'waiting'
  }
  if (!reading.complete) {
    log.warn({ ...about, reason: reading.reason }, "a provider notice's reading was incomplete")
    return 'waiting'
  }
  if (reading.value === null) {
    log.info(about, 'a provider notice is about no payment of ours; marked handled')
    return handled('not_ours')
  }

  const payment = reading.value
  if (stored.kind === 'payment') {
    // The check reads the provider itself and moves the payment on under its own lock (#110).
    if (env.queue === undefined) return 'waiting'
    try {
      const job = prepareJob(JOB_NAMES.paymentCheck, {
        tenantId: venue.tenantId,
        venueId: venue.venueId,
        paymentId: payment.paymentId,
      })
      await env.queue.send(JOB_NAMES.paymentCheck, job.data, {
        singletonKey: job.singletonKey,
        ...(job.group === undefined ? {} : { group: job.group }),
      })
    } catch (error) {
      log.warn({ ...about, err: error }, "a guest payment's check could not be queued")
      return 'waiting'
    }
    return handled('queued')
  }
  let result: Awaited<ReturnType<typeof applyService>>['result']
  try {
    ;({ result } = await applyService(
      pool,
      {
        type: 'payment.observe',
        paymentId: payment.paymentId,
        providerKind: stored.providerKind,
        providerPaymentRef: payment.ref.provider,
        capturedMinor: payment.capturedMinor,
        refundedMinor: payment.refundedMinor,
        dispute: payment.dispute,
        disputeDueAt: payment.disputeDueAt,
      },
      {
        tenantId: venue.tenantId,
        venueId: venue.venueId,
        origin: 'worker',
        actor: { kind: 'system' },
        jobId: env.jobId,
        via: 'provider',
      },
    ))
  } catch (error) {
    log.warn({ ...about, err: error }, "a provider notice's reading could not be recorded")
    return 'waiting'
  }
  if (result.status === 'accepted') {
    if (
      typeof result.details.refundsUnmatched === 'number' &&
      result.details.refundsUnmatched > 0
    ) {
      // The provider's refund total fell by an amount no refund row has: nothing was marked and
      // no row was made. Amounts are minor units in fields, never in the message.
      log.warn(
        {
          ...about,
          paymentId: payment.paymentId,
          storedMinor: result.details.storedMinor ?? null,
          refundedMinor: payment.refundedMinor,
          capturedMinor: payment.capturedMinor,
        },
        'a refund total fell by an amount no refund row matches; no refund was marked',
      )
    }
    return handled(result.details.changed === true ? 'recorded' : 'unchanged')
  }
  if (TRANSIENT_REFUSALS.includes(result.code)) return 'waiting'
  log.warn(
    { ...about, code: result.code, reason: result.details.reason ?? null },
    "a provider notice's reading was refused; marked handled",
  )
  return handled('refused')
}

/** One run: the unhandled notices of the providers this worker has, page by page by `seq`. */
export async function handleProviderNotices(
  env: {
    readonly pool: DbPool
    readonly log: Logger
    readonly now: () => Date
    jobId: string
    readonly queue?: JobQueue
  },
  deps: ProviderNoticesDeps,
  state: NoticeRunState = newNoticeRunState(),
): Promise<Readonly<Record<NoticeOutcome | 'late', number>>> {
  const counts: Record<NoticeOutcome | 'late', number> = {
    recorded: 0,
    queued: 0,
    connection: 0,
    unchanged: 0,
    no_handler: 0,
    unknown_account: 0,
    not_ours: 0,
    refused: 0,
    waiting: 0,
    late: 0,
  }
  const providerKinds = [...deps.providers.keys()]
  if (providerKinds.length === 0) return counts
  const { page, perRun } = deps.limits ?? { page: NOTICE_PAGE, perRun: NOTICE_RUN_CAP }
  // Each provider's accounts are read once per run, when a notice needs them.
  const accounts = new Map<string, Promise<ReadonlyMap<string, AccountVenue>>>()
  const accountsOf = (providerKind: string) => {
    let found = accounts.get(providerKind)
    if (found === undefined) {
      found = paymentAccountVenues(env.pool, providerKind)
      accounts.set(providerKind, found)
    }
    return found
  }
  const started = env.now().getTime()
  for (const [seq, loggedAt] of state.lateLoggedAt) {
    if (started - loggedAt >= NOTICE_LATE_MS) state.lateLoggedAt.delete(seq)
  }
  const newlyLate: number[] = []
  // From where the last run stopped to the end, then from the start up to there.
  const resumedAt = state.resumeAfter
  let wrapped = resumedAt === 0
  let after = resumedAt
  let looked = 0
  let reachedEnd = false
  while (looked < perRun && env.now().getTime() - started < NOTICE_RUN_BUDGET_MS) {
    const limit = Math.min(page, perRun - looked)
    const read = await unhandledProviderNotices(env.pool, { limit, afterSeq: after, providerKinds })
    const notices = wrapped && resumedAt > 0 ? read.filter((n) => n.seq <= resumedAt) : read
    for (const notice of notices) {
      const outcome = await handleProviderNotice(
        {
          pool: env.pool,
          log: env.log,
          jobId: env.jobId,
          accounts: accountsOf,
          now: env.now,
          ...(env.queue === undefined ? {} : { queue: env.queue }),
        },
        notice,
        deps,
      )
      counts[outcome] += 1
      if (outcome === 'waiting' && started - notice.receivedAt.getTime() >= NOTICE_LATE_MS) {
        counts.late += 1
        if (!state.lateLoggedAt.has(notice.seq)) {
          state.lateLoggedAt.set(notice.seq, started)
          newlyLate.push(notice.seq)
        }
      }
      after = notice.seq
    }
    looked += notices.length
    if (notices.length === limit) continue
    if (!wrapped) {
      wrapped = true
      after = 0
      continue
    }
    reachedEnd = true
    break
  }
  // A run that went all the way round starts the next one from the start.
  state.resumeAfter = reachedEnd ? 0 : after
  if (newlyLate.length > 0) {
    env.log.error(
      { late: newlyLate.length, seqs: newlyLate },
      'provider notices are still not handled after a day',
    )
  }
  return counts
}

/** The provider notices job. */
export function createProviderNoticesJob(deps: ProviderNoticesDeps): JobDefinition {
  const state = newNoticeRunState()
  return defineJob({
    name: JOB_NAMES.providerNotices,
    schedule: { cron: '* * * * *', tz: 'Europe/Sofia' },
    options: {
      policy: 'exclusive',
      // The next run comes in a minute and takes what this one left; a failed one is not retried.
      queue: {
        retryLimit: 0,
        expireInSeconds: 5 * 60,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
    },
    async handler(jobs, context) {
      const jobId = jobs[0]?.id ?? 'provider-notices'
      const counts = await handleProviderNotices(
        { pool: context.pool, log: context.log, now: context.now, jobId, queue: context.queue },
        deps,
        state,
      )
      const { late: _late, ...outcomes } = counts
      const seen = Object.values(outcomes).reduce((sum, count) => sum + count, 0)
      context.log[seen > 0 ? 'info' : 'debug'](counts, 'provider notices')
    },
  }) as JobDefinition
}
