// Which nights a guest may ask for on the venue's booking page (#577; spec #322 Implementation
// Decisions 1, story 9 and 30; D136). One rule, read by three places that must agree: the page
// (which nights it offers, from the published booking file), the narrow endpoint that confirms a
// night, and the command that writes the request.
//
// A guest books only inside the venue's own service hours (`venues.settings.ordering.serviceHours`),
// with the reservation settings' one-off closed dates on top; nothing else is a second copy of the
// hours. A night is:
// - `past` when its service day is before today's, or it is today's and its closing hour came;
// - `outside_hours` when the venue keeps that weekday closed (or has opened no weekday at all);
// - `too_far` when it lies past the booking horizon;
// - `closed_date` when the venue closed that one night;
// - `open` otherwise.
//
// Pure: the instant is an input, so a test picks any night, midnight and clock changes included.

import { WEEKDAYS, type Weekday } from './ordering-settings'
import { addDaysToDay, localInstant, serviceDate } from './service-day'

/** How far ahead a guest may ask for a night, in days from today's service day. */
export const BOOKING_DAYS_AHEAD = 90

/** One weekday's opening and closing, as the booking file publishes them (`HH:MM`). */
export interface BookingDayHours {
  readonly opens: string
  readonly closes: string
}

/** What the rule needs: the venue's clock, its weekly hours and its closed dates. */
export interface BookingCalendar {
  readonly timeZone: string
  /** `HH:MM` or `HH:MM:SS`: when the venue's service day ends. */
  readonly dayEndsAt: string
  readonly hours: Readonly<Record<Weekday, BookingDayHours | null>>
  /** One-off closed service days, `YYYY-MM-DD`. */
  readonly closedDates: readonly string[]
}

/** What a night is to a guest asking for it. */
export type BookingNightVerdict = 'open' | 'closed_date' | 'outside_hours' | 'past' | 'too_far'

/** The weekday a service day opened on, Monday first. */
export function bookingWeekdayOf(day: string): Weekday {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const sundayFirst = new Date(Date.UTC(year, month - 1, date)).getUTCDay()
  return WEEKDAYS[(sundayFirst + 6) % 7] as Weekday
}

/** True for `YYYY-MM-DD` naming a real calendar day. */
export function isServiceDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, date] = value.split('-').map(Number) as [number, number, number]
  const day = new Date(Date.UTC(year, month - 1, date))
  return (
    day.getUTCFullYear() === year && day.getUTCMonth() === month - 1 && day.getUTCDate() === date
  )
}

/** When a night opens and closes, or null when its weekday is closed. */
export function bookingNightHours(
  night: string,
  calendar: BookingCalendar,
): { readonly opensAt: Date; readonly closesAt: Date } | null {
  const hours = calendar.hours[bookingWeekdayOf(night)]
  if (hours === null || hours === undefined) return null
  const at = (time: string) => localInstant(night, time, calendar.timeZone, calendar.dayEndsAt)
  return { opensAt: at(hours.opens), closesAt: at(hours.closes) }
}

/** What `night` (`YYYY-MM-DD`) is to a guest asking for it at `now`. */
export function bookingNightVerdict(
  night: string,
  now: Date,
  calendar: BookingCalendar,
): BookingNightVerdict {
  const today = serviceDate(now, calendar.timeZone, calendar.dayEndsAt)
  if (night < today) return 'past'
  const hours = bookingNightHours(night, calendar)
  if (hours === null) return 'outside_hours'
  if (hours.closesAt.getTime() <= now.getTime()) return 'past'
  if (night > addDaysToDay(today, BOOKING_DAYS_AHEAD)) return 'too_far'
  if (calendar.closedDates.includes(night)) return 'closed_date'
  return 'open'
}

/** A night the page offers: one inside the venue's hours, open or closed that one night. */
export interface OfferedNight {
  readonly date: string
  readonly verdict: 'open' | 'closed_date'
}

/**
 * The nights the page offers, today's first: every night inside the venue's service hours from now
 * to the horizon. A night outside the hours or already past is not offered at all; a closed date is
 * offered marked, so the guest who picks it is told in words to choose another (story 9).
 */
export function offeredBookingNights(now: Date, calendar: BookingCalendar): OfferedNight[] {
  const today = serviceDate(now, calendar.timeZone, calendar.dayEndsAt)
  const nights: OfferedNight[] = []
  for (let ahead = 0; ahead <= BOOKING_DAYS_AHEAD; ahead++) {
    const date = addDaysToDay(today, ahead)
    const verdict = bookingNightVerdict(date, now, calendar)
    if (verdict === 'open' || verdict === 'closed_date') nights.push({ date, verdict })
  }
  return nights
}
