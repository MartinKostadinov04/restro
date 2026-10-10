// The service-day rollover of `live.json` (brief S3-08, D45/D46). A manager's "sold out tonight"
// marks live in the service edition of one evening, so they lapse when the day changes: the
// resolver stops counting them at 07:00 venue time. But `live.json` is a file, and a file does
// not change by itself: something has to remake it after 07:00 without yesterday's marks, or the
// guests of the next morning (and the next evening) would still be told the item is sold out.
//
// This is that something, run by the minute tick. For every published menu + venue it works out
// the venue's service date NOW and compares it with the one it last asked a `publish-live` for.
// A different date (or none yet) queues `publish-live`, which resolves the document with the new
// day's edition and writes the file when it differs. The record of "last asked" is the tick's
// own memory: `last_live_service_date` per menu + venue, in this process.
//
// Why memory is enough. `publish-live` is idempotent (it writes only when the file differs), so
// asking too often is harmless and asking again is always right. After a restart the memory is
// empty, so the first tick asks for every venue once: a worker that was down across 07:00 repairs
// the file as soon as it is back. Two workers each ask; `publish-live` is `stately` per menu +
// venue, so the second ask folds into the first. The tick also asks again every
// `REASSERT_AFTER_MS` whatever the date, which repairs the cases memory cannot see: a
// `publish-live` that failed after its retries, or a mark whose job the web app could not queue.
import { JOB_NAMES, prepareJob, serviceDate } from '@restro/core'
import { listPublishedScopes } from '@restro/core/apply'
import { authOrganization, type DbPool, withSystem } from '@restro/db'

import type { Logger } from '../logger'

/** How long the tick waits before asking for a venue's `live.json` again on the same day. */
export const REASSERT_AFTER_MS = 10 * 60 * 1000

/** What the tick remembers about one menu + venue: when and for which service date it asked. */
export interface LiveAsk {
  /** `last_live_service_date`: the service date the last `publish-live` was asked for. */
  readonly lastLiveServiceDate: string
  readonly askedAt: number
}

/** The tick's memory, by `<menu id>:<venue id>`. */
export type LiveAsks = Map<string, LiveAsk>

export interface RolloverDeps {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
  /** Puts a job in the queue (`context.queue.send`). */
  readonly enqueue: (
    name: string,
    data: object,
    options: { singletonKey: string },
  ) => Promise<string | null>
  readonly asks: LiveAsks
}

/** What one tick did. */
export interface RolloverReport {
  readonly checked: number
  /** `publish-live` jobs queued because the service date changed (or was never seen). */
  readonly rolledOver: number
  /** Queued again only because the last ask was old (a repair). */
  readonly reasserted: number
  /** Menus whose check failed; the others went on. */
  readonly failed: number
}

/**
 * Queues `publish-live` for every published menu + venue whose service date differs from the one
 * it was last asked for, or that was last asked more than `REASSERT_AFTER_MS` ago. Never throws
 * for one tenant's or venue's trouble: it is logged and the rest go on.
 */
export async function queueLiveRollovers(deps: RolloverDeps): Promise<RolloverReport> {
  const now = deps.now()
  const organisations = await withSystem(deps.pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  let checked = 0
  let rolledOver = 0
  let reasserted = 0
  let failed = 0
  for (const organisation of organisations) {
    let scopes: Awaited<ReturnType<typeof listPublishedScopes>>
    try {
      scopes = await listPublishedScopes(deps.pool, organisation.id)
    } catch (error) {
      failed += 1
      deps.log.warn({ err: error }, 'the published menus of a tenant could not be listed')
      continue
    }
    for (const scope of scopes) {
      checked += 1
      try {
        const day = serviceDate(now, scope.timezone, scope.dayEndsAt)
        const key = `${scope.menuId}:${scope.venueId}`
        const last = deps.asks.get(key)
        const dayChanged = last === undefined || last.lastLiveServiceDate !== day
        const stale = last !== undefined && now.getTime() - last.askedAt >= REASSERT_AFTER_MS
        if (!dayChanged && !stale) continue
        const job = prepareJob(JOB_NAMES.publishLive, {
          tenantId: organisation.id,
          menuId: scope.menuId,
          venueId: scope.venueId,
        })
        // A null answer means a `publish-live` for this menu is already waiting: it will resolve
        // with the day that is current when it runs, so the ask counts as made.
        await deps.enqueue(JOB_NAMES.publishLive, job.data, { singletonKey: job.singletonKey })
        deps.asks.set(key, { lastLiveServiceDate: day, askedAt: now.getTime() })
        if (dayChanged) rolledOver += 1
        else reasserted += 1
      } catch (error) {
        failed += 1
        deps.log.warn({ err: error }, 'live.json could not be queued for a new service day')
      }
    }
  }
  return { checked, rolledOver, reasserted, failed }
}
