// The payment jobs (#110, #111; D127 §Where things run, §The route, 3.1, 3.9; design §4, §5, §6).
//
//   payment-prepare  move one payment on: price it from a fresh reading of its table (`requested`),
//                    make the provider's hold (`priced`), then the route once it is held: wait for a
//                    payment table, move the lines onto it under the real table's turn, the last
//                    check, the close, the capture; or put the lines back and cancel it
//   payment-check    read the provider's payment while the guest is at the card form
//                    (`awaiting_guest`): held, still waiting, or past its deadline
//
// Both queues are `stately` with one singleton key per payment (`prepareJob`): a send while one
// waits is the same job, and one sent while a step runs waits behind it. The guest API queues
// them after each pay command and again from the paying phone's poll; a provider notice queues a
// check. A check that finds the guest still at the form queues itself again for the deadline, under
// a key of its own so a nudge is never swallowed by the waiting deadline check.
//
// What the jobs keep to:
// - Every state change is a compare-and-set through `applyService` (`payment.price`,
//   `payment.hold_created`, `payment.check`, `payment.settle`); a step that finds the payment
//   moved on changes nothing.
// - Every provider write is recorded `attempting` before the call (`payment.step`) and with its
//   outcome after; its idempotency key is the payment's and the step's, so a retry after an
//   unknown outcome makes the provider do it once.
// - The hold is the POS's own line amounts plus the tip, read fresh from the POS (rule 8, D127
//   3.2); a tip only where the connector declares `recordTipOnClose`.
// - An incomplete reading, a paused connection or an unknown outcome concludes nothing: the job
//   throws and pg-boss retries it (the phone's poll queues it again too).
// - A `sim` instance is refused in production before its host is asked. Restro never refunds.
// - The route (#111): every POS write is a `payment.step` too, recorded inside the instance's
//   budget right before the call, so a write that never left is never counted as attempted. An
//   unknown move or undo is read back from the payment table for the read-back window and never
//   sent again inside it (D127 3.4); an unknown close is `unconfirmed` for a manager or owner after
//   D115's read-back window (a later landing is not ruled out, C52), unless, where the connector
//   declares `readClosedBills`, the bill it was sent for reads closed carrying Restro's reference
//   or a receipt number (D127's third proof; an empty payment table is no proof). A close is sent
//   once. After a manager's "No
//   receipt" the hold is released only once a fresh read shows the lines back on the real table;
//   otherwise a manager is asked again (#153).
//   An unknown capture is read back from the provider: captured is done; still held is tried
//   again with a new key (`not_landed`); a read that tells nothing, again with the same key; a
//   hold the read shows gone fails the capture (`capture_failed`, the owners are told).
// - Pay-first (#113): a `pay_first` payment's lines are not on the POS. It is priced from what the
//   guest saw at Send, and once queued its round is entered on the free payment table
//   (`addLines`, a note naming the guest's table where notes reach the ticket). An entry whose
//   outcome stays unknown after the read-back window is `unconfirmed`, never sent again. After
//   it is entered, the check reads the payment table's bill only (`payment.pay_first_checked`),
//   then the close and the capture are the route's own: nothing after the entry releases the hold.
// - Recovery (#112): a hold is asked for once (D127 3.15): one whose outcome is unknown, or that
//   an earlier run left without its state, is cancelled, and the cancel finds and releases it; never
//   asked for again with its key. A release the provider refused is read back until the provider
//   drops the hold (`payment.expired`), never sent again. A hold that ran out while the payment
//   waited for a table or for a manager's answer settles it `released`, reason `expired`. The
//   close's answer is recorded with its state (`payment.closed`), so a run that finds a recorded
//   answer goes on from it. Every provider call feeds the venue account's breaker
//   (./payment-breaker.ts); a paused account settles a new hold `paying_paused`.
// - One run of a payment at a time: a run takes no new step past `PAYMENT_RUN_MS` and queues the
//   next, and pg-boss gives it longer than that and one step (`PAYMENT_PREPARE_EXPIRE_SECONDS`)
//   before it fails it and runs it again. Should two runs meet anyway, the real table's turn is
//   the payment's until its lease passes, and a close in flight is waited for, not taken for lost.

import {
  addMinor,
  ClosedBillSchema,
  CURRENCIES,
  type Currency,
  closeProof,
  IsolatedBillSchema,
  type IsolatedHandle,
  JOB_NAMES,
  type OrderLine,
  type PayAndCloseResult,
  PaymentIdSchema,
  type PaymentJob,
  PaymentJobSchema,
  type PaymentProvider,
  type PosBill,
  type PosRef,
  type ProviderPayment,
  posRef,
  prepareJob,
  providerRef,
  readingSchema,
  SERVICE_TIMINGS,
  type ServiceConnector,
  type ServiceTimings,
  serviceDayStartsAt,
  sumSignedMinor,
  type TableBills,
  TableBillsSchema,
  type WriteOutcome,
} from '@restro/core'
import {
  alertLocale,
  applyService,
  BUDGET_WAIT_MS,
  billIsRound,
  HOLD_READ_TRIES,
  isFinalPaymentState,
  LEASE_MARGIN_MS,
  PAYMENT_CONFIRM_MS,
  PAYMENT_LONG_WAIT_MS,
  type PAYMENT_STEP_NAMES,
  PAYMENT_UNCONFIRMED_REASONS,
  PAYMENT_WRITE_PAUSE_MS,
  type PaymentStepLines,
  PaymentStepLinesSchema,
  payFirstTableNote,
  quantityKey,
  READ_BACK_EVERY_MS,
  type RoundLine,
  sentOrderLinesOf,
  tableLabel,
} from '@restro/core/service'
import {
  type DbPool,
  integrations,
  locks,
  logEntries,
  paymentAccounts,
  paymentLines,
  paymentSteps,
  payments,
  places,
  sentOrderNotes,
  sentOrders,
  sourceLinks,
  venues,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { Job } from 'pg-boss'

import type { SimPolicy } from '../config'
import { ROUTE_RUNS_AT_ONCE } from '../connection'
import type { PaymentProviders } from '../connectors'
import type { Logger } from '../logger'
import { EmailSendError, type EmailSender, RECEIPT_CALL_TIMEOUT_MS } from '../receipts/email-sender'
import { assertSimAllowed, serviceConnectorFor, serviceContext } from '../service-connectors'
import type { Limiter } from '../sync/limiter'
import { type Bounded, bounded } from './connection'
import { connectionPaused, type InstanceBudgets, PosTurn, SHARED_BUDGETS } from './floor'
import { toOrderLine } from './order-send'
import { type PaymentBreakers, SHARED_PAYMENT_BREAKERS, watchedProvider } from './payment-breaker'
import { defineJob, type JobDefinition, type JobQueue, type WorkerContext } from './types'

export type { PaymentProviders }

/** A step that concluded nothing: pg-boss runs the job again. Never carries a provider value. */
export class PaymentStepRetry extends Error {
  override name = 'PaymentStepRetry'
}

/** The provider's refusals of a hold that mean the venue's account can't take payments now. */
const ACCOUNT_REFUSALS: readonly string[] = ['access_lost', 'account_restricted']

/** The most steps one prepare run takes: from `held` to captured and the table freed is about 8. */
const PREPARE_STEPS = 16
/** How soon a payment waiting for a payment table, or for the real table's turn, looks again. */
const WAIT_SECONDS = 2
/** How soon a POS write whose outcome is unknown is read back again. */
const READ_BACK_SECONDS = READ_BACK_EVERY_MS / 1_000

/**
 * How long one prepare run takes new steps: past it, the run queues the next and ends. A run of
 * many steps (each POS call waits for its turn and its answer) would otherwise outlive pg-boss's
 * expiry, which fails a run still going and starts the same payment again beside it.
 */
export const PAYMENT_RUN_MS = 120_000

/** The provider's own limit on one call: the Stripe client's timeout, with no retries of its own. */
const PROVIDER_CALL_MS = 20_000

/** The default waits between a receipt send's tries (a busy service passes in seconds). */
const RECEIPT_RETRY_DELAYS_MS: readonly number[] = [1_000, 4_000]

/**
 * The longest the receipt send takes after the close (#186): each try the service's own limit,
 * and the waits between them. It runs inside the close step, so a step's worst case includes it.
 */
export const RECEIPT_SEND_MS =
  (RECEIPT_RETRY_DELAYS_MS.length + 1) * RECEIPT_CALL_TIMEOUT_MS +
  RECEIPT_RETRY_DELAYS_MS.reduce((sum, wait) => sum + wait, 0)

/**
 * The longest one route step takes for these timings: its turn on the POS, the last check's three
 * POS reads and the hold's read at the provider, the pause and the close, each POS call with its
 * turn at the budget.
 */
export function paymentStepMs(timings: ServiceTimings = SERVICE_TIMINGS): number {
  const read = BUDGET_WAIT_MS + timings.readTimeoutMs
  const write = BUDGET_WAIT_MS + timings.writeTimeoutMs
  return (
    BUDGET_WAIT_MS + 3 * read + PROVIDER_CALL_MS + PAYMENT_WRITE_PAUSE_MS + write + RECEIPT_SEND_MS
  )
}

/**
 * How long pg-boss lets one prepare run go before it fails it and runs it again: past the run's
 * deadline and one step begun just before it, with a margin (as `order-send`'s five minutes).
 */
export const PAYMENT_PREPARE_EXPIRE_SECONDS = 6 * 60

export interface PaymentJobDeps {
  readonly sim: SimPolicy
  readonly providers: PaymentProviders
  readonly budgets?: InstanceBudgets
  /** Builds the connector of an instance; tests pass their own. */
  readonly connectorFor?: typeof serviceConnectorFor
  /** The seam's timings; tests shorten them. */
  readonly timings?: ServiceTimings
  /** Waits before a POS write of the route; tests pass a fake. */
  readonly sleep?: (ms: number) => Promise<void>
  /** The provider breakers (`SHARED_PAYMENT_BREAKERS`); tests pass their own. */
  readonly breakers?: PaymentBreakers
  /** The step's turn on the POS, among the instance's other chains of calls; set by the run. */
  readonly posTurn?: PosTurn
  /**
   * Sends the POS's own receipt file to the guest, from the venue's name (#186); null or absent
   * where RECEIPT_FROM_ADDRESS is unset: a connector that returns the file is then never given
   * the guest's email (the waiter brings paper).
   */
  readonly receiptSender?: EmailSender | null
  /** The waits between a receipt send's tries (default 1 s, then 4 s); tests pass zeros. */
  readonly receiptRetryDelaysMs?: readonly number[]
}

export interface PaymentEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
  readonly queue: JobQueue
  readonly jobId: string
  /**
   * Called after each provider or POS step is recorded (a test seam: the crash tests stop the
   * worker there, #112). Throwing ends the run as a crash would.
   */
  readonly onStep?: (step: { readonly step: string; readonly outcome: string }) => Promise<void>
}

/** Where a payment stands after a run, or why the run did nothing. */
export type PaymentRunOutcome =
  | { readonly kind: 'at'; readonly state: string }
  | { readonly kind: 'missing' }

/** What one route step did: moved on (run the next), or wait (the job was queued again). */
type StepDone = 'next' | 'wait'

type PaymentRow = typeof payments.$inferSelect

async function paymentOf(env: PaymentEnvironment, target: PaymentJob): Promise<PaymentRow | null> {
  const [row] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, target.paymentId), eq(payments.venueId, target.venueId))),
  )
  return row ?? null
}

/** The venue's account with its provider, when it can take a payment now. */
async function accountOf(
  env: PaymentEnvironment,
  target: PaymentJob,
): Promise<{
  readonly providerKind: string
  readonly accountRef: string | null
  readonly state: string
  readonly payingPausedAt: Date | null
} | null> {
  const [account] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({
        providerKind: paymentAccounts.providerKind,
        accountRef: paymentAccounts.accountRef,
        state: paymentAccounts.state,
        payingPausedAt: paymentAccounts.payingPausedAt,
      })
      .from(paymentAccounts)
      .where(eq(paymentAccounts.venueId, target.venueId)),
  )
  return account ?? null
}

