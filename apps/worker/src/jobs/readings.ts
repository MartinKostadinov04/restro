// The table reading jobs (#74; D111, D122 §4, §6; spec #64 Implementation Decisions 1 and 7).
//
//   table-read       read one table's POS bills through its instance's service connector and
//                    record the reading through `applyService` (`reading.record`), which ends the
//                    sitting when the reading shows the bill closed
//   table-read-tick  every minute: queue a read for each table open for phones whose bill was not
//                    read within the interval
//
// What the job keeps to:
// - One reading is shared by every phone at the table (D111: eight phones each asking the POS
//   would be about 50 calls a minute). The queue holds one read per table (`exclusive`, keyed by
//   the table); a table is read at most once every `TABLE_READ_MIN_GAP_MS`, so "a few times a
//   minute at most"; and a read starts only while the login's per-second budget has room for it
//   beside a round or a payment (`InstanceBudgets`, the one budget every POS call goes through). A
//   read the budget can't take now is skipped: the next tick or the next guest reads it.
// - A reading that is not complete, or a read that throws, is recorded as not complete: it
//   concludes nothing (rule 6), and the phones are told the bill shown is the last good one. A
//   definite busy is not that: it is the same as a read the budget skipped, so nothing is recorded,
//   nothing pauses the table and the connection's breaker hears nothing.
// - Only a table with an open sitting is read: the bill is the sitting's.
// - A `sim` instance is refused in production before its host is asked. The web app never calls
//   a POS; this job is the only reader of a table's bills.

import { randomUUID } from 'node:crypto'

import {
  JOB_NAMES,
  posRef,
  prepareJob,
  type Reading,
  readingSchema,
  type ServiceReader,
  type TableBills,
  TableBillsSchema,
  type TableReadJob,
  TableReadJobSchema,
} from '@restro/core'
import { applyService, type TableReading } from '@restro/core/service'
import {
  authOrganization,
  billReadings,
  type DbPool,
  integrations,
  places,
  sittings,
  venues,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import type { Job } from 'pg-boss'

import type { SimPolicy } from '../config'
import type { Logger } from '../logger'
import {
  assertSimAllowed,
  ServiceConnectorRefused,
  serviceConnectorFor,
  serviceContext,
} from '../service-connectors'
import { type ConnectionBreakers, SHARED_BREAKERS } from './breaker'
import { connectionPaused, type InstanceBudgets, SHARED_BUDGETS } from './floor'
import { defineJob, type JobDefinition, type WorkerContext } from './types'

/** The connector kinds whose tables this worker reads. */
const READING_KINDS = ['sim'] as const

/** The tick reads an open table's bill again when its last good reading is this old. */
export const TABLE_READ_INTERVAL_MS = 60_000

/** A table's bill is read at most once in this long, whoever asks (D111: a few times a minute). */
export const TABLE_READ_MIN_GAP_MS = 15_000

/**
 * The time of each table's last read, in this process. The instance's limit is the login's
 * per-second budget (`InstanceBudgets`), asked through `hasRoom`.
 */
export class ReadingBudgets {
  readonly #lastRead = new Map<string, number>()

  /**
   * Takes one read of `tableId` at `now`, or says why not: the table was read within the gap, or
   * the login's budget has no room for a read just now.
   */
  take(tableId: string, now: Date, hasRoom: () => boolean): 'ok' | 'too_soon' | 'over_budget' {
    const at = now.getTime()
    const last = this.#lastRead.get(tableId)
    if (last !== undefined && at - last < TABLE_READ_MIN_GAP_MS) return 'too_soon'
    if (!hasRoom()) return 'over_budget'
    this.#lastRead.set(tableId, at)
    return 'ok'
  }
}

const SHARED_READING_BUDGETS = new ReadingBudgets()

export interface ReadingEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
}

export interface ReadingJobDeps {
  readonly sim: SimPolicy
  /** The key of a reading's bill and line ids (`BILL_ID_KEY`). */
  readonly billIdKey: string
  readonly budgets?: InstanceBudgets
  /** The connection breakers (#79): every read is a call on the connection. */
  readonly breakers?: ConnectionBreakers
  readonly readingBudgets?: ReadingBudgets
  /** Builds the connector of an instance; tests pass their own. */
  readonly connectorFor?: typeof serviceConnectorFor
}

/** What one table read did. */
export type ReadingOutcome =
  /** Not read: no open sitting, no POS table, a paused connection, or the budget said no. */
  | { readonly kind: 'skipped'; readonly reason: string }
  /** Refused before the POS was asked (a `sim` instance in production, a host that is not allowed). */
  | { readonly kind: 'refused'; readonly code: string; readonly reason: string }
  /** Read and recorded. `complete` false: the reading concluded nothing (rule 6). */
  | {
      readonly kind: 'recorded'
      readonly complete: boolean
      readonly ended: boolean
      readonly reason: string | null
    }
  /** The reading could not be recorded (the service path refused it). */
  | { readonly kind: 'failed'; readonly reason: string }

