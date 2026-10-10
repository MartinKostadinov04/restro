'use server'

// The Tables & QR tab's server actions (brief S3-07): thin wrappers. Each checks who is asking
// (`requireTenant`: the tenant is the person's organisation, never the request's), that the venue
// is theirs and whether their role may change codes (owners and admins), checks the input with
// Zod and calls service.ts. After a change the venue page and its print sheet are revalidated, so
// the client gets the fresh tab in the same round trip.
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
  createAllCodes,
  issueCode,
  renameTable,
  saveQrSettings,
  type TablesScope,
  type TablesServices,
  turnOffCode,
} from './service'
import type { TablesActionResult } from './view'

const tableId = idSchema('tb')
const venueId = idSchema('vn')

const OnVenue = z.strictObject({ venueId })
const OnTable = z.strictObject({ tableId })
const Rename = z.strictObject({ tableId, label: z.string().max(200).nullable() })
const QrSettings = z.strictObject({
  venueId,
  mode: z.enum(['ours', 'own']),
  baseUrl: z.string().max(400).nullable(),
  ownPattern: z.string().max(600).nullable(),
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

/** Names a table for the guest page; an empty name goes back to barsy's number. */
export async function renameTableAction(input: unknown): Promise<TablesActionResult> {
  const parsed = Rename.safeParse(input)
  if (!parsed.success) return INVALID
  return perform({ table: parsed.data.tableId }, (scope) =>
    renameTable(scope, services, parsed.data.tableId, parsed.data.label),
  )
}

/** Saves which address the venue's codes carry. */
export async function saveQrSettingsAction(input: unknown): Promise<TablesActionResult> {
  const parsed = QrSettings.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...settings } = parsed.data
  return perform({ venue }, (scope) => saveQrSettings(scope, settings))
}
