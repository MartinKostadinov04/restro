// Areas, tables and their QR codes (D95, D94; brief S3-07): the writers behind the venue's
// "Tables & QR" tab, and the readers it and the worker's token job use.
//
// A venue's tables are its own rows (`areas`, `tables`), whatever filled them: a connector's
// mirror (`till-tables.ts`, through the integration layer) or the owner's hands. The platform
// knows no POS here: a table has a number (the till's or the owner's), a name of ours, an order,
// a hidden flag and, once the manager gives it one, a QR token (22 random base62 characters,
// never derived from any id: rule 3). On a venue that serves a till, areas and tables are made
// and taken away by the till alone: the manager renames, reorders and hides (D95). A venue with
// no till is the owner's: areas and tables are created and deleted here too.
//
// None of this is the menu document, so these writers do not go through apply(); only this folder
// may import the write side of the database (rule 1's door).
//
// The writers only change rows. The public file `t/<token>.json` is written and removed by the
// worker's `publish-table-tokens` job (one writer of the publish store), which every writer here
// reports the work for: `venueId` (whose job to queue) and `retired` (tokens whose file must go;
// a hidden table keeps its token but has no file, so hiding retires the file, not the token).

import {
  type AreaRow as Area,
  areas,
  type DbPool,
  type VenueTableRow as Table,
  venues,
  venueTables,
  withTenant,
} from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { tillVenueLinks } from '../connectors/till-venues'
import {
  type AreaId,
  idSchema,
  isId,
  newId,
  newTableToken,
  type TableId,
  type VenueId,
} from '../ids'
import {
  checkBaseUrl,
  checkOwnPattern,
  MAX_TABLE_LABEL_LENGTH,
  QR_MODES,
  type QrAddressProblem,
  type VenueQr,
  VenueQrSchema,
} from '../qr'
import { sortKeyBetween } from '../sort-keys'
import { resolveRoutesIn } from './menu-routes'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** The longest area name. */
export const MAX_AREA_NAME_LENGTH = 60

/** An area of the venue as the tab shows it. */
export interface VenueArea {
  readonly id: AreaId
  readonly name: string
  readonly sortKey: string
  /** A hidden area and its tables have no guest page (D95). */
  readonly hidden: boolean
  /** True for an area the till reported (its key is kept, never shown). */
  readonly fromTill: boolean
}

/** A table as the tab shows it. No till id anywhere (rule 3). */
export interface VenueTable {
  readonly id: TableId
  readonly areaId: AreaId
  /** The till's number for it, or the owner's; null only when `name` is set. */
  readonly number: string | null
  /** Our name for it, or null (guests then see `number`). */
  readonly name: string | null
  readonly sortKey: string
  /** A hidden table has no guest page (D95); its token, if any, is kept for when it is shown. */
  readonly hidden: boolean
  /** The QR token, or null when the table has no code. */
  readonly token: string | null
}

/** What guests call a table: our name, else its number (one of the two is always there). */
export function tableLabel(table: Pick<VenueTable, 'name' | 'number'>): string {
  return (table.name ?? table.number ?? '').trim() || '—'
}

/** Why a table writer refused. Nothing is written when one is returned. */
export type TableWriteError =
  /** An id, name or setting that is not shaped right. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'unknown_venue'
  /** The venue was deleted (archived, D76): its tables are not edited until it is restored. */
  | 'venue_archived'
  /** The tenant has no such table (or it is deleted). */
  | 'unknown_table'
  /** The tenant has no such area (or it is deleted). */
  | 'unknown_area'
  /** The table has neither a name of its own nor a number: there is nothing to show a guest. */
  | 'no_label'
  /** The table or its area is hidden: it gets no code (D95). */
  | 'hidden'
  /** The venue's areas and tables come from its till: they are not created or deleted here. */
  | 'from_till'

/** A refused write. `field` and `problem` say which setting and why, for a bad address. */
export interface TableWriteRefusal {
  readonly ok: false
  readonly error: TableWriteError
  readonly reason: string
  readonly field?: 'baseUrl' | 'ownPattern'
  readonly problem?: QrAddressProblem
}

