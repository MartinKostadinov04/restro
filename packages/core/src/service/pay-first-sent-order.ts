// The sent order of a pay-first payment (#113): the guest's round, written at Send in `waiting`,
// ends as its payment's route says. The payment owns it: the send worker never takes it up.
// - Entered on a payment table → `added`, with the POS bill it opened (kept in the row, rule 3).
// - Ended before the POS → `not_sent`; its entry unknown → `unconfirmed` until a manager answers.
// - A manager says it is not on the till → `not_sent`, its lines back in the bag (D116).

import { sentOrders } from '@restro/db'
import { and, eq, inArray, sql } from 'drizzle-orm'

import type { ServiceTx } from './definition'
import { giveLinesBack } from './sent-lines'

/** What a pay-first sent order moves by: its payment's row. */
interface PayFirstPayment {
  readonly tableId: string
  readonly sentOrderId: string | null
}

/**
 * Moves the payment's sent order from one of `from` to `to` (no move from any other state) and
 * logs it. The caller holds its lock (`lockSentOrder`).
 */
export async function movePayFirstSentOrder(
  stx: ServiceTx,
  payment: PayFirstPayment,
  from: readonly string[],
  to: 'added' | 'not_sent' | 'unconfirmed',
  more: { readonly reason?: string | null; readonly posBillRef?: string | null } = {},
): Promise<boolean> {
  if (payment.sentOrderId === null) return false
  const final = to !== 'unconfirmed'
  const moved = await stx.tx
    .update(sentOrders)
    .set({
      state: to,
      reason: more.reason ?? null,
      ...(more.posBillRef === undefined ? {} : { posBillRef: more.posBillRef }),
      ...(final ? { settledAt: sql`now()` } : {}),
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(and(eq(sentOrders.id, payment.sentOrderId), inArray(sentOrders.state, [...from])))
    .returning({ id: sentOrders.id, sittingId: sentOrders.sittingId })
  for (const sent of moved) {
    await stx.log({
      kind: 'sent_order.state',
      sentOrderId: sent.id,
      tableId: payment.tableId,
      sittingId: sent.sittingId,
      toState: to,
      ...(more.reason == null ? {} : { reason: more.reason }),
    })
  }
  return moved.length > 0
}

/**
 * A manager answered a pay-first payment whose round was unconfirmed: "Receipt printed" and "on
 * the till" mean the round is on the POS (`added`); "No receipt" means the guest is not charged
 * for it, and "not on the till" that the round is not on the POS (any more), so it is Not sent and
 * its lines return to the bag, once, with Try again (D116). "No receipt" gives nothing back: staff
 * deal with the round where it is. No answer here touches the POS.
 */
export async function settlePayFirstSentOrder(
  stx: ServiceTx,
  payment: PayFirstPayment & { readonly kind: string },
  answer: 'receipt_printed' | 'no_receipt' | 'on_till' | 'not_on_till',
): Promise<void> {
  if (payment.kind !== 'pay_first') return
  if (answer === 'receipt_printed' || answer === 'on_till') {
    await movePayFirstSentOrder(stx, payment, ['unconfirmed'], 'added')
    return
  }
  const from = answer === 'not_on_till' ? ['unconfirmed', 'added'] : ['unconfirmed']
  const moved = await movePayFirstSentOrder(stx, payment, from, 'not_sent', { reason: answer })
  if (!moved || answer !== 'not_on_till' || payment.sentOrderId === null) return
  await giveLinesBack(
    stx,
    await stx.tx.select().from(sentOrders).where(eq(sentOrders.id, payment.sentOrderId)),
  )
}
