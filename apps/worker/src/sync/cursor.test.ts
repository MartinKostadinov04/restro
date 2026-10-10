import { describe, expect, it } from 'vitest'

import { CURSOR_OVERLAP_MINUTES, lastUpdateFilter, localTimeText } from './cursor'

describe('the incremental cursor', () => {
  it('writes an instant as the venue’s wall-clock time', () => {
    // Sofia is UTC+3 in October (summer time ends on 2026-10-25), UTC+2 in January.
    expect(localTimeText(new Date('2026-10-09T10:00:00Z'), 'Europe/Sofia')).toBe(
      '2026-10-09 13:00:00',
    )
    expect(localTimeText(new Date('2026-01-15T10:00:00Z'), 'Europe/Sofia')).toBe(
      '2026-01-15 12:00:00',
    )
    // Midnight is 00, not 24.
    expect(localTimeText(new Date('2026-10-08T21:00:00Z'), 'Europe/Sofia')).toBe(
      '2026-10-09 00:00:00',
    )
  })

  it('goes back 65 minutes before the previous run’s start', () => {
    expect(CURSOR_OVERLAP_MINUTES).toBe(65)
    expect(lastUpdateFilter(new Date('2026-10-09T10:00:00Z'), 'Europe/Sofia')).toBe(
      '2026-10-09 11:55:00',
    )
    // Across midnight: 00:30 local on the 9th looks back to 23:25 on the 8th.
    expect(lastUpdateFilter(new Date('2026-10-08T21:30:00Z'), 'Europe/Sofia')).toBe(
      '2026-10-08 23:25:00',
    )
  })

  it('the overlap is longer than the hour a daylight saving change moves the clock', () => {
    // Spring forward: 03:00 -> 04:00 on 2026-03-29. A run at 01:10 UTC (04:10 local) looks back
    // to 00:05 UTC, which is 02:05 local: before the jump, so nothing falls between two runs.
    expect(lastUpdateFilter(new Date('2026-03-29T01:10:00Z'), 'Europe/Sofia')).toBe(
      '2026-03-29 02:05:00',
    )
    // Fall back: 04:00 -> 03:00 on 2026-10-25. A run at 01:30 UTC (03:30 local, second time) looks
    // back to 00:25 UTC = 03:25 local the first time round: the instants are real, so the filter
    // is never later than the true cursor.
    expect(lastUpdateFilter(new Date('2026-10-25T01:30:00Z'), 'Europe/Sofia')).toBe(
      '2026-10-25 03:25:00',
    )
  })

  it('refuses a time that is not a time', () => {
    expect(() => localTimeText(new Date('nope'), 'Europe/Sofia')).toThrow(RangeError)
  })
})
