// The change set (doc "One write path"; rule 1): the only input `apply()` will ever accept.
// Every adapter вЂ” manual editor, spreadsheet import, barsy pull вЂ” produces one. Every field write
// carries its layer, and the set carries its source and job (rule 2: provenance, NOT NULL).

import { z } from 'zod'

import { FIELD_KEY_PATTERN } from './field-definition'
import { idSchema, isId } from './ids'
import { NodeStatusSchema, type NodeType, NodeTypeSchema } from './node-types'
import { type Parsed, reject } from './result'
import { SortKeySchema } from './sort-keys'

/** Names inside sources, layers and links: profile names, integration ids, edition ids. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

/** Where a change set came from: `manual`, `import:<profile>` or `barsy:<integration>`. */
export type Source = 'manual' | `import:${string}` | `barsy:${string}`

/** True if `value` is a well-formed `Source`. */
export function isSource(value: unknown): value is Source {
  if (value === 'manual') return true
  if (typeof value !== 'string') return false
  const match = /^(import|barsy):(.+)$/.exec(value)
  return match !== null && NAME_PATTERN.test(match[2] ?? '')
}

/** Zod schema for a `Source`. */
export const SourceSchema = z.custom<Source>(isSource, {
  message: 'expected manual, import:<profile> or barsy:<integration>',
})

/**
 * A layer of field values, lowest to highest: `barsy`, `import`, `manual`, `override`,
 * `edition:<id>` (venue and service-period editions). Higher does not automatically win.
 */
export type Layer = 'barsy' | 'import' | 'manual' | 'override' | `edition:${string}`

/** True if `value` is a well-formed `Layer`. */
export function isLayer(value: unknown): value is Layer {
  if (value === 'barsy' || value === 'import' || value === 'manual' || value === 'override') {
    return true
  }
  return typeof value === 'string' && isEditionLayer(value)
}

/** True if `layer` is an edition layer (`edition:<id>`). */
export function isEditionLayer(layer: string): layer is `edition:${string}` {
  const match = /^edition:(.+)$/.exec(layer)
  return match !== null && NAME_PATTERN.test(match[1] ?? '')
}

/** Zod schema for a `Layer`. */
export const LayerSchema = z.custom<Layer>(isLayer, {
  message: 'expected barsy, import, manual, override or edition:<id>',
})

/** Which venues a value applies to: all (`master`) or one (`venue:vn_вЂ¦`, barsy values only). */
export type Scope = 'master' | `venue:${string}`

/** True if `value` is a well-formed `Scope`; a venue scope names our venue id, never a barsy id. */
export function isScope(value: unknown): value is Scope {
  if (value === 'master') return true
  return typeof value === 'string' && value.startsWith('venue:') && isId('vn', value.slice(6))
}

/** Zod schema for a `Scope`. */
export const ScopeSchema = z.custom<Scope>(isScope, { message: 'expected master or venue:vn_вЂ¦' })

/**
 * Who made the change: `user:<id>`, `integration:<id>` or `system`. Never personal data such as
 * an email address.
 */
export type Actor = 'system' | `user:${string}` | `integration:${string}`

/** True if `value` is a well-formed `Actor`. */
export function isActor(value: unknown): value is Actor {
  if (value === 'system') return true
  if (typeof value !== 'string') return false
  const match = /^(user|integration):(.+)$/.exec(value)
  return match !== null && NAME_PATTERN.test(match[2] ?? '')
}

/** Zod schema for an `Actor`. */
export const ActorSchema = z.custom<Actor>(isActor, {
  message: 'expected user:<id>, integration:<id> or system',
})

/** Key of a source link (doc "Identity and linking"): which external object a node mirrors. */
export const SourceLinkSchema = z.strictObject({
  integration: z.string().regex(NAME_PATTERN),
  externalType: z.string().regex(NAME_PATTERN),
  externalId: z.string().min(1).max(128),
})

/** A source link key: (integration, external type, external id). */
export type SourceLink = z.output<typeof SourceLinkSchema>

const NodeIdRefSchema = z.strictObject({ id: idSchema('nd') })

/**
 * How an op names a node: by our id, or by a source link that `apply()` resolves (creating the
 * node and link when it is new). Link refs never leave the backend (rule 3).
 */
export const NodeRefSchema = z.union([NodeIdRefSchema, z.strictObject({ link: SourceLinkSchema })])

/** A reference to a node by id or by source link. */
export type NodeRef = z.output<typeof NodeRefSchema>

/**
 * The job a change set belongs to: a pull or import names its `jb_` job run; a manual save, which
 * has no job run, names its own job (any safe name). Kept loose until the composer settles it.
 */
const JobIdSchema = z.string().regex(NAME_PATTERN, 'expected a job id')

/**
 * One typed field write. `basis` (the source value an override replaces) is required on the
 * `override` layer and nowhere else; `venue:` scope only on the `barsy` layer (per-venue barsy
 * values such as price and for-sale); barsy writes carry their source record and mapping version.
 */
