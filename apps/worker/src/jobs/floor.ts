// The floor reading jobs (#71; spec #64 Implementation Decisions 3 and 7; verification: platform
// rows 11 and 20, round-2 row 11).
//
//   floor-read       read one mapped venue's floor through its instance's service connector and
//                    write it (bars, tables, the payment tables among them) through `apply()`
//   floor-read-tick  every minute: queue a read for each mapped venue of a floor-reading kind whose
//                    last read is older than the interval
//
// What the job keeps to:
// - A reading that is not complete concludes nothing and writes nothing (rule 6): `applyFloor`
//   refuses it, and the run says so. A table that vanishes from a complete reading pauses its open
//   sitting through `applyService` (it is never deleted, never ended); one listed again lifts the
//   pause. Only the worker sends those commands.
// - The instance, not the venue, owns the connection: two venues sharing one POS installation take
//   turns on one budget (a limiter per instance, shared by every job of this process), and a
//   connection pause is the instance's (`pauses` scope `connection`, target the `in_` id), which
//   stops both venues' reads at once. Each venue still reads only its own halls or bars
//   (`venues.settings.floor_source`).
// - A `sim` instance is refused in production before anything is recorded against its host.
// - The web app never calls a POS; this job is the only reader.

import {
  JOB_NAMES,
  prepareJob,
  type ServiceReader,
  type VenueSyncJob,
  VenueSyncJobSchema,
} from '@restro/core'
import { applyFloor, finishJobRun, startJobRun } from '@restro/core/apply'
import { applyService } from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  integrations,
  jobRuns,
  pauses,
  venues,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Job } from 'pg-boss'

import type { SimPolicy } from '../config'
import { tillVenueLinks } from '../connectors'
import type { Logger } from '../logger'
import {
  assertSimAllowed,
  readsFloor,
  ServiceConnectorRefused,
  serviceConnectorFor,
  serviceContext,
} from '../service-connectors'
import { createLimiter, type Limiter } from '../sync/limiter'
import { defineJob, type JobDefinition, type WorkerContext } from './types'

const MINUTE = 60_000

/** A venue's floor is read again when its last read is this old. */
export const FLOOR_READ_INTERVAL_MS = 5 * MINUTE

/** The `job_runs.kind` of a floor read. */
export const FLOOR_RUN_KIND = 'floor_read'

/** The connector kinds whose floor this worker reads. */
const FLOOR_KINDS = ['sim'] as const

/**
 * One budget per POS instance, shared by every job of this process (verification, round-2 row 11):
 * two venues of one installation never read it at the same time. One call chain at a time is the
 * starting value; a connector with a stated rate limit gets its own figure with its own ticket.
 */
export class InstanceBudgets {
  readonly #limiters = new Map<string, Limiter>()

  forInstance(integrationId: string): Limiter {
    let limiter = this.#limiters.get(integrationId)
    if (limiter === undefined) {
      limiter = createLimiter(1)
      this.#limiters.set(integrationId, limiter)
    }
    return limiter
  }
}

export interface FloorEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
}

export interface FloorJobDeps {
  readonly sim: SimPolicy
  readonly budgets?: InstanceBudgets
  /** Builds the connector of an instance; tests pass their own. */
  readonly connectorFor?: typeof serviceConnectorFor
}

/** What one floor read did. */
export type FloorOutcome =
  /** Not run: the instance or link is gone, or the instance's connection is paused. */
  | { readonly kind: 'skipped'; readonly reason: string }
  /** Refused before the POS was asked (a `sim` instance in production, a host that is not allowed). */
  | { readonly kind: 'refused'; readonly code: string; readonly reason: string }
  /** The POS did not give a whole floor: nothing was concluded or written (rule 6). */
  | { readonly kind: 'incomplete'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string }
  | {
      readonly kind: 'read'
      readonly counters: Readonly<Record<string, number>>
      readonly notes: readonly string[]
    }

/** An instance's active connection pause, if any (the instance owns it, not a venue). */
export async function connectionPaused(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
): Promise<boolean> {
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ id: pauses.id })
      .from(pauses)
      .where(
        and(
          eq(pauses.scope, 'connection'),
          eq(pauses.targetId, integrationId),
          isNull(pauses.liftedAt),
        ),
      )
      .limit(1),
  )
  return rows.length > 0
}

