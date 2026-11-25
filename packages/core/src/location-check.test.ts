import { describe, expect, it } from 'vitest'

import {
  distanceMetres,
  GuestPositionSchema,
  issuePaths,
  locationPassExpiry,
  locationVerdict,
} from './location-check'

// Sofia; 0.001° of latitude is about 111 m.
const SPOT = { lat: 42.6977, lng: 23.3219 }

describe('the circle-touch test', () => {
  it('measures distances on the globe', () => {
    expect(distanceMetres(SPOT, SPOT)).toBe(0)
    expect(distanceMetres(SPOT, { lat: SPOT.lat + 0.001, lng: SPOT.lng })).toBeCloseTo(111.2, 0)
  })

  it('passes a phone whose circle touches the venue’s, and fails one clearly elsewhere', () => {
    expect(locationVerdict({ ...SPOT, accuracyM: 5 }, SPOT, 150)).toBe('inside')
    // 222 m away with 80 m of doubt touches a 150 m circle; with 50 m it doesn't.
    const away = { lat: SPOT.lat + 0.002, lng: SPOT.lng }
    expect(locationVerdict({ ...away, accuracyM: 80 }, SPOT, 150)).toBe('inside')
    expect(locationVerdict({ ...away, accuracyM: 50 }, SPOT, 150)).toBe('outside')
    expect(locationVerdict({ lat: 42.15, lng: 24.75, accuracyM: 20 }, SPOT, 500)).toBe('outside')
  })

  it("can't check a circle wider than 1 km, or a venue with no spot (both fail closed)", () => {
    expect(locationVerdict({ ...SPOT, accuracyM: 1_000 }, SPOT, 150)).toBe('inside')
    expect(locationVerdict({ ...SPOT, accuracyM: 1_001 }, SPOT, 150)).toBe('cant_check')
    expect(locationVerdict({ ...SPOT, accuracyM: 3_000 }, SPOT, 150)).toBe('cant_check')
    expect(locationVerdict({ ...SPOT, accuracyM: 5 }, null, 150)).toBe('cant_check')
  })

  it('reports a bad position by path only, never with what it held', () => {
    const parsed = GuestPositionSchema.safeParse({ lat: 142.6977, lng: 23.3219, accuracyM: -1 })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const paths = issuePaths(parsed.error)
    expect(paths).toEqual(['lat', 'accuracyM'])
    expect(JSON.stringify(paths)).not.toContain('142')
    expect(GuestPositionSchema.safeParse({ ...SPOT, accuracyM: 5, at: 1 }).success).toBe(false)
  })
})

describe('the location pass’s expiry', () => {
  const zone = 'Europe/Sofia'

  it('lasts the venue’s pass time inside the service day', () => {
    // 22:00 Sofia (UTC+3 in summer) on a day ending 07:00: 2 h later is midnight.
    const now = new Date('2026-07-10T19:00:00Z')
    expect(locationPassExpiry(now, 120, zone, '07:00').toISOString()).toBe(
      '2026-07-10T21:00:00.000Z',
    )
  })

  it('is cut at the end of the service day', () => {
    // 06:00 Sofia: the day ends at 07:00, an hour before the 2 h are up.
    const now = new Date('2026-07-11T03:00:00Z')
    const until = locationPassExpiry(now, 120, zone, '07:00')
    expect(until.getTime()).toBeLessThanOrEqual(Date.parse('2026-07-11T04:00:00Z'))
    expect(until.getTime()).toBeGreaterThan(Date.parse('2026-07-11T04:00:00Z') - 1_000)
  })

  it('follows a change of the clocks in the night', () => {
    // 25 October 2026: Sofia goes from UTC+3 to UTC+2 at 04:00. 06:30 local is 04:30Z; the day
    // ends at 07:00 local, which is 05:00Z.
    const now = new Date('2026-10-25T04:30:00Z')
    const until = locationPassExpiry(now, 360, zone, '07:00')
    expect(Math.abs(until.getTime() - Date.parse('2026-10-25T05:00:00Z'))).toBeLessThan(1_000)
  })
})
