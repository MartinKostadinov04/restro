'use server'

// The server actions of Settings -> Integrations and of a venue's Menu source card (briefs S2-05
// and CF-09b): thin wrappers. Each checks who is asking (`requireTenant`: the tenant is the
// person's organisation, never the request's), for the venue's card that the venue is theirs, and
// whether their role may manage the integration, checks the input with Zod, and calls service.ts.
// After a write the pages that show it are revalidated, so the client gets the fresh page in the
// same round trip.
//
// The password: it arrives in `saveConnectionAction`'s input, is handed to the service to be
// sealed, and goes no further. It is never logged (errors are logged through `logError`, which
// prints an error's class and message, and nothing here puts input in a message), never
// returned, and never stored in the clear.
import { idSchema, SyncSettingsInputSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '../db'
import { serverEnv } from '../env'
import { enqueueJob } from '../jobs'
import { logError } from '../log'
import { canManageIntegration } from '../roles'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import {
  addTillVenueAsVenue,
  checkConnection,
  chooseCatalogueRoot,
  chooseTillVenue,
  type IntegrationScope,
  type IntegrationServices,
  linkTillVenue,
  markTillVenue,
  saveConnection,
  saveMappingSettings,
  saveSyncSettings,
  saveVenuePrice,
  syncAll,
  syncNow,
  type VenueScope,
} from './service'
import type { IntegrationActionResult } from './view'

const venueId = idSchema('vn')
const tillVenue = z.int().min(0)

const Connect = z.strictObject({
  host: z.string().min(1).max(300),
  user: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
})
const Mapping = z.strictObject({
  allergenKey: z.string().min(1).max(128).nullable(),
  defaultLocale: z.string().min(1).max(16),
})
const SyncSettings = z.strictObject({ schedule: SyncSettingsInputSchema.shape.schedule })
const TillVenueOnly = z.strictObject({ bid: tillVenue })
const LinkTillVenue = z.strictObject({ bid: tillVenue, venueId })
const MarkTillVenue = z.strictObject({ bid: tillVenue, notUsed: z.boolean() })

const VenueOnly = z.strictObject({ venueId })
const ChooseTillVenue = z.strictObject({ venueId, bid: tillVenue })
const ChooseRoot = z.strictObject({ venueId, catId: z.int().min(0) })
const VenuePrice = z.strictObject({
  venueId,
  priceSource: z.enum(['actual_price', 'current_price']),
})

const INVALID: IntegrationActionResult = { ok: false, error: 'invalid' }
const NOT_FOUND: IntegrationActionResult = { ok: false, error: 'not_found' }

const services = (): IntegrationServices => ({
  sealPublicKey: serverEnv().SEAL_PUBLIC_KEY,
  enqueue: enqueueJob,
})

/** What an organisation-wide write changes on screen: the Settings page and the venues it names. */
function revalidateOrganisation(): void {
  revalidatePath('/settings/integrations')
  revalidatePath('/venues/[venueId]', 'page')
}

/** Runs one organisation-wide action for the signed-in person's organisation. */
async function performOrganisation(
  run: (scope: IntegrationScope, services: IntegrationServices) => Promise<IntegrationActionResult>,
): Promise<IntegrationActionResult> {
  try {
    const { organization } = await requireTenant()
    const scope: IntegrationScope = {
      pool: getPool(),
      tenantId: organization.id,
      canManage: canManageIntegration(organization.role),
    }
    const result = await run(scope, services())
    if (result.ok) revalidateOrganisation()
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('integration_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/** Runs one action for a venue of the signed-in person's organisation. */
async function performVenue(
  venue: string,
  run: (scope: VenueScope, services: IntegrationServices) => Promise<IntegrationActionResult>,
): Promise<IntegrationActionResult> {
  try {
    const { organization } = await requireTenant()
    const found = await getVenue(organization.id, venue)
    if (!found) return NOT_FOUND
    const scope: VenueScope = {
      pool: getPool(),
      tenantId: organization.id,
      venue: { id: found.id, name: found.name, timezone: found.timezone },
      canManage: canManageIntegration(organization.role),
    }
    const result = await run(scope, services())
    if (result.ok) {
      revalidatePath(`/venues/${found.id}`)
      revalidatePath('/settings/integrations')
    }
    return result
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    logError('integration_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

// --- Settings -> Integrations (the organisation) ---------------------------------------------

/** Seals and stores the address and API user, and queues the connection check. */
export async function saveConnectionAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = Connect.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope, deps) => saveConnection(scope, deps, parsed.data))
}

/** Queues the connection check again. */
export async function checkConnectionAction(): Promise<IntegrationActionResult> {
  return performOrganisation((scope, deps) => checkConnection(scope, deps))
}

/** Saves how the data is read: the allergen characteristic and the language of the till's texts. */
export async function saveMappingSettingsAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = Mapping.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope) => saveMappingSettings(scope, parsed.data))
}

/** Saves the automatic sync: the schedule of the change check and the daily full read. */
export async function saveSyncSettingsAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = SyncSettings.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope) => saveSyncSettings(scope, parsed.data))
}

/** Queues a full pull of every linked venue that has a menu category. */
export async function syncAllAction(): Promise<IntegrationActionResult> {
  return performOrganisation((scope, deps) => syncAll(scope, deps))
}

/** "Add as venue": makes a venue of ours for a till venue and links it; answers with the new venue's id. */
export async function addTillVenueAsVenueAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = TillVenueOnly.safeParse(input)
  if (!parsed.success) return INVALID
  const result = await performOrganisation((scope) => addTillVenueAsVenue(scope, parsed.data))
  // A new venue appears in the sidebar of every page.
  if (result.ok) revalidatePath('/', 'layout')
  return result
}

/** "Link to an existing venue": gives a venue that has no till venue to a till venue that has no venue. */
export async function linkTillVenueAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = LinkTillVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope) => linkTillVenue(scope, parsed.data))
}

/** "Not used": sets a till venue aside (or takes it back). */
export async function markTillVenueAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = MarkTillVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope) => markTillVenue(scope, parsed.data))
}

// --- a venue's Menu source -------------------------------------------------------------------

/** Gives this venue a till venue, or moves it to another one (a deliberate change). */
export async function chooseTillVenueAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = ChooseTillVenue.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...choice } = parsed.data
  return performVenue(venue, (scope) => chooseTillVenue(scope, choice))
}

/** Chooses the menu category of this venue. */
export async function chooseCatalogueRootAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = ChooseRoot.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...choice } = parsed.data
  return performVenue(venue, (scope) => chooseCatalogueRoot(scope, choice))
}

/** Saves which price this venue's menu shows. */
export async function saveVenuePriceAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = VenuePrice.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...choice } = parsed.data
  return performVenue(venue, (scope) => saveVenuePrice(scope, choice))
}

/** Queues a full pull of this venue. */
export async function syncNowAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = VenueOnly.safeParse(input)
  if (!parsed.success) return INVALID
  return performVenue(parsed.data.venueId, (scope, deps) => syncNow(scope, deps))
}
