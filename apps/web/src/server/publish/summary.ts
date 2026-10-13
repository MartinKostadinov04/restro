// The Publish bar's read (brief S4, D96): every menu of the venue (D88, D90: each has its own
// draft and published version) with its name, the areas it is routed to (D95), what a publish
// would change and why it cannot be published. Reads only, every query in `withTenant`.
//
// Each menu's draft is built exactly as a publish would (`loadDraft`) and compared with that
// menu's published version; a draft that cannot be built reports why (`blocked`), it never throws
// the whole summary away. `loadVenuePublishState` also reads what the warnings under the venue
// header need (held publishes, the pause, the address) in the same pass, and the page reads it
// once per request (`venuePublishState`).
import { guestMenuPath, type NodeId } from '@restro/core'
import {
  listMenuRoutes,
  listMenus,
  listVenueAreas,
  loadCurrentSnapshot,
  organizationAddress,
} from '@restro/core/apply'
import { type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import { cache } from 'react'

import { getPool } from '../db'
import {
  buildDraft,
  changesOf,
  heldViewOf,
  loadHeldRows,
  readBusy,
  readLastRun,
  readPaused,
  type ViewDeps,
  venueIndexServed,
} from './load'
import {
  type BusyView,
  type ChangesView,
  type DraftView,
  type HeldView,
  type PublishRunView,
  type PublishSummary,
  type PublishSummaryMenu,
  publishBlock,
  type RefusalCode,
  targetOf,
} from './view'

/** One menu with everything the bar and the warnings need. */
export interface MenuPublishState extends PublishSummaryMenu {
  readonly published: boolean
  readonly list: ChangesView | null
  readonly busy: BusyView
  /** The newest publish V11 holds for this menu, or null. */
  readonly held: HeldView | null
}

/** The venue's publishing as the page header shows it. */
export interface VenuePublishState {
  readonly venueId: string
  readonly menus: readonly MenuPublishState[]
  readonly paused: boolean
  readonly addressServed: boolean
  readonly lastRun: PublishRunView | null
}

/** A draft that could not be built, as the refusal the bar words. */
function refusalOf(view: DraftView): RefusalCode {
  if (view.state === 'nothing_visible') return 'no_visible_items'
  if (view.state === 'blocked') return 'menu_blocked'
  return 'other'
}

/** The names of the areas routed to each menu, in the areas' order. */
async function areasByMenu(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<ReadonlyMap<string, string[]>> {
  const [routes, areas] = await Promise.all([
    listMenuRoutes(pool, tenantId, venueId),
    listVenueAreas(pool, tenantId, venueId),
  ])
  const menuOfArea = new Map<string, string>()
  for (const route of routes) {
    if ('areaId' in route.target && route.menuId !== null) {
      menuOfArea.set(route.target.areaId, route.menuId)
    }
  }
  const byMenu = new Map<string, string[]>()
  for (const area of areas) {
    const menuId = menuOfArea.get(area.id)
    if (menuId === undefined) continue
    byMenu.set(menuId, [...(byMenu.get(menuId) ?? []), area.name])
  }
  return byMenu
}

/** One menu: its draft against its published version, its held publish and its jobs. */
async function menuState(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  menu: { readonly id: NodeId; readonly name: string; readonly live: boolean },
  areas: readonly string[],
  deps: ViewDeps,
): Promise<MenuPublishState> {
  const target = { menuId: menu.id, venueId }
  const [current, outcome, heldRows, busy] = await Promise.all([
    loadCurrentSnapshot(pool, tenantId, target),
    buildDraft(pool, tenantId, target, deps),
    loadHeldRows(pool, tenantId, target),
    readBusy(pool, tenantId, menu.id),
  ])
  const live = current?.body ?? null
  const list = outcome.kind === 'built' ? changesOf(live, outcome.draft.snapshot) : null
  const draftHash = outcome.kind === 'built' ? outcome.draft.snapshot.snapshot.hash : null
  const newestHeld = heldRows[0]
  return {
    menuId: menu.id,
    name: menu.name,
    live: menu.live,
    areas,
    changes: list === null ? null : list.total,
    identical: list?.identical ?? false,
    blocked: outcome.kind === 'built' ? null : refusalOf(outcome.view),
    published: current !== null,
    list,
    busy,
    held: newestHeld === undefined ? null : heldViewOf(newestHeld, live, draftHash),
  }
}

/**
 * Every menu of the venue (in the venue's order, binned ones left out) with its draft compared to
 * its published version, its held publish and its jobs; the venue's pause, whether its address is
 * served, and how the last publish run ended. A venue the tenant does not have has no menus.
 */
export async function loadVenuePublishState(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  deps: ViewDeps = {},
): Promise<VenuePublishState> {
  const [venue] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ name: venues.name, publicId: venues.publicId })
      .from(venues)
      .where(eq(venues.id, venueId)),
  )
  if (venue === undefined) {
    return { venueId, menus: [], paused: false, addressServed: true, lastRun: null }
  }
  const [menus, areas, paused, lastRun] = await Promise.all([
    listMenus(pool, tenantId, venueId),
    areasByMenu(pool, tenantId, venueId),
    readPaused(pool, tenantId, venueId),
    readLastRun(pool, tenantId),
  ])
  const states = await Promise.all(
    menus.map((menu) =>
      menuState(
        pool,
        tenantId,
        venueId,
        { id: menu.id, name: menu.name ?? venue.name, live: menu.live },
        areas.get(menu.id) ?? [],
        deps,
      ),
    ),
  )
  // The address is the live menu's: nothing published there, nothing to serve.
  const liveMenu = states.find((menu) => menu.live)
  const addressServed =
    liveMenu === undefined || !liveMenu.published
      ? true
      : await (deps.addressServed ?? venueIndexServed)({ id: venueId, publicId: venue.publicId })
  return { venueId, menus: states, paused, addressServed, lastRun }
}

