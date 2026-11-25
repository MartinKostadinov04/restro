// One line of a sent order as stored (`sent_orders.lines`, #77), apart from Send so the guards
// (#78) and the sent order's moves read it, and give it back, without importing Send.

import { sentOrderNotes } from '@restro/db'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { ORDER_LIMITS, orderFromRow, returnSentLines, tidyOrder } from '../table-order'
import type { ServiceTx } from './definition'
import { writeOrder } from './order'
import type { SentOrder } from './rows'

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

/** The notes kept apart from these sent orders' lines, by line id. */
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

/**
 * Puts the lines of these sent orders back on the table's order, with their notes, when the order
 * is still their sitting's (a new group never gets the last group's lines). The caller holds the
 * table's order.
 */
export async function giveLinesBack(stx: ServiceTx, sent: readonly SentOrder[]): Promise<void> {
  if (sent.length === 0) return
  const table = sent[0]?.tableId
  if (table === undefined) return
  const row = stx.rows.heldOrder(table)
  if (row === null) return
  const ours = sent.filter((one) => one.sittingId === row.sittingId)
  if (ours.length === 0) return
  const notes = await sentOrderNotesOf(
    stx,
    ours.map((one) => one.id),
  )
  const now = (await stx.dbNow()).getTime()
  const current = tidyOrder(orderFromRow(row), now).order
  const lines = ours.flatMap((one) =>
    sentOrderLinesOf(one.lines).map((line) => ({ ...line, note: notes.get(line.id) ?? '' })),
  )
  await writeOrder(
    stx,
    row,
    returnSentLines(current, lines, now, () => newId('ol')),
  )
}
