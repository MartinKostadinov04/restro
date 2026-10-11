// "Publish now", "Approve", "Reject", "Return to a version" and the preview (briefs S3-01b and
// S3-05), as plain functions the server actions wrap (actions.ts) so they can be tested without a
// request.
//
// Publishing is the worker's job: "Publish now" and "Approve" only queue `publish-menu` (reason
// `manual`, the person as actor; an approval names the held snapshot), and the run's outcome
// (published, refused and why) is read back from the job runs by the tab. A return to an earlier
// version is a database change that `rollbackTo` (core/apply) makes at once; it then queues
// `publish-files`, which writes `current.json` for the snapshot the pointer names. Rejecting a
// held publish is a database change too (`rejectHeld`).
//
// A return pauses automatic publishing (`config.publish.auto_paused` of the integration the venue
// is mapped to): otherwise the next sync would publish the document again and undo it. The pause
// is set BEFORE the pointer moves, so no automatic publish can slip in between; if the return
// then fails, the pause is taken off again. A manual publish clears it (the worker does that).
import {
  type Actor,
  autoPublishPaused,
  idSchema,
  JOB_NAMES,
  type JobPayload,
  type LiveOverlay,
  type MenuSnapshot,
  type ProducedJobName,
  type SnapshotId,
  type TenantId,
  type VenueId,
} from '@restro/core'
import {
  loadDraft,
  ProvisionError,
  PublishError,
  rejectHeld,
  rollbackTo,
  setAutoPublishPaused,
  setVenuePublishRules,
} from '@restro/core/apply'
import { barsyVenues, type DbPool, integrations, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import { logError } from '../log'
import { loadHeldRows, menuOfVenue } from './load'

/** Who is asking, for which venue. `canPublish` comes from the organisation role. */
export interface PublishScope {
  readonly pool: DbPool
  readonly tenantId: string
  readonly venueId: VenueId
  /** `user:<id>`: recorded as the actor of the publish. */
  readonly actor: Actor
  readonly canPublish: boolean
}

/** What the actions need from outside the database. */
export interface PublishServices {
  /** Puts a job in the queue (`enqueueJob`); null when an identical job is already waiting. */
  readonly enqueue: <N extends ProducedJobName>(
    name: N,
    data: JobPayload<N>,
  ) => Promise<string | null>
}

export type PublishActionError =
  /** The input is not what the action takes. */
  | 'invalid'
  /** No such venue for this organisation. */
  | 'not_found'
  /** The person's role may not publish. */
  | 'not_allowed'
  /** The venue has no menu yet. */
  | 'no_menu'
  /** Rollback: nothing was ever published for this menu. */
  | 'nothing_published'
  /** Rollback: the snapshot is not an earlier publish of this menu with a body. */
  | 'not_restorable'
  /** Approve or reject: no publish is held under that id (someone decided it already). */
  | 'held_not_found'
  /** "Publish now": the job could not be queued; nothing happened. */
  | 'queue_unavailable'
  | 'failed'

export type PublishActionResult =
  /**
   * `queued` is false only after a rollback whose files job could not be queued: the rollback
   * itself stands, and "Publish files again" (the same job) repairs it.
   */
  | { readonly ok: true; readonly queued: boolean }
  | { readonly ok: false; readonly error: PublishActionError }

const fail = (error: PublishActionError): PublishActionResult => ({ ok: false, error })

/** Queues a manual publish of the venue's menu. */
export async function publishNow(
  scope: PublishScope,
  services: PublishServices,
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  const menuId = await menuOfVenue(scope.pool, scope.tenantId, scope.venueId)
  if (menuId === null) return fail('no_menu')
  try {
    await services.enqueue(JOB_NAMES.publishMenu, {
      tenantId: scope.tenantId as TenantId,
      menuId,
      venueId: scope.venueId,
      reason: 'manual',
      actor: scope.actor,
    })
    // null: a manual publish of this menu is already waiting; it publishes the same document.
    return { ok: true, queued: true }
  } catch (error) {
    logError('publish_not_queued', error)
    return fail('queue_unavailable')
  }
}

/**
 * Approves the publish V11 held: queues a manual publish that names it. The worker publishes it
 * only if the menu still has exactly the content it was held with (else the run says
 * `held_outdated`, and the tab offers a plain "Publish" of the menu as it is now).
 */
export async function approveHeld(
  scope: PublishScope,
  services: PublishServices,
  snapshotId: string,
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  const held = idSchema('sn').safeParse(snapshotId)
  if (!held.success) return fail('invalid')
  const menuId = await menuOfVenue(scope.pool, scope.tenantId, scope.venueId)
  if (menuId === null) return fail('no_menu')
  const rows = await loadHeldRows(scope.pool, scope.tenantId, { menuId, venueId: scope.venueId })
  if (!rows.some((row) => row.id === held.data)) return fail('held_not_found')
  try {
    await services.enqueue(JOB_NAMES.publishMenu, {
      tenantId: scope.tenantId as TenantId,
      menuId,
      venueId: scope.venueId,
      reason: 'manual',
      actor: scope.actor,
      approveHold: held.data,
    })
    return { ok: true, queued: true }
  } catch (error) {
    logError('approve_not_queued', error)
    return fail('queue_unavailable')
  }
}

/**
 * Turns down the held publish. Every publish still held for this menu is turned down with it:
 * they all describe states the menu has moved past or is about to leave, and the next one would
 * only appear in the banner in its place.
 */
export async function rejectHeldPublish(
  scope: PublishScope,
  snapshotId: string,
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  const held = idSchema('sn').safeParse(snapshotId)
  if (!held.success) return fail('invalid')
  const menuId = await menuOfVenue(scope.pool, scope.tenantId, scope.venueId)
  if (menuId === null) return fail('no_menu')
  const rows = await loadHeldRows(scope.pool, scope.tenantId, { menuId, venueId: scope.venueId })
  if (!rows.some((row) => row.id === held.data)) return fail('held_not_found')
  try {
    for (const row of rows) {
      try {
        await rejectHeld(scope.pool, scope.tenantId, {
          menuId,
          venueId: scope.venueId,
          snapshotId: row.id as SnapshotId,
          actor: scope.actor,
        })
      } catch (error) {
        // Someone decided this one meanwhile; the others still need turning down.
        if (!(error instanceof PublishError && error.code === 'held_not_found')) throw error
      }
    }
    return { ok: true, queued: false }
  } catch (error) {
    logError('reject_held_failed', error)
    return fail('failed')
  }
}

// --- returning to an earlier version -------------------------------------------------------------

/** The barsy integration this venue is mapped to and whether its automatic publishing is paused. */
async function pauseOf(scope: PublishScope) {
  const [row] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select({ id: integrations.id, config: integrations.config })
      .from(barsyVenues)
      .innerJoin(integrations, eq(integrations.id, barsyVenues.integrationId))
      .where(eq(barsyVenues.venueId, scope.venueId))
      .limit(1),
  )
  return row === undefined ? null : { integrationId: row.id, paused: autoPublishPaused(row.config) }
}