/** What a writer that changed one table answers. */
export interface TableChange {
  readonly ok: true
  /** Our venue the table belongs to: the token job to queue is for this venue. */
  readonly venueId: VenueId
  readonly table: VenueTable
  /** A token whose file must be removed because of this change (retired or hidden). Else null. */
  readonly retired: string | null
}

/** What a writer that changed one area answers. */
export interface AreaChange {
  readonly ok: true
  readonly venueId: VenueId
  readonly area: VenueArea
  /** Tokens whose files must go because of this change (the area's tables, hidden or deleted). */
  readonly retired: readonly string[]
}

/** What `issueAllTableTokens` answers. */
export type IssueAllResult =
  | {
      readonly ok: true
      readonly venueId: VenueId
      /** How many tables got a code. */
      readonly issued: number
      /** Tables left without one because they have neither a name nor a number (always 0 now). */
      readonly skippedNoLabel: number
    }
  | TableWriteRefusal

function refusal(error: TableWriteError, reason: string): TableWriteRefusal {
  return { ok: false, error, reason }
}

function toArea(row: Area): VenueArea {
  return {
    id: row.id as AreaId,
    name: row.name,
    sortKey: row.sortKey,
    hidden: row.hidden,
    fromTill: row.sourceKey !== null,
  }
}

function toTable(row: Table): VenueTable {
  return {
    id: row.id as TableId,
    areaId: row.areaId as AreaId,
    number: row.number,
    name: row.name,
    sortKey: row.sortKey,
    hidden: row.hidden,
    token: row.qrToken,
  }
}

/** Tidies a typed name: one space between words, no edges; null when nothing is left. */
function tidy(text: string | null): string | null {
  const value = text === null ? '' : text.trim().replace(/\s+/g, ' ')
  return value === '' ? null : value
}

/** The greatest order key among `rows`, or null when there are none. */
function lastSortKey(rows: readonly { readonly sortKey: string }[]): string | null {
  return rows.reduce<string | null>(
    (max, row) => (max === null || row.sortKey > max ? row.sortKey : max),
    null,
  )
}

// --- reading ------------------------------------------------------------------------------------

/** The venue's areas that are not deleted, in their order. */
export async function listVenueAreas(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<VenueArea[]> {
  if (!isId('vn', venueId)) return []
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select()
      .from(areas)
      .where(and(eq(areas.venueId, venueId), isNull(areas.archivedAt)))
      .orderBy(asc(areas.sortKey), asc(areas.id)),
  )
  return rows.map(toArea)
}

/**
 * The venue's tables that are not deleted, by area (in the areas' order) and then in their own
 * order. Tables of a deleted area are left out.
 */
export async function listVenueTables(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<VenueTable[]> {
  if (!isId('vn', venueId)) return []
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ table: venueTables })
      .from(venueTables)
      .innerJoin(areas, eq(areas.id, venueTables.areaId))
      .where(
        and(
          eq(venueTables.venueId, venueId),
          isNull(venueTables.archivedAt),
          isNull(areas.archivedAt),
        ),
      )
      .orderBy(asc(areas.sortKey), asc(areas.id), asc(venueTables.sortKey), asc(venueTables.id)),
  )
  return rows.map((row) => toTable(row.table))
}

/** One table with the venue it belongs to, or null (also for a table of another tenant). */
export async function findVenueTable(
  pool: DbPool,
  tenantId: string,
  tableId: string,
): Promise<{ readonly venueId: VenueId; readonly table: VenueTable } | null> {
  if (!isId('tb', tableId)) return null
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx.select().from(venueTables).where(eq(venueTables.id, tableId)),
  )
  if (row === undefined || row.archivedAt !== null) return null
  return { venueId: row.venueId as VenueId, table: toTable(row) }
}

/**
 * What the token job writes for a venue: its public code and slug and, per code that leads
 * somewhere, the table's name and the menu it shows.
 */
export interface TokenFiles {
  readonly venuePublicId: string
  readonly venueSlug: string
  /**
   * The venue was deleted (D76): it should have no files at all (`files` is empty, whatever its
   * tables hold). The job withdraws the files it is told about (`retired`) instead.
   */
  readonly archived: boolean
  readonly files: readonly {
    readonly token: string
    readonly tableLabel: string
    /** The menu the code opens (D95), or null when the venue has nothing published. */
    readonly menuId: string | null
  }[]
}

