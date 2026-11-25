// The booking page's server side (#577; spec #322 Implementation Decisions 1, stories 1–9, 32, 33):
//
// - `readBookingFile` — what the worker publishes as `b/<venue id>.json`: the venue's name, whether
//   its page takes requests, its clock, each weekday's opening and closing, and its closed dates
//   from today on. Public fields only; the publisher walks it for forbidden values (rule 3).
// - `readBookingNight` — the one narrow answer the page asks the server for: can this night be
//   booked, and if not, why (past, outside the hours, too far, a closed date, the page off). Nothing
//   else: no count, no spot, no reservation (story 32).
// - `requestBooking` — a guest's request, behind Turnstile (D127 §5.1, story 33), written as the
//   guest command `reservation.request` through `applyService` (rule 1). A failed check is refused
//   before the database is asked; a siteverify that is down lets the request through and is
//   counted, as at Send and Pay.
//
// Read-only reads run on `withTenant`; the guest's write is the service write path's.

import { randomUUID } from 'node:crypto'

import { type DbPool, reservationSettings, venues, withTenant } from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'

import { type BookingNightVerdict, bookingNightVerdict } from '../booking-nights'
import { BOOKING_FILE_CLOSED_DATES_MAX, type BookingFile } from '../guest-files'
import type { VenueId } from '../ids'
import { serviceDate } from '../service-day'
import { applyService } from './apply-service'
import type { HumanCheck } from './guest'
import { bookingCalendarOf, bookingPageOn } from './reservations/online'
import { refused, type ServiceResult } from './results'

/** The venue and its reservation settings, as the two reads need them; null for no live venue. */
async function bookingVenue(pool: DbPool, tenantId: string, venueId: string) {
  return withTenant(pool, tenantId, async (tx) => {
    const [venue] = await tx
      .select({
        id: venues.id,
        name: venues.name,
        timezone: venues.timezone,
        serviceDayEndsAt: venues.serviceDayEndsAt,
        settings: venues.settings,
      })
      .from(venues)
      .where(and(eq(venues.id, venueId), isNull(venues.archivedAt)))
    if (venue === undefined) return null
    const [settings] = await tx
      .select({ online: reservationSettings.online, closedDates: reservationSettings.closedDates })
      .from(reservationSettings)
      .where(eq(reservationSettings.venueId, venueId))
    return { venue, settings: settings ?? null }
  })
}

/** The content of `b/<venue id>.json` at `now`, or null when the tenant has no such live venue. */
export async function readBookingFile(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  now: Date,
): Promise<BookingFile | null> {
  const found = await bookingVenue(pool, tenantId, venueId)
  if (found === null) return null
  const calendar = bookingCalendarOf(found.venue, found.settings?.closedDates ?? [])
  const today = serviceDate(now, calendar.timeZone, calendar.dayEndsAt)
  return {
    venue_id: found.venue.id as VenueId,
    name: found.venue.name,
    on: bookingPageOn(found.settings),
    time_zone: calendar.timeZone,
    day_ends_at: calendar.dayEndsAt,
    hours: calendar.hours,
    closed_dates: calendar.closedDates
      .filter((day) => day >= today)
      .slice(0, BOOKING_FILE_CLOSED_DATES_MAX),
  }
}

/** Whether a night can be booked: `open`, or why not (`booking_off` when the page is off). */
export type BookingNightAnswer = BookingNightVerdict | 'booking_off'

/**
 * Whether `night` can be booked on the venue's page at `now`, or null when the tenant has no such
 * live venue. The page's own reading of its published file says the same up to 30 seconds earlier;
 * this is the answer the write itself will give.
 */
export async function readBookingNight(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  night: string,
  now: Date,
): Promise<BookingNightAnswer | null> {
  const found = await bookingVenue(pool, tenantId, venueId)
  if (found === null) return null
  if (!bookingPageOn(found.settings)) return 'booking_off'
  const calendar = bookingCalendarOf(found.venue, found.settings?.closedDates ?? [])
  return bookingNightVerdict(night, now, calendar)
}

/** What a guest's request carries, as the booking API parsed it. */
export interface BookingRequestInput {
  readonly tenantId: string
  readonly venueId: string
  readonly actionId: string
  readonly serviceDate: string
  readonly partySize: number
  readonly guestName: string
  readonly phone: string
  readonly email: string
  readonly note: string | null
  /** Turnstile's token; without it the request is refused `human_check`. */
  readonly humanToken?: string
  /** Turnstile's siteverify; without it every request fails the check (fail closed). */
  readonly humanCheck?: HumanCheck
  /** Counts a check that failed, or that let a request through while siteverify was down. */
  readonly onGuard?: (kind: 'human_check_failed' | 'human_check_open') => void
  readonly now?: Date
  readonly jobId?: string
}

/**
 * A guest's request for a night: Turnstile first, then `reservation.request` as a guest command
 * with no table. The answer is the command's: accepted with the reservation's id, or a named code.
 */
export async function requestBooking(
  pool: DbPool,
  input: BookingRequestInput,
): Promise<ServiceResult> {
  const token = input.humanToken
  const verdict =
    token === undefined || input.humanCheck === undefined
      ? 'failed'
      : await input.humanCheck(token, input.actionId, 'booking')
  if (verdict === 'failed') {
    input.onGuard?.('human_check_failed')
    return refused(input.actionId, 'human_check')
  }
  if (verdict === 'unavailable') input.onGuard?.('human_check_open')
  const { result } = await applyService(
    pool,
    {
      type: 'reservation.request',
      actionId: input.actionId,
      serviceDate: input.serviceDate,
      partySize: input.partySize,
      guestName: input.guestName,
      phone: input.phone,
      email: input.email,
      note: input.note,
    },
    {
      tenantId: input.tenantId,
      venueId: input.venueId,
      origin: 'guest',
      actor: { kind: 'guest' },
      jobId: input.jobId ?? `guest-booking-${randomUUID()}`,
      via: 'guest_page',
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  )
  return result
}