/**
 * Moves the menu back to an earlier published snapshot, pauses automatic publishing, and queues
 * the files for it. A venue with no barsy integration has no automatic publishing to pause.
 */
export async function rollback(
  scope: PublishScope,
  services: PublishServices,
  snapshotId: string,
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  const snapshot = idSchema('sn').safeParse(snapshotId)
  if (!snapshot.success) return fail('invalid')
  const menuId = await menuOfVenue(scope.pool, scope.tenantId, scope.venueId)
  if (menuId === null) return fail('no_menu')

  // Pause first (see the file header); remember whether this call is the one that did.
  let pausedHere: string | null = null
  try {
    const pause = await pauseOf(scope)
    if (pause !== null && !pause.paused) {
      await setAutoPublishPaused(scope.pool, scope.tenantId, pause.integrationId, true)
      pausedHere = pause.integrationId
    }
  } catch (error) {
    logError('rollback_pause_failed', error)
    return fail('failed')
  }
  const undoPause = async () => {
    if (pausedHere === null) return
    try {
      await setAutoPublishPaused(scope.pool, scope.tenantId, pausedHere, false)
    } catch (error) {
      logError('rollback_pause_not_undone', error)
    }
  }

  let moved: Awaited<ReturnType<typeof rollbackTo>>
  try {
    moved = await rollbackTo(scope.pool, scope.tenantId, {
      menuId,
      venueId: scope.venueId,
      snapshotId: snapshot.data,
      actor: scope.actor,
    })
  } catch (error) {
    await undoPause()
    if (error instanceof PublishError) {
      if (error.code === 'nothing_published') return fail('nothing_published')
      if (error.code === 'not_restorable') return fail('not_restorable')
      if (error.code === 'invalid_input') return fail('invalid')
    }
    logError('rollback_failed', error)
    return fail('failed')
  }
  // Already current: nothing moved, nothing to write, nothing to pause.
  if (moved.status === 'unchanged') {
    await undoPause()
    return { ok: true, queued: false }
  }
  try {
    await services.enqueue(JOB_NAMES.publishFiles, {
      tenantId: scope.tenantId as TenantId,
      menuId,
      venueId: scope.venueId,
    })
    return { ok: true, queued: true }
  } catch (error) {
    // The pointer has moved; only the files are late. Say so instead of pretending it failed.
    logError('rollback_files_not_queued', error)
    return { ok: true, queued: false }
  }
}