/** Runs one of the worker's payment commands, as the worker. */
async function apply(
  env: PaymentEnvironment,
  target: PaymentJob,
  command: Record<string, unknown> & { readonly type: string },
): Promise<{
  readonly state: string | null
  readonly code: string | null
  readonly details: Readonly<Record<string, unknown>>
}> {
  const { result } = await applyService(env.pool, command, {
    tenantId: target.tenantId,
    venueId: target.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: env.jobId,
  })
  if (result.status === 'refused') {
    env.log.warn(
      { paymentId: target.paymentId, command: command.type, code: result.code },
      'a payment step was refused',
    )
    return { state: null, code: result.code, details: result.details }
  }
  const state = result.details.state
  return { state: typeof state === 'string' ? state : null, code: null, details: result.details }
}

/** Records one provider step (D127 3.9): `attempting` before the call, the outcome after. */
function recordStep(
  env: PaymentEnvironment,
  target: PaymentJob,
  step: (typeof PAYMENT_STEP_NAMES)[number],
  idempotencyKey: string,
  /** A move back's lines, recorded on its `attempting` row only (#153). */
  lines: PaymentStepLines | null = null,
) {
  return async (
    outcome: 'attempting' | 'done' | 'refused' | 'unknown',
    answer: string | null = null,
  ) => {
    const recorded = await apply(env, target, {
      type: 'payment.step',
      paymentId: target.paymentId,
      step,
      outcome,
      answer,
      idempotencyKey,
      lines: outcome === 'attempting' ? lines : null,
    })
    if (recorded.code !== null) throw new PaymentStepRetry(`the ${step} step was not recorded`)
    await env.onStep?.({ step, outcome })
  }
}

/** The latest recorded row of a provider step, or null before the first. */
async function latestStep(
  env: PaymentEnvironment,
  target: PaymentJob,
  step: (typeof PAYMENT_STEP_NAMES)[number],
): Promise<{ readonly outcome: string; readonly answer: string | null } | null> {
  const [row] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({ outcome: paymentSteps.outcome, answer: paymentSteps.answer })
      .from(paymentSteps)
      .where(and(eq(paymentSteps.paymentId, target.paymentId), eq(paymentSteps.step, step)))
      .orderBy(desc(paymentSteps.seq))
      .limit(1),
  )
  return row ?? null
}

/** True once the last check could not read this payment's hold (`payment.hold_unread`). */
async function holdWentUnread(env: PaymentEnvironment, target: PaymentJob): Promise<boolean> {
  const [row] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({ seq: logEntries.seq })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.venueId, target.venueId),
          eq(logEntries.paymentId, target.paymentId),
          eq(logEntries.kind, 'payment.hold_unread'),
        ),
      )
      .limit(1),
  )
  return row !== undefined
}

/**
 * The idempotency key of a capture or a release: the same on every retry, so a call that landed is
 * never made twice; a new one only after a read showed an earlier call left the hold as it was
 * (`not_landed`), because the provider keeps a server error under its key and answers it again.
 * A hold is captured or released once whatever the key, so a late landing of the earlier call
 * only makes the later one refused.
 */
async function providerKey(
  env: PaymentEnvironment,
  target: PaymentJob,
  step: 'capture' | 'release',
): Promise<string> {
  const missed = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({ seq: paymentSteps.seq })
      .from(paymentSteps)
      .where(
        and(
          eq(paymentSteps.paymentId, target.paymentId),
          eq(paymentSteps.step, step),
          eq(paymentSteps.answer, 'not_landed'),
        ),
      ),
  )
  const base = `${target.paymentId}:${step}`
  return missed.length === 0 ? base : `${base}:${missed.length + 1}`
}

/**
 * What a read of the provider says about a write whose outcome is unknown: `gone` is a hold that
 * holds nothing and never will (released or failed) where that is not the write's landing.
 */
function landedAnswer(
  reading: Awaited<ReturnType<PaymentProvider['readPayment']>>,
  landed: (payment: ProviderPayment) => boolean,
): 'landed' | 'not_landed' | 'gone' | 'unknown' {
  if (!reading.complete) return 'unknown'
  if (landed(reading.value)) return 'landed'
  if (reading.value.status === 'held') return 'not_landed'
  return isOver(reading.value) ? 'gone' : 'unknown'
}

function currencyOf(payment: PaymentRow): Currency {
  const currency = payment.currency as Currency
  if (!CURRENCIES.includes(currency)) {
    throw new PaymentStepRetry(`the payment's currency ${payment.currency} is not one Restro knows`)
  }
  return currency
}

function providerOf(deps: PaymentJobDeps, kind: string): PaymentProvider {
  const provider = deps.providers.get(kind)
  if (provider === undefined) {
    throw new PaymentStepRetry(`this worker has no payment provider ${kind}`)
  }
  return provider
}

/** The provider of `kind`, each of its calls fed to the venue account's breaker (#112). */
function providerFor(
  env: PaymentEnvironment,
  target: PaymentJob,
  deps: PaymentJobDeps,
  kind: string,
): PaymentProvider {
  const breakers = deps.breakers ?? SHARED_PAYMENT_BREAKERS
  const ref = { tenantId: target.tenantId, venueId: target.venueId }
  return watchedProvider(providerOf(deps, kind), (ok) =>
    breakers.record(env, ref, { kind: 'call', ok }),
  )
}

/** Why a refused hold settles its payment: too small, the account, or the hold itself. */
function holdRefusalReason(code: string | null): string {
  if (code === 'amount_too_small') return 'below_minimum'
  return code !== null && ACCOUNT_REFUSALS.includes(code) ? 'paying_paused' : 'hold_refused'
}

/** `requested`: read the table fresh and price the payment (`payment.price`). */
async function price(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  deps: PaymentJobDeps,
): Promise<void> {
  const pos = await posOf(env, target, payment, deps)
  const provider = providerFor(env, target, deps, payment.providerKind)
  const currency = currencyOf(payment)

  let lines: { pos: string; quantity: string; amountMinor: number }[] = []
  let tipAllowed = false
  if (pos !== null) {
    if (pos.paused) throw new PaymentStepRetry('the connection is paused')
    // A pay-first round is not on the POS yet: priced at Send, it is never read here (#113).
    if (payment.kind === 'on_bill') lines = linesOf(await readPos(pos, pos.table))
    tipAllowed = pos.connector.capabilities.recordTipOnClose
  }
  // No POS table (any more): the picked lines are gone, which `payment.price` releases.
  await apply(env, target, {
    type: 'payment.price',
    paymentId: target.paymentId,
    lines,
    providerMinimumMinor: provider.capabilities.minimumMinor(currency),
    tipAllowed,
  })
}

/** The hold's description: the venue and the table, as the guest's bank may show them. */
async function descriptionOf(env: PaymentEnvironment, target: PaymentJob, payment: PaymentRow) {
  const [row] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({ venue: venues.name, name: venueTables.name, number: venueTables.number })
      .from(venueTables)
      .innerJoin(venues, eq(venues.id, venueTables.venueId))
      .where(eq(venueTables.id, payment.tableId)),
  )
  const table = row?.name ?? row?.number ?? null
  const text = [row?.venue, table].filter((part) => part !== undefined && part !== null).join(' · ')
  return (text === '' ? 'Restro' : text).slice(0, 200)
}

/** `priced`: make the provider's hold (`createHold`), then `payment.hold_created`. */
async function hold(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  deps: PaymentJobDeps,
): Promise<void> {
  const settle = (reason: string) =>
    apply(env, target, {
      type: 'payment.settle',
      paymentId: target.paymentId,
      from: 'priced',
      reason,
    })
  const account = await accountOf(env, target)
  if (
    account === null ||
    account.accountRef === null ||
    account.providerKind !== payment.providerKind
  ) {
    await settle('paying_not_offered')
    return
  }
  // Lost access, or the provider's breaker (#112): paying pauses at the venue, ordering goes on.
  if (account.state === 'lost_access' || account.payingPausedAt !== null) {
    await settle('paying_paused')
    return
  }
  if (account.state !== 'connected') {
    await settle('paying_not_offered')
    return
  }
  const provider = providerFor(env, target, deps, payment.providerKind)
  const amountMinor = payment.amountMinor
  if (amountMinor === null || amountMinor <= 0) {
    await settle('below_minimum')
    return
  }
  const idempotencyKey = `${payment.id}:hold`
  const step = recordStep(env, target, 'createHold', idempotencyKey)
  // A hold is asked for once (D127 3.15). A refusal recorded by an earlier run settles as it did;
  // any other earlier call (no answer, an unknown one, or done without its state) may have made a
  // hold: the payment is cancelled, and the cancel finds the hold and releases it. Never asked for
  // again with its key: the description may have changed since, and the provider would refuse it.
  const earlier = await latestStep(env, target, 'createHold')
  if (earlier !== null) {
    if (earlier.outcome === 'refused') {
      await settle(holdRefusalReason(earlier.answer))
      return
    }
    await apply(env, target, { type: 'payment.hold_unknown', paymentId: target.paymentId })
    return
  }
  await step('attempting')
  let outcome: Awaited<ReturnType<PaymentProvider['createHold']>>
  try {
    outcome = await provider.createHold({
      paymentId: PaymentIdSchema.parse(payment.id),
      accountRef: providerRef(account.accountRef),
      amountMinor,
      currency: currencyOf(payment),
      idempotencyKey,
      description: await descriptionOf(env, target, payment),
    })
  } catch (error) {
    // A call that threw may have reached the provider: the cancel finds out and releases it.
    env.log.warn({ paymentId: payment.id, err: error }, 'the hold could not be made')
    outcome = { kind: 'unknown', reason: 'threw' }
  }
  if (outcome.kind === 'unknown') {
    await step('unknown', outcome.reason === 'threw' ? 'threw' : 'unknown')
    await apply(env, target, { type: 'payment.hold_unknown', paymentId: target.paymentId })
    return
  }
  if (outcome.kind === 'refused') {
    const code = outcome.refusal.code
    await step('refused', code)
    await settle(holdRefusalReason(code))
    return
  }
  await step('done')
  const made = await apply(env, target, {
    type: 'payment.hold_created',
    paymentId: target.paymentId,
    providerPaymentRef: outcome.result.paymentRef.provider,
    formValues: { ...outcome.result.form },
  })
  if (made.state === 'awaiting_guest') {
    // The confirm deadline's check (design §6): the guest's own return or a notice comes sooner.
    await queueDeadlineCheck(env, target, PAYMENT_CONFIRM_MS)
  }
}

