// Menu routing (D95, D91; adjustments M2): which menu an area or a table shows. The venue's live
// menu (`venues.live_menu_id`) is the default; a route for an area overrides it for the area's
// tables; a route for a table overrides its area's. The most specific entry wins, a level without
// one inherits, and an entry that names a menu that is not published (or is binned) falls back to
// the next level up (D91). The dictionary is rows of `menu_routes` (a side table, like the tags:
// not the menu document, so these writers do not go through apply()); `resolveRoutes` turns it
// into one menu per table, which the publisher writes into the table files (rule 4).

import {
  areas,
  type DbPool,
  menuRoutes,
  menus,
  publishPointers,
  type ReadTx,
  venues,
  venueTables,
  withTenant,
} from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { type AreaId, idSchema, type NodeId, type TableId } from '../ids'
import { lockTenantDocument } from './lock'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** An area or a table of the venue. */
export type MenuRouteTarget = { readonly areaId: AreaId } | { readonly tableId: TableId }

const TargetSchema = z.union([
  z.strictObject({ areaId: idSchema('ar') }),
  z.strictObject({ tableId: idSchema('tb') }),
])

/** One entry of the dictionary: what the target shows, or null for "no choice of its own". */
export interface MenuRoute {
  readonly target: MenuRouteTarget
  readonly menuId: NodeId | null
}

/** Why a route writer refused. Nothing is written when one is returned. */
export type MenuRouteError =
  | 'invalid_input'
  | 'unknown_venue'
  | 'venue_archived'
  /** The venue has no such area or table (or it is deleted). */
  | 'unknown_target'
  /** The venue has no such menu. */
  | 'unknown_menu'
  /** The menu is in the bin. */
  | 'menu_deleted'

/** What a route writer answers. */
export type MenuRouteResult =
  | { readonly ok: true; readonly route: MenuRoute }
  | { readonly ok: false; readonly error: MenuRouteError; readonly reason: string }

function failure(error: MenuRouteError, reason: string): MenuRouteResult {
  return { ok: false, error, reason }
}

function toRoute(row: {
  readonly areaId: string | null
  readonly tableId: string | null
  readonly menuId: string | null
}): MenuRoute {
  const target: MenuRouteTarget =
    row.areaId !== null
      ? { areaId: row.areaId as AreaId }
      : { tableId: (row.tableId ?? '') as TableId }
  return { target, menuId: (row.menuId as NodeId | null) ?? null }
}

/** The venue's routes that name a menu, areas first. */
export async function listMenuRoutes(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<MenuRoute[]> {
  if (!idSchema('vn').safeParse(venueId).success) return []
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx.select().from(menuRoutes).where(eq(menuRoutes.venueId, venueId)),
  )
  return rows
    .filter((row) => row.menuId !== null)
    .map(toRoute)
    .sort((a, b) => {
      const key = (route: MenuRoute) =>
        'areaId' in route.target ? `0:${route.target.areaId}` : `1:${route.target.tableId}`
      return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0
    })
}

/**
 * Sets what an area or a table shows: a menu of the venue, or null to take the choice away (the
 * target inherits again). Refuses a target the venue does not have and a menu that is not the
 * venue's or is binned.
 */
