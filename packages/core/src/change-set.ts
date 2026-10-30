// The change set (doc "One write path"; rule 1): the only input `apply()` will ever accept.
// Every adapter — the manual editor, a till connector's pull — produces one. Every field write
// carries its layer, and the set carries its source and job (rule 2: provenance, NOT NULL).
//
// The till is a role, not a vendor (brief CF-03): whichever connector feeds a venue's till writes
// the `till` layer under the source `till:<integration>`; the vendor is only the integration's
// kind (`connectors/`).

import { z } from 'zod'

import { DesignContentSchema } from './design/record'
import { FIELD_KEY_PATTERN } from './field-definition'
import { idSchema, isId } from './ids'
import { NodeStatusSchema, type NodeType, NodeTypeSchema } from './node-types'
import { type Parsed, reject } from './result'
import { SortKeySchema } from './sort-keys'

/** Names inside sources, layers and links: integration ids, edition ids. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

/** The prefix of a till source: `till:<integration>`. */
export const TILL_SOURCE_PREFIX = 'till:'

/**
 * Where a change set came from: `manual` (a person) or `till:<integration>` (the connector that
 * feeds a venue's till: the authority for price, sale and existence).
 */
export type Source = 'manual' | `till:${string}`

/** True if `value` is a well-formed `Source`. */
export function isSource(value: unknown): value is Source {
  if (value === 'manual') return true
  if (typeof value !== 'string') return false
  const match = /^till:(.+)$/.exec(value)
  return match !== null && NAME_PATTERN.test(match[1] ?? '')
}

/** Zod schema for a `Source`. */
export const SourceSchema = z.custom<Source>(isSource, {
  message: 'expected manual or till:<integration>',
})

/** True if `source` is a till source (`till:<integration>`). */
export function isTillSource(source: string): source is `till:${string}` {
  return source.startsWith(TILL_SOURCE_PREFIX)
}

/** The till source of an integration: `till:<integration>`. */
export function tillSource(integrationId: string): `till:${string}` {
  return `${TILL_SOURCE_PREFIX}${integrationId}`
}

/** The integration a till source names, or null for any other source. */
export function tillIntegrationOf(source: string): string | null {
  return isTillSource(source) ? source.slice(TILL_SOURCE_PREFIX.length) : null
}

/**
 * A layer of field values, lowest to highest: `till`, `manual`, `override`, `edition:<id>` (venue
 * and service-period editions). Higher does not automatically win.
 */
export type Layer = 'till' | 'manual' | 'override' | `edition:${string}`

/** True if `value` is a well-formed `Layer`. */
export function isLayer(value: unknown): value is Layer {
  if (value === 'till' || value === 'manual' || value === 'override') return true
  return typeof value === 'string' && isEditionLayer(value)
}

/** True if `layer` is an edition layer (`edition:<id>`). */
export function isEditionLayer(layer: string): layer is `edition:${string}` {
  const match = /^edition:(.+)$/.exec(layer)
  return match !== null && NAME_PATTERN.test(match[1] ?? '')
}

/** Zod schema for a `Layer`. */
export const LayerSchema = z.custom<Layer>(isLayer, {
  message: 'expected till, manual, override or edition:<id>',
})

/** Which venues a value applies to: all (`master`) or one (`venue:vn_…`, till values only). */
export type Scope = 'master' | `venue:${string}`

/** True if `value` is a well-formed `Scope`; a venue scope names our venue id, never a till's. */
export function isScope(value: unknown): value is Scope {
  if (value === 'master') return true
  return typeof value === 'string' && value.startsWith('venue:') && isId('vn', value.slice(6))
}

/** Zod schema for a `Scope`. */
export const ScopeSchema = z.custom<Scope>(isScope, { message: 'expected master or venue:vn_…' })

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
 * The job a change set belongs to: a pull names its `jb_` job run; a manual save, which has no
 * job run, names its own job (any safe name). Kept loose until the composer settles it.
 */
const JobIdSchema = z.string().regex(NAME_PATTERN, 'expected a job id')

/**
 * One typed field write. `basis` (the source value an override replaces) is required on the
 * `override` layer and nowhere else; `venue:` scope only on the `till` layer (per-venue till
 * values such as price and for-sale); till writes carry their source record and mapping version.
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
    if (write.scope !== 'master' && write.layer !== 'till') {
      issue('only till values are venue-scoped; editions use edition layers', 'scope')
    }
    if (write.layer === 'till' && write.sourceRecordId === undefined) {
      issue('till writes name their source record', 'sourceRecordId')
    }
    if (write.layer === 'till' && write.mappingVersion === undefined) {
      issue('till writes record their mapping version', 'mappingVersion')
    }
  })

/** One typed field write with provenance. */
export type FieldWrite = z.output<typeof FieldWriteSchema>

