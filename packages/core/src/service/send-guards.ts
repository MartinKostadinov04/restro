// Send's guards (D117, D118, D122 §4; ticket #78), checked by `order.send` once its lines are
// priced:
// - the duplicate check: a Send whose items and quantities match a sent order of the same sitting
//   in the last 15 minutes asks first ("Same as 4 minutes ago. Send another?"). Sending again is a
//   new action naming that sent order (`confirmDuplicateOf`). A Not sent order never landed, so it
//   is no duplicate; an Unconfirmed one may have, so it is.
// - the cap per sent order (€150 by default) and the pace per table (6 sent orders in 15 minutes),
//   the venue's settings (`venues.settings.ordering`). A trip refuses the Send, which stays on the
//   order, and leaves behind, through the engine's `keepOnRefusal`: a table pause for "ask your
//   waiter" that lifts at a staff Resume or the sitting's end (#79), one `guard.tripped` Log entry
//   per table, guard and minute, and for the pace an alert to Restro's admin team, one open per
//   table (D118: a table that hits the pace limit alerts the Restro team).
// Pay-first sent orders are never guarded (D118): money coming in is no risk.

import { alerts, logEntries, pauses, sentOrders } from '@restro/db'
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm'

import { newId } from '../ids'
import type { ServiceTx } from './definition'
import { sentOrderLinesOf } from './sent-lines'

/** How far back a Send looks for the same sent order (D117: 15 minutes, a starting value). */
export const DUPLICATE_WINDOW_MINUTES = 15

/** The window the pace counts sent orders in (D118: "per table per 15 minutes"). */
export const PACE_WINDOW_MINUTES = 15

/** The cause of the table pause a tripped guard starts; lifted by staff or the sitting's end (#79). */
export const GUARD_TRIPPED_CAUSE = 'guard_tripped'

/** The alert a pace trip raises for Restro's admin team. */
export const ORDER_PACE_ALERT = 'order_pace'

/** The guards that trip. */
export type SendGuard = 'cap' | 'pace'

/** The Log reason of each guard's trip. */
const TRIP_REASON: Readonly<Record<SendGuard, string>> = {
  cap: 'order_cap',
  pace: 'order_pace',
}

const MINUTE = 60_000

/** One line as the duplicate check compares it: its item, options and quantity, never its note. */
interface RoundLine {
  readonly itemId: string
  readonly optionIds: readonly string[]
  readonly qty: number
}

/**
 * The items and quantities of a round, as one comparable text: identical lines merged, notes left
 * out, the order of lines and options ignored.
 */
export function roundKey(lines: readonly RoundLine[]): string {
  const quantities = new Map<string, number>()
  for (const line of lines) {
    const key = `${line.itemId}+${[...line.optionIds].sort().join(',')}`
    quantities.set(key, (quantities.get(key) ?? 0) + line.qty)
  }
  return [...quantities.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, qty]) => `${key}x${qty}`)
    .join(';')
}

/** The sent order a Send repeats, and how many whole minutes ago it was made. */
export interface Duplicate {
  readonly sentOrderId: string
  readonly minutesAgo: number
}

/**
 * The latest sent order of this sitting in the last 15 minutes with the same items and
 * quantities, or null. Not sent orders are left out.
 */
export async function findDuplicate(
  stx: ServiceTx,
  target: { readonly tableId: string; readonly sittingId: string },
  lines: readonly RoundLine[],
  now: Date,
): Promise<Duplicate | null> {
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_MINUTES * MINUTE)
  const recent = await stx.tx
    .select({ id: sentOrders.id, lines: sentOrders.lines, createdAt: sentOrders.createdAt })
    .from(sentOrders)
    .where(
      and(
        eq(sentOrders.tableId, target.tableId),
        eq(sentOrders.sittingId, target.sittingId),
        eq(sentOrders.kind, 'on_bill'),
        ne(sentOrders.state, 'not_sent'),
        gt(sentOrders.createdAt, since),
      ),
    )
    .orderBy(desc(sentOrders.createdAt))
  const key = roundKey(lines)
  const same = recent.find((row) => roundKey(sentOrderLinesOf(row.lines)) === key)
  if (same === undefined) return null
  return {
    sentOrderId: same.id,
    minutesAgo: Math.max(0, Math.floor((now.getTime() - same.createdAt.getTime()) / MINUTE)),
  }
}

