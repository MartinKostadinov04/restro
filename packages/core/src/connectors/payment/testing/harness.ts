// What a provider package hands the payment conformance suite (D127 6.2, design §10): the
// provider, a venue account that can take payments, the provider's own ledger of money moved, a
// guest driver that does what the guest does in the card form, and the faults the harness can
// switch on. Provider-neutral: the simulated provider drives its in-memory engine; a real
// provider's harness drives its sandbox (#107), never a venue's live account (rule 7).

import type { Currency } from '../../../money'
import type { PaymentProvider } from '../provider'
import type { ProviderRef } from '../provider-ref'
import type { ProviderFormValues } from '../schemas'

/** The steps a fault can hit: the provider writes about a payment. */
export const FAULT_STEPS = ['createHold', 'capture', 'release'] as const
export type FaultStep = (typeof FAULT_STEPS)[number]

/** A payment the guest is paying for, as the page has it. */
export interface GuestPayment {
  readonly accountRef: ProviderRef
  readonly paymentRef: ProviderRef
  readonly form: ProviderFormValues
}

/** The guest at the card form. Each call returns once the provider has taken the guest's answer. */
export interface GuestDriver {
  /** Enters a card the bank accepts: the hold becomes `held`, unless the bank asks for a step. */
  pay(payment: GuestPayment): Promise<void>
  /** Finishes the bank's step (3-D Secure) the provider asked for: the hold becomes `held`. */
  completeStep?(payment: GuestPayment): Promise<void>
  /** Enters a card the bank declines: the payment `failed`. */
  decline?(payment: GuestPayment): Promise<void>
}

/**
 * Faults the suite switches on, each for the next call of a step only; `reset` switches every
 * one off. A fault the harness cannot produce is left out, and its check shows as a todo.
 */
export interface PaymentFaults {
  /** The next call lands at the provider, then answers as a timeout. */
  landThenTimeOut?(step: FaultStep): void
  /** The next call answers as a timeout and lands nowhere. */
  timeOutBeforeLanding?(step: FaultStep): void
  /** The provider refuses the next call (a capture: after the venue's close, D127 3.14). */
  refuseNext?(step: FaultStep): void
  /**
   * The next call fails with a server error, which the provider stores for its idempotency key and
   * answers again for every repeat of that key.
   */
  storeServerError?(step: FaultStep): void
  /** The next hold's bank asks the guest for a step (3-D Secure) before it holds. */
  nextHoldNeedsStep?(): void
  /** Time moves past the payment's `captureBefore`: the provider drops the hold. */
  passCaptureBefore?(accountRef: ProviderRef, paymentRef: ProviderRef): Promise<void>
  /** Every read from now on fails part-way. */
  failReads?(): void
}

export interface PaymentHarness {
  /** The provider's name in test titles. */
  readonly name: string
  readonly provider: PaymentProvider
  /** A venue account that can take card payments. */
  readonly account: ProviderRef
  /** The currency the suite pays in. */
  readonly currency: Currency
  /** A host to register for wallets (`prepareDomain`). */
  readonly guestHost: string
  /** Faults off; payments made so far may stay. */
  reset(): void | Promise<void>
  /**
   * Money moved on the account so far, in minor units, from the provider's own ledger (a sandbox
   * account's balance), not from the provider's answers.
   */
  movedMinor(): Promise<number>
  readonly guest: GuestDriver
  readonly faults: PaymentFaults
}
