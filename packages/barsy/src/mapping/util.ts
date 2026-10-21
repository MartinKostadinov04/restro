// Small pure helpers shared by the mapping files.

/** The first item per key, in order. */
export function uniqueBy<T>(list: readonly T[], key: (item: T) => string | number): T[] {
  const seen = new Set<string | number>()
  const result: T[] = []
  for (const item of list) {
    const id = key(item)
    if (seen.has(id)) continue
    seen.add(id)
    result.push(item)
  }
  return result
}

/**
 * barsy's 0/1 flags (a boolean is accepted too, and the text "0" / "1" that the per-venue for-sale
 * exceptions arrive as): null when the flag is missing or unreadable.
 */
export function flagOf(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  return null
}

/** The exact decimal text of a number as `parseBarsyJson` hands it over: an integer or a DecimalString. */
export function decimalText(value: number | string): string {
  return typeof value === 'number' ? String(value) : value
}
