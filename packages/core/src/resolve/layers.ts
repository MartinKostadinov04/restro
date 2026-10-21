// Gathering the stored rows of one field of one node into at most one usable value per layer
// (doc "The layer stack"; brief S2-04 "scope"): rows of other venues and of inactive editions are
// out of context; a `venue:` row beats the `master` row of the same layer; rejected rows and rows
// that no longer pass their definition are never used.

import { isEditionLayer, isLayer, type Layer, type Scope } from '../change-set'
import type { MenuDocument } from '../document/types'
import type { FieldDefinition } from '../field-definition'
import type { FieldType } from '../field-types/catalog'
import { FIELD_TYPES, type FieldTypeSpec } from '../field-types/specs'
import { canonicalJson } from '../hash'
import type { NodeId } from '../ids'

/** One stored `field_values` row as the document carries it. */
export type ValueRow = MenuDocument['values'][number]

/** The usable value of one layer for one field of one node. */
export interface LayerValue {
  readonly layer: Layer
  readonly scope: Scope
  /** Valid for the field's definition. */
  readonly value: unknown
  /** Override rows only: the till's value when the override was made. */
  readonly basis: unknown | null
  readonly observedAt: string
}

/** The rows of one layer for one field: at most one per scope that is in context. */
interface Slot {
  venue?: ValueRow
  master?: ValueRow
}

/** Rows in context, by node, then field key, then layer. */
export type RowIndex = ReadonlyMap<NodeId, ReadonlyMap<string, ReadonlyMap<Layer, Slot>>>

/** The registry spec of a definition's field type, typed for values of any type. */
export function specOf(definition: FieldDefinition): FieldTypeSpec<FieldType> {
  return FIELD_TYPES[definition.type] as unknown as FieldTypeSpec<FieldType>
}

/** True if `value` is a valid value of the field. */
export function isValidValue(definition: FieldDefinition, value: unknown): boolean {
  return specOf(definition).validate(value, definition).ok
}

/** True if a (valid) value counts as no value for the field's type. */
export function isEmptyValue(definition: FieldDefinition, value: unknown): boolean {
  return specOf(definition).isEmpty(value as never)
}

function canonicalOrNull(value: unknown): string | null {
  try {
    return canonicalJson(value)
  } catch {
    return null
  }
}

/**
 * True if two values are the same value of the field: by the type's hash when both are valid
 * (order-insensitive for sets), else by canonical JSON. Anything unreadable is never the same.
 */
export function sameValue(definition: FieldDefinition, a: unknown, b: unknown): boolean {
  if (isValidValue(definition, a) && isValidValue(definition, b)) {
    const spec = specOf(definition)
    return spec.hash(a as never) === spec.hash(b as never)
  }
  const left = canonicalOrNull(a)
  return left !== null && left === canonicalOrNull(b)
}

function instant(timestamp: string): number {
  return Date.parse(timestamp)
}

/**
 * The row kept when one slot holds two (the database's unique key prevents it; the choice must
 * still not depend on input order): a valid row, then the later observation, then the larger
 * canonical JSON.
 */
function preferRow(a: ValueRow, b: ValueRow): ValueRow {
  if (a.valid !== b.valid) return a.valid ? a : b
  const ta = instant(a.observedAt)
  const tb = instant(b.observedAt)
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb ? a : b
  const ca = canonicalOrNull(a) ?? ''
  const cb = canonicalOrNull(b) ?? ''
  return ca >= cb ? a : b
}

/**
 * Indexes the rows that are in context: scope `master` or this venue's scope, and either a base
 * layer or an edition layer that `editionActive` accepts. Everything else is left out silently:
 * another venue's price or an inactive edition is not part of this resolution.
 */
export function indexRows(
  values: MenuDocument['values'],
  venueScope: Scope,
  editionActive: (layer: `edition:${string}`) => boolean,
): RowIndex {
  const index = new Map<NodeId, Map<string, Map<Layer, Slot>>>()
  for (const row of values) {
    if (row.scope !== 'master' && row.scope !== venueScope) continue
    if (!isLayer(row.layer)) continue
    if (isEditionLayer(row.layer) && !editionActive(row.layer)) continue
    let fields = index.get(row.nodeId)
    if (fields === undefined) {
      fields = new Map()
      index.set(row.nodeId, fields)
    }
    let layers = fields.get(row.fieldKey)
    if (layers === undefined) {
      layers = new Map()
      fields.set(row.fieldKey, layers)
    }
    let slot = layers.get(row.layer)
    if (slot === undefined) {
      slot = {}
      layers.set(row.layer, slot)
    }
    const key = row.scope === 'master' ? 'master' : 'venue'
    const current = slot[key]
    slot[key] = current === undefined ? row : preferRow(current, row)
  }
  return index
}

/** The usable values of one field's layers, and what was left out on the way. */
export interface PickedLayers {
  /** One usable value per layer the combinator reads. */
  readonly values: ReadonlyMap<Layer, LayerValue>
  /** True if a row of a layer it reads was rejected or fails its definition (never used). */
  readonly invalid: boolean
  /** True if a row sits in a layer the combinator never reads. */
  readonly ignored: boolean
}

function toLayerValue(row: ValueRow): LayerValue {
  return {
    layer: row.layer,
    scope: row.scope,
    value: row.value,
    basis: row.basis ?? null,
    observedAt: row.observedAt,
  }
}

/**
 * Picks one value per layer the combinator reads (`reads`). The venue row beats the master row.
 * When the venue row is unusable, `fallBackToMaster` decides: true uses the master row (right for
 * `all_true`, where any `false` must still count), false leaves the layer without a value (right
 * for value-picking fields: the till's master price must never stand in for a broken venue price).
 */
export function pickLayers(
  definition: FieldDefinition,
  slots: ReadonlyMap<Layer, Slot> | undefined,
  reads: (layer: Layer) => boolean,
  fallBackToMaster: boolean,
): PickedLayers {
  const values = new Map<Layer, LayerValue>()
  let invalid = false
  let ignored = false
  if (slots === undefined) return { values, invalid, ignored }
  const usable = (row: ValueRow | undefined): row is ValueRow => {
    if (row === undefined) return false
    if (row.valid && isValidValue(definition, row.value)) return true
    invalid = true
    return false
  }
  for (const [layer, slot] of slots) {
    if (!reads(layer)) {
      ignored = true
      continue
    }
    const venueOk = usable(slot.venue)
    const masterOk = usable(slot.master)
    let chosen: ValueRow | undefined
    if (slot.venue !== undefined) {
      chosen = venueOk ? slot.venue : fallBackToMaster && masterOk ? slot.master : undefined
    } else if (masterOk) {
      chosen = slot.master
    }
    if (chosen !== undefined) values.set(layer, toLayerValue(chosen))
  }
  return { values, invalid, ignored }
}
