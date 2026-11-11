// A venue's menus (D88, D90, D91, D92; adjustments M1): the writers behind Settings › Menus and
// the composer's menu list, and the readers those screens share.
//
// The `menus` rows are a side table like the tags: which menus a venue has, their names, order
// and bin (their layout moved to the venue's design record, D129). Nothing of the menu document is here, so these writers do not go through
// apply() (only this folder may import the write side of the database). What goes through apply()
// is `importMenu`: the one-time copy of a hand-made menu into another hand-made venue is one
// atomic change set of createNode, setField and setPlacement ops.
//
// Rules the writers keep:
// - a venue fed by a till gets its menus from the till (D88): `createMenu`, `deleteMenu`,
//   `restoreMenu` and `importMenu` refuse it (`till_venue`); naming, ordering and the
//   choice of the live menu are every venue's;
// - exactly one live menu (`venues.live_menu_id`): the live one is never binned (`menu_live`),
//   a binned one is never set live (`menu_deleted`); a venue's first menu is live by default;
//   `setLiveMenu` only moves the pointer: the caller publishes the newly live menu (D90);
// - a binned menu (`deleted_at`) leaves every list and is purged after 30 days (D83, D91);
// - the order is a fractional sort key (`sortKeyBetween`), so moving a menu writes one row;
// - every writer takes the tenant's document lock and the venue's row lock.

import { type DbPool, type Menu, menus, nodes, type ReadTx, venues, withTenant } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import {
  ActorSchema,
  type ChangeSet,
  type ChangeSetOp,
  type FieldWrite,
  type NodeRef,
} from '../change-set'
import { tillVenueLinks } from '../connectors/till-venues'
import { idSchema, type NodeId, newId, type VenueId } from '../ids'
import { checkMenuName } from '../menus'
import { sortKeyBetween } from '../sort-keys'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { type ApplyResult, applyInTransaction } from './apply'
import { readMenuDocument } from './load-document'
import { lockTenantDocument } from './lock'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Why a menu writer refused. Nothing is written when one is returned. */
export type MenuWriteError =
  /** An id, name, position or setting that is not shaped right. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'unknown_venue'
  /** The venue was deleted (D76). */
  | 'venue_archived'
  /** The venue has no such menu. */
  | 'unknown_menu'
  /** The menu is in the bin. */
  | 'menu_deleted'
  /** The menu is the live one: choose another live menu first. */
  | 'menu_live'
  /** The venue is fed by a till, whose menus are the till's (D88). */
  | 'till_venue'
  /** The menu to copy from does not exist, is binned, or is not the source venue's. */
  | 'unknown_source'

/** A menu as the lists show it. */
export interface MenuSummary {
  readonly id: NodeId
  readonly venueId: VenueId
  /** The header name guests see; null = the venue's name (D92). */
  readonly name: string | null
  readonly sortKey: string
  /** When it went to the bin (ISO 8601); null = in use. */
  readonly deletedAt: string | null
  /** True for the venue's live menu (`venues.live_menu_id`). */
  readonly live: boolean
  readonly createdAt: string
}

/** A refused write: nothing was written. */
export interface MenuFailure {
  readonly ok: false
  readonly error: MenuWriteError
  readonly reason: string
}

/** What a menu writer answers. */
export type MenuWriteResult = { readonly ok: true; readonly menu: MenuSummary } | MenuFailure

/** Where a menu goes in the venue's order: the end, or just before another menu. */
export type MenuPosition = 'end' | { readonly before: NodeId }

const MenuPositionSchema = z.union([z.literal('end'), z.strictObject({ before: idSchema('nd') })])

function failure(error: MenuWriteError, reason: string): MenuFailure {
  return { ok: false, error, reason }
}

function toSummary(row: Menu, liveMenuId: string | null): MenuSummary {
  return {
    id: row.id as NodeId,
    venueId: row.venueId as VenueId,
    name: row.name,
    sortKey: row.sortKey,
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
    live: row.id === liveMenuId,
    createdAt: row.createdAt.toISOString(),
  }
}

// --- reading ------------------------------------------------------------------------------------