/**
 * How many on-the-bill sent orders the table made in the last 15 minutes, every sitting counted
 * (a new group at a shared code is the same risk). Not sent orders never reached the bill.
 */
export async function recentSentOrders(
  stx: ServiceTx,
  tableId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - PACE_WINDOW_MINUTES * MINUTE)
  const [row] = await stx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sentOrders)
    .where(
      and(
        eq(sentOrders.tableId, tableId),
        eq(sentOrders.kind, 'on_bill'),
        ne(sentOrders.state, 'not_sent'),
        gt(sentOrders.createdAt, since),
      ),
    )
  return row?.n ?? 0
}

/**
 * What a trip leaves behind (run through `keepOnRefusal`, after the Send's own writes are rolled
 * back): the table pause, the Log entry (one per table, guard and minute) and, for the pace, the
 * alert to Restro's admin team. The table's version rises, so every phone sees the pause.
 */
export async function tripGuard(
  stx: ServiceTx,
  trip: {
    readonly guard: SendGuard
    readonly tableId: string
    readonly sittingId: string
    readonly details: Readonly<Record<string, number>>
  },
): Promise<void> {
  const { tx } = stx
  const { guard, tableId, sittingId, details } = trip
  const reason = TRIP_REASON[guard]
  const minuteAgo = new Date((await stx.dbNow()).getTime() - MINUTE)
  const [logged] = await tx
    .select({ seq: logEntries.seq })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.venueId, stx.venueId),
        eq(logEntries.tableId, tableId),
        eq(logEntries.kind, 'guard.tripped'),
        eq(logEntries.reason, reason),
        gt(logEntries.at, minuteAgo),
      ),
    )
    .limit(1)
  if (logged === undefined) {
    await stx.log({ kind: 'guard.tripped', tableId, sittingId, reason, details: { ...details } })
  }

  stx.rows.claim('pause', [`table:${tableId}:${GUARD_TRIPPED_CAUSE}`])
  const [active] = await tx
    .select({ id: pauses.id })
    .from(pauses)
    .where(
      and(
        eq(pauses.scope, 'table'),
        eq(pauses.targetId, tableId),
        eq(pauses.cause, GUARD_TRIPPED_CAUSE),
        isNull(pauses.liftedAt),
      ),
    )
    .for('update')
  if (active === undefined) {
    await tx.insert(pauses).values({
      id: newId('pa'),
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      serviceDate: stx.serviceDate,
      scope: 'table',
      targetId: tableId,
      cause: GUARD_TRIPPED_CAUSE,
      restroStarted: true,
      details: { guard, sittingId },
      ...stx.provenance,
    })
    await stx.log({ kind: 'pause.started', tableId, sittingId, reason: GUARD_TRIPPED_CAUSE })
    stx.rows.touch(tableId)
  }

  if (guard !== 'pace') return
  stx.rows.claim('alert', [`${ORDER_PACE_ALERT}:${tableId}`])
  const [open] = await tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.venueId, stx.venueId),
        eq(alerts.kind, ORDER_PACE_ALERT),
        eq(alerts.subjectId, tableId),
        isNull(alerts.doneAt),
      ),
    )
    .for('update')
  if (open !== undefined) return
  const id = newId('al')
  await tx.insert(alerts).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    kind: ORDER_PACE_ALERT,
    audience: 'restro',
    subjectId: tableId,
    permission: null,
    details: { ...details },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({
    kind: 'alert.raised',
    tableId,
    sittingId,
    reason: ORDER_PACE_ALERT,
    details: { alertId: id },
  })
}
