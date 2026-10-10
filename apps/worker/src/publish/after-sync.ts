// The after-sync publish (brief S3-01b; doc "Publish policy"): a pull that changed the document
// queues an automatic publish of the venue's menu, unless the integration says not to. The send
// carries a 30 s delay and a singleton key per menu + venue (core/jobs.ts), so syncs that finish
// close together are published once, with everything they changed.
import { JOB_NAMES, prepareJob } from '@restro/core'
import { menus, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import type { SyncEnvironment } from '../sync/context'

/**
 * Whether a sync that changed something publishes on its own: `config.publish_after_sync`,
 * true unless it is exactly `false` (the doc's default policy publishes barsy changes at once).
 * S3-04 turns this key into a setting of the Integration tab.
 */
export function publishesAfterSync(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return true
  return (config as { publish_after_sync?: unknown }).publish_after_sync !== false
}

export interface AfterSyncTarget {
  readonly tenantId: string
  readonly integrationId: string
  /** OUR venue (`vn_`). */
  readonly venueId: string
  /** The integration's `config` as it was read when the job started. */
  readonly config: unknown
}

/**
 * Queues the automatic publish when `appliedOps` is above zero and the integration allows it.
 * Returns a line saying what happened (or why nothing did), or null when the pull changed
 * nothing; the line is logged, and deliberately not added to the pull's run text, which the
 * Integration tab shows as news about the pull. Never throws: the pull has already been
 * applied and recorded, and a failure to queue is logged; the next sync that changes something
 * publishes.
 */
export async function queuePublishAfterSync(
  env: Pick<SyncEnvironment, 'pool' | 'log' | 'enqueue'>,
  target: AfterSyncTarget,
  appliedOps: number,
): Promise<string | null> {
  const note = await decide(env, target, appliedOps)
  if (note !== null) env.log.info({ venueId: target.venueId }, note)
  return note
}

async function decide(
  env: Pick<SyncEnvironment, 'pool' | 'log' | 'enqueue'>,
  target: AfterSyncTarget,
  appliedOps: number,
): Promise<string | null> {
  if (appliedOps <= 0) return null
  if (!publishesAfterSync(target.config)) {
    return 'publish after sync is off for this integration: nothing was queued'
  }
  try {
    const [menu] = await withTenant(env.pool, target.tenantId, (tx) =>
      tx.select({ id: menus.id }).from(menus).where(eq(menus.venueId, target.venueId)),
    )
    if (menu === undefined) return 'this venue has no menu yet: nothing was queued to publish'
    const job = prepareJob(JOB_NAMES.publishMenu, {
      tenantId: target.tenantId,
      menuId: menu.id,
      venueId: target.venueId,
      reason: 'auto_sync',
      actor: `integration:${target.integrationId}`,
    })
    const id = await env.enqueue(JOB_NAMES.publishMenu, job.data, {
      singletonKey: job.singletonKey,
      startAfter: job.startAfter,
    })
    return id === null
      ? 'a publish is already waiting for this menu: this sync joins it'
      : `publish queued to run in ${job.startAfter ?? 0} s`
  } catch (error) {
    env.log.warn({ err: error }, 'the publish after a sync could not be queued')
    return 'the publish after this sync could not be queued'
  }
}