/** What `listMenus` can be asked. */
export interface ListMenusOptions {
  /** Include binned menus (Settings › Deleted menus shows them to restore). Default: no. */
  readonly includeDeleted?: boolean
}

async function readMenus(
  tx: ReadTx,
  venueId: string,
  includeDeleted: boolean,
): Promise<MenuSummary[]> {
  const [venue] = await tx
    .select({ liveMenuId: venues.liveMenuId })
    .from(venues)
    .where(eq(venues.id, venueId))
  if (venue === undefined) return []
  const rows = await tx
    .select()
    .from(menus)
    .where(
      includeDeleted
        ? eq(menus.venueId, venueId)
        : and(eq(menus.venueId, venueId), isNull(menus.deletedAt)),
    )
    .orderBy(asc(menus.sortKey), asc(menus.id))
  return rows.map((row) => toSummary(row, venue.liveMenuId))
}

/** The venue's menus in order, the live one marked. Binned ones only when asked for. */
export async function listMenus(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  options: ListMenusOptions = {},
): Promise<MenuSummary[]> {
  if (!idSchema('vn').safeParse(venueId).success) return []
  return withTenant(pool, tenantId, (tx) => readMenus(tx, venueId, options.includeDeleted === true))
}

// --- writing ------------------------------------------------------------------------------------

interface VenueContext {
  readonly liveMenuId: string | null
  /** True when a till feeds the venue (its menus come from the till, D88). */
  readonly tillFed: boolean
}

/** True when a till venue serves this venue (the integration layer's link). */
async function isTillFed(tx: WriteTx | ReadTx, venueId: string): Promise<boolean> {
  const [link] = await tx
    .select({ one: sql<number>`1` })
    .from(tillVenueLinks)
    .where(eq(tillVenueLinks.venueId, venueId))
    .limit(1)
  return link !== undefined
}

/** Runs one writer for a venue of the tenant, under the document lock and the venue's row lock. */
async function inVenue<T>(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  run: (tx: WriteTx, venue: VenueContext) => Promise<T | MenuFailure>,
): Promise<T | MenuFailure> {
  if (!idSchema('vn').safeParse(venueId).success) {
    return failure('invalid_input', 'venueId must be a vn_ id')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      return failure(
        locked.refused === 'venue_archived' ? 'venue_archived' : 'unknown_venue',
        venueRefusalText(venueId, locked.refused),
      )
    }
    return run(tx, {
      liveMenuId: locked.venue.liveMenuId,
      tillFed: await isTillFed(tx, venueId),
    })
  })
}

async function menuOf(tx: WriteTx, venueId: string, menuId: string): Promise<Menu | undefined> {
  const [row] = await tx
    .select()
    .from(menus)
    .where(and(eq(menus.venueId, venueId), eq(menus.id, menuId)))
  return row
}

const unknownMenu = (id: string) => failure('unknown_menu', `the venue has no menu ${id}`)
const tillVenue = () =>
  failure('till_venue', 'a venue fed by a till gets its menus from the till (D88)')

/** The venue's menus in use, in order. Shared with the integration layer's till-menus writer. */
export async function venueMenuOrder(tx: WriteTx, venueId: string) {
  return tx
    .select({ id: menus.id, sortKey: menus.sortKey })
    .from(menus)
    .where(and(eq(menus.venueId, venueId), isNull(menus.deletedAt)))
    .orderBy(asc(menus.sortKey), asc(menus.id))
}

/** The sort key that puts a menu at `position` among `ordered`; null when `before` names no menu. */
function keyAt(
  ordered: readonly { readonly id: string; readonly sortKey: string }[],
  position: MenuPosition,
  movingId: string | null,
): string | null {
  const others = ordered.filter((menu) => menu.id !== movingId)
  if (position === 'end') return sortKeyBetween(others.at(-1)?.sortKey ?? null, null)
  const index = others.findIndex((menu) => menu.id === position.before)
  const next = others[index]
  if (next === undefined) return null
  return sortKeyBetween(others[index - 1]?.sortKey ?? null, next.sortKey)
}

/**
 * Makes `menuId` the venue's live menu when it has none (a venue's first menu is live). Shared
 * with the integration layer's till-menus writer.
 */
