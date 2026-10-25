// The checks of the payment conformance suite (D127 6.2, design §10; ticket #103). Each check
// switches the harness's faults off, makes its own payments under new `py_` ids, runs one
// behaviour and returns the problems it found, so the suite can also be tested on a provider that
// is wrong on purpose. Every answer is parsed with the seam's schemas, and the provider's own
// ledger is asked after each step whether money moved: only `capture` may move it.

import { newId, type PaymentId } from '../../../ids'
import { addMinor, subtractMinor } from '../../../money'
import type { Reading } from '../../service/schemas'
import { paymentCapabilitiesProblems } from '../capabilities'
import type { PaymentWriteOutcome } from '../provider'
import { type ProviderRef, sameProviderRef } from '../provider-ref'
import {
  type CreateHoldResult,
  PAYMENT_ANSWER_SCHEMAS,
  type PaymentRefusalCode,
  type ProviderPayment,
  type ProviderPaymentStatus,
} from '../schemas'
import { providerOperationProblems } from './guard'
import type { FaultStep, GuestPayment, PaymentHarness } from './harness'

export type PaymentCheck = (harness: PaymentHarness) => Promise<string[]>

/** Ends a check early; its problems are already recorded. */
class Abort extends Error {}

/** One run of a check: the harness, the problems so far, and the steps with their parsing. */
class Run {
  readonly problems: string[] = []

  constructor(readonly h: PaymentHarness) {}

  get account(): ProviderRef {
    return this.h.account
  }

  /** An amount comfortably above the provider's minimum. */
  get amount(): number {
    return addMinor(this.h.provider.capabilities.minimumMinor(this.h.currency), 1_000)
  }

  expect(condition: boolean, message: string): void {
    if (!condition) this.problems.push(message)
  }

  fail(message: string): never {
    this.problems.push(message)
    throw new Abort(message)
  }

