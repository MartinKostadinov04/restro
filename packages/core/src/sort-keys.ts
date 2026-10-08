// Fractional sort keys for placements (doc "Concurrency, order and bulk edits"; D47): moving one
// item writes one row. Keys compare by plain code-unit order (`<`), never `localeCompare`, and a
// database column holding them needs a byte-order collation (Postgres `COLLATE "C"`).

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { z } from 'zod'

const MAX_SORT_KEY_LENGTH = 512
const SORT_KEY_CHARS = /^[A-Za-z][0-9A-Za-z]*$/

function assertOrdered(a: string | null, b: string | null): void {
  if (a !== null && !isSortKey(a)) throw new RangeError(`not a sort key: ${JSON.stringify(a)}`)
  if (b !== null && !isSortKey(b)) throw new RangeError(`not a sort key: ${JSON.stringify(b)}`)
  if (a !== null && b !== null && !(a < b)) {
    throw new RangeError(`sort keys out of order: ${JSON.stringify(a)} must be before ${b}`)
  }
}

/** True if `value` is a valid fractional-indexing key (base62, classic `a0` format). */
export function isSortKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_SORT_KEY_LENGTH) return false
  if (!SORT_KEY_CHARS.test(value)) return false
  // The library validates a key before using it. The largest possible key cannot be
  // incremented and the smallest cannot be decremented, so a valid key passes one of the two.
  try {
    generateKeyBetween(value, null)
    return true
  } catch {
    try {
      generateKeyBetween(null, value)
      return true
    } catch {
      return false
    }
  }
}

/** Zod schema for a sort key. */
export const SortKeySchema = z.custom<string>(isSortKey, { message: 'expected a sort key' })

/**
 * A key strictly between `a` and `b` (`null` = open end): `(null, null)` → `"a0"`. Throws
 * `RangeError` unless `a < b`.
 */
export function sortKeyBetween(a: string | null, b: string | null): string {
  assertOrdered(a, b)
  return generateKeyBetween(a, b)
}

/** `n` ascending keys strictly between `a` and `b`, evenly spread. Throws unless `a < b`. */
export function sortKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`n must be a natural number: ${n}`)
  assertOrdered(a, b)
  return generateNKeysBetween(a, b, n)
}

/** Comparator for sort keys in code-unit order (the only correct order for these keys). */
export function compareSortKeys(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}
