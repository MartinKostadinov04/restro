// The simulated provider's engine (#103): venue accounts, payments, an idempotency store and a
// ledger of money moved, in memory, with an injected clock and no I/O. It claims nothing about
// any real provider: what a careful provider does is built in, each choice the platform could
// lean on starts on its cautious answer (`SimPaySwitches`), and faults are scripted one call at a
// time (`SimPayFaults`).
//
// The rules it keeps:
//   - only `capture` moves money, once, never above the hold; a smaller capture releases the rest;
//   - the same idempotency key with the same request answers the stored answer again (a stored
//     server error included); with another request it is refused (`key_reused`);
//   - a hold not captured by its `captureBefore` is dropped (read as released);
//   - two payments carrying one payment id make the read-back incomplete: it concludes nothing;
//   - a refund or a dispute happens outside Restro (`venue`, `bank`, test controls), leaves a
//     notice in the outbox (`takeNotices`), and reads back as it stands now (#108);
//   - the guest's card held or declined at the form leaves a `payment.*` notice too (#110).

import {
  addMinor,
  type CaptureRequest,
  type ConnectionStatus,
  type CreateHoldRequest,
  type CreateHoldResult,
  type Currency,
  type EmptyResult,
  type PaymentDisputeState,
  type PaymentId,
  type PaymentRefusal,
  type PaymentRefusalCode,
  type PaymentWallet,
  type PaymentWriteOutcome,
  type PrepareDomainRequest,
  type ProviderFormValues,
  ProviderFormValuesSchema,
  type ProviderNotice,
  type ProviderPayment,
  type ProviderRef,
  providerRef,
  type Reading,
  type ReleaseRequest,
  type StartConnectionRequest,
  type StartConnectionResult,
  subtractMinor,
  type ThreeDsResult,
} from '@restro/core'

import type { Clock } from './clock'
import type { SimPayEvent } from './notices'

const DAY_MS = 86_400_000

/** How long the simulated bank gives the venue to answer a dispute (#222). */
const DISPUTE_DAYS = 14

/** What the simulated provider declares; each starts on the cautious answer. */
export interface SimPaySwitches {
  /** The hold window, in days. */
  readonly holdDays: number
  /** A smaller capture takes that much and releases the rest. */
  readonly partialCapture: boolean
  /** Wallets in the card form: none, so a feature that needs one stays off. */
  readonly wallets: readonly PaymentWallet[]
  /** No refund notices, so the platform's fallback (the daily list) is exercised. */
  readonly refundNotices: boolean
  /** The smallest amount, in minor units, per currency. */
  readonly minimumMinor: { readonly [C in Currency]: number }
}

export const CAUTIOUS_SWITCHES: SimPaySwitches = Object.freeze({
  holdDays: 7,
  partialCapture: true,
  wallets: [],
  refundNotices: false,
  minimumMinor: Object.freeze({ EUR: 50 }),
})

/** The writes a fault can hit. */
export type SimPayStep = 'createHold' | 'capture' | 'release'

/** What a scripted fault does to the next call of its step. */
export type SimPayFault =
  | { readonly kind: 'land_then_timeout' }
  | { readonly kind: 'timeout_before' }
  | { readonly kind: 'refuse'; readonly code?: PaymentRefusalCode }
  | { readonly kind: 'server_error' }

interface SimAccount {
  readonly ref: ProviderRef
  canTakePayments: boolean
  /** The account's name as the provider shows it; null until the owner gave one. */
  displayName: string | null
  missing: string[]
  readonly domains: Set<string>
  /**
   * Money Restro moved on the account, in minor units: the sum of its captures. A refund or a
   * dispute, which happen outside Restro, is not in it.
   */
  movedMinor: number
}

