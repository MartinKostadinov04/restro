// Which nights the booking page offers and accepts (#577; spec #322 story 9 and 30).
import { describe, expect, it } from 'vitest'

import {
  BOOKING_DAYS_AHEAD,
  type BookingCalendar,
  bookingNightVerdict,
  bookingWeekdayOf,
  isServiceDay,
  offeredBookingNights,
} from './booking-nights'

const CLOSED_WEEK = {
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
} as const

/** Fridays and Saturdays, 22:00 to 05:30, in Sofia; service day ends 07:00; one closed Friday. */
const CALENDAR: BookingCalendar = {
  timeZone: 'Europe/Sofia',
  dayEndsAt: '07:00',
  hours: {
    ...CLOSED_WEEK,
    fri: { opens: '22:00', closes: '05:30' },
    sat: { opens: '22:00', closes: '05:30' },
  },
  closedDates: ['2026-10-30'],
}

describe('a night on the booking page', () => {
  /** Tuesday 20 October 2026, 13:00 in Sofia. */
  const TUESDAY = new Date('2026-10-20T10:00:00Z')

  it('is open on a working night ahead, closed on a closed date, and refused outside the hours', () => {
    expect(bookingNightVerdict('2026-10-23', TUESDAY, CALENDAR)).toBe('open')
    expect(bookingNightVerdict('2026-10-24', TUESDAY, CALENDAR)).toBe('open')
    expect(bookingNightVerdict('2026-10-30', TUESDAY, CALENDAR)).toBe('closed_date')
    expect(bookingNightVerdict('2026-10-22', TUESDAY, CALENDAR)).toBe('outside_hours')
    expect(bookingNightVerdict('2026-10-16', TUESDAY, CALENDAR)).toBe('past')
  })

  it("is still open tonight after midnight, and past once tonight's closing came", () => {
    // 02:00 on Saturday in Sofia: Friday's night is still on.
    expect(bookingNightVerdict('2026-10-23', new Date('2026-10-23T23:00:00Z'), CALENDAR)).toBe(
      'open',
    )
    // 05:30 in Sofia: Friday's night has closed, though its service day runs to 07:00.
    expect(bookingNightVerdict('2026-10-23', new Date('2026-10-24T02:30:00Z'), CALENDAR)).toBe(
      'past',
    )
  })

  it('stops at the horizon', () => {
    const friday = (weeks: number) => {
      const day = new Date(Date.UTC(2026, 9, 23 + weeks * 7))
      return day.toISOString().slice(0, 10)
    }
    expect(bookingNightVerdict(friday(12), TUESDAY, CALENDAR)).toBe('open')
    expect(bookingNightVerdict(friday(14), TUESDAY, CALENDAR)).toBe('too_far')
    expect(BOOKING_DAYS_AHEAD).toBe(90)
  })

  it('offers only nights inside the hours, a closed date marked, today first', () => {
    const offered = offeredBookingNights(TUESDAY, CALENDAR)
    expect(offered.slice(0, 4)).toEqual([
      { date: '2026-10-23', verdict: 'open' },
      { date: '2026-10-24', verdict: 'open' },
      { date: '2026-10-30', verdict: 'closed_date' },
      { date: '2026-10-31', verdict: 'open' },
    ])
    for (const night of offered) {
      expect(['fri', 'sat'], night.date).toContain(bookingWeekdayOf(night.date))
    }
  })

  it('offers nothing at a venue that has opened no weekday', () => {
    expect(offeredBookingNights(TUESDAY, { ...CALENDAR, hours: CLOSED_WEEK })).toEqual([])
  })

  it('knows a service day from a string that only looks like one', () => {
    expect(isServiceDay('2028-02-29')).toBe(true)
    expect(isServiceDay('2027-02-29')).toBe(false)
    expect(isServiceDay('23.10.2026')).toBe(false)
  })
})
