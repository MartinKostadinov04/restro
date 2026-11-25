// One payment over several tables of a linked group (D160 §2, #542): which group pays across its
// tables, and the tables a payment covers.
//
// **Across tables** only where the POS isolates by moving lines to a table (`moveLinesToTable`,
// one bill a table): each table's picks then move onto one payment table and close there once
// (one fiscal receipt, one capture). Where the POS splits a bill off on its own table
// (`severalBillsPerTable`), a split bill stays on its table, so a payment over two tables would
// close twice: there each phone pays its own table, one table at a time. Every member table must
// be served by the same POS instance, or no move joins them.
//
// **The tables a payment covers** are its lines' tables (`payment_lines.table_id`, migration
// 0057), its own among them. They never change once the payment is made, so a lock reads them
// before the locks they decide, in table-id order (the lock order's rule for one rank).

import { integrations, paymentLines, places, type ReadTx } from '@restro/db'
import { and, eq, inArray, ne } from 'drizzle-orm'

import { GROUP_TABLES_MAX } from '../linked-group-limits'
import { readServiceCapabilities } from '../service-capabilities-config'
import type { ServiceTx } from './definition'
import { byCodeUnits } from './reservations/linked-group'

/** The read side of a transaction. */
type Readable = Pick<ReadTx, 'select' | 'selectDistinct'>

/**
 * True when one payment may cover lines of these tables (a linked group's members): one POS
 * instance serves them all, and it moves lines to a payment table, one bill a table. A group of
 * more than `GROUP_TABLES_MAX` tables never does: its phones are shown only the first of them.
 */
export async function groupPaysAcross(tx: Readable, tableIds: readonly string[]): Promise<boolean> {
  if (tableIds.length < 2 || tableIds.length > GROUP_TABLES_MAX) return false
  const rows = await tx
    .select({
      tableId: places.tableId,
      integrationId: integrations.id,
      removedAt: integrations.removedAt,
      config: integrations.config,
    })
    .from(places)
    .innerJoin(integrations, eq(integrations.id, places.integrationId))
    .where(and(inArray(places.tableId, [...tableIds]), ne(places.state, 'deleted')))
  const served = new Set(rows.map((row) => row.tableId))
  if (tableIds.some((tableId) => !served.has(tableId))) return false
  if (new Set(rows.map((row) => row.integrationId)).size !== 1) return false
  return rows.every((row) => {
    const capabilities = readServiceCapabilities(row.config)
    return (
      row.removedAt === null && capabilities.moveLinesToTable && !capabilities.severalBillsPerTable
    )
  })
}

/** The tables a payment's lines are on, its own table among them, in table-id order. */
export async function paymentTablesOf(
  tx: Readable,
  payment: { readonly id: string; readonly tableId: string },
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ tableId: paymentLines.tableId })
    .from(paymentLines)
    .where(eq(paymentLines.paymentId, payment.id))
  return [...new Set([payment.tableId, ...rows.map((row) => row.tableId)])].sort(byCodeUnits)
}

/**
 * Locks the order row of every table the payment covers, in table-id order. Each lock of a
 * payment takes these first (the lock order), so a change to the payment can touch every table
 * whose phones show its lines.
 */
export async function lockPaymentTables(
  stx: ServiceTx,
  payment: { readonly id: string; readonly tableId: string },
): Promise<void> {
  await stx.rows.tableOrders(await paymentTablesOf(stx.tx, payment))
}

/**
 * Touches every table the payment covers that is open: its lines read `beingPaid`, or free again,
 * on each of them. Only after `lockPaymentTables`.
 */
export async function touchPaymentTables(
  stx: ServiceTx,
  payment: { readonly id: string; readonly tableId: string },
): Promise<void> {
  for (const tableId of await paymentTablesOf(stx.tx, payment)) {
    if (stx.rows.heldOrder(tableId) !== null) stx.rows.touch(tableId)
  }
}