/**
 * The files `t/<token>.json` a venue should have: one per table with a code that is shown (the
 * table and its area not hidden, neither deleted). A deleted venue (`archived`) should have none.
 * Null when the tenant has no such venue.
 */
export async function loadTokenFiles(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<TokenFiles | null> {
  if (!isId('vn', venueId)) return null
  return withTenant(pool, tenantId, async (tx) => {
    const [venue] = await tx
      .select({ slug: venues.slug, publicId: venues.publicId, archivedAt: venues.archivedAt })
      .from(venues)
      .where(eq(venues.id, venueId))
    if (venue === undefined) return null
    if (venue.archivedAt !== null) {
      return { venuePublicId: venue.publicId, venueSlug: venue.slug, archived: true, files: [] }
    }
    const rows = await tx
      .select({ table: venueTables })
      .from(venueTables)
      .innerJoin(areas, eq(areas.id, venueTables.areaId))
      .where(
        and(
          eq(venueTables.venueId, venueId),
          isNull(venueTables.archivedAt),
          eq(venueTables.hidden, false),
          isNull(areas.archivedAt),
          eq(areas.hidden, false),
        ),
      )
      .orderBy(asc(venueTables.id))
    const routes = await resolveRoutesIn(tx, venueId)
    const files: { token: string; tableLabel: string; menuId: string | null }[] = []
    for (const { table } of rows) {
      if (table.qrToken === null) continue
      files.push({
        token: table.qrToken,
        tableLabel: tableLabel(table),
        menuId: routes.tables.get(table.id as TableId) ?? null,
      })
    }
    return { venuePublicId: venue.publicId, venueSlug: venue.slug, archived: false, files }
  })
}

// --- locking ------------------------------------------------------------------------------------

const UNKNOWN_TABLE = 'this venue has no such table'
const UNKNOWN_AREA = 'this venue has no such area'

/** The venue locked live for an edit of its tables; a refusal for a missing or deleted venue. */
async function lockVenue(
  tx: WriteTx,
  venueId: string,
  strength: 'share' | 'update' = 'share',
): Promise<TableWriteRefusal | null> {
  const locked = await lockLiveVenue(tx, venueId, strength)
  if (locked.refused === null) return null
  return refusal(
    locked.refused === 'venue_archived' ? 'venue_archived' : 'unknown_venue',
    venueRefusalText(venueId, locked.refused),
  )
}

/**
 * The table with its area, locked for the rest of the transaction; a refusal when it is not
 * usable: no such table (or deleted, or its area deleted) or a venue that was deleted. The venue
 * is locked live after the table, so a table edit and the deletion of its venue never interleave.
 */
async function lockTable(
  tx: WriteTx,
  tableId: string,
): Promise<{ table: Table; area: Area } | TableWriteRefusal> {
  if (!isId('tb', tableId)) return refusal('unknown_table', UNKNOWN_TABLE)
  // Lock the row alone: Postgres wants `FOR UPDATE OF` to name a relation without its schema,
  // which the query builder does not write, so the lock and the join are two queries.
  const [table] = await tx
    .select()
    .from(venueTables)
    .where(eq(venueTables.id, tableId))
    .for('update')
  if (table === undefined || table.archivedAt !== null) {
    return refusal('unknown_table', UNKNOWN_TABLE)
  }
  const refused = await lockVenue(tx, table.venueId)
  if (refused !== null) {
    return refused.error === 'venue_archived' ? refused : refusal('unknown_table', UNKNOWN_TABLE)
  }
  const [area] = await tx.select().from(areas).where(eq(areas.id, table.areaId))
  if (area === undefined || area.archivedAt !== null) {
    return refusal('unknown_table', UNKNOWN_TABLE)
  }
  return { table, area }
}

/** The area locked for the rest of the transaction, with its venue locked live. */
async function lockArea(tx: WriteTx, areaId: string): Promise<Area | TableWriteRefusal> {
  if (!isId('ar', areaId)) return refusal('unknown_area', UNKNOWN_AREA)
  const [area] = await tx.select().from(areas).where(eq(areas.id, areaId)).for('update')
  if (area === undefined || area.archivedAt !== null) return refusal('unknown_area', UNKNOWN_AREA)
  const refused = await lockVenue(tx, area.venueId)
  if (refused !== null) {
    return refused.error === 'venue_archived' ? refused : refusal('unknown_area', UNKNOWN_AREA)
  }
  return area
}

/** True when the venue serves a till venue: its areas and tables are the till's to make (D95). */
async function servesTill(tx: WriteTx, venueId: string): Promise<boolean> {
  const [link] = await tx
    .select({ bid: tillVenueLinks.bid })
    .from(tillVenueLinks)
    .where(eq(tillVenueLinks.venueId, venueId))
    .limit(1)
  return link !== undefined
}

async function updatedTable(tx: WriteTx, tableId: string, set: Partial<Table>): Promise<Table> {
  const [row] = await tx.update(venueTables).set(set).where(eq(venueTables.id, tableId)).returning()
  if (row === undefined) throw new Error(UNKNOWN_TABLE)
  return row
}

async function updatedArea(tx: WriteTx, areaId: string, set: Partial<Area>): Promise<Area> {
  const [row] = await tx.update(areas).set(set).where(eq(areas.id, areaId)).returning()
  if (row === undefined) throw new Error(UNKNOWN_AREA)
  return row
}

/** The tokens of the area's live tables (their files go when the area is hidden or deleted). */
async function tokensOfArea(tx: WriteTx, areaId: string): Promise<string[]> {
  const rows = await tx
    .select({ token: venueTables.qrToken })
    .from(venueTables)
    .where(and(eq(venueTables.areaId, areaId), isNull(venueTables.archivedAt)))
  return rows.flatMap((row) => (row.token === null ? [] : [row.token])).sort()
}

/** The live tables of an area in their order, without `except`. */
async function orderedTables(
  tx: WriteTx,
  areaId: string,
  except: string,
): Promise<{ id: string; sortKey: string }[]> {
  const rows = await tx
    .select({ id: venueTables.id, sortKey: venueTables.sortKey })
    .from(venueTables)
    .where(and(eq(venueTables.areaId, areaId), isNull(venueTables.archivedAt)))
    .orderBy(asc(venueTables.sortKey), asc(venueTables.id))
  return rows.filter((row) => row.id !== except)
}

// --- writing: one table -------------------------------------------------------------------------

/**
 * Gives a table a new code: a table without one gets its first, a table with one gets a different
 * one and the old token is returned as `retired` (the printed sticker stops working). Refused for
 * a hidden table or one in a hidden area (`hidden`, D95).
 */
export async function issueTableToken(
  pool: DbPool,
  tenantId: string,
  tableId: string,
): Promise<TableChange | TableWriteRefusal> {
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, tableId)
    if ('ok' in found) return found
    if (found.table.hidden || found.area.hidden) {
      return refusal('hidden', 'a hidden table gets no code')
    }
    const updated = await updatedTable(tx, found.table.id, { qrToken: newTableToken() })
    return {
      ok: true,
      venueId: found.table.venueId as VenueId,
      table: toTable(updated),
      retired: found.table.qrToken,
    } as const
  })
}