/** `cancelling`: release the provider's payment, if there is one, then settle it `released`. */
async function cancel(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  deps: PaymentJobDeps,
): Promise<void> {
  const settle = () =>
    apply(env, target, {
      type: 'payment.settle',
      paymentId: target.paymentId,
      from: 'cancelling',
      reason: 'cancelled',
    })
  // A pay-first round that may be on the POS is never released on its own (D127 3.13): without a
  // manager's answer the cancel is turned into a question, before the provider is called.
  if (
    payment.kind === 'pay_first' &&
    payment.reason !== 'no_receipt' &&
    payment.reason !== 'not_on_till' &&
    (await entryAttempted(env, target))
  ) {
    await route(env, target, {
      type: 'payment.entered',
      outcome: 'unknown',
      billRef: null,
      code: 'cancel_after_entry',
    })
    return
  }
  const account = await accountOf(env, target)
  // No account, no hold: `createHold` needs the account.
  if (account === null || account.accountRef === null) {
    if (payment.providerPaymentRef === null) {
      await settle()
      return
    }
    throw new PaymentStepRetry("the venue's account is gone while a hold may stand")
  }
  const provider = providerFor(env, target, deps, payment.providerKind)
  const accountRef = providerRef(account.accountRef)
  let paymentRef = payment.providerPaymentRef
  if (paymentRef === null) {
    // The hold's call may have reached the provider before the guest cancelled: ask (D127 3.9).
    const find = recordStep(env, target, 'findByPaymentId', `${payment.id}:find`)
    await find('attempting')
    const found = await provider.findByPaymentId(accountRef, PaymentIdSchema.parse(payment.id))
    if (!found.complete) {
      await find('unknown', 'incomplete')
      throw new PaymentStepRetry('the provider could not say whether a hold was made')
    }
    await find('done', found.value === null ? 'none' : 'found')
    if (found.value === null || isOver(found.value)) {
      await settle()
      return
    }
    paymentRef = found.value.ref.provider
  }
  // A release the provider refused is never sent again (#112, R3): the hold is read back until the
  // provider drops it (it runs out at its capture deadline at the latest), which settles the
  // payment `released`, reason `expired`.
  // A hold the last check could not read is read before any release: never released on a guess.
  // Unread, it stays as it is, and the recovery reads it again every 10 minutes (D125, RR-18).
  if (await holdWentUnread(env, target)) {
    const read = await provider.readPayment(accountRef, providerRef(paymentRef))
    if (!read.complete) throw new PaymentStepRetry('the unread hold could not be read back')
    if (isOver(read.value)) {
      await expire(env, target, read.value.status)
      return
    }
  }
  const lastRelease = await latestStep(env, target, 'release')
  if (lastRelease?.outcome === 'refused' && lastRelease.answer !== 'not_found') {
    const read = await provider.readPayment(accountRef, providerRef(paymentRef))
    if (!read.complete) throw new PaymentStepRetry('the refused hold could not be read back')
    if (isOver(read.value)) {
      await expire(env, target, read.value.status)
      return
    }
    // Still held: the owners and the team are told, once (a run that died before telling them).
    await apply(env, target, {
      type: 'payment.release_refused',
      paymentId: target.paymentId,
      code: lastRelease.answer ?? 'unknown',
    })
    return
  }
  const idempotencyKey = await providerKey(env, target, 'release')
  const step = recordStep(env, target, 'release', idempotencyKey)
  await step('attempting')
  let outcome: Awaited<ReturnType<PaymentProvider['release']>>
  try {
    outcome = await provider.release({
      accountRef,
      paymentRef: providerRef(paymentRef),
      idempotencyKey,
    })
  } catch (error) {
    env.log.warn({ paymentId: payment.id, err: error }, 'the hold could not be released')
    outcome = { kind: 'unknown', reason: 'threw' }
  }
  if (outcome.kind === 'unknown') {
    // Read back (#111): released is done; still held is tried again with a new key.
    const answer = landedAnswer(
      await provider.readPayment(accountRef, providerRef(paymentRef)),
      isOver,
    )
    await step('unknown', answer)
    if (answer === 'landed') {
      await settle()
      return
    }
    throw new PaymentStepRetry('the release has an unknown outcome')
  }
  if (outcome.kind === 'refused') {
    await step('refused', outcome.refusal.code)
    if (outcome.refusal.code === 'not_found') {
      await settle()
      return
    }
    // A refusal may only mean the hold is gone already (failed, or dropped by the provider):
    // read it back (D127 3.4), and settle a payment that holds nothing and never will.
    const read = await provider.readPayment(accountRef, providerRef(paymentRef))
    if (read.complete && isOver(read.value)) {
      await settle()
      return
    }
    // Nothing Restro may do about it (it never refunds): the payment stays `cancelling` for the
    // recovery to read back until the provider drops the hold; the owners and the team are told.
    env.log.error(
      { paymentId: payment.id, code: outcome.refusal.code },
      'the provider refused to release a payment Restro cancelled',
    )
    await apply(env, target, {
      type: 'payment.release_refused',
      paymentId: target.paymentId,
      code: outcome.refusal.code,
    })
    return
  }
  await step('done')
  await settle()
}

/**
 * True once a pay-first payment's round may be on the POS: an `addLines` left with no answer yet,
 * or one that landed or whose outcome is unknown (as core's `enterAttempted`).
 */
async function entryAttempted(env: PaymentEnvironment, target: PaymentJob): Promise<boolean> {
  const steps = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({ outcome: paymentSteps.outcome })
      .from(paymentSteps)
      .where(and(eq(paymentSteps.paymentId, target.paymentId), eq(paymentSteps.step, 'addLines')))
      .orderBy(desc(paymentSteps.seq)),
  )
  const [latest] = steps
  return (
    latest?.outcome === 'attempting' ||
    steps.some((step) => step.outcome === 'done' || step.outcome === 'unknown')
  )
}

// ---------------------------------------------------------------------------------------------
// The route after the hold (#111)

/** One step of a payment's run. */
type RouteStep = (
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  deps: PaymentJobDeps,
) => Promise<StepDone>

/** The POS of a payment's table: its connector, its instance's budget and the table's ref. */
interface PaymentPos {
  readonly connector: ServiceConnector
  readonly budget: Limiter
  readonly table: PosRef
  readonly paused: boolean
  readonly timings: ServiceTimings
  readonly context: ReturnType<typeof serviceContext>
  /** The wait before a write (`PAYMENT_WRITE_PAUSE_MS`). */
  readonly pause: () => Promise<void>
}

/** The POS place of one of the venue's tables (a payment table too), with its instance. */
async function placeOf(env: PaymentEnvironment, target: PaymentJob, tableId: string) {
  return withTenant(env.pool, target.tenantId, async (tx) => {
    const [place] = await tx
      .select({ integrationId: places.integrationId, placeId: places.placeId })
      .from(places)
      .where(and(eq(places.tableId, tableId), ne(places.state, 'deleted')))
    if (place === undefined) return null
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.id, place.integrationId))
    return integration === undefined || integration.removedAt !== null
      ? null
      : { place, integration }
  })
}

/** The POS of the payment's table, or null when the table has no POS place (any more). */
async function posOf(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  deps: PaymentJobDeps,
): Promise<PaymentPos | null> {
  const found = await placeOf(env, target, payment.tableId)
  if (found === null) return null
  const { integration, place } = found
  if (integration.kind === 'sim') assertSimAllowed(deps.sim)
  if (deps.posTurn !== undefined && !(await deps.posTurn.take(integration.id))) {
    throw new PaymentStepRetry('the POS gave the step no turn')
  }
  const timings = deps.timings ?? SERVICE_TIMINGS
  const budgets = deps.budgets ?? SHARED_BUDGETS
  const connector = (deps.connectorFor ?? serviceConnectorFor)(integration, deps.sim)
  return {
    connector,
    budget: budgets.forInstance(integration.id),
    table: posRef(place.placeId),
    paused: await connectionPaused(env.pool, target.tenantId, integration.id),
    timings,
    context: serviceContext(env.now, budgets.paceOf(integration.id, connector), timings),
    pause: () => (deps.sleep ?? sleepFor)(PAYMENT_WRITE_PAUSE_MS),
  }
}

/** The POS ref of the payment's payment table. */
async function paymentTableOf(env: PaymentEnvironment, target: PaymentJob, payment: PaymentRow) {
  if (payment.paymentTableId === null) throw new PaymentStepRetry('the payment has no table')
  const found = await placeOf(env, target, payment.paymentTableId)
  if (found === null) throw new PaymentStepRetry('the payment table has no POS place')
  return posRef(found.place.placeId)
}

/** A complete reading of one POS table, or a retry: an incomplete one concludes nothing (rule 6). */
async function readPos(pos: PaymentPos, table: PosRef): Promise<TableBills> {
  const answer = await bounded(pos.budget, pos.timings.readTimeoutMs, () =>
    pos.connector.readTable(pos.context, table),
  )
  if (answer.kind !== 'answered') throw new PaymentStepRetry('the table was not read in time')
  const parsed = readingSchema(TableBillsSchema).safeParse(answer.value)
  if (!parsed.success) throw new PaymentStepRetry('the reading did not have the expected shape')
  if (!parsed.data.complete) throw new PaymentStepRetry('the table reading was not complete')
  return parsed.data.value
}

/** Every line of a reading, as the commands take them. */
function linesOf(bills: TableBills) {
  return bills.bills.flatMap((bill) =>
    bill.lines.map((line) => ({
      pos: line.ref.pos,
      quantity: line.quantity,
      amountMinor: line.amountMinor,
    })),
  )
}

/** The route's POS writes, as `payment.step` records them. */
type RouteWrite = 'isolateLines' | 'undoIsolate' | 'payAndClose' | 'addLines'

/**
 * One POS write of the route. It is recorded `attempting` inside the instance's turn, right before
 * the call, so a write that never left is never counted (a close that never left is no close).
 * Late or thrown after it left: `unknown`.
 */
async function writePos<R>(
  env: PaymentEnvironment,
  target: PaymentJob,
  pos: PaymentPos,
  step: RouteWrite,
  ref: string,
  call: () => Promise<WriteOutcome<R>>,
  lines: PaymentStepLines | null = null,
  /** False for the close: its answer is recorded with its state (`payment.closed`, #112). */
  recordAnswer = true,
  /** On the close's `attempting` row: the POS bill it closes (`closeProofOf`). */
  attemptAnswer: string | null = null,
): Promise<WriteOutcome<R>> {
  await pos.pause()
  const record = recordStep(env, target, step, ref, lines)
  let attempted = false
  let answer: Bounded<WriteOutcome<R>>
  try {
    answer = await bounded(pos.budget, pos.timings.writeTimeoutMs, async () => {
      // A close is sent once, and an entry once unless the POS refused it (nothing written):
      // another run of this payment that got its turn first has sent it.
      if (step === 'payAndClose' || step === 'addLines') {
        const earlier = await callsOf(env, target, step)
        if (earlier !== null && (step === 'payAndClose' || earlier.outcome !== 'refused')) {
          throw new PaymentStepRetry(`the ${step} was attempted already`)
        }
      }
      await record('attempting', attemptAnswer)
      attempted = true
      return call()
    })
  } catch (error) {
    if (!attempted) throw error
    env.log.warn({ paymentId: target.paymentId, step, err: error }, 'a POS write threw')
    await record('unknown', 'threw')
    return { kind: 'unknown', reason: 'threw' }
  }
  if (answer.kind === 'no_turn') throw new PaymentStepRetry(`no turn at the POS for ${step}`)
  if (answer.kind === 'late') {
    await record('unknown', 'late')
    return { kind: 'unknown', reason: 'late' }
  }
  const outcome = answer.value
  if (outcome.kind === 'unknown') await record('unknown', 'unknown')
  else if (!recordAnswer) return outcome
  else if (outcome.kind === 'done') await record('done')
  else await record('refused', outcome.refusal.code)
  return outcome
}

/** Runs a route command; a refusal concluded nothing and the job runs again. */
async function route(
  env: PaymentEnvironment,
  target: PaymentJob,
  command: Record<string, unknown> & { readonly type: string },
) {
  const answer = await apply(env, target, { paymentId: target.paymentId, ...command })
  if (answer.code !== null)
    throw new PaymentStepRetry(`${command.type} was refused: ${answer.code}`)
  return answer
}

/** Takes the real table's write turn (the fence), or null while a send holds it. */
async function takeTurn(env: PaymentEnvironment, target: PaymentJob): Promise<number | null> {
  const taken = await route(env, target, { type: 'payment.turn', release: null })
  const fence = taken.details.fence
  return taken.details.turn === 'taken' && typeof fence === 'number' ? fence : null
}

