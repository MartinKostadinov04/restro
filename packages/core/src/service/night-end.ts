// The night's end (ticket #332; D138, log 12.17 and 13.9). One of three moments kept apart:
//
// - **The night's end** — this module. At the venue's closing hour (`hours.close_tables`, the
//   worker's minute tick) or at an admin's early end (`night.end`), every table code closes so no
//   phone can order, at **every** venue whether it takes reservations or not, and the night's
//   parties are swept in the same write: the seated become Finished, a booking nobody came for
//   No-show, a party still waiting Not seated, a block untouched (`reservations/night.ts`).
// - **A night has passed** when its service day ends (D45). The worker then re-runs only the sweep
//   (`reservation_night.sweep`), for whatever the night's end left. It is not here.
// - **Putting one reservation back** is one admin's action on one reservation
//   (`reservation.put_back`). There is no bulk undo, here or anywhere.
//
// The close is the ordering side's own "keep paying" close (`closeOpenTables` with `keepPaying`):
// a table whose card is still held keeps its code until its payment ends, and the closing hour's
// later ticks close it then. The plain close-all is never used here (D138, log 12.17). Nothing in
// this module moves money, refunds anything or touches a payment beyond waiting for one.
//
// **The night's end is stored** (`reservation_nights.closed_at`), written here through
// `applyService` like every other service write (rule 1), so it cannot run twice: a second run —
// the next tick, a double tap, an early end racing the hour — finds the record and writes nothing.
// The service day's row cannot carry it, because that command refuses for today's date.

import {
  type DbPool,
  payments,
  type ReadTx,
  reservationNights,
  reservations,
  sentOrders,
  sittings,
  venues,
  withTenant,
} from '@restro/db'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'

import { readOrderingSettings } from '../ordering-settings'
import { type ServiceClock, serviceHoursOn } from '../service-hours'
import type { ServiceTx } from './definition'
import { open, type ReadInput } from './night-read'
import { sweepDetails, sweepNightLines, writeNightRecord } from './reservations/night'
import { lockNight, lockNightReservations } from './reservations/rows'
import { nightEndStatus, type ReservationKind, type ReservationStatus } from './reservations/status'
import { accepted, type ServiceResult } from './results'
import { closeOpenTables } from './sittings'

/** The venue's clock, as the night's end reads it from the venue's own settings. */
export function venueClock(venue: {
  readonly timezone: string
  readonly serviceDayEndsAt: string
  readonly settings: Readonly<Record<string, unknown>>
}): ServiceClock {
  return {
    timeZone: venue.timezone,
    dayEndsAt: venue.serviceDayEndsAt,
    hours: readOrderingSettings(venue.settings).serviceHours,
  }
}

/**
 * Whether ending the night at `now` is ending it **early**: before the closing hour of that service
 * day. A day with no hours is a closed day and has no closing hour to be early for (#332: no
 * fallback closing hour is invented).
 */
export function endsEarly(serviceDate: string, now: Date, clock: ServiceClock): boolean {
  const hours = serviceHoursOn(serviceDate, clock)
  return hours !== null && now.getTime() < hours.closesAt.getTime()
}

/** The venue's open sittings: how many, how many have a bill still open, how many a card keeps. */
export async function openSittingBills(
  tx: ReadTx,
  venueId: string,
): Promise<{ readonly open: number; readonly bills: number; readonly paying: number }> {
  const open = await tx
    .select({ id: sittings.id, hadBillLines: sittings.hadBillLines })
    .from(sittings)
    .where(and(eq(sittings.venueId, venueId), isNull(sittings.endedAt)))
  if (open.length === 0) return { open: 0, bills: 0, paying: 0 }
  const ids = open.map((row) => row.id)
  // A bill is open where the POS showed lines for the sitting or a round was sent onto it; a round
  // that never reached the POS (`not_sent`) put nothing on a bill.
  const sent = new Set(
    (
      await tx
        .selectDistinct({ sittingId: sentOrders.sittingId })
        .from(sentOrders)
        .where(and(inArray(sentOrders.sittingId, ids), ne(sentOrders.state, 'not_sent')))
    ).map((row) => row.sittingId),
  )
  // The tables a card payment keeps open: the question `sittingsWithOpenPayment` asks.
  const paying = await tx
    .selectDistinct({ sittingId: payments.sittingId })
    .from(payments)
    .where(and(inArray(payments.sittingId, ids), isNull(payments.settledAt)))
  return {
    open: open.length,
    bills: open.filter((row) => row.hadBillLines || sent.has(row.id)).length,
    paying: paying.length,
  }
}

/** Whether the night of this service day has ended (its record says so). */
export async function nightEnded(stx: ServiceTx, serviceDate: string): Promise<boolean> {
  return endedOn(stx.tx, stx.venueId, serviceDate)
}

async function endedOn(tx: ReadTx, venueId: string, serviceDate: string): Promise<boolean> {
  const [row] = await tx
    .select({ closedAt: reservationNights.closedAt })
    .from(reservationNights)
    .where(
      and(eq(reservationNights.venueId, venueId), eq(reservationNights.serviceDate, serviceDate)),
    )
  return row?.closedAt != null
}

/** How a night's end was reached: the closing hour, or an admin before it. */
export interface NightEndCommand {
  readonly serviceDate: string
  readonly early: boolean
}

