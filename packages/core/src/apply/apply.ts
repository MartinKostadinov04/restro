// apply(): the one write path (rule 1; doc "The internal data source" → "One write path"). Every
// collection path (a till connector's sync, the composer) hands a change set to this function,
// and nothing else writes nodes, placements, field_values, source_links or events.
//
// The till is a role (brief CF-03): every integration feeds a till, writes the `till` layer under
// the source `till:<integration>`, and may link a node only through the link types its connector
// kind declares (`TILL_LINK_TYPES`). A node has at most one till link.
//
// One transaction per change set, under the tenant's document lock (./lock.ts):
//   1. read, in a few batched queries, everything the ops refer to: the nodes (with their
//      ancestors), their links and field values, the placements of the sections named, the
//      source records cited, the tenant's integrations and venues;
//   2. decide every op in order, in memory: validate each write against its field definition and
//      the node's context, resolve identity through source_links (a createNode + linkSource pair
//      whose link already exists collapses onto the linked node), skip writes whose value hash
//      equals the stored one, compute 'end' sort keys;
//   3. write the result: new nodes, statuses, links and their lifecycle (setLinkState),
//      placements, field values (upserts and deletions), one events row per changed value, and
//      one revision step per touched node.
// Each op ends applied, unchanged (a no-op) or rejected with a reason; a rejected op changes
// nothing, except that an invalid value (V1/V2) is kept as a `valid = false` row when its slot
// has no good value to protect (doc: "Invalid writes are kept as rejected rows with a reason;
// they never replace the last good value"). A caller whose ops only make sense together (the
// composer's "move an item": place it there, take it out of here) passes `atomic: true`: then a
// single rejected op refuses the whole change set and nothing is written. Doc step 5 (mark menus
// dirty, queue a resolve) comes with the jobs of S2-06.
//
// The changelog (`events`) records every applied change, not only field values: a new node, a
// status change, a placement, a removal, a move and a link each append one row whose `op` says
// what kind of change it is (see the `events` table in @restro/db).

import {
  type DbPool,
  events,
  fieldValues,
  integrations,
  nodes,
  placements,
  sourceLinks,
  sourceRecords,
  tags,
  venues,
} from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import {
  type ChangeSet,
  type ChangeSetOp,
  type ChangeSetOpName,
  type ClearField,
  type FieldWrite,
  type Layer,
  LINK_TRANSITIONS,
  type LinkStateName,
  type NodeRef,
  nodeRefsOf,
  parseChangeSet,
  type Scope,
  type SetLinkState,
  type SourceLink,
  tillIntegrationOf,
  tillSource,
} from '../change-set'
import {
  isIntegrationKind,
  TILL_LINK_TYPES,
  type TillLinkTypes,
  tillLinkTypeProblem,
} from '../connectors'
import { FIELD_TYPES, type FieldTypeSpec } from '../field-types/specs'
import { canonicalJson, sha256Hex } from '../hash'
import type { NodeId } from '../ids'
import { canNest, MAX_SECTION_DEPTH, type NodeStatus, type NodeType } from '../node-types'
import type { RejectionCode } from '../result'
import { sortKeyBetween } from '../sort-keys'
import { findField, type Template } from '../template'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { validateWrite } from '../validate-write'
import { lockTenantDocument } from './lock'
import { unlinkCopy } from './unlink'

/** Why one op of a change set was refused. */
export type ApplyRejectionCode =
  /** From `validateWrite`: V1, V2, unknown_node_type, unknown_field, layer_not_allowed, … */
  | RejectionCode
  /** The op names a node by an id or a link that does not exist. */
  | 'unknown_node'
  /** A `venue:` scope names a venue the tenant does not have. */
  | 'unknown_venue'
  /** A till write cites a source record that does not exist or belongs to another integration. */
  | 'unknown_source_record'
  /** A link names an integration the tenant does not have. */
  | 'unknown_integration'
  /**
   * The parent cannot hold this node type at this depth (`canNest`); a moved section would land
   * in its own subtree, in another menu, or push its sub-sections below depth 3; a modifier
   * group or option was moved to another parent.
   */
  | 'invalid_parent'
  /** moveNode of something that is not moved this way (a menu, an item, a special). */
  | 'invalid_move'
  /** createNode with an id that exists as another type or under another parent. */
  | 'id_conflict'
  /** A placement of something that is not an item, or into something that is not a section. */
  | 'invalid_placement'
  /** The external object is linked to another node. */
  | 'link_taken'
  /** The node already has a till link, from this integration or another (one till link per node). */
  | 'already_linked'
  /**
   * A link whose external type does not fit the node type for its connector kind
   * (`TILL_LINK_TYPES`), or whose connector kind declares no link types at all.
   */
  | 'invalid_link_type'
  /** This source may not do this (unlink from an adapter, create a menu, link another source). */
  | 'source_not_allowed'
  /** setLinkState names a link that does not exist (never linked, or unlinked). */
  | 'unknown_link'
  /** setLinkState asks for a move the Link lifecycle has no row for (`deleted` → `missing`). */
  | 'invalid_transition'
  /**
   * A `tags` value names a tag id that is not a tag of the venue the item belongs to, or is
   * archived. An id the stored value already holds may stay (restoring an archived tag brings
   * its assignments back); only an id the write adds is checked.
   */
  | 'unknown_tag'

/** One refused op: its index in `changeSet.ops`, a code and a reason for people. */
export interface ApplyRejection {
  readonly opIndex: number
  readonly code: ApplyRejectionCode
  readonly reason: string
  /**
   * Our id (`nd_…`) of the node the op was about, when it names one that exists: by id, or by a
   * source link that resolves. Never an external id (rule 3). The sync copies it into `job_runs`.
   */
  readonly nodeRef?: string
  /** The field the op was about (`setField`, `clearField`). */
  readonly fieldKey?: string
}

/**
 * What `apply` did. Every op is counted once: `applied + unchanged + skipped + rejected.length`
 * equals the number of ops.
 */
export interface ApplyResult {
  /** Ops that changed something. */
  readonly applied: number
  /**
   * Ops that were no-ops (same value hash, existing node or link, placement already there, a
   * link already in that state). A setLinkState that only records `seenAt` / `hash` counts here:
   * the document did not change.
   */
  readonly unchanged: number
  /**
   * `setPlacement` ops with `onlyIfUnplaced` left out because the item already had a placement
   * in that menu before this change set (the manager's arrangement wins).
   */
  readonly skipped: number
  readonly rejected: readonly ApplyRejection[]
  /** Nodes this change set created (a createNode resolved onto a linked node is not one). */
  readonly createdNodeIds: readonly NodeId[]
  /**
   * Rows appended to `events`: one per applied change (a field value set or cleared, a node
   * created, a status change, a placement, a removal, a move, a link, an unlink or a link-state
   * change).
   */
  readonly eventsWritten: number
}

/** Options of `apply`. */
export interface ApplyOptions {
  /** The template field writes are validated against. Default: `VENUE_MENU_TEMPLATE`. */
  readonly template?: Template
  /**
   * The link types each connector kind declares, which every `linkSource` is checked against.
   * Default: `TILL_LINK_TYPES`. Tests pass their own map to prove no kind is special.
   */
  readonly tillLinkTypes?: TillLinkTypes
  /**
   * All or nothing: if any op is rejected the whole change set is refused with an `ApplyError`
   * (`change_set_rejected`, the rejections in `error.rejected`) and nothing is written. For
   * changes whose ops belong together, such as a person's drag in the composer. Default: false
   * (the applied ops commit, the rejected ones are reported, as a sync needs).
   */
  readonly atomic?: boolean
}

/** Why a whole change set (or a document read) was refused; nothing was written. */
export type ApplyErrorCode =
  /** The change set does not parse (`parseChangeSet`). */
  | 'invalid_change_set'
  /** A till change set names an integration the tenant does not have. */
  | 'unknown_integration'
  /** `loadMenuDocument`: the tenant has no menu with this id. */
  | 'menu_not_found'
  /** `atomic` apply: at least one op was rejected, so none was applied. */
  | 'change_set_rejected'

/** Thrown when a change set is refused as a whole, or a document cannot be read. */
export class ApplyError extends Error {
  override name = 'ApplyError'
  readonly code: ApplyErrorCode
  /** `change_set_rejected` only: every rejected op. */
  readonly rejected: readonly ApplyRejection[]

  constructor(code: ApplyErrorCode, message: string, rejected: readonly ApplyRejection[] = []) {
    super(message)
    this.code = code
    this.rejected = rejected
  }
}

