// The automatic publishes a sync causes (brief S3-01b and S3-04; doc "Publish policy"):
//
//   - a pull that changed the document queues a publish of the venue's menu (`queuePublishAfterSync`);
//   - a barsy picture whose webp variants were just made queues a publish of every menu that uses
//     it (`queuePublishForAsset`), because the publish that followed the pull usually ran before
//     the picture was ready, and a snapshot has no image for a picture without variants.
//
// Both obey the integration's setting `publish.after_sync` (core/sync-settings.ts): `auto`
// queues, `manual` queues nothing and waits for a person to press Publish. Every send carries
// reason `auto_sync`, a 30 s delay and a singleton key per menu + venue (core/jobs.ts), so syncs
// and pictures that arrive close together are published once, with everything they changed. The
// rollback pause of S3-05 is the publish step's business: it refuses an automatic publish while
// paused, whoever queued it.
import { JOB_NAMES, prepareJob, publishesAfterSync } from '@restro/core'
import { loadMenusUsingAsset } from '@restro/core/apply'
import { assets, barsyVenues, integrations, menus, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import type { SyncEnvironment } from '../sync/context'

export { publishesAfterSync }

type PublishEnvironment = Pick<SyncEnvironment, 'pool' | 'log' | 'enqueue'>

export interface AfterSyncTarget {
  readonly tenantId: string
  readonly integrationId: string
  /** OUR venue (`vn_`). */
  readonly venueId: string
  /** The integration's `config` as it was read when the job started. */
  readonly config: unknown
}

/** Queues the automatic publish of one menu; returns the line that says what the queue answered. */
async function enqueueAutoPublish(
  env: PublishEnvironment,
  target: {
    readonly tenantId: string
    readonly integrationId: string
    readonly menuId: string
    readonly venueId: string
  },
): Promise<string> {
  const job = prepareJob(JOB_NAMES.publishMenu, {
    tenantId: target.tenantId,
    menuId: target.menuId,
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
  env: PublishEnvironment,
  target: AfterSyncTarget,
  appliedOps: number,
): Promise<string | null> {
  const note = await decide(env, target, appliedOps)
  if (note !== null) env.log.info({ venueId: target.venueId }, note)
  return note
}

async function decide(
  env: PublishEnvironment,
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
    return await enqueueAutoPublish(env, {
      tenantId: target.tenantId,
      integrationId: target.integrationId,
      menuId: menu.id,
      venueId: target.venueId,
    })
  } catch (error) {
    env.log.warn({ err: error }, 'the publish after a sync could not be queued')
    return 'the publish after this sync could not be queued'
  }
}

/** The barsy integration a venue of ours is mapped to, with its config; null for none. */
async function integrationOfVenue(env: PublishEnvironment, tenantId: string, venueId: string) {
  const [row] = await withTenant(env.pool, tenantId, (tx) =>
    tx
      .select({ id: integrations.id, config: integrations.config })
      .from(barsyVenues)
      .innerJoin(integrations, eq(integrations.id, barsyVenues.integrationId))
      .where(eq(barsyVenues.venueId, venueId))
      .limit(1),
  )
  return row ?? null
}

/**
 * A barsy picture's variants were just made: queues the automatic publish of every menu that uses
 * it, unless that menu's integration says `publish.after_sync = manual`. Pictures a person
 * uploaded are left alone: a hand edit is published when someone presses Publish (doc "Publish
 * policy"), and an automatic publish would carry their unfinished edits live. Returns one line
 * per menu (or one line for why there is none); logged by the caller. Never throws.
 */
export async function queuePublishForAsset(
  env: PublishEnvironment,
  target: { readonly tenantId: string; readonly assetId: string },
): Promise<string[]> {
  try {
    const [asset] = await withTenant(env.pool, target.tenantId, (tx) =>
      tx.select({ origin: assets.origin }).from(assets).where(eq(assets.id, target.assetId)),
    )
    if (asset === undefined) return ['this picture is unknown: nothing was queued to publish']
    if (asset.origin !== 'barsy') {
      return ['a person uploaded this picture: it is published when they press Publish']
    }
    const using = await loadMenusUsingAsset(env.pool, target.tenantId, target.assetId)
    if (using.length === 0) return ['no menu uses this picture yet: nothing was queued to publish']
    const notes: string[] = []
    for (const { menuId, venueId } of using) {
      const integration = await integrationOfVenue(env, target.tenantId, venueId)
      if (integration === null) {
        notes.push('a menu that uses this picture has no barsy integration: nothing was queued')
      } else if (!publishesAfterSync(integration.config)) {
        notes.push('publish after sync is off for this integration: nothing was queued')
      } else {
        notes.push(
          await enqueueAutoPublish(env, {
            tenantId: target.tenantId,
            integrationId: integration.id,
            menuId,
            venueId,
          }),
        )
      }
    }
    return notes
  } catch (error) {
    env.log.warn({ err: error }, 'the publish after a picture could not be queued')
    return ['the publish after this picture could not be queued']
  }
}
