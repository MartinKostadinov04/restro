// Tables open for phones and their sittings (D122 §4, §7; design §1; spec #64, 7; ticket #73). A
// table is open for phones exactly while it has a sitting with no end; there is no flag. Staff
// open a table or every table ("Open all"), close one or every one ("Close all"), and tap "New
// guests" to end one group's sitting and start the next. Each open and each end is a Log entry,
// the end with its reason.
//
// Ending a sitting never deletes a row: the sitting gets its end, and its order row is emptied
// (the lines, the earlier order and the ring of recent actions, the duplicate memory), so unsent
// notes go at once. A location pass names its sitting and is checked against the open one, so
// every pass of an ended sitting is dead without anything stored (D121 3.5). The version rises,
// so each phone at the table learns at its next poll that its data is old.
//
// Staff actions are idempotent by nature (design §2.4): "Open" on an open table answers who
// opened it and when, "Close" on a closed table how and when it closed, and "New guests" names
// the sitting it ends, so a repeat after the new group sat down changes nothing.
//
// Payment tables are never opened for phones (D122 §7). Marking a table as one is a menu-side
// change (core/apply's `setPaymentTableIn`, which hides it and retires its code), run here so the
// permission check and the Log are the service path's own.
//
// Locks: the table rows first (`FOR SHARE` to open, `FOR UPDATE` to mark a payment table), so an
// open and a mark never cross; then the sittings and the order rows in the fixed order (rows.ts);
// taking a mark away then locks the payment table's lease row, last (`paymentHoldsTable`).

import {
  areas,
  billReadings,
  logEntries,
  pauses,
  payments,
  sentOrders,
  sittings,
  tableOrders,
  venueTables,
} from '@restro/db'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import { setPaymentTableIn } from '../apply/tables'
import { newId } from '../ids'
import type { ServiceTx } from './definition'
import { TABLE_VANISHED_CAUSE } from './floor-pause'
import { lockLeases } from './leases'
import { LIFT_REASONS, liftTablePauses } from './pauses'
import { accepted, type ResultDetails, refused, type ServiceResult } from './results'
import type { Sitting } from './rows'
import { changedSince, tokenEntry, type UndoToken } from './undo'

/** Why a sitting ended (the `end_reason` column's list). */
export const SITTING_END_REASONS = [
  /** A complete reading showed the table's POS bill gone or empty after it held lines (#74). */
  'bill_closed',
  /** Staff closed the table, alone or with "Close all". */
  'staff_closed',
  /** Staff tapped "New guests": the next group's sitting starts at once. */
  'new_guests',
  /** The venue's closing hour closed every table. */
  'closing_hour',
  /** The table's code was re-issued. */
  'code_reissued',
] as const

/** One end reason. */
export type SittingEndReason = (typeof SITTING_END_REASONS)[number]

/** How a sitting was opened (the `opened_how` column): one table, or with "Open all". */
type OpenedHow = 'one' | 'all'

/** Why a table can't be opened for phones. */
type OpenRefusal = 'table_missing' | 'payment_table' | 'table_hidden' | 'table_vanished'

/**
 * Locks these tables of the venue `FOR SHARE`, in id order, and says for each whether phones may
 * be let in: a live table that is no payment table, is shown in a shown area and has not left the
 * POS's floor (its pause, #71). A table of another venue, or none, is `table_missing`.
 */
