import { describe, expect, it } from 'vitest'

import { reservationVersion } from './version'

describe('the version of a reservation', () => {
  const row = new Date('2026-11-10T20:00:00.123Z')

  it('is the row’s own moment when no spot is newer', () => {
    expect(reservationVersion(row, null)).toBe('2026-11-10T20:00:00.123Z')
    expect(reservationVersion(row, new Date('2026-11-10T19:00:00.000Z'))).toBe(
      '2026-11-10T20:00:00.123Z',
    )
  })

  it('moves when the spots it holds are written after the row', () => {
    expect(reservationVersion(row, new Date('2026-11-10T20:05:00.000Z'))).toBe(
      '2026-11-10T20:05:00.000Z',
    )
  })

  it('reads back as the same instant, so a form can send it home', () => {
    const version = reservationVersion(row, null)
    expect(new Date(version).getTime()).toBe(row.getTime())
  })
})