/** Turns a table's code off: its token is returned as `retired` (null if it had none). */
export async function retireTableToken(
  pool: DbPool,
  tenantId: string,
  tableId: string,
): Promise<TableChange | TableWriteRefusal> {
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, tableId)
    if ('ok' in found) return found
    const venueId = found.table.venueId as VenueId
    if (found.table.qrToken === null) {
      return { ok: true, venueId, table: toTable(found.table), retired: null }
    }
    const updated = await updatedTable(tx, found.table.id, { qrToken: null })
    return { ok: true, venueId, table: toTable(updated), retired: found.table.qrToken } as const
  })
}

/**
 * Sets the name guests see for a table, or clears it (`null`, or only spaces) so its number is
 * used again. At most 40 characters. A table with no number cannot lose its name (`no_label`).
 */
export async function setTableName(
  pool: DbPool,
  tenantId: string,
  tableId: string,
  name: string | null,
): Promise<TableChange | TableWriteRefusal> {
  const next = tidy(name)
  if (next !== null && next.length > MAX_TABLE_LABEL_LENGTH) {
    return refusal('invalid_input', `a table name has at most ${MAX_TABLE_LABEL_LENGTH} characters`)
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, tableId)
    if ('ok' in found) return found
    if (next === null && found.table.number === null) {
      return refusal('no_label', 'the table has no number, so it needs a name')
    }
    const updated = await updatedTable(tx, found.table.id, { name: next })
    return {
      ok: true,
      venueId: found.table.venueId as VenueId,
      table: toTable(updated),
      retired: null,
    } as const
  })
}