/**
 * Ends the night: closes every table code (keeping a table whose card is held), sweeps the night's
 * parties, and stores the night's end with the count of bills still open, in one write. A night
 * that has already ended is left as it is and the result says `changed: false`.
 */
export async function endTheNight(
  stx: ServiceTx,
  command: NightEndCommand,
): Promise<ServiceResult> {
  const unchanged = accepted(null, {
    details: { serviceDate: command.serviceDate, changed: false },
  })
  if (await nightEnded(stx, command.serviceDate)) return unchanged
  // Counted before the close ends the sittings: the bills stay open at the POS after it, which is
  // what the warning is for (staff close them there).
  const before = await openSittingBills(stx.tx, stx.venueId)
  const closing = await closeOpenTables(stx, command.early ? 'staff_closed' : 'closing_hour', {
    keepPaying: true,
  })
  const closed = Number(closing.details.closed ?? 0)
  const kept = Number(closing.details.kept ?? 0)
  // The night's lines before its record (`LOCK_RANKS`); a run that lost the race finds it ended.
  const lines = await lockNightReservations(stx, command.serviceDate)
  const night = await lockNight(stx, command.serviceDate)
  if (night?.closedAt != null) return unchanged
  const sweep = await sweepNightLines(stx, lines)
  await writeNightRecord(stx, command.serviceDate, night !== null, {
    closedAt: stx.now,
    closedBy: command.early ? stx.provenance.actor : null,
    closedEarly: command.early,
    openBillsAtClose: before.bills,
    sweptAt: stx.now,
  })
  const details = {
    serviceDate: command.serviceDate,
    ...sweepDetails(sweep),
    closed,
    kept,
    openBills: before.bills,
  }
  await stx.log({
    kind: 'night.closed',
    toState: 'closed',
    reason: command.early ? 'ended_early' : 'closing_hour',
    details,
  })
  return accepted(null, { details: { ...details, changed: true } })
}

/**
 * `night.end`, the admin's early end (D138; RS-48): the night of the caller's service day, early
 * when the venue's closing hour has not come yet. The preview she confirmed is read again here,
 * under the locks, so what is written is what is true at the moment of the write.
 */
export async function endTheNightNow(stx: ServiceTx): Promise<ServiceResult> {
  return endTheNight(stx, {
    serviceDate: stx.serviceDate,
    early: endsEarly(stx.serviceDate, stx.now, venueClock(stx.venue)),
  })
}

/** What ending the night now would change: the dialog's preview, counted before she confirms. */
export interface NightEndPreview {
  /** The night it would end: the venue's current service day. */
  readonly serviceDate: string
  /** True when that night has already ended: there is nothing to confirm. */
  readonly ended: boolean
  readonly finished: number
  readonly noShow: number
  readonly notSeated: number
  /** The table codes that would close now. */
  readonly codesClose: number
  /** The table codes a card payment keeps open until it ends. */
  readonly codesKept: number
  /** The bills still open at the POS. */
  readonly openBills: number
  /** That night's closing hour, or null on a day with no hours. */
  readonly closesAt: string | null
  /** True when the closing hour has not come yet: ending now is ending early. */
  readonly early: boolean
}

/**
 * The early end's preview (#332; RS-48): how many parties become Finished, No-show and Not seated,
 * how many codes close and how many a card keeps, how many bills are still open, and whether the
 * club's closing hour is still to come. Read by whoever may end the night — and on a shared
 * device, where the action is present and asks for the PIN (D141), never disabled.
 */
export async function readNightEndPreview(
  pool: DbPool,
  input: ReadInput,
): Promise<
  | { readonly ok: true; readonly preview: NightEndPreview }
  | { readonly ok: false; readonly code: string }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    if (!reader.held.has('reservations.end_night') && !reader.device) {
      return { ok: false, code: 'permission_denied' }
    }
    const [venue] = await tx.select().from(venues).where(eq(venues.id, reader.venue.id))
    if (venue === undefined) return { ok: false, code: 'venue_missing' }
    const now = input.now ?? new Date()
    const clock = venueClock(venue)
    const serviceDate = reader.today
    const lines = await tx
      .select({ status: reservations.status, kind: reservations.kind })
      .from(reservations)
      .where(
        and(
          eq(reservations.venueId, venue.id),
          eq(reservations.serviceDate, serviceDate),
          isNull(reservations.deletedAt),
        ),
      )
    const counts = { finished: 0, noShow: 0, notSeated: 0 }
    for (const line of lines) {
      const to = nightEndStatus(line.status as ReservationStatus, line.kind as ReservationKind)
      if (to === 'finished') counts.finished += 1
      else if (to === 'no_show') counts.noShow += 1
      else if (to === 'not_seated') counts.notSeated += 1
    }
    const tables = await openSittingBills(tx, venue.id)
    const hours = serviceHoursOn(serviceDate, clock)
    return {
      ok: true,
      preview: {
        serviceDate,
        ended: await endedOn(tx, venue.id, serviceDate),
        ...counts,
        codesClose: tables.open - tables.paying,
        codesKept: tables.paying,
        openBills: tables.bills,
        closesAt: hours === null ? null : hours.closesAt.toISOString(),
        early: endsEarly(serviceDate, now, clock),
      },
    }
  })
}
