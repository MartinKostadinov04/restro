// The combinators (doc "Combinators", "Ownership matrix", "Overrides and staleness"): how the
// usable values of a field's layers become one resolved value with its provenance. Each field
// definition names its combinator; the node only adds whether it is linked to a till (a `locked`
// field reads the till alone on a linked node and behaves like `source_first` on a hand-made one).

import { isEditionLayer, type Layer } from '../change-set'
import type { Combinator, FieldDefinition } from '../field-definition'
import type { FieldValue } from '../field-types/catalog'
import { LOCALES, type Locale, type LocalizedText } from '../locales'
import { isEmptyValue, type LayerValue, sameValue } from './layers'
import type {
  IssueCode,
  IssueSeverity,
  Provenance,
  ResolvedField,
  ResolvedLayer,
  ResolvedLocale,
} from './types'

/** An issue of one field, before the resolver adds the node id and field key. */
export interface FieldIssue {
  readonly code: IssueCode
  readonly severity: IssueSeverity
  readonly locale?: Locale
}

/** Everything one field's resolution reads. */
export interface FieldInput {
  readonly definition: FieldDefinition
  /** The usable value of each layer the combinator reads (see `readsLayer`, `pickLayers`). */
  readonly layers: ReadonlyMap<Layer, LayerValue>
  /** True if the node has a till link, whatever its state. */
  readonly linkedToTill: boolean
  /** Enabled locales, default first: they choose which locale's provenance the field shows. */
  readonly locales: readonly Locale[]
}

/** A resolved field and the issues found on the way. */
export interface FieldOutcome {
  readonly field: ResolvedField
  readonly issues: readonly FieldIssue[]
}

/**
 * Whether a field's combinator reads `layer` at all. Editions only ever feed `all_true` flags
 * (tracker, "Engineering notes for Stage 2"); builder-owned fields are never overridden; a
 * `locked` field on a till-linked node reads the till alone ("Change this in the till").
 */
export function readsLayer(
  definition: FieldDefinition,
  linkedToTill: boolean,
  layer: Layer,
): boolean {
  if (definition.combinator === 'all_true') return true
  if (isEditionLayer(layer)) return false
  if (definition.combinator === 'locked' && linkedToTill) return layer === 'till'
  if (definition.combinator === 'builder_first') return layer !== 'override'
  return true
}

/** One candidate of a value-picking chain. */
interface Entry {
  readonly value: unknown
  readonly provenance: Provenance
  readonly layer: Exclude<ResolvedLayer, null>
}

function entryOf(input: FieldInput, layer: Layer, provenance: Provenance): Entry | undefined {
  const value = input.layers.get(layer)
  return value === undefined ? undefined : { value: value.value, provenance, layer }
}

function defaultEntry(definition: FieldDefinition): Entry | undefined {
  return definition.default === undefined
    ? undefined
    : { value: definition.default, provenance: 'none', layer: 'default' }
}

function present<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined)
}

/** Provenance of a value that some layer holds (not via a value-picking chain). */
function provenanceOfLayer(layer: Layer): Provenance {
  if (layer === 'till') return 'till'
  if (layer === 'override') return 'overridden'
  return 'owned'
}

function isBlank(text: string | undefined): boolean {
  return text === undefined || text.trim().length === 0
}

/**
 * `localized_text`, one locale at a time (D24): each locale takes its text from the first entry
 * that has it, so the till's text wins where the till holds the locale and ours fills the rest. The
 * field's own provenance is that of the first enabled locale with text (the default first).
 */
function firstPerLocale(
  entries: readonly Entry[],
  emptyProvenance: Provenance,
  locales: readonly Locale[],
): ResolvedField {
  const value: LocalizedText = {}
  const byLocale: Partial<Record<Locale, ResolvedLocale>> = {}
  for (const locale of LOCALES) {
    for (const entry of entries) {
      const text = (entry.value as LocalizedText)[locale]
      if (text === undefined || isBlank(text)) continue
      value[locale] = text
      byLocale[locale] = { provenance: entry.provenance, layer: entry.layer }
      break
    }
  }
  const lead = [...locales, ...LOCALES].find((locale) => byLocale[locale] !== undefined)
  const top = lead === undefined ? undefined : byLocale[lead]
  if (top === undefined) return { value: null, provenance: emptyProvenance, layer: null }
  return { value, provenance: top.provenance, layer: top.layer, locales: byLocale }
}

/** The first non-empty entry of a chain; per locale for `localized_text`. */
function firstNonEmpty(
  input: FieldInput,
  entries: readonly Entry[],
  emptyProvenance: Provenance,
): ResolvedField {
  const { definition } = input
  if (definition.type === 'localized_text') {
    return firstPerLocale(entries, emptyProvenance, input.locales)
  }
  for (const entry of entries) {
    if (!isEmptyValue(definition, entry.value)) {
      return { value: entry.value as FieldValue, provenance: entry.provenance, layer: entry.layer }
    }
  }
  return { value: null, provenance: emptyProvenance, layer: null }
}

