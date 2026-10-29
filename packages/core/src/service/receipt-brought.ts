// "Bring the receipt" and "Brought" (#200; D122 §7, D127 4.4; Tonight screen 1, S7). Every capture
// of a payment (`payment.captured`) on which no electronic receipt was sent leaves a paper receipt
// for the waiter to bring to the payer, who shows the payment number (`receiptToBringAt`). The
// POS's receipt number is shown where it gave one and is never required: a capture with none is
// no refusal. Staff mark it Brought, the same shape as Handled on a waiter call: once for the
// payment, no PIN on a shared device (the Log names the device's account), a repeat changes
// nothing. Undo puts it back. The payment row carries the mark, so the day's receipts not brought
// are one read of `payments`.
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
 * `no_receipt_to_bring` for a payment that never left one (not captured yet, or its electronic
 * receipt was sent); a missing receipt number is no reason to refuse.
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

/**
 * `receipt.unbrought`: Undo of Brought. The server sets no time limit on it, like Tonight's other
 * Undos; the screen offers it for the toast's 8 seconds.
 */
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
