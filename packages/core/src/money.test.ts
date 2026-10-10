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
