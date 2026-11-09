// The nights the day button offers (#326 extends the Log's picker): the Log and the end of the
// night look back only, so nothing about them changes; the reservations list also offers the
// nights to come, because that is where a booking is taken.
import { describe, expect, it } from 'vitest'

import { listedNights } from './day-picker'

const TODAY = '2026-11-09'

describe('looking back only (the Log, the end of the night: `ahead` 0)', () => {
  it('opens on today, then counts back a month', () => {
    const nights = listedNights(TODAY, [], 0)
    expect(nights[0]).toBe(TODAY)
    expect(nights[1]).toBe('2026-11-08')
    expect(nights.at(-1)).toBe('2026-10-09')
    expect(nights).toHaveLength(32)
  })

  it('keeps a night that holds something, however far back it falls', () => {
    const nights = listedNights(TODAY, ['2026-08-15', '2026-11-08'], 0)
    expect(nights).toContain('2026-08-15')
    expect(nights.indexOf('2026-11-08')).toBeLessThan(nights.indexOf('2026-08-15'))
    // Newest first, so yesterday comes before the month before it.
    expect(nights.filter((night) => night === '2026-11-08')).toHaveLength(1)
  })

  it('offers no night to come, even one that holds something', () => {
    const nights = listedNights(TODAY, ['2026-12-31'], 0)
    expect(nights).not.toContain('2026-12-31')
    expect(nights.every((night) => night <= TODAY)).toBe(true)
  })
})

describe('the reservations list (`ahead` 60)', () => {
  const nights = listedNights(TODAY, ['2026-12-31'], 60)

  it('opens on today, with the nights to come next and the past after them', () => {
    expect(nights[0]).toBe(TODAY)
    expect(nights[1]).toBe('2026-11-10')
    expect(nights.indexOf('2026-11-10')).toBeLessThan(nights.indexOf('2026-11-08'))
  })

  it('counts the nights ahead upwards and the past downwards', () => {
    const ahead = nights.slice(1, nights.indexOf('2026-11-08'))
    expect([...ahead].sort()).toEqual(ahead)
    const past = nights.slice(nights.indexOf('2026-11-08'))
    expect([...past].sort().reverse()).toEqual(past)
  })

  it('keeps a booking far out beside the nights it lists anyway, and lists each night once', () => {
    expect(nights).toContain('2026-12-31')
    expect(new Set(nights).size).toBe(nights.length)
  })
})
