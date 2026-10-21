// The Tables & QR tab's server side (briefs S3-07 and S5): what the tab shows, and the actions
// behind its buttons. The writes are core/apply's (`tables.ts`, `menu-routes.ts`); this file decides
// who may ask (owners and admins, like the Integration tab), checks that what is named belongs to
// the venue, shapes the answers, and queues the worker's `publish-table-tokens` job whenever a
// public file must go or change. The web app never writes the publish store: the job is the one
// writer of the `t/<token>.json` files.
//
// Nothing here fetches an address. The codes lead to this installation's address (address.ts, D94).
import {
  JOB_NAMES,
  type JobPayload,
  type ProducedJobName,
  type TenantId,
  type VenueId,
} from '@restro/core'
import {
  createArea,
  createTable,
  deleteArea,
  deleteTable,
  findVenueTable,
  issueAllTableTokens,
  issueTableToken,
  listMenuRoutes,
  listMenus,
  listVenueAreas,
  listVenueTables,
  type MenuRouteError,
  type MenuRouteTarget,
  type MenuSummary,
  moveArea,
  moveTable,
  renameArea,
  resolveRoutes,
  retireTableToken,
  setAreaHidden,
  setMenuRoute,
  setTableHidden,
  setTableName,
  setTableNumber,
  type TableWriteRefusal,
  tableLabel,
  type VenueTable,
} from '@restro/core/apply'
import { type DbPool, integrations, type Venue, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import { tillVenueLinks } from '../../connectors/till-venues'
import { logError } from '../log'
import { tillLabelOfKind } from '../till-label'
import { codeAddress, codeBaseUrl } from './address'
import { qrSvg } from './qr-image'
import type {
  HallView,
  MenuChoice,
  MenuLevel,
  MenuShown,
  TableRowView,
  TablesActionResult,
  TablesErrorCode,
  TablesView,
} from './view'

/** Who is asking about which venue. */
export interface TablesScope {
  readonly pool: DbPool
  /** The person's organisation: never taken from the request. */
  readonly tenantId: string
  readonly venue: Pick<Venue, 'id' | 'name'>
  /** An owner or admin of the organisation. */
  readonly canManage: boolean
}

/** What the actions need besides the database: the queue (`enqueueJob`; a fake in tests). */
export interface TablesServices {
  readonly enqueue: <N extends ProducedJobName>(
    name: N,
    data: JobPayload<N>,
  ) => Promise<string | null>
}

// --- reading ------------------------------------------------------------------------------------

/** The till's name when a till serves the venue (its areas and tables are the till's, D95), else null. */
async function tillLabelOfVenue(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<string | null> {
  const [link] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ kind: integrations.kind })
      .from(tillVenueLinks)
      .leftJoin(integrations, eq(integrations.id, tillVenueLinks.integrationId))
      .where(eq(tillVenueLinks.venueId, venueId))
      .limit(1),
  )
  if (link === undefined) return null
  return link.kind === null ? '' : tillLabelOfKind(link.kind)
}

/**
 * The names the admin lists the venue's menus by: the header name, else the venue's name (D92).
 * Menus that would read alike are numbered in the venue's order, so a picker can tell them apart.
 */
function menuChoices(summaries: readonly MenuSummary[], venueName: string): MenuChoice[] {
  const names = summaries.map((menu) => menu.name ?? venueName)
  return summaries.map((menu, index) => {
    const name = names[index] ?? venueName
    const same = names.filter((other) => other === name).length
    const nth = names.slice(0, index + 1).filter((other) => other === name).length
    return { id: menu.id, name: same > 1 ? `${name} (${nth})` : name, live: menu.live }
  })
}

function shown<Level extends MenuLevel>(
  menus: ReadonlyMap<string, string>,
  menuId: string | null | undefined,
  level: Level,
): MenuShown<Level> | null {
  if (menuId === null || menuId === undefined) return null
  const name = menus.get(menuId)
  return name === undefined ? null : { id: menuId, name, level }
}

