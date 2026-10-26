import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  addMinor,
  CURRENCY_SCALE,
  decimalToMinor,
  formatMoney,
  MoneyError,
  MoneySchema,
  minorToDecimal,
  multiplyMinor,
  percentOfMinor,
  ratioOfMinor,
  subtractMinor,
  sumSignedMinor,
} from './money'

/**
 * Reference implementation, deliberately different from the module's digit-cutting: the decimal
 * as an exact fraction n / d, then floor(n · 10^scale / d + 1/2) in BigInt (half-up for x ≥ 0).
 */
function referenceMinor(decimal: string, scale: number): bigint {
  const [integerPart = '0', fractionPart = ''] = decimal.split('.')
  const numerator = BigInt(integerPart + fractionPart)
  const denominator = 10n ** BigInt(fractionPart.length)
  const scaled = numerator * 10n ** BigInt(scale)
  return (2n * scaled + denominator) / (2n * denominator)
}

const decimalArbitrary = fc
  .tuple(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.integer({ min: 0, max: 6 }))
  .map(([units, places]) => {
    const digits = units.toString().padStart(places + 1, '0')
    return places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`
  })

describe('addMinor', () => {
  it('adds integer minor units', () => {
    expect(addMinor(1250, 150)).toBe(1400)
    expect(addMinor(0, 0)).toBe(0)
    expect(addMinor(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('refuses floats, negatives, unsafe integers and an unsafe sum (rule 8)', () => {
    for (const [a, b] of [
      [12.5, 1],
      [1, 0.1],
      [-1, 5],
      [Number.NaN, 1],
      [Number.POSITIVE_INFINITY, 1],
      [Number.MAX_SAFE_INTEGER + 1, 0],
      [Number.MAX_SAFE_INTEGER, 1],
    ] as const) {
      expect(() => addMinor(a, b), `${a} + ${b}`).toThrow(MoneyError)
    }
  })

  it('agrees with BigInt addition on every safe pair (property)', () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), fc.maxSafeNat(), (a, b) => {
        const exact = BigInt(a) + BigInt(b)
        if (exact > BigInt(Number.MAX_SAFE_INTEGER)) {
          expect(() => addMinor(a, b)).toThrow(MoneyError)
        } else {
          expect(BigInt(addMinor(a, b))).toBe(exact)
        }
      }),
    )
  })
})

/** Everything the whole-number helpers must refuse: floats, negatives, NaN, infinities, unsafe. */
const NOT_MINOR = [12.5, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]

describe('sumSignedMinor', () => {
  it('sums signed POS amounts', () => {
    expect(sumSignedMinor([3600, -100])).toBe(3500)
    expect(sumSignedMinor([100, -3600])).toBe(-3500)
    expect(sumSignedMinor([])).toBe(0)
  })

  it('refuses floats, unsafe integers and a sum past the safe range (rule 8)', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => sumSignedMinor([1, bad]), `1 + ${bad}`).toThrow(MoneyError)
    }
    expect(() => sumSignedMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(MoneyError)
    expect(() => sumSignedMinor([Number.MIN_SAFE_INTEGER, -1])).toThrow(MoneyError)
  })

  it('is the exact sum on every safe list (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -(2 ** 40), max: 2 ** 40 })), (amounts) => {
        const exact = amounts.reduce((sum, a) => sum + BigInt(a), 0n)
        expect(BigInt(sumSignedMinor(amounts))).toBe(exact)
      }),
    )
  })
})

describe('subtractMinor', () => {
  it('subtracts integer minor units', () => {
    expect(subtractMinor(1400, 150)).toBe(1250)
    expect(subtractMinor(150, 150)).toBe(0)
    expect(subtractMinor(0, 0)).toBe(0)
    expect(subtractMinor(Number.MAX_SAFE_INTEGER, 0)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('refuses floats, negatives, unsafe integers and a negative difference (rule 8)', () => {
    for (const bad of NOT_MINOR) {
      expect(() => subtractMinor(bad, 1), `${bad} - 1`).toThrow(MoneyError)
      expect(() => subtractMinor(5, bad), `5 - ${bad}`).toThrow(MoneyError)
    }
    expect(() => subtractMinor(1, 2)).toThrow(MoneyError)
  })

  it('undoes addition on every safe pair (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 52 }),
        fc.integer({ min: 0, max: 2 ** 52 }),
        (a, b) => {
          expect(subtractMinor(addMinor(a, b), b)).toBe(a)
        },
      ),
    )
  })
})

describe('multiplyMinor', () => {
  it('multiplies an amount by a whole factor, exactly', () => {
    expect(multiplyMinor(1250, 3)).toBe(3750)
    expect(multiplyMinor(1250, 0)).toBe(0)
    expect(multiplyMinor(0, 50)).toBe(0)
    expect(multiplyMinor(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('refuses floats, negatives, unsafe integers and an unsafe product (rule 8)', () => {
    for (const bad of NOT_MINOR) {
      expect(() => multiplyMinor(bad, 2), `${bad} × 2`).toThrow(MoneyError)
      expect(() => multiplyMinor(2, bad), `2 × ${bad}`).toThrow(MoneyError)
    }
    expect(() => multiplyMinor(Number.MAX_SAFE_INTEGER, 2)).toThrow(MoneyError)
    expect(() => multiplyMinor(2 ** 27, 2 ** 27)).toThrow(MoneyError)
    expect(multiplyMinor(2 ** 26, 2 ** 26)).toBe(2 ** 52)
  })

  it('agrees with BigInt multiplication on every safe pair (property)', () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), fc.maxSafeNat(), (a, b) => {
        const exact = BigInt(a) * BigInt(b)
        if (exact > BigInt(Number.MAX_SAFE_INTEGER)) {
          expect(() => multiplyMinor(a, b)).toThrow(MoneyError)
        } else {
          expect(BigInt(multiplyMinor(a, b))).toBe(exact)
        }
      }),
      { numRuns: 2000 },
    )
  })

  it('agrees with BigInt multiplication when the product is near the safe limit (property)', () => {
    // Pairs whose product is close to 2^53, where a float product could round across the limit.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 26 }),
        fc.integer({ min: -4, max: 4 }),
        (a, offset) => {
          const b = Math.max(0, Math.floor(Number.MAX_SAFE_INTEGER / a) + offset)
          const exact = BigInt(a) * BigInt(b)
          if (exact > BigInt(Number.MAX_SAFE_INTEGER)) {
            expect(() => multiplyMinor(a, b), `${a} × ${b}`).toThrow(MoneyError)
          } else {
            expect(BigInt(multiplyMinor(a, b)), `${a} × ${b}`).toBe(exact)
          }
        },
      ),
      { numRuns: 2000 },
    )
  })

  it('is repeated addition for a small factor (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 50 }),
        (a, n) => {
          let sum = 0
          for (let i = 0; i < n; i++) sum = addMinor(sum, a)
          expect(multiplyMinor(a, n)).toBe(sum)
        },
      ),
    )
  })
})

describe('ratioOfMinor', () => {
  it('rounds half-up', () => {
    expect(ratioOfMinor(1000, 1, 3)).toBe(333)
    expect(ratioOfMinor(2000, 1, 3)).toBe(667)
    expect(ratioOfMinor(2, 1, 4)).toBe(1) // 0.5 rounds up
    expect(ratioOfMinor(1, 1, 4)).toBe(0) // 0.25 rounds down
    expect(ratioOfMinor(3, 1, 2)).toBe(2) // 1.5 rounds up
    expect(ratioOfMinor(1200, 20, 120)).toBe(200)
    expect(ratioOfMinor(0, 5, 7)).toBe(0)
  })

  it('refuses floats, negatives, a zero denominator and a result past the safe range', () => {
    for (const bad of NOT_MINOR) {
      expect(() => ratioOfMinor(bad, 1, 2), `minor ${bad}`).toThrow(MoneyError)
      expect(() => ratioOfMinor(1, bad, 2), `numerator ${bad}`).toThrow(MoneyError)
    }
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => ratioOfMinor(1, 1, bad), `denominator ${bad}`).toThrow(MoneyError)
    }
    expect(() => ratioOfMinor(Number.MAX_SAFE_INTEGER, 2, 1)).toThrow(MoneyError)
    expect(ratioOfMinor(Number.MAX_SAFE_INTEGER, 1, 1)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('equals the exact fraction rounded half-up in BigInt (property)', () => {
    fc.assert(
      fc.property(
        fc.maxSafeNat(),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (minor, numerator, denominator) => {
          // floor(x + 1/2) of the exact fraction, by a different route: quotient and remainder.
          const n = BigInt(minor) * BigInt(numerator)
          const d = BigInt(denominator)
          const quotient = n / d
          const remainder = n % d
          const expected = 2n * remainder >= d ? quotient + 1n : quotient
          if (expected > BigInt(Number.MAX_SAFE_INTEGER)) {
            expect(() => ratioOfMinor(minor, numerator, denominator)).toThrow(MoneyError)
          } else {
            expect(BigInt(ratioOfMinor(minor, numerator, denominator))).toBe(expected)
          }
        },
      ),
      { numRuns: 2000 },
    )
  })
})

describe('percentOfMinor', () => {
  it('rounds half-up, like the delivery tests of tips (10 % and 15 % of 24,50)', () => {
    expect(percentOfMinor(2450, 10)).toBe(245)
    expect(percentOfMinor(2450, 15)).toBe(368) // 367.5 rounds up
    expect(percentOfMinor(2450, 0)).toBe(0)
    expect(percentOfMinor(2450, 100)).toBe(2450)
    expect(percentOfMinor(1, 50)).toBe(1) // 0.5 rounds up
    expect(percentOfMinor(1, 49)).toBe(0)
  })

  it('refuses a percent that is not a whole non-negative number, and a result past the safe range', () => {
    for (const bad of NOT_MINOR)
      expect(() => percentOfMinor(100, bad), `${bad} %`).toThrow(MoneyError)
    expect(() => percentOfMinor(100, 7.5)).toThrow(MoneyError)
    expect(() => percentOfMinor(Number.MAX_SAFE_INTEGER, 101)).toThrow(MoneyError)
  })

  it('equals the exact percentage rounded half-up in BigInt (property)', () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), fc.integer({ min: 0, max: 100 }), (minor, percent) => {
        // floor((minor × percent + 50) / 100): the textbook half-up for non-negative amounts.
        const expected = (BigInt(minor) * BigInt(percent) + 50n) / 100n
        expect(BigInt(percentOfMinor(minor, percent))).toBe(expected)
      }),
      { numRuns: 2000 },
    )
  })

  it('never exceeds the amount for a percent up to 100 and grows with the percent (property)', () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), fc.integer({ min: 0, max: 99 }), (minor, percent) => {
        expect(percentOfMinor(minor, percent)).toBeLessThanOrEqual(minor)
        expect(percentOfMinor(minor, percent)).toBeLessThanOrEqual(
          percentOfMinor(minor, percent + 1),
        )
      }),
    )
  })
})

describe('decimalToMinor', () => {
  it('converts the brief examples, rounding half-up', () => {
    expect(decimalToMinor('2.4')).toBe(240)
    expect(decimalToMinor('2.40')).toBe(240)
    expect(decimalToMinor('2.405')).toBe(241)
    expect(decimalToMinor('2.404999')).toBe(240)
    expect(decimalToMinor('12')).toBe(1200)
    expect(decimalToMinor('-0')).toBe(0)
    expect(decimalToMinor('-0.00')).toBe(0)
    expect(decimalToMinor('0.005')).toBe(1)
    expect(decimalToMinor('0.004')).toBe(0)
    expect(decimalToMinor('12.50')).toBe(1250)
  })

  it('handles the exponent form a lossless JSON parser may keep', () => {
    expect(decimalToMinor('1e2')).toBe(10000)
    expect(decimalToMinor('1.5E1')).toBe(1500)
    expect(decimalToMinor('2.405e0')).toBe(241)
    expect(decimalToMinor('5e-3')).toBe(1)
    expect(decimalToMinor('1e-7')).toBe(0)
  })

  it('respects the scale', () => {
    expect(decimalToMinor('12.3456', 0)).toBe(12)
    expect(decimalToMinor('12.5', 0)).toBe(13)
    expect(decimalToMinor('1.0005', 3)).toBe(1001)
  })

  it('rejects negatives, malformed input and overflow', () => {
    for (const bad of [
      '-1',
      '-0.01',
      '-0.001',
      '',
      ' 1',
      '1 ',
      '1,50',
      '.5',
      '5.',
      '+1',
      'NaN',
      '1e',
      'abc',
    ]) {
      expect(() => decimalToMinor(bad), bad).toThrow(MoneyError)
    }
    expect(() => decimalToMinor('90071992547409.92')).toThrow(MoneyError)
    expect(decimalToMinor('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER)
    expect(() => decimalToMinor('1e400')).toThrow(MoneyError)
    expect(() => decimalToMinor('1', -1)).toThrow(MoneyError)
    expect(() => decimalToMinor('1', 1.5)).toThrow(MoneyError)
  })

  it('equals a BigInt reference implementation for decimals with up to 6 places', () => {
    fc.assert(
      fc.property(decimalArbitrary, fc.integer({ min: 0, max: 4 }), (decimal, scale) => {
        const expected = referenceMinor(decimal, scale)
        if (expected > BigInt(Number.MAX_SAFE_INTEGER)) {
          expect(() => decimalToMinor(decimal, scale)).toThrow(MoneyError)
        } else {
          expect(BigInt(decimalToMinor(decimal, scale))).toBe(expected)
        }
      }),
      { numRuns: 2000 },
    )
  })

  it('reads the exponent form exactly like the plain form', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: -8, max: 4 }),
        (units, places, exponent) => {
          const digits = units.toString().padStart(places + 1, '0')
          const mantissa =
            places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`
          // units / 10^places · 10^exponent as an exact fraction, rounded half-up at 2 places.
          const numerator = units * 100n * 10n ** BigInt(Math.max(exponent, 0))
          const denominator = 10n ** BigInt(places + Math.max(-exponent, 0))
          const expected = (2n * numerator + denominator) / (2n * denominator)
          expect(BigInt(decimalToMinor(`${mantissa}e${exponent}`))).toBe(expected)
        },
      ),
      { numRuns: 2000 },
    )
  })
})