/** Reads one table's POS bills and records the reading. Never throws for what a POS causes. */
export async function readTableOf(
  env: ReadingEnvironment,
  payload: TableReadJob,
  deps: ReadingJobDeps,
): Promise<ReadingOutcome> {
  const { pool, log, now } = env
  const { tenantId, venueId, tableId } = payload

  const found = await withTenant(pool, tenantId, async (tx) => {
    const [place] = await tx
      .select({ integrationId: places.integrationId, placeId: places.placeId })
      .from(places)
      .where(and(eq(places.tableId, tableId), ne(places.state, 'deleted')))
    const [sitting] = await tx
      .select({ id: sittings.id })
      .from(sittings)
      .where(
        and(eq(sittings.tableId, tableId), eq(sittings.venueId, venueId), isNull(sittings.endedAt)),
      )
    if (place === undefined) return { place: null, integration: null, open: sitting !== undefined }
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.id, place.integrationId))
    return { place, integration: integration ?? null, open: sitting !== undefined }
  })
  if (!found.open) return { kind: 'skipped', reason: 'the table is not open for phones' }
  if (found.place === null) return { kind: 'skipped', reason: 'the table has no POS table' }
  const integration = found.integration
  if (integration === null || integration.removedAt !== null) {
    return { kind: 'skipped', reason: 'this tenant has no such instance' }
  }
  const integrationId = integration.id

  let connector: ServiceReader
  try {
    if (integration.kind === 'sim') assertSimAllowed(deps.sim)
    connector = (deps.connectorFor ?? serviceConnectorFor)(integration, deps.sim)
  } catch (error) {
    if (error instanceof ServiceConnectorRefused) {
      log.warn({ integrationId, code: error.code }, 'the table read was refused')
      return { kind: 'refused', code: error.code, reason: error.message }
    }
    throw error
  }

  // A paused connection is probed by its breaker (D120), not by reads.
  if (await connectionPaused(pool, tenantId, integrationId)) {
    return { kind: 'skipped', reason: 'the connection is paused' }
  }
  const budgets = deps.budgets ?? SHARED_BUDGETS
  const taken = (deps.readingBudgets ?? SHARED_READING_BUDGETS).take(tableId, now(), () =>
    budgets.hasRoomForRead(integrationId, connector),
  )
  if (taken === 'too_soon') return { kind: 'skipped', reason: 'the table was read moments ago' }
  if (taken === 'over_budget') {
    return { kind: 'skipped', reason: "the instance's reading budget is spent" }
  }

  const budget = budgets.forInstance(integrationId)
  const context = serviceContext(now, budgets.paceOf(integrationId, connector))
  const table = posRef(found.place.placeId)
  let reading: TableReading
  try {
    const answer = await budget.run(() => connector.readTable(context, table))
    const parsed = readingSchema(TableBillsSchema).safeParse(answer)
    if (parsed.success && !parsed.data.complete && parsed.data.busy === true) {
      return { kind: 'skipped', reason: 'the POS was busy' }
    }
    reading = parsed.success
      ? toTableReading(parsed.data)
      : { complete: false, reason: 'the reading did not have the expected shape' }
  } catch (error) {
    log.warn({ integrationId, tableId, err: error }, 'the table could not be read')
    reading = { complete: false, reason: 'the table could not be read' }
  }
  await (deps.breakers ?? SHARED_BREAKERS).record(
    env,
    { tenantId, integrationId },
    { kind: 'call', ok: reading.complete },
  )

  const { result } = await applyService(
    pool,
    { type: 'reading.record', tableId, reading },
    {
      tenantId,
      venueId,
      origin: 'worker',
      actor: { kind: 'integration', integrationId },
      jobId: `table-read-${randomUUID()}`,
    },
    { billIdKey: deps.billIdKey },
  )
  if (result.status === 'refused') {
    log.warn({ code: result.code, tableId }, 'a reading was refused')
    return { kind: 'failed', reason: `refused: ${result.code}` }
  }
  if (result.details.recorded !== true) {
    return { kind: 'skipped', reason: 'the table is not open for phones' }
  }
  return {
    kind: 'recorded',
    complete: reading.complete,
    ended: result.details.ended === true,
    reason: reading.complete ? null : reading.reason,
  }
}

/**
 * The connector's reading as `reading.record` takes it: the POS references as plain text (the
 * service path never imports the connector side). The table's own reference is not kept.
 */
