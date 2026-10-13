'use server'

// The Tables & QR tab's server actions (briefs S3-07 and S5): thin wrappers. Each checks who is
// asking (`requireTenant`: the tenant is the person's organisation, never the request's), that
// the venue is theirs and whether their role may change codes, areas, tables and menus (owners
// and admins), checks the input with Zod and calls service.ts. After a change the venue page and
// its print sheet are revalidated, so the client gets the fresh tab in the same round trip.
import { idSchema } from '@restro/core'
import { findVenueTable } from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '../db'
import { enqueueJob } from '../jobs'
import { logError } from '../log'
import { canManageIntegration } from '../roles'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import {
  addArea,
  addTable,
  chooseMenu,
  createAllCodes,
  hideArea,
  hideTable,
  issueCode,
  moveAreaOf,
  moveTableOf,
  removeArea,
  removeTable,
  renameAreaOf,
  renameTable,
  renumberTable,
  type TablesScope,
  type TablesServices,
  turnOffCode,
} from './service'
import type { TablesActionResult } from './view'

const tableId = idSchema('tb')
const areaId = idSchema('ar')
const menuId = idSchema('nd')
const venueId = idSchema('vn')
/** A zero-based place in a list. */
const position = z.number().int().min(0).max(10_000)

const OnVenue = z.strictObject({ venueId })
const OnTable = z.strictObject({ tableId })
const Rename = z.strictObject({ tableId, label: z.string().max(200).nullable() })
const CreateArea = z.strictObject({ venueId, name: z.string().max(200) })
const RenameArea = z.strictObject({ venueId, areaId, name: z.string().max(200) })
const HideArea = z.strictObject({ venueId, areaId, hidden: z.boolean() })
const MoveArea = z.strictObject({ venueId, areaId, position })
const OnArea = z.strictObject({ venueId, areaId })
const CreateTable = z.strictObject({
  venueId,
  areaId,
  number: z.string().max(200).nullable(),
  name: z.string().max(200).nullable().optional(),
})
const Renumber = z.strictObject({ venueId, tableId, number: z.string().max(200).nullable() })
const HideTable = z.strictObject({ venueId, tableId, hidden: z.boolean() })
const MoveTable = z.strictObject({
  venueId,
  tableId,
  areaId: areaId.optional(),
  position,
})
const OnVenueTable = z.strictObject({ venueId, tableId })
const MenuRoute = z.strictObject({
  venueId,
  target: z.union([z.strictObject({ areaId }), z.strictObject({ tableId })]),
  menuId: menuId.nullable(),
})

const INVALID: TablesActionResult = { ok: false, error: 'invalid' }
const NOT_FOUND: TablesActionResult = { ok: false, error: 'not_found' }

const services: TablesServices = { enqueue: (name, data) => enqueueJob(name, data) }

/** Which venue an action is about: given, or the venue a table belongs to. */
type Target = { readonly venue: string } | { readonly table: string }

/** Runs one action for a venue of the signed-in person's organisation, then refreshes its pages. */
async function perform(
  target: Target,
  run: (scope: TablesScope) => Promise<TablesActionResult>,
): Promise<TablesActionResult> {
  try {
    const { organization } = await requireTenant()
    const venueOfAction =
      'venue' in target
        ? target.venue
        : (await findVenueTable(getPool(), organization.id, target.table))?.venueId
    if (venueOfAction === undefined) return NOT_FOUND
    // Another tenant's venue and a made-up id both come back as null (row-level security).
    const found = await getVenue(organization.id, venueOfAction)
    if (!found) return NOT_FOUND
    const result = await run({
      pool: getPool(),
      tenantId: organization.id,
      venue: found,
      canManage: canManageIntegration(organization.role),
    })
    if (result.ok) {
      revalidatePath(`/venues/${found.id}`)
      revalidatePath(`/venues/${found.id}/tables/print`)
    }
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('tables_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/** Gives every active table without one a code. */
export async function createAllCodesAction(input: unknown): Promise<TablesActionResult> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) => createAllCodes(scope, services))
}

/** Gives one table a code, or a new one (the printed sticker stops working). */
export async function issueCodeAction(input: unknown): Promise<TablesActionResult> {
  const parsed = OnTable.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ table: parsed.data.tableId }, (scope) =>
    issueCode(scope, services, parsed.data.tableId),
  )
}