async function openability(
  stx: ServiceTx,
  tableIds: readonly string[],
): Promise<Map<string, OpenRefusal | null>> {
  const wanted = [...new Set(tableIds)].sort()
  const rows =
    wanted.length === 0
      ? []
      : await stx.tx
          .select({
            id: venueTables.id,
            areaId: venueTables.areaId,
            hidden: venueTables.hidden,
            isPaymentTable: venueTables.isPaymentTable,
            archivedAt: venueTables.archivedAt,
          })
          .from(venueTables)
          .where(and(inArray(venueTables.id, wanted), eq(venueTables.venueId, stx.venueId)))
          .orderBy(asc(venueTables.id))
          .for('share')
  const areaIds = [...new Set(rows.map((row) => row.areaId))]
  const hiddenAreas = new Set(
    areaIds.length === 0
      ? []
      : (
          await stx.tx
            .select({ id: areas.id })
            .from(areas)
            .where(
              and(
                inArray(areas.id, areaIds),
                sql`(${areas.hidden} or ${areas.archivedAt} is not null)`,
              ),
            )
        ).map((area) => area.id),
  )
  const vanished = new Set(
    rows.length === 0
      ? []
      : (
          await stx.tx
            .select({ targetId: pauses.targetId })
            .from(pauses)
            .where(
              and(
                eq(pauses.scope, 'table'),
                inArray(
                  pauses.targetId,
                  rows.map((row) => row.id),
                ),
                eq(pauses.cause, TABLE_VANISHED_CAUSE),
                isNull(pauses.liftedAt),
              ),
            )
        ).map((pause) => pause.targetId),
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  return new Map(
    wanted.map((id): [string, OpenRefusal | null] => {
      const row = byId.get(id)
      if (row === undefined || row.archivedAt !== null) return [id, 'table_missing']
      if (row.isPaymentTable) return [id, 'payment_table']
      if (row.hidden || hiddenAreas.has(row.areaId)) return [id, 'table_hidden']
      if (vanished.has(id)) return [id, 'table_vanished']
      return [id, null]
    }),
  )
}

/** Who opened the sitting, by its `sitting.opened` Log entry (its row's provenance moves on). */
async function openedBy(stx: ServiceTx, sitting: Sitting) {
  const [entry] = await stx.tx
    .select({ actor: logEntries.actor, via: logEntries.via })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.venueId, stx.venueId),
        eq(logEntries.tableId, sitting.tableId),
        eq(logEntries.sittingId, sitting.id),
        eq(logEntries.kind, 'sitting.opened'),
      ),
    )
    .orderBy(asc(logEntries.seq))
    .limit(1)
  return {
    sittingId: sitting.id,
    openedAt: sitting.openedAt.toISOString(),
    openedBy: entry?.actor ?? sitting.actor,
    openedVia: entry?.via ?? null,
  }
}

/**
 * Opens a sitting on the table, which the caller locked `update` and found without one. Another
 * writer may open it between that look and this insert (there was no row to lock): then its
 * sitting stands and is returned with `opened: false`.
 */
async function startSitting(
  stx: ServiceTx,
  tableId: string,
  how: OpenedHow,
): Promise<{ readonly sitting: Sitting; readonly opened: boolean }> {
  const [row] = await stx.tx
    .insert(sittings)
    .values({
      id: newId('st'),
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      tableId,
      serviceDate: stx.serviceDate,
      openedHow: how,
      ...stx.provenance,
    })
    .onConflictDoNothing()
    .returning()
  if (row === undefined) {
    const [theirs] = await stx.tx
      .select()
      .from(sittings)
      .where(and(eq(sittings.tableId, tableId), isNull(sittings.endedAt)))
    if (theirs === undefined) throw new Error(`the sitting of ${tableId} could not be opened`)
    return { sitting: theirs, opened: false }
  }
  await stx.rows.orderOfNewSitting(row)
  await stx.log({ kind: 'sitting.opened', tableId, sittingId: row.id, details: { how } })
  return { sitting: row, opened: true }
}

/**
 * Ends an open sitting, which the caller locked `update`: its order is emptied (lines, the earlier
 * order, the ring of recent actions), the reading of the table's bill is emptied (kept for
 * minutes, never as a record), the table's version rises, the sitting gets its end and reason,
 * and the Log says so. Nothing is deleted. A reading ends a sitting through this too (#74).
 */