export function toTableReading(reading: Reading<TableBills>): TableReading {
  if (!reading.complete) return reading
  return {
    complete: true,
    currency: reading.value.currency,
    bills: reading.value.bills.map((bill) => ({
      pos: bill.ref.pos,
      totalMinor: bill.totalMinor,
      paidMinor: bill.paidMinor,
      openedAt: bill.openedAt,
      openedByRestro: bill.openedByRestro,
      paymentInFlight: bill.paymentInFlight,
      lines: bill.lines.map((line) => ({
        pos: line.ref.pos,
        itemPos: line.item?.pos ?? null,
        posName: line.name,
        quantity: line.quantity,
        amountMinor: line.amountMinor,
        enteredBy: line.enteredBy,
        enteredAt: line.enteredAt,
        restroRef: line.restroRef,
      })),
    })),
  }
}

/** One table the tick may read: open for phones, on an instance whose tables this worker reads. */
export interface ReadingTarget {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
  /** When its bill was last read completely; null when never in this sitting. */
  readonly readAt: Date | null
}

/** The tables open for phones of the instances whose tables this worker reads. */
export async function readingTargets(pool: DbPool, sim: SimPolicy): Promise<ReadingTarget[]> {
  // `sim` is never scheduled in production (the job would refuse it anyway).
  const kinds = READING_KINDS.filter((kind) => kind !== 'sim' || sim.env !== 'production')
  if (kinds.length === 0) return []
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const targets: ReadingTarget[] = []
  for (const organisation of organisations) {
    const rows = await withTenant(pool, organisation.id, (tx) =>
      tx
        .select({
          venueId: sittings.venueId,
          tableId: sittings.tableId,
          openedAt: sittings.openedAt,
          readAt: billReadings.readAt,
          complete: billReadings.complete,
        })
        .from(sittings)
        .innerJoin(places, eq(places.tableId, sittings.tableId))
        .innerJoin(integrations, eq(integrations.id, places.integrationId))
        .innerJoin(venues, eq(venues.id, sittings.venueId))
        .leftJoin(billReadings, eq(billReadings.tableId, sittings.tableId))
        .where(
          and(
            isNull(sittings.endedAt),
            isNotNull(places.tableId),
            ne(places.state, 'deleted'),
            inArray(integrations.kind, [...kinds]),
            isNull(integrations.removedAt),
            isNull(venues.archivedAt),
          ),
        ),
    )
    for (const row of rows) {
      // A reading from before the sitting opened is the last group's: this sitting has none.
      const readAt = row.readAt !== null && row.readAt >= row.openedAt ? row.readAt : null
      targets.push({
        tenantId: organisation.id,
        venueId: row.venueId,
        tableId: row.tableId,
        readAt,
      })
    }
  }
  return targets
}

/** The table reading jobs: the read, and the tick that queues it. */
export function createReadingJobs(deps: ReadingJobDeps): JobDefinition[] {
  const tableRead = defineJob<TableReadJob>({
    name: JOB_NAMES.tableRead,
    options: {
      policy: 'exclusive',
      queue: {
        // A missed read is not retried: the next tick or guest reads the table again.
        retryLimit: 0,
        expireInSeconds: 60,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
      work: { pollingIntervalSeconds: 1 },
    },
    async handler(jobs: Job<TableReadJob>[], context: WorkerContext) {
      for (const job of jobs) {
        const parsed = TableReadJobSchema.safeParse(job.data)
        if (!parsed.success)
          throw new Error(`the ${JOB_NAMES.tableRead} job has an invalid payload`)
        const outcome = await readTableOf(
          { pool: context.pool, log: context.log, now: context.now },
          parsed.data,
          deps,
        )
        context.log.debug({ outcome: outcome.kind, tableId: parsed.data.tableId }, 'table read')
      }
    },
  })

  const tableReadTick = defineJob({
    name: JOB_NAMES.tableReadTick,
    schedule: { cron: '* * * * *', tz: 'Europe/Sofia' },
    options: {
      queue: {
        retryLimit: 0,
        expireInSeconds: 120,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
    },
    async handler(_jobs, context) {
      const now = context.now()
      const targets = await readingTargets(context.pool, deps.sim)
      let queued = 0
      for (const target of targets) {
        const due =
          target.readAt === null ||
          now.getTime() - target.readAt.getTime() >= TABLE_READ_INTERVAL_MS
        if (!due) continue
        try {
          const job = prepareJob(JOB_NAMES.tableRead, {
            tenantId: target.tenantId,
            venueId: target.venueId,
            tableId: target.tableId,
          })
          const id = await context.queue.send(JOB_NAMES.tableRead, job.data, {
            singletonKey: job.singletonKey,
          })
          if (id !== null) queued += 1
        } catch (error) {
          context.log.warn({ err: error }, 'a table read could not be queued')
        }
      }
      context.log[queued > 0 ? 'info' : 'debug']({ targets: targets.length, queued }, 'table tick')
    },
  })

  return [tableRead, tableReadTick] as JobDefinition[]
}
