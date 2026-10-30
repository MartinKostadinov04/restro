import { describe, expect, it } from 'vitest'

import {
  isoInTimeZone,
  liveEditions,
  localInstant,
  serviceDate,
  serviceDayStartsAt,
  serviceEditionId,
  serviceEditionLayer,
  snapshotEditions,
} from './service-day'

const SOFIA = 'Europe/Sofia'

describe('serviceDate (D45: the night belongs to the evening it started)', () => {
  it.each([
    ['2026-10-09T18:00:00Z', '07:00', '2026-10-09'], // 21:00 local
    ['2026-10-09T21:30:00Z', '07:00', '2026-10-09'], // 00:30 local on the 10th
    ['2026-10-10T03:59:59Z', '07:00', '2026-10-09'], // 06:59:59 local
    ['2026-10-10T04:00:00Z', '07:00:00', '2026-10-10'], // 07:00 local: a new service day
    ['2026-10-10T04:00:00Z', '00:00', '2026-10-10'],
    ['2027-01-01T03:00:00Z', '07:00', '2026-12-31'], // across a year
    ['2026-03-29T03:30:00Z', '07:00', '2026-03-28'], // the spring-forward night (06:30 EEST)
  ])('%s with the day ending at %s is service day %s', (at, endsAt, expected) => {
    expect(serviceDate(new Date(at), SOFIA, endsAt)).toBe(expected)
  })

  it('refuses a malformed end of day or time zone', () => {
    expect(() => serviceDate(new Date(), SOFIA, '7am')).toThrow(RangeError)
    expect(() => serviceDate(new Date(), 'Mars/Olympus', '07:00')).toThrow(RangeError)
  })
})

describe('serviceDayStartsAt (#77: a bill from last night is never joined)', () => {
  it.each([
    ['2026-10-09T21:30:00Z', '07:00', '2026-10-09T04:00:00.000Z'], // 00:30 local: began 07:00 the 9th
    ['2026-10-10T04:00:00Z', '07:00', '2026-10-10T04:00:00.000Z'], // the first second of a day
    ['2026-10-10T03:59:59Z', '07:00', '2026-10-09T04:00:00.000Z'],
    ['2026-10-10T12:00:00Z', '00:00', '2026-10-09T21:00:00.000Z'], // midnight local
    ['2026-03-29T10:00:00Z', '07:00', '2026-03-29T04:00:00.000Z'], // after spring-forward (EEST)
  ])('at %s with the day ending at %s, the day began at %s', (at, endsAt, expected) => {
    expect(serviceDayStartsAt(new Date(at), SOFIA, endsAt).toISOString()).toBe(expected)
  })
})

describe('isoInTimeZone', () => {
  it('gives local time with the offset of that instant', () => {
    expect(isoInTimeZone(new Date('2026-10-08T18:04:12Z'), SOFIA)).toBe('2026-10-08T21:04:12+03:00')
    expect(isoInTimeZone(new Date('2026-12-08T18:04:12.900Z'), SOFIA)).toBe(
      '2026-12-08T20:04:12+02:00',
    )
    expect(isoInTimeZone(new Date('2026-12-08T18:04:12Z'), 'UTC')).toBe('2026-12-08T18:04:12+00:00')
    expect(isoInTimeZone(new Date('2026-12-08T18:04:12Z'), 'America/St_Johns')).toBe(
      '2026-12-08T14:34:12-03:30',
    )
  })
})

describe('the editions of a service day (S3-08)', () => {
  it("names the layer a day's sold-out marks live in", () => {
    expect(serviceEditionId('2026-10-09')).toBe('service:2026-10-09')
    expect(serviceEditionLayer('2026-10-09')).toBe('edition:service:2026-10-09')
    for (const bad of ['', '2026-10-9', '09-10-2026', '2026-10-09T20:00', 'tonight']) {
      expect(() => serviceEditionLayer(bad), bad).toThrow(RangeError)
    }
  })

  it('resolves a snapshot with the venue edition only, and the live menu with the day too', () => {
    expect(snapshotEditions('vn_x')).toEqual(['venue:vn_x'])
    expect(liveEditions('vn_x', '2026-10-09')).toEqual(['venue:vn_x', 'service:2026-10-09'])
    // A snapshot never names a service day, whatever the day is.
    expect(snapshotEditions('vn_x').some((id) => id.startsWith('service:'))).toBe(false)
  })
})

describe('localInstant (a wall-clock time of a service day, as an instant)', () => {
  it('reads an evening time on the day itself', () => {
    expect(localInstant('2026-10-09', '22:00', SOFIA, '07:00').toISOString()).toBe(
      '2026-10-09T19:00:00.000Z', // 22:00 EEST
    )
  })

  it('puts a time before the end of the day on the next calendar date', () => {
    expect(localInstant('2026-10-09', '02:30', SOFIA, '07:00').toISOString()).toBe(
      '2026-10-09T23:30:00.000Z', // 02:30 EEST on the 10th
    )
  })

  it('follows the offset of that date, across the autumn change', () => {
    // A time the spring change skips lands where the clocks jump to, 04:00 EEST: never past a
    // later time of the night (RR-65), and every skipped time lands on the same instant.
    for (const skipped of ['03:00', '03:30', '03:59']) {
      expect(localInstant('2027-03-27', skipped, SOFIA, '07:00').toISOString()).toBe(
        '2027-03-28T01:00:00.000Z',
      )
    }
    expect(localInstant('2027-03-27', '02:59', SOFIA, '07:00').toISOString()).toBe(
      '2027-03-28T00:59:00.000Z',
    )
    expect(localInstant('2027-03-27', '04:00', SOFIA, '07:00').toISOString()).toBe(
      '2027-03-28T01:00:00.000Z',
    )
    // 2026-10-25 03:30 local is after the clocks went back (EET, +02:00).
    expect(localInstant('2026-10-24', '03:30', SOFIA, '07:00').toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    )
    expect(localInstant('2026-10-25', '23:00', SOFIA, '07:00').toISOString()).toBe(
      '2026-10-25T21:00:00.000Z',
    )
  })
})
