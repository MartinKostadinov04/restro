// "Publish now", "Approve", "Reject", "Return to a version", the preview and the Automation
// settings (briefs S3-01b, S3-05, S4), as plain functions the server actions wrap (actions.ts) so
// they can be tested without a request.
//
// A venue has several menus, each with its own versions (D88, D90). "Publish now" and the preview
// take the menu (default: the live one); approving, rejecting and returning name a snapshot, and
// act on the menu that snapshot belongs to.
//
// Publishing is the worker's job: "Publish now" and "Approve" only queue `publish-menu` (reason
// `manual`, the person as actor; an approval names the held snapshot), and the run's outcome
// (published, refused and why) is read back from the job runs by the tab. A return to an earlier
// version is a database change that `rollbackTo` (core/apply) makes at once; it then queues
// `publish-files`, which writes `current.json` for the snapshot the pointer names. Rejecting a
// held publish is a database change too (`rejectHeld`).
//
// A return pauses automatic publishing (the venue's `settings.publish.auto_paused`, T76):
// otherwise the next sync would publish the document again and undo it. The pause
// is set BEFORE the pointer moves, so no automatic publish can slip in between; if the return
// then fails, the pause is taken off again. A manual publish clears it (the worker does that).
import {
  type Actor,
  type AfterSyncMode,
  idSchema,
  JOB_NAMES,
  type JobPayload,
  type LiveOverlay,
  type MenuSnapshot,
  type NodeId,
  type ProducedJobName,
  type SnapshotId,
  type TenantId,
  type VenueId,
  type VenueSyncSettings,
} from '@restro/core'
import {
  loadDraft,
  ProvisionError,
  PublishError,
  rejectHeld,
  rollbackTo,
  setVenueAutoPublishPaused,
  setVenuePublishRules,
  setVenueSyncSettings,
} from '@restro/core/apply'
import type { DbPool } from '@restro/db'

import { logError } from '../log'
import {
  loadHeldRows,
  menuOfSnapshot,
  menuOfVenue,
  menuOfVenueById,
  readOwnPause,
  readPauseState,
} from './load'

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

/**
 * The menu an action is about: `menuId` when given (it must be a menu of the venue in use, else
 * `no_menu`; a malformed id is `invalid`), else the venue's live menu.
 */
async function targetMenu(
  scope: Pick<PublishScope, 'pool' | 'tenantId' | 'venueId'>,
  menuId: string | undefined,
): Promise<{ readonly menuId: NodeId } | { readonly error: 'invalid' | 'no_menu' }> {
  if (menuId === undefined) {
    const live = await menuOfVenue(scope.pool, scope.tenantId, scope.venueId)
    return live === null ? { error: 'no_menu' } : { menuId: live }
  }
  if (!idSchema('nd').safeParse(menuId).success) return { error: 'invalid' }
  const found = await menuOfVenueById(scope.pool, scope.tenantId, scope.venueId, menuId)
  return found === null ? { error: 'no_menu' } : { menuId: found }
}

/**
 * The menu a decision about `snapshotId` acts on: the menu the snapshot belongs to, or (an id this
 * venue has no snapshot under) the live menu, which then answers that it has no such version.
 */
async function menuOfDecision(
  scope: Pick<PublishScope, 'pool' | 'tenantId' | 'venueId'>,
  snapshotId: string,
): Promise<NodeId | null> {
  return (
    (await menuOfSnapshot(scope.pool, scope.tenantId, scope.venueId, snapshotId)) ??
    (await menuOfVenue(scope.pool, scope.tenantId, scope.venueId))
  )
}

/**
 * Queues a manual publish of one of the venue's menus: `menuId`, else the live one. Publishing a
 * menu that is not live publishes that menu; it does not make it live (`setLiveMenu` does).
 */
