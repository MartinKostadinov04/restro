// The venue's night in the worker (#82; D120, D122 §4).
//
//   service-hours-tick  every minute: at a venue's closing hour, closes every table for phones
//                       (`hours.close_tables`: a Log entry per table, reason `closing_hour`), and
//                       later, even by day, a table that closing kept for a payment, once it ended
//   pre-opening-tick    every minute: from 2 hours before a venue opens, every 10 minutes (both
//                       the venue's settings), checks that Restro can work with its POS: the
//                       connector's read-only probe, the one a pause uses. A refusal pauses the
//                       connection at once and an unreachable POS does too, so the venue opens in
//                       a venue pause until probes pass (D120). From 30 minutes before opening a
//                       failed check also raises the pre-opening alert (#83 tells the venue's
//                       staff and Restro's team), once a night (`hours.pre_opening_alert`).
//
// Hours are the venue's wall-clock times in its zone on its service day (`serviceNightAt`). A
// venue that has opened no weekday has no hours and nothing here touches it; a closed night has
// no opening, so no check and no alert. The tick is idempotent: a closing run on closed tables
// changes nothing, and a check that runs twice in one cadence slot (a restart) alerts once.

import { randomUUID } from 'node:crypto'

import {
  hoursConfigured,
  JOB_NAMES,
  type OrderingSettings,
  preOpeningCheckAt,
  readOrderingSettings,
  serviceNightAt,
} from '@restro/core'
import { applyService, BREAKER_CAUSES } from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  integrations,
  payments,
  sittings,
  venues,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, exists, isNull, lt, notExists } from 'drizzle-orm'
import type { Logger } from '../logger'
import {
  assertSimAllowed,
  ServiceConnectorRefused,
  serviceConnectorFor,
} from '../service-connectors'
import { type BreakerEnvironment, SHARED_BREAKERS } from './breaker'
import { type ConnectionJobDeps, probeOnce } from './connection'
import { floorTargets } from './floor'
import { defineJob, type JobDefinition } from './types'

/** A live venue that has opened some weekday, with its clock. */
export interface NightVenue {
  readonly tenantId: string
  readonly venueId: string
  readonly timeZone: string
  readonly dayEndsAt: string
  readonly settings: OrderingSettings
}

/** The live venues, in every organisation, that have service hours. */
export async function venuesWithHours(pool: DbPool): Promise<NightVenue[]> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const found: NightVenue[] = []
  for (const organisation of organisations) {
    const rows = await withTenant(pool, organisation.id, (tx) =>
      tx
        .select({
          venueId: venues.id,
          timeZone: venues.timezone,
          dayEndsAt: venues.serviceDayEndsAt,
          stored: venues.settings,
        })
        .from(venues)
        .where(isNull(venues.archivedAt)),
    )
    for (const row of rows) {
      const settings = readOrderingSettings(row.stored)
      if (!hoursConfigured(settings.serviceHours)) continue
      found.push({
        tenantId: organisation.id,
        venueId: row.venueId,
        timeZone: row.timeZone,
        dayEndsAt: row.dayEndsAt,
        settings,
      })
    }
  }
  return found
}

const clockOf = (venue: NightVenue) => ({
  timeZone: venue.timeZone,
  dayEndsAt: venue.dayEndsAt,
  hours: venue.settings.serviceHours,
})

/**
 * Closes every table of each venue whose closing hour has come and that still has one open, and a
 * table an earlier night's closing kept for its payment. Answers how many tables were closed. A
 * venue that fails is logged and skipped.
 */
export async function closeTablesAtClosingHour(
  pool: DbPool,
  now: Date,
  log: Pick<Logger, 'warn'>,
): Promise<number> {
  let closed = 0
  for (const venue of await venuesWithHours(pool)) {
    const night = serviceNightAt(now, clockOf(venue))
    try {
      // Outside the closing time, only a sitting with a payment of an earlier service day, and no
      // payment still going, can be due: the command decides, and it is not asked for nothing.
      const [open] = await withTenant(pool, venue.tenantId, (tx) =>
        tx
          .select({ id: sittings.id })
          .from(sittings)
          .where(
            and(
              eq(sittings.venueId, venue.venueId),
              isNull(sittings.endedAt),
              night.tablesClosed
                ? undefined
                : and(
                    exists(
                      tx
                        .select({ id: payments.id })
                        .from(payments)
                        .where(
                          and(
                            eq(payments.sittingId, sittings.id),
                            lt(payments.serviceDate, night.serviceDate),
                          ),
                        ),
                    ),
                    notExists(
                      tx
                        .select({ id: payments.id })
                        .from(payments)
                        .where(
                          and(eq(payments.sittingId, sittings.id), isNull(payments.settledAt)),
                        ),
                    ),
                  ),
            ),
          )
          .limit(1),
      )
      if (open === undefined) continue
      const { result } = await applyService(
        pool,
        { type: 'hours.close_tables' },
        {
          tenantId: venue.tenantId,
          venueId: venue.venueId,
          origin: 'worker',
          actor: { kind: 'system' },
          jobId: `service-hours-${randomUUID()}`,
          now,
        },
      )
      if (result.status === 'accepted') closed += Number(result.details.closed ?? 0)
    } catch (error) {
      log.warn(
        { venueId: venue.venueId, err: error },
        'the closing hour could not close the tables',
      )
    }
  }
  return closed
}

/** The check slots already run by this process: `venue:night:slot`. */
export type CheckedSlots = Set<string>