export async function adoptLiveMenu(tx: WriteTx, venueId: string, menuId: string): Promise<string> {
  const [row] = await tx
    .update(venues)
    .set({ liveMenuId: menuId })
    .where(and(eq(venues.id, venueId), isNull(venues.liveMenuId)))
    .returning({ liveMenuId: venues.liveMenuId })
  return row?.liveMenuId ?? menuId
}

/**
 * Inserts a menu's root node and its row; returns the row. Shared with the integration layer's
 * till-menus writer (the caller holds the locks).
 */
export async function insertMenuRow(
  tx: WriteTx,
  tenantId: string,
  venueId: string,
  name: string | null,
  sortKey: string,
): Promise<Menu> {
  const id = newId('nd')
  await tx.insert(nodes).values({ id, tenantId, nodeType: 'menu', parentId: null })
  const [row] = await tx
    .insert(menus)
    .values({
      id,
      tenantId,
      venueId,
      templateKey: VENUE_MENU_TEMPLATE.key,
      templateVersion: VENUE_MENU_TEMPLATE.version,
      rootNodeId: id,
      name,
      sortKey,
    })
    .returning()
  if (row === undefined) throw new Error('the menu row was not created')
  return row
}

/** What `createMenu` takes. */
export interface CreateMenuInput {
  readonly venueId: string
  /** The header name; null or blank = the venue's name. */
  readonly name?: unknown
  /** Default: the end. */
  readonly position?: unknown
}

/**
 * Adds a menu to a hand-made venue (D88). The venue's first menu becomes its live one; any other
 * starts as a draft the owner can set live. A till venue is refused: its menus are the till's.
 */
export async function createMenu(
  pool: DbPool,
  tenantId: string,
  input: CreateMenuInput,
): Promise<MenuWriteResult> {
  const name = checkMenuName(input.name)
  if (!name.ok) return failure('invalid_input', name.reason)
  const position = MenuPositionSchema.safeParse(input.position ?? 'end')
  if (!position.success) return failure('invalid_input', 'position is not valid')
  return inVenue(pool, tenantId, input.venueId, async (tx, venue) => {
    if (venue.tillFed) return tillVenue()
    const sortKey = keyAt(await venueMenuOrder(tx, input.venueId), position.data, null)
    if (sortKey === null) return unknownMenu(positionId(position.data))
    const row = await insertMenuRow(tx, tenantId, input.venueId, name.name, sortKey)
    const liveMenuId =
      venue.liveMenuId === null ? await adoptLiveMenu(tx, input.venueId, row.id) : venue.liveMenuId
    return { ok: true, menu: toSummary(row, liveMenuId) }
  })
}

/** The menu a position names, for the "no such menu" answer. */
const positionId = (position: MenuPosition): string => (position === 'end' ? '' : position.before)

/** Sets a menu's header name (null or blank = the venue's name). Saying what it already is writes nothing. */
export async function renameMenu(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly menuId: string; readonly name: unknown },
): Promise<MenuWriteResult> {
  const name = checkMenuName(input.name)
  if (!name.ok) return failure('invalid_input', name.reason)
  if (!idSchema('nd').safeParse(input.menuId).success) {
    return failure('invalid_input', 'menuId must be an nd_ id')
  }
  return inVenue(pool, tenantId, input.venueId, async (tx, venue) => {
    const row = await menuOf(tx, input.venueId, input.menuId)
    if (row === undefined) return unknownMenu(input.menuId)
    if (row.deletedAt !== null) return failure('menu_deleted', 'the menu is in the bin')
    if (row.name === name.name) return { ok: true, menu: toSummary(row, venue.liveMenuId) }
    const [updated] = await tx
      .update(menus)
      .set({ name: name.name })
      .where(eq(menus.id, input.menuId))
      .returning()
    return updated
      ? { ok: true, menu: toSummary(updated, venue.liveMenuId) }
      : unknownMenu(input.menuId)
  })
}

