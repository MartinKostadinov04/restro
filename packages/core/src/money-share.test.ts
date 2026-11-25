// A group payment's limits in the money module (#543, D160 §3; rule 8): no part above what is left,
// none below the smallest card payment, none that leaves a rest above zero and below it; "the
// rest" is one tap. The property: whatever parts guests try, the parts the limits let through and
// that cover the share sum to the shared amount exactly, the holds (part plus tip) to the shared
// amount plus the tips, and none is below the minimum.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { addMinor, percentOfMinor, sharePartProblem, shareRestMinor, sumSignedMinor } from './money'

const MIN = 50

describe('a share of the bill by amount', () => {
  const check = (claimedMinor: number, partMinor: number) =>
    sharePartProblem({ sharedMinor: 10_000, claimedMinor, partMinor, minimumMinor: MIN })

  it('lets 40, 30, 15 and 15 cover €100, the last as "the rest"', () => {
    expect(check(0, 4_000)).toBeNull()
    expect(check(4_000, 3_000)).toBeNull()
    expect(check(7_000, 1_500)).toBeNull()
    expect(shareRestMinor(10_000, 8_500)).toBe(1_500)
    expect(check(8_500, shareRestMinor(10_000, 8_500))).toBeNull()
  })

  it('refuses a part above €100, one below €0.50, and one leaving a €0.30 rest', () => {
    expect(check(0, 10_001)).toBe('above_share')
    expect(check(4_000, 6_001)).toBe('above_share')
    expect(check(0, 49)).toBe('below_minimum')
    expect(check(0, 0)).toBe('below_minimum')
    expect(check(0, 9_970)).toBe('rest_below_minimum')
    // A rest of exactly the minimum, or of nothing, is fine.
    expect(check(0, 9_950)).toBeNull()
    expect(check(0, 10_000)).toBeNull()
  })

  it('refuses a part that is not integer minor units', () => {
    expect(() => check(0, 12.5)).toThrow()
  })

  it('never lets parts through that do not end exactly at the shared amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN, max: 500_000 }),
        fc.integer({ min: 1, max: 2_000 }),
        fc.array(
          fc.record({
            part: fc.oneof(fc.integer({ min: 0, max: 600_000 }), fc.constant<'rest'>('rest')),
            tipPercent: fc.integer({ min: 0, max: 30 }),
          }),
          { maxLength: 30 },
        ),
        (sharedMinor, minimumMinor, tries) => {
          const holds: { partMinor: number; tipMinor: number }[] = []
          let claimed = 0
          for (const tried of tries) {
            const partMinor =
              tried.part === 'rest' ? shareRestMinor(sharedMinor, claimed) : tried.part
            if (sharePartProblem({ sharedMinor, claimedMinor: claimed, partMinor, minimumMinor })) {
              continue
            }
            const tipMinor = percentOfMinor(partMinor, tried.tipPercent)
            holds.push({ partMinor, tipMinor })
            claimed = addMinor(claimed, partMinor)
          }
          // Never above the shared amount, whatever was tried.
          expect(claimed).toBeLessThanOrEqual(sharedMinor)
          // What is left is never a rest no card may pay.
          const left = shareRestMinor(sharedMinor, claimed)
          expect(left === 0 || left >= Math.min(minimumMinor, sharedMinor)).toBe(true)
          if (claimed !== sharedMinor) return
          // Covered: the share that closes.
          for (const hold of holds) expect(hold.partMinor).toBeGreaterThanOrEqual(minimumMinor)
          const tips = sumSignedMinor(holds.map((hold) => hold.tipMinor))
          const amounts = sumSignedMinor(
            holds.map((hold) => addMinor(hold.partMinor, hold.tipMinor)),
          )
          expect(amounts).toBe(addMinor(sharedMinor, tips))
        },
      ),
      { numRuns: 400 },
    )
  })
})
