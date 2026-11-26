import type { BookingFile } from '@restro/core'
import { describe, expect, it } from 'vitest'

import {
  BOOKING_NIGHT_ANSWERS,
  BOOKING_REFUSALS,
  BookingNightReplySchema,
  BookingReplySchema,
  BookingRequestSchema,
  bookingNightLabel,
  bookingNightText,
  bookingPlanViewOf,
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
  guest_may: 'night',
  areas: [],
  plans: [],
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
      guestMay: 'night',
      areas: [],
      plans: [],
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

  it('takes an Area or spots, defaulting to none for a page from before #580', () => {
    expect(BookingRequestSchema.parse(request)).toMatchObject({ areaId: null, spotIds: [] })
    const picked = {
      ...request,
      areaId: 'ar_0123456789ABCDEFGHIJKL',
      spotIds: ['sp_0123456789ABCDEFGHIJKL'],
    }
    expect(BookingRequestSchema.safeParse(picked).success).toBe(true)
    expect(BookingRequestSchema.safeParse({ ...request, spotIds: ['tb_x'] }).success).toBe(false)
    expect(
      BookingRequestSchema.safeParse({
        ...request,
        spotIds: Array.from({ length: 11 }, (_, i) => `sp_0123456789ABCDEFGHIJK${i}`),
      }).success,
    ).toBe(false)
  })

  it('answers free or taken per spot and nothing else; a gone spot reads as taken', () => {
    const night = { night: '2026-11-28', answer: 'open' }
    expect(
      BookingNightReplySchema.safeParse({
        ...night,
        spots: { sp_0123456789ABCDEFGHIJKL: 'taken' },
      }).success,
    ).toBe(true)
    expect(
      BookingNightReplySchema.safeParse({ ...night, spots: { sp_0123456789ABCDEFGHIJKL: 'Maria' } })
        .success,
    ).toBe(false)
    expect(BookingNightReplySchema.safeParse({ ...night, party: 4 }).success).toBe(false)
    expect(bookingRefusalOf('spot_taken')).toBe('spot_taken')
    expect(bookingRefusalOf('spot_missing')).toBe('spot_taken')
    expect(BookingReplySchema.safeParse({ ok: true, confirmed: true }).success).toBe(true)
  })
})

describe('the plans and Areas of the booking view (#580)', () => {
  const spot = {
    symbol: 'table' as const,
    seats: 4,
    shape: 'rect' as const,
    rotation: 0,
    width: 100,
    height: 100,
  }
  const OFFERED = {
    ...FILE,
    areas: [{ id: 'ar_0123456789ABCDEFGHIJKL', name: 'Hall' }],
    plans: [
      {
        id: 'fp_0123456789ABCDEFGHIJKL',
        name: 'Ground floor',
        spots: [
          {
            ...spot,
            id: 'sp_A123456789ABCDEFGHIJKL',
            name: 'T1',
            area: 'ar_0123456789ABCDEFGHIJKL',
            x: 20,
            y: 20,
          },
          { ...spot, id: 'sp_B123456789ABCDEFGHIJKL', name: 'T2', area: null, x: 320, y: 20 },
        ],
      },
    ],
  } as BookingFile

  it('offers the Areas only where Areas are offered, and the plans only where spots are', () => {
    expect(bookingViewOf(OFFERED, 'en_US', NOW)).toMatchObject({
      guestMay: 'night',
      areas: [],
      plans: [],
    })
    const areas = bookingViewOf({ ...OFFERED, guest_may: 'area' }, 'en_US', NOW)
    expect(areas.areas).toEqual([{ id: 'ar_0123456789ABCDEFGHIJKL', name: 'Hall' }])
    expect(areas.plans).toEqual([])
    const spots = bookingViewOf({ ...OFFERED, guest_may: 'spot' }, 'en_US', NOW)
    expect(spots.areas).toEqual([])
    expect(spots.plans.map((plan) => plan.spots.map((one) => one.name))).toEqual([['T1', 'T2']])
    // The page off offers nothing beyond it.
    expect(bookingViewOf({ ...OFFERED, on: false, guest_may: 'spot' }, 'en_US', NOW).plans).toEqual(
      [],
    )
  })

  it("places each spot in per cent of the plan's own box, and names its Area", () => {
    const plan = bookingPlanViewOf(OFFERED.plans[0] as BookingFile['plans'][number], OFFERED)
    // The box is the spots' extent with a margin of 20: x 0–440, y 0–140.
    expect(plan.aspect).toBeCloseTo(140 / 440)
    expect(plan.spots[0]).toMatchObject({
      name: 'T1',
      area: 'Hall',
      box: { left: 4.55, top: 14.29, width: 22.73, height: 71.43 },
    })
    expect(plan.spots[1]).toMatchObject({ area: null, box: { left: 72.73 } })
  })
})