/**
 * Where a placement or a new sibling goes: a fractional sort key (the composer computes it
 * between two neighbours), or the position hint `'end'`, which `apply()` turns into a key after
 * the current last one. `'end'` never moves an item that is already in the section. Adapters
 * (till connectors) only ever send `'end'`: they never compute sort keys themselves.
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

/**
 * Places an item in a section at a sort position (one row; moving rewrites only this row).
 *
 * `onlyIfUnplaced` (default false) is for adapters that mirror a source's categories (a till
 * connector): the placement is skipped (counted as `skipped`) when the item already had a
 * placement in a section of the same menu before this change set started, so a re-sync never
 * re-adds an item the manager moved and never reorders their arrangement (D20: a new item lands
 * at the end of its section). Placements made earlier in the same change set do not count, so a
 * new item still reaches every section its source categories map to. Known edge: an item the
 * manager took out of every section counts as unplaced, so the next sync places it again.
 */
export const SetPlacementSchema = z.strictObject({
  op: z.literal('setPlacement'),
  item: NodeRefSchema,
  section: NodeRefSchema,
  sortKey: PlacementPositionSchema,
  onlyIfUnplaced: z.boolean().optional(),
})

/** Removes an item's placement from a section (the item itself stays). */
export const RemovePlacementSchema = z.strictObject({
  op: z.literal('removePlacement'),
  item: NodeRefSchema,
  section: NodeRefSchema,
})

/**
 * Moves a node among its siblings, or under another parent: a section may change parent (the menu
 * or another section; `apply()` keeps sections at most 3 deep and out of their own subtree) and
 * position; a modifier group or option only changes position among its siblings. `sortKey` is a
 * fractional key between two neighbours or the hint `'end'` (after the current last sibling; a
 * node already under that parent stays put). Only a person moves nodes: adapters create nodes
 * and never reorder the builder's composition.
 */
export const MoveNodeSchema = z.strictObject({
  op: z.literal('moveNode'),
  node: NodeRefSchema,
  parent: NodeRefSchema,
  sortKey: PlacementPositionSchema,
})

/** Sets a node's lifecycle status. */
export const SetNodeStatusSchema = z.strictObject({
  op: z.literal('setNodeStatus'),
  node: NodeRefSchema,
  status: NodeStatusSchema,
})

/** Links a node to an external object (at most one till link per node). */
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

/** The states of a source link (doc "Link lifecycle"). */
export const LINK_STATES = ['active', 'missing', 'deleted'] as const

/** `active`, `missing` (absent from a complete full pull) or `deleted` (gone in the source). */
export type LinkStateName = (typeof LINK_STATES)[number]

/**
 * The Link lifecycle (doc "Link lifecycle"): the states each state may move to. Staying in the
 * same state is not a move. `deleted` → `missing` has no row: a deleted object stays deleted
 * until it is seen again.
 */
export const LINK_TRANSITIONS: { readonly [From in LinkStateName]: readonly LinkStateName[] } = {
  active: ['missing', 'deleted'],
  missing: ['deleted', 'active'],
  deleted: ['active'],
}

/**
 * Moves a source link through its lifecycle (doc "Link lifecycle"): `active` → `missing` when a
 * complete full pull no longer has the object, `active`/`missing` → `deleted` (the till says the
 * object is deleted, or missing for 7 days), `missing`/`deleted` → `active` when it is seen again.
 * Only the link's own source sends it. A state change never touches field values, overrides or
 * placements (the enrichment is kept, rule 6); hiding is the resolver's job.
 *
 * `seenAt` (with an optional content `hash`) records that this pull saw the object: `apply()`
 * moves `last_seen_at` / `last_hash` forward, never back, so a sync marks "seen" through the one
 * write path and an older observation never overwrites a newer one.
 */
export const SetLinkStateSchema = z
  .strictObject({
    op: z.literal('setLinkState'),
    link: SourceLinkSchema,
    state: z.enum(LINK_STATES),
    seenAt: z.iso.datetime({ offset: true }).optional(),
    hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'a content hash is SHA-256 in lower-case hex')
      .optional(),
  })
  .superRefine((op, ctx) => {
    if (op.hash !== undefined && op.seenAt === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'a content hash comes with the time it was seen (seenAt)',
        path: ['hash'],
      })
    }
  })

