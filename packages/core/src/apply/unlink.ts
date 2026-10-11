// Unlink (doc "Linking and unlinking", step 3): "the current till values are copied into the
// manual layer, so the item keeps showing". Pure: given one field's till rows and the node's
// manual layer, which value the manual layer must hold so the field resolves as before once the
// till rows are gone. apply() then validates the copy as a manual write on an unlinked node.
//
// Per combinator (doc "Combinators"; override and edition layers are left as they are):
// - all_true (visible, for_sale): only a till `false` is carried over (absence already means
//   true, and a builder layer may never say true: rule 5);
// - union (tags, dietary): manual becomes manual ∪ till;
// - builder_first (description, image): the till was only the fallback; it is copied where the
//   manual layer has no value (per locale for localized text);
// - source_first, locked (name, portion, price): the till ranked above manual, so the till's
//   value replaces manual's (per locale for localized text: the till's locales win, ours are kept);
// - must_agree (allergens): manual becomes manual ∪ till when both hold a set (declaring more
//   allergens is the cautious side), the till's value otherwise.
// Till rows of several venue scopes collapse into one master value only when they agree (an
// all_true flag: false if any venue says false); otherwise nothing is copied (an item with two
// venue prices gets no hand price, rather than a wrong one).

import type { FieldDefinition } from '../field-definition'
import { FIELD_TYPES, type FieldTypeSpec } from '../field-types/specs'

/** One field's valid values on one node, by layer, as stored. */
export interface UnlinkSlots {
  /** The till rows being removed, one per scope. */
  readonly till: readonly unknown[]
  readonly manual?: unknown
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
 * The value the manual layer must take when the till rows of this field are removed, or `null`
 * when the manual layer stays as it is.
 */
export function unlinkCopy(
  definition: FieldDefinition,
  slots: UnlinkSlots,
): { value: unknown } | null {
  // The hash of the field's type: order-insensitive for sets, so equal values compare equal.
  const spec = FIELD_TYPES[definition.type] as FieldTypeSpec
  const equal = (a: unknown, b: unknown) => spec.hash(a as never) === spec.hash(b as never)

  const rows = slots.till
  if (rows.length === 0) return null
  let till: unknown
  if (definition.combinator === 'all_true') {
    till = rows.some((row) => row === false) ? false : undefined
  } else {
    till = rows.every((row) => equal(row, rows[0])) ? rows[0] : undefined
  }
  if (till === undefined) return null

  const { manual } = slots
  const unlessSame = (value: unknown) =>
    manual !== undefined && equal(value, manual) ? null : { value }

  switch (definition.combinator) {
    case 'all_true':
      return unlessSame(false)
    case 'union':
      return Array.isArray(till)
        ? unlessSame(sortedUnion(Array.isArray(manual) ? manual : [], till))
        : null
    case 'builder_first': {
      if (definition.localizable && isLocalized(till)) {
        const ours: Localized = isLocalized(manual) ? manual : {}
        const added = Object.entries(till).filter(([locale]) => ours[locale] === undefined)
        return added.length === 0 ? null : { value: { ...ours, ...Object.fromEntries(added) } }
      }
      return manual === undefined ? { value: till } : null
    }
    case 'must_agree':
      return Array.isArray(till) && Array.isArray(manual)
        ? unlessSame(sortedUnion(manual, till))
        : unlessSame(till)
    case 'source_first':
    case 'locked':
      if (definition.localizable && isLocalized(till)) {
        return unlessSame({ ...(isLocalized(manual) ? manual : {}), ...till })
      }
      return unlessSame(till)
  }
}
