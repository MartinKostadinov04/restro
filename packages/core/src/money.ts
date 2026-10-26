// Money (rule 8): integer minor units, converted from decimal strings with BigInt and rounded
// half-up like barsy. No float ever touches an amount: never `x * 100`, never `minor / 100`.

import { z } from 'zod'

import { type Locale, localeToBcp47 } from './locales'

/** Currencies we accept. Euro only (D10): barsy's system currency for the pilot venues. */
export const CURRENCIES = ['EUR'] as const

/** One of the accepted ISO 4217 currency codes. */
export type Currency = (typeof CURRENCIES)[number]

/** Zod schema for a `Currency`. */
export const CurrencySchema = z.enum(CURRENCIES)

/** Number of minor-unit digits per currency (ISO 4217 exponent): 2 for EUR. */
export const CURRENCY_SCALE: { readonly [C in Currency]: number } = { EUR: 2 }

/**
 * Canonical `money` value (check V2): a non-negative safe integer of minor units and a known
 * currency, e.g. `{ amount_minor: 1250, currency: 'EUR' }` for 12,50 €. Floats are rejected.
 */
export const MoneySchema = z.strictObject({
  amount_minor: z.int().nonnegative(),
  currency: CurrencySchema,
})

/** A canonical money value. */
export type Money = z.output<typeof MoneySchema>

/** Thrown by the money conversions on input they refuse (malformed, negative, too large). */
export class MoneyError extends Error {
  override name = 'MoneyError'
}

const MAX_DECIMAL_LENGTH = 400
const MAX_EXPONENT = 300
const MAX_SCALE = 20
// A JSON-style number without exponent sign quirks: optional minus, digits, optional fraction,
// optional exponent. Leading zeros are tolerated; a bare "." or "1." or ".5" is not a number.
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/

function assertScale(scale: number): void {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new MoneyError(`scale must be an integer from 0 to ${MAX_SCALE}, got ${scale}`)
  }
}

/**
 * Converts an exact decimal string (`"2.4"`, `"2.405"`, `"12"`, `"-0"`, also the exponent form
 * barsy's lossless JSON parser may keep, `"1.5e1"`) to integer minor units, rounding half-up at
 * `scale` digits. Throws `MoneyError` for malformed input, any negative non-zero amount (prices,
 * deltas and totals are never negative, check V2) and results beyond `Number.MAX_SAFE_INTEGER`.
 */
export function decimalToMinor(decimal: string, scale = 2): number {
  assertScale(scale)
  if (typeof decimal !== 'string' || decimal.length > MAX_DECIMAL_LENGTH) {
    throw new MoneyError('expected a decimal string')
  }
  const match = DECIMAL_PATTERN.exec(decimal)
  if (match === null) throw new MoneyError(`not a decimal number: ${JSON.stringify(decimal)}`)
  const [, sign = '', integerPart = '', fractionPart = '', exponentPart = '0'] = match
  const exponent = Number(exponentPart)
  if (Math.abs(exponent) > MAX_EXPONENT) {
    throw new MoneyError(`exponent out of range: ${JSON.stringify(decimal)}`)
  }

  // All significant digits, and where the decimal point sits among them once the exponent and
  // the requested scale are applied: minor = digits[0 .. cut) rounded by digits[cut].
  const digits = `${integerPart}${fractionPart}`
  const isZero = /^0*$/.test(digits)
  if (sign === '-' && !isZero) {
    throw new MoneyError(`negative amounts are not allowed: ${JSON.stringify(decimal)}`)
  }
  const cut = integerPart.length + exponent + scale
  let kept: string
  let firstDropped: string
  if (cut <= 0) {
    kept = '0'
    firstDropped = cut === 0 ? (digits[0] ?? '0') : '0'
  } else if (cut >= digits.length) {
    kept = digits + '0'.repeat(cut - digits.length)
    firstDropped = '0'
  } else {
    kept = digits.slice(0, cut)
    firstDropped = digits[cut] ?? '0'
  }
  const minor = BigInt(kept) + (firstDropped >= '5' ? 1n : 0n)
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError(`amount too large: ${JSON.stringify(decimal)}`)
  }
  return Number(minor)
}

/**
 * Converts integer minor units to an exact decimal string with exactly `scale` fraction digits:
 * `1250` → `"12.50"`, `5` → `"0.05"`. Throws `MoneyError` for anything but a non-negative safe
 * integer.
 */
export function minorToDecimal(minor: number, scale = 2): string {
  assertScale(scale)
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new MoneyError(`minor units must be a non-negative safe integer, got ${minor}`)
  }
  const digits = minor.toString().padStart(scale + 1, '0')
  if (scale === 0) return digits
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}

