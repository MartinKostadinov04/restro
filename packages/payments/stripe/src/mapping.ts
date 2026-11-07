// Stripe's words to the seam's (pure). A PaymentIntent becomes a `ProviderPayment`; a dispute's
// status becomes `open`, `won`, `lost` or none; a v2 account becomes a `ConnectionStatus`. Every
// answer is parsed with the seam's own schema before it leaves, so a Stripe object the mapping
// cannot place reads as incomplete, never as a guess.

import {
  type ConnectionStatus,
  ConnectionStatusSchema,
  CurrencySchema,
  type PaymentDisputeState,
  PaymentIdSchema,
  type ProviderPayment,
  ProviderPaymentSchema,
  type ProviderPaymentStatus,
  type ProviderRefund,
  ProviderRefundSchema,
  providerRef,
  type ThreeDsResult,
} from '@restro/core'

import type {
  StripeAccount,
  StripeCharge,
  StripeDispute,
  StripePaymentIntent,
  StripeRefund,
} from './api'

/** The metadata key that carries our payment id on the PaymentIntent (design §10). */
export const PAYMENT_METADATA_KEY = 'restro_payment'

/** A mapping that worked, or why it did not. */
export type Mapped<T> = { ok: true; value: T } | { ok: false; reason: string }

const REFUND_FAILED_BY_STATUS = new Map<string, boolean>([
  ['pending', false],
  ['requires_action', false],
  ['succeeded', false],
  ['failed', true],
  ['canceled', true],
])

/**
 * One refund as the seam has it (https://docs.stripe.com/api/refunds/object.md). `failed` and
 * `canceled` did not go through (https://docs.stripe.com/refunds.md: a cancellation is a type of
 * refund failure); `pending`, `requires_action` and `succeeded` count as refunded. Any other
 * status, or none, is not understood: the reading stops and concludes nothing.
 */
export function providerRefund(refund: StripeRefund): Mapped<ProviderRefund> {
  const failed = REFUND_FAILED_BY_STATUS.get(refund.status ?? '')
  if (failed === undefined) {
    return { ok: false, reason: `unknown refund status ${refund.status ?? 'none'}` }
  }
  const parsed = ProviderRefundSchema.safeParse({
    ref: providerRef(refund.id),
    amountMinor: refund.amount,
    failed,
  })
  if (!parsed.success) return { ok: false, reason: 'the refund does not fit the seam' }
  return { ok: true, value: parsed.data }
}

/**
 * The platform's status of a PaymentIntent
 * (https://docs.stripe.com/payments/paymentintents/lifecycle.md,
 * https://docs.stripe.com/api/payment_intents/object.md#payment_intent_object-status):
 *   - `requires_payment_method`: the guest has not paid yet, or the card was declined: Stripe
 *     leaves a declined intent there with `last_payment_error` set (failed);
 *   - `requires_confirmation`, `processing`: the guest is paying;
 *   - `requires_action`: the bank asks the guest for a step (3-D Secure);
 *   - `requires_capture`: held; `succeeded`: captured; `canceled`: released.
 * Null for a status Stripe may add later: the reading is incomplete.
 */
export function paymentStatus(intent: StripePaymentIntent): ProviderPaymentStatus | null {
  switch (intent.status) {
    case 'requires_payment_method':
      return intent.last_payment_error ? 'failed' : 'awaiting_guest'
    case 'requires_confirmation':
    case 'requires_action':
    case 'processing':
      return 'awaiting_guest'
    case 'requires_capture':
      return 'held'
    case 'succeeded':
      return 'captured'
    case 'canceled':
      return 'released'
    default:
      return null
  }
}

/**
 * The bank's check, from the charge's `payment_method_details.card.three_d_secure.result`
 * (https://docs.stripe.com/api/charges/object.md). `data_share_only` (data sent to the issuer,
 * no authentication) has no word of ours and reads as none.
 */
export function threeDsResult(result: string | null | undefined): ThreeDsResult | null {
  switch (result) {
    case 'authenticated':
      return 'authenticated'
    case 'attempt_acknowledged':
      return 'attempted'
    case 'exempted':
      return 'exempted'
    case 'not_supported':
      return 'not_supported'
    case 'failed':
      return 'failed'
    case 'processing_error':
      return 'error'
    default:
      return null
  }
}

/**
 * Where a dispute stands (#108; https://docs.stripe.com/api/disputes/object.md#dispute_object-status,
 * https://docs.stripe.com/disputes/how-disputes-work.md): the early warnings (inquiries) and a
 * dispute awaiting or under review are open; `won` and `lost` are final; an inquiry closed
 * without a chargeback (`warning_closed`) and a prevented one (`prevented`) are no dispute. A
 * status Stripe may add later is `unknown`: the reading is incomplete.
 */
