/**
 * The 14 allergens of EU Regulation 1169/2011, Annex II, as stable codes. Allergens are never
 * guessed: an unknown code is rejected, and interface labels (BG/EN) live in next-intl.
 */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const

/** One of the 14 EU allergen codes. */
export type Allergen = (typeof ALLERGENS)[number]

/**
 * Dietary labels. PROVISIONAL: the doc says "a fixed list" without naming it; this list was set by
 * the S1-02 brief and is waiting for Martin's confirmation.
 */
export const DIETARY_LABELS = [
  'vegan',
  'vegetarian',
  'gluten_free',
  'lactose_free',
  'halal',
  'kosher',
] as const

/** One of the (provisional) dietary label codes. */
export type DietaryLabel = (typeof DIETARY_LABELS)[number]

/** True if `value` is one of the 14 EU allergen codes. */
export function isAllergen(value: unknown): value is Allergen {
  return typeof value === 'string' && (ALLERGENS as readonly string[]).includes(value)
}

/** True if `value` is one of the dietary label codes. */
export function isDietaryLabel(value: unknown): value is DietaryLabel {
  return typeof value === 'string' && (DIETARY_LABELS as readonly string[]).includes(value)
}
