// The guest commands on the table's shared order (D117, D121; ticket #75): add, change, remove,
// undo and restore, and `order.tidy`, the change time alone makes (an Undo closing, an order set
// aside after its idle time). The engine has already locked the order row of the table's open
// sitting, checked the ring of action ids, the tap's age and the table's rate; a handler here
// applies the shared reducer (`../table-order.ts`) to the stored order at the database's clock,
// writes the row and touches the table, so every phone's next poll sees the change.

import { tableOrders } from '@restro/db'
import { eq, sql } from 'drizzle-orm'

import { GUEST_EVENT_BATCH_MAX, type GuestEventInput } from '../events'
import { newId } from '../ids'
import {
  applyOrderEdit,
  type OrderEdit,
  orderFromRow,
  orderLineIdFor,
  orderToRow,
  type TableOrderDraft,
  tidyOrder,
} from '../table-order'
import { readGuestFeatures } from '../theme'
import type { ServiceTx } from './definition'
import { accepted, refused, type ServiceResult } from './results'
import type { TableOrder } from './rows'

/** Writes the order to its row and touches the table. */
export async function writeOrder(
  stx: ServiceTx,
  row: TableOrder,
  order: TableOrderDraft,
): Promise<void> {
  const [written] = await stx.tx
    .update(tableOrders)
    .set({ ...orderToRow(order), ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(tableOrders.id, row.id))
    .returning()
  if (written === undefined) throw new Error(`the order ${row.id} vanished under its lock`)
  stx.rows.rememberOrder(written)
  stx.rows.touch(row.tableId)
}

/** What is live on the order, dish by dish: the quantity of every line not removed. */
function liveByItem(order: TableOrderDraft): ReadonlyMap<string, number> {
  const live = new Map<string, number>()
  for (const line of order.lines) {
    if (line.removedAt !== null) continue
    live.set(line.itemId, (live.get(line.itemId) ?? 0) + line.qty)
  }
  return live
}

/**
 * The guest's own side of one edit (D142): an event per dish whose live quantity moved, with the
 * dish on it, so a night shows which drinks were thought better of and which were kept. An edit
 * that left the live lines as they were records none; an Undo puts its line back, so it reads as
 * an add. A restore brings a whole order back, so it can move several dishes at once.
 */
function orderEvents(
  before: TableOrderDraft,
  after: TableOrderDraft,
  sittingId: string,
): readonly GuestEventInput[] {
  const was = liveByItem(before)
  const now = liveByItem(after)
  const events: GuestEventInput[] = []
  for (const itemId of new Set([...was.keys(), ...now.keys()])) {
    const moved = (now.get(itemId) ?? 0) - (was.get(itemId) ?? 0)
    if (moved === 0) continue
    events.push({
      kind: moved > 0 ? 'order.line_added' : 'order.line_removed',
      itemId,
      sittingId,
    })
  }
  // An event is never worth failing the write it measures (D142), so a restore of more dishes
  // than one batch takes records the batch rather than throwing.
  return events.length > GUEST_EVENT_BATCH_MAX ? events.slice(0, GUEST_EVENT_BATCH_MAX) : events
}

/** An edit's command: the edit with the table and the action id around it. */
export type OrderEditCommand = OrderEdit & { readonly tableId: string; readonly actionId: string }

/** Applies one guest edit of the order (the engine holds its row). */
export async function editOrder(stx: ServiceTx, command: OrderEditCommand): Promise<ServiceResult> {
  const row = stx.rows.heldOrder(command.tableId)
  if (row === null) return refused(command.actionId, 'table_not_open')
  // Nothing new goes on the order while ordering from the phone is off (the Design tab's switch):
  // the guest page shows no bag then, so only a stale page or a crafted request gets here. The
  // phone's answer is the closed night's: order from a waiter. Lines already there can still go.
  if (command.type === 'order.add' && !readGuestFeatures(stx.venue.settings).ordering) {
    return refused(command.actionId, 'ordering_closed')
  }
  const now = (await stx.dbNow()).getTime()
  // What time has done first: a line whose Undo closed is gone, an idle order is aside.
  const current = tidyOrder(orderFromRow(row), now).order
  const taken = new Set(
    [...current.lines, ...(current.earlier?.lines ?? [])].map((line) => line.id),
  )
  const candidate = orderLineIdFor(command.actionId)
  const outcome = applyOrderEdit(current, command, {
    now,
    newLineId: taken.has(candidate) ? newId('ol') : candidate,
  })
  if (!outcome.ok) return refused(command.actionId, outcome.code)
  await writeOrder(stx, row, outcome.order)
  const events = orderEvents(current, outcome.order, row.sittingId)
  if (events.length > 0) await stx.recordEvents(command.tableId, events)
  return accepted(command.actionId, {
    details: outcome.lineId === null ? {} : { lineId: outcome.lineId },
  })
}

/**
 * Runs what time alone changes on the table's order: the guest API before it answers a read past
 * the order's next change, and the worker's minute tick for orders nobody reads. Changes nothing
 * (and leaves the version alone) when nothing is due, so a repeat is harmless.
 */
export async function tidyTableOrder(
  stx: ServiceTx,
  command: { readonly tableId: string },
): Promise<ServiceResult> {
  const sitting = await stx.rows.openSitting(command.tableId)
  if (sitting === null) return accepted(null, { details: { changed: false } })
  const row = await stx.rows.tableOrder(command.tableId)
  if (row === null) return accepted(null, { details: { changed: false } })
  const tidied = tidyOrder(orderFromRow(row), (await stx.dbNow()).getTime())
  if (tidied.changed) await writeOrder(stx, row, tidied.order)
  return accepted(null, { details: { changed: tidied.changed } })
}
