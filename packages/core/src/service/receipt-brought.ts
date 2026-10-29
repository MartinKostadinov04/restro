// "Bring the receipt" and "Brought" (#200; D122 §7, D127 4.4; Tonight screen 1, S7). A payment
// captured with a receipt number from the POS and no electronic receipt sent (`payment.captured`
// sets `receiptToBringAt`) leaves a paper receipt for the waiter to bring to the payer, who shows
// the payment number. Staff mark it Brought, the same shape as Handled on a waiter call: once for
// the payment, no PIN on a shared device (the Log names the device's account), a repeat changes
// nothing. Undo (the 8 s toast) puts it back. The payment row carries the mark, so the day's
// receipts not brought are one read of `payments`.
//
// Locks: the table's rows first, then the payment (`lockRoute`, as the paying route does).

import { payments } from '@restro/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import { defineCommand, type ServiceTx } from './definition'
import { lockRoute, refusedLock } from './pay-route'
import { accepted, refused, type ServiceResult } from './results'

const paymentId = idSchema('py')

/** The command both ways take: the payment whose paper receipt it is. */
const ReceiptSchema = (type: 'receipt.brought' | 'receipt.unbrought') =>
  z.strictObject({ type: z.literal(type), paymentId })

/** Marks the paper receipt Brought, or puts it back (`brought` false). */
async function mark(
  stx: ServiceTx,
  command: { readonly paymentId: string },
  brought: boolean,
): Promise<ServiceResult> {
  const locked = await lockRoute(stx, command.paymentId)
  if (refusedLock(locked)) return locked
  const { payment } = locked
  if (payment.receiptToBringAt === null) return refused(null, 'no_receipt_to_bring')
  if ((payment.receiptBroughtAt !== null) === brought) {
    return accepted(null, { details: { paymentId: payment.id, brought, changed: false } })
  }
  await stx.tx
    .update(payments)
    .set({
      receiptBroughtAt: brought ? await stx.dbNow() : null,
      receiptBroughtBy: brought ? stx.provenance.actor : null,
      ...stx.provenance,
      updatedAt: await stx.dbNow(),
    })
    .where(eq(payments.id, payment.id))
  await stx.log({
    kind: 'receipt.brought',
    paymentId: payment.id,
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    fromState: brought ? 'to_bring' : 'brought',
    toState: brought ? 'brought' : 'to_bring',
  })
  return accepted(null, { details: { paymentId: payment.id, brought, changed: true } })
}

/**
 * `receipt.brought`: staff mark the payment's paper receipt Brought. Refused
 * `no_receipt_to_bring` for a payment that never left one (not captured, no receipt number, or its
 * electronic receipt was sent).
 */
export function receiptBrought() {
  return defineCommand({
    schema: ReceiptSchema('receipt.brought'),
    origins: ['staff'],
    permission: 'alerts.answer',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: (stx, command) => mark(stx, command, true),
  })
}

/** `receipt.unbrought`: Undo of Brought, within the toast's 8 seconds on the screen. */
export function receiptUnbrought() {
  return defineCommand({
    schema: ReceiptSchema('receipt.unbrought'),
    origins: ['staff'],
    permission: 'alerts.answer',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: (stx, command) => mark(stx, command, false),
  })
}