/** Turns one table's code off. */
export async function turnOffCodeAction(input: unknown): Promise<TablesActionResult> {
  const parsed = OnTable.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ table: parsed.data.tableId }, (scope) =>
    turnOffCode(scope, services, parsed.data.tableId),
  )
}

/** Names a table for the guest page; an empty name goes back to the table's number. */
export async function renameTableAction(input: unknown): Promise<TablesActionResult> {
  const parsed = Rename.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ table: parsed.data.tableId }, (scope) =>
    renameTable(scope, services, parsed.data.tableId, parsed.data.label),
  )
}

// --- areas ---------------------------------------------------------------------------------------

/** Adds an area to a venue made by hand. */
export async function createAreaAction(input: unknown): Promise<TablesActionResult> {
  const parsed = CreateArea.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) => addArea(scope, parsed.data.name))
}

/** Renames an area (on a till's venue too: our name over the till's). */
export async function renameAreaAction(input: unknown): Promise<TablesActionResult> {
  const parsed = RenameArea.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) =>
    renameAreaOf(scope, parsed.data.areaId, parsed.data.name),
  )
}

/** Hides an area with its tables, or shows it again. */
export async function setAreaHiddenAction(input: unknown): Promise<TablesActionResult> {
  const parsed = HideArea.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) =>
    hideArea(scope, services, parsed.data.areaId, parsed.data.hidden),
  )
}

/** Puts an area at a zero-based place among the venue's areas. */
export async function moveAreaAction(input: unknown): Promise<TablesActionResult> {
  const parsed = MoveArea.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) =>
    moveAreaOf(scope, parsed.data.areaId, parsed.data.position),
  )
}

/** Deletes an area of a venue made by hand, with its tables. */
export async function deleteAreaAction(input: unknown): Promise<TablesActionResult> {
  const parsed = OnArea.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) =>
    removeArea(scope, services, parsed.data.areaId),
  )
}

// --- tables --------------------------------------------------------------------------------------

/** Adds a table to an area of a venue made by hand. */
export async function createTableAction(input: unknown): Promise<TablesActionResult> {
  const parsed = CreateTable.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) =>
    addTable(scope, parsed.data.areaId, {
      number: parsed.data.number,
      name: parsed.data.name ?? null,
    }),
  )
}

/** Sets the number of a table of a venue made by hand. */
export async function setTableNumberAction(input: unknown): Promise<TablesActionResult> {
  const parsed = Renumber.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) =>
    renumberTable(scope, services, parsed.data.tableId, parsed.data.number),
  )
}

/** Hides a table, or shows it again. */
export async function setTableHiddenAction(input: unknown): Promise<TablesActionResult> {
  const parsed = HideTable.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) =>
    hideTable(scope, services, parsed.data.tableId, parsed.data.hidden),
  )
}

/** Puts a table at a zero-based place in its area, or in another one (venues made by hand). */
export async function moveTableAction(input: unknown): Promise<TablesActionResult> {
  const parsed = MoveTable.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) =>
    moveTableOf(scope, services, parsed.data.tableId, parsed.data.areaId, parsed.data.position),
  )
}

/** Deletes a table of a venue made by hand. */
export async function deleteTableAction(input: unknown): Promise<TablesActionResult> {
  const parsed = OnVenueTable.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ venue: parsed.data.venueId }, (scope) =>
    removeTable(scope, services, parsed.data.tableId),
  )
}

// --- menus ---------------------------------------------------------------------------------------

/**
 * Sets the menu an area or a table shows, or (`menuId` null) takes the choice away so it takes
 * the next level up again (D95).
 */
export async function setMenuRouteAction(input: unknown): Promise<TablesActionResult> {
  const parsed = MenuRoute.safeParse(input)
  if (!parsed.success) return INVALID
  const { target } = parsed.data
  return perform({ venue: parsed.data.venueId }, (scope) =>
    chooseMenu(
      scope,
      services,
      'areaId' in target ? { areaId: target.areaId } : { tableId: target.tableId },
      parsed.data.menuId,
    ),
  )
}
