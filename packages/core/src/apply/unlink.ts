// Unlink (doc "Linking and unlinking", step 3): "the current Barsy values are copied into the
// manual layer, so the item keeps showing". Pure: given one field's barsy rows and the node's
// other layers, which value the manual layer must hold so the field resolves as before once the
// barsy rows are gone. apply() then validates the copy as a manual write on an unlinked node.
//
// Per combinator (doc "Combinators"; override and edition layers are left as they are):
// - all_true (visible, for_sale): only a barsy `false` is carried over (absence already means
//   true, and a builder layer may never say true: rule 5);
// - union (tags, dietary): manual becomes manual ∪ barsy;
// - builder_first (description, image): barsy was only the fallback; it is copied where neither
//   manual nor import has a value (per locale for localized text);
// - source_first, locked (name, portion, price): barsy ranked above manual, so barsy's value
//   replaces manual's (per locale for localized text: barsy's locales win, ours are kept);
// - must_agree (allergens): manual becomes manual ∪ barsy when both hold a set (declaring more
//   allergens is the cautious side), barsy's value otherwise.
// barsy rows of several venue scopes collapse into one master value only when they agree (an
// all_true flag: false if any venue says false); otherwise nothing is copied (an item with two
// venue prices gets no hand price, rather than a wrong one).

import type { FieldDefinition } from '../field-definition'
import { FIELD_TYPES, type FieldTypeSpec } from '../field-types/specs'

/** One field's valid values on one node, by layer, as stored. */
export interface UnlinkSlots {
  /** The barsy rows being removed, one per scope. */
  readonly barsy: readonly unknown[]
  readonly manual?: unknown
  readonly import?: unknown
}

type Localized = Record<string, string>

function isLocalized(value: unknown): value is Localized {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sortedUnion(...sets: readonly unknown[][]): string[] {
  const all = new Set<string>()
  for (const set of sets) for (const member of set) if (typeof member === 'string') all.add(member)
  return [...all].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The value the manual layer must take when the barsy rows of this field are removed, or `null`
 * when the manual layer stays as it is.
 */
export function unlinkCopy(
  definition: FieldDefinition,
  slots: UnlinkSlots,
): { value: unknown } | null {
  // The hash of the field's type: order-insensitive for sets, so equal values compare equal.
  const spec = FIELD_TYPES[definition.type] as FieldTypeSpec
  const equal = (a: unknown, b: unknown) => spec.hash(a as never) === spec.hash(b as never)

  const rows = slots.barsy
  if (rows.length === 0) return null
  let barsy: unknown
  if (definition.combinator === 'all_true') {
    barsy = rows.some((row) => row === false) ? false : undefined
  } else {
    barsy = rows.every((row) => equal(row, rows[0])) ? rows[0] : undefined
  }
  if (barsy === undefined) return null

  const { manual } = slots
  const unlessSame = (value: unknown) =>
    manual !== undefined && equal(value, manual) ? null : { value }

  switch (definition.combinator) {
    case 'all_true':
      return unlessSame(false)
    case 'union':
      return Array.isArray(barsy)
        ? unlessSame(sortedUnion(Array.isArray(manual) ? manual : [], barsy))
        : null
    case 'builder_first': {
      if (definition.localizable && isLocalized(barsy)) {
        const ours: Localized = isLocalized(manual) ? manual : {}
        const imported: Localized = isLocalized(slots.import) ? slots.import : {}
        const added = Object.entries(barsy).filter(
          ([locale]) => ours[locale] === undefined && imported[locale] === undefined,
        )
        return added.length === 0 ? null : { value: { ...ours, ...Object.fromEntries(added) } }
      }
      return manual === undefined && slots.import === undefined ? { value: barsy } : null
    }
    case 'must_agree':
      return Array.isArray(barsy) && Array.isArray(manual)
        ? unlessSame(sortedUnion(manual, barsy))
        : unlessSame(barsy)
    case 'source_first':
    case 'locked':
      if (definition.localizable && isLocalized(barsy)) {
        return unlessSame({ ...(isLocalized(manual) ? manual : {}), ...barsy })
      }
      return unlessSame(barsy)
  }
}
