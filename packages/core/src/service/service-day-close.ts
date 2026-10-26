// The end of a venue's service day (D111, D122 §9; design §4; ticket #84), run by the worker once
// the day has ended. Three things, in one command:
//
//   - the day's sittings and sent orders get their `retain_until`: 18 months from now, the day's
//     end or later (D111). It only ever moves later, so a row an earlier write gave a longer life
//     keeps it, and the purge, which only compares the column, can never cut evidence short;
//   - the phones' action ids on the day's sent orders and payments are cleared, so they don't
//     outlive the night (a repeat of a tap is answered within its service day only);
//   - `service_days` keeps the day's totals ("then only as totals", D111), written once.
//
// The 31-day rows (notes, waiter calls, alerts, pauses, `night` Log entries) carry no column of
// their own: the purge counts their 31 days from their service day (`serviceRetentionCutoffs`).
// A day is closed once: a repeat finds its `service_days` row and changes nothing (`by_state`).
//
// Locks, in the fixed order: the day's sittings (by table), its sent orders, its payments.

import { payments, sentOrders, serviceDays, sittings } from '@restro/db'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'

import type { ServiceTx } from './definition'
import { recordRetainUntil } from './log'
import { accepted, refused, type ServiceResult } from './results'

/** What `service_days.totals` holds for a closed day: counts and minor-unit sums only. */
export interface ServiceDayTotals {
  readonly sittings: number
  readonly sentOrders: number
  readonly sentOrdersAdded: number
  readonly sentOrdersNotSent: number
  readonly sentOrdersUnconfirmed: number
  /** The sum of the sent orders that reached the bill (`added`), in minor units. */
  readonly addedMinor: number
  readonly waiterCalls: number
  readonly alerts: number
  readonly pauses: number
  readonly payments: number
  /** What the day's payments captured, tips included, in minor units. */
  readonly capturedMinor: number
  readonly tipMinor: number
}

/** The day's totals, read inside the command's transaction. */
async function totalsOf(stx: ServiceTx, day: string): Promise<ServiceDayTotals> {
  const result = await stx.tx.execute<Record<keyof ServiceDayTotals, string>>(sql`
    select
      (select count(*) from restro.sittings
        where venue_id = ${stx.venueId} and service_date = ${day}) as "sittings",
      (select count(*) from restro.sent_orders
        where venue_id = ${stx.venueId} and service_date = ${day}) as "sentOrders",
      (select count(*) from restro.sent_orders
        where venue_id = ${stx.venueId} and service_date = ${day} and state = 'added')
        as "sentOrdersAdded",
      (select count(*) from restro.sent_orders
        where venue_id = ${stx.venueId} and service_date = ${day} and state = 'not_sent')
        as "sentOrdersNotSent",
      (select count(*) from restro.sent_orders
        where venue_id = ${stx.venueId} and service_date = ${day} and state = 'unconfirmed')
        as "sentOrdersUnconfirmed",
      (select coalesce(sum(total_minor), 0) from restro.sent_orders
        where venue_id = ${stx.venueId} and service_date = ${day} and state = 'added')
        as "addedMinor",
      (select count(*) from restro.waiter_calls
        where venue_id = ${stx.venueId} and service_date = ${day}) as "waiterCalls",
      (select count(*) from restro.alerts
        where venue_id = ${stx.venueId} and service_date = ${day}) as "alerts",
      (select count(*) from restro.pauses
        where venue_id = ${stx.venueId} and service_date = ${day}) as "pauses",
      (select count(*) from restro.payments
        where venue_id = ${stx.venueId} and service_date = ${day}) as "payments",
      (select coalesce(sum(captured_minor), 0) from restro.payments
        where venue_id = ${stx.venueId} and service_date = ${day}) as "capturedMinor",
      (select coalesce(sum(tip_minor), 0) from restro.payments
        where venue_id = ${stx.venueId} and service_date = ${day} and captured_minor is not null)
        as "tipMinor"`)
  const row = result.rows[0]
  if (row === undefined) throw new Error('the day totals query returned no row')
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  ) as unknown as ServiceDayTotals
}

