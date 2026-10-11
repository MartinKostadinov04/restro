// Where a person's save goes (brief S2-06b; doc "What a save writes"): which layer, with what
// basis, and when nothing is written at all. Pure functions from the field's definition, whether
// the item is linked to a till and the stored layers to a list of planned writes; the service
// turns them into one change set for `apply()`.
//
//   builder-owned field                       -> `manual`
//   hand-made item (no till link), any field  -> `manual`
//   linked, till-owned, overridable, and
//     the till holds a value                  -> `override`, basis = the till's current value
//     the till holds none                     -> `manual`
//   linked, price (locked) or till-owned and
//     not overridable                         -> refused: "Change this in the till"
//   flags that only make the menu more cautious (visible, for_sale) -> not edited here
//   Revert / take the till's                  -> clear the override
//
// A `localized_text` value is planned one language at a time (D24): a language the till holds is
// overridden (display name), a language it lacks is ours (`manual`), and nothing is copied from
// one layer into another by accident.
import {
  canonicalJson,
  FIELD_TYPES,
  type FieldDefinition,
  LOCALES,
  type Locale,
  type LocalizedText,
} from '@restro/core'

import type { LayerView } from './layers'
import type { FieldAccess } from './types'

/** What the plan needs to know about a field of an item. */
export interface PlanContext {
  readonly definition: FieldDefinition
  /** The item has a till link (source `till:<integration>`), in any state. */
  readonly linkedToTill: boolean
  readonly layers: LayerView
}

/** One planned write to one layer of the field. */
export type PlannedWrite =
  | { readonly kind: 'set'; readonly layer: 'manual'; readonly value: unknown }
  | {
      readonly kind: 'set'
      readonly layer: 'override'
      readonly value: unknown
      readonly basis: unknown
    }
  | { readonly kind: 'clear'; readonly layer: 'manual' | 'override' }

/** Why nothing is written. */
export type PlanRefusal =
  /** The till owns this value and it cannot be changed here. */
  | 'locked'
  /** This field is not edited by a save (it only ever gets more cautious elsewhere). */
  | 'read_only'
  /** There is no override to revert or keep. */
  | 'nothing_to_revert'
  /** An override needs the till's current value as its basis, and the till holds none. */
  | 'no_basis'

export type Plan =
  | { readonly ok: true; readonly writes: readonly PlannedWrite[] }
  | { readonly ok: false; readonly refusal: PlanRefusal }

const refuse = (refusal: PlanRefusal): Plan => ({ ok: false, refusal })
const done = (writes: readonly PlannedWrite[]): Plan => ({ ok: true, writes })

/** True if two values are the same value of the field (by the type's hash when both are valid). */
export function sameFieldValue(definition: FieldDefinition, a: unknown, b: unknown): boolean {
  const spec = FIELD_TYPES[definition.type]
  const left = spec.validate(a, definition).ok
  const right = spec.validate(b, definition).ok
  if (left && right) return spec.hash(a as never) === spec.hash(b as never)
  try {
    return canonicalJson(a) === canonicalJson(b)
  } catch {
    return false
  }
}

function isBlank(text: string | undefined): boolean {
  return text === undefined || text.trim() === ''
}

function textOf(value: unknown): LocalizedText {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as LocalizedText)
    : {}
}

function holds(text: LocalizedText, locale: Locale): boolean {
  return !isBlank(text[locale])
}

/** Languages in the canonical order, so a planned value is the same whatever order it was built in. */
function compact(text: LocalizedText): LocalizedText {
  const out: LocalizedText = {}
  for (const locale of LOCALES) {
    const value = text[locale]
    if (value !== undefined && !isBlank(value)) out[locale] = value
  }
  return out
}

/**
 * Whether a save on this field is refused outright, and why. Flags (`all_true`) are not edited
 * from the sheet; a locked or non-overridable till value on a linked item is changed in the till.
 */
function refusalFor(context: PlanContext): PlanRefusal | null {
  const { definition, linkedToTill } = context
  if (definition.combinator === 'all_true') return 'read_only'
  if (!linkedToTill) return null
  if (definition.combinator === 'locked') return 'locked'
  // `never_when_orderable` is treated as `never`, like write validation does.
  if (definition.owner === 'till' && definition.overridable !== 'always') return 'locked'
  return null
}

/** True if a save on this field should become an override: the till's value is there to replace. */
function overridesTill(context: PlanContext): boolean {
  const { definition, linkedToTill, layers } = context
  return (
    linkedToTill &&
    definition.owner === 'till' &&
    definition.overridable === 'always' &&
    layers.till !== undefined
  )
}

/** The writes that set the manual layer of a localized field to `next`. */
function manualWrites(layers: LayerView, next: LocalizedText): PlannedWrite[] {
  const value = compact(next)
  const existing = layers.manual
  if (Object.keys(value).length === 0) {
    return existing ? [{ kind: 'clear', layer: 'manual' }] : []
  }
  if (existing && canonicalJson(compact(textOf(existing.value))) === canonicalJson(value)) return []
  return [{ kind: 'set', layer: 'manual', value }]
}

