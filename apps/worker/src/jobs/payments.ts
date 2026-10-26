// The payment jobs (#110; D127 §Where things run, 3.1, 3.9; design §4, §5.1 steps 2–4, §6).
//
//   payment-prepare  move one payment on: price it from a fresh reading of its table (`requested`),
//                    make the provider's hold (`priced`), or cancel it (`cancelling`)
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

import {
  CURRENCIES,
  type Currency,
  JOB_NAMES,
  PaymentIdSchema,
  type PaymentJob,
  PaymentJobSchema,
  type PaymentProvider,
  type ProviderPayment,
  posRef,
  prepareJob,
  providerRef,
  readingSchema,
  type ServiceReader,
  TableBillsSchema,
} from '@restro/core'
import { applyService, PAYMENT_CONFIRM_MS } from '@restro/core/service'
import {
  type DbPool,
  integrations,
  paymentAccounts,
  payments,
  places,
  venues,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, eq, ne } from 'drizzle-orm'
import type { Job } from 'pg-boss'

import type { SimPolicy } from '../config'
import type { PaymentProviders } from '../connectors'
import type { Logger } from '../logger'
import { assertSimAllowed, serviceConnectorFor, serviceContext } from '../service-connectors'
import { connectionPaused, type InstanceBudgets, SHARED_BUDGETS } from './floor'
import { defineJob, type JobDefinition, type JobQueue, type WorkerContext } from './types'

export type { PaymentProviders }

/** A step that concluded nothing: pg-boss runs the job again. Never carries a provider value. */
export class PaymentStepRetry extends Error {
  override name = 'PaymentStepRetry'
}

/** The provider's refusals of a hold that mean the venue's account can't take payments now. */
const ACCOUNT_REFUSALS: readonly string[] = ['access_lost', 'account_restricted']

/** The most steps one prepare run takes (requested → priced → awaiting_guest, or a cancel). */
const PREPARE_STEPS = 4

export interface PaymentJobDeps {
  readonly sim: SimPolicy
  readonly providers: PaymentProviders
  readonly budgets?: InstanceBudgets
  /** Builds the connector of an instance; tests pass their own. */
  readonly connectorFor?: typeof serviceConnectorFor
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
): Promise<{ readonly state: string | null; readonly code: string | null }> {
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
    return { state: null, code: result.code }
  }
  const state = result.details.state
  return { state: typeof state === 'string' ? state : null, code: null }
}

/** Records one provider step (D127 3.9): `attempting` before the call, the outcome after. */
function recordStep(
  env: PaymentEnvironment,
  target: PaymentJob,
  step: 'createHold' | 'findByPaymentId' | 'release',
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
  const found = await withTenant(env.pool, target.tenantId, async (tx) => {
    const [place] = await tx
      .select({ integrationId: places.integrationId, placeId: places.placeId })
      .from(places)
      .where(and(eq(places.tableId, payment.tableId), ne(places.state, 'deleted')))
    if (place === undefined) return null
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.id, place.integrationId))
    return integration === undefined || integration.removedAt !== null
      ? null
      : { place, integration }
  })
  const provider = providerOf(deps, payment.providerKind)
  const currency = currencyOf(payment)

  let lines: { pos: string; quantity: string; amountMinor: number }[] = []
  let tipAllowed = false
  if (found !== null) {
    const { integration, place } = found
    if (integration.kind === 'sim') assertSimAllowed(deps.sim)
    const connector: ServiceReader = (deps.connectorFor ?? serviceConnectorFor)(
      integration,
      deps.sim,
    )
    if (await connectionPaused(env.pool, target.tenantId, integration.id)) {
      throw new PaymentStepRetry('the connection is paused')
    }
    const budget = (deps.budgets ?? SHARED_BUDGETS).forInstance(integration.id)
    const answer = await budget.run(() =>
      connector.readTable(serviceContext(env.now), posRef(place.placeId)),
    )
    const parsed = readingSchema(TableBillsSchema).safeParse(answer)
    if (!parsed.success) throw new PaymentStepRetry('the reading did not have the expected shape')
    // An incomplete reading concludes nothing (rule 6): not even that a line went.
    if (!parsed.data.complete) throw new PaymentStepRetry('the table reading was not complete')
    lines = parsed.data.value.bills.flatMap((bill) =>
      bill.lines.map((line) => ({
        pos: line.ref.pos,
        quantity: line.quantity,
        amountMinor: line.amountMinor,
      })),
    )
    tipAllowed = connector.capabilities.recordTipOnClose
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
  const idempotencyKey = `${payment.id}:release`
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
    await step('unknown', 'threw')
    env.log.warn({ paymentId: payment.id, err: error }, 'the hold could not be released')
    throw new PaymentStepRetry('the hold could not be released')
  }
  if (outcome.kind === 'unknown') {
    await step('unknown', 'unknown')
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

/** Queues the payment's next prepare step. */
async function queuePrepare(env: PaymentEnvironment, target: PaymentJob) {
  const job = prepareJob(JOB_NAMES.paymentPrepare, target)
  await env.queue.send(JOB_NAMES.paymentPrepare, job.data, { singletonKey: job.singletonKey })
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
  for (let steps = 0; steps < PREPARE_STEPS; steps += 1) {
    const payment = await paymentOf(env, target)
    if (payment === null) return { kind: 'missing' }
    // A step that left the state where it was is done for this run.
    if (payment.state === last) return { kind: 'at', state: payment.state }
    last = payment.state
    if (payment.state === 'requested') await price(env, target, payment, deps)
    else if (payment.state === 'priced') await hold(env, target, payment, deps)
    else if (payment.state === 'cancelling') await cancel(env, target, payment, deps)
    else return { kind: 'at', state: payment.state }
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
  if (checked.state === 'cancelling') {
    await queuePrepare(env, target)
    return { kind: 'at', state: 'cancelling' }
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
    options: { policy: 'stately', queue, work: { pollingIntervalSeconds: 1 } },
    handler: run(JOB_NAMES.paymentPrepare, preparePayment),
  })
  const check = defineJob<PaymentJob>({
    name: JOB_NAMES.paymentCheck,
    options: { policy: 'stately', queue, work: { pollingIntervalSeconds: 1 } },
    handler: run(JOB_NAMES.paymentCheck, checkPayment),
  })
  return [prepare, check] as JobDefinition[]
}
