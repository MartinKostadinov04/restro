// What a provider's notice tells about a payment, recorded (#108; D127 4.4, D125 3.5): the amount
// the venue refunded in its own dashboard and where a dispute stands. Restro never refunds; the
// worker reads the payment back from the provider after a notice and passes the reading here.
//
// The values are absolute, as read back, never added up from notices: a notice that comes twice,
// late or out of order reads the payment as it stands now, so recording it again changes nothing.
// The payment must be the one the provider names, captured on Restro's side for the amount the
// provider says; anything else is refused and changes nothing.

import { alerts, PAYMENT_DISPUTE_STATES, payments } from '@restro/db'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { PAYMENT_DISPUTED_KIND, PAYMENT_REFUNDED_KIND } from './alert-rules'
import { defineCommand, type ServiceTx } from './definition'
import { type Locked, lockRoute, refusedLock } from './pay-route'
import {
  closeAlertRows,
  FOLLOW_UP_ALERT_PERMISSION,
  openAlertsOf,
  reconcileRefunds,
} from './payment-refunds'
import { accepted, refused } from './results'

// The service path imports nothing under connectors/ (no-outbound.test.ts), so the reading's shape
// is restated here in the database's words: an amount is integer minor units (rule 8), and a
// provider's id has the database's ref pattern.
const MinorSchema = z.int().nonnegative()

/** How long a payment is kept after its dispute closed (M6, D122 §8). */
export const DISPUTE_RETENTION_MONTHS = 6

/** When a payment whose dispute closed at `closedAt` may be erased at the earliest. */
export function disputeRetainUntil(closedAt: Date): Date {
  const until = new Date(closedAt.getTime())
  until.setUTCMonth(until.getUTCMonth() + DISPUTE_RETENTION_MONTHS)
  return until
}

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
      /** The provider's answer-by date of the dispute (ISO), where it gives one. */
      disputeDueAt: z.iso.datetime().nullable().default(null),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_REFUNDED_KIND, PAYMENT_DISPUTED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
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
      const dueAt = command.disputeDueAt === null ? null : new Date(command.disputeDueAt)
      const sameDue =
        (payment.disputeDueAt?.getTime() ?? null) === (dueAt?.getTime() ?? null) ||
        command.dispute === null
      if (
        payment.refundedMinor === command.refundedMinor &&
        payment.dispute === command.dispute &&
        sameDue
      ) {
        return accepted(null, { details: { changed: false } })
      }

      const refunds =
        payment.refundedMinor === command.refundedMinor
          ? { added: 0, failed: 0 }
          : await reconcileRefunds(stx, locked, command.refundedMinor)
      const dispute = await observeDispute(stx, locked, command.dispute, dueAt)

      await stx.tx
        .update(payments)
        .set({
          refundedMinor: command.refundedMinor,
          dispute: command.dispute,
          ...dispute,
          ...stx.provenance,
          updatedAt: sql`now()`,
        })
        .where(eq(payments.id, payment.id))
      return accepted(null, {
        details: {
          changed: true,
          refundedMinor: command.refundedMinor,
          dispute: command.dispute,
          refundsAdded: refunds.added,
          refundsFailed: refunds.failed,
        },
      })
    },
  })
}

/**
 * What a dispute reading changes on the payment (decision log 5.9–5.11): when it opened, when it
 * closed, the answer-by date, and the retention. The to-do is read from the payment's state; the
 * alert for the venue's group is raised once when a dispute opens and closes when it ends.
 */
async function observeDispute(
  stx: ServiceTx,
  locked: Locked,
  next: (typeof PAYMENT_DISPUTE_STATES)[number] | null,
  dueAt: Date | null,
): Promise<Partial<typeof payments.$inferInsert>> {
  const { payment } = locked
  const prev = payment.dispute
  if (next === null) {
    if (prev === null) return {}
    // The provider no longer calls it a dispute (an inquiry closed without a chargeback).
    await closeAlertRows(stx, await openAlertsOf(stx, payment.id, PAYMENT_DISPUTED_KIND))
    await logDispute(stx, locked, 'none')
    return { disputeOpenedAt: null, disputeClosedAt: null, disputeDueAt: null }
  }
  const now = await stx.dbNow()
  if (next === 'open') {
    if (prev === 'open') return { disputeDueAt: dueAt }
    await stx.tx.insert(alerts).values({
      id: newId('al'),
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      serviceDate: stx.serviceDate,
      kind: PAYMENT_DISPUTED_KIND,
      audience: 'venue',
      subjectId: payment.id,
      permission: FOLLOW_UP_ALERT_PERMISSION,
      details: {
        paymentId: payment.id,
        tableId: payment.tableId,
        paymentDate: payment.serviceDate,
        providerKind: payment.providerKind,
      },
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    await logDispute(stx, locked, 'open')
    return { disputeOpenedAt: now, disputeClosedAt: null, disputeDueAt: dueAt }
  }
  // `won` or `lost`: the to-do leaves, and the payment is kept six months from now (M6).
  if (prev === next) return {}
  await closeAlertRows(stx, await openAlertsOf(stx, payment.id, PAYMENT_DISPUTED_KIND))
  await logDispute(stx, locked, next)
  const keep = disputeRetainUntil(now)
  return {
    disputeOpenedAt: payment.disputeOpenedAt ?? now,
    disputeClosedAt: now,
    disputeDueAt: dueAt ?? payment.disputeDueAt,
    retainUntil:
      payment.retainUntil === null || payment.retainUntil.getTime() < keep.getTime()
        ? keep
        : payment.retainUntil,
  }
}

async function logDispute(stx: ServiceTx, locked: Locked, state: string): Promise<void> {
  const { payment } = locked
  await stx.log({
    kind: 'payment.dispute',
    paymentId: payment.id,
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    toState: state,
    details: { providerKind: payment.providerKind },
  })
}
