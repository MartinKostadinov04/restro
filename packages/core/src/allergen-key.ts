// The one rule that picks barsy's allergen characteristic by its name. The sync (barsy mapping)
// and the Integration tab (automatic detection) both use it, so they cannot disagree.

/** Names that mean "allergens": "Алергени" and "Allergens" (compared lower-case). */
export const ALLERGEN_DETAIL_NAMES: ReadonlySet<string> = new Set(['алергени', 'allergens'])

/** True when a characteristic's name is the allergen one, in any case, ignoring surrounding spaces. */
export function isAllergenDetailName(name: string): boolean {
  return ALLERGEN_DETAIL_NAMES.has(name.trim().toLowerCase())
}
