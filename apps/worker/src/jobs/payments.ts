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
//   sent again inside it (D127 3.4); an unknown close is never read back as a close (an empty
//   payment table is no proof): it is `unconfirmed` for a manager or owner. A close is sent once.
//   An unknown capture is read back from the provider and tried again with the same key.
// - One run of a payment at a time: a run takes no new step past `PAYMENT_RUN_MS` and queues the
//   next, and pg-boss gives it longer than that and one step (`PAYMENT_PREPARE_EXPIRE_SECONDS`)
//   before it fails it and runs it again. Should two runs meet anyway, the real table's turn is
//   the payment's until its lease passes, and a close in flight is waited for, not taken for lost.

import {
  addMinor,
  CURRENCIES,
  type Currency,
  IsolatedBillSchema,
  type IsolatedHandle,
  JOB_NAMES,
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
  type TableBills,
  TableBillsSchema,
  type WriteOutcome,
} from '@restro/core'
import {
  applyService,
  BUDGET_WAIT_MS,
  isFinalPaymentState,
  LEASE_MARGIN_MS,
  PAYMENT_CONFIRM_MS,
  PAYMENT_LONG_WAIT_MS,
  type PAYMENT_STEP_NAMES,
  PAYMENT_WRITE_PAUSE_MS,
  READ_BACK_EVERY_MS,
} from '@restro/core/service'
import {
  type DbPool,
  integrations,
  locks,
  paymentAccounts,
  paymentLines,
  paymentSteps,
  payments,
  places,
  venues,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { Job } from 'pg-boss'

import type { SimPolicy } from '../config'
import type { PaymentProviders } from '../connectors'
import type { Logger } from '../logger'
import { assertSimAllowed, serviceConnectorFor, serviceContext } from '../service-connectors'
import type { Limiter } from '../sync/limiter'
import { type Bounded, bounded } from './connection'
import { connectionPaused, type InstanceBudgets, SHARED_BUDGETS } from './floor'
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

/**
 * The longest one route step takes for these timings: the last check's three POS reads and the
 * hold's read at the provider, the pause and the close, each POS call with its turn at the budget.
 */
export function paymentStepMs(timings: ServiceTimings = SERVICE_TIMINGS): number {
  const read = BUDGET_WAIT_MS + timings.readTimeoutMs
  const write = BUDGET_WAIT_MS + timings.writeTimeoutMs
  return 3 * read + PROVIDER_CALL_MS + PAYMENT_WRITE_PAUSE_MS + write
}

/**
 * How long pg-boss lets one prepare run go before it fails it and runs it again: past the run's
 * deadline and one step begun just before it, with a margin (as `order-send`'s five minutes).
 */
export const PAYMENT_PREPARE_EXPIRE_SECONDS = 5 * 60

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
}

export interface PaymentEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
  readonly queue: JobQueue
  readonly jobId: string
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
} | null> {
  const [account] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({
        providerKind: paymentAccounts.providerKind,
        accountRef: paymentAccounts.accountRef,
        state: paymentAccounts.state,
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
    })
    if (recorded.code !== null) throw new PaymentStepRetry(`the ${step} step was not recorded`)
  }
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

