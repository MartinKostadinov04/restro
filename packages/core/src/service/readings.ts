// Recording a reading of a table's POS bills, and the sitting's end by a reading (D122 §4, §6;
// D111; ticket #74). The worker reads the table outside any transaction and hands the reading to
// `reading.record`, which decides under the sitting's lock:
//
// - With no open sitting nothing is stored: the bill is the sitting's.
// - A partial reading concludes nothing (rule 6): the bill shown stays the last complete one, the
//   row only says the latest reading failed. No sitting ends, no order clears, no pause lifts.
// - A complete reading overwrites the row in place with our ids and names (`bill.ts`) and marks
//   the sitting as having had lines once any POS bill holds one.
// - A complete reading is also matched with the table's Unconfirmed sent orders (`late-landing.ts`,
//   #135): one that shows up after all is written to the Log, never resent or set back to Added.
// - The sitting ends (`bill_closed`) when a complete reading shows every POS bill gone or empty
//   after they held lines, unless the table's lines sit on a payment table (part 2's payment
//   owns them until it is done).
//
// The table is touched (its version rises) only when what a phone sees changed: the bill, or
// whether the latest reading was complete.
//
// Locks, in the fixed order: the sitting `update` (the reading may end it), the order, the
// reading's row.

import {
  billReadings,
  fieldValues,
  nodes,
  pauses,
  payments,
  sittings,
  sourceLinks,
} from '@restro/db'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { Layer, Scope, Source } from '../change-set'
import { canonicalJson } from '../hash'
import { idSchema, type NodeId } from '../ids'
import { venueLanguages } from '../languages'
import type { LocalizedText } from '../locales'
import { combineField, readsLayer } from '../resolve/combine'
import { indexRows, isEmptyValue, pickLayers, type ValueRow } from '../resolve/layers'
import { findField } from '../template'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import {
  billView,
  type LineItem,
  parseStoredBills,
  type StoredBill,
  sittingEndsByReading,
  storedBills,
  TableReadingSchema,
} from './bill'
import { defineCommand, type ServiceTx } from './definition'
import { lockLateCandidates, recordLateLandings } from './late-landing'
import { LIFT_REASONS, liftTablePauses } from './pauses'
import { accepted } from './results'
import { ORDER_UNCONFIRMED_CAUSE } from './sent-order'
import { endSitting } from './sittings'

const ITEM_NAME = findField(VENUE_MENU_TEMPLATE, 'item', 'name')

/** The bill-id key the caller passed (`BILL_ID_KEY`); a reading can't be stored without it. */
function billIdKey(stx: ServiceTx): string {
  if (stx.billIdKey === null) throw new Error('a reading needs the bill-id key (BILL_ID_KEY)')
  return stx.billIdKey
}

/**
 * Our items for these POS items, through the till links of the reading's instance whose node is
 * an item, with their names resolved for the venue as the menu resolves them (the override over
 * the till's text). The link's node type says it is an item's link, so no connector's link types
 * are needed here.
 */