describe('minorToDecimal', () => {
  it('writes exactly `scale` fraction digits', () => {
    expect(minorToDecimal(1250)).toBe('12.50')
    expect(minorToDecimal(5)).toBe('0.05')
    expect(minorToDecimal(0)).toBe('0.00')
    expect(minorToDecimal(7, 0)).toBe('7')
    expect(minorToDecimal(1001, 3)).toBe('1.001')
  })

  it('rejects floats, negatives and unsafe integers', () => {
    for (const bad of [1.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => minorToDecimal(bad), String(bad)).toThrow(MoneyError)
    }
  })

  it('round-trips: decimalToMinor(minorToDecimal(n)) === n for 0 … 10^9', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (n) => {
        expect(decimalToMinor(minorToDecimal(n))).toBe(n)
      }),
      { numRuns: 5000 },
    )
  })
})

describe('formatMoney', () => {
  // What Intl actually produces on Node 24.21 (ICU 78): Bulgarian puts the amount first with a
  // decimal comma and a no-break space (U+00A0) before €, and groups from five digits on;
  // US English puts € first with a decimal point and comma grouping.
  it('formats in Bulgarian', () => {
    expect(formatMoney(1250, 'EUR', 'bg_BG')).toBe('12,50 €')
    expect(formatMoney(0, 'EUR', 'bg_BG')).toBe('0,00 €')
    expect(formatMoney(123450, 'EUR', 'bg_BG')).toBe('1234,50 €')
  })

  it('formats in English', () => {
    expect(formatMoney(1250, 'EUR', 'en_US')).toBe('€12.50')
    expect(formatMoney(123450, 'EUR', 'en_US')).toBe('€1,234.50')
  })

  it('formats large amounts exactly (no float on the way)', () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER, 'EUR', 'en_US')).toBe('€90,071,992,547,409.91')
  })

  it('uses the currency scale', () => {
    expect(CURRENCY_SCALE.EUR).toBe(2)
  })
})

describe('MoneySchema', () => {
  it('accepts integer minor units in a known currency', () => {
    expect(MoneySchema.safeParse({ amount_minor: 1250, currency: 'EUR' }).success).toBe(true)
    expect(MoneySchema.safeParse({ amount_minor: 0, currency: 'EUR' }).success).toBe(true)
  })

  it('rejects floats, negatives, unknown currencies and extra keys', () => {
    for (const bad of [
      { amount_minor: 12.5, currency: 'EUR' },
      { amount_minor: -1, currency: 'EUR' },
      { amount_minor: 100, currency: 'BGN' },
      { amount_minor: '100', currency: 'EUR' },
      { amount_minor: 100, currency: 'EUR', note: 'x' },
      { amount_minor: Number.MAX_SAFE_INTEGER + 1, currency: 'EUR' },
    ]) {
      expect(MoneySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})
