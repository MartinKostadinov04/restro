// A person's answer to an Unconfirmed sent order (D116, plan §5 S8; ticket #85): after looking at
// the bill in the POS, staff say "Found on the bill" (the order counts as Added) or "Not on the bill"
// (it counts as Not sent, its lines go back on the table's order). The one way out of Unconfirmed:
// `sent_order.transition` never moves it (`MOVES`), and nothing but this command settles it. In one
// transaction the sent order settles with the reason `staff_found` / `staff_not_found`, the Log
// names who answered, the table's Unconfirmed pause lifts (as `table.resume` does) and the
// order's alert closes. A late landing Restro found by itself (#135) changes nothing: staff still
// answer.
//
// Lock order (`lock-order.ts`): the table's order, the sent order, the pause, the alert.

import { alerts, sentOrders } from '@restro/db'
import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import { defineCommand, type ServiceTx } from './definition'
import { LIFT_REASONS, liftTablePauses } from './pauses'
import { accepted, refused, type ServiceResult } from './results'
import { moveSentOrder, ORDER_UNCONFIRMED_ALERT, ORDER_UNCONFIRMED_CAUSE } from './sent-order'

/** What staff may answer. */
export const SENT_ORDER_ANSWERS = ['found', 'not_found'] as const

/** One answer. */
export type SentOrderAnswer = (typeof SENT_ORDER_ANSWERS)[number]

/** The reason the sent order keeps for each answer; the sent orders screen reads it. */
const REASON: Readonly<Record<SentOrderAnswer, string>> = {
  found: 'staff_found',
  not_found: 'staff_not_found',
}

/** The state each answer settles the order in. */
const STATE: Readonly<Record<SentOrderAnswer, 'added' | 'not_sent'>> = {
  found: 'added',
  not_found: 'not_sent',
}

async function answer(
  stx: ServiceTx,
  command: { readonly sentOrderId: string; readonly answer: SentOrderAnswer },
): Promise<ServiceResult> {
  const [found] = await stx.tx
    .select({ tableId: sentOrders.tableId })
    .from(sentOrders)
    .where(and(eq(sentOrders.id, command.sentOrderId), eq(sentOrders.venueId, stx.venueId)))
  if (found === undefined) return refused(null, 'sent_order_missing')
  await stx.rows.tableOrder(found.tableId)
  const sent = (await stx.rows.sentOrders([command.sentOrderId])).get(command.sentOrderId)
  if (sent === undefined) return refused(null, 'sent_order_missing')
  // A pay-first round is answered through its payment (`payment.answer`, #113).
  if (sent.kind === 'pay_first') return refused(null, 'sent_order_settled', { state: sent.state })

  if (sent.state !== 'unconfirmed') {
    // The same answer again changes nothing; a different one, or any other state, is refused.
    if (sent.state === STATE[command.answer] && sent.reason === REASON[command.answer]) {
      return accepted(null, { details: { changed: false, state: sent.state } })
    }
    const answered = Object.values(REASON).includes(sent.reason ?? '')
    return answered
      ? refused(null, 'sent_order_answered', { answer: sent.reason })
      : refused(null, 'sent_order_settled', { state: sent.state })
  }

  const to = STATE[command.answer]
  await moveSentOrder(stx, sent, { to, reason: REASON[command.answer] }, null, [])

  // The table's Unconfirmed pause lifts, unless another Unconfirmed order of the table still holds it.
  const [other] = await stx.tx
    .select({ id: sentOrders.id })
    .from(sentOrders)
    .where(
      and(
        eq(sentOrders.tableId, sent.tableId),
        eq(sentOrders.state, 'unconfirmed'),
        eq(sentOrders.kind, 'on_bill'),
        ne(sentOrders.id, sent.id),
      ),
    )
    .limit(1)
  const lifted =
    other === undefined
      ? await liftTablePauses(stx, sent.tableId, LIFT_REASONS.staffResumed, [
          ORDER_UNCONFIRMED_CAUSE,
        ])
      : 0

  // The order's alert closes with the answer.
  stx.rows.claim('alert', [`${ORDER_UNCONFIRMED_ALERT}:${sent.id}`])
  const [alert] = await stx.tx
    .select({ id: alerts.id, doneAt: alerts.doneAt })
    .from(alerts)
    .where(and(eq(alerts.kind, ORDER_UNCONFIRMED_ALERT), eq(alerts.subjectId, sent.id)))
    .for('update')
  if (alert !== undefined && alert.doneAt === null) {
    await stx.tx
      .update(alerts)
      .set({
        doneAt: sql`now()`,
        doneBy: stx.provenance.actor,
        via: stx.via,
        nextRepeatAt: null,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(alerts.id, alert.id))
    // The same table and sent order as the raised line, so the Log names the table of both (RR-91).
    await stx.log({
      kind: 'alert.done',
      tableId: sent.tableId,
      sittingId: sent.sittingId,
      sentOrderId: sent.id,
      reason: ORDER_UNCONFIRMED_ALERT,
      details: { alertId: alert.id },
    })
  }
  return accepted(null, { details: { changed: true, state: to, lifted } })
}

/** `sent_order.answer`: staff settle an Unconfirmed sent order after looking at the bill. */
export function sentOrderAnswer() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('sent_order.answer'),
      sentOrderId: idSchema('so'),
      answer: z.enum(SENT_ORDER_ANSWERS),
    }),
    origins: ['staff'],
    permission: 'alerts.answer',
    idempotency: 'by_nature',
    handle: answer,
  })
}
