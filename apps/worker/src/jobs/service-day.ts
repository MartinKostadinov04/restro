// The end of a service day (#84; D111, design §4).
//
//   service-day-tick  every hour: for each venue, each ended service day that has sittings, sent
//                     orders or payments and no `service_days` row yet is closed through
//                     `applyService` (`service_day.close`), oldest first: its sittings and sent
//                     orders get their 18 months, its action ids are cleared and its totals kept
//
// A venue's day ends at its own hour in its own time zone, so the tick runs hourly rather than
// once at 07:00 Sofia. `service_day.close` changes nothing for a day already closed, so a run that
// races another is harmless. A day that fails is logged and skipped, and the venue's later days
// wait for the next run, so the days close in order.

import { randomUUID } from 'node:crypto'

import { JOB_NAMES, serviceDate } from '@restro/core'
import { applyService } from '@restro/core/service'
import { authOrganization, type DbPool, venues, withSystem, withTenant } from '@restro/db'
import { sql } from 'drizzle-orm'

import type { Logger } from '../logger'
import { defineJob, type JobDefinition } from './types'

/** One ended service day of a venue still to close. */
export interface DueServiceDay {
  readonly tenantId: string
  readonly venueId: string
  readonly serviceDate: string
}

/** The ended service days with rows and no `service_days` row, in every organisation, oldest first. */
export async function dueServiceDays(pool: DbPool, now: Date): Promise<DueServiceDay[]> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const due: DueServiceDay[] = []
  for (const organisation of organisations) {
    await withTenant(pool, organisation.id, async (tx) => {
      const venueRows = await tx
        .select({
          id: venues.id,
          timezone: venues.timezone,
          dayEndsAt: venues.serviceDayEndsAt,
        })
        .from(venues)
      for (const venue of venueRows) {
        const today = serviceDate(now, venue.timezone, venue.dayEndsAt)
        const days = await tx.execute<{ service_date: string }>(sql`
          select distinct day.service_date::text as service_date
            from (
              select service_date from restro.sittings where venue_id = ${venue.id}
              union select service_date from restro.sent_orders where venue_id = ${venue.id}
              union select service_date from restro.payments where venue_id = ${venue.id}
            ) day
           where day.service_date < ${today}::date
             and not exists (
               select 1 from restro.service_days closed
                where closed.venue_id = ${venue.id} and closed.service_date = day.service_date)
           order by service_date`)
        for (const row of days.rows) {
          due.push({ tenantId: organisation.id, venueId: venue.id, serviceDate: row.service_date })
        }
      }
    })
  }
  return due
}

/** Closes every due service day; answers how many were closed. A venue stops at its first failure. */
export async function closeServiceDays(
  pool: DbPool,
  now: Date,
  log: Pick<Logger, 'warn'>,
): Promise<number> {
  let closed = 0
  const failed = new Set<string>()
  for (const day of await dueServiceDays(pool, now)) {
    if (failed.has(day.venueId)) continue
    try {
      const { result } = await applyService(
        pool,
        { type: 'service_day.close', serviceDate: day.serviceDate },
        {
          tenantId: day.tenantId,
          venueId: day.venueId,
          origin: 'worker',
          actor: { kind: 'system' },
          jobId: `service-day-${randomUUID()}`,
        },
      )
      if (result.status === 'accepted' && result.details.changed === true) closed += 1
    } catch (error) {
      failed.add(day.venueId)
      log.warn(
        { venueId: day.venueId, serviceDate: day.serviceDate, err: error },
        'a service day could not be closed',
      )
    }
  }
  return closed
}

/** `service-day-tick`. */
export const serviceDayTick: JobDefinition = defineJob({
  name: JOB_NAMES.serviceDayTick,
  schedule: { cron: '5 * * * *', tz: 'Europe/Sofia' },
  options: {
    queue: {
      retryLimit: 0,
      expireInSeconds: 30 * 60,
      retentionSeconds: 60 * 60,
      deleteAfterSeconds: 24 * 60 * 60,
    },
  },
  async handler(_jobs, context) {
    const closed = await closeServiceDays(context.pool, context.now(), context.log)
    if (closed > 0) context.log.info({ closed }, 'service days closed')
  },
})