  parse<K extends keyof typeof PAYMENT_ANSWER_SCHEMAS>(step: K, answer: unknown) {
    const parsed = PAYMENT_ANSWER_SCHEMAS[step].safeParse(answer)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => issue.message).join('; ')
      this.fail(`${step} answered a malformed value: ${issues}`)
    }
    return parsed.data as ReturnType<(typeof PAYMENT_ANSWER_SCHEMAS)[K]['parse']>
  }

  done<R>(label: string, outcome: PaymentWriteOutcome<R>): R {
    if (outcome.kind !== 'done') this.fail(`${label} answered ${describe(outcome)}, not done`)
    return outcome.result
  }

  refused<R>(
    label: string,
    outcome: PaymentWriteOutcome<R>,
    codes: readonly PaymentRefusalCode[] | 'any',
  ): void {
    if (outcome.kind !== 'refused') {
      this.fail(`${label} answered ${describe(outcome)}, not refused`)
    }
    if (codes !== 'any' && !codes.includes(outcome.refusal.code)) {
      this.problems.push(
        `${label} was refused as ${outcome.refusal.code}, not ${codes.join(' or ')}`,
      )
    }
  }

  unknown<R>(label: string, outcome: PaymentWriteOutcome<R>): void {
    if (outcome.kind !== 'unknown') {
      this.fail(
        `${label} answered ${describe(outcome)}, not unknown (a timeout is never a yes or a no)`,
      )
    }
  }

  complete<T>(label: string, reading: Reading<T>): T {
    if (!reading.complete) this.fail(`${label} was incomplete: ${reading.reason}`)
    return reading.value
  }

  async moved(): Promise<number> {
    return this.h.movedMinor()
  }

  /** Asks the ledger whether money moved since `before`; `expected` is what may have moved. */
  async expectMoved(label: string, before: number, expected = 0): Promise<void> {
    const moved = subtractOrNegative(await this.moved(), before)
    this.expect(
      moved === expected,
      `${label}: ${moved} minor units moved on the account, expected ${expected}`,
    )
  }

  async create(
    paymentId: PaymentId,
    amountMinor = this.amount,
    idempotencyKey = `${paymentId}:hold`,
  ): Promise<PaymentWriteOutcome<CreateHoldResult>> {
    const answer = await this.h.provider.createHold({
      paymentId,
      accountRef: this.account,
      amountMinor,
      currency: this.h.currency,
      idempotencyKey,
      description: 'Conformance Bar, table 7',
    })
    return this.parse('createHold', answer) as PaymentWriteOutcome<CreateHoldResult>
  }

  async find(paymentId: PaymentId): Promise<Reading<ProviderPayment | null>> {
    return this.parse(
      'findByPaymentId',
      await this.h.provider.findByPaymentId(this.account, paymentId),
    )
  }

  async read(paymentRef: ProviderRef): Promise<Reading<ProviderPayment>> {
    return this.parse('readPayment', await this.h.provider.readPayment(this.account, paymentRef))
  }

  /** Reads the payment and checks its status (and, where given, what was captured). */
  async expectPayment(
    label: string,
    paymentRef: ProviderRef,
    status: ProviderPaymentStatus,
    capturedMinor = 0,
  ): Promise<ProviderPayment> {
    const payment = this.complete(`${label}: the read-back`, await this.read(paymentRef))
    this.expect(
      payment.status === status,
      `${label}: the payment is ${payment.status}, not ${status}`,
    )
    this.expect(
      payment.capturedMinor === capturedMinor,
      `${label}: ${payment.capturedMinor} is captured, expected ${capturedMinor}`,
    )
    return payment
  }

  async capture(
    paymentRef: ProviderRef,
    amountMinor: number,
    idempotencyKey: string,
  ): Promise<PaymentWriteOutcome<ProviderPayment>> {
    const answer = await this.h.provider.capture({
      accountRef: this.account,
      paymentRef,
      amountMinor,
      idempotencyKey,
    })
    return this.parse('capture', answer) as PaymentWriteOutcome<ProviderPayment>
  }

  async release(
    paymentRef: ProviderRef,
    idempotencyKey: string,
  ): Promise<PaymentWriteOutcome<ProviderPayment>> {
    const answer = await this.h.provider.release({
      accountRef: this.account,
      paymentRef,
      idempotencyKey,
    })
    return this.parse('release', answer) as PaymentWriteOutcome<ProviderPayment>
  }

  /** A new hold the guest has not paid yet. */
  async awaiting(): Promise<{ paymentId: PaymentId; guest: GuestPayment }> {
    const paymentId = newId('py')
    const created = this.done('createHold', await this.create(paymentId))
    return {
      paymentId,
      guest: { accountRef: this.account, paymentRef: created.paymentRef, form: created.form },
    }
  }

  /** A new hold the guest has paid: `held` for `amount`. */
  async held(): Promise<{ paymentId: PaymentId; ref: ProviderRef }> {
    const { paymentId, guest } = await this.awaiting()
    await this.h.guest.pay(guest)
    const payment = await this.expectPayment('the paid hold', guest.paymentRef, 'held')
    this.expect(
      payment.heldMinor === this.amount,
      `the hold holds ${payment.heldMinor}, not ${this.amount}`,
    )
    return { paymentId, ref: guest.paymentRef }
  }
}

function describe(outcome: PaymentWriteOutcome<unknown>): string {
  if (outcome.kind === 'refused') return `refused (${outcome.refusal.code})`
  return outcome.kind
}

/** `a - b`, or a negative number where money went back (which no step may do). */
function subtractOrNegative(a: number, b: number): number {
  return a >= b ? subtractMinor(a, b) : -subtractMinor(b, a)
}

function check(body: (run: Run) => Promise<void>): PaymentCheck {
  return async (harness) => {
    await harness.reset()
    const run = new Run(harness)
    try {
      await body(run)
    } catch (error) {
      if (!(error instanceof Abort)) throw error
    }
    return run.problems
  }
}