/**
 * Sets the number guests see when a table has no name (the owner's tables only: a till's number
 * follows the till, `from_till`). At most 40 characters; a table with no name cannot lose its
 * number (`no_label`).
 */
export async function setTableNumber(
  pool: DbPool,
  tenantId: string,
  tableId: string,
  number: string | null,
): Promise<TableChange | TableWriteRefusal> {
  const next = tidy(number)
  if (next !== null && next.length > MAX_TABLE_LABEL_LENGTH) {
    return refusal(
      'invalid_input',
      `a table number has at most ${MAX_TABLE_LABEL_LENGTH} characters`,
    )
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, tableId)
    if ('ok' in found) return found
    if (await servesTill(tx, found.table.venueId)) {
      return refusal('from_till', 'the number comes from the till')
    }
    if (next === null && found.table.name === null) {
      return refusal('no_label', 'the table has no name, so it needs a number')
    }
    const updated = await updatedTable(tx, found.table.id, { number: next })
    return {
      ok: true,
      venueId: found.table.venueId as VenueId,
      table: toTable(updated),
      retired: null,
    } as const
  })
}

/**
 * Hides a table (its code stops leading anywhere while hidden: the token is kept and returned as
 * `retired` so its file goes) or shows it again (the file comes back with the venue's next
 * token job; `retired` is null).
 */
export async function setTableHidden(
  pool: DbPool,
  tenantId: string,
  tableId: string,
  hidden: boolean,
): Promise<TableChange | TableWriteRefusal> {
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, tableId)
    if ('ok' in found) return found
    const venueId = found.table.venueId as VenueId
    if (found.table.hidden === hidden) {
      return { ok: true, venueId, table: toTable(found.table), retired: null }
    }
    const updated = await updatedTable(tx, found.table.id, { hidden })
    return {
      ok: true,
      venueId,
      table: toTable(updated),
      retired: hidden ? found.table.qrToken : null,
    } as const
  })
}

/**
 * Moves a table: into `areaId` (an area of the same venue), after the table `after` (null =
 * first in the area). Its code and name travel with it.
 */
export async function moveTable(
  pool: DbPool,
  tenantId: string,
  input: { readonly tableId: string; readonly areaId: string; readonly after: string | null },
): Promise<TableChange | TableWriteRefusal> {
  if (input.after !== null && !isId('tb', input.after)) {
    return refusal('invalid_input', '`after` must be a tb_ id or null')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, input.tableId)
    if ('ok' in found) return found
    const venueId = found.table.venueId as VenueId
    const area = await lockArea(tx, input.areaId)
    if ('ok' in area) return area
    if (area.venueId !== found.table.venueId) return refusal('unknown_area', UNKNOWN_AREA)
    const siblings = await orderedTables(tx, area.id, found.table.id)
    const at = input.after === null ? -1 : siblings.findIndex((row) => row.id === input.after)
    if (input.after !== null && at === -1) return refusal('unknown_table', UNKNOWN_TABLE)
    const sortKey = sortKeyBetween(siblings[at]?.sortKey ?? null, siblings[at + 1]?.sortKey ?? null)
    const updated = await updatedTable(tx, found.table.id, { areaId: area.id, sortKey })
    return { ok: true, venueId, table: toTable(updated), retired: null } as const
  })
}

// --- writing: areas -----------------------------------------------------------------------------