async function toRow(
  table: VenueTable,
  active: boolean,
  baseUrl: string | null,
  render: (text: string) => Promise<string>,
  menu: MenuShown | null,
  routeMenuId: string | null,
): Promise<TableRowView> {
  // A hidden table keeps its token for when it is shown again, but its code leads nowhere now.
  const text = table.token === null || !active ? null : codeAddress(baseUrl, table.token)
  return {
    id: table.id,
    number: table.number,
    label: table.name,
    shownAs: tableLabel(table),
    isPublic: !table.hidden,
    token: table.token,
    address: text,
    qrSvg: text === null ? null : await render(text),
    menu,
    routeMenuId,
  }
}

/**
 * Reads the tab: the venue's tables by area, in the areas' and the tables' order, with their
 * codes drawn and the menu each area and table shows, and the venue's menus. `defaultBaseUrl` is
 * the installation's address from the environment (D94); `render` makes the SVG of a code (tests
 * pass a plain function).
 */
export async function loadTablesView(
  scope: TablesScope,
  defaultBaseUrl: string | null,
  render: (text: string) => Promise<string> = qrSvg,
): Promise<TablesView> {
  const [areas, tables, summaries, routes, resolved, till] = await Promise.all([
    listVenueAreas(scope.pool, scope.tenantId, scope.venue.id),
    listVenueTables(scope.pool, scope.tenantId, scope.venue.id),
    listMenus(scope.pool, scope.tenantId, scope.venue.id),
    listMenuRoutes(scope.pool, scope.tenantId, scope.venue.id),
    resolveRoutes(scope.pool, scope.tenantId, scope.venue.id),
    tillLabelOfVenue(scope.pool, scope.tenantId, scope.venue.id),
  ])
  const baseUrl = codeBaseUrl(defaultBaseUrl)
  const choices = menuChoices(summaries, scope.venue.name)
  const names = new Map(choices.map((menu) => [menu.id, menu.name] as const))

  // The entries of the dictionary that name a menu in use (a binned menu's entry counts as none).
  const routeOfArea = new Map<string, string>()
  const routeOfTable = new Map<string, string>()
  for (const route of routes) {
    if (route.menuId === null || !names.has(route.menuId)) continue
    if ('areaId' in route.target) routeOfArea.set(route.target.areaId, route.menuId)
    else routeOfTable.set(route.target.tableId, route.menuId)
  }

  const areaHidden = new Map(areas.map((area) => [area.id as string, area.hidden] as const))
  const rows = await Promise.all(
    tables.map((table) => {
      const active = !table.hidden && areaHidden.get(table.areaId) === false
      const resolvedId = resolved.tables.get(table.id) ?? null
      const own = routeOfTable.get(table.id) ?? null
      const level: MenuLevel =
        own !== null && own === resolvedId
          ? 'table'
          : routeOfArea.get(table.areaId) === resolvedId
            ? 'area'
            : 'venue'
      return toRow(table, active, baseUrl, render, shown(names, resolvedId, level), own)
    }),
  )
  const rowsByArea = new Map<string, TableRowView[]>()
  tables.forEach((table, index) => {
    const row = rows[index]
    if (row === undefined) return
    const list = rowsByArea.get(table.areaId) ?? []
    list.push(row)
    rowsByArea.set(table.areaId, list)
  })
  const halls: HallView[] = areas.map((area) => {
    const resolvedId = resolved.areas.get(area.id) ?? null
    const own = routeOfArea.get(area.id) ?? null
    return {
      id: area.id,
      name: area.name,
      isPublic: !area.hidden,
      menu: shown(names, resolvedId, own !== null && own === resolvedId ? 'area' : 'venue'),
      routeMenuId: own,
      tables: rowsByArea.get(area.id) ?? [],
    }
  })
  const withCode = tables.flatMap((table, index) => {
    const row = rows[index]
    const active = !table.hidden && areaHidden.get(table.areaId) === false
    return row !== undefined && active && table.token !== null ? [row] : []
  })
  const first = withCode[0]
  return {
    venueId: scope.venue.id,
    venueName: scope.venue.name,
    canManage: scope.canManage,
    fromTill: till !== null,
    sourceLabel: till ?? '',
    baseUrl,
    menus: choices,
    halls,
    total: rows.length,
    coded: withCode.length,
    sample:
      first === undefined || first.token === null
        ? null
        : { token: first.token, shownAs: first.shownAs },
  }
}