export async function endSitting(
  stx: ServiceTx,
  sitting: Sitting,
  reason: SittingEndReason,
): Promise<void> {
  const order = await stx.rows.tableOrder(sitting.tableId)
  if (order !== null) {
    const [emptied] = await stx.tx
      .update(tableOrders)
      .set({
        lines: [],
        earlier: null,
        earlierAt: null,
        recentActions: [],
        idleExpiresAt: null,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(tableOrders.id, order.id))
      .returning()
    if (emptied !== undefined) stx.rows.rememberOrder(emptied)
    stx.rows.touch(sitting.tableId)
  }
  stx.rows.claim('bill_reading', [sitting.tableId])
  await stx.tx
    .update(billReadings)
    .set({ bills: [], ...stx.provenance })
    .where(eq(billReadings.tableId, sitting.tableId))
  await stx.tx
    .update(sittings)
    .set({ endedAt: sql`now()`, endReason: reason, ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(sittings.id, sitting.id))
  stx.rows.forgetSitting(sitting.tableId)
  await stx.log({ kind: 'sitting.ended', tableId: sitting.tableId, sittingId: sitting.id, reason })
  // The sitting's end lifts its table's Unconfirmed and guard pauses (#79); a vanished table's
  // pause stays until a reading lists the table again.
  await liftTablePauses(stx, sitting.tableId, LIFT_REASONS.sittingEnded)
}

/** How the table's last sitting ended, for "Close" on a closed table; empty when it never opened. */
async function lastEnd(stx: ServiceTx, tableId: string): Promise<ResultDetails> {
  const [last] = await stx.tx
    .select({
      id: sittings.id,
      endedAt: sittings.endedAt,
      endReason: sittings.endReason,
      actor: sittings.actor,
    })
    .from(sittings)
    .where(and(eq(sittings.tableId, tableId), isNotNull(sittings.endedAt)))
    .orderBy(desc(sittings.endedAt))
    .limit(1)
  if (last === undefined || last.endedAt === null) return {}
  // An ended sitting is never written again, so its provenance is its end's.
  return {
    sittingId: last.id,
    endedAt: last.endedAt.toISOString(),
    endReason: last.endReason,
    endedBy: last.actor,
  }
}

/** `table.open`: opens the table for phones, or says who already did. */
export async function openTable(
  stx: ServiceTx,
  command: { readonly tableId: string },
): Promise<ServiceResult> {
  const refusal = (await openability(stx, [command.tableId])).get(command.tableId) ?? null
  const open = await stx.rows.openSitting(command.tableId, 'update')
  if (open !== null) {
    return accepted(null, { details: { opened: false, ...(await openedBy(stx, open)) } })
  }
  if (refusal !== null) return refused(null, refusal)
  const { sitting, opened } = await startSitting(stx, command.tableId, 'one')
  return accepted(null, { details: { opened, ...(await openedBy(stx, sitting)) } })
}

/** `table.close`: ends the table's sitting, or says how its last one ended. */
export async function closeTable(
  stx: ServiceTx,
  command: { readonly tableId: string },
): Promise<ServiceResult> {
  const open = await stx.rows.openSitting(command.tableId, 'update')
  if (open === null) {
    return accepted(null, { details: { closed: false, ...(await lastEnd(stx, command.tableId)) } })
  }
  await endSitting(stx, open, 'staff_closed')
  return accepted(null, { details: { closed: true, sittingId: open.id } })
}

/**
 * Whether anyone but staff has been at this open sitting since the token's entry: lines in its
 * cart, a round already rung at the POS (`hadBillLines`), a sent order or a payment of it, or a Log
 * entry for it from another job. Opening a table and a bare scan of its code leave none of these.
 * The caller holds the sitting and its order row.
 */
async function sittingHasActivity(
  stx: ServiceTx,
  sitting: Sitting,
  entry: number,
): Promise<boolean> {
  if (sitting.hadBillLines) return true
  const order = await stx.rows.tableOrder(sitting.tableId)
  if (order !== null && order.lines.length > 0) return true
  const [sent] = await stx.tx
    .select({ id: sentOrders.id })
    .from(sentOrders)
    .where(eq(sentOrders.sittingId, sitting.id))
    .limit(1)
  if (sent !== undefined) return true
  const [paid] = await stx.tx
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.sittingId, sitting.id))
    .limit(1)
  if (paid !== undefined) return true
  return changedSince(stx, entry, eq(logEntries.sittingId, sitting.id))
}

/**
 * `table.close`, also the Undo of an open (#219). With an `undo` token the table must still be in
 * the sitting that open began, and no guest may have used it: otherwise `undo_stale`, and the
 * sitting stays. Without a token it is the normal close.
 */
export async function closeTableUndoing(
  stx: ServiceTx,
  command: { readonly tableId: string; readonly undo?: UndoToken | undefined },
): Promise<ServiceResult> {
  if (command.undo === undefined) return closeTable(stx, command)
  const opened = await tokenEntry(stx, command.undo)
  if (
    opened === null ||
    opened.kind !== 'sitting.opened' ||
    opened.tableId !== command.tableId ||
    opened.sittingId === null
  ) {
    return refused(null, 'invalid_command')
  }
  const open = await stx.rows.openSitting(command.tableId, 'update')
  if (open === null || open.id !== opened.sittingId) return refused(null, 'undo_stale')
  if (await sittingHasActivity(stx, open, command.undo.entry)) return refused(null, 'undo_stale')
  return closeTable(stx, command)
}

/** How many table ids a refusal names: its details hold 200 characters. */
function idsThatFit(ids: readonly string[]): string {
  let text = ''
  for (const id of ids) {
    const next = text === '' ? id : `${text},${id}`
    if (next.length > 200) break
    text = next
  }
  return text
}

