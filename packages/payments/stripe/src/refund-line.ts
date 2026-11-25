// The one refund Restro makes (the 11-18 refund decision, 148): `refundLine`, a part of a payment
// Restro captured, for a line staff marked "Not served". It is the only place in Restro that calls
// the provider's refund API (`scripts/no-refunds.test.ts` names this file), and only the worker's
// refund job calls the step.
//
// What it refuses on its own, whatever the platform asked, against what Stripe holds now:
//   - a payment that is not Restro's (no payment id of ours on it, or another one's);
//   - a payment that is not captured;
//   - an amount above what is left of the payment to refund.
// A retry of the same refund row repeats the same idempotency key, so Stripe refunds once. The
// refund is stamped with our refund row (`restro_refund`), so a refund made with this key without
// Restro's own code can be told from the venue's own, made in its dashboard.
//
// The call goes through its own client, built with the refund-only restricted key; every other
// step uses the platform's key, which has no refund right (`createStripeProvider`).

import {
  type PaymentWriteOutcome,
  type ProviderPayment,
  type ProviderRef,
  type ProviderRefund,
  type Reading,
  type RefundLineRequest,
  RefundLineRequestSchema,
  subtractMinor,
} from '@restro/core'
import type Stripe from 'stripe'

import { RefundSchema } from './api'
import { withoutSecrets } from './config'
import { classify, failedWrite } from './errors'
import { providerRefund, REFUND_METADATA_KEY } from './mapping'

export interface RefundLineDeps {
  /** A client built with the refund-only restricted key. */
  readonly refundClient: Stripe
  /**
   * The payment as Stripe holds it now (the platform's key reads it); null when Stripe has none by
   * that id on the account, or it carries no payment id of ours: not a payment Restro made.
   */
  readonly readPayment: (
    accountRef: ProviderRef,
    paymentRef: ProviderRef,
  ) => Promise<Reading<ProviderPayment | null>>
}

function refusedBy(code: 'not_eligible' | 'amount_above_remaining', detail: string) {
  return {
    kind: 'refused' as const,
    refusal: { code, scope: 'payment' as const, detail },
  }
}

export async function refundLine(
  deps: RefundLineDeps,
  request: RefundLineRequest,
): Promise<PaymentWriteOutcome<ProviderRefund>> {
  const req = RefundLineRequestSchema.parse(request)
  const read = await deps.readPayment(req.accountRef, req.paymentRef)
  if (!read.complete) {
    return { kind: 'unknown', reason: withoutSecrets(read.reason).slice(0, 500) }
  }
  const payment = read.value
  // Only a payment Restro made (our payment id is on it, and it is this one) and captured.
  if (payment === null || payment.paymentId !== req.paymentId) {
    return refusedBy('not_eligible', 'the payment is not one Restro made')
  }
  if (payment.status !== 'captured') {
    return refusedBy('not_eligible', `the payment is ${payment.status}, not captured`)
  }
  if (req.amountMinor > subtractMinor(payment.capturedMinor, payment.refundedMinor)) {
    return refusedBy('amount_above_remaining', 'more than is left of the payment to refund')
  }
  let answer: unknown
  try {
    // POST /v1/refunds on the venue's account (a direct charge): part of a PaymentIntent, once by
    // key, stamped with our refund row (https://docs.stripe.com/api/refunds/create.md,
    // https://docs.stripe.com/refunds.md, https://docs.stripe.com/connect/direct-charges.md).
    answer = await deps.refundClient.refunds.create(
      {
        payment_intent: req.paymentRef.provider,
        amount: req.amountMinor,
        metadata: { [REFUND_METADATA_KEY]: req.refundId },
      },
      { stripeAccount: req.accountRef.provider, idempotencyKey: req.idempotencyKey },
    )
  } catch (error) {
    const classified = classify('refundLine', error)
    if (classified.kind === 'already_released') {
      return { kind: 'unknown', reason: 'Stripe answered an unexpected state' }
    }
    return failedWrite(classified)
  }
  const refund = RefundSchema.safeParse(answer)
  if (!refund.success) return { kind: 'unknown', reason: 'Stripe answered an unreadable refund' }
  const mapped = providerRefund(refund.data)
  if (!mapped.ok) return { kind: 'unknown', reason: mapped.reason.slice(0, 500) }
  return { kind: 'done', result: mapped.value }
}