/** The override in force, if any, and whether its basis no longer matches the till. */
interface OverrideState {
  readonly override: LayerValue | undefined
  readonly stale: boolean
}

/**
 * Staleness (doc "Overrides and staleness"): an override is stale when its basis differs from
 * the till's current value, including when the till no longer holds one or the basis is unknown.
 * The definition's policy then applies: `drop` lets the till take over (the override is not used),
 * `review` and `keep` keep it in force (only `review` raises an issue).
 */
function overrideState(input: FieldInput): OverrideState {
  const override = input.layers.get('override')
  if (override === undefined) return { override: undefined, stale: false }
  const till = input.layers.get('till')
  const stale =
    override.basis === null ||
    till === undefined ||
    !sameValue(input.definition, override.basis, till.value)
  if (stale && input.definition.stalePolicy === 'drop') return { override: undefined, stale: false }
  return { override, stale }
}

function staleIssues(input: FieldInput, state: OverrideState): FieldIssue[] {
  return state.stale && input.definition.stalePolicy === 'review'
    ? [{ code: 'stale_override', severity: 'warning' }]
    : []
}

function overrideEntry(state: OverrideState): Entry | undefined {
  if (state.override === undefined) return undefined
  return {
    value: state.override.value,
    provenance: state.stale ? 'stale' : 'overridden',
    layer: 'override',
  }
}

/** True if instant `a` is after instant `b`; unreadable timestamps count as after (flag it). */
function isAfter(a: string, b: string): boolean {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true
  return ta > tb
}

/**
 * D24: our own translation of a till text (a locale the till does not hold, filled from the
 * manual layer) is flagged for review when the till's text changed after it was written. It
 * stays live meanwhile.
 */
function translationReviews(input: FieldInput, field: ResolvedField): FieldIssue[] {
  const till = input.layers.get('till')
  if (till === undefined || field.locales === undefined) return []
  const issues: FieldIssue[] = []
  for (const locale of LOCALES) {
    const source = field.locales[locale]
    if (source === undefined || source.provenance !== 'owned' || source.layer === 'default') {
      continue
    }
    const ours = input.layers.get(source.layer)
    if (ours !== undefined && isAfter(till.observedAt, ours.observedAt)) {
      issues.push({ code: 'translation_review', severity: 'warning', locale })
    }
  }
  return issues
}

/** `source_first`: override → till → manual → default (first non-empty). */
function sourceFirst(input: FieldInput): FieldOutcome {
  const state = overrideState(input)
  const entries = present([
    overrideEntry(state),
    entryOf(input, 'till', 'till'),
    entryOf(input, 'manual', 'owned'),
    defaultEntry(input.definition),
  ])
  const field = firstNonEmpty(input, entries, 'none')
  return { field, issues: [...staleIssues(input, state), ...translationReviews(input, field)] }
}

/** `builder_first`: manual → till → default (the till's value is only a fallback). */
function builderFirst(input: FieldInput): FieldOutcome {
  const entries = present([
    entryOf(input, 'manual', 'owned'),
    entryOf(input, 'till', 'till'),
    defaultEntry(input.definition),
  ])
  return { field: firstNonEmpty(input, entries, 'none'), issues: [] }
}

/**
 * `locked`: on a till-linked node, the till's value only (no default, no other layer), shown as
 * locked even when the till holds none; on a hand-made node, `source_first` (ownership matrix:
 * price is "locked when orderable, source_first otherwise").
 */
function locked(input: FieldInput): FieldOutcome {
  if (!input.linkedToTill) return sourceFirst(input)
  const entries = present([entryOf(input, 'till', 'locked')])
  return { field: firstNonEmpty(input, entries, 'locked'), issues: [] }
}

/** Stack order for `all_true`: the till first (its `false` wins at once), then ours, editions last. */
function allTrueOrder(layers: ReadonlyMap<Layer, LayerValue>): Layer[] {
  const editions = [...layers.keys()].filter(isEditionLayer).sort()
  return ['till', 'manual', 'override', ...editions]
}

/**
 * `all_true`: every layer that holds a value must say true (rule 5: our layers can only hide or
 * take off sale). With no layer, the default; with no default, no value (callers decide what an
 * unknown flag means). A `false` names the first layer that said it.
 */
function allTrue(input: FieldInput): FieldOutcome {
  const values = present(allTrueOrder(input.layers).map((layer) => input.layers.get(layer)))
  const first = values[0]
  if (first === undefined) {
    const fallback = defaultEntry(input.definition)
    const field: ResolvedField =
      fallback === undefined
        ? { value: null, provenance: 'none', layer: null }
        : { value: fallback.value === true, provenance: 'none', layer: 'default' }
    return { field, issues: [] }
  }
  const decider = values.find((value) => value.value !== true) ?? first
  return {
    field: {
      value: decider.value === true,
      provenance: provenanceOfLayer(decider.layer),
      layer: decider.layer,
    },
    issues: [],
  }
}