/** The calls of one POS write so far: how the latest ended, how long ago it and the first left. */
interface StepCalls {
  /** The latest row: `attempting` (no answer recorded yet), `done`, `refused` or `unknown`. */
  readonly outcome: string
  /** The latest row's answer: a refusal's code, or how an unknown ended. */
  readonly answer: string | null
  readonly lastAgeMs: number
  readonly firstAgeMs: number
}

/**
 * The payment's calls of `step`, or null before the first. Ages are on the database's clock, as
 * the leases' deadlines are, so every worker reads the same window.
 */
async function callsOf(
  env: PaymentEnvironment,
  target: PaymentJob,
  step: RouteWrite,
): Promise<StepCalls | null> {
  const left = sql`${paymentSteps.outcome} = 'attempting'`
  const [row] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({
        outcome: sql<
          string | null
        >`(array_agg(${paymentSteps.outcome} order by ${paymentSteps.seq} desc))[1]`,
        answer: sql<
          string | null
        >`(array_agg(${paymentSteps.answer} order by ${paymentSteps.seq} desc))[1]`,
        lastAgeMs: sql<string | null>`(extract(epoch from now() - max(${paymentSteps.at})
          filter (where ${left})) * 1000)::text`,
        firstAgeMs: sql<string | null>`(extract(epoch from now() - min(${paymentSteps.at})
          filter (where ${left})) * 1000)::text`,
      })
      .from(paymentSteps)
      .where(and(eq(paymentSteps.paymentId, target.paymentId), eq(paymentSteps.step, step))),
  )
  if (row?.outcome === null || row?.outcome === undefined) return null
  return {
    outcome: row.outcome,
    answer: row.answer ?? null,
    lastAgeMs: Number(row.lastAgeMs ?? 0),
    firstAgeMs: Number(row.firstAgeMs ?? 0),
  }
}

/** A write whose latest call may still land: left with no answer, or an unknown one. */
function mayStillLand(calls: StepCalls, timings: ServiceTimings): boolean {
  const open = calls.outcome === 'attempting' || calls.outcome === 'unknown'
  return open && calls.lastAgeMs < timings.readBackWindowMs
}

/**
 * `held`, or `queued` without a table: free the payment tables whose payments are over and that read
 * empty, then ask for one of the tables read empty (`payment.claim_table`). Waiting, it looks again.
 */
const queueStep: RouteStep = async (env, target, payment, deps) => {
  const pos = await posOf(env, target, payment, deps)
  const free: string[] = []
  if (pos !== null && !pos.paused) {
    const tables = await withTenant(env.pool, target.tenantId, (tx) =>
      tx
        .select({ id: venueTables.id, placeId: places.placeId, holder: locks.holder })
        .from(venueTables)
        .innerJoin(places, and(eq(places.tableId, venueTables.id), ne(places.state, 'deleted')))
        .leftJoin(
          locks,
          and(
            eq(locks.venueId, venueTables.venueId),
            eq(locks.scope, 'payment_table'),
            eq(locks.key, venueTables.id),
          ),
        )
        .where(
          and(
            eq(venueTables.venueId, target.venueId),
            eq(venueTables.isPaymentTable, true),
            isNull(venueTables.archivedAt),
            payment.barId === null
              ? isNull(venueTables.barId)
              : eq(venueTables.barId, payment.barId),
          ),
        )
        .orderBy(venueTables.id),
    )
    const holders = tables.flatMap((table) => (table.holder === null ? [] : [table.holder]))
    const states = new Map(
      holders.length === 0
        ? []
        : (
            await withTenant(env.pool, target.tenantId, (tx) =>
              tx
                .select({ id: payments.id, state: payments.state })
                .from(payments)
                .where(inArray(payments.id, holders)),
            )
          ).map((row) => [row.id, row.state]),
    )
    for (const table of tables) {
      const state = table.holder === null ? null : (states.get(table.holder) ?? null)
      // Held by a payment still on its way, or unconfirmed (it keeps its table until answered).
      if (table.holder !== null && (state === null || !isFinalPaymentState(state))) continue
      if (state === 'unconfirmed') continue
      const reading = await readPos(pos, posRef(table.placeId))
      if (reading.bills.length > 0) continue
      if (table.holder !== null) {
        await route(
          env,
          { ...target, paymentId: PaymentIdSchema.parse(table.holder) },
          { type: 'payment.table_freed', paymentId: table.holder },
        )
      }
      free.push(table.id)
    }
  }
  const claimed = await route(env, target, { type: 'payment.claim_table', freeTables: free })
  const waitedMs = claimed.details.waitedMs
  if (typeof waitedMs === 'number' && waitedMs > PAYMENT_LONG_WAIT_MS) {
    // Counted (#111): the Log's `payment.state` line carries `longWait` too.
    env.log.info({ paymentId: payment.id, waitedMs }, 'a payment waited long for a payment table')
  }
  if (claimed.details.waiting === true) {
    await queuePrepare(env, target, WAIT_SECONDS)
    return 'wait'
  }
  return 'next'
}

/**
 * `queued` with a table: under the real table's write turn, move the payment's lines onto its
 * payment table (`isolateLines`), then `payment.isolated`. Lines already there are an earlier
 * run's move that landed.
 */
const isolateStep: RouteStep = async (env, target, payment, deps) => {
  const pos = await posOf(env, target, payment, deps)
  if (pos === null) {
    await route(env, target, { type: 'payment.isolated', outcome: 'refused', code: 'bill_closed' })
    return 'next'
  }
  if (pos.paused) throw new PaymentStepRetry('the connection is paused')
  const paymentTable = await paymentTableOf(env, target, payment)
  const fence = await takeTurn(env, target)
  if (fence === null) {
    await queuePrepare(env, target, WAIT_SECONDS)
    return 'wait'
  }
  try {
    const outcome = await isolate(env, target, payment, pos, paymentTable)
    if (outcome === 'later') {
      await queuePrepare(env, target, READ_BACK_SECONDS)
      return 'wait'
    }
    await route(env, target, { type: 'payment.isolated', ...outcome })
    return 'next'
  } finally {
    await route(env, target, { type: 'payment.turn', release: fence })
  }
}

/** The move landed: the lines are on the payment table. */
const MOVED = { outcome: 'moved', code: null } as const

/**
 * The move, or `later` while one whose outcome is unknown may still land. At most three reads
 * and one write, all inside the real table's turn (`paymentTurnSeconds`).
 */
async function isolate(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  pos: PaymentPos,
  paymentTable: PosRef,
): Promise<{ readonly outcome: 'moved' | 'refused'; readonly code: string | null } | 'later'> {
  // After an earlier move, what is on the payment table is that move, landed. One whose outcome
  // is unknown may land late: inside the read-back window it is read back, never sent again
  // (D127 3.4, design §5.3). Past it, it is sent again only from a real table that still has the
  // lines and an empty payment table. (A first move is not read for: the connector reads the
  // payment table itself, and every read counts towards the POS's calls per second.) Only a bill of
  // the payment's own lines is that move (as `enter`'s `landed`): a waiter's bill there is not.
  const earlier = await callsOf(env, target, 'isolateLines')
  const own = await ownLines(env, target)
  const landedOn = (table: TableBills) => table.bills.some((bill) => wholeOwnBill(bill, own))
  const landed = async () => landedOn(await readPos(pos, paymentTable))
  if (earlier !== null) {
    const onPaymentTable = await readPos(pos, paymentTable)
    if (landedOn(onPaymentTable)) return MOVED
    if (mayStillLand(earlier, pos.timings)) return 'later'
    // A waiter's bill on the payment table: nothing is sent, the hold is released, a manager told.
    if (onPaymentTable.bills.length > 0) return { outcome: 'refused', code: 'payment_table_busy' }
  }
  const real = await readPos(pos, pos.table)
  const lines = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({ pos: paymentLines.posLineRef, quantity: paymentLines.quantity })
      .from(paymentLines)
      .where(eq(paymentLines.paymentId, payment.id))
      .orderBy(paymentLines.position),
  )
  const picks: { bill: PosRef; line: PosRef; quantity: string }[] = []
  for (const line of lines) {
    const bill = real.bills.find((b) => b.lines.some((l) => l.ref.pos === line.pos))
    const found = bill?.lines.find((l) => l.ref.pos === line.pos)
    if (bill === undefined || found === undefined) {
      // Gone from the real table after an earlier move: that move may have landed since.
      if (earlier !== null && (await landed())) return MOVED
      return { outcome: 'refused', code: 'line_refused' }
    }
    // The POS's own text for a whole line; the picked part as an exact decimal otherwise.
    const whole = quantityText(found.quantity) === quantityText(line.quantity)
    picks.push({
      bill: bill.ref,
      line: found.ref,
      quantity: whole ? found.quantity : quantityText(line.quantity),
    })
  }
  if (picks.length === 0) return { outcome: 'refused', code: 'line_refused' }
  const ref = `${payment.id}-isolate`
  const outcome = await writePos(env, target, pos, 'isolateLines', ref, () =>
    pos.connector.isolateLines(pos.context, { table: pos.table, picks, paymentTable, ref }),
  )
  if (outcome.kind === 'done') return MOVED
  if (outcome.kind === 'refused') {
    // After an earlier move, a refusal (the payment table busy, a line gone) may be that move.
    if (earlier !== null && (await landed())) return MOVED
    return { outcome: 'refused', code: outcome.refusal.code }
  }
  // Unknown: read it back now, and on the next runs for the window. Nothing on the payment table
  // yet concludes nothing (it may land).
  return (await landed()) ? MOVED : 'later'
}

/** A decimal quantity without trailing zeros ("2.000000" → "2", "0.500000" → "0.5"). */
function quantityText(quantity: string): string {
  return quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity
}

/** What `payment.entered` takes: the outcome of the entry, the bill it opened, a refusal's code. */
type Entry = {
  readonly outcome: 'entered' | 'refused' | 'unknown'
  /** The POS bill's id, kept in the backend (rule 3). */
  readonly billRef: string | null
  readonly code: string | null
}

/**
 * A pay-first payment `queued` with a table (#113): enter its round on the payment table
 * (`addLines`), then `payment.entered`. Only the payment table is written, which the payment
 * holds: the real table's turn is not taken.
 */
const enterStep: RouteStep = async (env, target, payment, deps) => {
  const pos = await posOf(env, target, payment, deps)
  if (pos === null) {
    // Nothing was sent: no POS place for the table any more.
    await route(env, target, {
      type: 'payment.entered',
      outcome: 'refused',
      billRef: null,
      code: 'pos_table_missing',
    })
    return 'next'
  }
  if (pos.paused) throw new PaymentStepRetry('the connection is paused')
  const paymentTable = await paymentTableOf(env, target, payment)
  const entry = await enter(env, target, payment, pos, paymentTable)
  if (entry === 'later') {
    await queuePrepare(env, target, READ_BACK_SECONDS)
    return 'wait'
  }
  await route(env, target, { type: 'payment.entered', ...entry })
  return 'next'
}

/**
 * The entry, or `later` while one whose outcome is unknown may still land. After an earlier call,
 * the payment table's one bill is that call, landed, only when its lines are the round's
 * (`billIsRound`): a waiter's bill there is not the round. An earlier call not seen there past the
 * read-back window is unknown (it may land later, C52): never sent again, a manager is asked. A
 * first call is sent only to an empty payment table.
 */
