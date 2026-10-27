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
// A day whose payments or sent orders are still moving waits (`payments_open`, `orders_open`): a
// payment held, cancelling or awaiting the guest at the day's end goes on afterwards, so the
// totals would undercount, and its action id is what answers a repeat of `pay.start`. A payment is
// final once `settled_at` is set (0030's `payments_settled`), a sent order once it is in one of
// `SETTLED_STATES`. The worker tries again on its next run.
//
// The night's open venue alerts are cleared with the close (#162; Martin 10-27): each gets `done_at`
// and one `alert.cleared` Log line, so nobody presses Done on yesterday's alerts and the next night
// starts clean. Not cleared: an alert that ends by itself (a pause, `closesItself`), one only an
// answer closes (the payment questions a card hold waits on, `closesByAnswer`) and Restro's own
// (`audience = 'restro'`). A close that is refused clears nothing.
//
// Locks, in the fixed order: the day's sittings (by table), its sent orders, the alerts to clear,
// its payments.

import { alerts, payments, type ReadTx, sentOrders, serviceDays, sittings } from '@restro/db'
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'

import { ruleOf } from './alert-rules'
import type { ServiceTx } from './definition'
import { appendLogEntry, recordRetainUntil } from './log'
import { accepted, refused, type ServiceResult } from './results'
import { SETTLED_STATES } from './sent-order'

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
  /**
   * What the day's payments captured, tips included, in minor units: the amount at close, before
   * any later refund (`refunded_minor`).
   */
  readonly capturedMinor: number
  readonly tipMinor: number
}

/**
 * The day's totals, read inside a transaction: the close writes them once, and the end-of-night
 * page counts them live while the day is still running (#86).
 */
export async function serviceDayTotals(
  tx: Pick<ReadTx, 'execute'>,
  venueId: string,
  day: string,
): Promise<ServiceDayTotals> {
  const result = await tx.execute<Record<keyof ServiceDayTotals, string>>(sql`
    select
      (select count(*) from restro.sittings
        where venue_id = ${venueId} and service_date = ${day}) as "sittings",
      (select count(*) from restro.sent_orders
        where venue_id = ${venueId} and service_date = ${day}) as "sentOrders",
      (select count(*) from restro.sent_orders
        where venue_id = ${venueId} and service_date = ${day} and state = 'added')
        as "sentOrdersAdded",
      (select count(*) from restro.sent_orders
        where venue_id = ${venueId} and service_date = ${day} and state = 'not_sent')
        as "sentOrdersNotSent",
      (select count(*) from restro.sent_orders
        where venue_id = ${venueId} and service_date = ${day} and state = 'unconfirmed')
        as "sentOrdersUnconfirmed",
      (select coalesce(sum(total_minor), 0) from restro.sent_orders
        where venue_id = ${venueId} and service_date = ${day} and state = 'added')
        as "addedMinor",
      (select count(*) from restro.waiter_calls
        where venue_id = ${venueId} and service_date = ${day}) as "waiterCalls",
      (select count(*) from restro.alerts
        where venue_id = ${venueId} and service_date = ${day}) as "alerts",
      (select count(*) from restro.pauses
        where venue_id = ${venueId} and service_date = ${day}) as "pauses",
      (select count(*) from restro.payments
        where venue_id = ${venueId} and service_date = ${day}) as "payments",
      (select coalesce(sum(captured_minor), 0) from restro.payments
        where venue_id = ${venueId} and service_date = ${day}) as "capturedMinor",
      (select coalesce(sum(tip_minor), 0) from restro.payments
        where venue_id = ${venueId} and service_date = ${day} and captured_minor is not null)
        as "tipMinor"`)
  const row = result.rows[0]
  if (row === undefined) throw new Error('the day totals query returned no row')
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  ) as unknown as ServiceDayTotals
}

/** What an alert's `details.clearedAt` and its Log line's `at` say: the day's close cleared it. */
export const CLEARED_AT_DAY_CLOSE = 'day_close'

/**
 * Locks the day's open venue alerts the close clears: not a pause (it ends by itself), not a
 * question only an answer closes, not Restro's own. The rows are read first, then locked in id
 * order and read again, so a Done pressed in between is not cleared a second time.
 */
async function lockAlertsToClear(stx: ServiceTx, day: string) {
  const open = await stx.tx
    .select({ id: alerts.id, kind: alerts.kind })
    .from(alerts)
    .where(
      and(
        eq(alerts.venueId, stx.venueId),
        eq(alerts.audience, 'venue'),
        eq(alerts.serviceDate, day),
        isNull(alerts.doneAt),
      ),
    )
  const ids = stx.rows.claim(
    'alert',
    open
      .filter((row) => {
        const rule = ruleOf(row.kind, 'venue')
        return !rule.closesItself && !rule.closesByAnswer
      })
      .map((row) => row.id),
  )
  if (ids.length === 0) return []
  return stx.tx
    .select({ id: alerts.id, kind: alerts.kind, details: alerts.details })
    .from(alerts)
    .where(and(inArray(alerts.id, ids), isNull(alerts.doneAt)))
    .orderBy(alerts.id)
    .for('update')
}

/**
 * `service_day.close`: closes one ended service day of the venue (see the header). Refused
 * `day_not_ended` for today's service day or a later one, `payments_open` while a payment of the
 * day is not final and `orders_open` while a sent order of the day is not.
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
  const toClear = await lockAlertsToClear(stx, day)
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
  const [livePayment] = await stx.tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.venueId, stx.venueId),
        eq(payments.serviceDate, day),
        isNull(payments.settledAt),
      ),
    )
    .limit(1)
  if (livePayment !== undefined) return refused(null, 'payments_open')
  const [liveOrder] = await stx.tx
    .select({ id: sentOrders.id })
    .from(sentOrders)
    .where(
      and(
        eq(sentOrders.venueId, stx.venueId),
        eq(sentOrders.serviceDate, day),
        notInArray(sentOrders.state, [...SETTLED_STATES]),
      ),
    )
    .limit(1)
  if (liveOrder !== undefined) return refused(null, 'orders_open')

  for (const alert of toClear) {
    await stx.tx
      .update(alerts)
      .set({
        doneAt: sql`now()`,
        doneBy: stx.provenance.actor,
        via: 'worker',
        nextRepeatAt: null,
        // The venue group's message is edited with the end of the night's words, not "Done by".
        details: { ...alert.details, clearedAt: CLEARED_AT_DAY_CLOSE },
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(alerts.id, alert.id))
    // The line belongs to the night the alert was raised in (not the day the worker runs).
    await appendLogEntry(
      stx.tx,
      {
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        serviceDate: day,
        provenance: stx.provenance,
        via: stx.via,
      },
      {
        kind: 'alert.cleared',
        reason: alert.kind,
        details: { alertId: alert.id, at: CLEARED_AT_DAY_CLOSE },
      },
    )
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
      // Matching a late landing stops with the day (#135); the POS ids go with it.
      landingBasis: null,
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

  const totals = await serviceDayTotals(stx.tx, stx.venueId, day)
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
      alertsCleared: toClear.length,
    },
  })
}
