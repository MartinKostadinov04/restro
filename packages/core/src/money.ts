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
