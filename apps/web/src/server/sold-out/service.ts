// "Sold out tonight" and "Back on sale" (brief S3-08, D46, rule 5), as a plain function of a
// database pool so a test can run it against Postgres without a request. The server actions of the
// composer and of the item sheet wrap it.
//
// Who may: owners and admins (D46: waiters never use our admin). What it writes: core's
// `setSoldOutTonight`, one atomic change set through `apply()` that sets `for_sale = false` in the
// venue's service edition, or clears that row. It has no way to write `true`: "back on sale" only
// removes OUR mark, so an item barsy has off sale stays off sale. What it queues afterwards:
// `publish-live` for the menu + venue, which remakes `live.json`; guests see the change on their
// next look at it (the page looks every 15 s). No snapshot is made.
import {
  type Actor,
  JOB_NAMES,
  type JobPayload,
  type NodeId,
  type ProducedJobName,
  type TenantId,
  type VenueId,
} from '@restro/core'
import { ApplyError, SoldOutError, setSoldOutTonight } from '@restro/core/apply'
import type { DbPool } from '@restro/db'

import { logError } from '../log'
import { menuOfVenue } from '../publish/load'

/** Who is asking, for which venue. `canMark` comes from the organisation role. */
export interface SoldOutScope {
  readonly pool: DbPool
  readonly tenantId: string
  readonly venueId: VenueId
  /** `user:<id>`: recorded as the actor of the change. */
  readonly actor: Actor
  readonly canMark: boolean
}

/** What the function needs from outside the database. */
export interface SoldOutServices {
  /** Puts a job in the queue (`enqueueJob`); null when an identical job is already waiting. */
  readonly enqueue: <N extends ProducedJobName>(
    name: N,
    data: JobPayload<N>,
  ) => Promise<string | null>
  /** The clock that decides the service day; tests inject it. */
  readonly now?: () => Date
}

/** Why nothing was changed. */
export type SoldOutFailure =
  /** The person's role may not mark items sold out. */
  | 'not_allowed'
  /** The venue, its menu or an item is not the organisation's. */
  | 'not_found'
  /** The request is not what the function takes. */
  | 'invalid'
  /** `apply()` refused the change. */
  | 'rejected'
  | 'failed'

/**
 * `liveQueued` is false only when the change was saved but the `publish-live` job could not be
 * queued: guests follow within about ten minutes anyway (the worker's tick asks again), or at
 * once with the next change.
 */
export type SoldOutResult =
  | { readonly ok: true; readonly changed: number; readonly liveQueued: boolean }
  | { readonly ok: false; readonly error: SoldOutFailure }

const fail = (error: SoldOutFailure): SoldOutResult => ({ ok: false, error })

/** Marks items sold out tonight (`soldOut`), or takes the mark off again. */
export async function setItemsSoldOut(
  scope: SoldOutScope,
  services: SoldOutServices,
  input: { readonly itemIds: readonly string[]; readonly soldOut: boolean },
): Promise<SoldOutResult> {
  if (!scope.canMark) return fail('not_allowed')
  const menuId = await menuOfVenue(scope.pool, scope.tenantId, scope.venueId)
  if (menuId === null) return fail('not_found')
  let changed: number
  try {
    const result = await setSoldOutTonight(
      scope.pool,
      scope.tenantId,
      {
        venueId: scope.venueId,
        itemIds: [...input.itemIds] as NodeId[],
        soldOut: input.soldOut,
        actor: scope.actor,
      },
      services.now ? { now: services.now() } : {},
    )
    changed = result.applied
  } catch (error) {
    if (error instanceof SoldOutError) {
      return fail(error.code === 'invalid_input' ? 'invalid' : 'not_found')
    }
    if (error instanceof ApplyError) {
      if (error.code === 'change_set_rejected') {
        const codes = error.rejected.map((rejection) => rejection.code).join(',')
        logError('sold_out_rejected', new Error(`rejected: ${codes}`))
        return fail('rejected')
      }
      return fail('invalid')
    }
    logError('sold_out_failed', error)
    return fail('failed')
  }
  // Asked even when nothing changed: a repeat of a request whose job could not be queued repairs it.
  let liveQueued = true
  try {
    await services.enqueue(JOB_NAMES.publishLive, {
      tenantId: scope.tenantId as TenantId,
      menuId,
      venueId: scope.venueId,
    })
  } catch (error) {
    logError('sold_out_live_not_queued', error)
    liveQueued = false
  }
  return { ok: true, changed, liveQueued }
}