async function enter(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  pos: PaymentPos,
  paymentTable: PosRef,
): Promise<Entry | 'later'> {
  const lines = await enterLinesOf(env, target, payment, pos)
  const round = lines === null ? null : await roundOf(env, target, lines.items)
  const landed = (bills: TableBills): Entry | null => {
    const [bill] = bills.bills
    if (bills.bills.length !== 1 || bill === undefined || round === null) return null
    const read = bill.lines.map((line) => ({
      item: line.item?.pos ?? null,
      quantity: line.quantity,
      amountMinor: line.amountMinor,
    }))
    return billIsRound(round, read)
      ? { outcome: 'entered', billRef: bill.ref.pos, code: null }
      : null
  }
  // The table is read before the calls so far: a run that sees a bill there sees the attempt of
  // the call that made it too (it is recorded before the call leaves).
  const before = await readPos(pos, paymentTable)
  const earlier = await callsOf(env, target, 'addLines')
  if (earlier !== null && earlier.outcome !== 'refused') {
    const found = landed(before)
    if (found !== null) return found
    if (mayStillLand(earlier, pos.timings)) return 'later'
    return { outcome: 'unknown', billRef: null, code: 'not_found' }
  }
  // A waiter's bill on the payment table: nothing is sent, the hold is released.
  if (before.bills.length > 0)
    return { outcome: 'refused', billRef: null, code: 'payment_table_busy' }
  if (lines === null) return { outcome: 'refused', billRef: null, code: 'item_not_on_pos' }
  if (lines.tableNoteDropped) {
    // Staff find the round on the payment table without the guest's table named (no guest text).
    env.log.warn(
      { paymentId: payment.id },
      'the table note fits on no line: the round goes without it',
    )
  }
  const { timezone, dayEndsAt } = lines.venue
  const ref = `${payment.id}-enter`
  const outcome = await writePos(env, target, pos, 'addLines', ref, () =>
    pos.connector.addLines(pos.context, {
      table: paymentTable,
      lines: lines.lines,
      ref,
      serviceDayStartsAt: serviceDayStartsAt(env.now(), timezone, dayEndsAt).toISOString(),
      excludeBills: [],
    }),
  )
  if (outcome.kind === 'done' && outcome.result.bill !== null) {
    return { outcome: 'entered', billRef: outcome.result.bill.pos, code: null }
  }
  if (outcome.kind === 'refused') {
    return { outcome: 'refused', billRef: null, code: outcome.refusal.code }
  }
  // Done with no bill named, or unknown: read it back now, and on the next runs for the window.
  return landed(await readPos(pos, paymentTable)) ?? 'later'
}

/**
 * The round as it was entered: each line's POS item (`items`, in the sent order's order), with the
 * quantity and the amount the payment keeps for it. Null where the two don't line up.
 */
async function roundOf(
  env: PaymentEnvironment,
  target: PaymentJob,
  items: readonly string[],
): Promise<RoundLine[] | null> {
  const lines = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({ quantity: paymentLines.quantity, amountMinor: paymentLines.posAmountMinor })
      .from(paymentLines)
      .where(eq(paymentLines.paymentId, target.paymentId))
      .orderBy(paymentLines.position),
  )
  if (lines.length !== items.length) return null
  return lines.map((line, index) => ({
    item: items[index] ?? '',
    quantity: line.quantity,
    amountMinor: line.amountMinor,
  }))
}

/**
 * The round's lines as the POS takes them, from the payment's sent order: its items' POS links,
 * and the guest's table as a note on the first line where notes reach the ticket. Null where an
 * item has no POS link (nothing is sent).
 */
async function enterLinesOf(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  pos: PaymentPos,
): Promise<{
  readonly lines: OrderLine[]
  /** Each line's POS item, in order: what the check matches the bill against. */
  readonly items: readonly string[]
  /** "For Table 7" was due on the ticket and fit on no line (`withTableNote`). */
  readonly tableNoteDropped: boolean
  readonly venue: { readonly timezone: string; readonly dayEndsAt: string }
} | null> {
  const sentOrderId = payment.sentOrderId
  const found = await placeOf(env, target, payment.tableId)
  if (sentOrderId === null || found === null) return null
  const read = await withTenant(env.pool, target.tenantId, async (tx) => {
    const [sent] = await tx
      .select({ lines: sentOrders.lines })
      .from(sentOrders)
      .where(eq(sentOrders.id, sentOrderId))
    const [venue] = await tx
      .select({
        timezone: venues.timezone,
        dayEndsAt: venues.serviceDayEndsAt,
        locale: venues.defaultLocale,
      })
      .from(venues)
      .where(eq(venues.id, target.venueId))
    const [table] = await tx
      .select({ name: venueTables.name, number: venueTables.number })
      .from(venueTables)
      .where(eq(venueTables.id, payment.tableId))
    if (sent === undefined || venue === undefined) return null
    const lines = sentOrderLinesOf(sent.lines)
    const nodeIds = [...new Set(lines.flatMap((line) => [line.itemId, ...line.optionIds]))]
    const links =
      nodeIds.length === 0
        ? []
        : await tx
            .select({ nodeId: sourceLinks.nodeId, externalId: sourceLinks.externalId })
            .from(sourceLinks)
            .where(
              and(
                eq(sourceLinks.integrationId, found.integration.id),
                inArray(sourceLinks.nodeId, nodeIds),
                eq(sourceLinks.state, 'active'),
              ),
            )
    const notes = await tx
      .select({ lineId: sentOrderNotes.lineId, note: sentOrderNotes.note })
      .from(sentOrderNotes)
      .where(eq(sentOrderNotes.sentOrderId, sentOrderId))
    return { lines, venue, table: table ?? null, links, notes }
  })
  if (read === null) return null
  const reach = pos.connector.capabilities.notesReachTicket
  const link = new Map(read.links.map((row) => [row.nodeId, row.externalId]))
  const notes = new Map(read.notes.map((row) => [row.lineId, row.note]))
  const lines: OrderLine[] = []
  for (const line of read.lines) {
    const mapped = toOrderLine(line, link, reach, notes)
    if (mapped === null) return null
    lines.push(mapped)
  }
  if (lines.length === 0) return null
  const items = lines.map((line) => line.item.pos)
  const label = read.table === null ? null : tableLabel(alertLocale(read.venue.locale), read.table)
  if (!reach || label === null) return { lines, items, tableNoteDropped: false, venue: read.venue }
  const noted = withTableNote(lines, payFirstTableNote(alertLocale(read.venue.locale), label))
  return {
    lines: noted,
    items,
    tableNoteDropped: noted.every((line, index) => line.note === lines[index]?.note),
    venue: read.venue,
  }
}

/** The longest note a POS line takes (`OrderLineSchema`). */
const NOTE_MAX = 200

/**
 * The round's lines with the guest's table ("for Table 7") on the first line it fits on, before
 * the guest's own note; never cutting the guest's text. Where it fits on no line, it is left out.
 */
export function withTableNote(lines: readonly OrderLine[], forTable: string): OrderLine[] {
  const noted = (note: string | null) => (note === null ? forTable : `${forTable} · ${note}`)
  const at = lines.findIndex((line) => noted(line.note).length <= NOTE_MAX)
  return lines.map((line, index) => (index === at ? { ...line, note: noted(line.note) } : line))
}

/** True when the payment table's bill is the one the pay-first entry opened, or that is unknown. */
async function enteredBill(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  bill: PosRef,
): Promise<boolean> {
  const sentOrderId = payment.sentOrderId
  if (sentOrderId === null) return true
  const [sent] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({ posBillRef: sentOrders.posBillRef })
      .from(sentOrders)
      .where(eq(sentOrders.id, sentOrderId)),
  )
  return sent?.posBillRef === null || sent?.posBillRef === undefined || sent.posBillRef === bill.pos
}

/**
 * D127's third proof of an unknown close, where the connector declares `readClosedBills`: the bill
 * the close was sent for, closed, for the amount, carrying the close's reference or a receipt
 * number (`closeProof`). The table's other closed bills are earlier payments': they prove nothing.
 * Null for everything else, a read that failed too: the close stays unknown. Never throws, so a
 * POS that can't be read never holds back asking a manager.
 */
async function closeProofOf(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  deps: PaymentJobDeps,
): Promise<{ readonly receiptNumber: string | null } | null> {
  if (payment.amountMinor === null) return null
  const { amountMinor } = payment
  try {
    const found = await placeOf(env, target, payment.tableId)
    if (found === null) return null
    if (found.integration.kind === 'sim') assertSimAllowed(deps.sim)
    const offered = (deps.connectorFor ?? serviceConnectorFor)(found.integration, deps.sim)
    if (!offered.capabilities.readClosedBills) return null
    const { attempt, rounds } = await withTenant(env.pool, target.tenantId, async (tx) => ({
      attempt: (
        await tx
          .select({ answer: paymentSteps.answer })
          .from(paymentSteps)
          .where(
            and(
              eq(paymentSteps.paymentId, target.paymentId),
              eq(paymentSteps.step, 'payAndClose'),
              eq(paymentSteps.outcome, 'attempting'),
            ),
          )
          .orderBy(desc(paymentSteps.seq))
          .limit(1)
      )[0],
      rounds: await tx
        .select({ id: sentOrders.id })
        .from(sentOrders)
        .where(eq(sentOrders.sittingId, payment.sittingId)),
    }))
    if (attempt?.answer === null || attempt?.answer === undefined) return null
    const pos = await posOf(env, target, payment, deps)
    const read = pos?.connector.readClosedBill
    if (pos === null || pos.paused || read === undefined) return null
    const handle = {
      ref: posRef(attempt.answer),
      table: await paymentTableOf(env, target, payment),
    }
    const answer = await bounded(pos.budget, pos.timings.readTimeoutMs, () =>
      read.call(pos.connector, pos.context, handle),
    )
    if (answer.kind !== 'answered') return null
    const parsed = readingSchema(ClosedBillSchema.nullable()).safeParse(answer.value)
    if (!parsed.success || !parsed.data.complete) return null
    return closeProof(parsed.data.value, {
      // What Restro puts on a POS line: a round's id, a pay-first round's or a tip's reference.
      refs: new Set([
        ...rounds.map((round) => round.id),
        `${payment.id}-enter`,
        `${payment.id}-close`,
      ]),
      amountMinor,
    })
  } catch (error) {
    env.log.warn({ paymentId: payment.id, err: error }, 'the closed bills could not be read')
    return null
  }
}

/**
 * `isolated` (or `checked` with no close attempted): the last check on a reading of the isolated
 * bill and a fresh one of the real table (`payment.checked`), then the close (`payAndClose`) with
 * the amount, the tip and the card payment type, then `payment.closed`. Once a close was
 * attempted, nothing but its proof closes it: an unknown is `unconfirmed` after D115's read-back
 * window (a later landing is not ruled out, C52) unless a closed bill proves it (`closeProofOf`).
 */