type LinkLifecycle = LinkStateName

interface NodeState {
  readonly id: NodeId
  readonly type: NodeType
  /** Changed by moveNode (sections move; groups and options only change `sortKey`). */
  parentId: NodeId | null
  sortKey: string | null
  status: NodeStatus
}

/**
 * A source link as this change set sees it. Never changed in place: a change replaces the object
 * in `DocumentState.links`, so `originalLinks` keeps what was read.
 */
interface LinkState {
  readonly integrationId: string
  readonly externalType: string
  readonly externalId: string
  readonly nodeId: NodeId
  readonly state: LinkLifecycle
  /** The stored `last_seen_at`; null for a link this change set creates (it takes `observedAt`). */
  readonly lastSeenAt: Date | null
  readonly lastHash: string | null
}

interface ValueRow {
  readonly nodeId: NodeId
  readonly fieldKey: string
  readonly layer: Layer
  readonly scope: Scope
  readonly value: unknown
  readonly valueHash: string
  readonly source: string
  readonly jobId: string
  readonly actor: string
  readonly observedAt: Date
  readonly sourceRecordId: string | null
  readonly mappingVersion: number | null
  readonly basis: unknown
  readonly valid: boolean
  readonly rejectReason: string | null
}

interface EventRow {
  readonly op: ChangeSetOpName
  readonly nodeId: NodeId
  readonly fieldKey: string
  readonly layer: Layer
  readonly scope: Scope
  readonly oldValue: unknown
  readonly newValue: unknown
}

type Outcome =
  | { readonly kind: 'applied' | 'unchanged' | 'skipped' }
  | { readonly kind: 'rejected'; readonly code: ApplyRejectionCode; readonly reason: string }

const APPLIED: Outcome = { kind: 'applied' }
const UNCHANGED: Outcome = { kind: 'unchanged' }
const SKIPPED: Outcome = { kind: 'skipped' }

function refused(code: ApplyRejectionCode, reason: string): Outcome {
  return { kind: 'rejected', code, reason }
}

function isOutcome(value: NodeState | Outcome): value is Outcome {
  return 'kind' in value
}

const linkKey = (link: Pick<LinkState, 'integrationId' | 'externalType' | 'externalId'>) =>
  JSON.stringify([link.integrationId, link.externalType, link.externalId])
const refKey = (link: SourceLink) =>
  linkKey({
    integrationId: link.integration,
    externalType: link.externalType,
    externalId: link.externalId,
  })
const slotKey = (nodeId: string, fieldKey: string, layer: string, scope: string) =>
  JSON.stringify([nodeId, fieldKey, layer, scope])
const pairKey = (sectionId: string, itemId: string) => JSON.stringify([sectionId, itemId])
const describeLink = (link: SourceLink) =>
  `${link.integration} ${link.externalType} ${link.externalId}`