/** What a read of the provider says about a write whose outcome is unknown. */
function landedAnswer(
  reading: Awaited<ReturnType<PaymentProvider['readPayment']>>,
  landed: (payment: ProviderPayment) => boolean,
): 'landed' | 'not_landed' | 'unknown' {
  if (!reading.complete) return 'unknown'
  if (landed(reading.value)) return 'landed'
  return reading.value.status === 'held' ? 'not_landed' : 'unknown'
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

/** `requested`: read the table fresh and price the payment (`payment.price`). */
async function price(
  env: PaymentEnvironment,
  target: PaymentJob,
  payment: PaymentRow,
  deps: PaymentJobDeps,
): Promise<void> {
  const pos = await posOf(env, target, payment, deps)
  const provider = providerOf(deps, payment.providerKind)
  const currency = currencyOf(payment)

  let lines: { pos: string; quantity: string; amountMinor: number }[] = []
  let tipAllowed = false
  if (pos !== null) {
    if (pos.paused) throw new PaymentStepRetry('the connection is paused')
    lines = linesOf(await readPos(pos, pos.table))
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
  if (account.state === 'lost_access') {
    await settle('paying_paused')
    return
  }
  if (account.state !== 'connected') {
    await settle('paying_not_offered')
    return
  }
  const provider = providerOf(deps, payment.providerKind)
  const amountMinor = payment.amountMinor
  if (amountMinor === null || amountMinor <= 0) {
    await settle('below_minimum')
    return
  }
  const idempotencyKey = `${payment.id}:hold`
  const step = recordStep(env, target, 'createHold', idempotencyKey)
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
    // A call that threw may have reached the provider: the same key settles it on the retry.
    await step('unknown', 'threw')
    env.log.warn({ paymentId: payment.id, err: error }, 'the hold could not be made')
    throw new PaymentStepRetry('the hold could not be made')
  }
  if (outcome.kind === 'unknown') {
    await step('unknown', 'unknown')
    throw new PaymentStepRetry('the hold has an unknown outcome')
  }
  if (outcome.kind === 'refused') {
    const code = outcome.refusal.code
    await step('refused', code)
    await settle(
      code === 'amount_too_small'
        ? 'below_minimum'
        : ACCOUNT_REFUSALS.includes(code)
          ? 'paying_paused'
          : 'hold_refused',
    )
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
  const account = await accountOf(env, target)
  // No account, no hold: `createHold` needs the account.
  if (account === null || account.accountRef === null) {
    if (payment.providerPaymentRef === null) {
      await settle()
      return
    }
    throw new PaymentStepRetry("the venue's account is gone while a hold may stand")
  }
  const provider = providerOf(deps, payment.providerKind)
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
    // Nothing Restro may do about it (it never refunds): the payment stays `cancelling` for
    // #112's recovery to read back until the provider drops the hold.
    env.log.error(
      { paymentId: payment.id, code: outcome.refusal.code },
      'the provider refused to release a payment Restro cancelled',
    )
    return
  }
  await step('done')
  await settle()
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
  const timings = deps.timings ?? SERVICE_TIMINGS
  return {
    connector: (deps.connectorFor ?? serviceConnectorFor)(integration, deps.sim),
    budget: (deps.budgets ?? SHARED_BUDGETS).forInstance(integration.id),
    table: posRef(place.placeId),
    paused: await connectionPaused(env.pool, target.tenantId, integration.id),
    timings,
    context: serviceContext(env.now, timings),
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

/**
 * One POS write of the route. It is recorded `attempting` inside the instance's turn, right before
 * the call, so a write that never left is never counted (a close that never left is no close).
 * Late or thrown after it left: `unknown`.
 */
async function writePos<R>(
  env: PaymentEnvironment,
  target: PaymentJob,
  pos: PaymentPos,
  step: 'isolateLines' | 'undoIsolate' | 'payAndClose',
  ref: string,
  call: () => Promise<WriteOutcome<R>>,
): Promise<WriteOutcome<R>> {
  await pos.pause()
  const record = recordStep(env, target, step, ref)
  let attempted = false
  let answer: Bounded<WriteOutcome<R>>
  try {
    answer = await bounded(pos.budget, pos.timings.writeTimeoutMs, async () => {
      // A close is sent once: another run of this payment that got its turn first has sent it.
      if (step === 'payAndClose' && (await callsOf(env, target, step)) !== null) {
        throw new PaymentStepRetry('the close was attempted already')
      }
      await record('attempting')
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
  if (outcome.kind === 'done') await record('done')
  else if (outcome.kind === 'refused') await record('refused', outcome.refusal.code)
  else await record('unknown', 'unknown')
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
  step: 'isolateLines' | 'undoIsolate' | 'payAndClose',
): Promise<StepCalls | null> {
  const left = sql`${paymentSteps.outcome} = 'attempting'`
  const [row] = await withTenant(env.pool, target.tenantId, (tx) =>
    tx
      .select({
        outcome: sql<
          string | null
        >`(array_agg(${paymentSteps.outcome} order by ${paymentSteps.seq} desc))[1]`,
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
  // payment table itself, and every read counts towards the POS's calls per second.)
  const earlier = await callsOf(env, target, 'isolateLines')
  const landed = async () => (await readPos(pos, paymentTable)).bills.length > 0
  if (earlier !== null) {
    if (await landed()) return MOVED
    if (mayStillLand(earlier, pos.timings)) return 'later'
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

/**
 * `isolated` (or `checked` with no close attempted): the last check on a reading of the isolated
 * bill and a fresh one of the real table (`payment.checked`), then the close (`payAndClose`) with
 * the amount, the tip and the card payment type, then `payment.closed`. Once a close was
 * attempted, nothing but its proof closes it: an unknown is `unconfirmed`.
 */
const checkAndClose: RouteStep = async (env, target, payment, deps) => {
  const close = payment.state === 'checked' ? await callsOf(env, target, 'payAndClose') : null
  if (close !== null) {
    // A close was attempted. Another run may still be inside it, its answer on the way: it has
    // one write's longest time. Past that, the run that sent it died inside the close, and its
    // outcome is unknown whatever the tables show now.
    const timings = deps.timings ?? SERVICE_TIMINGS
    if (close.lastAgeMs < BUDGET_WAIT_MS + timings.writeTimeoutMs + LEASE_MARGIN_MS) {
      await queuePrepare(env, target, WAIT_SECONDS)
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
  const found = lines.reduce((sum, line) => addMinor(sum, line.amountMinor), payment.tipMinor)
  const short = payment.amountMinor === null || found < payment.amountMinor
  const real = isolated !== null && short ? linesOf(await readPos(pos, pos.table)) : []
  const provider = providerOf(deps, payment.providerKind)
  // The hold, read again right before the close: one cancelled or run out at the provider stops
  // the payment here, before a receipt is printed for a card that can't be charged.
  const account = await accountOf(env, target)
  if (account === null || account.accountRef === null || payment.providerPaymentRef === null) {
    throw new PaymentStepRetry("the payment's hold can't be read")
  }
  const hold = await provider.readPayment(
    providerRef(account.accountRef),
    providerRef(payment.providerPaymentRef),
  )
  if (!hold.complete) throw new PaymentStepRetry('the hold could not be read')
  const checked = await route(env, target, {
    type: 'payment.checked',
    isolated:
      isolated === null
        ? null
        : {
            bills: onTable.bills.length,
            totalMinor:
              bill?.totalMinor ?? onTable.bills.reduce((sum, b) => addMinor(sum, b.totalMinor), 0),
            paidMinor:
              bill?.paidMinor ?? onTable.bills.reduce((sum, b) => addMinor(sum, b.paidMinor), 0),
            lines: lines.map((line) => ({
              quantity: line.quantity,
              amountMinor: line.amountMinor,
            })),
          },
    real,
    partialCapture: provider.capabilities.partialCapture,
    heldMinor: hold.value.status === 'held' ? hold.value.heldMinor : 0,
  })
  if (checked.state !== 'checked' || isolated === null) return 'next'

  const now = await paymentOf(env, target)
  if (now === null || now.state !== 'checked' || now.amountMinor === null) return 'next'
  const { amountMinor, tipMinor } = now
  const ref = `${payment.id}-close`
  const outcome = await writePos(env, target, pos, 'payAndClose', ref, () =>
    pos.connector.payAndClose(pos.context, {
      isolated,
      amountMinor,
      tipMinor,
      // The card payment type: the connector picks its card type (no venue setting yet, #111).
      paymentType: null,
      ref,
    }),
  )
  const proof =
    outcome.kind === 'done' ||
    (outcome.kind === 'refused' && outcome.refusal.code === 'already_done')
  const receipt = outcome.kind === 'done' ? outcome.result.receiptNumber : null
  // A receipt number longer than Restro keeps is left out rather than cut.
  const receiptNumber = receipt !== null && receipt.length <= 64 ? receipt : null
  await route(env, target, {
    type: 'payment.closed',
    outcome: proof ? 'done' : outcome.kind === 'refused' ? 'refused' : 'unknown',
    code: outcome.kind === 'refused' ? outcome.refusal.code : null,
    receiptNumber: proof ? receiptNumber : null,
    // The seam carries no fiscal memory number yet (#111 open question).
    fiscalMemoryNumber: null,
  })
  return 'next'
}

/**
 * `closed`, or `unconfirmed` with "Receipt printed": capture the closed amount with the payment's
 * key. An unknown capture is read back from the provider; still held, it runs again with the key.
 */
const captureStep: RouteStep = async (env, target, payment, deps) => {
  const account = await accountOf(env, target)
  if (account === null || account.accountRef === null) {
    throw new PaymentStepRetry("the venue's account is gone while a hold stands")
  }
  if (payment.providerPaymentRef === null || payment.amountMinor === null) {
    throw new PaymentStepRetry('the payment has no hold to capture')
  }
  const provider = providerOf(deps, payment.providerKind)
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
  if (outcome.kind === 'done') {
    await step('done')
    await route(env, target, {
      type: 'payment.captured',
      outcome: 'captured',
      capturedMinor: outcome.result.capturedMinor,
      code: null,
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
  await step(
    outcome.kind === 'refused' ? 'refused' : 'unknown',
    outcome.kind === 'refused'
      ? outcome.refusal.code
      : landedAnswer(reading, (read) => read.status === 'captured'),
  )
  if (reading.complete && reading.value.status === 'captured') {
    await route(env, target, {
      type: 'payment.captured',
      outcome: 'captured',
      capturedMinor: reading.value.capturedMinor,
      code: null,
    })
    return 'next'
  }
  throw new PaymentStepRetry('the capture has an unknown outcome')
}

/**
 * `isolated` after a failed check, or `unconfirmed` with "No receipt": under the real table's
 * turn, put the lines back (`undoIsolate`), then `payment.undone`: returned, or stranded where the
 * POS would not.
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
): Promise<'returned' | 'stranded' | 'later'> {
  const onTable = await readPos(pos, paymentTable)
  const earlier = await callsOf(env, target, 'undoIsolate')
  // A move back whose outcome is unknown may land late: inside the read-back window it is read
  // back, never sent again (D127 3.4, design §5.3).
  if (onTable.bills.length > 0 && earlier !== null && mayStillLand(earlier, pos.timings)) {
    return 'later'
  }
  for (const [index, bill] of onTable.bills.entries()) {
    const ref = `${payment.id}-undo${index === 0 ? '' : `-${index}`}`
    const isolated: IsolatedHandle = { ref: bill.ref, table: paymentTable }
    const outcome = await writePos(env, target, pos, 'undoIsolate', ref, () =>
      pos.connector.undoIsolate(pos.context, { isolated, table: pos.table, ref }),
    )
    if (outcome.kind === 'refused') {
      if (outcome.refusal.code === 'bill_closed') continue
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
  return 'returned'
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

/** The step a payment takes next, or null where it waits for the guest, staff or nothing. */
function routeStep(payment: PaymentRow): RouteStep | null {
  const { state, reason } = payment
  if (state === 'requested') return stepOf(price)
  if (state === 'priced') return stepOf(hold)
  if (state === 'cancelling') return stepOf(cancel)
  if ((state === 'held' || state === 'queued') && payment.paymentTableId === null) {
    return queueStep
  }
  if (state === 'queued') return isolateStep
  if (state === 'isolated' && reason === 'check_failed') return undoStep
  if (state === 'isolated' || state === 'checked') return checkAndClose
  if (state === 'closed') return captureStep
  if (state === 'unconfirmed' && reason === 'receipt_printed') return captureStep
  if (state === 'unconfirmed' && reason === 'no_receipt') return undoStep
  if (state !== 'unconfirmed' && isFinalPaymentState(state) && payment.paymentTableId !== null) {
    return freeStep
  }
  return null
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A provider payment that holds nothing and never will. */
function isOver(payment: ProviderPayment): boolean {
  return payment.status === 'released' || payment.status === 'failed'
}

/** Queues the check of `target` in `afterMs`, under the deadline's own key. */
async function queueDeadlineCheck(env: PaymentEnvironment, target: PaymentJob, afterMs: number) {
  const job = prepareJob(JOB_NAMES.paymentCheck, target)
  await env.queue.send(JOB_NAMES.paymentCheck, job.data, {
    singletonKey: `${job.singletonKey}:deadline`,
    startAfter: Math.max(1, Math.ceil(afterMs / 1000)),
  })
}

/** Queues the payment's next prepare step, at once or after `afterSeconds`. */
async function queuePrepare(env: PaymentEnvironment, target: PaymentJob, afterSeconds = 0) {
  const job = prepareJob(JOB_NAMES.paymentPrepare, target)
  await env.queue.send(JOB_NAMES.paymentPrepare, job.data, {
    singletonKey: job.singletonKey,
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
    if ((await step(env, target, payment, deps)) === 'wait') {
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
  if (payment.state !== 'awaiting_guest' || payment.providerPaymentRef === null) {
    return { kind: 'at', state: payment.state }
  }
  const account = await accountOf(env, target)
  if (account === null || account.accountRef === null) {
    throw new PaymentStepRetry("the venue's account is gone while a hold may stand")
  }
  const provider = providerOf(deps, payment.providerKind)
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
      work: { pollingIntervalSeconds: 1 },
    },
    handler: run(JOB_NAMES.paymentPrepare, preparePayment),
  })
  const check = defineJob<PaymentJob>({
    name: JOB_NAMES.paymentCheck,
    options: { policy: 'stately', queue, work: { pollingIntervalSeconds: 1 } },
    handler: run(JOB_NAMES.paymentCheck, checkPayment),
  })
  return [prepare, check] as JobDefinition[]
}