// --- the actions ---------------------------------------------------------------------------------

const FORBIDDEN: TablesActionResult = { ok: false, error: 'forbidden' }
const NOT_FOUND: TablesActionResult = { ok: false, error: 'not_found' }
const DONE: TablesActionResult = { ok: true, queued: true }

const REFUSALS: Record<TableWriteRefusal['error'], TablesErrorCode> = {
  invalid_input: 'invalid',
  unknown_venue: 'not_found',
  // A deleted venue (D76) is gone to this screen; its page is a 404 already.
  venue_archived: 'not_found',
  unknown_table: 'not_found',
  unknown_area: 'not_found',
  no_label: 'no_label',
  hidden: 'hidden',
  from_till: 'from_till',
}

const ROUTE_REFUSALS: Record<MenuRouteError, TablesErrorCode> = {
  invalid_input: 'invalid',
  unknown_venue: 'not_found',
  venue_archived: 'not_found',
  unknown_target: 'not_found',
  unknown_menu: 'unknown_menu',
  // A binned menu is not one the venue offers.
  menu_deleted: 'unknown_menu',
}

function refused(refusal: TableWriteRefusal): TablesActionResult {
  return { ok: false, error: REFUSALS[refusal.error] }
}

/**
 * Queues the worker's job that writes the venue's `t/<token>.json` files and removes the retired
 * ones. A failure is logged and reported as `queued: false` (the change is saved; the public file
 * is late): the next change to any code of the venue writes every file again.
 */
async function queueTokenFiles(
  scope: TablesScope,
  services: TablesServices,
  venueId: string,
  retired: readonly string[],
): Promise<boolean> {
  try {
    await services.enqueue(JOB_NAMES.publishTableTokens, {
      tenantId: scope.tenantId as TenantId,
      venueId: venueId as VenueId,
      retired: [...retired],
    })
    return true
  } catch (error) {
    logError('table_token_job_not_queued', error)
    return false
  }
}

/**
 * Answers a change that may touch the public files: the job is queued when a file must go
 * (`retired`) or a file must come or change (`publish`); a change that touches no file queues
 * nothing.
 */
async function answer(
  scope: TablesScope,
  services: TablesServices,
  venueId: string,
  retired: readonly string[],
  publish: boolean,
): Promise<TablesActionResult> {
  if (retired.length === 0 && !publish) return DONE
  return { ok: true, queued: await queueTokenFiles(scope, services, venueId, retired) }
}

/** The table, if it is a live table of this very venue. */
async function tableOfVenue(scope: TablesScope, tableId: string) {
  const found = await findVenueTable(scope.pool, scope.tenantId, tableId)
  return found !== null && found.venueId === scope.venue.id ? found.table : null
}

/** Where `moved` goes among `siblings` (already without it) for the 0-based `position`: after which one. */
function afterFor(siblings: readonly { readonly id: string }[], position: number): string | null {
  const at = Math.max(0, Math.min(position, siblings.length))
  return at === 0 ? null : (siblings[at - 1]?.id ?? null)
}

/** Gives a table a code, or a new one (the old sticker stops working). */
export async function issueCode(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await issueTableToken(scope.pool, scope.tenantId, tableId)
  if (!result.ok) return refused(result)
  const queued = await queueTokenFiles(
    scope,
    services,
    result.venueId,
    result.retired === null ? [] : [result.retired],
  )
  return { ok: true, queued }
}

