// "Publish now" and "Roll back" (brief S3-01b), as plain functions the server actions wrap
// (actions.ts) so they can be tested without a request. S3-05 builds the Publish tab on them.
//
// Publishing is the worker's job: "Publish now" only queues `publish-menu` (reason `manual`, the
// person as actor), and the run's outcome (published, held, refused and why) is read back from
// the job runs. A rollback is a database change that `rollbackTo` (core/apply) makes at once; it
// then queues `publish-files`, which writes `current.json` for the snapshot the pointer names.
import {
  type Actor,
  idSchema,
  JOB_NAMES,
  type JobPayload,
  type NodeId,
  type ProducedJobName,
  type TenantId,
  type VenueId,
} from '@restro/core'
import { PublishError, rollbackTo } from '@restro/core/apply'
import { type DbPool, menus, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import { logError } from '../log'

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

async function menuOf(scope: PublishScope): Promise<NodeId | null> {
  const [row] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx.select({ id: menus.id }).from(menus).where(eq(menus.venueId, scope.venueId)).limit(1),
  )
  return (row?.id as NodeId | undefined) ?? null
}

/** Queues a manual publish of the venue's menu. */
export async function publishNow(
  scope: PublishScope,
  services: PublishServices,
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  const menuId = await menuOf(scope)
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

/** Moves the menu back to an earlier published snapshot and queues the files for it. */
export async function rollback(
  scope: PublishScope,
  services: PublishServices,
  snapshotId: string,
): Promise<PublishActionResult> {
  if (!scope.canPublish) return fail('not_allowed')
  const snapshot = idSchema('sn').safeParse(snapshotId)
  if (!snapshot.success) return fail('invalid')
  const menuId = await menuOf(scope)
  if (menuId === null) return fail('no_menu')
  let moved: Awaited<ReturnType<typeof rollbackTo>>
  try {
    moved = await rollbackTo(scope.pool, scope.tenantId, {
      menuId,
      venueId: scope.venueId,
      snapshotId: snapshot.data,
      actor: scope.actor,
    })
  } catch (error) {
    if (error instanceof PublishError) {
      if (error.code === 'nothing_published') return fail('nothing_published')
      if (error.code === 'not_restorable') return fail('not_restorable')
      if (error.code === 'invalid_input') return fail('invalid')
    }
    logError('rollback_failed', error)
    return fail('failed')
  }
  // Already current: nothing moved, nothing to write.
  if (moved.status === 'unchanged') return { ok: true, queued: false }
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