export async function publishNow(
  scope: PublishScope,
  services: PublishServices,
  menu?: string,
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  const target = await targetMenu(scope, menu)
  if ('error' in target) return fail(target.error)
  const { menuId } = target
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
  const menuId = await menuOfDecision(scope, held.data)
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
  const menuId = await menuOfDecision(scope, held.data)
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

/**
 * Whether this venue's automatic publishing is paused (T76: the venue's own flag, else the old one
 * of the integration it is mapped to); null for a venue with no till (nothing to pause).
 */
function pauseOf(scope: PublishScope): Promise<{ readonly paused: boolean } | null> {
  return readPauseState(scope.pool, scope.tenantId, scope.venueId)
}

/**
 * Moves the snapshot's menu back to that earlier published snapshot, pauses automatic publishing,
 * and queues the files for it. A venue with no till has no automatic publishing to pause.
 */
export async function rollback(
  scope: PublishScope,
  services: PublishServices,
  snapshotId: string,
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  const snapshot = idSchema('sn').safeParse(snapshotId)
  if (!snapshot.success) return fail('invalid')
  const menuId = await menuOfDecision(scope, snapshot.data)
  if (menuId === null) return fail('no_menu')

  // Pause first (see the file header); remember whether this call is the one that did.
  let pausedHere = false
  try {
    const pause = await pauseOf(scope)
    if (pause !== null && !pause.paused) {
      await setVenueAutoPublishPaused(scope.pool, scope.tenantId, scope.venueId, true)
      pausedHere = true
    }
  } catch (error) {
    logError('rollback_pause_failed', error)
    return fail('failed')
  }
  const undoPause = async () => {
    if (!pausedHere) return
    try {
      await setVenueAutoPublishPaused(scope.pool, scope.tenantId, scope.venueId, false)
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
 * The draft snapshot of a menu (`menu`, else the live one) for the preview: built in memory with
 * the publisher's own builder, schema and leak guard, and never written as files. Anyone in the
 * organisation may look (it publishes nothing).
 */
export async function previewDraft(
  scope: Pick<PublishScope, 'pool' | 'tenantId' | 'venueId'>,
  menu?: string,
): Promise<PreviewResult> {
  const target = await targetMenu(scope, menu)
  if ('error' in target)
    return { ok: false, error: target.error === 'invalid' ? 'failed' : 'no_menu' }
  const { menuId } = target
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

// --- the venue's Automation settings ---------------------------------------------------------------

/** What the Automation settings save (D82, D96): the sync mode and the rule after a sync. */
export interface AutomationInput {
  readonly sync: VenueSyncSettings
  readonly afterSync: AfterSyncMode
}

/**
 * Saves the venue's Automation settings (Settings › Publish, D82, D96): the sync mode with its
 * schedule (`setVenueSyncSettings`) and whether a sync publishes by itself
 * (`setVenuePublishRules`). Both become the venue's own. Owners and admins, like publishing. A
 * venue without a till has nothing to automate (`not_found`). Nothing is synced or published by
 * the save.
 *
 * `setVenuePublishRules` rewrites the whole of `settings.publish`, which also holds the rollback
 * pause (T76); the pause the venue had is written back right after, so a save never resumes or
 * starts automatic publishing by itself.
 */
export async function saveAutomation(
  scope: PublishScope,
  input: AutomationInput,
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  try {
    if ((await pauseOf(scope)) === null) return fail('not_found')
    const pause = await readOwnPause(scope.pool, scope.tenantId, scope.venueId)
    await setVenueSyncSettings(scope.pool, scope.tenantId, {
      venueId: scope.venueId,
      sync: input.sync,
    })
    await setVenuePublishRules(scope.pool, scope.tenantId, {
      venueId: scope.venueId,
      rules: { after_sync: input.afterSync },
    })
    if (pause !== null) {
      await setVenueAutoPublishPaused(scope.pool, scope.tenantId, scope.venueId, pause)
    }
    // Nothing is queued by a save; `queued: true` is only "nothing went wrong".
    return { ok: true, queued: true }
  } catch (error) {
    if (error instanceof ProvisionError) {
      return fail(
        error.code === 'venue_missing' || error.code === 'venue_archived' ? 'not_found' : 'invalid',
      )
    }
    logError('save_automation_failed', error)
    return fail('failed')
  }
}

/**
 * "Resume automatic publishing" after a return to an earlier version (D96): takes the venue's
 * pause off without publishing, so the next sync publishes again. Owners and admins.
 */
export async function resumeAutoPublish(scope: PublishScope): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  try {
    await setVenueAutoPublishPaused(scope.pool, scope.tenantId, scope.venueId, false)
    return { ok: true, queued: false }
  } catch (error) {
    if (error instanceof ProvisionError) {
      return fail(error.code === 'invalid_input' ? 'invalid' : 'not_found')
    }
    logError('resume_auto_publish_failed', error)
    return fail('failed')
  }
}