/** A fault the harness offers, or the run fails (the suite registers a todo instead). */
function fault<T>(run: Run, value: T | undefined, name: string): T {
  if (value === undefined) run.fail(`the harness cannot ${name}`)
  return value
}

// ---------------------------------------------------------------------------------------------
// The interface

export async function operationsCheck(harness: PaymentHarness): Promise<string[]> {
  return providerOperationProblems(harness.provider)
}

export async function capabilitiesCheck(harness: PaymentHarness): Promise<string[]> {
  const problems = paymentCapabilitiesProblems(harness.provider.capabilities)
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(harness.provider.kind)) {
    problems.push(
      `the kind ${harness.provider.kind} is not a lower-case word (payments.provider_kind)`,
    )
  }
  return problems
}

/** Connecting, reading the connection and registering a domain move no money. */
export const connectionCheck = check(async (run) => {
  const before = await run.moved()
  const started = run.parse(
    'startConnection',
    await run.h.provider.startConnection({
      venueId: newId('vn'),
      accountRef: null,
      returnUrl: `https://${run.h.guestHost}/admin/settings/paying?connected=1`,
      refreshUrl: `https://${run.h.guestHost}/admin/settings/paying?retry=1`,
      idempotencyKey: `${newId('vn')}:connect`,
    }),
  )
  run.done('startConnection', started)
  const status = run.complete(
    'readConnection',
    run.parse('readConnection', await run.h.provider.readConnection(run.account)),
  )
  run.expect(status.canTakePayments, 'the harness account cannot take payments')
  const domain = run.parse(
    'prepareDomain',
    await run.h.provider.prepareDomain({
      accountRef: run.account,
      host: run.h.guestHost,
      idempotencyKey: `${newId('vn')}:domain`,
    }),
  )
  if (run.h.provider.capabilities.wallets.length > 0) run.done('prepareDomain', domain)
  else if (domain.kind === 'refused') run.refused('prepareDomain', domain, ['not_supported'])
  await run.expectMoved('connecting', before)
})

/**
 * An account that has not finished connecting gets a fresh link for the same account: the owner
 * who left the hosted form half-way must be able to come back to it.
 */
export const reconnectCheck = check(async (run) => {
  const before = await run.moved()
  const venueId = newId('vn')
  const connect = async (accountRef: ProviderRef | null, attempt: number) =>
    run.parse(
      'startConnection',
      await run.h.provider.startConnection({
        venueId,
        accountRef,
        returnUrl: `https://${run.h.guestHost}/admin/settings/paying?connected=1`,
        refreshUrl: `https://${run.h.guestHost}/admin/settings/paying?retry=1`,
        idempotencyKey: `${venueId}:connect:${attempt}`,
      }),
    )
  const first = run.done('startConnection', await connect(null, 1))
  const status = run.complete(
    'readConnection',
    run.parse('readConnection', await run.h.provider.readConnection(first.accountRef)),
  )
  run.expect(!status.canTakePayments, 'an account that just started connecting takes payments')
  run.expect(status.missing.length > 0, 'an unfinished account names nothing it still needs')
  const again = run.done('startConnection', await connect(first.accountRef, 2))
  run.expect(
    sameProviderRef(again.accountRef, first.accountRef),
    'a fresh link for an unfinished account names another account',
  )
  await run.expectMoved('reconnecting', before)
})

// ---------------------------------------------------------------------------------------------
// Paying