export const FieldWriteSchema = z
  .strictObject({
    op: z.literal('setField'),
    node: NodeRefSchema,
    fieldKey: z.string().regex(FIELD_KEY_PATTERN, 'field keys are snake_case'),
    layer: LayerSchema,
    scope: ScopeSchema,
    value: z.json(),
    sourceRecordId: z.string().min(1).max(256).optional(),
    mappingVersion: z.int().positive().optional(),
    basis: z.json().optional(),
  })
  .superRefine((write, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] })
    if (write.layer === 'override' && (write.basis === undefined || write.basis === null)) {
      issue('an override records the source value it replaces (basis)', 'basis')
    }
    if (write.layer !== 'override' && write.basis !== undefined) {
      issue('only override writes carry a basis', 'basis')
    }
    if (write.scope !== 'master' && write.layer !== 'barsy') {
      issue('only barsy values are venue-scoped; editions use edition layers', 'scope')
    }
    if (write.layer === 'barsy' && write.sourceRecordId === undefined) {
      issue('barsy writes name their source record', 'sourceRecordId')
    }
    if (write.layer === 'barsy' && write.mappingVersion === undefined) {
      issue('barsy writes record their mapping version', 'mappingVersion')
    }
  })

/** One typed field write with provenance. */
export type FieldWrite = z.output<typeof FieldWriteSchema>

/**
 * Where a placement or a new sibling goes: a fractional sort key (the composer computes it
 * between two neighbours), or the position hint `'end'`, which `apply()` turns into a key after
 * the current last one. `'end'` never moves an item that is already in the section. Adapters
 * (barsy, import) only ever send `'end'`: they never compute sort keys themselves.
 */
export const PlacementPositionSchema = z.union([SortKeySchema, z.literal('end')])

/** A sort key or the hint `'end'`. */
export type PlacementPosition = z.output<typeof PlacementPositionSchema>

/**
 * Creates a node with a pre-generated id, so later ops in the same set can name it. Menus and
 * items have no parent (items appear in sections through placements); every other type has one,
 * and a place among its siblings: `sortKey`, a fractional key or `'end'` (the default: after the
 * current last sibling). `apply()` checks the parent's type and depth with `canNest`.
 */
export const CreateNodeSchema = z
  .strictObject({
    op: z.literal('createNode'),
    id: idSchema('nd'),
    nodeType: NodeTypeSchema,
    parent: NodeRefSchema.nullable(),
    status: z.enum(['active', 'hidden']),
    sortKey: PlacementPositionSchema.optional(),
  })
  .superRefine((op, ctx) => {
    const rootless: readonly NodeType[] = ['menu', 'item']
    if (rootless.includes(op.nodeType) && op.parent !== null) {
      ctx.addIssue({ code: 'custom', message: `a ${op.nodeType} has no parent`, path: ['parent'] })
    }
    if (!rootless.includes(op.nodeType) && op.parent === null) {
      ctx.addIssue({ code: 'custom', message: `a ${op.nodeType} needs a parent`, path: ['parent'] })
    }
    if (rootless.includes(op.nodeType) && op.sortKey !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `a ${op.nodeType} has no siblings to sort among (items sort by placement)`,
        path: ['sortKey'],
      })
    }
  })

/** Places an item in a section at a sort position (one row; moving rewrites only this row). */
export const SetPlacementSchema = z.strictObject({
  op: z.literal('setPlacement'),
  item: NodeRefSchema,
  section: NodeRefSchema,
  sortKey: PlacementPositionSchema,
})

/** Removes an item's placement from a section (the item itself stays). */
export const RemovePlacementSchema = z.strictObject({
  op: z.literal('removePlacement'),
  item: NodeRefSchema,
  section: NodeRefSchema,
})

/** Sets a node's lifecycle status. */
export const SetNodeStatusSchema = z.strictObject({
  op: z.literal('setNodeStatus'),
  node: NodeRefSchema,
  status: NodeStatusSchema,
})

/** Links a node to an external object (one link per source per node). */
export const LinkSourceSchema = z.strictObject({
  op: z.literal('linkSource'),
  node: NodeIdRefSchema,
  link: SourceLinkSchema,
})

/** Removes a node's link to an external object. */
export const UnlinkSourceSchema = z.strictObject({
  op: z.literal('unlinkSource'),
  node: NodeIdRefSchema,
  link: SourceLinkSchema,
})

/**
 * Removes the value of one field in one layer and scope, so the layers below show through:
 * revert an override, take barsy's value instead of ours, undo a builder hide. Same layer and
 * scope rules as a write; clearing a slot that holds nothing changes nothing.
 */
