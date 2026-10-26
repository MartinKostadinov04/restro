// Stock from the POS (#80; D122 §4 Stock, D124 §6). Stock lives in the POS: what the POS says ran
// out is marked sold out in the POS layer (core's `recordPosStock`, through apply()), Tonight gets
// the notice "Out of stock in {source}: Mojito. Greyed out on the menu." (`notice.record`), and
// every phone sees the item greyed at its next poll of `live.json` (`publish-live`, queued here).
//
// Two passes find it, both in `order-send`: the availability read right before a Send, where the
// connector declares `itemAvailability`, and otherwise the POS's refusal that names the line. The
// `stock-tick` here takes the marks off again: every few minutes it reads the marked items where
// the connector declares the read (a complete reading that says one is back clears its mark), and
// it lapses the marks of an earlier service day (a POS that can't be asked would keep them for
// good otherwise; the next night starts from what the POS itself says).

import { randomUUID } from 'node:crypto'

import {
  type Availability,
  AvailabilitySchema,
  JOB_NAMES,
  type PosRef,
  posRef,
  prepareJob,
  type Reading,
  readingSchema,
  SERVICE_TIMINGS,
  type ServiceConnector,
  type ServiceTimings,
  type StockReading,
} from '@restro/core'
import {
  lapseStockMarks,
  listStockMarks,
  liveScopesOfVenue,
  recordPosStock,
  type StockMark,
  type StockResult,
} from '@restro/core/apply'
import { applyService, OUT_OF_STOCK_ALERT } from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  integrations,
  sourceLinks,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, inArray } from 'drizzle-orm'

import type { SimPolicy } from '../config'
import type { Logger } from '../logger'
import {
  assertSimAllowed,
  ServiceConnectorRefused,
  serviceConnectorFor,
  serviceContext,
} from '../service-connectors'
import type { Limiter } from '../sync/limiter'
import { bounded } from './bounded'
import { type InstanceBudgets, SHARED_BUDGETS } from './floor'
import { defineJob, type JobDefinition, type JobQueue } from './types'

/** How often the tick asks the POS about marked items, and lapses an earlier day's marks. */
export const STOCK_TICK_CRON = '*/5 * * * *'

/** Where a stock pass runs: the venue, its POS instance, and the queue for `publish-live`. */
export interface StockEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
  /** Queues `publish-live`; left out, the live overlay catches up with its own tick. */
  readonly queue?: JobQueue
}

/** What the tick needs to reach a POS instance (a part of the send jobs' dependencies). */
export interface StockJobDeps {
  readonly sim: SimPolicy
  readonly budgets?: InstanceBudgets
  /** Builds the connector of an instance; tests pass their own. */
  readonly connectorFor?: typeof serviceConnectorFor
  /** The seam's timings; tests shorten them. */
  readonly timings?: ServiceTimings
}

/** One item a pass found, with the POS's name for Tonight's notice. */
export interface StockFinding {
  readonly itemId: string
  readonly name: string
  readonly available: boolean
}

/**
 * Records what a complete reading said of these items: the marks through apply(), the notice for
 * Tonight, and `publish-live` for the venue's menus when anything changed. A failure is logged and
 * swallowed: the caller (a Send) settles as it would without it.
 */
export async function noteStock(
  env: StockEnvironment,
  target: { readonly tenantId: string; readonly venueId: string; readonly integrationId: string },
  pass: 'availability' | 'refusal',
  findings: readonly StockFinding[],
): Promise<StockResult> {
  if (findings.length === 0) return { marked: [], cleared: [] }
  const reading: StockReading = {
    complete: true,
    items: findings.map((found) => ({ itemId: found.itemId, available: found.available })),
  }
  try {
    const result = await recordPosStock(env.pool, target.tenantId, {
      integrationId: target.integrationId,
      venueId: target.venueId,
      pass,
      reading,
    })
    const names = new Map(findings.map((found) => [found.itemId, found.name]))
    await announce(env, target, {
      out: result.marked.map((itemId) => ({ itemId, name: names.get(itemId) ?? itemId })),
      back: result.cleared,
    })
    return result
  } catch (error) {
    env.log.warn({ venueId: target.venueId, err: error }, 'stock could not be recorded')
    return { marked: [], cleared: [] }
  }
}

