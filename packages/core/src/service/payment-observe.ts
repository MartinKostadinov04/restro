// What a provider's notice tells about a payment, recorded (#108; D127 4.4, D125 3.5): the amount
// the venue refunded in its own dashboard and where a dispute stands. Restro never refunds; the
// worker reads the payment back from the provider after a notice and passes the reading here.
//
// The values are absolute, as read back, never added up from notices: a notice that comes twice,
// late or out of order reads the payment as it stands now, so recording it again changes nothing.
// The payment must be the one the provider names, captured on Restro's side for the amount the
// provider says; anything else is refused and changes nothing.

import { PAYMENT_DISPUTE_STATES, payments } from '@restro/db'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import { defineCommand } from './definition'
import { accepted, refused } from './results'

// The service path imports nothing under connectors/ (no-outbound.test.ts), so the reading's shape
// is restated here in the database's words: an amount is integer minor units (rule 8), and a
// provider's id has the database's ref pattern.
const MinorSchema = z.int().nonnegative()

/** The worker's step: the provider's reading of one payment, after a notice. */
export function paymentObserve() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.observe'),
      paymentId: idSchema('py'),
      providerKind: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
      /** *Backend*: the provider's id of the payment, as read back. */
      providerPaymentRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/),
      capturedMinor: MinorSchema,
      refundedMinor: MinorSchema,
      dispute: z.enum(PAYMENT_DISPUTE_STATES).nullable(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      stx.rows.claim('payment', [command.paymentId])
      const [payment] = await stx.tx
        .select({
          id: payments.id,
          providerKind: payments.providerKind,
          providerPaymentRef: payments.providerPaymentRef,
          capturedMinor: payments.capturedMinor,
          refundedMinor: payments.refundedMinor,
          dispute: payments.dispute,
        })
        .from(payments)
        .where(and(eq(payments.id, command.paymentId), eq(payments.venueId, stx.venueId)))
        .for('update')
      if (payment === undefined) return refused(null, 'payment_missing')
      if (
        payment.providerKind !== command.providerKind ||
        payment.providerPaymentRef !== command.providerPaymentRef
      ) {
        return refused(null, 'payment_mismatch', { reason: 'another_provider_payment' })
      }
      if (payment.capturedMinor === null) return refused(null, 'payment_not_captured')
      if (
        payment.capturedMinor !== command.capturedMinor ||
        command.refundedMinor > payment.capturedMinor
      ) {
        return refused(null, 'payment_mismatch', { reason: 'captured_amount' })
      }
      if (payment.refundedMinor === command.refundedMinor && payment.dispute === command.dispute) {
        return accepted(null, { details: { changed: false } })
      }
      await stx.tx
        .update(payments)
        .set({
          refundedMinor: command.refundedMinor,
          dispute: command.dispute,
          ...stx.provenance,
          updatedAt: sql`now()`,
        })
        .where(eq(payments.id, payment.id))
      return accepted(null, {
        details: {
          changed: true,
          refundedMinor: command.refundedMinor,
          dispute: command.dispute,
        },
      })
    },
  })
}
