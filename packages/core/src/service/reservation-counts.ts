// The door's counts of one service day (D144 §3, #408): what `service_day.close` writes into
// `service_days.totals` beside the night's other numbers, and what the end-of-night page counts
// live while the night runs. Read from the reservation rows only: no money in any of them, so they
// are `night.view` (D144). The definitions are D144's:
//
//   - arrived = a party that was seated (Seated, or Finished after it); blocks are never counted;
//   - no-show rate = no-shows ÷ (no-shows + bookings that arrived): reservations, not covers;
//     walk-ins and Not seated are out of both sides (a walk-in cannot fail to arrive, D138);
//   - covers = the party size of the parties that arrived; a cancelled, no-show or not-seated
//     party is not a cover.
//
// A row taken out of the book (`deleted_at`) is not counted. The counts are plain numbers under
// `res*` keys of the totals object (jsonb of scalars: no schema change, D144).

import { type ReadTx, serviceDays } from '@restro/db'
import { and, eq, sql } from 'drizzle-orm'

import type { ServiceTx } from './definition'

/** The door's numbers of a night, as `service_days.totals` keeps them. */
export interface ReservationCounts {
  readonly resBookings: number
  readonly resWalkIns: number
  /** Parties that arrived, bookings and walk-ins. */
  readonly resArrived: number
  /** Of them, the bookings: the no-show rate's own denominator. */
  readonly resBookingsArrived: number
  readonly resNoShows: number
  readonly resCancelled: number
  readonly resNotSeated: number
  readonly resCoversBooked: number
  readonly resCoversSeated: number
}

export const RESERVATION_COUNT_KEYS = [
  'resBookings',
  'resWalkIns',
  'resArrived',
  'resBookingsArrived',
  'resNoShows',
  'resCancelled',
  'resNotSeated',
  'resCoversBooked',
  'resCoversSeated',
] as const satisfies readonly (keyof ReservationCounts)[]

/** The door's counts of `day`, from the reservation rows. */
export async function reservationCounts(
  tx: Pick<ReadTx, 'execute'>,
  venueId: string,
  day: string,
): Promise<ReservationCounts> {
  const result = await tx.execute<Record<keyof ReservationCounts, string>>(sql`
    select
      count(*) filter (where kind = 'booking') as "resBookings",
      count(*) filter (where kind = 'walk_in') as "resWalkIns",
      count(*) filter (where kind <> 'block' and status in ('seated', 'finished')) as "resArrived",
      count(*) filter (where kind = 'booking' and status in ('seated', 'finished'))
        as "resBookingsArrived",
      count(*) filter (where kind <> 'block' and status = 'no_show') as "resNoShows",
      count(*) filter (where kind <> 'block' and status = 'cancelled') as "resCancelled",
      count(*) filter (where kind <> 'block' and status = 'not_seated') as "resNotSeated",
      coalesce(sum(party_size) filter (where kind = 'booking'), 0) as "resCoversBooked",
      coalesce(sum(party_size) filter (where kind <> 'block' and status in ('seated', 'finished')), 0)
        as "resCoversSeated"
    from restro.reservations
    where venue_id = ${venueId} and service_date = ${day} and deleted_at is null`)
  const row = result.rows[0]
  if (row === undefined) throw new Error('the reservation counts query returned no row')
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  ) as unknown as ReservationCounts
}

/** The counts a closed day's totals hold, or null for a night closed before they were written. */
export function storedReservationCounts(
  totals: Readonly<Record<string, unknown>>,
): ReservationCounts | null {
  if (!RESERVATION_COUNT_KEYS.every((key) => typeof totals[key] === 'number')) return null
  return Object.fromEntries(
    RESERVATION_COUNT_KEYS.map((key) => [key, Number(totals[key])]),
  ) as unknown as ReservationCounts
}

/**
 * D144's no-show rate as a whole percentage (0–100), or null when no booking was due to arrive or
 * fail to (nothing to divide by).
 */
export function noShowRatePercent(counts: ReservationCounts): number | null {
  const due = counts.resNoShows + counts.resBookingsArrived
  return due === 0 ? null : Math.round((counts.resNoShows * 100) / due)
}

/** The commands that can change a reservation row: after one, a closed night's counts are re-rolled. */
export function touchesReservations(type: string): boolean {
  return /^(reservation\.|waiting\.|block\.|night\.end$|reservation_night\.)/.test(type)
}

/**
 * A night that is written again is written whole (D144): every closed night whose reservation rows
 * this command wrote gets all its `res*` keys counted afresh, in the same transaction, and nothing
 * else of its totals is touched. A night is told by the rows' `updated_at`, which every reservation
 * write sets to the transaction's `now()`; a reservation never changes its night, so the night a
 * row sits on is the night it touched. Returns the nights re-rolled.
 */
export async function rerollClosedNights(stx: ServiceTx): Promise<readonly string[]> {
  const result = await stx.tx.execute<{ day: string }>(sql`
    select distinct r.service_date::text as "day"
    from restro.reservations r
    join restro.service_days d
      on d.venue_id = r.venue_id and d.service_date = r.service_date
    where r.venue_id = ${stx.venueId} and r.updated_at = now()
    order by 1`)
  const days = result.rows.map((row) => row.day)
  for (const day of days) {
    const counts = await reservationCounts(stx.tx, stx.venueId, day)
    await stx.tx
      .update(serviceDays)
      .set({
        totals: sql`${serviceDays.totals} || ${JSON.stringify(counts)}::jsonb`,
        ...stx.provenance,
      })
      .where(and(eq(serviceDays.venueId, stx.venueId), eq(serviceDays.serviceDate, day)))
  }
  return days
}
