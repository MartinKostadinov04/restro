// How long service rows are kept (D120, D122 §7, design §4; #84): the purge's cutoffs never make a
// row due before its time. Any instant of a service day the cutoff lets go lies at least 31 days
// (a `night` row) or 18 calendar months (a `record` row) before the purge's clock, in the venue's own time
// zone and service day, across midnight, the day's end hour and daylight-saving changes.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { serviceDate } from '../service-day'
import { monthsBefore, serviceRetentionCutoffs } from './log'

const DAY_MS = 24 * 60 * 60 * 1000
const SOFIA = 'Europe/Sofia'

describe('the service retention cutoffs', () => {
  it('lets a night row go only once its service day ended 31 days ago', () => {
    // 15:00 in Sofia; 31 days back is 25 September, 15:00, inside service day 25 September.
    const now = new Date('2026-10-26T12:00:00Z')
    const cutoffs = serviceRetentionCutoffs(now, SOFIA, '07:00')
    expect(cutoffs.night).toBe('2026-09-25')
    // 24 September ended on the 25th at 07:00, 31 days and 8 hours ago: due. The 25th ends on the
    // 26th at 07:00, which is not yet 31 days ago: kept.
    expect('2026-09-24' < cutoffs.night).toBe(true)
    expect('2026-09-25' < cutoffs.night).toBe(false)
  })

  it('counts the night up to the hour the service day ends', () => {
    // 06:30 in Sofia on 26 October: 31 days back is 06:30 on 25 September, still the night of the
    // 24th, so the 24th is kept until 07:00.
    const early = serviceRetentionCutoffs(new Date('2026-10-26T03:30:00Z'), SOFIA, '07:00')
    expect(early.night).toBe('2026-09-24')
    expect('2026-09-24' < early.night).toBe(false)
  })

  it('lets a record row go only once its service day ended 18 months ago', () => {
    const now = new Date('2026-10-26T12:00:00Z')
    const cutoffs = serviceRetentionCutoffs(now, SOFIA, '07:00')
    expect(cutoffs.record).toBe('2025-04-26')
    expect('2025-04-25' < cutoffs.record).toBe(true)
    expect('2025-04-26' < cutoffs.record).toBe(false)
  })

  it('goes back months to the last day the earlier month has, never past it', () => {
    expect(monthsBefore(new Date('2026-08-31T10:00:00Z'), 18).toISOString()).toBe(
      '2025-02-28T10:00:00.000Z',
    )
    expect(monthsBefore(new Date('2025-08-29T10:00:00Z'), 18).toISOString()).toBe(
      '2024-02-29T10:00:00.000Z',
    )
    expect(monthsBefore(new Date('2026-01-15T00:00:00Z'), 1).toISOString()).toBe(
      '2025-12-15T00:00:00.000Z',
    )
  })

  it('never makes a row due early, in any zone and at any end hour', () => {
    const instant = fc.date({
      min: new Date('2020-01-01T00:00:00Z'),
      max: new Date('2035-12-31T00:00:00Z'),
      noInvalidDate: true,
    })
    fc.assert(
      fc.property(
        instant,
        instant,
        fc.constantFrom(SOFIA, 'Europe/London', 'America/New_York', 'Asia/Kolkata', 'UTC'),
        fc.constantFrom('00:00', '04:30', '07:00', '11:59'),
        (now, at, timezone, dayEndsAt) => {
          const cutoffs = serviceRetentionCutoffs(now, timezone, dayEndsAt)
          const day = serviceDate(at, timezone, dayEndsAt)
          if (day < cutoffs.night) {
            expect(at.getTime() + NIGHT_MS).toBeLessThanOrEqual(now.getTime())
          }
          if (day < cutoffs.record) {
            expect(at.getTime()).toBeLessThanOrEqual(monthsBefore(now, 18).getTime())
          }
        },
      ),
    )
  })
})

const NIGHT_MS = 31 * DAY_MS
