// A reader of what the connection check cached (B6, D82): the characteristics barsy offers, to pick
// the one that lists allergens. Pure, and forgiving: a cache that does not look as expected is an
// empty list, never an error.
import { isAllergenDetailName } from '@restro/core'

import type { AllergenOption } from '../data'

/** The characteristics in barsy's `Articledetails_gettree` answer: `[{ details: { k102: { detail_name } } }]`. */
export function readDetailOptions(payload: unknown): AllergenOption[] {
  if (!Array.isArray(payload)) return []
  const found = new Map<string, string>()
  for (const group of payload) {
    const details = (group as { details?: unknown } | null)?.details
    if (typeof details !== 'object' || details === null || Array.isArray(details)) continue
    for (const [key, detail] of Object.entries(details)) {
      const name = (detail as { detail_name?: unknown } | null)?.detail_name
      if (typeof name === 'string' && name.trim() !== '' && !found.has(key)) {
        found.set(key, name.trim())
      }
    }
  }
  return [...found].map(([key, name]) => ({ key, name })).sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * The characteristic the sync picks for allergens when none is configured: the one named
 * "Алергени" or "Allergens" in any case, the lowest key if several (as the sync does).
 */
export function detectAllergenOption(options: readonly AllergenOption[]): AllergenOption | null {
  const matching = options
    .filter((option) => isAllergenDetailName(option.name))
    .map((option) => option.key)
    .sort()
  const key = matching[0]
  return key === undefined ? null : (options.find((option) => option.key === key) ?? null)
}
