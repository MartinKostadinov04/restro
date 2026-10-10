'use server'

// The Integration tab's server actions (brief S2-05): thin wrappers. Each checks who is asking
// (`requireTenant`: the tenant is the person's organisation, never the request's), that the venue
// is theirs and whether their role may manage the integration, checks the input with Zod, and
// calls service.ts. After a write the venue page is revalidated, so the client gets the fresh
// tab in the same round trip.
//
// The password: it arrives in `saveConnectionAction`'s input, is handed to the service to be
// sealed, and goes no further. It is never logged (errors are logged through `logError`, which
// prints an error's class and message, and nothing here puts input in a message), never
// returned, and never stored in the clear.
import { idSchema } from '@restro/core'
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
  checkConnection,
  chooseBarsyVenue,
  chooseCatalogueRoot,
  type IntegrationScope,
  type IntegrationServices,
  saveConnection,
  saveMappingSettings,
  syncNow,
} from './service'
import type { IntegrationActionResult } from './view'

const venueId = idSchema('vn')

const VenueOnly = z.strictObject({ venueId })
const Connect = z.strictObject({
  venueId,
  host: z.string().min(1).max(300),
  user: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
})
const ChooseBarsyVenue = z.strictObject({ venueId, bid: z.int().min(0) })
const ChooseRoot = z.strictObject({ venueId, catId: z.int().min(0) })
const MappingSettings = z.strictObject({
  venueId,
  priceSource: z.enum(['actual_price', 'current_price']),
  allergenKey: z.string().min(1).max(128).nullable(),
  defaultLocale: z.string().min(1).max(16),
})

const INVALID: IntegrationActionResult = { ok: false, error: 'invalid' }
const NOT_FOUND: IntegrationActionResult = { ok: false, error: 'not_found' }

/** Runs one action for a venue of the signed-in person's organisation. */
async function perform(
  venue: string,
  run: (scope: IntegrationScope, services: IntegrationServices) => Promise<IntegrationActionResult>,
): Promise<IntegrationActionResult> {
  try {
    const { organization } = await requireTenant()
    const found = await getVenue(organization.id, venue)
    if (!found) return NOT_FOUND
    const scope: IntegrationScope = {
      pool: getPool(),
      tenantId: organization.id,
      venue: { id: found.id, name: found.name, timezone: found.timezone },
      canManage: canManageIntegration(organization.role),
    }
    const services: IntegrationServices = {
      sealPublicKey: serverEnv().SEAL_PUBLIC_KEY,
      enqueue: enqueueJob,
    }
    const result = await run(scope, services)
    if (result.ok) revalidatePath(`/venues/${found.id}`)
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('integration_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/** Seals and stores the barsy address and API user, and queues the connection check. */
export async function saveConnectionAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = Connect.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...connection } = parsed.data
  return perform(venue, (scope, services) => saveConnection(scope, services, connection))
}

/** Queues the connection check again. */
export async function checkConnectionAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = VenueOnly.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data.venueId, (scope, services) => checkConnection(scope, services))
}

/** Maps a barsy venue to this venue. */
export async function chooseBarsyVenueAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = ChooseBarsyVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data.venueId, (scope) => chooseBarsyVenue(scope, { bid: parsed.data.bid }))
}

/** Chooses the catalogue root of this venue's menu. */
export async function chooseCatalogueRootAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = ChooseRoot.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data.venueId, (scope) =>
    chooseCatalogueRoot(scope, { catId: parsed.data.catId }),
  )
}

/** Saves the mapping settings (price source, allergen characteristic, default language). */
export async function saveMappingSettingsAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = MappingSettings.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...settings } = parsed.data
  return perform(venue, (scope) => saveMappingSettings(scope, settings))
}

/** Queues a full pull of this venue. */
export async function syncNowAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = VenueOnly.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data.venueId, (scope, services) => syncNow(scope, services))
}
