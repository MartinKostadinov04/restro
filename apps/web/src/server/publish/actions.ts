'use server'

// The publish server actions (brief S3-01b): thin wrappers over service.ts, in the shape of the
// Integration tab's. Each checks who is asking (`requireTenant`: the tenant is the person's
// organisation, never the request's), that the venue is theirs and that their role may publish,
// validates the input with Zod, and calls the service. S3-05 builds the Publish tab on them.
import { idSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'

import { getPool } from '../db'
import { enqueueJob } from '../jobs'
import { logError } from '../log'
import { canPublishMenu } from '../roles'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import {
  type PublishActionResult,
  type PublishScope,
  type PublishServices,
  publishNow,
  rollback,
} from './service'

const venueIdSchema = idSchema('vn')

/** Runs one action for a venue of the signed-in person's organisation. */
async function perform(
  venue: unknown,
  run: (scope: PublishScope, services: PublishServices) => Promise<PublishActionResult>,
): Promise<PublishActionResult> {
  const parsed = venueIdSchema.safeParse(venue)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const { organization, user } = await requireTenant()
    const found = await getVenue(organization.id, parsed.data)
    if (!found) return { ok: false, error: 'not_found' }
    const scope: PublishScope = {
      pool: getPool(),
      tenantId: organization.id,
      venueId: parsed.data,
      actor: `user:${user.id}`,
      canPublish: canPublishMenu(organization.role),
    }
    const result = await run(scope, { enqueue: enqueueJob })
    if (result.ok) revalidatePath(`/venues/${found.id}`)
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('publish_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/** Queues a manual publish of this venue's menu (owner or admin). */
export async function publishNowAction(venueId: string): Promise<PublishActionResult> {
  return perform(venueId, (scope, services) => publishNow(scope, services))
}

/** Moves this venue's menu back to an earlier published snapshot (owner or admin). */
export async function rollbackAction(
  venueId: string,
  snapshotId: string,
): Promise<PublishActionResult> {
  return perform(venueId, (scope, services) => rollback(scope, services, snapshotId))
}