export async function setMenuRoute(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly target: unknown; readonly menuId: string | null },
): Promise<MenuRouteResult> {
  const target = TargetSchema.safeParse(input.target)
  if (!idSchema('vn').safeParse(input.venueId).success) {
    return failure('invalid_input', 'venueId must be a vn_ id')
  }
  if (!target.success) return failure('invalid_input', 'the target is an area or a table id')
  if (input.menuId !== null && !idSchema('nd').safeParse(input.menuId).success) {
    return failure('invalid_input', 'menuId must be an nd_ id, or null')
  }
  const { venueId, menuId } = input
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      return failure(
        locked.refused === 'venue_archived' ? 'venue_archived' : 'unknown_venue',
        venueRefusalText(venueId, locked.refused),
      )
    }
    const found =
      'areaId' in target.data
        ? await tx
            .select({ id: areas.id })
            .from(areas)
            .where(
              and(
                eq(areas.venueId, venueId),
                eq(areas.id, target.data.areaId),
                isNull(areas.archivedAt),
              ),
            )
        : await tx
            .select({ id: venueTables.id })
            .from(venueTables)
            .where(
              and(
                eq(venueTables.venueId, venueId),
                eq(venueTables.id, target.data.tableId),
                isNull(venueTables.archivedAt),
              ),
            )
    if (found.length === 0) return failure('unknown_target', 'the venue has no such area or table')
    if (menuId !== null) {
      const [menu] = await tx
        .select({ deletedAt: menus.deletedAt })
        .from(menus)
        .where(and(eq(menus.venueId, venueId), eq(menus.id, menuId)))
      if (menu === undefined) return failure('unknown_menu', `the venue has no menu ${menuId}`)
      if (menu.deletedAt !== null) return failure('menu_deleted', 'the menu is in the bin')
    }
    const where =
      'areaId' in target.data
        ? eq(menuRoutes.areaId, target.data.areaId)
        : eq(menuRoutes.tableId, target.data.tableId)
    const [existing] = await tx.select().from(menuRoutes).where(where)
    if (existing !== undefined) {
      if (existing.menuId !== menuId) {
        await tx.update(menuRoutes).set({ menuId }).where(where)
      }
      return { ok: true, route: toRoute({ ...existing, menuId }) }
    }
    await tx.insert(menuRoutes).values({
      tenantId,
      venueId,
      areaId: 'areaId' in target.data ? target.data.areaId : null,
      tableId: 'tableId' in target.data ? target.data.tableId : null,
      menuId,
    })
    return { ok: true, route: { target: target.data, menuId: menuId as NodeId | null } }
  })
}

/** The menu each area and each table shows, once the fallbacks are applied; null = nothing published. */
export interface ResolvedRoutes {
  /** The venue's live menu when it is published, else null. */
  readonly live: NodeId | null
  readonly areas: ReadonlyMap<AreaId, NodeId | null>
  readonly tables: ReadonlyMap<TableId, NodeId | null>
}

/**
 * Resolves the dictionary inside a transaction the caller owns: a menu counts only when it is
 * the venue's, not binned, and has a published version (a pointer); otherwise the next level up
 * applies, down to the live menu, down to nothing.
 */
export async function resolveRoutesIn(
  tx: ReadTx | WriteTx,
  venueId: string,
): Promise<ResolvedRoutes> {
  const [venue] = await tx
    .select({ liveMenuId: venues.liveMenuId })
    .from(venues)
    .where(eq(venues.id, venueId))
  const published = new Set<string>()
  const rows = await tx
    .select({ id: menus.id })
    .from(menus)
    .innerJoin(
      publishPointers,
      and(eq(publishPointers.menuId, menus.id), eq(publishPointers.venueId, menus.venueId)),
    )
    .where(and(eq(menus.venueId, venueId), isNull(menus.deletedAt)))
  for (const row of rows) published.add(row.id)
  const usable = (menuId: string | null | undefined): NodeId | null =>
    menuId !== null && menuId !== undefined && published.has(menuId) ? (menuId as NodeId) : null
  const live = usable(venue?.liveMenuId)

  const routes = await tx.select().from(menuRoutes).where(eq(menuRoutes.venueId, venueId))
  const areaRoute = new Map<string, string | null>()
  const tableRoute = new Map<string, string | null>()
  for (const route of routes) {
    if (route.areaId !== null) areaRoute.set(route.areaId, route.menuId)
    if (route.tableId !== null) tableRoute.set(route.tableId, route.menuId)
  }
  const areaRows = await tx
    .select({ id: areas.id })
    .from(areas)
    .where(and(eq(areas.venueId, venueId), isNull(areas.archivedAt)))
  const areaMenus = new Map<AreaId, NodeId | null>()
  for (const area of areaRows) {
    areaMenus.set(area.id as AreaId, usable(areaRoute.get(area.id)) ?? live)
  }
  const tableRows = await tx
    .select({ id: venueTables.id, areaId: venueTables.areaId })
    .from(venueTables)
    .where(and(eq(venueTables.venueId, venueId), isNull(venueTables.archivedAt)))
  const tableMenus = new Map<TableId, NodeId | null>()
  for (const table of tableRows) {
    tableMenus.set(
      table.id as TableId,
      usable(tableRoute.get(table.id)) ?? areaMenus.get(table.areaId as AreaId) ?? live,
    )
  }
  return { live, areas: areaMenus, tables: tableMenus }
}

/** `resolveRoutesIn` in a read transaction of its own. */
export function resolveRoutes(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<ResolvedRoutes> {
  return withTenant(pool, tenantId, (tx) => resolveRoutesIn(tx, venueId))
}
