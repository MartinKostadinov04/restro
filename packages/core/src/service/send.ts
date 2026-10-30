// Send (D115–D117; ticket #77): the guest's `order.send`. The engine has already checked the
// table code, the location pass's sitting, locked the table's order and looked the action id up
// (a repeat gets the sent order it made). Here, under the order's lock:
// 1. a table, bar or venue whose ordering is paused refuses the Send (`ordering_paused`, D120), and
//    so does a night that is not open for phones: before opening, after last orders, a closed
//    weekday (`ordering_closed`, #82);
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
// Pay-first lines (#113) are a Send's second part (`payFirst`): never on the bill, they are held on
// the order for a payment of kind `pay_first` with its own `waiting` sent order (`pay-first.ts`).
// A Send may have either part, or both; its pay-first part names the lines the guest pays for now:
// any of the order's pay-first lines no payment holds, or all of them where the bill part goes too
// ("Send and pay").
// The worker takes it from there (`sent-order.ts`): Restro never calls the POS here.

import { randomInt } from 'node:crypto'

import { sentOrderNotes, sentOrders, venueTables } from '@restro/db'
import { eq } from 'drizzle-orm'

import { type AreaId, type BarId, newId, type TableId } from '../ids'
import { readOrderingSettings } from '../ordering-settings'
import { itemPaymentMode, payFirstApplies, readPayFirstSettings } from '../pay-first-settings'
import { guestNight, phonesMaySend } from '../service-hours'
import { orderFromRow, type SendRequestLine, takeSentLines, tidyOrder } from '../table-order'
import type { ServiceTx } from './definition'
import { recordRetainUntil } from './log'
import { writeOrder } from './order'
import { orderingPaused } from './pause-scope'
import {
  insertPayFirst,
  PAY_FIRST_SEND_REFUSALS,
  type PayFirstSendPart,
  preparePayFirst,
} from './pay-first'
import { accepted, refused, type ServiceResult } from './results'
import {
  findDuplicate,
  recentSentOrders,
  type SendGuard,
  tableHasNoPosBill,
  tripGuard,
} from './send-guards'
import { lineAvailable, type PricedLine, priceSentLines } from './send-menu'
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
  'ordering_closed',
  'menu_unavailable',
  'order_changed',
  'order_empty',
  'item_unavailable',
  'order_from_waiter',
  'needs_first_item',
  'duplicate_order',
  'guard_tripped',
  // A Send with pay-first lines (#113).
  ...PAY_FIRST_SEND_REFUSALS,
] as const

export {
  type SentOrderLine,
  SentOrderLineSchema,
  sentOrderLinesOf,
  sentOrderNotesOf,
} from './sent-lines'

/** The `order.send` command, as its schema parses it. */
export interface SendCommand {
  readonly tableId: string
  readonly actionId: string
  readonly lines: readonly SendRequestLine[]
  /** The sent order the guest's "Send another" answered (a new action after `duplicate_order`). */
  readonly confirmDuplicateOf?: string | undefined
  /** The lines the guest pays for first, with the tip and the handle's hash (#113). */
  readonly payFirst?: PayFirstSendPart | undefined
}

export { orderingPaused } from './pause-scope'