/** A hold is created, found by our id and read by its ref; the guest's card holds it. */
export const holdCheck = check(async (run) => {
  const before = await run.moved()
  const { paymentId, guest } = await run.awaiting()
  const found = run.complete('findByPaymentId', await run.find(paymentId))
  if (found === null) return run.fail('a created hold is not found by our payment id')
  run.expect(sameProviderRef(found.ref, guest.paymentRef), 'the hold is found under another ref')
  run.expect(found.paymentId === paymentId, 'the hold carries another payment id')
  run.expect(found.status === 'awaiting_guest', `a new hold is ${found.status}, not awaiting_guest`)
  run.expect(
    found.amountMinor === run.amount,
    `a new hold is for ${found.amountMinor}, not ${run.amount}`,
  )
  run.expect(found.currency === run.h.currency, `a new hold is in ${found.currency}`)
  await run.h.guest.pay(guest)
  const held = await run.expectPayment('after the guest paid', guest.paymentRef, 'held')
  run.expect(held.heldMinor === run.amount, `the hold holds ${held.heldMinor}, not ${run.amount}`)
  run.expect(held.captureBefore !== null, 'a held payment says when the hold runs out')
  await run.expectMoved('holding', before)
})

/** Below the provider's minimum, a hold is refused and nothing is made. */
export const minimumCheck = check(async (run) => {
  const minimum = run.h.provider.capabilities.minimumMinor(run.h.currency)
  if (minimum === 1) return
  const paymentId = newId('py')
  run.refused('a hold below the minimum', await run.create(paymentId, subtractMinor(minimum, 1)), [
    'amount_too_small',
  ])
  run.expect(
    run.complete('findByPaymentId', await run.find(paymentId)) === null,
    'a refused hold left a payment behind',
  )
})

/** The same key makes one hold, and answers it again. */
export const idempotentCreateCheck = check(async (run) => {
  const paymentId = newId('py')
  const first = run.done('the first create', await run.create(paymentId))
  const second = run.done('the same create again', await run.create(paymentId))
  run.expect(
    sameProviderRef(first.paymentRef, second.paymentRef),
    'the same idempotency key made a second payment',
  )
  const found = run.complete('findByPaymentId', await run.find(paymentId))
  run.expect(
    found !== null && sameProviderRef(found.ref, first.paymentRef),
    'the read-back finds another payment than the one created',
  )
})

/** The same capture key captures once, and answers the capture again. */
export const idempotentCaptureCheck = check(async (run) => {
  const { paymentId, ref } = await run.held()
  const before = await run.moved()
  const key = `${paymentId}:capture`
  const first = run.done('the capture', await run.capture(ref, run.amount, key))
  const again = run.done('the same capture again', await run.capture(ref, run.amount, key))
  run.expect(first.capturedMinor === run.amount, `the capture took ${first.capturedMinor}`)
  run.expect(
    again.capturedMinor === run.amount,
    `the repeated capture answers ${again.capturedMinor}`,
  )
  await run.expectPayment('after two captures with one key', ref, 'captured', run.amount)
  await run.expectMoved('two captures with one key', before, run.amount)
})

/** Only one capture: a second key is refused, and so is a release after it. */
export const oneCaptureCheck = check(async (run) => {
  const { paymentId, ref } = await run.held()
  const before = await run.moved()
  run.done('the capture', await run.capture(ref, run.amount, `${paymentId}:capture`))
  run.refused(
    'a second capture under another key',
    await run.capture(ref, run.amount, `${paymentId}:capture-2`),
    ['already_captured'],
  )
  run.refused('a release after the capture', await run.release(ref, `${paymentId}:release`), [
    'already_captured',
  ])
  await run.expectPayment('after the refused second capture', ref, 'captured', run.amount)
  await run.expectMoved('one capture', before, run.amount)
})

/**
 * A capture never goes above the hold; a smaller one takes that much and releases the rest
 * (where `partialCapture` is declared; otherwise it is refused and the hold stays).
 */
