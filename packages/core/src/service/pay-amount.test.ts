// The hold's amount (#110, D127 3.2, rule 8) as a property: for any POS line amounts (a discount
// line is negative) and any tip, the hold is exactly the POS's own amounts plus the tip, in whole
// minor units, and never below zero; a percent tip is the lines' amount times the percent, rounded
// half-up. The reference sums are exact BigInt arithmetic.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { holdAmountMinor, signedSumMinor, tipOf } from './pay'

/** A POS line's amount: up to 10 000.00, a discount line negative. */
const lineAmount = fc.integer({ min: -100_000, max: 1_000_000 })
const lines = fc.array(lineAmount, { minLength: 1, maxLength: 60 })

const exactSum = (amounts: readonly number[]) => amounts.reduce((sum, a) => sum + BigInt(a), 0n)

describe('the hold amount', () => {
  it('is the POS amounts plus the tip, or null below zero', () => {
    fc.assert(
      fc.property(lines, fc.integer({ min: 0, max: 1_000_000 }), (amounts, tipMinor) => {
        const sum = exactSum(amounts)
        const hold = holdAmountMinor(amounts, tipMinor)
        if (sum < 0n) {
          expect(hold).toBeNull()
          expect(signedSumMinor(amounts)).toBeNull()
          return
        }
        expect(hold).not.toBeNull()
        expect(Number.isSafeInteger(hold)).toBe(true)
        expect(BigInt(hold as number)).toBe(sum + BigInt(tipMinor))
      }),
    )
  })

  it('takes a percent tip of the lines, rounded half-up', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100 }),
        (linesMinor, percent) => {
          const exact = BigInt(linesMinor) * BigInt(percent)
          // Half-up on a non-negative amount: add half the divisor, then divide.
          const expected = (exact + 50n) / 100n
          expect(BigInt(tipOf({ kind: 'percent', percent }, linesMinor))).toBe(expected)
        },
      ),
    )
  })

  it('takes an amount tip as given, and no tip as zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (linesMinor, minor) => {
          expect(tipOf({ kind: 'amount', minor }, linesMinor)).toBe(minor)
          expect(tipOf({ kind: 'none' }, linesMinor)).toBe(0)
        },
      ),
    )
  })
})