/** The writes that set the override of a localized field to `next` over the till's `basis`. */
function overrideWrites(layers: LayerView, next: LocalizedText, basis: unknown): PlannedWrite[] {
  const value = compact(next)
  const existing = layers.override
  if (Object.keys(value).length === 0) {
    return existing ? [{ kind: 'clear', layer: 'override' }] : []
  }
  if (
    existing &&
    canonicalJson(compact(textOf(existing.value))) === canonicalJson(value) &&
    canonicalJson(existing.basis) === canonicalJson(basis)
  ) {
    return []
  }
  return [{ kind: 'set', layer: 'override', value, basis }]
}

/** A localized value edited as a whole (the Details tab's editor). */
function planLocalizedSave(context: PlanContext, edited: LocalizedText): Plan {
  const { layers } = context
  const tillText = textOf(layers.till?.value)
  const manualText = textOf(layers.manual?.value)

  if (overridesTill(context)) {
    const overrideNext: LocalizedText = {}
    const manualNext: LocalizedText = { ...manualText }
    for (const locale of LOCALES) {
      const wanted = edited[locale]
      if (holds(tillText, locale)) {
        // A language the till holds: ours goes in the override, and only where it differs.
        if (!isBlank(wanted) && wanted !== tillText[locale]) overrideNext[locale] = wanted
      } else if (isBlank(wanted)) {
        delete manualNext[locale]
      } else {
        // A language the till lacks is ours: a translation, saved to the manual layer (D24).
        manualNext[locale] = wanted
      }
    }
    return done([
      ...overrideWrites(layers, overrideNext, layers.till?.value),
      ...manualWrites(layers, manualNext),
    ])
  }

  // Our own value (builder-owned, hand-made, or the till holds nothing): only what the person
  // changed is written, so a fallback text from the till is not copied into `manual`.
  const manualNext: LocalizedText = {}
  for (const locale of LOCALES) {
    const wanted = edited[locale]
    if (isBlank(wanted)) continue
    if (!holds(manualText, locale) && wanted === tillText[locale]) continue
    manualNext[locale] = wanted
  }
  return done(manualWrites(layers, manualNext))
}

/** A value of any other type edited as a whole. */
function planPlainSave(context: PlanContext, edited: unknown | undefined): Plan {
  const { definition, layers } = context
  if (overridesTill(context)) {
    const basis = layers.till?.value
    if (edited === undefined) {
      return done(layers.override ? [{ kind: 'clear', layer: 'override' }] : [])
    }
    // Saying what the till says is no override (except a `must_agree` field, where choosing its
    // value is the way to settle a disagreement with our own).
    if (definition.combinator !== 'must_agree' && sameFieldValue(definition, edited, basis)) {
      return done(layers.override ? [{ kind: 'clear', layer: 'override' }] : [])
    }
    return done([{ kind: 'set', layer: 'override', value: edited, basis }])
  }
  if (edited === undefined) {
    return done(layers.manual ? [{ kind: 'clear', layer: 'manual' }] : [])
  }
  return done([{ kind: 'set', layer: 'manual', value: edited }])
}

/**
 * The writes for saving `edited` (the whole value of the field as the editor holds it;
 * `undefined` = the person cleared it).
 */
export function planFieldSave(context: PlanContext, edited: unknown | undefined): Plan {
  const refusal = refusalFor(context)
  if (refusal !== null) return refuse(refusal)
  if (context.definition.type === 'localized_text') {
    return planLocalizedSave(context, textOf(edited))
  }
  return planPlainSave(context, edited)
}

/** Revert, or take the till's value instead of ours: remove the override so the till shows. */
export function planRevert(context: PlanContext): Plan {
  if (!context.layers.override) return refuse('nothing_to_revert')
  return done([{ kind: 'clear', layer: 'override' }])
}

/** Keep our override although the till changed: record its current value as the new basis. */
export function planKeepOverride(context: PlanContext): Plan {
  const { override, till } = context.layers
  if (!override) return refuse('nothing_to_revert')
  if (!till) return refuse('no_basis')
  return done([{ kind: 'set', layer: 'override', value: override.value, basis: till.value }])
}

/**
 * One language of a localized field, edited in the Translations grid: always the manual layer,
 * and only in a language the till does not hold when the till owns the field (D24).
 */
export function planTranslation(
  context: PlanContext,
  locale: Locale,
  text: string | undefined,
): Plan {
  const { definition, layers } = context
  if (definition.type !== 'localized_text') return refuse('read_only')
  if (definition.owner === 'till' && holds(textOf(layers.till?.value), locale)) {
    return refuse('locked')
  }
  const next: LocalizedText = { ...textOf(layers.manual?.value) }
  if (isBlank(text)) delete next[locale]
  else next[locale] = text
  return done(manualWrites(layers, next))
}

/** How a field is edited from the sheet, from its definition and what the resolver found. */
export function fieldAccess(
  context: PlanContext,
  resolved: { readonly value: unknown; readonly layer: string | null } | undefined,
): FieldAccess {
  const { definition } = context
  if (definition.type === 'image') return { kind: 'media' }
  if (definition.combinator === 'all_true') {
    // A flag the till says false for (hidden, off sale) is the till's call; ours only add to it.
    if (resolved?.value === false && resolved.layer === 'till') {
      return { kind: 'readonly', reason: 'till_decides' }
    }
    return {
      kind: 'readonly',
      reason: definition.key === 'for_sale' ? 'sold_out_control' : 'composer_toggle',
    }
  }
  if (refusalFor(context) === 'locked') return { kind: 'readonly', reason: 'locked_to_till' }
  return { kind: 'edit' }
}
