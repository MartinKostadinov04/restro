// Send (D115–D117; ticket #77): the guest's `order.send`. The engine has already checked the
// table code, the location pass's sitting, locked the table's order and looked the action id up
// (a repeat gets the sent order it made). Here, under the order's lock:
// 1. a table, bar or venue whose ordering is paused refuses the Send (`ordering_paused`, D120);
// 2. the lines the Send names must be the order's live lines that no payment holds, as the guest
//    saw them (`order_changed`), and there must be some (`order_empty`);
// 3. each line is priced from the table's menu (the snapshot plus tonight's sold-out marks, which
//    the guest API read before the transaction): an item that is gone, not orderable or sold out
//    refuses the Send (`item_unavailable`) and the lines stay on the order;
// 4. the lines leave the order, a `waiting` sent order is written with a short reference a waiter
//    reads (K7Q), each line's note is kept apart (`sent_order_notes`), and the table is touched.
// The worker takes it from there (`sent-order.ts`): Restro never calls the POS here.

import { randomInt } from 'node:crypto'

import { pauses, sentOrderNotes, sentOrders, venueTables } from '@restro/db'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import {
  ORDER_LIMITS,
  orderFromRow,
  type SendRequestLine,
  takeSentLines,
  tidyOrder,
} from '../table-order'
import type { ServiceTx } from './definition'
import { recordRetainUntil } from './log'
import { writeOrder } from './order'
import { accepted, refused, type ServiceResult } from './results'
import { priceSentLines } from './send-menu'

/** The letters a reference is drawn from: no 0/O, 1/I/L, 2/Z, 5/S, 8/B, G or so look-alikes. */
export const REFERENCE_ALPHABET = 'ACDEFHJKMNPQRTUVWXY34679'

/** A reference's length; one longer after a few clashes in a busy night. */
const REFERENCE_LENGTH = 3

/** Draws a reference of `length` characters. */
export function drawReference(length = REFERENCE_LENGTH): string {
  let reference = ''
  for (let i = 0; i < length; i++) {
    reference += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]
  }
  return reference
}

/** Why a Send was refused, beside the engine's codes. */
export const SEND_REFUSALS = [
  'ordering_paused',
  'menu_unavailable',
  'order_changed',
  'order_empty',
  'item_unavailable',
] as const

/** One line of a sent order as stored (`sent_orders.lines`): no note (it is kept apart). */
export const SentOrderLineSchema = z.strictObject({
  id: idSchema('ol'),
  itemId: idSchema('nd'),
  optionIds: z.array(idSchema('nd')).max(ORDER_LIMITS.options),
  qty: z.int().min(1).max(ORDER_LIMITS.quantity),
  /** The unit price: the item's plus its options' deltas, in minor units. */
  unitMinor: z.int().nonnegative(),
  /** The POS's name where the item came from one, else the menu's (for staff, never a guest). */
  name: z.string().max(200),
  optionNames: z.array(z.string().max(200)).max(ORDER_LIMITS.options),
  /** Set when the order ended Not sent because the POS says this item ran out (#80). */
  outOfStock: z.literal(true).optional(),
})

/** One stored line of a sent order. */
export type SentOrderLine = z.output<typeof SentOrderLineSchema>