/** Tonight's notice and the live overlay, for what a pass changed. */
async function announce(
  env: StockEnvironment,
  target: { readonly tenantId: string; readonly venueId: string; readonly integrationId: string },
  change: {
    readonly out: readonly { itemId: string; name: string }[]
    readonly back: readonly string[]
  },
): Promise<void> {
  if (change.out.length + change.back.length === 0) return
  const { result } = await applyService(
    env.pool,
    {
      type: 'notice.record',
      notice: OUT_OF_STOCK_ALERT,
      integrationId: target.integrationId,
      out: change.out,
      back: change.back,
    },
    {
      tenantId: target.tenantId,
      venueId: target.venueId,
      origin: 'worker',
      actor: { kind: 'integration', integrationId: target.integrationId },
      jobId: `stock-${randomUUID()}`,
    },
  )
  if (result.status !== 'accepted') {
    env.log.warn({ venueId: target.venueId, status: result.status }, 'the stock notice was refused')
  }
  if (env.queue === undefined) return
  for (const scope of await liveScopesOfVenue(env.pool, target.tenantId, target.venueId)) {
    const job = prepareJob(JOB_NAMES.publishLive, { tenantId: target.tenantId, ...scope })
    await env.queue.send(JOB_NAMES.publishLive, job.data, { singletonKey: job.singletonKey })
  }
}

/**
 * Reads the availability of these POS items, bounded by the instance's budget. Incomplete when
 * the connector declares no read, the POS was busy or slow, or the answer had the wrong shape.
 */
export async function readAvailability(
  connector: ServiceConnector,
  budget: Limiter,
  now: () => Date,
  timings: ServiceTimings,
  items: readonly PosRef[],
): Promise<Reading<Availability>> {
  const read = connector.readAvailability
  if (!connector.capabilities.itemAvailability || read === undefined || items.length === 0) {
    return { complete: false, reason: 'no availability read' }
  }
  try {
    const answer = await bounded(budget, timings.readTimeoutMs, () =>
      read.call(connector, serviceContext(now, timings), [...items]),
    )
    if (answer.kind !== 'answered') return { complete: false, reason: 'the read did not answer' }
    const parsed = readingSchema(AvailabilitySchema).safeParse(answer.value)
    return parsed.success
      ? parsed.data
      : { complete: false, reason: 'the reading did not have the expected shape' }
  } catch {
    return { complete: false, reason: 'the availability could not be read' }
  }
}

/** The tick's work for one tenant: lapse an earlier day's marks, ask the POS about the rest. */
async function tickTenant(
  env: StockEnvironment,
  tenantId: string,
  deps: StockJobDeps,
): Promise<{ readonly cleared: number }> {
  const marks = await listStockMarks(env.pool, tenantId)
  const groups = new Map<string, StockMark[]>()
  for (const mark of marks) {
    const key = `${mark.venueId}:${mark.integrationId}`
    groups.set(key, [...(groups.get(key) ?? []), mark])
  }
  let cleared = 0
  for (const group of groups.values()) {
    const first = group[0]
    if (first === undefined) continue
    const target = { tenantId, venueId: first.venueId, integrationId: first.integrationId }
    const itemIds = group.map((mark) => mark.itemId)
    try {
      const lapsed = await lapseStockMarks(
        env.pool,
        tenantId,
        { ...target, itemIds },
        { now: env.now() },
      )
      const left = itemIds.filter((id) => !lapsed.cleared.includes(id))
      const back = await askAgain(env, target, left, deps)
      await announce(env, target, { out: [], back: [...lapsed.cleared, ...back.cleared] })
      cleared += lapsed.cleared.length + back.cleared.length
    } catch (error) {
      env.log.warn({ venueId: target.venueId, err: error }, 'stock marks could not be checked')
    }
  }
  return { cleared }
}

