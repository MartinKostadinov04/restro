import {
  type Currency,
  decimalToMinor,
  type Locale,
  type Money,
  MoneyError,
  minorToDecimal,
} from '@restro/core'

/**
 * What the money editor makes of what a person typed (a price in major units, `12.50`):
 * - `undefined`: nothing typed, no value;
 * - `Money`: converted with core's `decimalToMinor` (integer minor units, never `x * 100`);
 * - `'invalid'`: not a price. More than two decimals is invalid on purpose: the editor never
 *   rounds a price the person typed (rounding half-up is for barsy's own prices, rule 8).
 * A comma is accepted as the decimal separator (Bulgarian keyboards), a thousands separator is not.
 */
export function parseMoneyInput(text: string, currency: Currency): Money | undefined | 'invalid' {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(trimmed)) return 'invalid'
  try {
    return { amount_minor: decimalToMinor(trimmed.replace(',', '.')), currency }
  } catch (error) {
    if (error instanceof MoneyError) return 'invalid'
    throw error
  }
}

/**
 * The text the editor shows for a stored amount: `1250` becomes `12.50` in English and `12,50` in
 * every other language of ours, which all write a decimal comma (S19). Only the separator changes:
 * the digits are core's exact decimal string, never a float.
 */
export function moneyToInput(value: Money | undefined, locale: Locale = 'en_US'): string {
  if (value === undefined) return ''
  const text = minorToDecimal(value.amount_minor)
  return locale === 'en_US' ? text : text.replace('.', ',')
}
