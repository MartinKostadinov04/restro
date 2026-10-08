// Lossless JSON parsing for barsy responses (CLAUDE.md rule 8).
//
// barsy sends prices as JSON numbers with decimals ("actual_price": 2.40). A JS number would turn
// 2.40 into 2.4 and long numbers into rounded ones, so numbers never pass through a float unless
// that is exact: JSON.parse's reviver gets the source text of every number (Node 24, V8 13.6), and
// anything that is not a plain safe integer is kept as that exact text, branded DecimalString.
// The money module (packages/core) turns a DecimalString into integer minor units.

import { z } from 'zod'

declare const decimalStringBrand: unique symbol

/** The exact source text of a JSON number that a JS float could not hold exactly (2.40, 1e2, 12345678901234567890). */
export type DecimalString = string & { readonly [decimalStringBrand]: true }

/** The JSON number grammar (RFC 8259): optional minus, no leading zeros, optional fraction and exponent. */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const INTEGER_TEXT = /^-?\d+$/

export function isDecimalText(text: string): boolean {
  return JSON_NUMBER.test(text)
}

/** Brands `text` as a DecimalString after checking that it is valid JSON number text. */
export function asDecimalString(text: string): DecimalString {
  if (!isDecimalText(text)) {
    throw new TypeError('not valid JSON number text')
  }
  return text as DecimalString
}

/** Zod schema for a DecimalString: a string holding valid JSON number text. */
export const decimalStringSchema = z
  .string()
  .refine(isDecimalText, 'must be JSON number text')
  .transform((text) => text as DecimalString)

type NumberContext = { readonly source?: string }

/**
 * `JSON.parse` that keeps numbers lossless:
 * - an integer inside the safe range (and not "-0") becomes a `number`;
 * - any number with a fraction or exponent, or outside the safe range, becomes a `DecimalString`
 *   holding the exact source text.
 * Strings, booleans, null, arrays and objects are parsed as usual. Throws `SyntaxError` on
 * invalid JSON, like `JSON.parse`.
 */
export function parseBarsyJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: NumberContext) => {
    if (typeof value !== 'number') return value
    const source = context?.source
    if (source === undefined) {
      // Fail loudly: silently returning the float would break rule 8 without anyone noticing.
      throw new Error('JSON.parse source-text access is unavailable; Node 24 or newer is required')
    }
    if (INTEGER_TEXT.test(source) && Number.isSafeInteger(value) && !Object.is(value, -0)) {
      return value
    }
    return source as DecimalString
  })
}

/** True when this runtime gives the reviver the source text of numbers. */
export function hasJsonSourceAccess(): boolean {
  let seen: string | undefined
  JSON.parse('1.5', (_key: string, value: unknown, context?: NumberContext) => {
    seen = context?.source
    return value
  })
  return seen === '1.5'
}