export function disputeState(status: string): PaymentDisputeState | null | 'unknown' {
  switch (status) {
    case 'warning_needs_response':
    case 'warning_under_review':
    case 'needs_response':
    case 'under_review':
      return 'open'
    case 'won':
      return 'won'
    case 'lost':
      return 'lost'
    case 'warning_closed':
    case 'prevented':
      return null
    default:
      return 'unknown'
  }
}

/**
 * Until when the venue may answer a dispute (#222): `evidence_details.due_by`, a Unix time
 * (https://docs.stripe.com/api/disputes/object.md#dispute_object-evidence_details-due_by). Stripe
 * gives 0 or none where the bank allows no answer; that is no date, never a date in 1970.
 */
export function disputeDueAt(dispute: StripeDispute): string | null {
  const dueBy = dispute.evidence_details?.due_by ?? 0
  return dueBy > 0 ? new Date(dueBy * 1000).toISOString() : null
}

/** Our payment id from the intent's metadata, or null when the intent is not one Restro made. */
export function paymentIdOf(intent: StripePaymentIntent): ProviderPayment['paymentId'] | null {
  const parsed = PaymentIdSchema.safeParse(intent.metadata?.[PAYMENT_METADATA_KEY])
  return parsed.success ? parsed.data : null
}

/**
 * The payment as the seam has it. `charge` is the intent's latest charge (expanded), and
 * `dispute` the latest dispute's state and `disputeDueAt` its answer-by date, read separately; all
 * may be absent.
 */
export function providerPayment(
  intent: StripePaymentIntent,
  charge: StripeCharge | null,
  dispute: PaymentDisputeState | null,
  dueAt: string | null = null,
): Mapped<ProviderPayment> {
  const status = paymentStatus(intent)
  if (status === null) return { ok: false, reason: `unknown payment status ${intent.status}` }
  const paymentId = paymentIdOf(intent)
  if (paymentId === null) return { ok: false, reason: 'the payment carries no Restro payment id' }
  const currency = CurrencySchema.safeParse(intent.currency.toUpperCase())
  if (!currency.success) return { ok: false, reason: `unknown currency ${intent.currency}` }
  const card = charge?.payment_method_details?.card ?? null
  const captureBefore = card?.capture_before ?? null
  const authorisationCode = card?.authorization_code ?? null
  const parsed = ProviderPaymentSchema.safeParse({
    ref: providerRef(intent.id),
    paymentId,
    status,
    needsGuestAction: intent.status === 'requires_action',
    currency: currency.data,
    amountMinor: intent.amount,
    heldMinor: status === 'held' ? intent.amount_capturable : 0,
    capturedMinor: status === 'captured' ? intent.amount_received : 0,
    refundedMinor: charge?.amount_refunded ?? 0,
    dispute: status === 'captured' ? dispute : null,
    disputeDueAt: status === 'captured' && dispute !== null ? dueAt : null,
    captureBefore: captureBefore === null ? null : new Date(captureBefore * 1000).toISOString(),
    threeDs: threeDsResult(card?.three_d_secure?.result),
    authorisationCode:
      authorisationCode !== null && authorisationCode.length > 0 && authorisationCode.length <= 64
        ? authorisationCode
        : null,
  })
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join('; ')
    return { ok: false, reason: `the payment does not fit the seam: ${issues}` }
  }
  return { ok: true, value: parsed.data }
}

/** The most entries of what is missing the settings screen gets (the seam's cap). */
const MISSING_CAP = 100

/**
 * Whether a v2 account can take card payments, and what it still needs
 * (https://docs.stripe.com/api/v2/core/accounts/object.md): the merchant configuration's
 * `card_payments` capability is `active`, the requirements' entries name what is missing, and
 * `display_name` (nullable) is the account's name for "Connected" in the settings.
 */
export function connectionStatus(account: StripeAccount): Mapped<ConnectionStatus> {
  const capability = account.configuration?.merchant?.capabilities?.card_payments ?? null
  const entries = account.requirements?.entries ?? []
  const missing = [...new Set(entries.map((entry) => entry.description.slice(0, 200)))]
  const name = account.display_name?.trim() ?? ''
  const parsed = ConnectionStatusSchema.safeParse({
    canTakePayments: capability?.status === 'active',
    displayName: name === '' ? null : name.slice(0, 200),
    missing: missing.filter((name) => name.length > 0).slice(0, MISSING_CAP),
  })
  if (!parsed.success) return { ok: false, reason: 'the account does not fit the seam' }
  return { ok: true, value: parsed.data }
}
