// What a failed Stripe call means for a write: a definite "no" with its reach, or `unknown`.
// Only answers Stripe's docs call final are refusals; everything else (a timeout, a lost
// connection, a 5xx, a 409, a rate limit, a lock timeout) is `unknown`, and the platform reads the
// payment back (D125 3.9).
//
// Sources:
//   https://docs.stripe.com/error-low-level.md (HTTP codes; 5xx and 409 are not final; a 500
//     stored for an idempotency key is replayed for it, with `Idempotent-Replayed: true`)
//   https://docs.stripe.com/api/errors.md (error types; `payment_intent` on a PaymentIntent error)
//   https://docs.stripe.com/error-codes.md (`payment_intent_unexpected_state`, `amount_too_large`,
//     `amount_too_small`, `charge_expired_for_capture`, `resource_missing`, `account_invalid`, ...)
//   https://docs.stripe.com/api/idempotent_requests.md (a key reused with other parameters)

import type { PaymentRefusal, PaymentRefusalCode, PaymentWriteOutcome } from '@restro/core'

import { PaymentIntentSchema, type StripePaymentIntent } from './api'
import { withoutSecrets } from './config'

/** The fields of a stripe-node error this package reads (`StripeError` in `stripe/esm/Error`). */
export interface StripeErrorLike {
  /** stripe-node's class name (`StripeIdempotencyError`, ...). */
  readonly type?: string
  /** Stripe's own error type (`idempotency_error`, `invalid_request_error`, ...). */
  readonly rawType?: string
  readonly statusCode?: number
  readonly code?: string
  readonly message?: string
  readonly headers?: Record<string, string | undefined>
  readonly payment_intent?: unknown
}

/** The write a refusal is about: it decides how a payment in the wrong state reads. */
export type WriteStep = 'createHold' | 'capture' | 'release' | 'startConnection' | 'prepareDomain'

/** What a failed call reads as. `released` is a release of an intent already cancelled. */
export type Classified =
  | { kind: 'refused'; refusal: PaymentRefusal }
  | { kind: 'unknown'; reason: string }
  | { kind: 'already_released'; intent: StripePaymentIntent }

function asError(error: unknown): StripeErrorLike {
  return typeof error === 'object' && error !== null ? (error as StripeErrorLike) : {}
}

/** Stripe's own words for the Restro team's Log: its type, code and message, with no secret. */
export function detailOf(error: unknown): string {
  const e = asError(error)
  const parts = [e.rawType ?? e.type, e.statusCode, e.code, e.message].filter(
    (part) => part !== undefined && part !== '',
  )
  return withoutSecrets(parts.join(' ')).slice(0, 500)
}

function refused(code: PaymentRefusalCode, error: unknown): Classified {
  const scope = code === 'access_lost' || code === 'account_restricted' ? 'account' : 'payment'
  return { kind: 'refused', refusal: { code, scope, detail: detailOf(error) } }
}

/** True when the failure says nothing final: the call may or may not have landed. */
function isUnknown(e: StripeErrorLike): boolean {
  if (e.statusCode === undefined) return true // no answer: a timeout or a lost connection
  if (e.statusCode >= 500 || e.statusCode === 409 || e.statusCode === 429) return true
  return e.code === 'lock_timeout' || e.code === 'rate_limit' || e.code === 'idempotency_key_in_use'
}

/** The refusal of a capture or a release of an intent that is not in the state the step needs. */
function wrongState(step: WriteStep, error: unknown, intent: StripePaymentIntent): Classified {
  if (intent.status === 'succeeded') return refused('already_captured', error)
  if (intent.status === 'canceled') {
    if (step === 'release') return { kind: 'already_released', intent }
    // `automatic` and `expired`: Stripe dropped the hold itself
    // (https://docs.stripe.com/api/payment_intents/object.md#payment_intent_object-cancellation_reason).
    const expired = ['automatic', 'expired'].includes(intent.cancellation_reason ?? '')
    return refused(expired ? 'hold_expired' : 'not_held', error)
  }
  return refused('not_held', error)
}

/** A failed call of `step`, classified. */
export function classify(step: WriteStep, error: unknown): Classified {
  const e = asError(error)
  if (isUnknown(e)) {
    const replayed = e.headers?.['idempotent-replayed'] === 'true'
    const reason = replayed
      ? `Stripe answered the server error it stored for this key (D127 3.15): ${detailOf(error)}`
      : `no final answer from Stripe: ${detailOf(error)}`
    return { kind: 'unknown', reason: reason.slice(0, 500) }
  }
  if (e.rawType === 'idempotency_error' || e.type === 'StripeIdempotencyError') {
    return refused('key_reused', error)
  }
  if (e.statusCode === 401 || e.statusCode === 403 || e.code === 'account_invalid') {
    return refused('access_lost', error)
  }
  if (e.code === 'resource_missing' || e.statusCode === 404) return refused('not_found', error)
  if (e.code === 'amount_too_small') return refused('amount_too_small', error)
  // A capture above `amount_capturable` is refused with `amount_too_large` (the sandbox, 10-26;
  // the error-codes page names it "greater than the maximum amount allowed").
  if (e.code === 'amount_too_large' && step === 'capture') {
    return refused('amount_above_hold', error)
  }
  if (e.code === 'charge_already_captured') return refused('already_captured', error)
  if (
    e.code === 'charge_expired_for_capture' ||
    e.code === 'capture_charge_authorization_expired'
  ) {
    return refused('hold_expired', error)
  }
  if (e.code === 'payment_intent_unexpected_state' && (step === 'capture' || step === 'release')) {
    const intent = PaymentIntentSchema.safeParse(e.payment_intent)
    if (intent.success) return wrongState(step, error, intent.data)
    return refused(step === 'capture' ? 'not_held' : 'not_supported', error)
  }
  // Any other definite no (a 400 or 402): the capture of a live hold Stripe refused (D127 3.14),
  // or a step Stripe does not do for this account.
  return refused(step === 'capture' ? 'capture_refused' : 'not_supported', error)
}

/** A classified failure as a write outcome (an `already_released` is the caller's to answer). */
export function failedWrite<R>(
  classified: Exclude<Classified, { kind: 'already_released' }>,
): PaymentWriteOutcome<R> {
  return classified.kind === 'refused'
    ? { kind: 'refused', refusal: classified.refusal }
    : { kind: 'unknown', reason: classified.reason }
}

/** True for a read that found nothing: the object is not on this account, or does not exist. */
export function isMissing(error: unknown): boolean {
  const e = asError(error)
  return e.statusCode === 404 || e.code === 'resource_missing'
}
