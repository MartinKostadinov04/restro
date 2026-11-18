// The nightly alarm over Restro's own refunds (the 11-18 refund decision, 148): the one pair of
// figures, and where a night stands against it. It blocks nothing, so there is nothing else to
// test here. Pure: no database.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { REFUND_ALARM, refundAlarm } from './refund-tripwire'

describe('the figures', () => {
  it('are named once: past 1 % of the night’s captured amount AND three refunds', () => {
    expect(REFUND_ALARM).toEqual({ percent: 1, count: 3 })
  })
})

describe('refundAlarm', () => {
  const night = (capturedMinor: number, refundedMinor: number, refundCount: number) => ({
    capturedMinor,
    refundedMinor,
    refundCount,
  })

  it('keeps an ordinary night quiet', () => {
    // 0.13 % of sales is the benchmark: three refunds of 4 EUR in 3,000 EUR is 0.4 %.
    expect(refundAlarm(night(300_000, 1_200, 3))).toBe(false)
    expect(refundAlarm(night(300_000, 0, 0))).toBe(false)
  })

  it('raises only when both are past: more than 1 % and three or more refunds', () => {
    expect(refundAlarm(night(100_000, 1_001, 3))).toBe(true)
    // exactly 1 % is not past it
    expect(refundAlarm(night(100_000, 1_000, 3))).toBe(false)
    // two refunds, however large a share, is not the alarm's
    expect(refundAlarm(night(100_000, 30_000, 2))).toBe(false)
  })

  it('has no second mark: a very busy night only ever raises the same alarm', () => {
    expect(refundAlarm(night(100_000, 90_000, 40))).toBe(true)
  })

  it('treats a night that captured nothing as every refund being past the share', () => {
    expect(refundAlarm(night(0, 100, 3))).toBe(true)
    expect(refundAlarm(night(0, 100, 2))).toBe(false)
  })

  it('never goes quiet as a night gets worse (more refunds or more money back)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 5 }),
        (captured, refunded, count, moreMinor, moreCount) => {
          if (refundAlarm(night(captured, refunded, count))) {
            expect(refundAlarm(night(captured, refunded + moreMinor, count + moreCount))).toBe(true)
          }
        },
      ),
    )
  })
})
