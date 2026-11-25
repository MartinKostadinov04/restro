import type { BookingFile } from '@restro/core'
import { describe, expect, it } from 'vitest'

import {
  BOOKING_NIGHT_ANSWERS,
  BOOKING_REFUSALS,
  BookingReplySchema,
  BookingRequestSchema,
  bookingNightLabel,
  bookingNightText,
  bookingRefusalOf,
  bookingViewOf,
} from './booking'
import { TURNSTILE_BOOKING_ACTION } from './guest-api'
import { stringsFor } from './strings'

/** Every key of a table of words, nested ones as `a.b`, sorted. */
function keysOf(table: object, prefix = ''): string[] {
  return Object.entries(table)
    .flatMap(([key, value]) =>
      typeof value === 'object' && value !== null
        ? keysOf(value, `${prefix}${key}.`)
        : [`${prefix}${key}`],
    )
    .sort()
}

/** Every word of a table, functions called with a sample. */
function wordsOf(table: object): string[] {
  return Object.values(table).flatMap((value) =>
    typeof value === 'object' && value !== null
      ? wordsOf(value)
      : [typeof value === 'function' ? value('Fri, 28 Nov') : String(value)],
  )
}

const OPEN = { opens: '22:00', closes: '05:00' }

/** A club open Thursday to Saturday night, closed one Friday. */
const FILE: BookingFile = {
  venue_id: 'vn_0123456789ABCDEFGHIJKL',
  name: 'Club Night',
  on: true,
  time_zone: 'Europe/Sofia',
  day_ends_at: '07:00',
  hours: {
    mon: null,
    tue: null,
    wed: null,
    thu: OPEN,
    fri: OPEN,
    sat: OPEN,
    sun: null,
  },
  closed_dates: ['2026-11-27'],
} as BookingFile

// Wednesday 25 November 2026, 18:00 in Sofia.
const NOW = new Date('2026-11-25T16:00:00Z')

describe('the booking strings (#577)', () => {
  it('has the same keys in Bulgarian and English, nested ones too, none of them empty', () => {
    const bg = stringsFor('bg_BG').booking
    const en = stringsFor('en_US').booking
    expect(keysOf(bg)).toEqual(keysOf(en))
    expect(keysOf(en.refusals)).toEqual([...BOOKING_REFUSALS].sort())
    for (const table of [bg, en]) {
      for (const word of wordsOf(table)) expect(word.trim()).not.toBe('')
    }
  })

  it('says the settled words of the answer screen and the page that is off', () => {
    expect(stringsFor('en_US').booking).toMatchObject({
      sentTitle: 'Your request is with the club',
      offTitle: 'No online bookings',
      unavailableTitle: 'Online booking is not available',
    })
    expect(stringsFor('bg_BG').booking).toMatchObject({
      sentTitle: 'Заявката ви е при клуба',
      offTitle: 'Без онлайн резервации',
      unavailableTitle: 'Онлайн резервациите не са достъпни',
    })
  })

  it('refuses a closed night in words that name another way, in both languages', () => {
    expect(stringsFor('en_US').booking.refusals.closed_night).toMatch(/another night|call the club/)
    expect(stringsFor('bg_BG').booking.refusals.closed_night).toMatch(/друга вечер|обадете/)
  })

  it('never says "round" or "кръг" (Martin 11-24)', () => {
    for (const locale of ['bg_BG', 'en_US'] as const) {
      for (const word of wordsOf(stringsFor(locale).booking)) {
        expect(word).not.toMatch(/\bround\b|кръг/i)
      }
    }
  })
})

describe('the booking view', () => {
  it('offers the nights inside the hours from today on, the closed one marked', () => {
    const view = bookingViewOf(FILE, 'en_US', NOW)
    expect(view.on).toBe(true)
    expect(view.venueName).toBe('Club Night')
    expect(view.nights.slice(0, 4)).toEqual([
      { date: '2026-11-26', label: bookingNightLabel('2026-11-26', 'en_US'), open: true },
      { date: '2026-11-27', label: bookingNightLabel('2026-11-27', 'en_US'), open: false },
      { date: '2026-11-28', label: bookingNightLabel('2026-11-28', 'en_US'), open: true },
      { date: '2026-12-03', label: bookingNightLabel('2026-12-03', 'en_US'), open: true },
    ])
    // Wednesday, today, is not a night the club opens.
    expect(view.nights.some((night) => night.date === '2026-11-25')).toBe(false)
  })

  it('offers nothing when the page is off', () => {
    expect(bookingViewOf({ ...FILE, on: false }, 'bg_BG', NOW)).toEqual({
      locale: 'bg_BG',
      venueName: 'Club Night',
      on: false,
      nights: [],
    })
  })

  it('labels a night by its own day, whatever the clock', () => {
    expect(bookingNightLabel('2026-11-28', 'en_US')).toMatch(/Sat/)
    expect(bookingNightLabel('2026-11-28', 'bg_BG')).toMatch(/28/)
  })
})

describe('the booking wire', () => {
  const request = {
    organization: 'tn_0123456789ABCDEFGHIJKL',
    venue: 'vn_0123456789ABCDEFGHIJKL',
    actionId: '0b4d8a2e-3c1f-4f7a-9b1e-2d3c4b5a6f70',
    night: '2026-11-28',
    partySize: 4,
    name: 'Ivan',
    phone: '+359 88 123 4567',
    email: 'ivan@example.com',
    note: null,
  }

  it('takes the form, and never a status, a spot or an id of a reservation', () => {
    expect(BookingRequestSchema.safeParse(request).success).toBe(true)
    for (const extra of [{ status: 'reserved' }, { spotId: 'sp_x' }, { reservationId: 'rv_x' }]) {
      expect(BookingRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false)
    }
    expect(BookingRequestSchema.safeParse({ ...request, email: undefined }).success).toBe(false)
    expect(BookingRequestSchema.safeParse({ ...request, night: '2026-02-30' }).success).toBe(false)
  })

  it('answers with no id, and words every refusal and every night answer', () => {
    expect(BookingReplySchema.safeParse({ ok: true, reservationId: 'rv_x' }).success).toBe(false)
    expect(bookingRefusalOf('closed_night')).toBe('closed_night')
    expect(bookingRefusalOf('origin_not_allowed')).toBe('unavailable')
    const words = stringsFor('en_US').booking
    expect(bookingNightText('open', words)).toBeNull()
    for (const answer of BOOKING_NIGHT_ANSWERS.filter((a) => a !== 'open')) {
      expect(bookingNightText(answer, words), answer).toBeTruthy()
    }
  })

  it('names its own Turnstile action', () => {
    expect(TURNSTILE_BOOKING_ACTION).toBe('booking_request')
  })
})
