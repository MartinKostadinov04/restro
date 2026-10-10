import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { ABSENCE_HOLD_MIN, ABSENCE_HOLD_RATIO, absenceHold } from './absence-hold'

describe('absenceHold: the rules', () => {
  it('has the constants of the brief (30% and at least 5)', () => {
    expect(ABSENCE_HOLD_RATIO).toBe(0.3)
    expect(ABSENCE_HOLD_MIN).toBe(5)
  })

  it('an empty read over active links holds, however few there are', () => {
    expect(absenceHold({ activeBefore: 65, seen: 0, wouldGoMissing: 65 })).toEqual({
      hold: true,
      reason: 'empty_read',
    })
    expect(absenceHold({ activeBefore: 1, seen: 0, wouldGoMissing: 1 })).toEqual({
      hold: true,
      reason: 'empty_read',
    })
  })

  it('an empty read of an empty menu is nothing to hold', () => {
    expect(absenceHold({ activeBefore: 0, seen: 0, wouldGoMissing: 0 })).toEqual({ hold: false })
  })

  it('hiding 61 of 65 holds as too many missing', () => {
    expect(absenceHold({ activeBefore: 65, seen: 4, wouldGoMissing: 61 })).toEqual({
      hold: true,
      reason: 'too_many_missing',
    })
  })

  it('a small drop passes: 2 of 65, and 4 of 10 (under the minimum)', () => {
    expect(absenceHold({ activeBefore: 65, seen: 63, wouldGoMissing: 2 })).toEqual({ hold: false })
    expect(absenceHold({ activeBefore: 10, seen: 6, wouldGoMissing: 4 })).toEqual({ hold: false })
  })

  it('exactly 30% passes, more than 30% holds (once at least 5 would go)', () => {
    expect(absenceHold({ activeBefore: 20, seen: 14, wouldGoMissing: 6 })).toEqual({ hold: false })
    expect(absenceHold({ activeBefore: 20, seen: 13, wouldGoMissing: 7 })).toEqual({
      hold: true,
      reason: 'too_many_missing',
    })
    expect(absenceHold({ activeBefore: 100, seen: 70, wouldGoMissing: 30 })).toEqual({
      hold: false,
    })
    expect(absenceHold({ activeBefore: 100, seen: 69, wouldGoMissing: 31 })).toEqual({
      hold: true,
      reason: 'too_many_missing',
    })
  })

  it('the minimum counts: 4 of 4 is a small menu losing its items, 5 of 5 is held', () => {
    // 4 of 5 seen is not an empty read and is under the minimum: not held.
    expect(absenceHold({ activeBefore: 5, seen: 1, wouldGoMissing: 4 })).toEqual({ hold: false })
    expect(absenceHold({ activeBefore: 6, seen: 1, wouldGoMissing: 5 })).toEqual({
      hold: true,
      reason: 'too_many_missing',
    })
  })

  it('refuses counts that are not whole non-negative numbers (a caller bug)', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => absenceHold({ activeBefore: bad, seen: 0, wouldGoMissing: 0 })).toThrow(
        TypeError,
      )
      expect(() => absenceHold({ activeBefore: 1, seen: bad, wouldGoMissing: 0 })).toThrow(
        TypeError,
      )
      expect(() => absenceHold({ activeBefore: 1, seen: 0, wouldGoMissing: bad })).toThrow(
        TypeError,
      )
    }
  })
})

describe('absenceHold properties (fast-check)', () => {
  const count = fc.integer({ min: 0, max: 5000 })

  it('an empty read never hides: seen 0 over active links that would go missing always holds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), (active) => {
        expect(absenceHold({ activeBefore: active, seen: 0, wouldGoMissing: active })).toEqual({
          hold: true,
          reason: 'empty_read',
        })
      }),
    )
  })

  it('hiding more than 30% (and at least 5) always holds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: ABSENCE_HOLD_MIN, max: 5000 }),
        fc.integer({ min: ABSENCE_HOLD_MIN, max: 5000 }),
        count,
        (x, y, seen) => {
          const active = Math.max(x, y)
          const hidden = Math.min(x, y)
          fc.pre(hidden / active > ABSENCE_HOLD_RATIO)
          const verdict = absenceHold({ activeBefore: active, seen, wouldGoMissing: hidden })
          expect(verdict.hold).toBe(true)
        },
      ),
    )
  })

  it('a drop of at most 30% never holds, when the read saw the rest', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 5000 })
          .chain((active) =>
            fc.tuple(
              fc.constant(active),
              fc.integer({ min: 0, max: Math.floor(active * ABSENCE_HOLD_RATIO) }),
            ),
          ),
        ([active, hidden]) => {
          fc.pre(hidden / active <= ABSENCE_HOLD_RATIO)
          const verdict = absenceHold({
            activeBefore: active,
            seen: active - hidden,
            wouldGoMissing: hidden,
          })
          expect(verdict).toEqual({ hold: false })
        },
      ),
    )
  })

  it('fewer than 5 never holds unless the read was empty', () => {
    fc.assert(
      fc.property(
        count,
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 0, max: ABSENCE_HOLD_MIN - 1 }),
        (active, seen, hidden) => {
          expect(absenceHold({ activeBefore: active, seen, wouldGoMissing: hidden }).hold).toBe(
            false,
          )
        },
      ),
    )
  })

  it('never holds when wouldGoMissing is 0, whatever else is true', () => {
    fc.assert(
      fc.property(count, count, (active, seen) => {
        expect(absenceHold({ activeBefore: active, seen, wouldGoMissing: 0 })).toEqual({
          hold: false,
        })
      }),
    )
  })

  it('a hold always names a reason, and a pass names none', () => {
    fc.assert(
      fc.property(count, count, count, (active, seen, hidden) => {
        const verdict = absenceHold({ activeBefore: active, seen, wouldGoMissing: hidden })
        if (verdict.hold) expect(['empty_read', 'too_many_missing']).toContain(verdict.reason)
        else expect(Object.keys(verdict)).toEqual(['hold'])
      }),
    )
  })
})