/**
 * Adds two amounts of integer minor units (rule 8): `addMinor(1250, 150)` → `1400`. Throws
 * `MoneyError` unless both are non-negative safe integers (prices, deltas and totals are never
 * negative, check V2) and the sum is a safe integer too, so a total can never turn into a float
 * or lose precision silently.
 */
export function addMinor(a: number, b: number): number {
  for (const amount of [a, b]) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new MoneyError(`minor units must be a non-negative safe integer, got ${amount}`)
    }
  }
  const sum = a + b
  if (!Number.isSafeInteger(sum)) throw new MoneyError(`sum too large: ${a} + ${b}`)
  return sum
}

/**
 * Sums signed amounts of integer minor units (rule 8), for the POS's own amounts, which can be
 * negative (a discount line, a bill's total): `sumSignedMinor([3600, -100])` → `3500`. Throws
 * `MoneyError` unless every amount and the sum are safe integers.
 */
export function sumSignedMinor(amounts: readonly number[]): number {
  let sum = 0n
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount)) {
      throw new MoneyError(`minor units must be a safe integer, got ${amount}`)
    }
    sum += BigInt(amount)
  }
  if (sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`sum too large: ${amounts.join(' + ')}`)
  }
  return Number(sum)
}

/** Throws unless `amount` is a non-negative safe integer (prices, deltas and totals, check V2). */
function assertMinor(amount: number, what: string): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new MoneyError(`${what} must be a non-negative safe integer, got ${amount}`)
  }
}

/**
 * Subtracts integer minor units (rule 8): `subtractMinor(1400, 150)` → `1250`. Throws
 * `MoneyError` unless both are non-negative safe integers and `b` is not more than `a` (an
 * amount is never negative, check V2).
 */
export function subtractMinor(a: number, b: number): number {
  assertMinor(a, 'minor units')
  assertMinor(b, 'minor units')
  if (b > a) throw new MoneyError(`difference would be negative: ${a} - ${b}`)
  return a - b
}

/**
 * Multiplies an amount by a whole factor (a quantity), exactly: `multiplyMinor(1250, 3)` →
 * `3750`. Throws `MoneyError` unless both are non-negative safe integers and the product is a
 * safe integer too. A product of two safe integers that fits is exact, and one that does not fit
 * lands beyond the safe range whatever the rounding, so the check below cannot miss it.
 */
export function multiplyMinor(minor: number, factor: number): number {
  assertMinor(minor, 'minor units')
  assertMinor(factor, 'factor')
  const product = minor * factor
  if (!Number.isSafeInteger(product))
    throw new MoneyError(`product too large: ${minor} × ${factor}`)
  return product
}

/**
 * `minor × numerator ÷ denominator`, rounded half-up, in BigInt: `ratioOfMinor(1000, 1, 3)` →
 * `333`, `ratioOfMinor(2, 1, 4)` → `1` (0.5 rounds up). Throws `MoneyError` unless the three are
 * integers with `minor` and `numerator` non-negative, `denominator` positive, and the result is
 * a safe integer.
 */
export function ratioOfMinor(minor: number, numerator: number, denominator: number): number {
  assertMinor(minor, 'minor units')
  assertMinor(numerator, 'numerator')
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new MoneyError(`denominator must be a positive safe integer, got ${denominator}`)
  }
  const divisor = BigInt(denominator)
  const rounded = (2n * BigInt(minor) * BigInt(numerator) + divisor) / (2n * divisor)
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError(`result too large: ${minor} × ${numerator} ÷ ${denominator}`)
  }
  return Number(rounded)
}

/**
 * A whole percent of an amount, rounded half-up like barsy: `percentOfMinor(2450, 10)` → `245`,
 * `percentOfMinor(2450, 15)` → `368`. `percent` is a whole number (a tip or VAT rate: 10, 15,
 * 20); anything else throws `MoneyError`. Only the preview adapter calls it; real tips, VAT and
 * splits come from the platform's quote (D72).
 */
export function percentOfMinor(minor: number, percent: number): number {
  return ratioOfMinor(minor, percent, 100)
}

const formatters = new Map<string, Intl.NumberFormat>()

/**
 * Formats minor units for display with `Intl.NumberFormat` in the given locale. The amount is
 * passed to Intl as an exact decimal string, never a float. Output on Node 24 (ICU 78):
 * `bg_BG` → `"12,50 €"` (U+00A0 before €), `en_US` → `"€12.50"`.
 */
export function formatMoney(minor: number, currency: Currency, locale: Locale): string {
  const scale = CURRENCY_SCALE[currency]
  const cacheKey = `${locale}|${currency}`
  let formatter = formatters.get(cacheKey)
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(localeToBcp47(locale), {
      style: 'currency',
      currency,
      minimumFractionDigits: scale,
      maximumFractionDigits: scale,
    })
    formatters.set(cacheKey, formatter)
  }
  return formatter.format(minorToDecimal(minor, scale) as Intl.StringNumericLiteral)
}