async function lineItems(
  stx: ServiceTx,
  posItems: readonly string[],
): Promise<Map<string, LineItem>> {
  const found = new Map<string, LineItem>()
  if (posItems.length === 0 || stx.actor.kind !== 'integration') return found
  const links = await stx.tx
    .select({ externalId: sourceLinks.externalId, nodeId: sourceLinks.nodeId })
    .from(sourceLinks)
    .innerJoin(nodes, eq(nodes.id, sourceLinks.nodeId))
    .where(
      and(
        eq(sourceLinks.integrationId, stx.actor.integrationId),
        eq(nodes.nodeType, 'item'),
        inArray(sourceLinks.externalId, [...new Set(posItems)]),
      ),
    )
  if (links.length === 0) return found

  const nodeIds = [...new Set(links.map((link) => link.nodeId))]
  const rows = await stx.tx
    .select()
    .from(fieldValues)
    .where(and(inArray(fieldValues.nodeId, nodeIds), eq(fieldValues.fieldKey, 'name')))
  const values: ValueRow[] = rows.map((row) => ({
    nodeId: row.nodeId as NodeId,
    fieldKey: row.fieldKey,
    layer: row.layer as Layer,
    scope: row.scope as Scope,
    value: row.value,
    valueHash: row.valueHash,
    source: row.source as Source,
    observedAt: row.observedAt.toISOString(),
    basis: row.basis ?? null,
    valid: row.valid,
  }))
  const index = indexRows(values, `venue:${stx.venueId}`, () => false)
  const locales = [...venueLanguages(stx.venue).all]
  const nameOf = (nodeId: NodeId): LocalizedText | null => {
    if (ITEM_NAME === undefined) return null
    const picked = pickLayers(
      ITEM_NAME,
      index.get(nodeId)?.get('name'),
      (layer) => readsLayer(ITEM_NAME, true, layer),
      false,
    )
    const { value } = combineField({
      definition: ITEM_NAME,
      layers: picked.values,
      linkedToTill: true,
      locales,
    }).field
    if (value === null || value === undefined || isEmptyValue(ITEM_NAME, value)) return null
    return value as LocalizedText
  }
  for (const link of links) {
    const itemId = link.nodeId as NodeId
    found.set(link.externalId, { itemId, name: nameOf(itemId) })
  }
  return found
}

/** True while some of the sitting's lines sit on a payment table (part 2's hook). */
async function onPaymentTable(stx: ServiceTx, sittingId: string): Promise<boolean> {
  const [held] = await stx.tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.sittingId, sittingId), isNotNull(payments.paymentTableId)))
    .limit(1)
  return held !== undefined
}

/** What a phone sees of a reading row, to tell whether a new reading changed it. */
function shown(row: { complete: boolean; bills: unknown } | null): string {
  if (row === null) return 'none'
  const view = billView({
    readAt: new Date(0),
    complete: row.complete,
    bills: parseStoredBills(row.bills),
  })
  return canonicalJson({ ...view, readAt: null })
}

/**
 * Lifts the table's Unconfirmed pause after a complete reading (D120, #79) when every POS bill
 * of the table is closed (it held lines once: an empty table is not a closed bill), or when a
 * waiter acted at the till: a line staff entered (the connector says who entered a line only
 * where its POS does) that the last stored reading did not show, entered after the pause started
 * where the POS gives the time.
 */
async function liftUnconfirmed(
  stx: ServiceTx,
  tableId: string,
  hadBillLines: boolean,
  before: readonly StoredBill[],
  after: readonly StoredBill[],
): Promise<void> {
  const [pause] = await stx.tx
    .select({ startedAt: pauses.startedAt })
    .from(pauses)
    .where(
      and(
        eq(pauses.scope, 'table'),
        eq(pauses.targetId, tableId),
        eq(pauses.cause, ORDER_UNCONFIRMED_CAUSE),
        isNull(pauses.liftedAt),
      ),
    )
  if (pause === undefined) return
  if (hadBillLines && after.every((bill) => bill.lines.length === 0)) {
    await liftTablePauses(stx, tableId, LIFT_REASONS.billsClosed, [ORDER_UNCONFIRMED_CAUSE])
    return
  }
  const keyOf = (bill: StoredBill, line: StoredBill['lines'][number]) => `${bill.pos} ${line.pos}`
  const seen = new Set(before.flatMap((bill) => bill.lines.map((line) => keyOf(bill, line))))
  const acted = after.some((bill) =>
    bill.lines.some(
      (line) =>
        line.enteredBy === 'staff' &&
        !seen.has(keyOf(bill, line)) &&
        (line.enteredAt === null || new Date(line.enteredAt) >= pause.startedAt),
    ),
  )
  if (acted) {
    await liftTablePauses(stx, tableId, LIFT_REASONS.waiterActed, [ORDER_UNCONFIRMED_CAUSE])
  }
}

