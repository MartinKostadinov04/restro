'use server'

// The server actions of Settings -> Integrations and of a venue's Menu source card (adjustments I1
// and I2): thin wrappers. Each checks who is asking (`requireTenant`: the tenant is the person's
// organisation, never the request's), for the venue's card that the venue is theirs, and whether
// their role may manage the integration, checks the input with Zod, and calls service.ts. After a
// write the pages that show it are revalidated, so the client gets the fresh page in the same
// round trip.
//
// The password: it arrives in `addInstanceAction`'s and `saveConnectionAction`'s input, is handed
// to the service to be sealed, and goes no further. It is never logged (errors are logged through
// `logError`, which prints an error's class and message, and nothing here puts input in a
// message), never returned, and never stored in the clear.
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
  addInstance,
  checkConnection,
  type IntegrationScope,
  type IntegrationServices,
  removeInstance,
  renameInstance,
  saveConnection,
  saveInstanceSettings,
  saveSystems,
  saveVenueSource,
  syncAll,
  syncNow,
  type VenueScope,
} from './service'
import type { IntegrationActionResult } from './view'

const venueId = idSchema('vn')
const integrationId = idSchema('in')

const Credentials = {
  host: z.string().min(1).max(300),
  user: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
}
const Systems = z.strictObject({ systems: z.array(z.string().min(1).max(64)).max(32) })
const NewInstance = z.strictObject({
  kind: z.string().min(1).max(64),
  name: z.string().max(200).optional(),
  ...Credentials,
})
const Connect = z.strictObject({ integrationId, ...Credentials })
const Rename = z.strictObject({ integrationId, name: z.string().min(1).max(200) })
const InstanceOnly = z.strictObject({ integrationId })
// What a connector's settings card sends: the connector checks it (its own Zod schema), the action
// only bounds its size.
const Settings = z.record(z.string().max(64), z.unknown())
const InstanceSettings = z.strictObject({ integrationId, settings: Settings })
const VenueOnly = z.strictObject({ venueId })
const VenueSource = z.strictObject({ venueId, settings: Settings })

const INVALID: IntegrationActionResult = { ok: false, error: 'invalid' }
const NOT_FOUND: IntegrationActionResult = { ok: false, error: 'not_found' }

const services = (): IntegrationServices => ({
  sealPublicKey: serverEnv().SEAL_PUBLIC_KEY,
  enqueue: enqueueJob,
})

/** What an organisation-wide write changes on screen: the Settings page and the pages that list instances. */
function revalidateOrganisation(): void {
  revalidatePath('/settings/integrations')
  revalidatePath('/venues')
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

/** Saves the systems the organisation uses; one with instances cannot be left out. */
export async function saveSystemsAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = Systems.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope) => saveSystems(scope, parsed.data.systems))
}

/** "Add {source}": a new instance with its sealed credentials; queues the connection check. */
export async function addInstanceAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = NewInstance.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope, deps) => addInstance(scope, deps, parsed.data))
}

/** Seals and stores the address and API user of an instance, and queues the connection check. */
export async function saveConnectionAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = Connect.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope, deps) => saveConnection(scope, deps, parsed.data))
}

/** Renames an instance. */
export async function renameInstanceAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = Rename.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope) => renameInstance(scope, parsed.data))
}

/** Removes an instance; refused while a venue uses it. */
export async function removeInstanceAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = InstanceOnly.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope) => removeInstance(scope, parsed.data))
}

/** Queues the connection check of an instance again. */
export async function checkConnectionAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = InstanceOnly.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope, deps) =>
    checkConnection(scope, deps, parsed.data.integrationId),
  )
}

/** Saves the system settings of an instance (the connector checks what its card sent). */
export async function saveInstanceSettingsAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = InstanceSettings.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope) => saveInstanceSettings(scope, parsed.data))
}

/** Queues a full pull of every venue that uses the instance and that its system can read. */
export async function syncAllAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = InstanceOnly.safeParse(input)
  if (!parsed.success) return INVALID
  return performOrganisation((scope, deps) => syncAll(scope, deps, parsed.data.integrationId))
}

// --- a venue's Menu source -------------------------------------------------------------------

/** Saves the connector's part of this venue's Menu source (the connector checks what its card sent). */
export async function saveVenueSourceAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = VenueSource.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, settings } = parsed.data
  return performVenue(venue, (scope) => saveVenueSource(scope, { settings }))
}

/** Queues a full pull of this venue. */
export async function syncNowAction(input: unknown): Promise<IntegrationActionResult> {
  const parsed = VenueOnly.safeParse(input)
  if (!parsed.success) return INVALID
  return performVenue(parsed.data.venueId, (scope, deps) => syncNow(scope, deps))
}