/**
 * `service_day.close`: closes one ended service day of the venue (see the header). Refused
 * `day_not_ended` for today's service day or a later one.
 */
export async function closeServiceDay(
  stx: ServiceTx,
  command: { readonly serviceDate: string },
): Promise<ServiceResult> {
  const day = command.serviceDate
  if (day >= stx.serviceDate) return refused(null, 'day_not_ended')
  const [already] = await stx.tx
    .select({ serviceDate: serviceDays.serviceDate })
    .from(serviceDays)
    .where(and(eq(serviceDays.venueId, stx.venueId), eq(serviceDays.serviceDate, day)))
  if (already !== undefined) return accepted(null, { details: { changed: false } })

  const daySittings = await stx.tx
    .select({ tableId: sittings.tableId })
    .from(sittings)
    .where(and(eq(sittings.venueId, stx.venueId), eq(sittings.serviceDate, day)))
  const tableIds = stx.rows.claim(
    'sitting',
    daySittings.map((row) => row.tableId),
  )
  if (tableIds.length > 0) {
    await stx.tx
      .select({ id: sittings.id })
      .from(sittings)
      .where(and(eq(sittings.serviceDate, day), inArray(sittings.tableId, tableIds)))
      .orderBy(sittings.tableId, sittings.id)
      .for('update')
  }
  const sentIds = (
    await stx.tx
      .select({ id: sentOrders.id })
      .from(sentOrders)
      .where(and(eq(sentOrders.venueId, stx.venueId), eq(sentOrders.serviceDate, day)))
  ).map((row) => row.id)
  await stx.rows.sentOrders(sentIds)
  const paymentIds = stx.rows.claim(
    'payment',
    (
      await stx.tx
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.venueId, stx.venueId), eq(payments.serviceDate, day)))
    ).map((row) => row.id),
  )
  if (paymentIds.length > 0) {
    await stx.tx
      .select({ id: payments.id })
      .from(payments)
      .where(inArray(payments.id, paymentIds))
      .orderBy(payments.id)
      .for('update')
  }

  // 18 months from now: the day has ended, so this is never earlier than 18 months from its end.
  const until = recordRetainUntil(await stx.dbNow())
  const later = (column: typeof sittings.retainUntil | typeof sentOrders.retainUntil) =>
    sql`greatest(coalesce(${column}, ${until}), ${until})`
  const retained = await stx.tx
    .update(sittings)
    .set({ retainUntil: later(sittings.retainUntil), ...stx.provenance, updatedAt: sql`now()` })
    .where(and(eq(sittings.venueId, stx.venueId), eq(sittings.serviceDate, day)))
    .returning({ id: sittings.id })
  const sent = await stx.tx
    .update(sentOrders)
    .set({
      retainUntil: later(sentOrders.retainUntil),
      actionId: null,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(and(eq(sentOrders.venueId, stx.venueId), eq(sentOrders.serviceDate, day)))
    .returning({ id: sentOrders.id })
  const paid = await stx.tx
    .update(payments)
    .set({ actionId: null, ...stx.provenance, updatedAt: sql`now()` })
    .where(
      and(
        eq(payments.venueId, stx.venueId),
        eq(payments.serviceDate, day),
        isNotNull(payments.actionId),
      ),
    )
    .returning({ id: payments.id })

  const totals = await totalsOf(stx, day)
  const closed = await stx.tx
    .insert(serviceDays)
    .values({
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      serviceDate: day,
      totals: { ...totals },
      ...stx.provenance,
    })
    .onConflictDoNothing()
    .returning({ serviceDate: serviceDays.serviceDate })
  if (closed.length > 0) {
    await stx.log({
      kind: 'service_day.closed',
      details: { closedDate: day, sittings: totals.sittings, sentOrders: totals.sentOrders },
    })
  }
  return accepted(null, {
    details: {
      changed: closed.length > 0,
      sittings: retained.length,
      sentOrders: sent.length,
      payments: paid.length,
    },
  })
}