/** `reading.record`: stores a reading of the table's POS bills and ends the sitting it closes. */
export function recordReading() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('reading.record'),
      tableId: idSchema('tb'),
      reading: TableReadingSchema,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const key = billIdKey(stx)
      const sitting = await stx.rows.openSitting(command.tableId, 'update')
      if (sitting === null) return accepted(null, { details: { recorded: false } })
      await stx.rows.tableOrder(command.tableId)
      // A complete reading may show an Unconfirmed sent order after all (#135); its row is locked
      // before the reading's (`lock-order.ts`).
      const lateCandidates = command.reading.complete
        ? await lockLateCandidates(stx, command.tableId, sitting.id)
        : []
      stx.rows.claim('bill_reading', [command.tableId])
      const [before] = await stx.tx
        .select()
        .from(billReadings)
        .where(eq(billReadings.tableId, command.tableId))
        .for('update')

      const reading = command.reading
      if (!reading.complete) {
        // Rule 6: the bill and its age stay those of the last complete reading. With none yet,
        // the row's time is the epoch, "never read well": older than any sitting, so no bill is
        // shown (never an empty one) and the table stays due for a reading.
        if (before === undefined) {
          await stx.tx.insert(billReadings).values({
            tenantId: stx.tenantId,
            venueId: stx.venueId,
            tableId: command.tableId,
            readSeq: 1,
            readAt: sql`to_timestamp(0)`,
            complete: false,
            bills: [],
            ...stx.provenance,
          })
        } else {
          await stx.tx
            .update(billReadings)
            .set({ readSeq: sql`${billReadings.readSeq} + 1`, complete: false, ...stx.provenance })
            .where(eq(billReadings.tableId, command.tableId))
        }
        // A phone sees the change only where a bill was shown: it is now marked not up to date.
        if (before?.complete === true) stx.rows.touch(command.tableId)
        return accepted(null, { details: { recorded: true, complete: false, ended: false } })
      }

      const posItems = reading.bills.flatMap((bill) =>
        bill.lines.flatMap((line) => (line.itemPos === null ? [] : [line.itemPos])),
      )
      const items = await lineItems(stx, posItems)
      const bills = storedBills({
        key,
        tenantId: stx.tenantId,
        currency: reading.currency,
        bills: reading.bills,
        itemOf: (pos) => items.get(pos),
      })
      const after = { complete: true, bills }
      await stx.tx
        .insert(billReadings)
        .values({
          tenantId: stx.tenantId,
          venueId: stx.venueId,
          tableId: command.tableId,
          readSeq: 1,
          readAt: sql`now()`,
          ...after,
          ...stx.provenance,
        })
        .onConflictDoUpdate({
          target: [billReadings.tenantId, billReadings.tableId],
          set: {
            readSeq: sql`${billReadings.readSeq} + 1`,
            readAt: sql`now()`,
            ...after,
            ...stx.provenance,
          },
        })
      if (shown(before ?? null) !== shown(after)) stx.rows.touch(command.tableId)
      await recordLateLandings(stx, lateCandidates, bills)

      const lines = bills.reduce((sum, bill) => sum + bill.lines.length, 0)
      if (lines > 0 && !sitting.hadBillLines) {
        await stx.tx
          .update(sittings)
          .set({ hadBillLines: true, ...stx.provenance, updatedAt: sql`now()` })
          .where(eq(sittings.id, sitting.id))
      }
      const ends = sittingEndsByReading({
        complete: true,
        hadBillLines: sitting.hadBillLines,
        bills,
        onPaymentTable: sitting.hadBillLines && (await onPaymentTable(stx, sitting.id)),
      })
      if (ends) await endSitting(stx, sitting, 'bill_closed')
      else {
        await liftUnconfirmed(
          stx,
          command.tableId,
          sitting.hadBillLines || lines > 0,
          parseStoredBills(before?.bills ?? []),
          bills,
        )
      }
      return accepted(null, {
        details: { recorded: true, complete: true, ended: ends, bills: bills.length, lines },
      })
    },
  })
}