/**
 * `tables.undo_open_all`: the Undo of Open all (#219), all or nothing. The token must be the entry
 * of a `sitting.opened` that Open all wrote (`how: all`); the sittings are those of that job. A
 * sitting already ended, or whose table was opened again since, is left alone (the new sitting is
 * not ours). If a sitting we opened and that is still open shows activity, nothing is closed and
 * the answer is `undo_stale` with the tables named; otherwise every one ends `staff_closed`.
 */
export async function undoOpenAll(
  stx: ServiceTx,
  command: { readonly undo: UndoToken },
): Promise<ServiceResult> {
  const token = await tokenEntry(stx, command.undo)
  if (token === null || token.kind !== 'sitting.opened' || token.details.how !== 'all') {
    return refused(null, 'invalid_command')
  }
  const ours = await stx.tx
    .select({ tableId: logEntries.tableId, sittingId: logEntries.sittingId })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.venueId, stx.venueId),
        eq(logEntries.jobId, token.jobId),
        eq(logEntries.kind, 'sitting.opened'),
        sql`${logEntries.details} ->> 'how' = 'all'`,
      ),
    )
  const byTable = new Map<string, string>()
  for (const row of ours) {
    if (row.tableId !== null && row.sittingId !== null) byTable.set(row.tableId, row.sittingId)
  }
  const tableIds = [...byTable.keys()].sort()
  const open = await stx.rows.openSittings(tableIds, 'update')
  await stx.rows.tableOrders(tableIds)
  const mine: Sitting[] = []
  for (const tableId of tableIds) {
    const sitting = open.get(tableId)
    // Closed already, or opened again by someone else: not ours to touch.
    if (sitting !== null && sitting !== undefined && sitting.id === byTable.get(tableId)) {
      mine.push(sitting)
    }
  }
  const used: string[] = []
  for (const sitting of mine) {
    if (await sittingHasActivity(stx, sitting, command.undo.entry)) used.push(sitting.tableId)
  }
  if (used.length > 0) {
    return refused(null, 'undo_stale', { count: used.length, tables: idsThatFit(used) })
  }
  for (const sitting of mine) await endSitting(stx, sitting, 'staff_closed')
  return accepted(null, {
    details: { closed: mine.length, skipped: tableIds.length - mine.length },
  })
}

/**
 * `table.new_guests`: ends the sitting named (or the open one, when none is named) and opens the
 * next at once; on a closed table it opens one. When the table's open sitting is no longer the one
 * named, the new group has sat down already and nothing changes.
 */
export async function newGuests(
  stx: ServiceTx,
  command: { readonly tableId: string; readonly sittingId?: string | undefined },
): Promise<ServiceResult> {
  const refusal = (await openability(stx, [command.tableId])).get(command.tableId) ?? null
  const open = await stx.rows.openSitting(command.tableId, 'update')
  if (command.sittingId !== undefined && open?.id !== command.sittingId) {
    return accepted(null, {
      details: { renewed: false, ...(open === null ? {} : await openedBy(stx, open)) },
    })
  }
  if (refusal !== null) return refused(null, refusal)
  if (open !== null) await endSitting(stx, open, 'new_guests')
  const { sitting } = await startSitting(stx, command.tableId, 'one')
  return accepted(null, {
    details: { renewed: true, endedSittingId: open?.id ?? null, ...(await openedBy(stx, sitting)) },
  })
}

/**
 * `tables.open_all`: opens every table of the venue that phones may use and is closed. Payment,
 * hidden and vanished tables are left closed and counted as skipped.
 */
export async function openAllTables(stx: ServiceTx): Promise<ServiceResult> {
  const live = await stx.tx
    .select({ id: venueTables.id })
    .from(venueTables)
    .where(and(eq(venueTables.venueId, stx.venueId), isNull(venueTables.archivedAt)))
  const checked = await openability(
    stx,
    live.map((table) => table.id),
  )
  const candidates = [...checked].filter(([, refusal]) => refusal === null).map(([id]) => id)
  const open = await stx.rows.openSittings(candidates, 'update')
  let opened = 0
  for (const tableId of candidates) {
    if (open.get(tableId) !== null) continue
    if ((await startSitting(stx, tableId, 'all')).opened) opened += 1
  }
  return accepted(null, {
    details: {
      opened,
      alreadyOpen: candidates.length - opened,
      skipped: checked.size - candidates.length,
    },
  })
}

