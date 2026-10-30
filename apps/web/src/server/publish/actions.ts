'use server'

// The publish server actions (briefs S3-01b and S3-05): thin wrappers over service.ts, in the shape
// of the Integration tab's. Each checks who is asking (`requireTenant`: the tenant is the person's
// organisation, never the request's), that the venue is theirs and that their role may publish,
// validates the input with Zod, and calls the service. The venue page's Publish bar, its warnings
// and Settings › Publish and › Versioning are built on them.
import { AFTER_SYNC_MODES, idSchema, VenueSyncSettingsSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '../db'
import { enqueueJob } from '../jobs'
import { logError } from '../log'
import { canPublishMenu } from '../roles'
import { requireTenant } from '../session'
import { onSharedDevice } from '../staff/shared-device'
import { getVenue } from '../venues'
import {
  approveHeld,
  type PreviewResult,
  type PublishActionResult,
  type PublishScope,
  type PublishServices,
  previewDraft,
  publishNow,
  rejectHeldPublish,
  resumeAutoPublish,
  rollback,
  saveAutomation,
} from './service'

const venueIdSchema = idSchema('vn')

type ScopeError = 'invalid' | 'not_found' | 'failed' | 'not_allowed'

/** Runs one function for a venue of the signed-in person's organisation. */
async function withScope<T>(
  venue: unknown,
  run: (scope: PublishScope, services: PublishServices) => Promise<T>,
  onError: (error: ScopeError) => T,
): Promise<T> {
  const parsed = venueIdSchema.safeParse(venue)
  if (!parsed.success) return onError('invalid')
  try {
    const { organization, user, sessionId } = await requireTenant()
    const found = await getVenue(organization.id, parsed.data)
    if (!found) return onError('not_found')
    // A shared tablet neither publishes nor previews drafts (D122 §7, RR-83), whoever's account it
    // holds.
    if (await onSharedDevice({ tenantId: organization.id, sessionId }))
      return onError('not_allowed')
    const scope: PublishScope = {
      pool: getPool(),
      tenantId: organization.id,
      venueId: parsed.data,
      actor: `user:${user.id}`,
      canPublish: canPublishMenu(organization.role),
    }
    return await run(scope, { enqueue: enqueueJob })
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('publish_action_failed', error)
    return onError('failed')
  }
}

/** Runs one action that changes something; the tab is refreshed when it worked. */
async function perform(
  venue: unknown,
  run: (scope: PublishScope, services: PublishServices) => Promise<PublishActionResult>,
): Promise<PublishActionResult> {
  const result = await withScope(venue, run, (error): PublishActionResult => ({ ok: false, error }))
  if (result.ok && venueIdSchema.safeParse(venue).success) revalidatePath(`/venues/${venue}`)
  return result
}

/**
 * Queues a manual publish of one of this venue's menus (owner or admin): `menuId`, else the live
 * one. A menu that is not live is published as that menu; it does not become live.
 */
export async function publishNowAction(
  venueId: string,
  menuId?: string,
): Promise<PublishActionResult> {
  if (menuId !== undefined && typeof menuId !== 'string') return { ok: false, error: 'invalid' }
  return perform(venueId, (scope, services) => publishNow(scope, services, menuId))
}

/** Queues the approval of the publish V11 held (owner or admin). */
export async function approveHeldAction(
  venueId: string,
  snapshotId: string,
): Promise<PublishActionResult> {
  return perform(venueId, (scope, services) => approveHeld(scope, services, snapshotId))
}

/** Turns down the held publish (owner or admin). */
export async function rejectHeldAction(
  venueId: string,
  snapshotId: string,
): Promise<PublishActionResult> {
  return perform(venueId, (scope) => rejectHeldPublish(scope, snapshotId))
}

/** Moves this venue's menu back to an earlier published snapshot (owner or admin). */
export async function rollbackAction(
  venueId: string,
  snapshotId: string,
): Promise<PublishActionResult> {
  return perform(venueId, (scope, services) => rollback(scope, services, snapshotId))
}

const AutomationSchema = z.strictObject({
  venueId: idSchema('vn'),
  sync: VenueSyncSettingsSchema,
  afterSync: z.enum(AFTER_SYNC_MODES),
})

/**
 * Saves the venue's Automation settings (owner or admin; Settings › Publish, D82, D96): the sync
 * mode with its schedule, and whether a sync publishes by itself.
 */
export async function saveAutomationAction(input: unknown): Promise<PublishActionResult> {
  const parsed = AutomationSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId, sync, afterSync } = parsed.data
  return perform(venueId, (scope) => saveAutomation(scope, { sync, afterSync }))
}

/** "Resume automatic publishing" after a return, without publishing (owner or admin). */
export async function resumeAutoPublishAction(venueId: string): Promise<PublishActionResult> {
  return perform(venueId, (scope) => resumeAutoPublish(scope))
}

/**
 * The draft snapshot of a menu (`menuId`, else the live one) for the preview (anyone in the
 * organisation): built in memory, nothing written.
 */
export async function previewDraftAction(venueId: string, menuId?: string): Promise<PreviewResult> {
  if (menuId !== undefined && typeof menuId !== 'string') return { ok: false, error: 'failed' }
  return withScope(
    venueId,
    (scope) => previewDraft(scope, menuId),
    (): PreviewResult => ({
      ok: false,
      error: 'failed',
    }),
  )
}