/** Renames an area: trimmed, 1 to 60 characters. */
export async function renameArea(
  pool: DbPool,
  tenantId: string,
  areaId: string,
  name: string,
): Promise<AreaChange | TableWriteRefusal> {
  const next = tidy(name)
  if (next === null || next.length > MAX_AREA_NAME_LENGTH) {
    return refusal('invalid_input', `an area name has 1 to ${MAX_AREA_NAME_LENGTH} characters`)
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const area = await lockArea(tx, areaId)
    if ('ok' in area) return area
    const updated = area.name === next ? area : await updatedArea(tx, area.id, { name: next })
    return {
      ok: true,
      venueId: area.venueId as VenueId,
      area: toArea(updated),
      retired: [],
    } as const
  })
}

/** Hides an area and its tables (their files go; the tokens stay), or shows it again. */
export async function setAreaHidden(
  pool: DbPool,
  tenantId: string,
  areaId: string,
  hidden: boolean,
): Promise<AreaChange | TableWriteRefusal> {
  return withTenantWrite(pool, tenantId, async (tx) => {
    const area = await lockArea(tx, areaId)
    if ('ok' in area) return area
    const venueId = area.venueId as VenueId
    if (area.hidden === hidden) return { ok: true, venueId, area: toArea(area), retired: [] }
    const updated = await updatedArea(tx, area.id, { hidden })
    const retired = hidden ? await tokensOfArea(tx, area.id) : []
    return { ok: true, venueId, area: toArea(updated), retired } as const
  })
}

/** Moves an area after the area `after` (null = first). */
export async function moveArea(
  pool: DbPool,
  tenantId: string,
  areaId: string,
  after: string | null,
): Promise<AreaChange | TableWriteRefusal> {
  if (after !== null && !isId('ar', after)) {
    return refusal('invalid_input', '`after` must be an ar_ id or null')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const area = await lockArea(tx, areaId)
    if ('ok' in area) return area
    const siblings = (
      await tx
        .select({ id: areas.id, sortKey: areas.sortKey })
        .from(areas)
        .where(and(eq(areas.venueId, area.venueId), isNull(areas.archivedAt)))
        .orderBy(asc(areas.sortKey), asc(areas.id))
    ).filter((row) => row.id !== area.id)
    const at = after === null ? -1 : siblings.findIndex((row) => row.id === after)
    if (after !== null && at === -1) return refusal('unknown_area', UNKNOWN_AREA)
    const sortKey = sortKeyBetween(siblings[at]?.sortKey ?? null, siblings[at + 1]?.sortKey ?? null)
    const updated = await updatedArea(tx, area.id, { sortKey })
    return {
      ok: true,
      venueId: area.venueId as VenueId,
      area: toArea(updated),
      retired: [],
    } as const
  })
}

/** Adds an area to a venue that has no till (D95), last in order. */
export async function createArea(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  name: string,
): Promise<AreaChange | TableWriteRefusal> {
  if (!isId('vn', venueId)) return refusal('invalid_input', 'venueId must be a vn_ id')
  const next = tidy(name)
  if (next === null || next.length > MAX_AREA_NAME_LENGTH) {
    return refusal('invalid_input', `an area name has 1 to ${MAX_AREA_NAME_LENGTH} characters`)
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const refused = await lockVenue(tx, venueId, 'update')
    if (refused !== null) return refused
    if (await servesTill(tx, venueId)) {
      return refusal('from_till', 'the areas of this venue come from its till')
    }
    const all = await tx
      .select({ sortKey: areas.sortKey })
      .from(areas)
      .where(eq(areas.venueId, venueId))
    const [row] = await tx
      .insert(areas)
      .values({
        id: newId('ar'),
        tenantId,
        venueId,
        name: next,
        sortKey: sortKeyBetween(lastSortKey(all), null),
      })
      .returning()
    if (row === undefined) throw new Error('the area was not created')
    return { ok: true, venueId: venueId as VenueId, area: toArea(row), retired: [] } as const
  })
}