/** Turns a table's code off: `/t/<token>` says "code not active" from then on. */
export async function turnOffCode(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await retireTableToken(scope.pool, scope.tenantId, tableId)
  if (!result.ok) return refused(result)
  if (result.retired === null) return DONE
  return {
    ok: true,
    queued: await queueTokenFiles(scope, services, result.venueId, [result.retired]),
  }
}

/** Names a table for the guest page, or clears the name (`null`). */
export async function renameTable(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
  label: string | null,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await setTableName(scope.pool, scope.tenantId, tableId, label)
  if (!result.ok) return refused(result)
  // Only a table with a code has a file that says its name.
  return answer(scope, services, result.venueId, [], result.table.token !== null)
}

/** Gives every shown table that has none a code. */
export async function createAllCodes(
  scope: TablesScope,
  services: TablesServices,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await issueAllTableTokens(scope.pool, scope.tenantId, scope.venue.id)
  if (!result.ok) return refused(result)
  const queued =
    result.issued === 0 ? true : await queueTokenFiles(scope, services, result.venueId, [])
  return { ok: true, queued, issued: result.issued, skippedNoLabel: result.skippedNoLabel }
}

// --- areas (brief S5) -----------------------------------------------------------------------------

/** Adds an area to a venue made by hand, last in order. */
export async function addArea(scope: TablesScope, name: string): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await createArea(scope.pool, scope.tenantId, scope.venue.id, name)
  return result.ok ? DONE : refused(result)
}

/** Renames an area; a till's area keeps its key, only our name changes. */
export async function renameAreaOf(
  scope: TablesScope,
  areaId: string,
  name: string,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const areas = await listVenueAreas(scope.pool, scope.tenantId, scope.venue.id)
  if (!areas.some((area) => area.id === areaId)) return NOT_FOUND
  const result = await renameArea(scope.pool, scope.tenantId, areaId, name)
  return result.ok ? DONE : refused(result)
}

/** Hides an area and its tables (their files go) or shows it again (their files come back). */
export async function hideArea(
  scope: TablesScope,
  services: TablesServices,
  areaId: string,
  hidden: boolean,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const areas = await listVenueAreas(scope.pool, scope.tenantId, scope.venue.id)
  if (!areas.some((area) => area.id === areaId)) return NOT_FOUND
  const result = await setAreaHidden(scope.pool, scope.tenantId, areaId, hidden)
  if (!result.ok) return refused(result)
  return answer(scope, services, result.venueId, result.retired, !hidden)
}

/** Puts an area at the 0-based `position` among the venue's areas. */
export async function moveAreaOf(
  scope: TablesScope,
  areaId: string,
  position: number,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const areas = await listVenueAreas(scope.pool, scope.tenantId, scope.venue.id)
  if (!areas.some((area) => area.id === areaId)) return NOT_FOUND
  const siblings = areas.filter((area) => area.id !== areaId)
  const result = await moveArea(scope.pool, scope.tenantId, areaId, afterFor(siblings, position))
  return result.ok ? DONE : refused(result)
}

/** Deletes an area of a venue made by hand, with its tables; their codes stop working. */
export async function removeArea(
  scope: TablesScope,
  services: TablesServices,
  areaId: string,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const areas = await listVenueAreas(scope.pool, scope.tenantId, scope.venue.id)
  if (!areas.some((area) => area.id === areaId)) return NOT_FOUND
  const result = await deleteArea(scope.pool, scope.tenantId, areaId)
  if (!result.ok) return refused(result)
  return answer(scope, services, result.venueId, result.retired, false)
}

// --- tables (brief S5) ----------------------------------------------------------------------------