export const ClearFieldSchema = z
  .strictObject({
    op: z.literal('clearField'),
    node: NodeRefSchema,
    fieldKey: z.string().regex(FIELD_KEY_PATTERN, 'field keys are snake_case'),
    layer: LayerSchema,
    scope: ScopeSchema,
  })
  .superRefine((clear, ctx) => {
    if (clear.scope !== 'master' && clear.layer !== 'barsy') {
      ctx.addIssue({
        code: 'custom',
        message: 'only barsy values are venue-scoped; editions use edition layers',
        path: ['scope'],
      })
    }
  })

/** A field clear. */
export type ClearField = z.output<typeof ClearFieldSchema>

/** Any structural op: node creation, placements, status, source links. */
export const StructuralOpSchema = z.discriminatedUnion('op', [
  CreateNodeSchema,
  SetPlacementSchema,
  RemovePlacementSchema,
  SetNodeStatusSchema,
  LinkSourceSchema,
  UnlinkSourceSchema,
])

/** A structural op. */
export type StructuralOp = z.output<typeof StructuralOpSchema>

/** Any op in a change set: a field write, a field clear or a structural op. */
export const ChangeSetOpSchema = z.discriminatedUnion('op', [
  FieldWriteSchema,
  ClearFieldSchema,
  CreateNodeSchema,
  SetPlacementSchema,
  RemovePlacementSchema,
  SetNodeStatusSchema,
  LinkSourceSchema,
  UnlinkSourceSchema,
])

/** One op of a change set. */
export type ChangeSetOp = z.output<typeof ChangeSetOpSchema>

/** The layers each kind of source may write: barsy в†’ barsy, import в†’ import, manual в†’ the rest. */
export function layerAllowedForSource(source: Source, layer: Layer): boolean {
  if (source.startsWith('barsy:')) return layer === 'barsy'
  if (source.startsWith('import:')) return layer === 'import'
  return layer === 'manual' || layer === 'override' || isEditionLayer(layer)
}

/** Every node reference in one op (the node it acts on, a parent, an item and its section). */
export function nodeRefsOf(op: ChangeSetOp): NodeRef[] {
  switch (op.op) {
    case 'setField':
    case 'clearField':
    case 'setNodeStatus':
    case 'linkSource':
    case 'unlinkSource':
      return [op.node]
    case 'createNode':
      return op.parent === null ? [] : [op.parent]
    case 'setPlacement':
    case 'removePlacement':
      return [op.item, op.section]
  }
}

/**
 * The change set: id, source, job, actor, when the source observed the data, and its ops, applied
 * atomically. Cross-checks: each write's and clear's layer matches the source; manual sets name
 * nodes by id; a barsy set only touches links of its own integration; adapters place items only
 * with `'end'`; created ids are unique.
 */
export const ChangeSetSchema = z
  .strictObject({
    id: idSchema('cs'),
    source: SourceSchema,
    jobId: JobIdSchema,
    actor: ActorSchema,
    observedAt: z.iso.datetime({ offset: true }),
    ops: z.array(ChangeSetOpSchema).min(1),
  })
  .superRefine((set, ctx) => {
    const barsyIntegration = set.source.startsWith('barsy:') ? set.source.slice(6) : null
    const created = new Set<string>()
    set.ops.forEach((op, index) => {
      const issue = (message: string) =>
        ctx.addIssue({ code: 'custom', message, path: ['ops', index] })
      if (op.op === 'setField' && !layerAllowedForSource(set.source, op.layer)) {
        issue(`a ${set.source} change set cannot write the ${op.layer} layer`)
      }
      if (op.op === 'clearField' && !layerAllowedForSource(set.source, op.layer)) {
        issue(`a ${set.source} change set cannot clear the ${op.layer} layer`)
      }
      const ownSortKey =
        (op.op === 'setPlacement' || op.op === 'createNode') &&
        op.sortKey !== undefined &&
        op.sortKey !== 'end'
      if (ownSortKey && set.source !== 'manual') {
        issue(`a ${set.source} change set places nodes with 'end', never with its own sort key`)
      }
      for (const ref of nodeRefsOf(op)) {
        if (!('link' in ref)) continue
        if (set.source === 'manual') issue('manual change sets name nodes by id')
        if (barsyIntegration !== null && ref.link.integration !== barsyIntegration) {
          issue(`a ${set.source} change set cannot name nodes of another integration`)
        }
      }
      if (
        (op.op === 'linkSource' || op.op === 'unlinkSource') &&
        barsyIntegration !== null &&
        op.link.integration !== barsyIntegration
      ) {
        issue(`a ${set.source} change set cannot link another integration`)
      }
      if (op.op === 'createNode') {
        if (created.has(op.id)) issue(`node ${op.id} is created twice`)
        created.add(op.id)
      }
    })
  })

/** A change set. */
export type ChangeSet = z.output<typeof ChangeSetSchema>

/** Parses a change set; the reason lists every rejected part. */
export function parseChangeSet(json: unknown): Parsed<ChangeSet> {
  const parsed = ChangeSetSchema.safeParse(json)
  if (parsed.success) return { ok: true, value: parsed.data }
  return reject('invalid_change_set', z.prettifyError(parsed.error))
}