const checkAndClose: RouteStep = async (env, target, payment, deps) => {
  const close = payment.state === 'checked' ? await callsOf(env, target, 'payAndClose') : null
  if (close !== null && (close.outcome === 'done' || close.outcome === 'refused')) {
    // The close's answer is recorded but its state is not (a run that died between them, or a
    // route that was refused): the answer is the outcome (#112, F4). `done`, or the POS's "already
    // done", is proof; any other refusal is unconfirmed for a manager.
    const proof = close.outcome === 'done' || close.answer === 'already_done'
    await route(env, target, {
      type: 'payment.closed',
      outcome: proof ? 'done' : 'refused',
      code: close.outcome === 'refused' ? close.answer : null,
      // A `done` close's answer is its receipt number, when the POS gave one (R8).
      receiptNumber: close.outcome === 'done' ? close.answer : null,
      fiscalMemoryNumber: null,
    })
    return 'next'
  }
  if (close !== null) {
    // A close was attempted. Another run may still be inside it, its answer on the way (one
    // write's longest time), and a close with no answer may land late, inside the read-back
    // window (D115). Until both have passed the till may still change, so a manager is not asked
    // yet: one who sees no receipt and answers "No receipt" before a late close lands would
    // release the hold of a bill Restro closed. Past them, the outcome is unknown whatever the
    // tables show now; a manager is asked after D115's read-back window (a later landing is not
    // ruled out, C52).
    const timings = deps.timings ?? SERVICE_TIMINGS
    const inFlight = BUDGET_WAIT_MS + timings.writeTimeoutMs + LEASE_MARGIN_MS
    // Looked at often only while a run may still be inside the call (F5); otherwise once more
    // when the window ends.
    if (close.outcome === 'attempting' && close.lastAgeMs < inFlight) {
      await queuePrepare(env, target, WAIT_SECONDS)
      return 'wait'
    }
    const proof = await closeProofOf(env, target, payment, deps)
    if (proof !== null) {
      const { receiptNumber } = proof
      await route(env, target, {
        type: 'payment.closed',
        outcome: 'done',
        code: null,
        // A receipt number longer than Restro keeps is left out rather than cut.
        receiptNumber: receiptNumber !== null && receiptNumber.length <= 64 ? receiptNumber : null,
        fiscalMemoryNumber: null,
        step: { outcome: 'done', answer: null, idempotencyKey: `${payment.id}-close` },
      })
      return 'next'
    }
    const window = Math.max(inFlight, timings.readBackWindowMs)
    if (close.lastAgeMs < window) {
      await queuePrepare(env, target, Math.max(1, Math.ceil((window - close.lastAgeMs) / 1000)))
      return 'wait'
    }
    await route(env, target, {
      type: 'payment.closed',
      outcome: 'unknown',
      code: null,
      receiptNumber: null,
      fiscalMemoryNumber: null,
    })
    return 'next'
  }
  const pos = await posOf(env, target, payment, deps)
  if (pos === null) throw new PaymentStepRetry('the payment table has no POS any more')
  const paymentTable = await paymentTableOf(env, target, payment)
  const onTable = await readPos(pos, paymentTable)
  const [first] = onTable.bills
  const isolated: IsolatedHandle | null =
    first === undefined ? null : { ref: first.ref, table: paymentTable }
  let bill: PosBill | null = null
  if (isolated !== null && onTable.bills.length === 1) {
    const answer = await bounded(pos.budget, pos.timings.readTimeoutMs, () =>
      pos.connector.readIsolated(pos.context, isolated),
    )
    if (answer.kind !== 'answered') throw new PaymentStepRetry('the bill was not read in time')
    const parsed = readingSchema(IsolatedBillSchema).safeParse(answer.value)
    if (!parsed.success) throw new PaymentStepRetry('the reading did not have the expected shape')
    if (!parsed.data.complete) throw new PaymentStepRetry('the bill reading was not complete')
    bill = parsed.data.value.bill
  }
  // Two bills on a payment table: someone else's too. The check sees every line and fails.
  const lines = bill !== null ? bill.lines : onTable.bills.flatMap((b) => b.lines)
  // The real table is read only when the isolated lines fall short of the amount: only then may a
  // line have been voided, which lowers the amount on a fresh read that shows it gone. A bill not
  // short that misses a line has another in its place, and fails the check without it. (Every
  // read counts towards the POS's calls per second.)
  const found = sumSignedMinor([payment.tipMinor, ...lines.map((line) => line.amountMinor)])
  const short = payment.amountMinor === null || found < payment.amountMinor
  // A pay-first round was never on the real table: only the payment table's bill is checked.
  const onBill = payment.kind === 'on_bill'
  const real = onBill && isolated !== null && short ? linesOf(await readPos(pos, pos.table)) : []
  const provider = providerFor(env, target, deps, payment.providerKind)
  // The hold, read again right before the close: one cancelled or run out at the provider stops
  // the payment here, before a receipt is printed for a card that can't be charged.
  const account = await accountOf(env, target)
  const hold =
    account === null || account.accountRef === null || payment.providerPaymentRef === null
      ? null
      : await provider.readPayment(
          providerRef(account.accountRef),
          providerRef(payment.providerPaymentRef),
        )
  // A read that says nothing is tried again, a bounded number of times; then the check goes on with
  // no hold, and fails. It never reads as a hold gone or one still there (D125, D127 3.10).
  let heldMinor: number | null = null
  if (hold?.complete === true) {
    heldMinor = hold.value.status === 'held' ? hold.value.heldMinor : 0
  } else {
    const { details } = await route(env, target, { type: 'payment.hold_unread' })
    if (typeof details.tries !== 'number' || details.tries < HOLD_READ_TRIES) {
      throw new PaymentStepRetry('the hold could not be read')
    }
  }
  const reading =
    isolated === null
      ? null
      : {
          bills: onTable.bills.length,
          totalMinor: bill?.totalMinor ?? sumSignedMinor(onTable.bills.map((b) => b.totalMinor)),
          paidMinor:
            bill?.paidMinor ?? onTable.bills.reduce((sum, b) => addMinor(sum, b.paidMinor), 0),
          lines: lines.map((line) => ({
            quantity: line.quantity,
            amountMinor: line.amountMinor,
          })),
        }
  // A pay-first check names each bill line's POS item, and the round's, to tell the round from
  // someone else's bill (kept in the backend, rule 3).
  const roundItems =
    onBill || isolated === null
      ? null
      : ((await enterLinesOf(env, target, payment, pos))?.items ?? null)
  const partialCapture = provider.capabilities.partialCapture
  const checked = onBill
    ? await route(env, target, {
        type: 'payment.checked',
        isolated: reading,
        real,
        partialCapture,
        heldMinor,
      })
    : await route(env, target, {
        type: 'payment.pay_first_checked',
        // Another bill than the one the entry opened is not the round: the check fails.
        bill:
          reading === null ||
          (first !== undefined && !(await enteredBill(env, target, payment, first.ref)))
            ? null
            : {
                ...reading,
                lines: lines.map((line) => ({
                  item: line.item?.pos ?? null,
                  quantity: line.quantity,
                  amountMinor: line.amountMinor,
                })),
              },
        items: roundItems,
        partialCapture,
        heldMinor,
      })
  if (checked.state !== 'checked' || isolated === null) return 'next'

  const now = await paymentOf(env, target)
  if (now === null || now.state !== 'checked' || now.amountMinor === null) return 'next'
  const { amountMinor, tipMinor } = now
  // The guest's email goes into this one close, where the POS can issue an electronic receipt and
  // the receipt can reach the guest: the POS sends it itself, or it returns the file and Restro's
  // sender has it to send. Never past this function: held in memory, never logged (#186).
  const capabilities = pos.connector.capabilities
  const receiptEmail =
    now.receiptEmail !== null &&
    capabilities.electronicReceipt &&
    (!capabilities.electronicReceiptFile || (deps.receiptSender ?? null) !== null)
      ? now.receiptEmail
      : null
  const ref = `${payment.id}-close`
  const outcome = await writePos(
    env,
    target,
    pos,
    'payAndClose',
    ref,
    () =>
      pos.connector.payAndClose(pos.context, {
        isolated,
        amountMinor,
        tipMinor,
        // The card payment type: the connector picks its card type (no venue setting yet, #111).
        paymentType: null,
        ...(receiptEmail === null ? {} : { receiptEmail }),
        ref,
      }),
    null,
    false,
    isolated.ref.pos,
  )
  // What follows is the database and the receipt's email: the POS's other tables go on.
  deps.posTurn?.release()
  const proof =
    outcome.kind === 'done' ||
    (outcome.kind === 'refused' && outcome.refusal.code === 'already_done')
  if (outcome.kind === 'unknown') {
    // It may still land: the next runs wait out the read-back window above, then ask a manager.
    await queuePrepare(env, target, READ_BACK_SECONDS)
    return 'wait'
  }
  const receipt = outcome.kind === 'done' ? outcome.result.receiptNumber : null
  // A receipt number longer than Restro keeps is left out rather than cut.
  const receiptNumber = receipt !== null && receipt.length <= 64 ? receipt : null
  const answer = outcome.kind === 'refused' ? outcome.refusal.code : null
  try {
    // The close's answer and its state in one transaction, the receipt number with them (F4).
    await route(env, target, {
      type: 'payment.closed',
      outcome: proof ? 'done' : 'refused',
      code: answer,
      receiptNumber: proof ? receiptNumber : null,
      // The seam carries no fiscal memory number yet (#111 open question).
      fiscalMemoryNumber: null,
      step: { outcome: outcome.kind, answer, idempotencyKey: ref },
    })
  } catch (error) {
    // The answer is kept whatever became of its state: the next run goes on from it, with the
    // receipt number as a `done` close's answer (R8).
    await recordStep(
      env,
      target,
      'payAndClose',
      ref,
    )(outcome.kind, outcome.kind === 'done' ? receiptNumber : answer)
    throw error
  }
  await env.onStep?.({ step: 'payAndClose', outcome: outcome.kind })
  if (receiptEmail !== null && outcome.kind === 'done') {
    await handOffReceipt(env, target, payment, receiptEmail, outcome.result, deps)
  }
  return 'next'
}

/**
 * What became of the guest's electronic receipt after a done close (#186), recorded as the
 * `receiptEmail` step (a code, never the address): the POS sent it (`pos_sent`), Restro sent the
 * POS's file unchanged (`file_sent`), or no receipt reached the guest (`not_issued`,
 * `send_failed`), and the capture then raises "Bring the receipt" (#200). The address and the file
 * live in this call only: nothing here stores or logs them, and a failure logs a code. Never
 * throws: the payment goes on whatever became of the receipt.
 */
async function handOffReceipt(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  email: string,
  result: PayAndCloseResult,
  deps: PaymentJobDeps,
): Promise<void> {
  const step = recordStep(env, target, 'receiptEmail', `${payment.id}-receipt`)
  try {
    if (result.electronicReceipt === 'sent') {
      await step('done', 'pos_sent')
    } else if (
      result.electronicReceipt === 'file' &&
      result.receiptFile !== undefined &&
      deps.receiptSender != null
    ) {
      const [venue] = await withTenant(env.pool, target.tenantId, (tx) =>
        tx.select({ name: venues.name }).from(venues).where(eq(venues.id, target.venueId)),
      )
      const sent = await sendReceipt(env, payment.id, deps, {
        to: email,
        venueName: venue?.name ?? '',
        file: result.receiptFile,
        idempotencyKey: `${payment.id}-receipt`,
      })
      if (sent) await step('done', 'file_sent')
      else await step('refused', 'send_failed')
    } else {
      await step('refused', 'not_issued')
    }
  } catch (error) {
    // A step that could not be recorded: the capture brings paper. The text of an error here can
    // not hold the address (the sender's never does); only its name and status are kept.
    env.log.warn(
      { paymentId: payment.id, error: error instanceof Error ? error.name : 'error' },
      'the receipt email step failed',
    )
  }
}

/** Sends the receipt, again after a busy service; false once it cannot go. Logs codes only. */
async function sendReceipt(
  env: PaymentEnvironment,
  paymentId: string,
  deps: PaymentJobDeps,
  message: Parameters<EmailSender['sendReceipt']>[0],
): Promise<boolean> {
  const sender = deps.receiptSender
  if (sender == null) return false
  const delays = deps.receiptRetryDelaysMs ?? RECEIPT_RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      await sender.sendReceipt(message)
      return true
    } catch (error) {
      const known = error instanceof EmailSendError ? error : null
      const wait = delays[attempt]
      if (known?.retryable === true && wait !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, wait))
        continue
      }
      env.log.warn(
        { paymentId, status: known?.status ?? null, retryable: known?.retryable ?? false },
        'the receipt email was not sent',
      )
      return false
    }
  }
}

/**
 * `closed`, or `unconfirmed` with "Receipt printed": capture the closed amount with the payment's
 * key. An unknown capture is read back from the provider: captured is done; still held, it runs
 * again with a new key (`providerKey`, after `not_landed`); a read that tells nothing, again with
 * the same key; gone, the capture failed.
 */