/**
 * The union of set values (tags, enum_set), deduplicated: `enum_set` in its options' order,
 * tags in first-seen order across `entries`.
 */
function unionOf(definition: FieldDefinition, entries: readonly Entry[]): string[] {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!Array.isArray(entry.value)) continue
    for (const member of entry.value) if (typeof member === 'string') seen.add(member)
  }
  const members = [...seen]
  const options = definition.options
  if (definition.type !== 'enum_set' || options === undefined) return members
  const rank = (member: string) => {
    const index = options.indexOf(member)
    return index === -1 ? options.length : index
  }
  return members.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
}

/** `union`: the set of all values; provenance from the first layer in builder order. */
function union(input: FieldInput): FieldOutcome {
  const entries = present([
    entryOf(input, 'manual', 'owned'),
    entryOf(input, 'override', 'overridden'),
    entryOf(input, 'till', 'till'),
  ])
  const first = entries[0]
  if (first === undefined) {
    const fallback = defaultEntry(input.definition)
    const field: ResolvedField =
      fallback === undefined
        ? { value: null, provenance: 'none', layer: null }
        : { value: fallback.value as FieldValue, provenance: 'none', layer: 'default' }
    return { field, issues: [] }
  }
  return {
    field: {
      value: unionOf(input.definition, entries),
      provenance: first.provenance,
      layer: first.layer,
    },
    issues: [],
  }
}

const SET_TYPES = new Set(['tags', 'enum_set'])

/**
 * The value shown while layers disagree: for sets the union (every allergen any layer claims,
 * the cautious reading for a guest), otherwise the first entry (the till's when it has one).
 */
function conflictValue(definition: FieldDefinition, entries: readonly Entry[]): FieldValue | null {
  if (SET_TYPES.has(definition.type)) return unionOf(definition, entries)
  const first = entries[0]
  return first === undefined ? null : (first.value as FieldValue)
}

function conflictIssue(definition: FieldDefinition): FieldIssue {
  // V5 is a warning for allergens (D42); a must_agree field marked critical blocks its node.
  return { code: 'V5', severity: definition.critical ? 'block_node' : 'warning' }
}

/**
 * `must_agree`: if the till and the manual layer disagree the field is in conflict until a
 * person chooses; the choice is stored as an override and wins. When the till changes after that
 * choice (stale, policy `review`), the conflict re-opens.
 */
function mustAgree(input: FieldInput): FieldOutcome {
  const { definition } = input
  const state = overrideState(input)
  const sources = present([
    entryOf(input, 'till', 'till'),
    entryOf(input, 'manual', 'owned'),
  ]).filter((entry) => !isEmptyValue(definition, entry.value))
  const chosen = overrideEntry(state)
  if (chosen !== undefined) {
    if (!state.stale || definition.stalePolicy !== 'review') {
      return {
        field: {
          value: chosen.value as FieldValue,
          provenance: chosen.provenance,
          layer: 'override',
        },
        issues: [],
      }
    }
    return {
      field: {
        value: conflictValue(definition, [chosen, ...sources]),
        provenance: 'stale',
        layer: 'override',
        conflict: true,
      },
      issues: [...staleIssues(input, state), conflictIssue(definition)],
    }
  }
  const first = sources[0]
  if (first === undefined) {
    const fallback = defaultEntry(definition)
    const field: ResolvedField =
      fallback === undefined
        ? { value: null, provenance: 'none', layer: null }
        : { value: fallback.value as FieldValue, provenance: 'none', layer: 'default' }
    return { field, issues: [] }
  }
  if (sources.every((entry) => sameValue(definition, entry.value, first.value))) {
    return {
      field: { value: first.value as FieldValue, provenance: first.provenance, layer: first.layer },
      issues: [],
    }
  }
  return {
    field: {
      value: conflictValue(definition, sources),
      provenance: first.provenance,
      layer: first.layer,
      conflict: true,
    },
    issues: [conflictIssue(definition)],
  }
}

/** One function per combinator; a new combinator without one is a compile error. */
const COMBINATORS_IMPL: { readonly [C in Combinator]: (input: FieldInput) => FieldOutcome } = {
  source_first: sourceFirst,
  builder_first: builderFirst,
  locked,
  all_true: allTrue,
  union,
  must_agree: mustAgree,
}

/** Resolves one field from its layers with the definition's combinator. */
export function combineField(input: FieldInput): FieldOutcome {
  return COMBINATORS_IMPL[input.definition.combinator](input)
}