/** True when a publish of at least one menu would do something (see `PublishSummary`). */
export function anythingToPublish(state: VenuePublishState): boolean {
  return state.menus.some(
    (menu) =>
      publishBlock(
        targetOf(menu, {
          canPublish: true,
          paused: state.paused,
          addressServed: state.addressServed,
        }),
        false,
      ) === null,
  )
}

/** The summary rows of a state (the pinned shape, without what only the page needs). */
export function summaryOf(state: VenuePublishState): PublishSummary {
  return {
    canPublish: anythingToPublish(state),
    addressServed: state.addressServed,
    menus: state.menus.map((menu) => ({
      menuId: menu.menuId,
      name: menu.name,
      live: menu.live,
      areas: menu.areas,
      changes: menu.changes,
      identical: menu.identical,
      blocked: menu.blocked,
    })),
  }
}

/**
 * The Publish bar's dropdown: one row per menu of the venue with its name (the header name, else
 * the venue's), its routed areas, its change count and why it is blocked (D96). `canPublish` says
 * whether a publish of any menu would do something now; the role is the caller's to check.
 */
export async function loadPublishSummary(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  deps: ViewDeps = {},
): Promise<PublishSummary> {
  return summaryOf(await loadVenuePublishState(pool, tenantId, venueId, deps))
}

/**
 * The page's read of `loadVenuePublishState`, once per request: the header's bar and the warnings
 * under it share it.
 */
export const venuePublishState = cache(
  (tenantId: string, venueId: string): Promise<VenuePublishState> =>
    loadVenuePublishState(getPool(), tenantId, venueId),
)

/**
 * The venue's guest address `/m/<organisation>/<venue>` (D84), or null when the organisation has
 * no address name (the address cannot be made).
 */
export async function guestPathOf(
  pool: DbPool,
  tenantId: string,
  venueSlug: string,
): Promise<string | null> {
  const organization = await organizationAddress(pool, tenantId)
  if (organization === null) return null
  try {
    return guestMenuPath({ organization: organization.slug, venue: venueSlug })
  } catch {
    return null
  }
}