// --- the preview ---------------------------------------------------------------------------------

export type PreviewResult =
  | { readonly ok: true; readonly snapshot: MenuSnapshot; readonly overlay: LiveOverlay }
  | {
      readonly ok: false
      readonly error: 'no_menu' | 'nothing_visible' | 'blocked' | 'failed'
    }

/**
 * The draft snapshot for the preview: built in memory with the publisher's own builder, schema and
 * leak guard, and never written as files. Anyone in the organisation may look (it publishes
 * nothing).
 */
export async function previewDraft(
  scope: Pick<PublishScope, 'pool' | 'tenantId' | 'venueId'>,
): Promise<PreviewResult> {
  const menuId = await menuOfVenue(scope.pool, scope.tenantId, scope.venueId)
  if (menuId === null) return { ok: false, error: 'no_menu' }
  try {
    const draft = await loadDraft(scope.pool, scope.tenantId, { menuId, venueId: scope.venueId })
    return { ok: true, snapshot: draft.snapshot, overlay: draft.overlay }
  } catch (error) {
    if (error instanceof PublishError) {
      if (error.code === 'no_visible_items') return { ok: false, error: 'nothing_visible' }
      if (error.code === 'menu_blocked') return { ok: false, error: 'blocked' }
    }
    logError('preview_failed', error)
    return { ok: false, error: 'failed' }
  }
}

// --- the venue's publishing rules --------------------------------------------------------------

/**
 * Saves the venue's publishing rules (the Rules card, CF-09b, D73): after a sync, publish by
 * itself or wait for a person; new items from the till, shown or kept hidden until a manager has
 * looked. Both are written as the venue's own, so from then on the venue no longer follows the
 * integration's old setting. Owners and admins, like publishing itself. It applies from the next
 * sync of this venue; nothing is published or hidden by the save.
 */
export async function savePublishRules(
  scope: PublishScope,
  input: { readonly afterSync: string; readonly newItems: string },
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  try {
    await setVenuePublishRules(scope.pool, scope.tenantId, {
      venueId: scope.venueId,
      rules: { after_sync: input.afterSync as 'auto', new_items: input.newItems as 'show' },
    })
    // Nothing is queued by a save of the rules; `queued: true` is only "nothing went wrong".
    return { ok: true, queued: true }
  } catch (error) {
    if (error instanceof ProvisionError) {
      return fail(error.code === 'venue_missing' ? 'not_found' : 'invalid')
    }
    logError('save_publish_rules_failed', error)
    return fail('failed')
  }
}
