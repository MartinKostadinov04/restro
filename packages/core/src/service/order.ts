// The guest commands on the table's shared order (D117, D121; ticket #75): add, change, remove,
// undo and restore, and `order.tidy`, the change time alone makes (an Undo closing, an order set
// aside after its idle time). The engine has already locked the order row of the table's open
// sitting, checked the ring of action ids, the tap's age and the table's rate; a handler here
// applies the shared reducer (`../table-order.ts`) to the stored order at the database's clock,
// writes the row and touches the table, so every phone's next poll sees the change.

import { tableOrders } from '@restro/db'
import { eq, sql } from 'drizzle-orm'

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
import type { ServiceTx } from './definition'
import { accepted, refused, type ServiceResult } from './results'
import type { TableOrder } from './rows'

/** Writes the order to its row and touches the table. */
async function writeOrder(stx: ServiceTx, row: TableOrder, order: TableOrderDraft): Promise<void> {
  const [written] = await stx.tx
    .update(tableOrders)
    .set({ ...orderToRow(order), ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(tableOrders.id, row.id))
    .returning()
  if (written === undefined) throw new Error(`the order ${row.id} vanished under its lock`)
  stx.rows.rememberOrder(written)
  stx.rows.touch(row.tableId)
}

/** An edit's command: the edit with the table and the action id around it. */
export type OrderEditCommand = OrderEdit & { readonly tableId: string; readonly actionId: string }

/** Applies one guest edit of the order (the engine holds its row). */
export async function editOrder(stx: ServiceTx, command: OrderEditCommand): Promise<ServiceResult> {
  const row = stx.rows.heldOrder(command.tableId)
  if (row === null) return refused(command.actionId, 'table_not_open')
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