export const partialCaptureCheck = check(async (run) => {
  const { paymentId, ref } = await run.held()
  const before = await run.moved()
  run.refused(
    'a capture above the hold',
    await run.capture(ref, addMinor(run.amount, 1), `${paymentId}:capture-above`),
    ['amount_above_hold'],
  )
  await run.expectPayment('after a capture above the hold', ref, 'held')
  const part = subtractMinor(run.amount, 300)
  const outcome = await run.capture(ref, part, `${paymentId}:capture-part`)
  if (!run.h.provider.capabilities.partialCapture) {
    run.refused('a partial capture', outcome, ['partial_not_supported'])
    await run.expectPayment('after a refused partial capture', ref, 'held')
    await run.expectMoved('a refused partial capture', before)
    return
  }
  const captured = run.done('a partial capture', outcome)
  run.expect(captured.capturedMinor === part, `the partial capture took ${captured.capturedMinor}`)
  const payment = await run.expectPayment('after a partial capture', ref, 'captured', part)
  run.expect(payment.heldMinor === 0, 'the rest of a partially captured hold is still held')
  run.refused('a capture of the rest', await run.capture(ref, 300, `${paymentId}:capture-rest`), [
    'already_captured',
  ])
  await run.expectMoved('a partial capture', before, part)
})

/** A release ends a hold, paid or not, moves nothing, answers again by key, and blocks capture. */
export const releaseCheck = check(async (run) => {
  const before = await run.moved()
  const { paymentId, ref } = await run.held()
  const key = `${paymentId}:release`
  const released = run.done('the release', await run.release(ref, key))
  run.expect(released.status === 'released', `a released hold answers ${released.status}`)
  run.done('the same release again', await run.release(ref, key))
  const payment = await run.expectPayment('after the release', ref, 'released')
  run.expect(payment.heldMinor === 0, 'a released hold still holds money')
  run.refused(
    'a capture after the release',
    await run.capture(ref, run.amount, `${paymentId}:capture`),
    ['not_held'],
  )
  const unpaid = await run.awaiting()
  run.done(
    'releasing a hold the guest never paid',
    await run.release(unpaid.guest.paymentRef, `${unpaid.paymentId}:release`),
  )
  await run.expectPayment('the unpaid hold, released', unpaid.guest.paymentRef, 'released')
  await run.expectMoved('releasing', before)
})

/** No step but `capture` moves money; a capture moves exactly what it captured. */
export const moneyOnlyByCaptureCheck = check(async (run) => {
  let before = await run.moved()
  const { paymentId, guest } = await run.awaiting()
  await run.expectMoved('createHold', before)
  before = await run.moved()
  run.complete('findByPaymentId', await run.find(paymentId))
  run.complete('readPayment', await run.read(guest.paymentRef))
  run.complete(
    'readConnection',
    run.parse('readConnection', await run.h.provider.readConnection(run.account)),
  )
  await run.expectMoved('the reads', before)
  before = await run.moved()
  await run.h.guest.pay(guest)
  await run.expectMoved('the guest paying (a hold)', before)
  before = await run.moved()
  run.done('the capture', await run.capture(guest.paymentRef, run.amount, `${paymentId}:capture`))
  await run.expectMoved('the capture', before, run.amount)
})

// ---------------------------------------------------------------------------------------------
// Faults: timeouts are read back, refusals change nothing, a stored error is replayed

/** The write of `step` on a fresh payment (held first where the step needs it), by key. */
interface Prepared {
  readonly paymentId: PaymentId
  readonly ref: ProviderRef | null
  write(key?: string): Promise<PaymentWriteOutcome<unknown>>
}

async function prepare(run: Run, step: FaultStep): Promise<Prepared> {
  if (step === 'createHold') {
    const paymentId = newId('py')
    return {
      paymentId,
      ref: null,
      write: (key = `${paymentId}:hold`) => run.create(paymentId, run.amount, key),
    }
  }
  const { paymentId, ref } = await run.held()
  return {
    paymentId,
    ref,
    write:
      step === 'capture'
        ? (key = `${paymentId}:capture`) => run.capture(ref, run.amount, key)
        : (key = `${paymentId}:release`) => run.release(ref, key),
  }
}