/** The stored lines of a sent order, each checked; a line that fails is dropped. */
export function sentOrderLinesOf(stored: unknown): SentOrderLine[] {
  if (!Array.isArray(stored)) return []
  return stored.flatMap((entry) => {
    const parsed = SentOrderLineSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/** The `order.send` command, as its schema parses it. */
export interface SendCommand {
  readonly tableId: string
  readonly actionId: string
  readonly lines: readonly SendRequestLine[]
}

/** True when ordering at this table is paused: the table itself, its bar or the whole venue. */
export async function orderingPaused(
  stx: ServiceTx,
  tableId: string,
  barId: string | null,
): Promise<boolean> {
  const targets = [
    and(eq(pauses.scope, 'table'), eq(pauses.targetId, tableId)),
    and(eq(pauses.scope, 'venue'), eq(pauses.targetId, stx.venueId)),
  ]
  if (barId !== null) targets.push(and(eq(pauses.scope, 'bar'), eq(pauses.targetId, barId)))
  const [active] = await stx.tx
    .select({ id: pauses.id })
    .from(pauses)
    .where(and(eq(pauses.venueId, stx.venueId), isNull(pauses.liftedAt), or(...targets)))
    .limit(1)
  return active !== undefined
}

/** Sends the table's order (the engine holds the order row). */
export async function sendOrder(stx: ServiceTx, command: SendCommand): Promise<ServiceResult> {
  const { actionId, tableId } = command
  const row = stx.rows.heldOrder(tableId)
  if (row === null) return refused(actionId, 'table_not_open')
  const [table] = await stx.tx
    .select({ barId: venueTables.barId })
    .from(venueTables)
    .where(eq(venueTables.id, tableId))
  const barId = table?.barId ?? null
  if (await orderingPaused(stx, tableId, barId)) return refused(actionId, 'ordering_paused')
  const menu = stx.sendMenu
  if (menu === null) return refused(actionId, 'menu_unavailable')

  const now = await stx.dbNow()
  const current = tidyOrder(orderFromRow(row), now.getTime()).order
  const taken = takeSentLines(current, command.lines, now.getTime())
  if (!taken.ok) return refused(actionId, taken.code)
  const priced = priceSentLines(menu, taken.lines)
  if (!priced.ok) return refused(actionId, priced.code, { itemId: priced.itemId })

  const lines: SentOrderLine[] = taken.lines.map((line, index) => {
    const price = priced.lines[index]
    if (price === undefined) throw new Error('a priced line is missing')
    return SentOrderLineSchema.parse({
      id: line.id,
      itemId: line.itemId,
      optionIds: line.optionIds,
      qty: line.qty,
      unitMinor: price.unitMinor,
      name: price.name,
      optionNames: price.optionNames,
    })
  })

  const id = newId('so')
  let reference: string | null = null
  for (let attempt = 0; attempt < 12 && reference === null; attempt++) {
    const candidate = drawReference(attempt < 8 ? REFERENCE_LENGTH : REFERENCE_LENGTH + 1)
    const inserted = await stx.tx
      .insert(sentOrders)
      .values({
        id,
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        tableId,
        sittingId: row.sittingId,
        barId,
        serviceDate: stx.serviceDate,
        kind: 'on_bill',
        reference: candidate,
        state: 'waiting',
        lines,
        totalMinor: priced.totalMinor,
        actionId,
        consentVersion: stx.consentVersion,
        retainUntil: recordRetainUntil(now),
        ...stx.provenance,
      })
      .onConflictDoNothing({
        target: [sentOrders.venueId, sentOrders.serviceDate, sentOrders.reference],
      })
      .returning({ id: sentOrders.id })
    if (inserted.length > 0) reference = candidate
  }
  if (reference === null) throw new Error('no free reference for the sent order')

  const notes = taken.lines.filter((line) => line.note !== '')
  if (notes.length > 0) {
    await stx.tx.insert(sentOrderNotes).values(
      notes.map((line) => ({
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        sentOrderId: id,
        lineId: line.id,
        note: line.note,
        serviceDate: stx.serviceDate,
        ...stx.provenance,
      })),
    )
  }

  await writeOrder(stx, row, taken.order)
  await stx.log({
    kind: 'sent_order.state',
    sentOrderId: id,
    tableId,
    sittingId: row.sittingId,
    toState: 'waiting',
    details: { lines: lines.length, totalMinor: priced.totalMinor },
  })
  return accepted(actionId, { ref: reference, details: { sentOrderId: id } })
}

/** The notes of a sent order's lines, by line id. */
export async function sentOrderNotesOf(
  stx: ServiceTx,
  sentOrderIds: readonly string[],
): Promise<Map<string, string>> {
  if (sentOrderIds.length === 0) return new Map()
  const rows = await stx.tx
    .select({ lineId: sentOrderNotes.lineId, note: sentOrderNotes.note })
    .from(sentOrderNotes)
    .where(inArray(sentOrderNotes.sentOrderId, [...sentOrderIds]))
  return new Map(rows.map((row) => [row.lineId, row.note]))
}