/** `column = any($1::text[])` with the whole list as one parameter. */
function anyOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} = any(${sql.param([...values])}::text[])`
}

/** Splits rows into batches that stay far below Postgres's 65 535 parameters per statement. */
function batches<T>(rows: readonly T[], size = 500): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

/** The document as far as one change set can see it, and what the change set does to it. */
class DocumentState {
  readonly integrations = new Map<string, { kind: string }>()
  readonly venues = new Set<string>()
  readonly records = new Map<string, string>()
  readonly nodes = new Map<NodeId, NodeState>()
  readonly aliases = new Map<NodeId, NodeId>()
  readonly links = new Map<string, LinkState>()
  readonly originalLinks = new Map<string, LinkState>()
  readonly linksOfNode = new Map<NodeId, Set<string>>()
  readonly values = new Map<string, ValueRow>()
  readonly valuesOfNode = new Map<NodeId, Set<string>>()
  readonly placements = new Map<NodeId, Map<NodeId, string>>()
  readonly originalPlacements = new Map<string, string>()
  /** The greatest sibling sort key under each parent a createNode names (read, then kept up). */
  readonly lastChildKey = new Map<NodeId, string>()
  /** The tags a `tags` write names: the venue each belongs to and whether it is archived. */
  readonly tagRows = new Map<string, { venueId: string; archived: boolean }>()
  /** For each item such a write targets: the venues of the menus it is placed in (maybe none). */
  readonly itemVenues = new Map<NodeId, Set<string>>()

  readonly createdNodes: NodeState[] = []
  /** Where each moved node stood before this change set (the first move records it). */
  readonly movedFrom = new Map<NodeId, { parentId: NodeId | null; sortKey: string | null }>()
  readonly statusChanged = new Set<NodeId>()
  readonly touched = new Set<NodeId>()
  readonly dirtyLinks = new Set<string>()
  /** Links whose state, last seen time or last hash a setLinkState changed. */
  readonly dirtyLinkStates = new Set<string>()
  /** Links whose state moved (their `state_changed_at` becomes the transaction time). */
  readonly linkStateMoved = new Set<string>()
  /**
   * For each item an `onlyIfUnplaced` placement names: the menus (root node ids) it had a
   * placement in before this change set started.
   */
  readonly menusPlacedBefore = new Map<NodeId, Set<NodeId>>()
  readonly dirtyValues = new Set<string>()
  readonly dirtyPlacements = new Map<string, { sectionId: NodeId; itemId: NodeId }>()
  readonly events: EventRow[] = []

  addLink(link: LinkState): void {
    const key = linkKey(link)
    this.links.set(key, link)
    const own = this.linksOfNode.get(link.nodeId) ?? new Set<string>()
    own.add(key)
    this.linksOfNode.set(link.nodeId, own)
  }

  removeLink(key: string): void {
    const link = this.links.get(key)
    if (!link) return
    this.links.delete(key)
    this.linksOfNode.get(link.nodeId)?.delete(key)
  }

  /** The node's link from one integration, if any (in any state). */
  linkOf(nodeId: NodeId, integrationId: string): LinkState | undefined {
    for (const key of this.linksOfNode.get(nodeId) ?? []) {
      const link = this.links.get(key)
      if (link?.integrationId === integrationId) return link
    }
    return undefined
  }

  /** True if the integration feeds a till: a connector kind core knows (`connectors/`). */
  isTill(integrationId: string): boolean {
    return isIntegrationKind(this.integrations.get(integrationId)?.kind)
  }

  /** The node's till link, from any integration, in any state (a node has at most one). */
  tillLinkOf(nodeId: NodeId): LinkState | undefined {
    for (const key of this.linksOfNode.get(nodeId) ?? []) {
      const link = this.links.get(key)
      if (link && this.isTill(link.integrationId)) return link
    }
    return undefined
  }

  /** True if the node has a till link, in any state. */
  hasTillLink(nodeId: NodeId): boolean {
    return this.tillLinkOf(nodeId) !== undefined
  }

  putValue(row: ValueRow): void {
    const key = slotKey(row.nodeId, row.fieldKey, row.layer, row.scope)
    this.values.set(key, row)
    const own = this.valuesOfNode.get(row.nodeId) ?? new Set<string>()
    own.add(key)
    this.valuesOfNode.set(row.nodeId, own)
  }

  deleteValue(key: string): void {
    const row = this.values.get(key)
    if (!row) return
    this.values.delete(key)
    this.valuesOfNode.get(row.nodeId)?.delete(key)
    this.dirtyValues.add(key)
  }

  /** The placements of a section (all of them were read, or the section is new). */
  placementsOf(sectionId: NodeId): Map<NodeId, string> {
    let inSection = this.placements.get(sectionId)
    if (!inSection) {
      inSection = new Map()
      this.placements.set(sectionId, inSection)
    }
    return inSection
  }
}

/** The keys of the template's fields of type `tags` (their values are ids of the venue's tags). */
function tagFieldKeys(template: Template): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const spec of Object.values(template.nodeTypes)) {
    for (const definition of spec?.fields ?? [])
      if (definition.type === 'tags') keys.add(definition.key)
  }
  return keys
}

/** Reads what the change set refers to (step 1). */
async function loadState(tx: WriteTx, set: ChangeSet, template: Template): Promise<DocumentState> {
  const state = new DocumentState()
  const idRefs = new Set<NodeId>()
  const linkRefs = new Map<string, SourceLink>()
  const recordIds = new Set<string>()
  for (const op of set.ops) {
    for (const ref of nodeRefsOf(op)) {
      if ('id' in ref) idRefs.add(ref.id)
      else linkRefs.set(refKey(ref.link), ref.link)
    }
    if (op.op === 'createNode') idRefs.add(op.id)
    if (op.op === 'linkSource' || op.op === 'unlinkSource' || op.op === 'setLinkState') {
      linkRefs.set(refKey(op.link), op.link)
    }
    if (op.op === 'setField' && op.sourceRecordId !== undefined) recordIds.add(op.sourceRecordId)
  }

  for (const row of await tx
    .select({ id: integrations.id, kind: integrations.kind })
    .from(integrations)) {
    state.integrations.set(row.id, { kind: row.kind })
  }
  for (const row of await tx.select({ id: venues.id }).from(venues)) state.venues.add(row.id)
  if (recordIds.size > 0) {
    const rows = await tx
      .select({ id: sourceRecords.id, integrationId: sourceRecords.integrationId })
      .from(sourceRecords)
      .where(anyOf(sourceRecords.id, [...recordIds]))
    for (const row of rows) state.records.set(row.id, row.integrationId)
  }

  const linkColumns = {
    integrationId: sourceLinks.integrationId,
    externalType: sourceLinks.externalType,
    externalId: sourceLinks.externalId,
    nodeId: sourceLinks.nodeId,
    state: sourceLinks.state,
    lastSeenAt: sourceLinks.lastSeenAt,
    lastHash: sourceLinks.lastHash,
  }
  const remember = (
    rows: {
      integrationId: string
      externalType: string
      externalId: string
      nodeId: string
      state: string
      lastSeenAt: Date
      lastHash: string | null
    }[],
  ) => {
    for (const row of rows) {
      const link: LinkState = {
        ...row,
        nodeId: row.nodeId as NodeId,
        state: row.state as LinkLifecycle,
      }
      state.addLink(link)
      state.originalLinks.set(linkKey(link), link)
    }
  }
  if (linkRefs.size > 0) {
    const refs = [...linkRefs.values()]
    remember(
      await tx
        .select(linkColumns)
        .from(sourceLinks)
        .where(
          sql`(${sourceLinks.integrationId}, ${sourceLinks.externalType}, ${sourceLinks.externalId}) in (
            select * from unnest(
              ${sql.param(refs.map((ref) => ref.integration))}::text[],
              ${sql.param(refs.map((ref) => ref.externalType))}::text[],
              ${sql.param(refs.map((ref) => ref.externalId))}::text[]))`,
        ),
    )
    for (const link of state.links.values()) idRefs.add(link.nodeId)
  }

  if (idRefs.size > 0) {
    // The nodes named, and every ancestor (createNode checks a new node's depth).
    const found = await tx.execute<{
      id: string
      node_type: string
      parent_id: string | null
      sort_key: string | null
      status: string
    }>(sql`
      with recursive up as (
        select id, node_type, parent_id, sort_key, status from restro.nodes
        where id = any(${sql.param([...idRefs])}::text[])
        union
        select n.id, n.node_type, n.parent_id, n.sort_key, n.status
        from restro.nodes n join up on n.id = up.parent_id
      )
      select id, node_type, parent_id, sort_key, status from up`)
    for (const row of found.rows) {
      state.nodes.set(row.id as NodeId, {
        id: row.id as NodeId,
        type: row.node_type as NodeType,
        parentId: row.parent_id as NodeId | null,
        sortKey: row.sort_key,
        status: row.status as NodeStatus,
      })
    }
  }
  const nodeIds = [...state.nodes.keys()]
  if (nodeIds.length > 0) {
    remember(
      (await tx.select(linkColumns).from(sourceLinks).where(anyOf(sourceLinks.nodeId, nodeIds)))
        // A link already read by its key is not added twice.
        .filter((row) => !state.originalLinks.has(linkKey(row))),
    )
    const rows = await tx.select().from(fieldValues).where(anyOf(fieldValues.nodeId, nodeIds))
    for (const row of rows) {
      state.putValue({
        nodeId: row.nodeId as NodeId,
        fieldKey: row.fieldKey,
        layer: row.layer as Layer,
        scope: row.scope as Scope,
        value: row.value,
        valueHash: row.valueHash,
        source: row.source,
        jobId: row.jobId,
        actor: row.actor,
        observedAt: row.observedAt,
        sourceRecordId: row.sourceRecordId,
        mappingVersion: row.mappingVersion,
        basis: row.basis,
        valid: row.valid,
        rejectReason: row.rejectReason,
      })
    }
  }

  // The sections below every section a moveNode moves (their depth must still fit after the move).
  const movedIds = new Set<NodeId>()
  for (const op of set.ops) if (op.op === 'moveNode' && 'id' in op.node) movedIds.add(op.node.id)
  if (movedIds.size > 0) {
    const below = await tx.execute<{
      id: string
      node_type: string
      parent_id: string | null
      sort_key: string | null
      status: string
    }>(sql`
      with recursive down as (
        select id, node_type, parent_id, sort_key, status from restro.nodes
        where parent_id = any(${sql.param([...movedIds])}::text[]) and node_type = 'section'
        union
        select n.id, n.node_type, n.parent_id, n.sort_key, n.status
        from restro.nodes n join down d on n.parent_id = d.id where n.node_type = 'section'
      )
      select id, node_type, parent_id, sort_key, status from down`)
    for (const row of below.rows) {
      if (state.nodes.has(row.id as NodeId)) continue
      state.nodes.set(row.id as NodeId, {
        id: row.id as NodeId,
        type: row.node_type as NodeType,
        parentId: row.parent_id as NodeId | null,
        sortKey: row.sort_key,
        status: row.status as NodeStatus,
      })
    }
  }

  // Identity: a createNode whose node is linked (by a linkSource of the same set) to an external
  // object that is already linked collapses onto the existing node, if the type matches.
  const linksByCreatedId = new Map<string, SourceLink[]>()
  for (const op of set.ops) {
    if (op.op === 'linkSource') {
      linksByCreatedId.set(op.node.id, [...(linksByCreatedId.get(op.node.id) ?? []), op.link])
    }
  }
  for (const op of set.ops) {
    if (op.op !== 'createNode' || state.nodes.has(op.id)) continue
    for (const link of linksByCreatedId.get(op.id) ?? []) {
      const existing = state.links.get(refKey(link))
      const target = existing && state.nodes.get(existing.nodeId)
      if (target && target.type === op.nodeType) state.aliases.set(op.id, target.id)
    }
  }

  // The last sibling key under every parent a createNode or moveNode names (so 'end' sees the
  // current last).
  const parentIds = new Set<NodeId>()
  for (const op of set.ops) {
    if (op.op !== 'createNode' && op.op !== 'moveNode') continue
    if (op.parent === null) continue
    const ref = op.parent
    const id =
      'id' in ref
        ? (state.aliases.get(ref.id) ?? ref.id)
        : state.links.get(refKey(ref.link))?.nodeId
    if (id !== undefined && state.nodes.has(id)) parentIds.add(id)
  }
  if (parentIds.size > 0) {
    const found = await tx.execute<{ parent_id: string; last_key: string | null }>(sql`
      select parent_id, max(sort_key) as last_key from restro.nodes
      where parent_id = any(${sql.param([...parentIds])}::text[])
      group by parent_id`)
    for (const row of found.rows) {
      if (row.last_key !== null) state.lastChildKey.set(row.parent_id as NodeId, row.last_key)
    }
  }

  // All placements of every section a placement op names (so 'end' sees the current last).
  const sectionIds = new Set<NodeId>()
  for (const op of set.ops) {
    if (op.op !== 'setPlacement' && op.op !== 'removePlacement') continue
    const ref = op.section
    const id =
      'id' in ref
        ? (state.aliases.get(ref.id) ?? ref.id)
        : state.links.get(refKey(ref.link))?.nodeId
    if (id !== undefined && state.nodes.has(id)) sectionIds.add(id)
  }
  if (sectionIds.size > 0) {
    const rows = await tx
      .select({
        itemId: placements.itemId,
        sectionId: placements.sectionId,
        sortKey: placements.sortKey,
      })
      .from(placements)
      .where(anyOf(placements.sectionId, [...sectionIds]))
    for (const id of sectionIds) state.placementsOf(id)
    for (const row of rows) {
      state.placementsOf(row.sectionId as NodeId).set(row.itemId as NodeId, row.sortKey)
      state.originalPlacements.set(pairKey(row.sectionId, row.itemId), row.sortKey)
    }
  }

  // `onlyIfUnplaced`: the menus each named item was placed in before this change set (every
  // placement of the item, in any section, walked up to its menu). Read once, before any op runs,
  // so placements made by this change set never count.
  const guardedItems = new Set<NodeId>()
  for (const op of set.ops) {
    if (op.op !== 'setPlacement' || op.onlyIfUnplaced !== true) continue
    const ref = op.item
    const id =
      'id' in ref
        ? (state.aliases.get(ref.id) ?? ref.id)
        : state.links.get(refKey(ref.link))?.nodeId
    if (id !== undefined && state.nodes.has(id)) guardedItems.add(id)
  }
  if (guardedItems.size > 0) {
    const found = await tx.execute<{ item_id: string; menu_id: string }>(sql`
      with recursive up as (
        select p.item_id, n.id, n.parent_id
        from restro.placements p join restro.nodes n on n.id = p.section_id
        where p.item_id = any(${sql.param([...guardedItems])}::text[])
        union
        select up.item_id, n.id, n.parent_id
        from up join restro.nodes n on n.id = up.parent_id
      )
      select distinct item_id, id as menu_id from up where parent_id is null`)
    for (const row of found.rows) {
      const menus = state.menusPlacedBefore.get(row.item_id as NodeId) ?? new Set<NodeId>()
      menus.add(row.menu_id as NodeId)
      state.menusPlacedBefore.set(row.item_id as NodeId, menus)
    }
  }

  await loadTagContext(tx, set, state, tagFieldKeys(template))
  return state
}

/**
 * What the `tags` check of `Run.setField` needs: for every tag id a non-till write to a `tags`
 * field names, the tag's venue and whether it is archived; and for every item such a write
 * targets, the venues of the menus the item is placed in (walked up from its sections).
 */
async function loadTagContext(
  tx: WriteTx,
  set: ChangeSet,
  state: DocumentState,
  keys: ReadonlySet<string>,
): Promise<void> {
  if (keys.size === 0) return
  const tagIds = new Set<string>()
  const targets = new Set<NodeId>()
  for (const op of set.ops) {
    if (op.op !== 'setField' || op.layer === 'till' || !keys.has(op.fieldKey)) continue
    if (!Array.isArray(op.value)) continue
    for (const id of op.value) if (typeof id === 'string') tagIds.add(id)
    const ref = op.node
    const nodeId =
      'id' in ref
        ? (state.aliases.get(ref.id) ?? ref.id)
        : state.links.get(refKey(ref.link))?.nodeId
    if (nodeId !== undefined && state.nodes.has(nodeId)) targets.add(nodeId)
  }
  if (tagIds.size > 0) {
    const rows = await tx
      .select({ id: tags.id, venueId: tags.venueId, archivedAt: tags.archivedAt })
      .from(tags)
      .where(anyOf(tags.id, [...tagIds]))
    for (const row of rows) {
      state.tagRows.set(row.id, { venueId: row.venueId, archived: row.archivedAt !== null })
    }
  }
  if (targets.size > 0) {
    for (const id of targets) state.itemVenues.set(id, new Set())
    const found = await tx.execute<{ item_id: string; venue_id: string }>(sql`
      with recursive up as (
        select p.item_id, n.id, n.parent_id
        from restro.placements p join restro.nodes n on n.id = p.section_id
        where p.item_id = any(${sql.param([...targets])}::text[])
        union
        select up.item_id, n.id, n.parent_id
        from up join restro.nodes n on n.id = up.parent_id
      )
      select distinct up.item_id, m.venue_id
      from up join restro.menus m on m.id = up.id
      where up.parent_id is null`)
    for (const row of found.rows) state.itemVenues.get(row.item_id as NodeId)?.add(row.venue_id)
  }
}

/** Decides every op of the change set in order (step 2). */
class Run {
  readonly rejected: ApplyRejection[] = []
  applied = 0
  unchanged = 0
  skipped = 0
  /** The integration of a till change set (`till:<integration>`), or null for a manual one. */
  private readonly tillIntegration: string | null
  /** The layer of the source, which structural events (no field, no layer of their own) carry. */
  private readonly sourceLayer: Layer
  private readonly set: ChangeSet
  private readonly template: Template
  private readonly state: DocumentState
  private readonly tillLinkTypes: TillLinkTypes

  // No parameter properties: the dev seed runs this file under Node's type stripping, which does
  // not support them (it is also the only TypeScript construct here that must be rewritten).
  constructor(
    set: ChangeSet,
    template: Template,
    state: DocumentState,
    tillLinkTypes: TillLinkTypes,
  ) {
    this.set = set
    this.template = template
    this.state = state
    this.tillLinkTypes = tillLinkTypes
    this.tillIntegration = tillIntegrationOf(set.source)
    this.sourceLayer = this.tillIntegration !== null ? 'till' : 'manual'
  }

  processAll(): void {
    this.set.ops.forEach((op, opIndex) => {
      let outcome: Outcome
      switch (op.op) {
        case 'setField':
          outcome = this.setField(op)
          break
        case 'clearField':
          outcome = this.clearField(op)
          break
        case 'createNode':
          outcome = this.createNode(op)
          break
        case 'setPlacement':
          outcome = this.setPlacement(op)
          break
        case 'removePlacement':
          outcome = this.removePlacement(op)
          break
        case 'moveNode':
          outcome = this.moveNode(op)
          break
        case 'setNodeStatus':
          outcome = this.setNodeStatus(op)
          break
        case 'linkSource':
          outcome = this.linkSource(op)
          break
        case 'unlinkSource':
          outcome = this.unlinkSource(op)
          break
        case 'setLinkState':
          outcome = this.setLinkState(op)
          break
      }
      if (outcome.kind === 'rejected') {
        this.rejected.push({
          opIndex,
          code: outcome.code,
          reason: outcome.reason,
          ...this.rejectionTarget(op),
        })
      } else if (outcome.kind === 'applied') {
        this.applied += 1
      } else if (outcome.kind === 'skipped') {
        this.skipped += 1
      } else {
        this.unchanged += 1
      }
    })
  }

  result(): ApplyResult {
    return {
      applied: this.applied,
      unchanged: this.unchanged,
      skipped: this.skipped,
      rejected: this.rejected,
      createdNodeIds: this.state.createdNodes.map((node) => node.id),
      eventsWritten: this.state.events.length,
    }
  }

  /** What a refused op was about, for the run's record: our node id and the field, if it has one. */
  private rejectionTarget(op: ChangeSetOp): { nodeRef?: NodeId; fieldKey?: string } {
    const target: { nodeRef?: NodeId; fieldKey?: string } = {}
    // A createNode names its parent first, which is not what it is about.
    const ref = op.op === 'createNode' ? undefined : nodeRefsOf(op)[0]
    if (ref !== undefined) {
      const nodeId =
        'id' in ref
          ? (this.state.aliases.get(ref.id) ?? ref.id)
          : this.state.links.get(refKey(ref.link))?.nodeId
      if (nodeId !== undefined && this.state.nodes.has(nodeId)) target.nodeRef = nodeId
    }
    if (op.op === 'setField' || op.op === 'clearField') target.fieldKey = op.fieldKey
    return target
  }

  private node(ref: NodeRef): NodeState | Outcome {
    if ('id' in ref) {
      const node = this.state.nodes.get(this.state.aliases.get(ref.id) ?? ref.id)
      return node ?? refused('unknown_node', `there is no node ${ref.id}`)
    }
    const link = this.state.links.get(refKey(ref.link))
    const node = link && this.state.nodes.get(link.nodeId)
    return node ?? refused('unknown_node', `no node is linked to ${describeLink(ref.link)}`)
  }

  private touch(nodeId: NodeId): void {
    this.state.touched.add(nodeId)
  }

  private event(
    row: Omit<EventRow, 'oldValue' | 'newValue'>,
    oldValue: unknown,
    newValue: unknown,
  ) {
    this.state.events.push({ ...row, oldValue, newValue })
  }

  /**
   * A changelog row for a structural change: a reserved key (`node`, `status`, `placement`,
   * `parent`, `link`), the source's layer, scope master. Values name our own ids only (rule 3).
   */
  private structuralEvent(
    op: ChangeSetOpName,
    nodeId: NodeId,
    fieldKey: string,
    oldValue: unknown,
    newValue: unknown,
  ) {
    this.event(
      { op, nodeId, fieldKey, layer: this.sourceLayer, scope: 'master' },
      oldValue,
      newValue,
    )
  }

  private valueRow(
    nodeId: NodeId,
    write: FieldWrite,
    valueHash: string,
    rejectReason: string | null,
  ): ValueRow {
    return {
      nodeId,
      fieldKey: write.fieldKey,
      layer: write.layer,
      scope: write.scope,
      value: write.value,
      valueHash,
      source: this.set.source,
      jobId: this.set.jobId,
      actor: this.set.actor,
      observedAt: new Date(this.set.observedAt),
      sourceRecordId: write.sourceRecordId ?? null,
      mappingVersion: write.mappingVersion ?? null,
      basis: write.basis ?? null,
      valid: rejectReason === null,
      rejectReason,
    }
  }

  /** The checks a till-layer op needs before anything else: the node is linked to this source. */
  private tillLinkProblem(node: NodeState): Outcome | null {
    const integration = this.tillIntegration
    if (integration === null || this.state.linkOf(node.id, integration)) return null
    return refused('not_linked', `${node.id} has no link to ${integration}: till values need one`)
  }

  private setField(write: FieldWrite): Outcome {
    const node = this.node(write.node)
    if (isOutcome(node)) return node
    if (write.layer === 'till') {
      const problem = this.tillLinkProblem(node)
      if (problem) return problem
      const recordIntegration = this.state.records.get(write.sourceRecordId ?? '')
      if (recordIntegration !== this.tillIntegration) {
        return refused(
          'unknown_source_record',
          `source record ${write.sourceRecordId} does not exist for ${this.tillIntegration}`,
        )
      }
    }
    if (write.scope !== 'master' && !this.state.venues.has(write.scope.slice('venue:'.length))) {
      return refused('unknown_venue', `${write.scope} is not a venue of this tenant`)
    }

    const key = slotKey(node.id, write.fieldKey, write.layer, write.scope)
    const current = this.state.values.get(key)
    const verdict = validateWrite(this.template, node.type, write, {
      linkedToTill: this.state.hasTillLink(node.id),
    })
    if (!verdict.ok) {
      // Keep an invalid value (V1/V2) with its reason, unless it would replace a good value.
      const keep =
        (verdict.code === 'V1' || verdict.code === 'V2') &&
        write.value !== null &&
        (current === undefined || !current.valid)
      if (keep) {
        const hash = sha256Hex(canonicalJson(write.value))
        if (current?.valueHash !== hash || current.rejectReason !== verdict.reason) {
          this.state.putValue(this.valueRow(node.id, write, hash, verdict.reason))
          this.state.dirtyValues.add(key)
        }
      }
      return refused(verdict.code, verdict.reason)
    }

    // validateWrite found the definition, so it exists.
    const definition = findField(this.template, node.type, write.fieldKey)
    if (!definition) return refused('unknown_field', `${node.type} has no field ${write.fieldKey}`)
    if (definition.type === 'tags' && write.layer !== 'till') {
      const problem = this.tagProblem(node, write, current)
      if (problem) return problem
    }
    const spec = FIELD_TYPES[definition.type] as FieldTypeSpec
    const hash = spec.hash(write.value as never)
    const sameBasis =
      write.layer !== 'override' ||
      (current?.basis !== undefined &&
        current.basis !== null &&
        spec.hash(current.basis as never) === spec.hash(write.basis as never))
    if (current?.valid && current.valueHash === hash && sameBasis) return UNCHANGED

    this.state.putValue(this.valueRow(node.id, write, hash, null))
    this.state.dirtyValues.add(key)
    this.event(
      {
        op: 'setField',
        nodeId: node.id,
        fieldKey: write.fieldKey,
        layer: write.layer,
        scope: write.scope,
      },
      current?.valid ? current.value : null,
      write.value,
    )
    this.touch(node.id)
    return APPLIED
  }

  /**
   * The check behind `unknown_tag`: every tag id a builder-layer write adds must be an active tag
   * of a venue the item belongs to (the venues of the menus it is placed in; any venue of the
   * tenant while it is placed nowhere). Builder layers are always master scope. An id the slot
   * already holds may stay: restoring an archived tag then brings its items back, and a save from
   * one venue's composer does not drop the tags of another venue the item also sits in.
   */
  private tagProblem(
    node: NodeState,
    write: FieldWrite,
    current: ValueRow | undefined,
  ): Outcome | null {
    const held = new Set<unknown>(
      current?.valid && Array.isArray(current.value) ? current.value : [],
    )
    const venues = this.state.itemVenues.get(node.id)
    for (const id of write.value as readonly string[]) {
      if (held.has(id)) continue
      const tag = this.state.tagRows.get(id)
      if (!tag || tag.archived) {
        return refused('unknown_tag', `${id} is not an active tag of this venue`)
      }
      if (venues !== undefined && venues.size > 0 && !venues.has(tag.venueId)) {
        return refused('unknown_tag', `${id} is a tag of another venue`)
      }
    }
    return null
  }

  private clearField(clear: ClearField): Outcome {
    const node = this.node(clear.node)
    if (isOutcome(node)) return node
    if (clear.layer === 'till') {
      const problem = this.tillLinkProblem(node)
      if (problem) return problem
    }
    const key = slotKey(node.id, clear.fieldKey, clear.layer, clear.scope)
    const current = this.state.values.get(key)
    if (!current) return UNCHANGED
    this.state.deleteValue(key)
    if (current.valid) {
      this.event(
        {
          op: 'clearField',
          nodeId: node.id,
          fieldKey: clear.fieldKey,
          layer: clear.layer,
          scope: clear.scope,
        },
        current.value,
        null,
      )
    }
    this.touch(node.id)
    return APPLIED
  }

  /** The node's depth below its root (a menu or an item): 0 for the root itself. */
  private depthOf(node: NodeState): number {
    let depth = 0
    let current: NodeState | undefined = node
    while (current?.parentId) {
      depth += 1
      current = this.state.nodes.get(current.parentId)
      if (current === undefined || depth > 16) return Number.POSITIVE_INFINITY
    }
    return depth
  }

  private createNode(op: Extract<ChangeSet['ops'][number], { op: 'createNode' }>): Outcome {
    // Identity resolved through source_links: the external object already has its node.
    if (this.state.aliases.has(op.id)) return UNCHANGED
    let parent: NodeState | null = null
    if (op.parent !== null) {
      const found = this.node(op.parent)
      if (isOutcome(found)) return found
      parent = found
    }
    const existing = this.state.nodes.get(op.id)
    if (existing) {
      if (existing.type === op.nodeType && existing.parentId === (parent?.id ?? null)) {
        return UNCHANGED
      }
      return refused(
        'id_conflict',
        `${op.id} already exists as a ${existing.type} under ${existing.parentId ?? 'no parent'}`,
      )
    }
    if (op.nodeType === 'menu') {
      return refused('source_not_allowed', 'a menu is created with its venue (provisionMenu)')
    }
    if (this.template.nodeTypes[op.nodeType] === undefined) {
      return refused('unknown_node_type', `the template has no ${op.nodeType} node type`)
    }
    let sortKey: string | null = null
    if (parent !== null) {
      const depth = this.depthOf(parent) + 1
      if (!canNest(parent.type, op.nodeType, depth)) {
        return refused(
          'invalid_parent',
          `a ${op.nodeType} cannot sit under a ${parent.type} at depth ${depth}`,
        )
      }
      // A place among the siblings: the key given, or after the current last one ('end').
      const last = this.state.lastChildKey.get(parent.id) ?? null
      sortKey =
        op.sortKey === undefined || op.sortKey === 'end' ? sortKeyBetween(last, null) : op.sortKey
      if (last === null || sortKey > last) this.state.lastChildKey.set(parent.id, sortKey)
    }
    const node: NodeState = {
      id: op.id,
      type: op.nodeType,
      parentId: parent?.id ?? null,
      sortKey,
      status: op.status,
    }
    this.state.nodes.set(node.id, node)
    this.state.createdNodes.push(node)
    this.structuralEvent('createNode', node.id, 'node', null, {
      type: node.type,
      parent: node.parentId,
      status: node.status,
    })
    return APPLIED
  }

  private placementTargets(op: {
    item: NodeRef
    section: NodeRef
  }): { item: NodeState; section: NodeState } | Outcome {
    const item = this.node(op.item)
    if (isOutcome(item)) return item
    const section = this.node(op.section)
    if (isOutcome(section)) return section
    if (item.type !== 'item' || section.type !== 'section') {
      return refused(
        'invalid_placement',
        `only an item is placed, only in a section (got a ${item.type} in a ${section.type})`,
      )
    }
    return { item, section }
  }

  /**
   * Places an item in a section. With `onlyIfUnplaced`, the placement is skipped when the item
   * already had a placement in this section's menu before the change set started: a re-sync
   * never re-adds, moves or reorders what the manager arranged, while a first import still
   * places a new item in every section its categories map to (placements made earlier in the
   * same change set do not count). Known edge, left on purpose (tracker T47): an item the
   * manager took out of every section of the menu counts as unplaced, so the next sync places
   * it again.
   */
  private setPlacement(op: Extract<ChangeSet['ops'][number], { op: 'setPlacement' }>): Outcome {
    const targets = this.placementTargets(op)
    if ('kind' in targets) return targets
    const { item, section } = targets
    if (op.onlyIfUnplaced === true) {
      const menus = this.state.menusPlacedBefore.get(item.id)
      if (menus?.has(this.rootOf(section))) return SKIPPED
    }
    const inSection = this.state.placementsOf(section.id)
    const current = inSection.get(item.id)
    let sortKey: string
    if (op.sortKey === 'end') {
      // 'end' places a new item after the current last; an item already there stays put.
      if (current !== undefined) return UNCHANGED
      let last: string | null = null
      for (const key of inSection.values()) if (last === null || key > last) last = key
      sortKey = sortKeyBetween(last, null)
    } else {
      if (current === op.sortKey) return UNCHANGED
      sortKey = op.sortKey
    }
    inSection.set(item.id, sortKey)
    this.state.dirtyPlacements.set(pairKey(section.id, item.id), {
      sectionId: section.id,
      itemId: item.id,
    })
    this.structuralEvent(
      'setPlacement',
      item.id,
      'placement',
      current === undefined ? null : { section: section.id, sort_key: current },
      { section: section.id, sort_key: sortKey },
    )
    return APPLIED
  }

  private removePlacement(
    op: Extract<ChangeSet['ops'][number], { op: 'removePlacement' }>,
  ): Outcome {
    const targets = this.placementTargets(op)
    if ('kind' in targets) return targets
    const { item, section } = targets
    const inSection = this.state.placementsOf(section.id)
    const current = inSection.get(item.id)
    if (current === undefined) return UNCHANGED
    inSection.delete(item.id)
    this.state.dirtyPlacements.set(pairKey(section.id, item.id), {
      sectionId: section.id,
      itemId: item.id,
    })
    this.structuralEvent(
      'removePlacement',
      item.id,
      'placement',
      { section: section.id, sort_key: current },
      null,
    )
    return APPLIED
  }

  /**
   * Moves a section (new parent, new place) or reorders a modifier group or option among its
   * siblings. A section keeps its depth rules: a menu or section parent, never inside its own
   * subtree, never in another menu, and no sub-section deeper than `MAX_SECTION_DEPTH`.
   */
  private moveNode(op: Extract<ChangeSet['ops'][number], { op: 'moveNode' }>): Outcome {
    if (this.set.source !== 'manual') {
      return refused('source_not_allowed', 'only a person moves nodes (a manual change set)')
    }
    const node = this.node(op.node)
    if (isOutcome(node)) return node
    const parent = this.node(op.parent)
    if (isOutcome(parent)) return parent

    if (node.type === 'section') {
      if (parent.id === node.id || this.isBelow(parent, node.id)) {
        return refused('invalid_parent', 'a section cannot move into itself or its own sections')
      }
      if (this.rootOf(parent) !== this.rootOf(node)) {
        return refused('invalid_parent', 'a section cannot move to another menu')
      }
      const depth = this.depthOf(parent) + 1
      if (!canNest(parent.type, 'section', depth)) {
        return refused(
          'invalid_parent',
          `a section cannot sit under a ${parent.type} at depth ${depth}`,
        )
      }
      if (depth + this.sectionHeight(node) > MAX_SECTION_DEPTH) {
        return refused(
          'invalid_parent',
          `the section and the sections inside it would be deeper than ${MAX_SECTION_DEPTH} levels`,
        )
      }
    } else if (node.type === 'modifier_group' || node.type === 'option') {
      if (parent.id !== node.parentId) {
        return refused('invalid_parent', `a ${node.type} only changes its place among its siblings`)
      }
    } else {
      return refused('invalid_move', `a ${node.type} is not moved this way`)
    }

    const sameParent = node.parentId === parent.id
    let sortKey: string
    if (op.sortKey === 'end') {
      // 'end' puts a node after the current last sibling; one already under this parent stays.
      if (sameParent) return UNCHANGED
      sortKey = sortKeyBetween(this.state.lastChildKey.get(parent.id) ?? null, null)
    } else {
      sortKey = op.sortKey
    }
    if (sameParent && node.sortKey === sortKey) return UNCHANGED

    if (!this.state.movedFrom.has(node.id)) {
      this.state.movedFrom.set(node.id, { parentId: node.parentId, sortKey: node.sortKey })
    }
    this.structuralEvent(
      'moveNode',
      node.id,
      'parent',
      { parent: node.parentId, sort_key: node.sortKey },
      { parent: parent.id, sort_key: sortKey },
    )
    node.parentId = parent.id
    node.sortKey = sortKey
    const last = this.state.lastChildKey.get(parent.id) ?? null
    if (last === null || sortKey > last) this.state.lastChildKey.set(parent.id, sortKey)
    this.touch(node.id)
    return APPLIED
  }

  /** True if `ancestorId` is `node` or one of the nodes above it. */
  private isBelow(node: NodeState, ancestorId: NodeId): boolean {
    let current: NodeState | undefined = node
    for (let guard = 0; current && guard <= 16; guard += 1) {
      if (current.id === ancestorId) return true
      current = current.parentId ? this.state.nodes.get(current.parentId) : undefined
    }
    return false
  }

  /** The id of the node at the top of the chain above `node` (the menu, for a section). */
  private rootOf(node: NodeState): NodeId {
    let current = node
    for (let guard = 0; guard <= 16 && current.parentId; guard += 1) {
      const next = this.state.nodes.get(current.parentId)
      if (!next) break
      current = next
    }
    return current.id
  }

  /** How many levels of sections sit below a section (0 when it has no sub-section). */
  private sectionHeight(section: NodeState): number {
    let height = 0
    for (const candidate of this.state.nodes.values()) {
      if (candidate.type !== 'section' || candidate.id === section.id) continue
      let level = 0
      let current: NodeState | undefined = candidate
      while (current && current.id !== section.id && level <= 16) {
        level += 1
        current = current.parentId ? this.state.nodes.get(current.parentId) : undefined
      }
      if (current?.id === section.id) height = Math.max(height, level)
    }
    return height
  }

  private setNodeStatus(op: Extract<ChangeSet['ops'][number], { op: 'setNodeStatus' }>): Outcome {
    const node = this.node(op.node)
    if (isOutcome(node)) return node
    if (node.status === op.status) return UNCHANGED
    this.structuralEvent('setNodeStatus', node.id, 'status', node.status, op.status)
    node.status = op.status
    this.state.statusChanged.add(node.id)
    this.touch(node.id)
    return APPLIED
  }

  /** The integration a link names, and whether this change set's source may (un)link it. */
  private linkAuthority(link: SourceLink, manualOnly: boolean): Outcome | null {
    const integration = this.state.integrations.get(link.integration)
    if (!integration) {
      return refused('unknown_integration', `this tenant has no integration ${link.integration}`)
    }
    const own = tillSource(link.integration)
    if (this.set.source !== 'manual' && (manualOnly || this.set.source !== own)) {
      return refused(
        'source_not_allowed',
        manualOnly
          ? 'only a person unlinks (a manual change set)'
          : `a ${this.set.source} change set cannot link through ${link.integration}`,
      )
    }
    return null
  }

  private linkSource(op: Extract<ChangeSet['ops'][number], { op: 'linkSource' }>): Outcome {
    const problem = this.linkAuthority(op.link, false)
    if (problem) return problem
    const node = this.node(op.node)
    if (isOutcome(node)) return node
    // Every connector kind declares its link types; a kind that declares none links nothing.
    const kind = this.state.integrations.get(op.link.integration)?.kind ?? ''
    const typeProblem = tillLinkTypeProblem(
      kind,
      node.type,
      op.link.externalType,
      this.tillLinkTypes,
    )
    if (typeProblem !== null) return refused('invalid_link_type', typeProblem)
    const existing = this.state.links.get(refKey(op.link))
    if (existing) {
      return existing.nodeId === node.id
        ? UNCHANGED
        : refused('link_taken', `${describeLink(op.link)} is linked to ${existing.nodeId}`)
    }
    // One till link per node (A1-F4): two tills would overwrite each other's `till` values.
    const current =
      this.state.tillLinkOf(node.id) ?? this.state.linkOf(node.id, op.link.integration)
    if (current) {
      return refused(
        'already_linked',
        current.integrationId === op.link.integration
          ? `${node.id} already has a link from ${op.link.integration}; unlink it first`
          : `${node.id} already has a till link from ${current.integrationId}; a node has one till link`,
      )
    }
    const link: LinkState = {
      integrationId: op.link.integration,
      externalType: op.link.externalType,
      externalId: op.link.externalId,
      nodeId: node.id,
      state: 'active',
      lastSeenAt: new Date(this.set.observedAt),
      lastHash: null,
    }
    this.state.addLink(link)
    this.state.dirtyLinks.add(linkKey(link))
    this.structuralEvent('linkSource', node.id, 'link', null, this.linkEventValue(link))
    this.touch(node.id)
    return APPLIED
  }

  /**
   * What a link event records: the till source (`till:<integration>`, the role, never the
   * vendor) and the kind of external object, never its id.
   */
  private linkEventValue(link: Pick<LinkState, 'integrationId' | 'externalType'>) {
    return {
      source: tillSource(link.integrationId),
      external_type: link.externalType,
    }
  }

  /**
   * Moves a link through the Link lifecycle, and records when its source last saw the object.
   * Only the link's own source may do this. The state follows `LINK_TRANSITIONS`; the same state
   * again is a no-op without an event; every move writes one structural event and stamps
   * `state_changed_at`. `seenAt` / `hash` move `last_seen_at` / `last_hash` forward only: an
   * observation older than the stored one changes neither. Field values, overrides and
   * placements are never touched (the enrichment is kept, rule 6): the resolver hides a node
   * whose link is missing or deleted.
   */
  private setLinkState(op: SetLinkState): Outcome {
    const integration = this.state.integrations.get(op.link.integration)
    if (!integration) {
      return refused('unknown_integration', `this tenant has no integration ${op.link.integration}`)
    }
    const own = tillSource(op.link.integration)
    if (this.set.source !== own) {
      return refused('source_not_allowed', `only ${own} sets the state of its own links`)
    }
    const key = refKey(op.link)
    const link = this.state.links.get(key)
    if (!link) return refused('unknown_link', `${describeLink(op.link)} is not linked to a node`)

    let next = link
    const moves = op.state !== link.state
    if (moves) {
      if (!LINK_TRANSITIONS[link.state].includes(op.state)) {
        return refused('invalid_transition', `a ${link.state} link cannot become ${op.state}`)
      }
      next = { ...next, state: op.state }
    }
    if (op.seenAt !== undefined) {
      const seenAt = new Date(op.seenAt)
      const stored = link.lastSeenAt?.getTime() ?? Number.NEGATIVE_INFINITY
      if (seenAt.getTime() >= stored) {
        if (seenAt.getTime() !== stored) next = { ...next, lastSeenAt: seenAt }
        if (op.hash !== undefined && op.hash !== link.lastHash)
          next = { ...next, lastHash: op.hash }
      }
    }
    if (next === link) return UNCHANGED

    this.state.links.set(key, next)
    this.state.dirtyLinkStates.add(key)
    if (!moves) return UNCHANGED
    this.state.linkStateMoved.add(key)
    this.structuralEvent(
      'setLinkState',
      link.nodeId,
      'link',
      { ...this.linkEventValue(link), state: link.state },
      { ...this.linkEventValue(link), state: op.state },
    )
    this.touch(link.nodeId)
    return APPLIED
  }

  /**
   * Unlink (doc "Linking and unlinking"): the current till values are copied into the manual
   * layer (`unlinkCopy`), the till rows of this integration are removed (so the node's own
   * values show from now on), and the link is deleted. Overrides stay where they are.
   */
  private unlinkSource(op: Extract<ChangeSet['ops'][number], { op: 'unlinkSource' }>): Outcome {
    const problem = this.linkAuthority(op.link, true)
    if (problem) return problem
    const node = this.node(op.node)
    if (isOutcome(node)) return node
    const key = refKey(op.link)
    const existing = this.state.links.get(key)
    if (!existing) return UNCHANGED
    if (existing.nodeId !== node.id) {
      return refused('link_taken', `${describeLink(op.link)} is linked to ${existing.nodeId}`)
    }

    this.state.removeLink(key)
    this.state.dirtyLinks.add(key)
    this.structuralEvent('unlinkSource', node.id, 'link', this.linkEventValue(existing), null)
    const linkedToTill = this.state.hasTillLink(node.id)
    const source = tillSource(op.link.integration)
    const rowsByField = new Map<string, ValueRow[]>()
    for (const slot of this.state.valuesOfNode.get(node.id) ?? []) {
      const row = this.state.values.get(slot)
      if (row?.layer !== 'till' || row.source !== source) continue
      rowsByField.set(row.fieldKey, [...(rowsByField.get(row.fieldKey) ?? []), row])
    }
    const validValue = (layer: Layer, fieldKey: string) => {
      const row = this.state.values.get(slotKey(node.id, fieldKey, layer, 'master'))
      return row?.valid ? row.value : undefined
    }

    for (const [fieldKey, rows] of rowsByField) {
      const definition = findField(this.template, node.type, fieldKey)
      const manualBefore = validValue('manual', fieldKey)
      const copy =
        definition &&
        unlinkCopy(definition, {
          till: rows.filter((row) => row.valid).map((row) => row.value),
          manual: manualBefore,
        })
      if (definition && copy) {
        const write: FieldWrite = {
          op: 'setField',
          node: { id: node.id },
          fieldKey,
          layer: 'manual',
          scope: 'master',
          value: copy.value as FieldWrite['value'],
        }
        if (validateWrite(this.template, node.type, write, { linkedToTill }).ok) {
          const spec = FIELD_TYPES[definition.type] as FieldTypeSpec
          const manualKey = slotKey(node.id, fieldKey, 'manual', 'master')
          this.state.putValue(this.valueRow(node.id, write, spec.hash(copy.value as never), null))
          this.state.dirtyValues.add(manualKey)
          this.event(
            { op: 'setField', nodeId: node.id, fieldKey, layer: 'manual', scope: 'master' },
            manualBefore ?? null,
            copy.value,
          )
        }
      }
      for (const row of rows) {
        this.state.deleteValue(slotKey(row.nodeId, row.fieldKey, row.layer, row.scope))
        if (row.valid) {
          this.event(
            { op: 'clearField', nodeId: node.id, fieldKey, layer: 'till', scope: row.scope },
            row.value,
            null,
          )
        }
      }
    }
    this.touch(node.id)
    return APPLIED
  }
}

/** The created nodes with every parent before its children, otherwise in creation order. */
function parentsFirst(created: readonly NodeState[]): NodeState[] {
  const ids = new Set(created.map((node) => node.id))
  const written = new Set<NodeId>()
  const ordered: NodeState[] = []
  let pending = [...created]
  while (pending.length > 0) {
    const ready = pending.filter(
      (node) => node.parentId === null || !ids.has(node.parentId) || written.has(node.parentId),
    )
    // A cycle among new nodes cannot be ordered; the foreign key reports it.
    if (ready.length === 0) return [...ordered, ...pending]
    for (const node of ready) {
      ordered.push(node)
      written.add(node.id)
    }
    pending = pending.filter((node) => !written.has(node.id))
  }
  return ordered
}

/** Writes what the run decided (step 3). */
async function flush(
  tx: WriteTx,
  tenantId: string,
  set: ChangeSet,
  state: DocumentState,
): Promise<void> {
  // New nodes, parents before children (one statement checks its foreign keys at its end). A
  // node created and then moved in this set is written where it ended up.
  for (const batch of batches(parentsFirst(state.createdNodes))) {
    await tx.insert(nodes).values(
      batch.map((node) => ({
        id: node.id,
        tenantId,
        nodeType: node.type,
        parentId: node.parentId,
        sortKey: node.sortKey,
        status: node.status,
      })),
    )
  }
  const created = new Set(state.createdNodes.map((node) => node.id))
  for (const id of state.statusChanged) {
    const node = state.nodes.get(id)
    if (!node || created.has(id)) continue
    await tx.execute(sql`update restro.nodes set status = ${node.status} where id = ${id}`)
  }
  for (const [id, before] of state.movedFrom) {
    const node = state.nodes.get(id)
    if (!node || created.has(id)) continue
    if (node.parentId === before.parentId && node.sortKey === before.sortKey) continue
    await tx.execute(
      sql`update restro.nodes set parent_id = ${node.parentId}, sort_key = ${node.sortKey} where id = ${id}`,
    )
  }

  // Links: removed ones first, so a link can move within one change set.
  const removedLinks: LinkState[] = []
  const addedLinks: LinkState[] = []
  for (const key of state.dirtyLinks) {
    const before = state.originalLinks.get(key)
    const after = state.links.get(key)
    if (before && after && before.nodeId === after.nodeId) continue
    if (before) removedLinks.push(before)
    if (after) addedLinks.push(after)
  }
  for (const batch of batches(removedLinks)) {
    await tx.execute(sql`
      delete from restro.source_links
      where (integration_id, external_type, external_id) in (
        select * from unnest(
          ${sql.param(batch.map((link) => link.integrationId))}::text[],
          ${sql.param(batch.map((link) => link.externalType))}::text[],
          ${sql.param(batch.map((link) => link.externalId))}::text[]))`)
  }
  const seenAt = new Date(set.observedAt)
  for (const batch of batches(addedLinks)) {
    await tx.insert(sourceLinks).values(
      batch.map((link) => ({
        tenantId,
        integrationId: link.integrationId,
        externalType: link.externalType,
        externalId: link.externalId,
        nodeId: link.nodeId,
        state: link.state,
        firstSeenAt: seenAt,
        lastSeenAt: link.lastSeenAt ?? seenAt,
        lastHash: link.lastHash,
      })),
    )
  }

  // The lifecycle of links that existed before this change set (setLinkState): state, last seen,
  // last hash; `state_changed_at` becomes the transaction time when the state moved. A link
  // created or removed above already carries its final values.
  const lifecycle: (LinkState & { moved: boolean })[] = []
  for (const key of state.dirtyLinkStates) {
    const before = state.originalLinks.get(key)
    const after = state.links.get(key)
    if (!before || !after || before.nodeId !== after.nodeId) continue
    lifecycle.push({ ...after, moved: state.linkStateMoved.has(key) })
  }
  for (const batch of batches(lifecycle)) {
    const column = <T>(pick: (link: LinkState & { moved: boolean }) => T) =>
      sql.param(batch.map(pick))
    await tx.execute(sql`
      update restro.source_links l
      set state = u.state,
          state_changed_at = case when u.moved then now() else l.state_changed_at end,
          last_seen_at = coalesce(u.last_seen_at, l.last_seen_at),
          last_hash = u.last_hash
      from unnest(
        ${column((link) => link.integrationId)}::text[],
        ${column((link) => link.externalType)}::text[],
        ${column((link) => link.externalId)}::text[],
        ${column((link) => link.state)}::text[],
        ${column((link) => link.moved)}::boolean[],
        ${column((link) => link.lastSeenAt?.toISOString() ?? null)}::timestamptz[],
        ${column((link) => link.lastHash)}::text[]
      ) as u(integration_id, external_type, external_id, state, moved, last_seen_at, last_hash)
      where l.integration_id = u.integration_id
        and l.external_type = u.external_type
        and l.external_id = u.external_id`)
  }

  // Placements.
  const removedPlacements: { sectionId: NodeId; itemId: NodeId }[] = []
  const placed: { sectionId: NodeId; itemId: NodeId; sortKey: string }[] = []
  for (const pair of state.dirtyPlacements.values()) {
    const sortKey = state.placements.get(pair.sectionId)?.get(pair.itemId)
    const before = state.originalPlacements.get(pairKey(pair.sectionId, pair.itemId))
    if (sortKey === before) continue
    if (sortKey === undefined) removedPlacements.push(pair)
    else placed.push({ ...pair, sortKey })
  }
  for (const batch of batches(removedPlacements)) {
    await tx.execute(sql`
      delete from restro.placements
      where (section_id, item_id) in (
        select * from unnest(
          ${sql.param(batch.map((pair) => pair.sectionId))}::text[],
          ${sql.param(batch.map((pair) => pair.itemId))}::text[]))`)
  }
  for (const batch of batches(placed)) {
    await tx
      .insert(placements)
      .values(batch.map((pair) => ({ tenantId, ...pair })))
      .onConflictDoUpdate({
        target: [placements.sectionId, placements.itemId],
        set: { sortKey: sql`excluded.sort_key` },
      })
  }

  // Field values: deletions, then upserts of each slot's final row.
  const removedSlots: [string, string, string, string][] = []
  const keptRows: ValueRow[] = []
  for (const key of state.dirtyValues) {
    const row = state.values.get(key)
    if (row) keptRows.push(row)
    else removedSlots.push(JSON.parse(key) as [string, string, string, string])
  }
  for (const batch of batches(removedSlots)) {
    const column = (index: number) => sql.param(batch.map((slot) => slot[index]))
    await tx.execute(sql`
      delete from restro.field_values
      where (node_id, field_key, layer, scope) in (
        select * from unnest(
          ${column(0)}::text[], ${column(1)}::text[], ${column(2)}::text[], ${column(3)}::text[]))`)
  }
  for (const batch of batches(keptRows, 250)) {
    await tx
      .insert(fieldValues)
      .values(batch.map((row) => ({ tenantId, ...row })))
      .onConflictDoUpdate({
        target: [fieldValues.nodeId, fieldValues.fieldKey, fieldValues.layer, fieldValues.scope],
        set: {
          value: sql`excluded.value`,
          valueHash: sql`excluded.value_hash`,
          source: sql`excluded.source`,
          jobId: sql`excluded.job_id`,
          actor: sql`excluded.actor`,
          observedAt: sql`excluded.observed_at`,
          sourceRecordId: sql`excluded.source_record_id`,
          mappingVersion: sql`excluded.mapping_version`,
          basis: sql`excluded.basis`,
          valid: sql`excluded.valid`,
          rejectReason: sql`excluded.reject_reason`,
        },
      })
  }

  // The changelog, in op order, then one revision step per touched node that existed before.
  for (const batch of batches(state.events)) {
    await tx.insert(events).values(
      batch.map((event) => ({
        tenantId,
        ...event,
        source: set.source,
        actor: set.actor,
        jobId: set.jobId,
        changeSetId: set.id,
      })),
    )
  }
  const bumped = [...state.touched].filter((id) => !created.has(id))
  if (bumped.length > 0) {
    await tx.execute(
      sql`update restro.nodes set revision = revision + 1 where ${anyOf(nodes.id, bumped)}`,
    )
  }
}

/**
 * Applies a change set to one tenant's document, atomically (rule 1: the only write path).
 * Refuses the whole set with an `ApplyError` when it does not parse or names an integration the
 * tenant does not have; otherwise every op is applied, a no-op, or rejected with a reason (see
 * `ApplyResult`), and the applied ones are committed together.
 */
export async function apply(
  pool: DbPool,
  tenantId: string,
  changeSet: ChangeSet,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  return withTenantWrite(pool, tenantId, (tx) =>
    applyInTransaction(tx, tenantId, changeSet, options),
  )
}

/**
 * `apply()` inside a transaction the caller opened: for a writer in this folder that has to read
 * the document and write the result as one step (a bulk change that adds to what each item holds
 * must not race another change set). Same checks, same one write path; the caller's transaction
 * commits or rolls back with it. Takes the tenant's document lock, which a caller that took it
 * already holds again without waiting.
 */
export async function applyInTransaction(
  tx: WriteTx,
  tenantId: string,
  changeSet: ChangeSet,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const parsed = parseChangeSet(changeSet)
  if (!parsed.ok) throw new ApplyError('invalid_change_set', parsed.reason)
  const set = parsed.value
  const template = options.template ?? VENUE_MENU_TEMPLATE
  await lockTenantDocument(tx, tenantId)
  const state = await loadState(tx, set, template)
  const tillIntegration = tillIntegrationOf(set.source)
  if (tillIntegration !== null && !state.isTill(tillIntegration)) {
    throw new ApplyError(
      'unknown_integration',
      `this tenant has no till integration ${tillIntegration}`,
    )
  }
  const run = new Run(set, template, state, options.tillLinkTypes ?? TILL_LINK_TYPES)
  run.processAll()
  if (options.atomic === true && run.rejected.length > 0) {
    const first = run.rejected[0]
    throw new ApplyError(
      'change_set_rejected',
      `${run.rejected.length} op(s) were refused and nothing was written; the first: ${first?.code} (${first?.reason})`,
      run.rejected,
    )
  }
  await flush(tx, tenantId, set, state)
  return run.result()
}
