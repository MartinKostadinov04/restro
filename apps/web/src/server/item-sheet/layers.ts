// The stored values of one field of one node, per layer, read from the menu document: what the
// item sheet needs to decide where a save goes (the resolver returns the winner, not the layers).
// Same rules as the resolver's own selection: rows of this venue's scope beat `master` rows of
// the same layer, rejected rows are ignored, edition layers are not edited here.
import type { Layer, MenuDocument, Scope } from '@restro/core'

/** One layer's usable value. */
export interface LayerEntry {
  readonly value: unknown
  /** Overrides only: barsy's value when the override was made. */
  readonly basis: unknown | null
  readonly scope: Scope
  readonly observedAt: string
}

/** The layers a person's save can touch, plus the ones it can be compared with. */
export interface LayerView {
  readonly barsy?: LayerEntry
  readonly import?: LayerEntry
  readonly manual?: LayerEntry
  readonly override?: LayerEntry
}

const BASE_LAYERS = ['barsy', 'import', 'manual', 'override'] as const

/** The layers of one field of one node, for the venue `venueScope` (`venue:vn_…`). */
export function layerView(
  doc: MenuDocument,
  nodeId: string,
  fieldKey: string,
  venueScope: Scope,
): LayerView {
  const picked: Partial<Record<(typeof BASE_LAYERS)[number], LayerEntry>> = {}
  for (const layer of BASE_LAYERS) {
    const rows = doc.values.filter(
      (row) =>
        row.nodeId === nodeId &&
        row.fieldKey === fieldKey &&
        row.layer === layer &&
        row.valid &&
        (row.scope === 'master' || row.scope === venueScope),
    )
    const row = rows.find((candidate) => candidate.scope === venueScope) ?? rows[0]
    if (row) {
      picked[layer] = {
        value: row.value,
        basis: row.basis ?? null,
        scope: row.scope,
        observedAt: row.observedAt,
      }
    }
  }
  return picked
}

/** Every layer entry as a map, in the shape the resolver's combinators take. */
export function layerMap(
  view: LayerView,
): Map<
  Layer,
  { layer: Layer; scope: Scope; value: unknown; basis: unknown | null; observedAt: string }
> {
  const map = new Map<
    Layer,
    { layer: Layer; scope: Scope; value: unknown; basis: unknown | null; observedAt: string }
  >()
  for (const layer of BASE_LAYERS) {
    const entry = view[layer]
    if (entry) map.set(layer, { layer, ...entry })
  }
  return map
}
