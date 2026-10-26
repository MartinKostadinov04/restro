// Send (D115–D117; ticket #77): the guest's `order.send`. The engine has already checked the
// table code, the location pass's sitting, locked the table's order and looked the action id up
// (a repeat gets the sent order it made). Here, under the order's lock:
// 1. a table, bar or venue whose ordering is paused refuses the Send (`ordering_paused`, D120);
// 2. the lines the Send names must be the order's live lines that no payment holds, as the guest
//    saw them (`order_changed`), and there must be some (`order_empty`);
// 3. each line is priced from the table's menu (the snapshot plus tonight's sold-out marks, which
//    the guest API read before the transaction). A line the menu can't take tonight (gone, not
//    orderable, sold out) stays on the order and the Send goes without it ("Send the other 4",
//    #78); a Send that names such a line refuses (`item_unavailable`, with how many others could
//    go) and the lines stay on the order;
// 4. the guards (`send-guards.ts`, #78): what the POS can't take goes through the waiter (a note or
//    options that don't reach the ticket: `order_from_waiter`; a table with no POS bill where
//    first items don't open one: `needs_first_item`); the same round in the last 15 minutes asks
//    first (`duplicate_order`, until a new action confirms it); and a round over the venue's cap
//    or past its pace refuses (`guard_tripped`) and pauses the table for "ask your waiter";
// 5. the lines leave the order, a `waiting` sent order is written with a short reference a waiter
//    reads (K7Q), each line's note is kept apart (`sent_order_notes`), and the table is touched.
// The worker takes it from there (`sent-order.ts`): Restro never calls the POS here.

import { randomInt } from 'node:crypto'

import { pauses, sentOrderNotes, sentOrders, venueTables } from '@restro/db'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'

import { newId } from '../ids'
import { readOrderingSettings } from '../ordering-settings'
import { orderFromRow, type SendRequestLine, takeSentLines, tidyOrder } from '../table-order'
import type { ServiceTx } from './definition'
import { recordRetainUntil } from './log'
import { writeOrder } from './order'
import { accepted, refused, type ServiceResult } from './results'
import {
  findDuplicate,
  recentSentOrders,
  type SendGuard,
  tableHasNoPosBill,
  tripGuard,
} from './send-guards'
import { lineAvailable, priceSentLines } from './send-menu'
import { type SentOrderLine, SentOrderLineSchema } from './sent-lines'
import { readTableCapabilities } from './table-capabilities'

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
  'order_from_waiter',
  'needs_first_item',
  'duplicate_order',
  'guard_tripped',
] as const

export { type SentOrderLine, SentOrderLineSchema, sentOrderLinesOf } from './sent-lines'

/** The `order.send` command, as its schema parses it. */
export interface SendCommand {
  readonly tableId: string
  readonly actionId: string
  readonly lines: readonly SendRequestLine[]
  /** The sent order the guest's "Send another" answered (a new action after `duplicate_order`). */
  readonly confirmDuplicateOf?: string | undefined
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
  const keptBack = (line: { readonly itemId: string; readonly optionIds: readonly string[] }) =>
    !lineAvailable(menu, line)
  const named = command.lines.find(keptBack)
  if (named !== undefined) {
    const others = current.lines.filter(
      (line) => line.removedAt === null && line.heldBy === null && !keptBack(line),
    ).length
    return refused(actionId, 'item_unavailable', { itemId: named.itemId, others })
  }
  const taken = takeSentLines(current, command.lines, now.getTime(), keptBack)
  if (!taken.ok) return refused(actionId, taken.code)
  const priced = priceSentLines(menu, taken.lines)
  if (!priced.ok) return refused(actionId, priced.code, { itemId: priced.itemId })

  const capabilities = await readTableCapabilities(stx.tx, tableId)
  if (!capabilities.notesReachTicket) {
    const waiter = taken.lines.find(
      (line) =>
        line.optionIds.length > 0 ||
        line.note.trim() !== '' ||
        menu.items.get(line.itemId)?.requiredOptions === true,
    )
    if (waiter !== undefined)
      return refused(actionId, 'order_from_waiter', { itemId: waiter.itemId })
  }
  if (!capabilities.firstItemsOpenBill && (await tableHasNoPosBill(stx, tableId, now))) {
    return refused(actionId, 'needs_first_item')
  }

  const target = { tableId, sittingId: row.sittingId }
  const duplicate = await findDuplicate(stx, target, taken.lines, now)
  if (duplicate !== null && command.confirmDuplicateOf !== duplicate.sentOrderId) {
    return refused(actionId, 'duplicate_order', {
      duplicateOf: duplicate.sentOrderId,
      minutesAgo: duplicate.minutesAgo,
    })
  }
  const settings = readOrderingSettings(stx.venue.settings)
  const trip = (guard: SendGuard, details: Readonly<Record<string, number>>): ServiceResult => {
    stx.keepOnRefusal(() => tripGuard(stx, { guard, ...target, details }))
    return refused(actionId, 'guard_tripped', { guard, ...details })
  }
  if (settings.capMinor !== null && priced.totalMinor > settings.capMinor) {
    return trip('cap', { capMinor: settings.capMinor, totalMinor: priced.totalMinor })
  }
  const pace = settings.pacePer15Minutes
  if (pace !== null && (await recentSentOrders(stx, tableId, now)) >= pace) {
    return trip('pace', { pacePer15Minutes: pace })
  }

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
