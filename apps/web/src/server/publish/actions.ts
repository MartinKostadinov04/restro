'use server'

// The publish server actions (briefs S3-01b and S3-05): thin wrappers over service.ts, in the shape
// of the Integration tab's. Each checks who is asking (`requireTenant`: the tenant is the person's
// organisation, never the request's), that the venue is theirs and that their role may publish,
// validates the input with Zod, and calls the service. The Publish tab is built on them.
import { AFTER_SYNC_MODES, idSchema, NEW_ITEMS_MODES } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '../db'
import { enqueueJob } from '../jobs'
import { logError } from '../log'
import { canPublishMenu } from '../roles'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import { loadHistoryPage, menuOfVenue, type ViewScope } from './load'
import {
  approveHeld,
  type PreviewResult,
  type PublishActionResult,
  type PublishScope,
  type PublishServices,
  previewDraft,
  publishNow,
  rejectHeldPublish,
  rollback,
  savePublishRules,
} from './service'
import type { HistoryPage } from './view'

const venueIdSchema = idSchema('vn')

type ScopeError = 'invalid' | 'not_found' | 'failed'

/** Runs one function for a venue of the signed-in person's organisation. */
async function withScope<T>(
  venue: unknown,
  run: (
    scope: PublishScope,
    services: PublishServices,
    venue: { readonly slug: string; readonly publicId: string; readonly timezone: string },
  ) => Promise<T>,
  onError: (error: ScopeError) => T,
): Promise<T> {
  const parsed = venueIdSchema.safeParse(venue)
  if (!parsed.success) return onError('invalid')
  try {
    const { organization, user } = await requireTenant()
    const found = await getVenue(organization.id, parsed.data)
    if (!found) return onError('not_found')
    const scope: PublishScope = {
      pool: getPool(),
      tenantId: organization.id,
      venueId: parsed.data,
      actor: `user:${user.id}`,
      canPublish: canPublishMenu(organization.role),
    }
    return await run(scope, { enqueue: enqueueJob }, found)
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

/** Queues a manual publish of this venue's menu (owner or admin). */
export async function publishNowAction(venueId: string): Promise<PublishActionResult> {
  return perform(venueId, (scope, services) => publishNow(scope, services))
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

const PublishRulesSchema = z.strictObject({
  afterSync: z.enum(AFTER_SYNC_MODES),
  newItems: z.enum(NEW_ITEMS_MODES),
})

/** Saves the venue's publishing rules (owner or admin): after a sync, and new items. */
export async function savePublishRulesAction(
  venueId: string,
  rules: unknown,
): Promise<PublishActionResult> {
  const parsed = PublishRulesSchema.safeParse(rules)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  return perform(venueId, (scope) => savePublishRules(scope, parsed.data))
}

/** The draft snapshot for the preview (anyone in the organisation): built in memory, nothing written. */
export async function previewDraftAction(venueId: string): Promise<PreviewResult> {
  return withScope(
    venueId,
    (scope) => previewDraft(scope),
    (): PreviewResult => ({
      ok: false,
      error: 'failed',
    }),
  )
}

const BeforeVersionSchema = z.int().min(1)

export type HistoryPageResult =
  | { readonly ok: true; readonly page: HistoryPage }
  | { readonly ok: false }

/** An older page of the version history (anyone in the organisation). */
export async function loadHistoryPageAction(
  venueId: string,
  beforeVersion: number,
): Promise<HistoryPageResult> {
  const before = BeforeVersionSchema.safeParse(beforeVersion)
  if (!before.success) return { ok: false }
  return withScope(
    venueId,
    async (scope, _services, { slug, publicId, timezone }): Promise<HistoryPageResult> => {
      const menuId = await menuOfVenue(scope.pool, scope.tenantId, scope.venueId)
      if (menuId === null) return { ok: false }
      const view: ViewScope = {
        pool: scope.pool,
        tenantId: scope.tenantId,
        venue: { id: scope.venueId, slug, publicId, timezone },
        canPublish: scope.canPublish,
      }
      return { ok: true, page: await loadHistoryPage(view, menuId, { beforeVersion: before.data }) }
    },
    (): HistoryPageResult => ({ ok: false }),
  )
}