/** Reads the marked items again where the connector can: what a complete reading says is back. */
async function askAgain(
  env: StockEnvironment,
  target: { readonly tenantId: string; readonly venueId: string; readonly integrationId: string },
  itemIds: readonly string[],
  deps: StockJobDeps,
): Promise<StockResult> {
  if (itemIds.length === 0) return { marked: [], cleared: [] }
  const found = await withTenant(env.pool, target.tenantId, async (tx) => {
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.id, target.integrationId))
    const links = await tx
      .select({ nodeId: sourceLinks.nodeId, externalId: sourceLinks.externalId })
      .from(sourceLinks)
      .where(
        and(
          eq(sourceLinks.integrationId, target.integrationId),
          inArray(sourceLinks.nodeId, [...itemIds]),
          eq(sourceLinks.state, 'active'),
        ),
      )
    return { integration, links }
  })
  const { integration, links } = found
  if (integration === undefined || integration.removedAt !== null || links.length === 0) {
    return { marked: [], cleared: [] }
  }
  let connector: ServiceConnector
  try {
    if (integration.kind === 'sim') assertSimAllowed(deps.sim)
    connector = (deps.connectorFor ?? serviceConnectorFor)(integration, deps.sim)
  } catch (error) {
    if (error instanceof ServiceConnectorRefused) return { marked: [], cleared: [] }
    throw error
  }
  if (!connector.capabilities.itemAvailability) return { marked: [], cleared: [] }
  const byPos = new Map(links.map((link) => [link.externalId, link.nodeId]))
  const reading = await readAvailability(
    connector,
    (deps.budgets ?? SHARED_BUDGETS).forInstance(target.integrationId),
    env.now,
    deps.timings ?? SERVICE_TIMINGS,
    links.map((link) => posRef(link.externalId)),
  )
  if (!reading.complete) return { marked: [], cleared: [] }
  const items = reading.value.items.flatMap((answer) => {
    const itemId = byPos.get(answer.item.pos)
    return itemId === undefined ? [] : [{ itemId, available: answer.available }]
  })
  // Only what came back is cleared here; an item still out stays marked, and a new run-out of an
  // item nobody marked is a Send's to find (the tick asks only about marks).
  return recordPosStock(
    env.pool,
    target.tenantId,
    {
      integrationId: target.integrationId,
      venueId: target.venueId,
      pass: 'availability',
      reading: { complete: true, items: items.filter((item) => item.available) },
    },
    { now: env.now() },
  )
}

/** Runs the tick over every organisation. */
export async function stockTick(
  env: StockEnvironment,
  deps: StockJobDeps,
): Promise<{ readonly cleared: number }> {
  const organisations = await withSystem(env.pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  let cleared = 0
  for (const organisation of organisations) {
    cleared += (await tickTenant(env, organisation.id, deps)).cleared
  }
  return { cleared }
}

/** The stock tick job (registered with the send jobs: stock matters only where Send runs). */
export function createStockJobs(deps: StockJobDeps): JobDefinition[] {
  const tick = defineJob({
    name: JOB_NAMES.stockTick,
    schedule: { cron: STOCK_TICK_CRON, tz: 'Europe/Sofia' },
    options: {
      queue: {
        retryLimit: 0,
        expireInSeconds: 4 * 60,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
    },
    async handler(_jobs, context) {
      const { cleared } = await stockTick(
        { pool: context.pool, log: context.log, now: context.now, queue: context.queue },
        deps,
      )
      context.log[cleared > 0 ? 'info' : 'debug']({ cleared }, 'stock tick')
    },
  })
  return [tick] as JobDefinition[]
}
