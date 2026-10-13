// The automatic publishes a sync causes (brief S3-01b and S3-04; doc "Publish policy"):
//
//   - a pull that changed the document queues a publish of the venue's menu (`queuePublishAfterSync`);
//   - a barsy picture whose webp variants were just made queues a publish of every menu that uses
//     it (`queuePublishForAsset`), because the publish that followed the pull usually ran before
//     the picture was ready, and a snapshot has no image for a picture without variants.
//
// Both obey the VENUE's rule `settings.publish.after_sync` (core/sync-settings.ts, CF-09b, D73):
// `auto` queues, `manual` queues nothing and waits for a person to press Publish. A venue that
// has not saved a rule reads the integration's old one, so nothing changed when the rule moved to
// the venue. Venues on one catalogue each follow their own rule, since each is asked separately.
// Every send carries
// reason `auto_sync`, a 30 s delay and a singleton key per menu + venue (core/jobs.ts), so syncs
// and pictures that arrive close together are published once, with everything they changed.
//
// The rollback pause (S3-05; per venue since T76, `venues.settings.publish.auto_paused`, with
// the integration's old flag as the fallback) stops exactly these publishes, since every automatic
// publish is `auto_sync`: neither trigger queues one while the flag is set, and the publish-menu
// job checks it again when an `auto_sync` job runs (`autoPublishIsPaused`), because a job queued
// before the rollback, or by a sync that read its settings before it, would otherwise undo the
// rollback. A person's publish resumes automatic publishing (`resumeAutoPublish`).
import {
  JOB_NAMES,
  prepareJob,
  venueAutoPublishPaused,
  venuePublishesAfterSync,
} from '@restro/core'
import { loadMenusUsingAsset, setVenueAutoPublishPaused } from '@restro/core/apply'
import { assets, barsyVenues, integrations, menus, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import type { SyncEnvironment } from '../sync/context'
import { venueState } from './venue-state'

export { venuePublishesAfterSync }

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

/** `venues.settings` of one venue (where its own publishing rules are); empty when it is not found. */
async function venueSettingsOf(
  env: Pick<PublishEnvironment, 'pool'>,
  tenantId: string,
  venueId: string,
): Promise<unknown> {
  const [row] = await withTenant(env.pool, tenantId, (tx) =>
    tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
  )
  return row?.settings ?? {}
}

/**
 * Queues the automatic publish when `appliedOps` is above zero and the venue allows it.
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
  try {
    // A venue that was deleted while its pull ran publishes nothing (D76).
    if ((await venueState(env.pool, target.tenantId, target.venueId)) === 'archived') {
      return 'this venue was deleted: nothing was queued to publish'
    }
    // The venue's own rule (CF-09b); a venue with none reads the integration's.
    const settings = await venueSettingsOf(env, target.tenantId, target.venueId)
    if (!venuePublishesAfterSync(settings, target.config)) {
      return 'publish after sync is off for this venue: nothing was queued'
    }
    if (venueAutoPublishPaused(settings, target.config)) return PAUSED_NOTE
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

/** What is logged when a trigger finds automatic publishing paused. */
const PAUSED_NOTE =
  'automatic publishing is paused after a rollback: nothing was queued (a manual publish resumes it)'

/** The barsy integration a venue of ours is mapped to, with its config; null for none. */
async function integrationOfVenue(
  env: Pick<PublishEnvironment, 'pool'>,
  tenantId: string,
  venueId: string,
) {
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
 * it, unless that menu's venue says `publish.after_sync = manual` (CF-09b). Pictures a person
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
    if (asset.origin !== 'connector') {
      return ['a person uploaded this picture: it is published when they press Publish']
    }
    const using = await loadMenusUsingAsset(env.pool, target.tenantId, target.assetId)
    if (using.length === 0) return ['no menu uses this picture yet: nothing was queued to publish']
    const notes: string[] = []
    for (const { menuId, venueId } of using) {
      const integration = await integrationOfVenue(env, target.tenantId, venueId)
      const settings = await venueSettingsOf(env, target.tenantId, venueId)
      if (integration === null) {
        notes.push('a menu that uses this picture has no barsy integration: nothing was queued')
      } else if (!venuePublishesAfterSync(settings, integration.config)) {
        notes.push('publish after sync is off for this venue: nothing was queued')
      } else if (venueAutoPublishPaused(settings, integration.config)) {
        notes.push(PAUSED_NOTE)
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

/**
 * Whether automatic publishing of this venue is paused (a rollback, S3-05; per venue, T76): the
 * venue's own flag, else the old flag in the config of the integration it is mapped to. A venue
 * with no integration has no automatic publishing to pause. Read when an `auto_sync` publish
 * runs, not when it was queued. Throws on a database failure: the job then fails and is retried,
 * rather than publishing when unsure.
 */
export async function autoPublishIsPaused(
  env: Pick<PublishEnvironment, 'pool'>,
  target: { readonly tenantId: string; readonly venueId: string },
): Promise<boolean> {
  const integration = await integrationOfVenue(env, target.tenantId, target.venueId)
  if (integration === null) return false
  const settings = await venueSettingsOf(env, target.tenantId, target.venueId)
  return venueAutoPublishPaused(settings, integration.config)
}

/**
 * A person's publish went through: automatic publishing resumes. Returns whether it had been
 * paused. Writes the venue's own flag (false), so an old pause on the integration no longer
 * reaches this venue either; leaves everything alone when it was not paused.
 */
export async function resumeAutoPublish(
  env: Pick<PublishEnvironment, 'pool'>,
  target: { readonly tenantId: string; readonly venueId: string },
): Promise<boolean> {
  if (!(await autoPublishIsPaused(env, target))) return false
  await setVenueAutoPublishPaused(env.pool, target.tenantId, target.venueId, false)
  return true
}