/** What one pre-opening run did. */
export interface PreOpeningRun {
  /** POS connections probed. */
  readonly checked: number
  /** Connections whose check failed. */
  readonly failed: number
  /** Venues alerted. */
  readonly alerted: number
}

/**
 * Runs the pre-opening check that is due now at each venue with hours: probes each POS instance
 * the venue is read from, feeds the connection's breaker, and from the alert time on alerts when
 * the check failed. A venue with no POS instance (a hand-made venue) has nothing to check.
 */
export async function runPreOpeningChecks(
  env: BreakerEnvironment,
  deps: ConnectionJobDeps,
  checked: CheckedSlots,
): Promise<PreOpeningRun> {
  const now = env.now()
  const due = (await venuesWithHours(env.pool)).flatMap((venue) => {
    const check = preOpeningCheckAt(now, clockOf(venue), venue.settings.preOpeningCheck)
    const key = check === null ? null : `${venue.venueId}:${check.serviceDate}:${check.slot}`
    return check === null || key === null || checked.has(key) ? [] : [{ venue, check, key }]
  })
  if (due.length === 0) return { checked: 0, failed: 0, alerted: 0 }
  const targets = await floorTargets(env.pool, deps.sim)
  const breakers = deps.breakers ?? SHARED_BREAKERS
  let probed = 0
  let failed = 0
  let alerted = 0
  for (const { venue, check, key } of due) {
    checked.add(key)
    let cause: string | null = null
    for (const target of targets.filter((one) => one.venueId === venue.venueId)) {
      const ref = { tenantId: target.tenantId, integrationId: target.integrationId }
      const verdict = await probeNow(env, deps, ref)
      if (verdict === 'skipped') continue
      probed += 1
      if (verdict === 'no_turn') continue
      // A good probe is the breaker's too: it counts toward lifting a pause the check started.
      if (verdict.outcome === 'good') {
        await breakers.record(env, ref, { kind: 'probe', outcome: 'good', cause: null })
        continue
      }
      failed += 1
      cause = verdict.cause ?? BREAKER_CAUSES.unreachable
      // The venue opens in a venue pause until probes pass (D120): a refusal trips the breaker as
      // it does at any hour, and so does a POS that does not answer.
      await breakers.record(
        env,
        ref,
        verdict.outcome === 'refused'
          ? { kind: 'probe', outcome: 'refused', cause }
          : { kind: 'refused', cause },
      )
    }
    if (cause === null || !check.alert) continue
    try {
      const { result } = await applyService(
        env.pool,
        {
          type: 'hours.pre_opening_alert',
          serviceDate: check.serviceDate,
          opensAt: check.opensAt.toISOString(),
          cause,
        },
        {
          tenantId: venue.tenantId,
          venueId: venue.venueId,
          origin: 'worker',
          actor: { kind: 'system' },
          jobId: `pre-opening-${randomUUID()}`,
          now,
        },
      )
      if (result.status === 'accepted' && Number(result.details.raised ?? 0) > 0) alerted += 1
    } catch (error) {
      env.log.warn({ venueId: venue.venueId, err: error }, 'the pre-opening alert failed')
    }
  }
  return { checked: probed, failed, alerted }
}

/** One probe of an instance's connection; `skipped` when no connector can be built for it. */
async function probeNow(
  env: BreakerEnvironment,
  deps: ConnectionJobDeps,
  ref: { tenantId: string; integrationId: string },
) {
  const [integration] = await withTenant(env.pool, ref.tenantId, (tx) =>
    tx.select().from(integrations).where(eq(integrations.id, ref.integrationId)),
  )
  if (integration === undefined || integration.removedAt !== null) return 'skipped' as const
  try {
    if (integration.kind === 'sim') assertSimAllowed(deps.sim)
    const connector = (deps.connectorFor ?? serviceConnectorFor)(integration, deps.sim)
    return await probeOnce(env, ref, connector, deps)
  } catch (error) {
    if (error instanceof ServiceConnectorRefused) return 'skipped' as const
    throw error
  }
}

const TICK_QUEUE = {
  retryLimit: 0,
  expireInSeconds: 120,
  retentionSeconds: 10 * 60,
  deleteAfterSeconds: 60 * 60,
} as const

/** `service-hours-tick`: closes the tables at the closing hour. */
export const serviceHoursTick: JobDefinition = defineJob({
  name: JOB_NAMES.serviceHoursTick,
  schedule: { cron: '* * * * *', tz: 'Europe/Sofia' },
  options: { queue: TICK_QUEUE },
  async handler(_jobs, context) {
    const closed = await closeTablesAtClosingHour(context.pool, context.now(), context.log)
    if (closed > 0) context.log.info({ closed }, 'tables closed at the closing hour')
  },
})

/** `pre-opening-tick`, where this worker reads a POS. */
export function createPreOpeningJobs(deps: ConnectionJobDeps): JobDefinition[] {
  const checked: CheckedSlots = new Set()
  const preOpeningTick = defineJob({
    name: JOB_NAMES.preOpeningTick,
    schedule: { cron: '* * * * *', tz: 'Europe/Sofia' },
    options: { queue: TICK_QUEUE },
    async handler(_jobs, context) {
      if (checked.size > 5000) checked.clear()
      const run = await runPreOpeningChecks(
        { pool: context.pool, log: context.log, now: context.now, queue: context.queue },
        deps,
        checked,
      )
      if (run.checked > 0) context.log.info(run, 'pre-opening check')
    },
  })
  return [preOpeningTick] as JobDefinition[]
}