/** Sends the table's order (the engine holds the order row). */
export async function sendOrder(stx: ServiceTx, command: SendCommand): Promise<ServiceResult> {
  const { actionId, tableId } = command
  const row = stx.rows.heldOrder(tableId)
  if (row === null) return refused(actionId, 'table_not_open')
  const [table] = await stx.tx
    .select({ barId: venueTables.barId, areaId: venueTables.areaId })
    .from(venueTables)
    .where(eq(venueTables.id, tableId))
  const barId = table?.barId ?? null
  if (await orderingPaused(stx, tableId, barId)) return refused(actionId, 'ordering_paused')
  // The venue's night (#82): not before opening, not after last orders, not on a closed weekday.
  const hours = guestNight(
    readOrderingSettings(stx.venue.settings),
    stx.venue.timezone,
    stx.venue.serviceDayEndsAt,
    stx.now,
  )
  if (!phonesMaySend(hours)) return refused(actionId, 'ordering_closed')
  const menu = stx.sendMenu
  if (menu === null) return refused(actionId, 'menu_unavailable')

  const now = await stx.dbNow()
  const current = tidyOrder(orderFromRow(row), now.getTime()).order
  // Pay-first items (#113): where pay-first applies at the table, an item paid first (its own
  // mode, else the venue's default) goes in the Send's pay-first part, never on the bill.
  const payFirstSettings = readPayFirstSettings(stx.venue.settings)
  const applies =
    table !== undefined &&
    payFirstApplies(payFirstSettings, {
      tableId: tableId as TableId,
      barId: barId as BarId | null,
      areaId: table.areaId as AreaId,
    })
  const isPayFirst = (line: { readonly itemId: string }) =>
    applies &&
    itemPaymentMode(menu.items.get(line.itemId)?.paymentMode, payFirstSettings) === 'pay_first'
  const keptBack = (line: { readonly itemId: string; readonly optionIds: readonly string[] }) =>
    !lineAvailable(menu, line) || isPayFirst(line)
  const payFirstPart = command.payFirst
  const named = [...command.lines, ...(payFirstPart?.lines ?? [])].find(
    (line) => !lineAvailable(menu, line),
  )
  if (named !== undefined) {
    const others = current.lines.filter(
      (line) => line.removedAt === null && line.heldBy === null && lineAvailable(menu, line),
    ).length
    return refused(actionId, 'item_unavailable', { itemId: named.itemId, others })
  }
  // A pay-first line named on the bill: the phone's order is not the server's.
  if (command.lines.some(isPayFirst)) return refused(actionId, 'order_changed')

  let order = current
  let onBill: { readonly lines: SentOrderLine[]; readonly totalMinor: number } | null = null
  let notes: { readonly id: string; readonly note: string }[] = []
  const target = { tableId, sittingId: row.sittingId }
  if (command.lines.length > 0 || payFirstPart === undefined) {
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
    order = taken.order
    onBill = { lines: sentLinesOf(taken.lines, priced.lines), totalMinor: priced.totalMinor }
    notes = taken.lines.filter((line) => line.note !== '')
  }
  // A Send of pay-first lines alone ("Pay {x}" again, or one of several) leaves the lines for the
  // bill waiting on the order, a friend's among them.

  const payFirst =
    payFirstPart === undefined
      ? null
      : await preparePayFirst(stx, {
          tableId,
          order,
          part: payFirstPart,
          menu,
          isPayFirst,
          whole: command.lines.length > 0,
        })
  if (payFirst !== null && !payFirst.ok) {
    return refused(actionId, payFirst.code, payFirst.details ?? {})
  }

  const sittingId = row.sittingId
  const made: { id: string; reference: string } | null =
    onBill === null
      ? null
      : await insertSentOrder(stx, {
          kind: 'on_bill',
          tableId,
          sittingId,
          barId,
          actionId,
          lines: onBill.lines,
          totalMinor: onBill.totalMinor,
          notes,
          now,
        })
  let paid: { id: string; reference: string; paymentId: string } | null = null
  if (payFirst !== null && payFirstPart !== undefined) {
    const sent = await insertSentOrder(stx, {
      kind: 'pay_first',
      tableId,
      sittingId,
      barId,
      // The action id names the payment; a sent order holds it only for the bill's part.
      actionId: null,
      lines: sentLinesOf(payFirst.lines, payFirst.priced),
      totalMinor: payFirst.totalMinor,
      notes: payFirst.lines.filter((line) => line.note !== ''),
      now,
    })
    await insertPayFirst(stx, payFirst, {
      tableId,
      sittingId,
      barId,
      sentOrderId: sent.id,
      actionId,
      handleHash: payFirstPart.handleHash,
      currency: menu.currency,
    })
    order = payFirst.order
    paid = { ...sent, paymentId: payFirst.paymentId }
  }

  await writeOrder(stx, row, order)
  const reference = made?.reference ?? paid?.reference
  return accepted(actionId, {
    ...(reference === undefined ? {} : { ref: reference }),
    details: {
      ...(made === null ? {} : { sentOrderId: made.id }),
      ...(paid === null ? {} : { paymentId: paid.paymentId, state: 'requested' }),
    },
  })
}

/** A Send's lines as the sent order keeps them, each with its price. */
function sentLinesOf(
  taken: readonly {
    readonly id: string
    readonly itemId: string
    readonly optionIds: readonly string[]
    readonly qty: number
  }[],
  priced: readonly PricedLine[],
): SentOrderLine[] {
  return taken.map((line, index) => {
    const price = priced[index]
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
}

/**
 * Writes a `waiting` sent order with a short reference a waiter reads (K7Q), its lines' notes
 * kept apart, and logs it.
 */
async function insertSentOrder(
  stx: ServiceTx,
  input: {
    readonly kind: 'on_bill' | 'pay_first'
    readonly tableId: string
    readonly sittingId: string
    readonly barId: string | null
    readonly actionId: string | null
    readonly lines: readonly SentOrderLine[]
    readonly totalMinor: number
    readonly notes: readonly { readonly id: string; readonly note: string }[]
    readonly now: Date
  },
): Promise<{ readonly id: string; readonly reference: string }> {
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
        tableId: input.tableId,
        sittingId: input.sittingId,
        barId: input.barId,
        serviceDate: stx.serviceDate,
        kind: input.kind,
        reference: candidate,
        state: 'waiting',
        lines: [...input.lines],
        totalMinor: input.totalMinor,
        actionId: input.actionId,
        consentVersion: stx.consentVersion,
        retainUntil: recordRetainUntil(input.now),
        ...stx.provenance,
      })
      .onConflictDoNothing({
        target: [sentOrders.venueId, sentOrders.serviceDate, sentOrders.reference],
      })
      .returning({ id: sentOrders.id })
    if (inserted.length > 0) reference = candidate
  }
  if (reference === null) throw new Error('no free reference for the sent order')

  if (input.notes.length > 0) {
    await stx.tx.insert(sentOrderNotes).values(
      input.notes.map((line) => ({
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
  await stx.log({
    kind: 'sent_order.state',
    sentOrderId: id,
    tableId: input.tableId,
    sittingId: input.sittingId,
    toState: 'waiting',
    details: { lines: input.lines.length, totalMinor: input.totalMinor },
  })
  return { id, reference }
}