/** `tables.close_all`: ends the sitting of every table of the venue that is open for phones. */
export async function closeAllTables(stx: ServiceTx): Promise<ServiceResult> {
  return closeOpenTables(stx, 'staff_closed')
}

/**
 * Ends every open sitting of the venue for `reason`: "Close all", and the closing hour (#82).
 * With `keepPaying` (the closing hour), a table whose sitting has a payment not yet settled is
 * left open for a later run: D122 ends such a sitting only after the close and capture, and
 * closing it would kill a card form or lose the route of a held payment. The wait is bounded by
 * the payment's own deadlines (2 and 10 minutes) or, once it is held, by the close and capture
 * (#111).
 */
export async function closeOpenTables(
  stx: ServiceTx,
  reason: SittingEndReason,
  options: { readonly keepPaying?: boolean } = {},
): Promise<ServiceResult> {
  const seen = await stx.tx
    .select({ tableId: sittings.tableId })
    .from(sittings)
    .where(and(eq(sittings.venueId, stx.venueId), isNull(sittings.endedAt)))
  const tableIds = seen.map((row) => row.tableId).sort()
  const open = await stx.rows.openSittings(tableIds, 'update')
  const locked = tableIds.flatMap((tableId) => {
    const sitting = open.get(tableId)
    return sitting === null || sitting === undefined ? [] : [sitting]
  })
  const paying =
    options.keepPaying === true
      ? await sittingsWithOpenPayment(
          stx,
          locked.map((sitting) => sitting.id),
        )
      : new Set<string>()
  const ending = locked.filter((sitting) => !paying.has(sitting.id))
  await stx.rows.tableOrders(ending.map((sitting) => sitting.tableId))
  for (const sitting of ending) await endSitting(stx, sitting, reason)
  return accepted(null, { details: { closed: ending.length } })
}

/** Which of these sittings have a payment that has not reached a final state. */
async function sittingsWithOpenPayment(
  stx: ServiceTx,
  sittingIds: readonly string[],
): Promise<Set<string>> {
  if (sittingIds.length === 0) return new Set()
  const rows = await stx.tx
    .selectDistinct({ sittingId: payments.sittingId })
    .from(payments)
    .where(and(inArray(payments.sittingId, [...sittingIds]), isNull(payments.settledAt)))
  return new Set(rows.map((row) => row.sittingId))
}

/**
 * Whether a payment holds this payment table: the lease its payment owns from `queued` until the
 * payment is final and the table reads empty (D127), or a payment of the table that is not final.
 * Takes the lease row after the table row, as the lock order has it.
 */
async function paymentHoldsTable(stx: ServiceTx, tableId: string): Promise<boolean> {
  const key = { scope: 'payment_table', key: tableId } as const
  const held = await lockLeases(stx, [key])
  if ([...held.values()].some((lease) => lease.holder !== null)) return true
  const [open] = await stx.tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.paymentTableId, tableId), isNull(payments.settledAt)))
    .limit(1)
  return open !== undefined
}

/**
 * `table.mark_payment`: marks the table as a payment table of its bar, or takes the mark away (a
 * `record` Log entry). A table open for phones is closed first (`table_open`). Taking the mark away
 * is refused `payment_table_busy` while a payment holds the table (its lease, or a payment of the
 * table that is not final): the route would be left on a table that is no longer marked. The answer
 * names the files of the code the mark retired, for the caller's token job.
 */
export async function markPaymentTable(
  stx: ServiceTx,
  command: { readonly tableId: string; readonly isPaymentTable: boolean },
): Promise<ServiceResult> {
  await stx.tx
    .select({ id: venueTables.id })
    .from(venueTables)
    .where(eq(venueTables.id, command.tableId))
    .for('update')
  if (command.isPaymentTable && (await stx.rows.openSitting(command.tableId, 'share')) !== null) {
    return refused(null, 'table_open')
  }
  if (!command.isPaymentTable && (await paymentHoldsTable(stx, command.tableId))) {
    return refused(null, 'payment_table_busy')
  }
  const change = await setPaymentTableIn(stx.tx, command.tableId, command.isPaymentTable)
  if (!change.ok) {
    return refused(null, change.error === 'unknown_table' ? 'table_missing' : change.error)
  }
  if (change.changed) {
    await stx.log({
      kind: 'settings.changed',
      tableId: command.tableId,
      reason: 'payment_table',
      details: { isPaymentTable: command.isPaymentTable },
    })
  }
  return accepted(null, {
    details: { changed: change.changed, retired: change.retired.join(',') },
  })
}
