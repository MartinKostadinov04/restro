// The end of a service day (#84; D111, design §4).
//
//   service-day-tick  every hour: for each venue, each ended service day that has sittings, sent
//                     orders or payments and no `service_days` row yet is closed through
//                     `applyService` (`service_day.close`), oldest first: its sittings and sent
//                     orders get their 18 months, its action ids are cleared and its totals kept.
//                     Then every recent closed day whose end-of-night message has not gone
//                     (`report_sent_at` null) is sent, oldest first, and marked through
//                     `service_day.report_sent` once Telegram accepts it (#179)
//
// A venue's day ends at its own hour in its own time zone, so the tick runs hourly rather than
// once at 07:00 Sofia. `service_day.close` changes nothing for a day already closed, so a run that
// races another is harmless. A day that fails, or is refused because a payment or sent order of
// it is still moving (`payments_open`, `orders_open`), is logged and skipped, and the venue's later
// days wait for the next run, so the days close in order.
//
// The end-of-night message goes until it has gone, once an hour at most: a failed send is logged
// and tried again at the next tick, never inside one. The queue has `retryLimit: 0` and one job per
// schedule, so two ticks of this job do not overlap; if one ever did, a message could go twice (at
// least once, never lost), and the marker is still set once.

import { randomUUID } from 'node:crypto'

import { JOB_NAMES, serviceDate } from '@restro/core'
import { applyService } from '@restro/core/service'
import { authOrganization, type DbPool, venues, withSystem, withTenant } from '@restro/db'
import { sql } from 'drizzle-orm'

import { type ClosedDay, sendNightReport } from '../alerts/night-report'
import type { TelegramClient } from '../alerts/telegram'
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

/**
 * Closes every due service day; answers how many were closed. A venue stops at its first day that
 * fails or is refused.
 */
export async function closeServiceDays(
  pool: DbPool,
  now: Date,
  log: Pick<Logger, 'info' | 'warn'>,
): Promise<number> {
  let closed = 0
  const stopped = new Set<string>()
  for (const day of await dueServiceDays(pool, now)) {
    if (stopped.has(day.venueId)) continue
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
      if (result.status === 'refused') {
        // Expected and bounded: the day waits until its payments and sent orders are final.
        stopped.add(day.venueId)
        log.info(
          { venueId: day.venueId, serviceDate: day.serviceDate, code: result.code },
          'a service day waits',
        )
      } else if (result.details.changed === true) {
        closed += 1
      }
    } catch (error) {
      stopped.add(day.venueId)
      log.warn(
        { venueId: day.venueId, serviceDate: day.serviceDate, err: error },
        'a service day could not be closed',
      )
    }
  }
  return closed
}

/**
 * The end-of-night message goes only for a night that just ended, not for the old days a venue's
 * first run catches up on (a deploy would otherwise flood its group).
 */
export const NIGHT_REPORT_MAX_AGE_DAYS = 2

/** The oldest service date (inclusive) whose message may still go at `now`. */
export function oldestReportDate(now: Date): string {
  const cutoff = new Date(now.getTime() - (NIGHT_REPORT_MAX_AGE_DAYS + 1) * 86_400_000)
  return cutoff.toISOString().slice(0, 10)
}

function recentEnough(serviceDate: string, now: Date): boolean {
  const days = (now.getTime() - Date.parse(`${serviceDate}T00:00:00Z`)) / 86_400_000
  return days <= NIGHT_REPORT_MAX_AGE_DAYS + 1
}

/**
 * The closed days still to be told: no `report_sent_at` and recent enough, in every organisation,
 * oldest first. The date filter keeps the scan bounded for a venue that never sends (no group).
 */
export async function unsentReportDays(pool: DbPool, now: Date): Promise<ClosedDay[]> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const unsent: ClosedDay[] = []
  for (const organisation of organisations) {
    await withTenant(pool, organisation.id, async (tx) => {
      const rows = await tx.execute<{ venue_id: string; service_date: string }>(sql`
        select venue_id, service_date::text as service_date
          from restro.service_days
         where report_sent_at is null and service_date >= ${oldestReportDate(now)}::date`)
      for (const row of rows.rows) {
        unsent.push({
          tenantId: organisation.id,
          venueId: row.venue_id,
          serviceDate: row.service_date,
        })
      }
    })
  }
  return unsent.sort(
    (a, b) =>
      a.serviceDate.localeCompare(b.serviceDate) ||
      a.venueId.localeCompare(b.venueId) ||
      a.tenantId.localeCompare(b.tenantId),
  )
}

/**
 * Sends the end-of-night message of every recent closed day not yet sent, oldest first, and marks
 * each one (`service_day.report_sent`) once Telegram accepts it; answers how many went. A day with
 * nothing to send (no group, no bot) or a failed send stays unmarked and is looked at again at the
 * next tick, until it is older than `NIGHT_REPORT_MAX_AGE_DAYS`.
 */
export async function sendDueNightReports(
  pool: DbPool,
  now: Date,
  telegram: TelegramClient | null,
  log: Pick<Logger, 'info' | 'warn'>,
): Promise<number> {
  if (telegram === null) return 0
  let sent = 0
  for (const day of await unsentReportDays(pool, now)) {
    if (!recentEnough(day.serviceDate, now)) continue
    if (!(await sendNightReport({ pool, telegram, log }, day))) continue
    try {
      await applyService(
        pool,
        { type: 'service_day.report_sent', serviceDate: day.serviceDate },
        {
          tenantId: day.tenantId,
          venueId: day.venueId,
          origin: 'worker',
          actor: { kind: 'system' },
          jobId: `service-day-${randomUUID()}`,
        },
      )
      sent += 1
    } catch (error) {
      // The message went but is not marked: it goes once more at the next tick (at least once).
      log.warn(
        { venueId: day.venueId, serviceDate: day.serviceDate, err: error },
        'the end-of-night message went but could not be marked',
      )
    }
  }
  return sent
}

/**
 * `service-day-tick`. With a Telegram client, the closed days' end-of-night messages go until they
 * have gone (#86, #179): counts and problems, no amounts.
 */
export function createServiceDayJob(options: {
  readonly telegram: TelegramClient | null
}): JobDefinition {
  return defineJob({
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
      const now = context.now()
      const closed = await closeServiceDays(context.pool, now, context.log)
      if (closed > 0) context.log.info({ closed }, 'service days closed')
      const told = await sendDueNightReports(context.pool, now, options.telegram, context.log)
      if (told > 0) context.log.info({ told }, 'end-of-night messages sent')
    },
  })
}

/** `service-day-tick` without Telegram: the day closes, no message goes. */
export const serviceDayTick: JobDefinition = createServiceDayJob({ telegram: null })