const captureStep: RouteStep = async (env, target, payment, deps) => {
  const account = await accountOf(env, target)
  if (account === null || account.accountRef === null) {
    throw new PaymentStepRetry("the venue's account is gone while a hold stands")
  }
  if (payment.providerPaymentRef === null || payment.amountMinor === null) {
    throw new PaymentStepRetry('the payment has no hold to capture')
  }
  const provider = providerFor(env, target, deps, payment.providerKind)
  const accountRef = providerRef(account.accountRef)
  const paymentRef = providerRef(payment.providerPaymentRef)
  const idempotencyKey = await providerKey(env, target, 'capture')
  const step = recordStep(env, target, 'capture', idempotencyKey)
  await step('attempting')
  let outcome: Awaited<ReturnType<PaymentProvider['capture']>>
  try {
    outcome = await provider.capture({
      accountRef,
      paymentRef,
      amountMinor: payment.amountMinor,
      idempotencyKey,
    })
  } catch (error) {
    env.log.warn({ paymentId: payment.id, err: error }, 'the capture threw')
    outcome = { kind: 'unknown', reason: 'threw' }
  }
  // No paper receipt is brought where the guest's electronic one went out (#186, #200).
  const electronicReceipt = (await latestStep(env, target, 'receiptEmail'))?.outcome === 'done'
  if (outcome.kind === 'done') {
    await step('done')
    await route(env, target, {
      type: 'payment.captured',
      outcome: 'captured',
      capturedMinor: outcome.result.capturedMinor,
      code: null,
      electronicReceipt,
    })
    return 'next'
  }
  if (outcome.kind === 'refused' && outcome.refusal.code !== 'already_captured') {
    await step('refused', outcome.refusal.code)
    await route(env, target, {
      type: 'payment.captured',
      outcome: 'refused',
      capturedMinor: null,
      code: outcome.refusal.code,
    })
    return 'next'
  }
  // Unknown, or captured already: read back. Still held is tried again with a new key.
  const reading = await provider.readPayment(accountRef, paymentRef)
  const answer = landedAnswer(reading, (read) => read.status === 'captured')
  await step(
    outcome.kind === 'refused' ? 'refused' : 'unknown',
    outcome.kind === 'refused' ? outcome.refusal.code : answer,
  )
  if (reading.complete && reading.value.status === 'captured') {
    await route(env, target, {
      type: 'payment.captured',
      outcome: 'captured',
      capturedMinor: reading.value.capturedMinor,
      code: null,
      electronicReceipt,
    })
    return 'next'
  }
  // The hold is gone (it ran out, or the provider dropped it): no capture can land any more, with
  // this key or a new one. Tried again, a server error kept under the key would be answered
  // forever; the capture failed, and the owners are told, with the code a provider's refusal of
  // that capture gives: `hold_expired` once its capture deadline passed, `not_held` otherwise.
  if (answer === 'gone' && reading.complete) {
    await route(env, target, {
      type: 'payment.captured',
      outcome: 'refused',
      capturedMinor: null,
      code: ranOut(reading.value, env.now()) ? 'hold_expired' : 'not_held',
    })
    return 'next'
  }
  throw new PaymentStepRetry('the capture has an unknown outcome')
}

/**
 * `isolated` after a failed check, or `unconfirmed` with "No receipt": under the real table's
 * turn, put the lines back (`undoIsolate`), then `payment.undone`: returned, or stranded where the
 * POS would not, or (after "No receipt") not back where they are not proven on the real table.
 */
const undoStep: RouteStep = async (env, target, payment, deps) => {
  const pos = await posOf(env, target, payment, deps)
  if (pos === null) {
    await route(env, target, { type: 'payment.undone', outcome: 'stranded' })
    return 'next'
  }
  if (pos.paused) throw new PaymentStepRetry('the connection is paused')
  const paymentTable = await paymentTableOf(env, target, payment)
  const fence = await takeTurn(env, target)
  if (fence === null) {
    await queuePrepare(env, target, WAIT_SECONDS)
    return 'wait'
  }
  try {
    const outcome = await undo(env, target, payment, pos, paymentTable)
    if (outcome === 'later') {
      await queuePrepare(env, target, READ_BACK_SECONDS)
      return 'wait'
    }
    await route(env, target, { type: 'payment.undone', outcome })
    return 'next'
  } finally {
    await route(env, target, { type: 'payment.turn', release: fence })
  }
}

async function undo(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  pos: PaymentPos,
  paymentTable: PosRef,
): Promise<'returned' | 'stranded' | 'not_back' | 'later'> {
  const onTable = await readPos(pos, paymentTable)
  const earlier = await callsOf(env, target, 'undoIsolate')
  const own = await ownLines(env, target)
  // Only the payment's own bill goes back; a waiter's bill on the payment table stays there.
  const mine = billsToMoveBack(onTable, own)
  // Two bills that may each be the payment's: which one it moved can't be told. Staff move it.
  if (mine === null) return 'stranded'
  // A move back whose outcome is unknown may land late: inside the read-back window it is read
  // back, never sent again (D127 3.4, design §5.3).
  if (mine.length > 0 && earlier !== null && mayStillLand(earlier, pos.timings)) {
    return 'later'
  }
  // After "No receipt" a close was attempted, and it may land after the read-back window (C52):
  // the lines are back only when a fresh read shows every line read on the payment table before a
  // move back, this run's and those an earlier run recorded, on the real table by its POS
  // reference (#153). An empty payment table with nothing recorded, an earlier move back whose
  // lines were not recorded, or a bill closed under the move, is no proof (D127 3.10): a manager
  // is asked again.
  const proving = payment.reason === 'no_receipt'
  const recorded = proving ? await recordedLines(env, target) : []
  if (recorded === null) return 'not_back'
  const moved = [...recorded, ...linesOf({ ...onTable, bills: mine })]
  if (proving && moved.length === 0) return 'not_back'
  for (const [index, bill] of mine.entries()) {
    const ref = `${payment.id}-undo${index === 0 ? '' : `-${index}`}`
    const isolated: IsolatedHandle = { ref: bill.ref, table: paymentTable }
    const lines = PaymentStepLinesSchema.safeParse(linesOf({ ...onTable, bills: [bill] }))
    const outcome = await writePos(
      env,
      target,
      pos,
      'undoIsolate',
      ref,
      () => pos.connector.undoIsolate(pos.context, { isolated, table: pos.table, ref }),
      lines.success ? lines.data : null,
    )
    if (outcome.kind === 'refused') {
      if (outcome.refusal.code === 'bill_closed') {
        // The payment's own bill closed is no proof (#155, finding 5).
        if (proving) return 'not_back'
        continue
      }
      // A waiter holding the bill, or the POS busy, passes: tried again for the read-back window
      // from the first move back, then the lines are stranded for staff.
      const passing = outcome.refusal.code === 'bill_locked' || outcome.refusal.code === 'busy'
      const since = earlier?.firstAgeMs ?? 0
      return passing && since < pos.timings.readBackWindowMs ? 'later' : 'stranded'
    }
    if (outcome.kind === 'unknown') {
      const back = await readPos(pos, paymentTable)
      if (back.bills.some((b) => b.ref.pos === bill.ref.pos)) return 'later'
    }
  }
  if (!proving) return 'returned'
  return (await backOnTable(pos, moved)) ? 'returned' : 'not_back'
}

/** The payment's own lines, as `ownBill` compares them. */
async function ownLines(env: PaymentEnvironment, target: PaymentJob) {
  const rows = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({
        pos: paymentLines.posLineRef,
        quantity: paymentLines.quantity,
        amountMinor: paymentLines.posAmountMinor,
      })
      .from(paymentLines)
      .where(eq(paymentLines.paymentId, target.paymentId)),
  )
  return rows
}

/**
 * True when a bill on the payment table may be the payment's own: a line with one of its POS
 * refs, or with one of its quantities and amounts, or no line at all. Whether a line keeps its ref
 * across tables is not stated by the POS's docs, so a bill that may be its own is taken as its own
 * (fail safe: a manager is asked again).
 */
function ownBill(
  bill: TableBills['bills'][number],
  own: readonly {
    readonly pos: string | null
    readonly quantity: string
    readonly amountMinor: number
  }[],
): boolean {
  if (bill.lines.length === 0 || own.length === 0) return true
  return bill.lines.some((line) =>
    own.some(
      (mine) =>
        mine.pos === line.ref.pos ||
        (quantityKey(mine.quantity) === quantityKey(line.quantity) &&
          mine.amountMinor === line.amountMinor),
    ),
  )
}

/** True when each line of a bill, and at least one, is one of the payment's own lines. */
function wholeOwnBill(
  bill: TableBills['bills'][number],
  own: readonly {
    readonly pos: string | null
    readonly quantity: string
    readonly amountMinor: number
  }[],
): boolean {
  const left = [...own]
  for (const line of bill.lines) {
    const mine = left.findIndex(
      (candidate) =>
        candidate.pos === line.ref.pos ||
        (quantityKey(candidate.quantity) === quantityKey(line.quantity) &&
          candidate.amountMinor === line.amountMinor),
    )
    if (mine < 0) return false
    left.splice(mine, 1)
  }
  return bill.lines.length > 0
}

/**
 * The bills on the payment table a move back takes: those that may be the payment's own. Of several,
 * the one that holds the payment's lines and nothing else; null where that names no single bill.
 */
function billsToMoveBack(
  table: TableBills,
  own: readonly {
    readonly pos: string | null
    readonly quantity: string
    readonly amountMinor: number
  }[],
): TableBills['bills'] | null {
  const mine = table.bills.filter((bill) => ownBill(bill, own))
  if (mine.length <= 1) return mine
  const whole = mine.filter((bill) => wholeOwnBill(bill, own))
  return whole.length === 1 ? whole : null
}

/**
 * The lines earlier runs read on the payment table before a move back (`undoIsolate`'s
 * `attempting` rows), or null when one of those moves has none recorded (or none that parse):
 * what it took is unknown, so nothing proves it back.
 */
async function recordedLines(
  env: PaymentEnvironment,
  target: PaymentJob,
): Promise<PaymentStepLines | null> {
  const rows = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({ lines: paymentSteps.lines })
      .from(paymentSteps)
      .where(
        and(
          eq(paymentSteps.paymentId, target.paymentId),
          eq(paymentSteps.step, 'undoIsolate'),
          eq(paymentSteps.outcome, 'attempting'),
        ),
      )
      .orderBy(paymentSteps.seq),
  )
  const lines: PaymentStepLines[number][] = []
  for (const row of rows) {
    const parsed = PaymentStepLinesSchema.safeParse(row.lines)
    if (!parsed.success) return null
    lines.push(...parsed.data)
  }
  return lines
}

/**
 * True when a fresh read of the real table shows every line moved back by its POS reference,
 * with at least the quantity and the amount moved (#153). Never by item, quantity or amount alone:
 * a waiter's identical round, or the rest of a line split for the payment, would read as back.
 */
async function backOnTable(pos: PaymentPos, moved: PaymentStepLines): Promise<boolean> {
  if (moved.length === 0) return false
  const real = new Map(linesOf(await readPos(pos, pos.table)).map((line) => [line.pos, line]))
  return moved.every((line) => {
    const found = real.get(line.pos)
    if (found === undefined) return false
    // As much or more, by sign: a discount line's amount (or a negative count) only as negative.
    const atLeast = (have: bigint, moved: bigint) => (moved < 0n ? have <= moved : have >= moved)
    return (
      atLeast(BigInt(found.amountMinor), BigInt(line.amountMinor)) &&
      atLeast(quantityKey(found.quantity), quantityKey(line.quantity))
    )
  })
}

/**
 * A payment that is over (not unconfirmed) and still owns its payment table: free it once a read
 * shows the table empty. Not empty (stranded lines, say): it waits for staff, and the next
 * payment's queue step frees it once it reads empty.
 */