/** Moves a menu to another place in the venue's order. */
export async function moveMenu(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly menuId: string; readonly position: unknown },
): Promise<MenuWriteResult> {
  const position = MenuPositionSchema.safeParse(input.position)
  if (!idSchema('nd').safeParse(input.menuId).success) {
    return failure('invalid_input', 'menuId must be an nd_ id')
  }
  if (!position.success) return failure('invalid_input', 'position is not valid')
  return inVenue(pool, tenantId, input.venueId, async (tx, venue) => {
    const row = await menuOf(tx, input.venueId, input.menuId)
    if (row === undefined) return unknownMenu(input.menuId)
    if (row.deletedAt !== null) return failure('menu_deleted', 'the menu is in the bin')
    if (position.data !== 'end' && position.data.before === input.menuId) {
      return { ok: true, menu: toSummary(row, venue.liveMenuId) }
    }
    const sortKey = keyAt(await venueMenuOrder(tx, input.venueId), position.data, input.menuId)
    if (sortKey === null) return unknownMenu(positionId(position.data))
    const [updated] = await tx
      .update(menus)
      .set({ sortKey })
      .where(eq(menus.id, input.menuId))
      .returning()
    return updated
      ? { ok: true, menu: toSummary(updated, venue.liveMenuId) }
      : unknownMenu(input.menuId)
  })
}

/**
 * Moves a hand-made venue's menu to the bin (D91): it leaves every list, its routes fall back to
 * the live menu, and the purge erases it after 30 days. The live menu is refused (`menu_live`):
 * choose another live menu first. A binned menu stays binned.
 */
export async function deleteMenu(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly menuId: string },
): Promise<MenuWriteResult> {
  if (!idSchema('nd').safeParse(input.menuId).success) {
    return failure('invalid_input', 'menuId must be an nd_ id')
  }
  return inVenue(pool, tenantId, input.venueId, async (tx, venue) => {
    if (venue.tillFed) return tillVenue()
    const row = await menuOf(tx, input.venueId, input.menuId)
    if (row === undefined) return unknownMenu(input.menuId)
    if (row.deletedAt !== null) return { ok: true, menu: toSummary(row, venue.liveMenuId) }
    if (row.id === venue.liveMenuId) {
      return failure('menu_live', 'the live menu cannot be deleted: choose another live menu first')
    }
    const [updated] = await tx
      .update(menus)
      .set({ deletedAt: sql`now()` })
      .where(eq(menus.id, input.menuId))
      .returning()
    return updated
      ? { ok: true, menu: toSummary(updated, venue.liveMenuId) }
      : unknownMenu(input.menuId)
  })
}

/** Brings a binned menu back (hand-made venues). A menu in use stays as it is. */
export async function restoreMenu(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly menuId: string },
): Promise<MenuWriteResult> {
  if (!idSchema('nd').safeParse(input.menuId).success) {
    return failure('invalid_input', 'menuId must be an nd_ id')
  }
  return inVenue(pool, tenantId, input.venueId, async (tx, venue) => {
    if (venue.tillFed) return tillVenue()
    const row = await menuOf(tx, input.venueId, input.menuId)
    if (row === undefined) return unknownMenu(input.menuId)
    if (row.deletedAt === null) return { ok: true, menu: toSummary(row, venue.liveMenuId) }
    const [updated] = await tx
      .update(menus)
      .set({ deletedAt: null })
      .where(eq(menus.id, input.menuId))
      .returning()
    return updated
      ? { ok: true, menu: toSummary(updated, venue.liveMenuId) }
      : unknownMenu(input.menuId)
  })
}

/** What `setLiveMenu` answers: the live menu, whether the pointer moved and from which menu. */
export type SetLiveMenuResult =
  | {
      readonly ok: true
      readonly menu: MenuSummary
      readonly changed: boolean
      /** The menu that was live before, or null when the venue had none. */
      readonly previous: NodeId | null
    }
  | MenuFailure

/**
 * Chooses the venue's live menu (D88): the one guests see at the venue's address and wherever no
 * area or table route says otherwise. Only the pointer moves; the caller publishes the menu
 * (switching the live menu publishes it, D90). A binned menu is refused.
 */