/** Where the step lands: the status a payment reads afterwards, and what it moved. */
function landed(run: Run, step: FaultStep): { status: ProviderPaymentStatus; captured: number } {
  if (step === 'createHold') return { status: 'awaiting_guest', captured: 0 }
  if (step === 'capture') return { status: 'captured', captured: run.amount }
  return { status: 'released', captured: 0 }
}

/** A write that landed and then timed out is `unknown`; the read-back shows it; the key repeats it. */
export function landedTimeoutCheck(step: FaultStep): PaymentCheck {
  return check(async (run) => {
    const before = await run.moved()
    const target = await prepare(run, step)
    fault(run, run.h.faults.landThenTimeOut, 'time out after landing')(step)
    run.unknown(`${step} timing out after it landed`, await target.write())
    const expected = landed(run, step)
    const ref = await readBack(run, step, target.paymentId, target.ref, true)
    await run.expectPayment(
      `${step} read back after the timeout`,
      ref,
      expected.status,
      expected.captured,
    )
    const again = run.done(`${step} again with the same key`, await target.write())
    if (step === 'createHold') {
      run.expect(
        sameProviderRef((again as CreateHoldResult).paymentRef, ref),
        'the retried create made a second payment',
      )
    }
    await run.expectPayment(`${step} after the retry`, ref, expected.status, expected.captured)
    await run.expectMoved(
      `${step} timing out after it landed, then retried`,
      before,
      expected.captured,
    )
  })
}

/** A write that timed out before it landed is `unknown`; the read-back shows nothing done. */
export function lostTimeoutCheck(step: FaultStep): PaymentCheck {
  return check(async (run) => {
    const before = await run.moved()
    const target = await prepare(run, step)
    fault(run, run.h.faults.timeOutBeforeLanding, 'time out before landing')(step)
    run.unknown(`${step} timing out before it landed`, await target.write())
    if (step === 'createHold') {
      const found = run.complete('findByPaymentId', await run.find(target.paymentId))
      run.expect(found === null, 'a create that never landed left a payment')
    } else if (target.ref !== null) {
      await run.expectPayment(`${step} read back after the timeout`, target.ref, 'held')
    }
    await run.expectMoved(`${step} timing out before it landed`, before)
    run.done(`${step} again with the same key`, await target.write())
    const expected = landed(run, step)
    const ref = await readBack(run, step, target.paymentId, target.ref, true)
    await run.expectPayment(`${step} after the retry`, ref, expected.status, expected.captured)
    await run.expectMoved(`${step} retried`, before, expected.captured)
  })
}

/** A refused write changes nothing. */
export function refusedCheck(step: FaultStep): PaymentCheck {
  return check(async (run) => {
    const before = await run.moved()
    const target = await prepare(run, step)
    fault(run, run.h.faults.refuseNext, 'refuse a call')(step)
    run.refused(`${step} refused by the provider`, await target.write(), 'any')
    if (step === 'createHold') {
      const found = run.complete('findByPaymentId', await run.find(target.paymentId))
      run.expect(found === null, 'a refused create left a payment')
    } else if (target.ref !== null) {
      const payment = await run.expectPayment(`after the refused ${step}`, target.ref, 'held')
      run.expect(payment.heldMinor === run.amount, `after the refused ${step} the hold changed`)
    }
    await run.expectMoved(`a refused ${step}`, before)
  })
}

/** A server error stored for the key is answered again for it: `unknown` both times, done once at most. */
export function storedErrorCheck(step: FaultStep): PaymentCheck {
  return check(async (run) => {
    const before = await run.moved()
    const target = await prepare(run, step)
    fault(run, run.h.faults.storeServerError, 'store a server error')(step)
    run.unknown(`${step} failing with a server error`, await target.write())
    run.unknown(`${step} repeated under the same key`, await target.write())
    if (step === 'createHold') {
      run.complete('findByPaymentId', await run.find(target.paymentId))
      await run.expectMoved('a create failing with a stored error', before)
      return
    }
    if (target.ref === null) return
    const payment = run.complete('the read-back', await run.read(target.ref))
    const allowed: readonly ProviderPaymentStatus[] = ['held', landed(run, step).status]
    run.expect(
      allowed.includes(payment.status),
      `after a stored error the payment is ${payment.status}`,
    )
    await run.expectMoved(`a ${step} failing with a stored error`, before, payment.capturedMinor)
  })
}