/** Reads one venue's floor and writes it. Never throws for what a POS or a refusal causes. */
export async function readFloorOf(
  env: FloorEnvironment,
  payload: VenueSyncJob,
  deps: FloorJobDeps,
): Promise<FloorOutcome> {
  const { pool, log, now } = env
  const { tenantId, integrationId, venueId } = payload

  const [integration] = await withTenant(pool, tenantId, (tx) =>
    tx.select().from(integrations).where(eq(integrations.id, integrationId)),
  )
  if (integration === undefined || integration.removedAt !== null) {
    return { kind: 'skipped', reason: 'this tenant has no such instance' }
  }
  if (!readsFloor(integration.kind)) {
    return { kind: 'skipped', reason: `${integration.kind} has no floor reading` }
  }

  const [link] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ bid: tillVenueLinks.bid })
      .from(tillVenueLinks)
      .where(
        and(eq(tillVenueLinks.integrationId, integrationId), eq(tillVenueLinks.venueId, venueId)),
      ),
  )
  if (link === undefined) return { kind: 'skipped', reason: 'the venue serves no till venue' }

  const run = await startJobRun(pool, tenantId, { kind: FLOOR_RUN_KIND, integrationId, venueId })
  const finish = async (
    status: 'completed' | 'failed',
    outcome: FloorOutcome,
    counters: Record<string, number> = {},
    notes: readonly string[] = [],
  ) => {
    await finishJobRun(pool, tenantId, run.id, {
      status,
      counters,
      notes,
      venueId,
      ...(status === 'failed' ? { summary: notes.join('; ') } : {}),
    })
    return outcome
  }

  // A `sim` instance in production: refused before the host is asked (test-POS design §7 risk 3).
  let connector: ServiceReader
  try {
    if (integration.kind === 'sim') assertSimAllowed(deps.sim)
    connector = (deps.connectorFor ?? serviceConnectorFor)(integration, deps.sim)
  } catch (error) {
    if (error instanceof ServiceConnectorRefused) {
      log.warn({ integrationId, code: error.code }, 'the floor read was refused')
      return finish('failed', { kind: 'refused', code: error.code, reason: error.message }, {}, [
        `refused: ${error.message}`,
      ])
    }
    throw error
  }

  // The instance's pause stops every venue of it at once; a paused connection is probed by its
  // breaker (D120), not by reads.
  if (await connectionPaused(pool, tenantId, integrationId)) {
    return finish('completed', { kind: 'skipped', reason: 'the connection is paused' }, {}, [
      'skipped: the connection is paused',
    ])
  }

  const budget = (deps.budgets ?? SHARED_BUDGETS).forInstance(integrationId)
  let reading: Awaited<ReturnType<ServiceReader['readFloor']>>
  try {
    reading = await budget.run(() => connector.readFloor(serviceContext(now)))
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the floor could not be read'
    log.warn({ integrationId, venueId, err: error }, 'the floor could not be read')
    return finish('failed', { kind: 'failed', reason }, {}, [`failed: ${reason}`])
  }
  if (!reading.complete) {
    // Rule 6: nothing is concluded. `applyFloor` would refuse it too; the run says why.
    return finish('failed', { kind: 'incomplete', reason: reading.reason }, {}, [
      `the floor reading was not complete (${reading.reason}); nothing was concluded`,
    ])
  }

  let applied: Awaited<ReturnType<typeof applyFloor>>
  try {
    applied = await applyFloor(pool, tenantId, {
      integrationId,
      bid: link.bid,
      jobId: run.id,
      reading,
      capabilities: connector.capabilities,
      now: now(),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the floor could not be written'
    log.error({ integrationId, venueId, err: error }, 'the floor could not be written')
    return finish('failed', { kind: 'failed', reason }, {}, [`failed: ${reason}`])
  }
  if (applied.kind === 'incomplete') {
    return finish('failed', { kind: 'incomplete', reason: applied.reason }, {}, [
      `the floor reading was not complete (${applied.reason}); nothing was concluded`,
    ])
  }
  if (applied.kind === 'not_linked') {
    return finish('completed', { kind: 'skipped', reason: applied.reason }, {}, [
      `skipped: ${applied.reason}`,
    ])
  }

  // Verification, platform row 20: a vanished table pauses its sitting, a returned one lifts it.
  const context = {
    tenantId,
    venueId: applied.venueId,
    origin: 'worker',
    actor: { kind: 'integration', integrationId },
    jobId: run.id,
  } as const
  let paused = 0
  let lifted = 0
  let stepsRefused = 0
  const steps = [
    ...applied.vanished.map((tableId) => ({ type: 'floor.table_vanished', tableId })),
    ...applied.returned.map((tableId) => ({ type: 'floor.table_returned', tableId })),
  ]
  for (const step of steps) {
    try {
      const { result } = await applyService(pool, step, context)
      if (result.status === 'refused') {
        stepsRefused += 1
        log.warn({ code: result.code, step: step.type }, 'a floor step was refused')
      } else if (step.type === 'floor.table_vanished' && result.details.paused === true) {
        paused += 1
      } else if (step.type === 'floor.table_returned' && result.details.lifted === true) {
        lifted += 1
      }
    } catch (error) {
      stepsRefused += 1
      log.warn({ err: error, step: step.type }, 'a floor step failed')
    }
  }

  const notes = [
    ...(applied.held === null
      ? []
      : [
          `held: ${applied.held.reason}; ${applied.held.wouldHide} tables would have gone missing, none did`,
        ]),
    ...(applied.skippedClaimed > 0
      ? [`${applied.skippedClaimed} tables belong to another venue of the instance`]
      : []),
    ...(applied.barsSkipped > 0 ? [`${applied.barsSkipped} bars have a key that is too long`] : []),
  ]
  const counters = {
    tables_listed: applied.listed,
    tables_created: applied.tablesCreated,
    tables_updated: applied.tablesUpdated,
    tables_vanished: applied.vanished.length,
    tables_returned: applied.returned.length,
    sittings_paused: paused,
    pauses_lifted: lifted,
    steps_refused: stepsRefused,
    bars_created: applied.barsCreated,
    bars_archived: applied.barsArchived,
    skipped_claimed: applied.skippedClaimed,
  }
  return finish('completed', { kind: 'read', counters, notes }, counters, notes)
}

/** The instance budgets of this process: the floor and table reads share them. */
export const SHARED_BUDGETS = new InstanceBudgets()

/** The mapped venues of the floor-reading kinds, with when each was last read. */
export async function floorTargets(pool: DbPool, sim: SimPolicy) {
  // `sim` is never scheduled in production (the job would refuse it anyway).
  const kinds = FLOOR_KINDS.filter((kind) => kind !== 'sim' || sim.env !== 'production')
  if (kinds.length === 0) return []
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const targets: {
    tenantId: string
    integrationId: string
    venueId: string
    lastReadAt: Date | null
  }[] = []
  for (const organisation of organisations) {
    const rows = await withTenant(pool, organisation.id, async (tx) => {
      const linked = await tx
        .select({ integrationId: integrations.id, venueId: tillVenueLinks.venueId })
        .from(integrations)
        .innerJoin(tillVenueLinks, eq(tillVenueLinks.integrationId, integrations.id))
        .innerJoin(venues, eq(venues.id, tillVenueLinks.venueId))
        .where(
          and(
            inArray(integrations.kind, [...kinds]),
            isNull(integrations.removedAt),
            isNull(venues.archivedAt),
          ),
        )
      const result: { integrationId: string; venueId: string; lastReadAt: Date | null }[] = []
      for (const row of linked) {
        if (row.venueId === null) continue
        const [last] = await tx
          .select({ at: jobRuns.createdAt })
          .from(jobRuns)
          .where(
            and(
              eq(jobRuns.integrationId, row.integrationId),
              eq(jobRuns.kind, FLOOR_RUN_KIND),
              sql`${jobRuns.details}->>'venue_id' = ${row.venueId}`,
            ),
          )
          .orderBy(desc(jobRuns.createdAt))
          .limit(1)
        result.push({
          integrationId: row.integrationId,
          venueId: row.venueId,
          lastReadAt: last?.at ?? null,
        })
      }
      return result
    })
    for (const row of rows) targets.push({ tenantId: organisation.id, ...row })
  }
  return targets
}

/** The floor jobs: the read, and the tick that queues it. */
export function createFloorJobs(deps: FloorJobDeps): JobDefinition[] {
  const floorRead = defineJob<VenueSyncJob>({
    name: JOB_NAMES.floorRead,
    options: {
      policy: 'exclusive',
      queue: {
        retryLimit: 1,
        retryDelay: 60,
        expireInSeconds: 2 * 60,
        retentionSeconds: 30 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 2 },
    },
    async handler(jobs: Job<VenueSyncJob>[], context: WorkerContext) {
      for (const job of jobs) {
        const parsed = VenueSyncJobSchema.safeParse(job.data)
        if (!parsed.success)
          throw new Error(`the ${JOB_NAMES.floorRead} job has an invalid payload`)
        const outcome = await readFloorOf(
          { pool: context.pool, log: context.log, now: context.now },
          parsed.data,
          deps,
        )
        context.log.info({ outcome: outcome.kind, venueId: parsed.data.venueId }, 'floor read')
      }
    },
  })

  const floorReadTick = defineJob({
    name: JOB_NAMES.floorReadTick,
    schedule: { cron: '* * * * *', tz: 'Europe/Sofia' },
    options: {
      // The next tick comes soon enough; a missed one is not retried.
      queue: {
        retryLimit: 0,
        expireInSeconds: 120,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
    },
    async handler(_jobs, context) {
      const now = context.now()
      const targets = await floorTargets(context.pool, deps.sim)
      let queued = 0
      for (const target of targets) {
        const due =
          target.lastReadAt === null ||
          now.getTime() - target.lastReadAt.getTime() >= FLOOR_READ_INTERVAL_MS
        if (!due) continue
        try {
          const job = prepareJob(JOB_NAMES.floorRead, {
            tenantId: target.tenantId,
            integrationId: target.integrationId,
            venueId: target.venueId,
          })
          const id = await context.queue.send(JOB_NAMES.floorRead, job.data, {
            singletonKey: job.singletonKey,
          })
          if (id !== null) queued += 1
        } catch (error) {
          context.log.warn({ err: error }, 'a floor read could not be queued')
        }
      }
      context.log[queued > 0 ? 'info' : 'debug']({ targets: targets.length, queued }, 'floor tick')
    },
  })

  return [floorRead, floorReadTick] as JobDefinition[]
}