interface SimPayment {
  readonly ref: ProviderRef
  readonly account: string
  readonly paymentId: PaymentId
  readonly currency: Currency
  readonly amountMinor: number
  status: ProviderPayment['status']
  needsGuestAction: boolean
  /** The bank asks the guest for a step when the guest pays. */
  readonly needsStep: boolean
  heldMinor: number
  capturedMinor: number
  /** What the venue refunded in its dashboard, in total. */
  refundedMinor: number
  /** The latest dispute's ref, once the guest's bank opened one. */
  disputeRef: string | null
  /** The hold ran out uncaptured (`captureBefore` passed). */
  expired: boolean
  captureBefore: Date | null
  threeDs: ThreeDsResult | null
  authorisationCode: string | null
}

interface Stored {
  readonly step: string
  readonly request: string
  readonly answer: PaymentWriteOutcome<unknown>
}

/**
 * The account-level steps an account that cannot take payments still answers. Releasing a hold is
 * the cautious step, so the guest's money is not left held until the hold runs out; capture stays
 * refused. A choice of the simulator: it claims nothing about what a real provider does.
 * (`startConnection` never reaches the account check: it names no account to `#write`.)
 */
const RESTRICTED_ALLOWS: ReadonlySet<string> = new Set(['prepareDomain', 'release'])

export class SimPayEngine {
  readonly switches: SimPaySwitches
  readonly #clock: Clock
  readonly #accounts = new Map<string, SimAccount>()
  readonly #payments = new Map<string, SimPayment>()
  readonly #stored = new Map<string, Stored>()
  readonly #faults = new Map<SimPayStep, SimPayFault>()
  /** A refund or a dispute's ref to its payment's (and a dispute's state). */
  readonly #refunds = new Map<string, { readonly payment: string }>()
  readonly #disputes = new Map<
    string,
    { readonly payment: string; state: PaymentDisputeState; readonly dueAt: Date }
  >()
  /** The notices the provider sent and nobody took yet. */
  #outbox: SimPayEvent[] = []
  #failReads = false
  #nextHoldNeedsStep = false
  #counter = 0
  /** Put inside every ref this engine makes, so a restarted engine never reuses a stored one. */
  readonly #run: string

  constructor(options: {
    readonly clock: Clock
    readonly switches?: Partial<SimPaySwitches>
    /**
     * Letters and digits put in every ref (`simpay_<run>_1`). An engine that outlives one database
     * (the e2e harness, a demo) passes a fresh one per start; tests leave it out (`simpay_1`).
     */
    readonly run?: string
  }) {
    this.#clock = options.clock
    this.switches = Object.freeze({ ...CAUTIOUS_SWITCHES, ...options.switches })
    if (options.run !== undefined && !/^[A-Za-z0-9]{1,32}$/.test(options.run)) {
      throw new Error('a run is 1 to 32 letters or digits')
    }
    this.#run = options.run === undefined ? '' : `${options.run}_`
  }

  // -------------------------------------------------------------------------------------------
  // Set-up and inspection (tests, the harness)

  /** A venue account that has finished connecting and can take payments. */
  addAccount(): ProviderRef {
    const account = this.#newAccount()
    account.canTakePayments = true
    account.missing = []
    return account.ref
  }

  /** The owner finishes the hosted form: the account can take payments. */
  finishConnecting(accountRef: ProviderRef, displayName: string | null = null): void {
    const account = this.#account(accountRef)
    if (account === undefined) throw new Error(`no account ${accountRef.provider}`)
    account.canTakePayments = true
    account.displayName = displayName
    account.missing = []
  }

  /** The provider restricts the account (it needs more from the owner): it takes no payments. */
  restrictAccount(accountRef: ProviderRef, missing: readonly string[]): void {
    const account = this.#account(accountRef)
    if (account === undefined) throw new Error(`no account ${accountRef.provider}`)
    account.canTakePayments = false
    account.missing = [...missing]
  }

  /** The provider tells Restro the account changed (the owner went on with the hosted form). */
  announceAccountUpdated(accountRef: ProviderRef): SimPayEvent {
    return this.#send('account.updated', accountRef.provider, accountRef.provider, true)
  }