/** Adds a table to an area of a venue that has no till (D95), last in the area. */
export async function createTable(
  pool: DbPool,
  tenantId: string,
  input: { readonly areaId: string; readonly name: string | null; readonly number: string | null },
): Promise<TableChange | TableWriteRefusal> {
  const name = tidy(input.name)
  const number = tidy(input.number)
  if (name === null && number === null) {
    return refusal('no_label', 'a table needs a name or a number')
  }
  for (const value of [name, number]) {
    if (value !== null && value.length > MAX_TABLE_LABEL_LENGTH) {
      return refusal(
        'invalid_input',
        `a table name has at most ${MAX_TABLE_LABEL_LENGTH} characters`,
      )
    }
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const area = await lockArea(tx, input.areaId)
    if ('ok' in area) return area
    if (await servesTill(tx, area.venueId)) {
      return refusal('from_till', 'the tables of this venue come from its till')
    }
    const all = await tx
      .select({ sortKey: venueTables.sortKey })
      .from(venueTables)
      .where(eq(venueTables.areaId, area.id))
    const [row] = await tx
      .insert(venueTables)
      .values({
        id: newId('tb'),
        tenantId,
        venueId: area.venueId,
        areaId: area.id,
        name,
        number,
        sortKey: sortKeyBetween(lastSortKey(all), null),
      })
      .returning()
    if (row === undefined) throw new Error('the table was not created')
    return {
      ok: true,
      venueId: area.venueId as VenueId,
      table: toTable(row),
      retired: null,
    } as const
  })
}

/** Deletes a table of a venue that has no till (D95): it is archived and its code retired. */
export async function deleteTable(
  pool: DbPool,
  tenantId: string,
  tableId: string,
): Promise<TableChange | TableWriteRefusal> {
  return withTenantWrite(pool, tenantId, async (tx) => {
    const found = await lockTable(tx, tableId)
    if ('ok' in found) return found
    if (await servesTill(tx, found.table.venueId)) {
      return refusal('from_till', 'the tables of this venue come from its till')
    }
    const updated = await updatedTable(tx, found.table.id, {
      archivedAt: new Date(),
      qrToken: null,
    })
    return {
      ok: true,
      venueId: found.table.venueId as VenueId,
      table: toTable(updated),
      retired: found.table.qrToken,
    } as const
  })
}

/** Deletes an area of a venue that has no till (D95), with its tables; their codes are retired. */
export async function deleteArea(
  pool: DbPool,
  tenantId: string,
  areaId: string,
): Promise<AreaChange | TableWriteRefusal> {
  return withTenantWrite(pool, tenantId, async (tx) => {
    const area = await lockArea(tx, areaId)
    if ('ok' in area) return area
    if (await servesTill(tx, area.venueId)) {
      return refusal('from_till', 'the areas of this venue come from its till')
    }
    const retired = await tokensOfArea(tx, area.id)
    const now = new Date()
    await tx
      .update(venueTables)
      .set({ archivedAt: now, qrToken: null })
      .where(and(eq(venueTables.areaId, area.id), isNull(venueTables.archivedAt)))
    const updated = await updatedArea(tx, area.id, { archivedAt: now })
    return { ok: true, venueId: area.venueId as VenueId, area: toArea(updated), retired } as const
  })
}

// --- writing: the venue -------------------------------------------------------------------------

/**
 * Gives a code to every shown table of the venue that has none (hidden tables and tables of
 * hidden areas get none, D95). Tables that have a code are left alone.
 */