/** The read-back: by our id after a create, by the provider's ref otherwise. */
async function readBack(
  run: Run,
  step: FaultStep,
  paymentId: PaymentId,
  ref: ProviderRef | null,
  mustExist: boolean,
): Promise<ProviderRef> {
  if (step !== 'createHold' && ref !== null) return ref
  const found = run.complete('findByPaymentId', await run.find(paymentId))
  if (found === null) {
    run.fail(mustExist ? 'a create that landed is not found by our payment id' : 'no payment')
  }
  return found.ref
}

/** The bank's step: the payment waits on the guest, cannot be captured, then holds. */
export const guestStepCheck = check(async (run) => {
  const before = await run.moved()
  fault(run, run.h.faults.nextHoldNeedsStep, 'ask for a guest step')()
  const completeStep = fault(run, run.h.guest.completeStep, 'complete a guest step')
  const { paymentId, guest } = await run.awaiting()
  await run.h.guest.pay(guest)
  const waiting = await run.expectPayment('while the bank asks', guest.paymentRef, 'awaiting_guest')
  run.expect(waiting.needsGuestAction, 'a payment whose bank asks for a step does not say so')
  run.refused(
    'a capture while the guest is asked',
    await run.capture(guest.paymentRef, run.amount, `${paymentId}:capture`),
    ['not_held'],
  )
  await completeStep(guest)
  const held = await run.expectPayment('after the step', guest.paymentRef, 'held')
  run.expect(!held.needsGuestAction, 'a held payment still asks the guest')
  await run.expectMoved('the bank step', before)
})

/** A hold past `captureBefore` is dropped: it reads released, and a capture is refused. */
export const expiryCheck = check(async (run) => {
  const before = await run.moved()
  const passCaptureBefore = fault(run, run.h.faults.passCaptureBefore, 'pass captureBefore')
  const { paymentId, ref } = await run.held()
  await passCaptureBefore(run.account, ref)
  const payment = await run.expectPayment('after captureBefore', ref, 'released')
  run.expect(payment.heldMinor === 0, 'an expired hold still holds money')
  run.refused(
    'a capture after captureBefore',
    await run.capture(ref, run.amount, `${paymentId}:capture`),
    ['hold_expired', 'not_held'],
  )
  await run.expectMoved('an expired hold', before)
})

/** A declined card fails the payment; nothing is held or can be captured. */
export const declineCheck = check(async (run) => {
  const before = await run.moved()
  const decline = fault(run, run.h.guest.decline, 'decline a card')
  const { paymentId, guest } = await run.awaiting()
  await decline(guest)
  const payment = await run.expectPayment('after a decline', guest.paymentRef, 'failed')
  run.expect(payment.heldMinor === 0, 'a failed payment holds money')
  run.refused(
    'a capture of a failed payment',
    await run.capture(guest.paymentRef, run.amount, `${paymentId}:capture`),
    ['not_held'],
  )
  await run.expectMoved('a declined card', before)
})

/** A read with a failed part is incomplete and concludes nothing. */
export const failedReadsCheck = check(async (run) => {
  const { paymentId, guest } = await run.awaiting()
  fault(run, run.h.faults.failReads, 'fail reads')()
  const found = await run.find(paymentId)
  run.expect(!found.complete, 'a failed read-back by payment id answered as complete')
  const read = await run.read(guest.paymentRef)
  run.expect(!read.complete, 'a failed payment read answered as complete')
  const connection = run.parse('readConnection', await run.h.provider.readConnection(run.account))
  run.expect(!connection.complete, 'a failed connection read answered as complete')
})
