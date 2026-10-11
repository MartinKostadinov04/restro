// The leak guard (rule 3; brief S3-01a): a snapshot is published only if it parses against the
// strict `menu-snapshot/1` schema AND no string in it — value or key — equals a value the
// backend keeps to itself. The strict schema leaves no slot for a till's id or an internal
// field; the walk catches a builder bug that would put one into a slot that does exist.
//
// `collectForbiddenValues` gathers those values from the document. External ids are refused
// outright. Internal field values and override bases are refused unless the same string is
// public anyway (a public value of the document, the template's public labels, or a word of
// the snapshot's own vocabulary): an override basis is the till's earlier text, which commonly
// equals a public value elsewhere (the till's allergen codes beside our override of them, the
// other languages of a name), and refusing those would block every publish without keeping
// anything private.

import { ALLERGENS, DIETARY_LABELS } from '../allergens'
import type { MenuDocument } from '../document/types'
import type { FieldDefinition } from '../field-definition'
import { FIELD_TYPE_NAMES, MEASUREMENT_UNITS } from '../field-types/catalog'
import { LOCALES } from '../locales'
import { CURRENCIES } from '../money'
import type { NodeType } from '../node-types'
import type { Template } from '../template'
import { ORDER_MODES } from '../templates/venue-menu'
import { parseSnapshot, SnapshotError, type SnapshotProblem, snapshotPath } from './errors'
import {
  type MenuSnapshot,
  NEW_BADGE,
  SNAPSHOT_ITEM_STATES,
  SNAPSHOT_ORDER_MODES,
  SNAPSHOT_SCHEMA,
} from './schema'

/** What a forbidden value is, for the error (the value itself is never shown). */
export type ForbiddenKind = 'external_id' | 'internal_value' | 'override_basis' | 'backend_only'

/** Values that must never appear in a snapshot, by what they are. */
export type ForbiddenValues = ReadonlyMap<string, ForbiddenKind>

/** Every string a snapshot's own structure can hold whatever the document says. */
const SNAPSHOT_VOCABULARY: readonly string[] = [
  SNAPSHOT_SCHEMA,
  NEW_BADGE,
  'master',
  ...SNAPSHOT_ITEM_STATES,
  ...SNAPSHOT_ORDER_MODES,
  ...ORDER_MODES,
  ...ALLERGENS,
  ...DIETARY_LABELS,
  ...LOCALES,
  ...CURRENCIES,
  ...MEASUREMENT_UNITS,
  ...FIELD_TYPE_NAMES,
]

/** Every string inside a JSON value (object keys excluded: they are shapes, not data). */
function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value !== '') out.push(value)
  } else if (Array.isArray(value)) {
    for (const member of value) stringLeaves(member, out)
  } else if (typeof value === 'object' && value !== null) {
    for (const member of Object.values(value)) stringLeaves(member, out)
  }
  return out
}

/** The sources of the forbidden values of one document. */
export interface ForbiddenSources {
  readonly template: Template
  readonly doc: MenuDocument
  /** External ids of the document's nodes (the till's item, category, modifier ids …). */
  readonly externalIds: Iterable<string>
  /** Other backend-only strings, always refused (asset storage keys and origins …). */
  readonly backendOnly?: Iterable<string>
  /** Strings public by design that are not field values (theme tokens, tag labels …). */
  readonly publicStrings?: Iterable<string>
}

/**
 * The forbidden values of one document: every external id and backend-only string, plus every
 * string of an internal field's value (or of a field the template does not know) and of an
 * override basis that is not also public (see the file header).
 */
export function collectForbiddenValues(sources: ForbiddenSources): Map<string, ForbiddenKind> {
  const { template, doc } = sources
  const definitions = new Map<string, FieldDefinition>()
  for (const [type, spec] of Object.entries(template.nodeTypes) as [
    NodeType,
    { fields: FieldDefinition[] },
  ][]) {
    for (const def of spec.fields) definitions.set(`${type}\u0000${def.key}`, def)
  }
  const typeOf = new Map(doc.nodes.map((node) => [node.id, node.type]))
  const definitionOf = (row: MenuDocument['values'][number]) => {
    const type = typeOf.get(row.nodeId)
    return type === undefined ? undefined : definitions.get(`${type}\u0000${row.fieldKey}`)
  }

  const publicStrings = new Set<string>([...SNAPSHOT_VOCABULARY, ...(sources.publicStrings ?? [])])
  for (const def of definitions.values()) {
    if (def.visibility !== 'public') continue
    for (const text of stringLeaves(def.label)) publicStrings.add(text)
    if (def.unit !== undefined) publicStrings.add(def.unit)
    for (const option of def.options ?? []) publicStrings.add(option)
  }
  for (const row of doc.values) {
    if (definitionOf(row)?.visibility === 'public') {
      for (const text of stringLeaves(row.value)) publicStrings.add(text)
    }
  }

  const forbidden = new Map<string, ForbiddenKind>()
  for (const id of sources.externalIds) if (id !== '') forbidden.set(id, 'external_id')
  for (const text of sources.backendOnly ?? []) {
    if (text !== '' && !forbidden.has(text)) forbidden.set(text, 'backend_only')
  }
  const addUnlessPublic = (texts: readonly string[], kind: ForbiddenKind) => {
    for (const text of texts) {
      if (!publicStrings.has(text) && !forbidden.has(text)) forbidden.set(text, kind)
    }
  }
  for (const row of doc.values) {
    if (definitionOf(row)?.visibility !== 'public') {
      addUnlessPublic(stringLeaves(row.value), 'internal_value')
    }
    if (row.basis !== null && row.basis !== undefined) {
      addUnlessPublic(stringLeaves(row.basis), 'override_basis')
    }
  }
  return forbidden
}

/**
 * Refuses a snapshot that is not a valid `menu-snapshot/1` or that holds, as a value or a key,
 * any string of `forbidden`. Returns the parsed snapshot. The error lists every place found
 * (redacted path and kind), never the value.
 */
export function assertSnapshotSafe(snapshot: unknown, forbidden: ForbiddenValues): MenuSnapshot {
  const parsed = parseSnapshot(snapshot, forbidden)
  const problems: SnapshotProblem[] = []
  const walk = (value: unknown, path: PropertyKey[]) => {
    if (typeof value === 'string') {
      const kind = forbidden.get(value)
      if (kind !== undefined) problems.push({ path: snapshotPath(path, forbidden), code: kind })
    } else if (Array.isArray(value)) {
      for (const [index, member] of value.entries()) walk(member, [...path, index])
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, member] of Object.entries(value)) {
        const kind = forbidden.get(key)
        if (kind !== undefined) {
          problems.push({ path: snapshotPath([...path, key], forbidden), code: kind })
        }
        walk(member, [...path, key])
      }
    }
  }
  walk(snapshot, [])
  if (problems.length > 0) throw new SnapshotError('forbidden_value', problems)
  return parsed
}