export async function setLiveMenu(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly menuId: string },
): Promise<SetLiveMenuResult> {
  if (!idSchema('nd').safeParse(input.menuId).success) {
    return failure('invalid_input', 'menuId must be an nd_ id')
  }
  return inVenue<Extract<SetLiveMenuResult, { ok: true }>>(
    pool,
    tenantId,
    input.venueId,
    async (tx, venue) => {
      const row = await menuOf(tx, input.venueId, input.menuId)
      if (row === undefined) return unknownMenu(input.menuId)
      if (row.deletedAt !== null) {
        return failure('menu_deleted', 'a menu in the bin cannot be the live one')
      }
      const previous = (venue.liveMenuId as NodeId | null) ?? null
      if (previous === row.id) {
        return { ok: true, menu: toSummary(row, previous), changed: false, previous }
      }
      await tx.update(venues).set({ liveMenuId: row.id }).where(eq(venues.id, input.venueId))
      return { ok: true, menu: toSummary(row, row.id), changed: true, previous }
    },
  )
}

// --- the one-time copy ------------------------------------------------------------------------

/** What `importMenu` takes. */
export interface ImportMenuInput {
  /** The hand-made venue the menu is copied from. */
  readonly fromVenueId: string
  readonly fromMenuId: string
  /** The hand-made venue that gets the copy. */
  readonly toVenueId: string
  /** The copy's header name; default: the source menu's. */
  readonly name?: unknown
  /** Who imports (`user:<id>`): the change set's actor. */
  readonly actor: unknown
}

/** What `importMenu` answers: the new menu and what was copied. */
export type ImportMenuResult =
  | {
      readonly ok: true
      readonly menu: MenuSummary
      readonly copied: {
        readonly sections: number
        readonly items: number
        readonly modifierGroups: number
        readonly options: number
        readonly values: number
        readonly placements: number
      }
      readonly result: ApplyResult
    }
  | MenuFailure

/** The fields a copy leaves out: a venue's own vocabulary (tags are per venue, D60). */
const NOT_COPIED_FIELDS = new Set(['tags'])

/**
 * Copies a hand-made venue's menu into another hand-made venue, once (D88, "Import menu"): a new
 * menu with the source's sections, specials, items, modifier groups and options, their
 * manual-layer values (except `tags`: the vocabulary is the venue's own) and their placements, as
 * one atomic change set. Archived nodes and rejected values are left out; the copy has no link to
 * the source afterwards. Both venues must be hand-made (`till_venue`); the source menu must be in
 * use and the source venue's (`unknown_source`).
 */