const freeStep: RouteStep = async (env, target, payment, deps) => {
  const pos = await posOf(env, target, payment, deps)
  if (pos === null || pos.paused) return 'wait'
  const paymentTable = await paymentTableOf(env, target, payment)
  if ((await readPos(pos, paymentTable)).bills.length > 0) return 'wait'
  await route(env, target, { type: 'payment.table_freed' })
  return 'next'
}

/** A step of the old shape (price, hold, cancel), run as a route step. */
const stepOf =
  (
    step: (
      env: PaymentEnvironment,
      target: PaymentJob,
      payment: PaymentRow,
      deps: PaymentJobDeps,
    ) => Promise<void>,
  ): RouteStep =>
  async (...args) => {
    await step(...args)
    return 'next'
  }

/** Where a payment stands, as the route reads it. */
type RouteState = Pick<PaymentRow, 'state' | 'reason' | 'paymentTableId' | 'kind'>

/** True when the worker has a step to take for the payment (the recovery's question, #112). */
export function hasNextStep(payment: RouteState): boolean {
  return routeStep(payment) !== null
}

/** The step a payment takes next, or null where it waits for the guest, staff or nothing. */
function routeStep(payment: RouteState): RouteStep | null {
  const { state, reason } = payment
  if (state === 'requested') return stepOf(price)
  if (state === 'priced') return stepOf(hold)
  if (state === 'cancelling') return stepOf(cancel)
  if ((state === 'held' || state === 'queued') && payment.paymentTableId === null) {
    return queueStep
  }
  if (state === 'queued') return payment.kind === 'pay_first' ? enterStep : isolateStep
  if (state === 'isolated' && reason === 'check_failed') return undoStep
  if (state === 'isolated' || state === 'entered' || state === 'checked') return checkAndClose
  if (state === 'closed') return captureStep
  if (state === 'unconfirmed' && reason === 'receipt_printed') return captureStep
  // A pay-first round has no lines to put back: "No receipt" cancels it (`cancelling`).
  if (state === 'unconfirmed' && reason === 'no_receipt' && payment.kind === 'on_bill') {
    return undoStep
  }
  if (state !== 'unconfirmed' && isFinalPaymentState(state) && payment.paymentTableId !== null) {
    return freeStep
  }
  return null
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A provider payment that holds nothing and never will. */
function isOver(
  payment: ProviderPayment,
): payment is ProviderPayment & { readonly status: 'released' | 'failed' } {
  return payment.status === 'released' || payment.status === 'failed'
}

/**
 * A released hold whose capture deadline has passed by the worker's clock: the provider dropped it
 * as it ran out. The provider's read names no reason, so a clock a little off only picks
 * `not_held` for `hold_expired` near the deadline; the payment ends `capture_failed` either way.
 */
function ranOut(payment: ProviderPayment, now: Date): boolean {
  return (
    payment.status === 'released' &&
    payment.captureBefore !== null &&
    now.getTime() >= Date.parse(payment.captureBefore)
  )
}

/** The provider shows the hold gone: `payment.expired` (it changes nothing where it may not). */
async function expire(env: PaymentEnvironment, target: PaymentJob, status: 'released' | 'failed') {
  const expired = await apply(env, target, {
    type: 'payment.expired',
    paymentId: target.paymentId,
    status,
  })
  if (expired.code !== null) {
    env.log.warn({ paymentId: target.paymentId, code: expired.code }, 'an expiry was refused')
  }
  return expired
}

/** Queues the check of `target` in `afterMs`, under the deadline's own key. */
async function queueDeadlineCheck(env: PaymentEnvironment, target: PaymentJob, afterMs: number) {
  const job = prepareJob(JOB_NAMES.paymentCheck, target)
  await env.queue.send(JOB_NAMES.paymentCheck, job.data, {
    singletonKey: `${job.singletonKey}:deadline`,
    // In the payment's own group: a deadline never runs beside another check of the payment.
    ...(job.group === undefined ? {} : { group: job.group }),
    startAfter: Math.max(1, Math.ceil(afterMs / 1000)),
  })
}

/** Queues the payment's next prepare step, at once or after `afterSeconds`. */
export async function queuePrepare(env: PaymentEnvironment, target: PaymentJob, afterSeconds = 0) {
  const job = prepareJob(JOB_NAMES.paymentPrepare, target)
  await env.queue.send(JOB_NAMES.paymentPrepare, job.data, {
    singletonKey: job.singletonKey,
    ...(job.group === undefined ? {} : { group: job.group }),
    ...(afterSeconds > 0 ? { startAfter: afterSeconds } : {}),
  })
}

/**
 * Moves a payment on as far as it goes without the guest: price, hold, or cancel. Throws
 * `PaymentStepRetry` when a step concluded nothing.
 */
export async function preparePayment(
  env: PaymentEnvironment,
  target: PaymentJob,
  deps: PaymentJobDeps,
): Promise<PaymentRunOutcome> {
  let last: string | null = null
  const started = env.now().getTime()
  for (let steps = 0; steps < PREPARE_STEPS; steps += 1) {
    // Past the run's deadline: the next run goes on from here.
    if (env.now().getTime() - started >= PAYMENT_RUN_MS) {
      await queuePrepare(env, target)
      break
    }
    const payment = await paymentOf(env, target)
    if (payment === null) return { kind: 'missing' }
    // A step that left the payment where it was is done for this run.
    const where = `${payment.state}:${payment.reason}:${payment.paymentTableId}`
    if (where === last) return { kind: 'at', state: payment.state }
    last = where
    const step = routeStep(payment)
    if (step === null) return { kind: 'at', state: payment.state }
    const posTurn = new PosTurn(deps.budgets ?? SHARED_BUDGETS)
    let done: StepDone
    try {
      done = await step(env, target, payment, { ...deps, posTurn })
    } finally {
      posTurn.release()
    }
    if (done === 'wait') {
      // Where the step left it (a held payment that waits is queued now).
      const after = await paymentOf(env, target)
      return after === null ? { kind: 'missing' } : { kind: 'at', state: after.state }
    }
  }
  const payment = await paymentOf(env, target)
  return payment === null ? { kind: 'missing' } : { kind: 'at', state: payment.state }
}

/**
 * Reads the provider's payment while the guest is at the card form and records it
 * (`payment.check`); queues the cancel when a deadline passed, or the next check at the deadline.
 */
export async function checkPayment(
  env: PaymentEnvironment,
  target: PaymentJob,
  deps: PaymentJobDeps,
): Promise<PaymentRunOutcome> {
  const payment = await paymentOf(env, target)
  if (payment === null) return { kind: 'missing' }
  if (payment.state === 'cancelling') {
    await queuePrepare(env, target)
    return { kind: 'at', state: payment.state }
  }
  // A held payment waiting for a table or a manager's answer: its hold may run out (#112, R4).
  const waiting =
    (payment.state === 'held' || payment.state === 'queued') && payment.paymentTableId === null
  const asking =
    payment.state === 'unconfirmed' &&
    (PAYMENT_UNCONFIRMED_REASONS as readonly (string | null)[]).includes(payment.reason)
  if ((waiting || asking) && payment.providerPaymentRef !== null) {
    return expiryCheck(env, target, payment, deps, payment.providerPaymentRef)
  }
  if (payment.state !== 'awaiting_guest' || payment.providerPaymentRef === null) {
    return { kind: 'at', state: payment.state }
  }
  const account = await accountOf(env, target)
  if (account === null || account.accountRef === null) {
    throw new PaymentStepRetry("the venue's account is gone while a hold may stand")
  }
  const provider = providerFor(env, target, deps, payment.providerKind)
  const reading = await provider.readPayment(
    providerRef(account.accountRef),
    providerRef(payment.providerPaymentRef),
  )
  if (!reading.complete) throw new PaymentStepRetry("the provider's payment could not be read")
  const read = reading.value
  const checked = await apply(env, target, {
    type: 'payment.check',
    paymentId: target.paymentId,
    reading: {
      ref: read.ref.provider,
      status: read.status,
      needsGuestAction: read.needsGuestAction,
      currency: read.currency,
      amountMinor: read.amountMinor,
      heldMinor: read.heldMinor,
      captureBefore: read.captureBefore,
      threeDs: read.threeDs,
      authorisationCode: read.authorisationCode,
    },
  })
  if (checked.state === 'cancelling' || checked.state === 'held') {
    // Held: the route takes it on from here (#111).
    await queuePrepare(env, target)
    return { kind: 'at', state: checked.state }
  }
  if (checked.state === 'awaiting_guest') {
    const now = await paymentOf(env, target)
    const deadline = now?.confirmBy ?? now?.sessionEndsAt ?? null
    if (deadline !== null) {
      await queueDeadlineCheck(env, target, deadline.getTime() - env.now().getTime())
    }
  }
  return { kind: 'at', state: checked.state ?? payment.state }
}

/**
 * Reads a waiting payment's hold back from the provider: gone (it ran out, or the provider dropped
 * it) settles the payment `released`, reason `expired`, and its open questions close; the prepare
 * step then frees its payment table. Still held changes nothing.
 */
async function expiryCheck(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  deps: PaymentJobDeps,
  paymentRef: string,
): Promise<PaymentRunOutcome> {
  const account = await accountOf(env, target)
  if (account === null || account.accountRef === null) {
    throw new PaymentStepRetry("the venue's account is gone while a hold may stand")
  }
  const provider = providerFor(env, target, deps, payment.providerKind)
  const read = await provider.readPayment(providerRef(account.accountRef), providerRef(paymentRef))
  if (!read.complete) throw new PaymentStepRetry("the provider's payment could not be read")
  if (!isOver(read.value)) return { kind: 'at', state: payment.state }
  const expired = await expire(env, target, read.value.status)
  if (expired.details.changed === true) await queuePrepare(env, target)
  const after = await paymentOf(env, target)
  return after === null ? { kind: 'missing' } : { kind: 'at', state: after.state }
}

/** The payment jobs: prepare and check, each one run at a time per payment. */
export function createPaymentJobs(deps: PaymentJobDeps): JobDefinition[] {
  const queue = {
    // A step that concluded nothing is tried again soon; the phone's poll queues it too.
    retryLimit: 5,
    retryDelay: 2,
    retryBackoff: true,
    expireInSeconds: 60,
    retentionSeconds: 60 * 60,
    deleteAfterSeconds: 24 * 60 * 60,
  }
  const run =
    (name: string, step: typeof preparePayment) =>
    async (jobs: Job<PaymentJob>[], context: WorkerContext) => {
      for (const job of jobs) {
        const parsed = PaymentJobSchema.safeParse(job.data)
        if (!parsed.success) throw new Error(`the ${name} job has an invalid payload`)
        const outcome = await step(
          {
            pool: context.pool,
            log: context.log,
            now: context.now,
            queue: context.queue,
            jobId: `${name}-${job.id}`,
          },
          parsed.data,
          deps,
        )
        context.log.debug({ paymentId: parsed.data.paymentId, outcome }, name)
      }
    }
  const prepare = defineJob<PaymentJob>({
    name: JOB_NAMES.paymentPrepare,
    options: {
      policy: 'stately',
      // Never failed (and run again beside itself) while a run is still going.
      queue: { ...queue, expireInSeconds: PAYMENT_PREPARE_EXPIRE_SECONDS },
      work: {
        pollingIntervalSeconds: 1,
        localConcurrency: ROUTE_RUNS_AT_ONCE,
        groupConcurrency: 1,
      },
    },
    handler: run(JOB_NAMES.paymentPrepare, preparePayment),
  })
  const check = defineJob<PaymentJob>({
    name: JOB_NAMES.paymentCheck,
    options: {
      policy: 'stately',
      queue,
      work: {
        pollingIntervalSeconds: 1,
        localConcurrency: ROUTE_RUNS_AT_ONCE,
        groupConcurrency: 1,
      },
    },
    handler: run(JOB_NAMES.paymentCheck, checkPayment),
  })
  return [prepare, check] as JobDefinition[]
}