  /**
   * The owner takes Restro's access away on the provider's side: the provider tells Restro, and
   * every later call about the account is refused `access_lost` (account scope).
   */
  revokeAccess(accountRef: ProviderRef): SimPayEvent {
    this.#accounts.delete(accountRef.provider)
    return this.#send('account.access_revoked', accountRef.provider, accountRef.provider, true)
  }

  /** The hosts registered for wallets on the account (`prepareDomain`), oldest first. */
  domainsOf(accountRef: ProviderRef): string[] {
    return [...(this.#account(accountRef)?.domains ?? [])]
  }

  /** Money moved on the account so far, in minor units. */
  movedMinor(accountRef: ProviderRef): number {
    return this.#account(accountRef)?.movedMinor ?? 0
  }

  /** Every payment carrying `paymentId` on the account (the property test counts them). */
  paymentsOf(accountRef: ProviderRef, paymentId: PaymentId): ProviderPayment[] {
    return [...this.#payments.values()]
      .filter((p) => p.account === accountRef.provider && p.paymentId === paymentId)
      .map((p) => this.#view(p))
  }

  // -------------------------------------------------------------------------------------------
  // Faults

  /** The next call of `step` meets `fault`. */
  fault(step: SimPayStep, fault: SimPayFault): void {
    this.#faults.set(step, fault)
  }

  /** Every read from now on fails part-way, until `clearFaults`. */
  failReads(): void {
    this.#failReads = true
  }

  /** The next hold's bank asks the guest for a step (3-D Secure). */
  nextHoldNeedsStep(): void {
    this.#nextHoldNeedsStep = true
  }

  clearFaults(): void {
    this.#faults.clear()
    this.#failReads = false
    this.#nextHoldNeedsStep = false
  }

  /** The notices sent since the last call, oldest first; the outbox is emptied. */
  takeNotices(): SimPayEvent[] {
    const notices = this.#outbox
    this.#outbox = []
    return notices
  }

  // -------------------------------------------------------------------------------------------
  // The venue and the guest's bank, outside Restro (tests and the harness only, #108). Restro
  // never refunds (D125 3.5): these stand for what the venue does in its own dashboard and what
  // the guest's bank does, and each sends the provider's notice about it.

  readonly venue = {
    /** The venue refunds part or all of a captured payment in its dashboard. */
    refundsInDashboard: (
      accountRef: ProviderRef,
      paymentRef: ProviderRef,
      amountMinor: number,
    ): SimPayEvent => {
      const payment = this.#capturedPayment(accountRef, paymentRef)
      const left = subtractMinor(payment.capturedMinor, payment.refundedMinor)
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > left) {
        throw new Error(`a refund of ${amountMinor} where ${left} is left to refund`)
      }
      payment.refundedMinor = addMinor(payment.refundedMinor, amountMinor)
      const ref = `simrefund_${this.#tag()}`
      this.#refunds.set(ref, { payment: payment.ref.provider })
      return this.#send('refund.made', payment.account, ref, this.switches.refundNotices)
    },
    /**
     * A refund the venue made does not go through at the provider (#222): the refund total falls
     * back by that amount, and the provider sends its notice. A choice of the simulator: whether
     * a real provider lowers the total on a failed refund is for its documentation.
     */
    refundFails: (
      accountRef: ProviderRef,
      paymentRef: ProviderRef,
      amountMinor: number,
    ): SimPayEvent => {
      const payment = this.#capturedPayment(accountRef, paymentRef)
      if (
        !Number.isSafeInteger(amountMinor) ||
        amountMinor <= 0 ||
        amountMinor > payment.refundedMinor
      ) {
        throw new Error(
          `a refund of ${amountMinor} failed where ${payment.refundedMinor} is refunded`,
        )
      }
      payment.refundedMinor = subtractMinor(payment.refundedMinor, amountMinor)
      const ref = `simrefund_${this.#tag()}`
      this.#refunds.set(ref, { payment: payment.ref.provider })
      return this.#send('refund.failed', payment.account, ref, this.switches.refundNotices)
    },
  }

  readonly bank = {
    /** The guest's bank disputes a captured payment. */
    opensDispute: (accountRef: ProviderRef, paymentRef: ProviderRef): SimPayEvent => {
      const payment = this.#capturedPayment(accountRef, paymentRef)
      const ref = `simdispute_${this.#tag()}`
      this.#disputes.set(ref, {
        payment: payment.ref.provider,
        state: 'open',
        dueAt: new Date(this.#clock.now().getTime() + DISPUTE_DAYS * DAY_MS),
      })
      payment.disputeRef = ref
      return this.#send('dispute.opened', payment.account, ref, true)
    },
    /** The dispute closes: won, the venue keeps the money; lost, the money goes back. */
    closesDispute: (
      accountRef: ProviderRef,
      disputeRef: ProviderRef,
      outcome: 'won' | 'lost',
    ): SimPayEvent => {
      const dispute = this.#disputes.get(disputeRef.provider)
      const payment = dispute === undefined ? undefined : this.#payments.get(dispute.payment)
      if (dispute === undefined || payment?.account !== accountRef.provider) {
        throw new Error(`no dispute ${disputeRef.provider} on this account`)
      }
      if (dispute.state !== 'open') throw new Error(`the dispute is ${dispute.state} already`)
      dispute.state = outcome
      return this.#send('dispute.closed', payment.account, disputeRef.provider, true)
    },
  }

  // -------------------------------------------------------------------------------------------
  // The guest at the card form

  readonly guest = {
    /** A card the bank accepts: held, unless the bank asks for a step first. */
    pay: (paymentRef: ProviderRef): void => {
      const payment = this.#guestPayment(paymentRef)
      if (payment.needsStep) {
        payment.needsGuestAction = true
        return
      }
      this.#hold(payment, 'authenticated')
    },
    /** The guest finishes the bank's step. */
    completeStep: (paymentRef: ProviderRef): void => {
      const payment = this.#guestPayment(paymentRef)
      if (!payment.needsGuestAction) throw new Error('the bank asked for no step')
      this.#hold(payment, 'authenticated')
    },
    /** A card the bank declines. */
    decline: (paymentRef: ProviderRef): void => {
      const payment = this.#guestPayment(paymentRef)
      payment.status = 'failed'
      payment.needsGuestAction = false
      payment.threeDs = 'failed'
      this.#send('payment.failed', payment.account, payment.ref.provider, true)
    },
  }

  // -------------------------------------------------------------------------------------------
  // The provider's steps

  startConnection(request: StartConnectionRequest): PaymentWriteOutcome<StartConnectionResult> {
    return this.#write(null, 'startConnection', request, () => {
      const account =
        request.accountRef === null ? this.#newAccount() : this.#account(request.accountRef)
      if (account === undefined) return refused('not_found', 'account')
      return done({
        accountRef: account.ref,
        redirectUrl: `https://connect.sim-pay.test/onboard/${account.ref.provider}`,
      })
    })
  }