export async function importMenu(
  pool: DbPool,
  tenantId: string,
  input: ImportMenuInput,
  options: { readonly now?: Date } = {},
): Promise<ImportMenuResult> {
  const name = checkMenuName(input.name)
  if (!name.ok) return failure('invalid_input', name.reason)
  const actor = ActorSchema.safeParse(input.actor)
  if (!actor.success) return failure('invalid_input', 'actor must be a user or the system')
  if (
    !idSchema('vn').safeParse(input.fromVenueId).success ||
    !idSchema('nd').safeParse(input.fromMenuId).success
  ) {
    return failure('invalid_input', 'the source needs a vn_ venue id and an nd_ menu id')
  }
  if (input.fromVenueId === input.toVenueId) {
    return failure('invalid_input', 'a menu is imported into another venue')
  }
  return inVenue<Extract<ImportMenuResult, { ok: true }>>(
    pool,
    tenantId,
    input.toVenueId,
    async (tx, venue) => {
      if (venue.tillFed) return tillVenue()
      const source = await lockLiveVenue(tx, input.fromVenueId, 'share')
      if (source.refused !== null) {
        return failure('unknown_source', venueRefusalText(input.fromVenueId, source.refused))
      }
      if (await isTillFed(tx, input.fromVenueId)) return tillVenue()
      const sourceMenu = await menuOf(tx, input.fromVenueId, input.fromMenuId)
      if (sourceMenu === undefined || sourceMenu.deletedAt !== null) {
        return failure('unknown_source', `the source venue has no menu ${input.fromMenuId} in use`)
      }
      const doc = await readMenuDocument(tx, input.fromMenuId)

      const sortKey = keyAt(await venueMenuOrder(tx, input.toVenueId), 'end', null)
      if (sortKey === null) return failure('invalid_input', 'no position for the new menu')
      const row = await insertMenuRow(
        tx,
        tenantId,
        input.toVenueId,
        name.name ?? sourceMenu.name,
        sortKey,
      )
      const liveMenuId =
        venue.liveMenuId === null
          ? await adoptLiveMenu(tx, input.toVenueId, row.id)
          : venue.liveMenuId

      // New ids for every copied node; parents before children, siblings in their order.
      const copies = new Map<NodeId, NodeId>()
      copies.set(doc.menu.rootNodeId, row.id as NodeId)
      const ops: ChangeSetOp[] = []
      const counts = {
        sections: 0,
        items: 0,
        modifierGroups: 0,
        options: 0,
        values: 0,
        placements: 0,
      }
      const byParent = new Map<NodeId | null, (typeof doc.nodes)[number][]>()
      for (const node of doc.nodes) {
        if (node.status === 'archived' || node.type === 'menu') continue
        const siblings = byParent.get(node.parentId) ?? []
        siblings.push(node)
        byParent.set(node.parentId, siblings)
      }
      const refOf = (id: NodeId): NodeRef => ({ id: copies.get(id) ?? id })
      const copyValues = (from: NodeId, to: NodeId) => {
        for (const value of doc.values) {
          if (value.nodeId !== from || !value.valid) continue
          if (value.layer !== 'manual' || value.scope !== 'master') continue
          if (NOT_COPIED_FIELDS.has(value.fieldKey)) continue
          ops.push({
            op: 'setField',
            node: { id: to },
            fieldKey: value.fieldKey,
            layer: 'manual',
            scope: 'master',
            value: value.value as FieldWrite['value'],
          })
          counts.values += 1
        }
      }
      const copyChildren = (parentId: NodeId | null) => {
        const children = [...(byParent.get(parentId) ?? [])].sort((a, b) =>
          (a.sortKey ?? '') < (b.sortKey ?? '')
            ? -1
            : (a.sortKey ?? '') > (b.sortKey ?? '')
              ? 1
              : 0,
        )
        for (const node of children) {
          const id = newId('nd')
          copies.set(node.id, id)
          ops.push({
            op: 'createNode',
            id,
            nodeType: node.type,
            parent: parentId === null ? null : refOf(parentId),
            status: node.status === 'hidden' ? 'hidden' : 'active',
            ...(node.sortKey === null ? {} : { sortKey: node.sortKey }),
          })
          if (node.type === 'section' || node.type === 'special') counts.sections += 1
          else if (node.type === 'item') counts.items += 1
          else if (node.type === 'modifier_group') counts.modifierGroups += 1
          else if (node.type === 'option') counts.options += 1
          copyValues(node.id, id)
          copyChildren(node.id)
        }
      }
      // Sections and specials under the root, with everything beneath them; then the items the
      // document holds (those placed in a section of the menu) with their groups and options.
      copyChildren(doc.menu.rootNodeId)
      for (const node of doc.nodes) {
        if (node.type !== 'item' || node.status === 'archived') continue
        const id = newId('nd')
        copies.set(node.id, id)
        ops.push({
          op: 'createNode',
          id,
          nodeType: 'item',
          parent: null,
          status: node.status === 'hidden' ? 'hidden' : 'active',
        })
        counts.items += 1
        copyValues(node.id, id)
        copyChildren(node.id)
      }
      for (const placement of doc.placements) {
        const item = copies.get(placement.itemId)
        const section = copies.get(placement.sectionId)
        if (item === undefined || section === undefined) continue
        ops.push({
          op: 'setPlacement',
          item: { id: item },
          section: { id: section },
          sortKey: placement.sortKey,
        })
        counts.placements += 1
      }

      const changeSet: ChangeSet = {
        id: newId('cs'),
        source: 'manual',
        jobId: newId('jb'),
        actor: actor.data,
        observedAt: (options.now ?? new Date()).toISOString(),
        ops,
      }
      const result =
        ops.length === 0
          ? {
              applied: 0,
              unchanged: 0,
              skipped: 0,
              rejected: [],
              createdNodeIds: [],
              eventsWritten: 0,
            }
          : await applyInTransaction(tx, tenantId, changeSet, { atomic: true })
      return { ok: true, menu: toSummary(row, liveMenuId), copied: counts, result }
    },
  )
}