/** A link-state change. */
export type SetLinkState = z.output<typeof SetLinkStateSchema>

/**
 * Removes the value of one field in one layer and scope, so the layers below show through:
 * revert an override, take the till's value instead of ours, undo a builder hide. Same layer and
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
    if (clear.scope !== 'master' && clear.layer !== 'till') {
      ctx.addIssue({
        code: 'custom',
        message: 'only till values are venue-scoped; editions use edition layers',
        path: ['scope'],
      })
    }
  })

/** A field clear. */
export type ClearField = z.output<typeof ClearFieldSchema>

/**
 * Saves a venue's whole design record (D129) over the revision the editor started from. Manual
 * only: a design is the venue's own, never a till's. `apply()` refuses a stale revision with the
 * stored record (`stale_revision`), a design whose colours do not read (`unreadable`) and a logo
 * that is not a stored image (`logo_not_usable`); a save that changes nothing is `unchanged`. It
 * names a venue, not a node: its event has no node and the venue's scope.
 */
export const SetDesignSchema = z.strictObject({
  op: z.literal('setDesign'),
  venueId: idSchema('vn'),
  /** The revision the editor loaded: 0 for a venue with no record yet. */
  expectedRevision: z.int().min(0),
  design: DesignContentSchema,
})

/** A design save. */
export type SetDesign = z.output<typeof SetDesignSchema>

/** Any structural op: node creation, placements, status, source links and their state. */
export const StructuralOpSchema = z.discriminatedUnion('op', [
  CreateNodeSchema,
  SetPlacementSchema,
  RemovePlacementSchema,
  MoveNodeSchema,
  SetNodeStatusSchema,
  LinkSourceSchema,
  UnlinkSourceSchema,
  SetLinkStateSchema,
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
  MoveNodeSchema,
  SetNodeStatusSchema,
  LinkSourceSchema,
  UnlinkSourceSchema,
  SetLinkStateSchema,
  SetDesignSchema,
])

/** One op of a change set. */
export type ChangeSetOp = z.output<typeof ChangeSetOpSchema>

/** The name of an op kind (`setField`, `moveNode`, ...); `events.op` holds one of them. */
export type ChangeSetOpName = ChangeSetOp['op']

/** Every op name: the values `events.op` may hold (a database check mirrors this list). */
export const CHANGE_SET_OP_NAMES = [
  'setField',
  'clearField',
  'createNode',
  'setPlacement',
  'removePlacement',
  'moveNode',
  'setNodeStatus',
  'linkSource',
  'unlinkSource',
  'setLinkState',
  'setDesign',
] as const satisfies readonly ChangeSetOpName[]

/** The layers each kind of source may write: a till → `till`, manual → the rest. */
export function layerAllowedForSource(source: Source, layer: Layer): boolean {
  if (isTillSource(source)) return layer === 'till'
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
    case 'moveNode':
      return [op.node, op.parent]
    case 'setLinkState':
      // Names a link, not a node: apply() finds the node through the link.
      return []
    case 'setDesign':
      // Names a venue, not a node.
      return []
  }
}

/**
 * The change set: id, source, job, actor, when the source observed the data, and its ops, applied
 * atomically. Cross-checks: each write's and clear's layer matches the source; manual sets name
 * nodes by id; only a manual set saves a design; a till set only touches links of its own integration; adapters place items only
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
    const tillIntegration = tillIntegrationOf(set.source)
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
        (op.op === 'setPlacement' || op.op === 'createNode' || op.op === 'moveNode') &&
        op.sortKey !== undefined &&
        op.sortKey !== 'end'
      if (ownSortKey && set.source !== 'manual') {
        issue(`a ${set.source} change set places nodes with 'end', never with its own sort key`)
      }
      for (const ref of nodeRefsOf(op)) {
        if (!('link' in ref)) continue
        if (set.source === 'manual') issue('manual change sets name nodes by id')
        if (tillIntegration !== null && ref.link.integration !== tillIntegration) {
          issue(`a ${set.source} change set cannot name nodes of another integration`)
        }
      }
      if (
        (op.op === 'linkSource' || op.op === 'unlinkSource' || op.op === 'setLinkState') &&
        tillIntegration !== null &&
        op.link.integration !== tillIntegration
      ) {
        issue(`a ${set.source} change set cannot link another integration`)
      }
      if (op.op === 'setDesign' && set.source !== 'manual') {
        issue(`a ${set.source} change set cannot save a design`)
      }
      if (op.op === 'setDesign' && set.actor.startsWith('integration:')) {
        issue('an integration cannot save a design: a member or the system does')
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
