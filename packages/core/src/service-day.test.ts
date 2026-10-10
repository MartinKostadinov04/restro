import { describe, expect, it } from 'vitest'

import {
  isoInTimeZone,
  liveEditions,
  serviceDate,
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