/** Adds a table to an area of a venue made by hand, last in the area. */
export async function addTable(
  scope: TablesScope,
  areaId: string,
  input: { readonly number: string | null; readonly name: string | null },
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const areas = await listVenueAreas(scope.pool, scope.tenantId, scope.venue.id)
  if (!areas.some((area) => area.id === areaId)) return NOT_FOUND
  const result = await createTable(scope.pool, scope.tenantId, { areaId, ...input })
  return result.ok ? DONE : refused(result)
}

/** Sets the number of a table of a venue made by hand (a till's number follows the till). */
export async function renumberTable(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
  number: string | null,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  if ((await tableOfVenue(scope, tableId)) === null) return NOT_FOUND
  const result = await setTableNumber(scope.pool, scope.tenantId, tableId, number)
  if (!result.ok) return refused(result)
  // The number is what the file says while the table has no name.
  return answer(scope, services, result.venueId, [], result.table.token !== null)
}

/** Hides a table (its file goes, its token stays) or shows it again (its file comes back). */
export async function hideTable(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
  hidden: boolean,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  if ((await tableOfVenue(scope, tableId)) === null) return NOT_FOUND
  const result = await setTableHidden(scope.pool, scope.tenantId, tableId, hidden)
  if (!result.ok) return refused(result)
  return answer(
    scope,
    services,
    result.venueId,
    result.retired === null ? [] : [result.retired],
    !hidden && result.table.token !== null,
  )
}

/**
 * Puts a table at the 0-based `position` of an area of the venue (its own area unless `areaId`
 * names another). On a venue with a till the tables stay in the till's halls: only the order
 * within them changes, and a move to another area is refused.
 */
export async function moveTableOf(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
  areaId: string | undefined,
  position: number,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const table = await tableOfVenue(scope, tableId)
  if (table === null) return NOT_FOUND
  const target = areaId ?? table.areaId
  const [areas, tables] = await Promise.all([
    listVenueAreas(scope.pool, scope.tenantId, scope.venue.id),
    listVenueTables(scope.pool, scope.tenantId, scope.venue.id),
  ])
  if (!areas.some((area) => area.id === target)) return NOT_FOUND
  // A till's tables stay in the till's halls (D95): only their order here is ours.
  if (
    target !== table.areaId &&
    (await tillLabelOfVenue(scope.pool, scope.tenantId, scope.venue.id)) !== null
  ) {
    return { ok: false, error: 'from_till' }
  }
  const siblings = tables.filter((other) => other.areaId === target && other.id !== tableId)
  const result = await moveTable(scope.pool, scope.tenantId, {
    tableId,
    areaId: target,
    after: afterFor(siblings, position),
  })
  if (!result.ok) return refused(result)
  // Another area may show another menu (D95): the table's file says which.
  return answer(
    scope,
    services,
    result.venueId,
    [],
    target !== table.areaId && result.table.token !== null && !result.table.hidden,
  )
}

/** Deletes a table of a venue made by hand; its code stops working. */
export async function removeTable(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  if ((await tableOfVenue(scope, tableId)) === null) return NOT_FOUND
  const result = await deleteTable(scope.pool, scope.tenantId, tableId)
  if (!result.ok) return refused(result)
  return answer(
    scope,
    services,
    result.venueId,
    result.retired === null ? [] : [result.retired],
    false,
  )
}

// --- menu routing (brief S5, D95) ------------------------------------------------------------------

/**
 * Sets the menu an area or a table shows, or takes the choice away (`menuId` null: it takes the
 * next level up again). The files of the tables are written again by the token job.
 */
export async function chooseMenu(
  scope: TablesScope,
  services: TablesServices,
  target: MenuRouteTarget,
  menuId: string | null,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await setMenuRoute(scope.pool, scope.tenantId, {
    venueId: scope.venue.id,
    target,
    menuId,
  })
  if (!result.ok) return { ok: false, error: ROUTE_REFUSALS[result.error] }
  return { ok: true, queued: await queueTokenFiles(scope, services, scope.venue.id, []) }
}