export async function issueAllTableTokens(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<IssueAllResult> {
  if (!isId('vn', venueId)) return refusal('invalid_input', 'venueId must be a vn_ id')
  return withTenantWrite(pool, tenantId, async (tx) => {
    const refused = await lockVenue(tx, venueId)
    if (refused !== null) return refused
    const candidates = await tx
      .select({ id: venueTables.id })
      .from(venueTables)
      .innerJoin(areas, eq(areas.id, venueTables.areaId))
      .where(
        and(
          eq(venueTables.venueId, venueId),
          isNull(venueTables.archivedAt),
          eq(venueTables.hidden, false),
          isNull(venueTables.qrToken),
          isNull(areas.archivedAt),
          eq(areas.hidden, false),
        ),
      )
    // Lock them (in id order, so two runs cannot wait for each other) and look again: a sync or
    // another manager may have changed one in between.
    const rows =
      candidates.length === 0
        ? []
        : await tx
            .select({ id: venueTables.id })
            .from(venueTables)
            .where(
              and(
                inArray(
                  venueTables.id,
                  candidates.map((candidate) => candidate.id),
                ),
                isNull(venueTables.archivedAt),
                eq(venueTables.hidden, false),
                isNull(venueTables.qrToken),
              ),
            )
            .orderBy(asc(venueTables.id))
            .for('update')
    for (const row of rows) {
      await tx
        .update(venueTables)
        .set({ qrToken: newTableToken() })
        .where(eq(venueTables.id, row.id))
    }
    return {
      ok: true,
      venueId: venueId as VenueId,
      issued: rows.length,
      skippedNoLabel: 0,
    } as const
  })
}

const QrSettingsInputSchema = z.strictObject({
  venueId: idSchema('vn'),
  mode: z.enum(QR_MODES),
  /** The base address of "our link", or null to use the app's own address from the environment. */
  baseUrl: z.string().nullable(),
  /** The venue's own pattern with `{token}`, or null for none. Required when `mode` is `own`. */
  ownPattern: z.string().nullable(),
})

/** What `setVenueQrSettings` needs. */
export type SetVenueQrSettingsInput = z.input<typeof QrSettingsInputSchema>

/** What `setVenueQrSettings` answers: the setting as stored. */
export type VenueQrSaved = { readonly ok: true; readonly qr: VenueQr } | TableWriteRefusal

/**
 * Saves which address the venue's codes carry (`venues.settings.qr`). Every address given is
 * checked (`checkBaseUrl`, `checkOwnPattern`); `own` needs a pattern. Both addresses are kept
 * whichever mode is chosen. Other keys of `venues.settings` are left alone. Codes already printed
 * keep their old address: the token files do not hold it, so no job is needed. (D94 takes this
 * setting off the screen; the writer stays until custom domains replace it.)
 */
export async function setVenueQrSettings(
  pool: DbPool,
  tenantId: string,
  input: SetVenueQrSettingsInput,
): Promise<VenueQrSaved> {
  const parsed = QrSettingsInputSchema.safeParse(input)
  if (!parsed.success) return refusal('invalid_input', z.prettifyError(parsed.error))
  const { venueId, mode } = parsed.data

  let baseUrl: string | undefined
  if (parsed.data.baseUrl !== null && parsed.data.baseUrl.trim() !== '') {
    const checked = checkBaseUrl(parsed.data.baseUrl)
    if (!checked.ok) {
      return {
        ...refusal('invalid_input', `the base address is not usable (${checked.problem})`),
        field: 'baseUrl',
        problem: checked.problem,
      }
    }
    baseUrl = checked.value
  }
  let ownPattern: string | undefined
  if (parsed.data.ownPattern !== null && parsed.data.ownPattern.trim() !== '') {
    const checked = checkOwnPattern(parsed.data.ownPattern)
    if (!checked.ok) {
      return {
        ...refusal('invalid_input', `the pattern is not usable (${checked.problem})`),
        field: 'ownPattern',
        problem: checked.problem,
      }
    }
    ownPattern = checked.value
  }
  if (mode === 'own' && ownPattern === undefined) {
    return {
      ...refusal('invalid_input', 'the venue’s own link needs a pattern'),
      field: 'ownPattern',
      problem: 'empty',
    }
  }
  const qr: VenueQr = VenueQrSchema.parse({
    mode,
    ...(baseUrl === undefined ? {} : { base_url: baseUrl }),
    ...(ownPattern === undefined ? {} : { own_pattern: ownPattern }),
  })

  return withTenantWrite(pool, tenantId, async (tx) => {
    const refused = await lockVenue(tx, venueId, 'update')
    if (refused !== null) return refused
    const [venue] = await tx
      .select({ settings: venues.settings })
      .from(venues)
      .where(eq(venues.id, venueId))
    await tx
      .update(venues)
      .set({ settings: { ...(venue?.settings ?? {}), qr } })
      .where(eq(venues.id, venueId))
    return { ok: true, qr } as const
  })
}