  readConnection(accountRef: ProviderRef): Reading<ConnectionStatus> {
    if (this.#failReads) return { complete: false, reason: 'the account read failed part-way' }
    const account = this.#account(accountRef)
    if (account === undefined) {
      return complete({ canTakePayments: false, displayName: null, missing: ['account'] })
    }
    return complete({
      canTakePayments: account.canTakePayments,
      displayName: account.displayName,
      missing: [...account.missing],
    })
  }

  prepareDomain(request: PrepareDomainRequest): PaymentWriteOutcome<EmptyResult> {
    return this.#accountWrite(request.accountRef, 'prepareDomain', request, (account) => {
      if (this.switches.wallets.length === 0) return refused('not_supported', 'account')
      account.domains.add(request.host)
      return done({})
    })
  }

  createHold(request: CreateHoldRequest): PaymentWriteOutcome<CreateHoldResult> {
    return this.#accountWrite(request.accountRef, 'createHold', request, (account) => {
      if (request.amountMinor < this.switches.minimumMinor[request.currency]) {
        return refused('amount_too_small', 'payment')
      }
      const ref = providerRef(`simpay_${this.#tag()}`)
      this.#payments.set(ref.provider, {
        ref,
        account: account.ref.provider,
        paymentId: request.paymentId,
        currency: request.currency,
        amountMinor: request.amountMinor,
        status: 'awaiting_guest',
        needsGuestAction: false,
        needsStep: this.#takeNextHoldNeedsStep(),
        heldMinor: 0,
        capturedMinor: 0,
        refundedMinor: 0,
        disputeRef: null,
        expired: false,
        captureBefore: null,
        threeDs: null,
        authorisationCode: null,
      })
      return done({ paymentRef: ref, form: formValues(account.ref, ref) })
    })
  }

  findByPaymentId(accountRef: ProviderRef, paymentId: PaymentId): Reading<ProviderPayment | null> {
    if (this.#failReads) return { complete: false, reason: 'the search failed part-way' }
    const found = [...this.#payments.values()].filter(
      (p) => p.account === accountRef.provider && p.paymentId === paymentId,
    )
    if (found.length > 1) {
      return { complete: false, reason: 'more than one payment carries this payment id' }
    }
    const [payment] = found
    return complete(payment === undefined ? null : this.#view(payment))
  }

  readPayment(accountRef: ProviderRef, paymentRef: ProviderRef): Reading<ProviderPayment> {
    if (this.#failReads) return { complete: false, reason: 'the payment read failed part-way' }
    const payment = this.#payments.get(paymentRef.provider)
    if (payment === undefined || payment.account !== accountRef.provider) {
      return { complete: false, reason: 'no such payment on this account' }
    }
    return complete(this.#view(payment))
  }

  /**
   * The payment a notice is about, as it stands now: the notice's object (a payment, a refund or a
   * dispute) leads to its payment. Null for an object of another account or one it never made.
   */
  readNoticeSubject(
    accountRef: ProviderRef,
    notice: ProviderNotice,
  ): Reading<ProviderPayment | null> {
    if (this.#failReads) return { complete: false, reason: 'the notice read failed part-way' }
    if (notice.objectRef === null) return complete(null)
    const ref = notice.objectRef.provider
    const paymentRef = this.#refunds.get(ref)?.payment ?? this.#disputes.get(ref)?.payment ?? ref
    const payment = this.#payments.get(paymentRef)
    if (payment === undefined || payment.account !== accountRef.provider) return complete(null)
    return complete(this.#view(payment))
  }

  capture(request: CaptureRequest): PaymentWriteOutcome<ProviderPayment> {
    return this.#accountWrite(request.accountRef, 'capture', request, (account) => {
      const payment = this.#paymentOf(account, request.paymentRef)
      if (payment === undefined) return refused('not_found', 'payment')
      if (payment.status === 'captured') return refused('already_captured', 'payment')
      if (payment.status !== 'held') {
        return refused(payment.expired ? 'hold_expired' : 'not_held', 'payment')
      }
      if (request.amountMinor > payment.heldMinor) return refused('amount_above_hold', 'payment')
      if (request.amountMinor < payment.heldMinor && !this.switches.partialCapture) {
        return refused('partial_not_supported', 'payment')
      }
      payment.status = 'captured'
      payment.capturedMinor = request.amountMinor
      payment.heldMinor = 0
      account.movedMinor = addMinor(account.movedMinor, request.amountMinor)
      return done(this.#view(payment))
    })
  }

  release(request: ReleaseRequest): PaymentWriteOutcome<ProviderPayment> {
    return this.#accountWrite(request.accountRef, 'release', request, (account) => {
      const payment = this.#paymentOf(account, request.paymentRef)
      if (payment === undefined) return refused('not_found', 'payment')
      if (payment.status === 'captured') return refused('already_captured', 'payment')
      payment.status = 'released'
      payment.needsGuestAction = false
      payment.heldMinor = 0
      return done(this.#view(payment))
    })
  }

  // -------------------------------------------------------------------------------------------
  // Inside

  /**
   * One write: the idempotency store first, then the scripted fault, then the step. Every
   * answer that started executing (done, refused, a server error) is stored for its key.
   */
  #write<R>(
    accountRef: ProviderRef | null,
    step: string,
    request: { readonly idempotencyKey: string },
    run: (account: SimAccount | null) => PaymentWriteOutcome<R>,
  ): PaymentWriteOutcome<R> {
    const account = accountRef === null ? null : this.#account(accountRef)
    if (account === undefined) return refused('access_lost', 'account')
    const storeKey = `${accountRef?.provider ?? '-'}|${request.idempotencyKey}`
    const { idempotencyKey: _key, ...rest } = request
    const digest = `${step}:${JSON.stringify(rest)}`
    const stored = this.#stored.get(storeKey)
    if (stored !== undefined) {
      if (stored.request !== digest) return refused('key_reused', 'payment')
      return stored.answer as PaymentWriteOutcome<R>
    }
    const fault = this.#takeFault(step)
    if (fault?.kind === 'timeout_before') return timedOut()
    let answer: PaymentWriteOutcome<R>
    if (fault?.kind === 'server_error') {
      answer = {
        kind: 'unknown',
        reason: 'the provider answered a server error, stored for this key',
      }
    } else if (fault?.kind === 'refuse') {
      answer = refused(
        fault.code ?? defaultRefusal(step),
        scopeOf(fault.code ?? defaultRefusal(step)),
      )
    } else if (account !== null && !account.canTakePayments && !RESTRICTED_ALLOWS.has(step)) {
      answer = refused('account_restricted', 'account')
    } else {
      answer = run(account)
    }
    this.#stored.set(storeKey, { step, request: digest, answer })
    return fault?.kind === 'land_then_timeout' ? timedOut() : answer
  }

  /** A write about one account: the account is known (`#write` refused an unknown one). */
  #accountWrite<R>(
    accountRef: ProviderRef,
    step: SimPayStep | 'prepareDomain',
    request: { readonly idempotencyKey: string },
    run: (account: SimAccount) => PaymentWriteOutcome<R>,
  ): PaymentWriteOutcome<R> {
    return this.#write(accountRef, step, request, (account) =>
      account === null ? refused('access_lost', 'account') : run(account),
    )
  }

  #takeFault(step: string): SimPayFault | undefined {
    if (step !== 'createHold' && step !== 'capture' && step !== 'release') return undefined
    const fault = this.#faults.get(step)
    this.#faults.delete(step)
    return fault
  }

  #takeNextHoldNeedsStep(): boolean {
    const needs = this.#nextHoldNeedsStep
    this.#nextHoldNeedsStep = false
    return needs
  }

  #newAccount(): SimAccount {
    const account: SimAccount = {
      ref: providerRef(`simacct_${this.#tag()}`),
      canTakePayments: false,
      displayName: null,
      missing: ['business details', 'bank account'],
      domains: new Set(),
      movedMinor: 0,
    }
    this.#accounts.set(account.ref.provider, account)
    return account
  }

  #account(ref: ProviderRef): SimAccount | undefined {
    return this.#accounts.get(ref.provider)
  }

  #paymentOf(account: SimAccount, ref: ProviderRef): SimPayment | undefined {
    const payment = this.#payments.get(ref.provider)
    if (payment?.account !== account.ref.provider) return undefined
    this.#expire(payment)
    return payment
  }

  #capturedPayment(accountRef: ProviderRef, ref: ProviderRef): SimPayment {
    const payment = this.#payments.get(ref.provider)
    if (payment === undefined || payment.account !== accountRef.provider) {
      throw new Error(`no payment ${ref.provider} on this account`)
    }
    if (payment.status !== 'captured') throw new Error(`the payment is ${payment.status}`)
    return payment
  }

  /** The provider's notice about an object of the account; `sent` puts it in the outbox. */
  #send(type: SimPayEvent['type'], account: string, object: string, sent: boolean): SimPayEvent {
    const event: SimPayEvent = {
      id: `simevt_${this.#tag()}`,
      type,
      account,
      object,
      livemode: false,
    }
    if (sent) this.#outbox.push(event)
    return event
  }

  #guestPayment(ref: ProviderRef): SimPayment {
    const payment = this.#payments.get(ref.provider)
    if (payment === undefined) throw new Error(`no payment ${ref.provider}`)
    this.#expire(payment)
    if (payment.status !== 'awaiting_guest') {
      throw new Error(`the guest cannot pay a payment that is ${payment.status}`)
    }
    return payment
  }

  #hold(payment: SimPayment, threeDs: ThreeDsResult): void {
    payment.status = 'held'
    payment.needsGuestAction = false
    payment.heldMinor = payment.amountMinor
    payment.captureBefore = new Date(this.#clock.now().getTime() + this.switches.holdDays * DAY_MS)
    payment.threeDs = threeDs
    payment.authorisationCode = `SIM${String(this.#next()).padStart(3, '0')}`
    this.#send('payment.held', payment.account, payment.ref.provider, true)
  }

  /** A hold past its `captureBefore` is dropped, as the provider would drop it. */
  #expire(payment: SimPayment): void {
    if (
      payment.status === 'held' &&
      payment.captureBefore !== null &&
      this.#clock.now().getTime() >= payment.captureBefore.getTime()
    ) {
      payment.status = 'released'
      payment.heldMinor = 0
      payment.expired = true
    }
  }

  #view(payment: SimPayment): ProviderPayment {
    this.#expire(payment)
    return {
      ref: payment.ref,
      paymentId: payment.paymentId,
      status: payment.status,
      needsGuestAction: payment.needsGuestAction,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      heldMinor: payment.heldMinor,
      capturedMinor: payment.capturedMinor,
      refundedMinor: payment.refundedMinor,
      dispute:
        payment.disputeRef === null
          ? null
          : (this.#disputes.get(payment.disputeRef)?.state ?? null),
      disputeDueAt:
        payment.disputeRef === null
          ? null
          : (this.#disputes.get(payment.disputeRef)?.dueAt.toISOString() ?? null),
      captureBefore: payment.captureBefore?.toISOString() ?? null,
      threeDs: payment.threeDs,
      authorisationCode: payment.authorisationCode,
    }
  }

  #next(): number {
    this.#counter += 1
    return this.#counter
  }

  /** The next ref's tail: the run, then the counter. */
  #tag(): string {
    return `${this.#run}${this.#next()}`
  }
}

function done<R>(result: R): PaymentWriteOutcome<R> {
  return { kind: 'done', result }
}

function refused<R>(
  code: PaymentRefusalCode,
  scope: PaymentRefusal['scope'],
): PaymentWriteOutcome<R> {
  return { kind: 'refused', refusal: { code, scope, detail: null } }
}

function timedOut<R>(): PaymentWriteOutcome<R> {
  return { kind: 'unknown', reason: 'the call timed out' }
}

function complete<T>(value: T): Reading<T> {
  return { complete: true, value }
}

/** A capture refused after the venue's close (D127 3.14); any other step loses its access. */
function defaultRefusal(step: string): PaymentRefusalCode {
  return step === 'capture' ? 'capture_refused' : 'access_lost'
}

function scopeOf(code: PaymentRefusalCode): PaymentRefusal['scope'] {
  return code === 'access_lost' || code === 'account_restricted' ? 'account' : 'payment'
}

/** What the page's card form for the simulator needs (#108 mounts it). */
function formValues(account: ProviderRef, payment: ProviderRef): ProviderFormValues {
  return ProviderFormValuesSchema.parse({ account: account.provider, payment: payment.provider })
}
