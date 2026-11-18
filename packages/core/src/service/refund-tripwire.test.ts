// The nightly tripwire of Restro's own refunds (the 11-18 refund decision, 148): the two named
// figures, and where a night stands against them. Pure: no database.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { REFUND_ALARM, REFUND_SWITCH_OFF, refundTripwire } from './refund-tripwire'

describe('the two figures', () => {
  it("are the lead's, named once: alarm past 1 % AND three refunds, switch-off past 5 % OR fifteen", () => {
    expect(REFUND_ALARM).toEqual({ percent: 1, count: 3 })
    expect(REFUND_SWITCH_OFF).toEqual({ percent: 5, count: 15 })
  })
})

describe('refundTripwire', () => {
  const night = (capturedMinor: number, refundedMinor: number, refundCount: number) => ({
    capturedMinor,
    refundedMinor,
    refundCount,
  })

  it('keeps an ordinary night quiet', () => {
    // 0.13 % of sales is the benchmark: three refunds of 4 EUR in 3,000 EUR is 0.4 %.
    expect(refundTripwire(night(300_000, 1_200, 3))).toBe('quiet')
    expect(refundTripwire(night(300_000, 0, 0))).toBe('quiet')
  })

  it('raises the alarm only when both are past: more than 1 % and three or more refunds', () => {
    expect(refundTripwire(night(100_000, 1_001, 3))).toBe('alarm')
    // exactly 1 % is not past it
    expect(refundTripwire(night(100_000, 1_000, 3))).toBe('quiet')
    // two refunds, however large a share, is not the alarm's (it is the switch-off's if past 5 %)
    expect(refundTripwire(night(100_000, 3_000, 2))).toBe('quiet')
  })

  it('switches the route off past 5 % of the night or at fifteen refunds, whichever comes first', () => {
    expect(refundTripwire(night(100_000, 5_001, 1))).toBe('switch_off')
    expect(refundTripwire(night(100_000, 5_000, 1))).toBe('quiet')
    expect(refundTripwire(night(10_000_000, 15_00, 15))).toBe('switch_off')
    expect(refundTripwire(night(10_000_000, 14_00, 14))).toBe('quiet')
  })

  it('treats a night that captured nothing as every refund being past the share', () => {
    expect(refundTripwire(night(0, 100, 1))).toBe('switch_off')
  })

  it('never goes down as a night gets worse (more refunds or more money back)', () => {
    const rank = { quiet: 0, alarm: 1, switch_off: 2 } as const
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 5 }),
        (captured, refunded, count, moreMinor, moreCount) => {
          const before = rank[refundTripwire(night(captured, refunded, count))]
          const after = rank[refundTripwire(night(captured, refunded + moreMinor, count + moreCount))]
          expect(after).toBeGreaterThanOrEqual(before)
        },
      ),
    )
  })
})
