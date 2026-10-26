// Send to the POS (#77; D115, D116, D120, D122 §4).
//
//   order-send        send a table's waiting sent orders to its POS, one at a time
//   order-slot-sweep  every minute: settle a sent order whose worker died (its slot lease passed
//                     its deadline) and queue `order-send` for a table with a waiting sent order
//                     and no slot holder
//
// One sent order goes like this, each state written through `applyService` before the next POS
// call, so a crash anywhere leaves a state the sweep can settle:
// 1. `sent_order.start` takes the table's slot (one sent order in flight per table) for the
//    oldest waiting one;
// 2. the table is read (three tries): the bill before the round, for the alert and the read-back.
//    No complete read → Not sent (`pos_unreachable`), the lines back on the order;
// 3. `sending` is written, then the round is added once, with the sent order's id as the
//    reference where the POS keeps one (`ownLineReference`) or deduplicates (`idempotentAdd`);
// 4. done → Added (Awaiting approval where the POS declares `approvalAtBar`); a definite "no" →
//    Not sent with the POS's code (a closed bill is tried once more: nothing was written);
//    unknown → `checking`, and the table is read back for about a minute (`readBackWindowMs`):
//    the round found → Added; anything Restro can't tell from staff's (a waiter's identical
//    round) → Unconfirmed; nothing within the window → Unconfirmed. Never sent again (D115).
// Every POS call is bounded here (its turn at the instance's budget, then its timeout) and the
// read-back ends on a clock deadline, so a run settles within its slot lease (`send-timings.ts`
// in core derives each lease from the same timings): the sweep never settles a sent order this
// worker is still reading back.
// A note goes to the POS only where it reaches the ticket (`notesReachTicket`).
// The connection's breaker (#79, ./breaker.ts) hears every call: a read or an add that answered
// is a good call, one that failed or came late a failed call, an add that timed out a write
// timeout, a refusal of the login or the venue pauses at once, an Unconfirmed order counts toward
// the pause. A paused connection sends nothing: the sent order is Not sent (`ordering_paused`),
// also when the pause lands between the start and `sending`. After a write timed out the next
// order waits for a good probe, run here before the read.

import { randomUUID } from 'node:crypto'

import {
  checkLanded,
  JOB_NAMES,
  type OrderLine,
  type OrderSendJob,
  OrderSendJobSchema,
  posRef,
  prepareJob,
  type Reading,
  readingSchema,
  SERVICE_TIMINGS,
  type ServiceConnector,
  type ServiceTimings,
  serviceDayStartsAt,
  type TableBills,
  TableBillsSchema,
} from '@restro/core'
import {
  applyService,
  BEFORE_READ_PAUSE_MS,
  BEFORE_READ_TRIES,
  type BreakerEvent,
  READ_BACK_EVERY_MS,
  type SentOrderLine,
  sentOrderLinesOf,
} from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  integrations,
  locks,
  places,
  sentOrderNotes,
  sentOrders,
  sourceLinks,
  venues,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'
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
import { bounded, probeConnection } from './connection'
import { connectionPaused, type InstanceBudgets, SHARED_BUDGETS } from './floor'
import { defineJob, type JobDefinition, type JobQueue, type WorkerContext } from './types'

/** The most sent orders one run sends: the rest wait for the next run (the sweep queues it). */
export const SENDS_PER_RUN = 20

export interface SendEnvironment {
  readonly pool: DbPool
  readonly log: Logger
  readonly now: () => Date
  /** Queues the breaker's next probe. */
  readonly queue?: JobQueue | undefined
}

export interface SendJobDeps {
  readonly sim: SimPolicy
  readonly budgets?: InstanceBudgets
  /** The connection breakers; tests pass their own. */
  readonly breakers?: ConnectionBreakers
  /** Builds the connector of an instance; tests pass their own. */
  readonly connectorFor?: typeof serviceConnectorFor
  /** The seam's timings; tests shorten them. */
  readonly timings?: ServiceTimings
  /** How often a `checking` round is read back. */
  readonly readBackEveryMs?: number
  /** Waits between read-backs and tries; tests pass a fake. */
  readonly sleep?: (ms: number) => Promise<void>
  /** The clock the read-back window runs on, in milliseconds; tests pass the fake sleep's. */
  readonly clock?: () => number
}

/** How one sent order ended in this run. */
export type SendOutcome =
  | {
      readonly kind: 'settled'
      readonly sentOrderId: string
      readonly state: string
      readonly reason: string | null
    }
  /** The slot was lost to the sweep (this worker was too slow): the sweep settled it. */
  | { readonly kind: 'lost'; readonly sentOrderId: string }

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The refusal scopes that are the connection's, not the round's: they pause at once. */
const LOGIN_SCOPES: ReadonlySet<string> = new Set(['login', 'venue'])

/** What the worker knows of one sent order before it calls the POS. */
interface Prepared {
  readonly integrationId: string
  readonly connector: ServiceConnector
  readonly table: ReturnType<typeof posRef>
  readonly lines: readonly OrderLine[]
  readonly serviceDayStartsAt: Date
}

/** Sends the table's waiting sent orders, oldest first, until none waits or the slot is busy. */
export async function sendTableOrders(
  env: SendEnvironment,
  payload: OrderSendJob,
  deps: SendJobDeps,
): Promise<SendOutcome[]> {
  const outcomes: SendOutcome[] = []
  for (let run = 0; run < SENDS_PER_RUN; run++) {
    const started = await step(env, payload, { type: 'sent_order.start', tableId: payload.tableId })
    if (started === null) break
    const state = started.state
    if (state === 'settled') continue
    if (state !== 'taken') break
    const sentOrderId = String(started.sentOrderId)
    const fence = Number(started.fence)
    outcomes.push(await sendOne(env, payload, { sentOrderId, fence }, deps))
  }
  return outcomes
}

/** Runs one worker step; null when it was refused (logged). */
async function step(
  env: SendEnvironment,
  payload: { readonly tenantId: string; readonly venueId: string },
  command: Readonly<Record<string, unknown>>,
  integrationId: string | null = null,
): Promise<Readonly<Record<string, unknown>> | null> {
  const { result } = await applyService(env.pool, command, {
    tenantId: payload.tenantId,
    venueId: payload.venueId,
    origin: 'worker',
    actor: integrationId === null ? { kind: 'system' } : { kind: 'integration', integrationId },
    jobId: `order-send-${randomUUID()}`,
  })
  if (result.status === 'refused') {
    env.log.warn({ code: result.code, type: command.type }, 'a sent order step was refused')
    return null
  }
  return result.details
}

/** Sends one sent order the start handed this run. */
async function sendOne(
  env: SendEnvironment,
  payload: OrderSendJob,
  claim: { readonly sentOrderId: string; readonly fence: number },
  deps: SendJobDeps,
): Promise<SendOutcome> {
  const { sentOrderId, fence } = claim
  let integrationId: string | null = null
  const move = async (
    to: string,
    extra: {
      readonly reason?: string
      readonly billBeforeMinor?: number
      readonly posBillRef?: string
      readonly matchedLines?: readonly string[]
    } = {},
  ): Promise<Readonly<Record<string, unknown>> | null> =>
    step(
      env,
      payload,
      { type: 'sent_order.transition', sentOrderId, fence, to, ...extra },
      integrationId,
    )
  const settle = async (to: string, reason: string | null, extra = {}): Promise<SendOutcome> =>
    (await move(to, { ...(reason === null ? {} : { reason }), ...extra })) !== null
      ? { kind: 'settled', sentOrderId, state: to, reason }
      : { kind: 'lost', sentOrderId }

  const prepared = await prepare(env, payload, sentOrderId, deps)
  if (!('connector' in prepared)) return settle('not_sent', prepared.reason)
  integrationId = prepared.integrationId
  const paused = () => connectionPaused(env.pool, payload.tenantId, prepared.integrationId)
  if (await paused()) return settle('not_sent', 'ordering_paused')

  const timings = deps.timings ?? SERVICE_TIMINGS
  const sleep = deps.sleep ?? sleepFor
  const budget = (deps.budgets ?? SHARED_BUDGETS).forInstance(prepared.integrationId)
  const breakers = deps.breakers ?? SHARED_BREAKERS
  const connection = { tenantId: payload.tenantId, integrationId: prepared.integrationId }
  const record = (event: BreakerEvent) => breakers.record(env, connection, event)
  const clock = deps.clock ?? (() => env.now().getTime())
  const context = serviceContext(env.now, timings)

  // A write timed out on this connection: a good probe first.
  if ((await breakers.gate(env, connection)) === 'hold') {
    const probed = await probeConnection(env, connection, prepared.connector, {
      budgets: deps.budgets,
      breakers,
      clock,
    })
    if (probed !== 'good') {
      return settle('not_sent', (await paused()) ? 'ordering_paused' : 'pos_unreachable')
    }
  }

  const readTable = async (): Promise<Reading<TableBills>> => {
    try {
      const started = clock()
      const answer = await bounded(budget, timings.readTimeoutMs, () =>
        prepared.connector.readTable(context, prepared.table),
      )
      if (answer.kind !== 'answered') {
        // No turn: the read never left, so the connection is not to blame.
        if (answer.kind === 'late') await record({ kind: 'call', ok: false })
        return {
          complete: false,
          reason: answer.kind === 'late' ? 'the read timed out' : 'the POS was busy',
        }
      }
      const parsed = readingSchema(TableBillsSchema).safeParse(answer.value)
      const complete = parsed.success && parsed.data.complete
      await record({ kind: 'call', ok: complete, elapsedMs: clock() - started })
      return parsed.success
        ? parsed.data
        : { complete: false, reason: 'the reading did not have the expected shape' }
    } catch (error) {
      env.log.warn({ tableId: payload.tableId, err: error }, 'the table could not be read')
      await record({ kind: 'call', ok: false })
      return { complete: false, reason: 'the table could not be read' }
    }
  }

  let before: Reading<TableBills> = { complete: false, reason: 'not read yet' }
  for (let attempt = 0; attempt < BEFORE_READ_TRIES && !before.complete; attempt++) {
    if (attempt > 0) await sleep(BEFORE_READ_PAUSE_MS)
    before = await readTable()
  }
  if (!before.complete) return settle('not_sent', 'pos_unreachable')
  const billBeforeMinor = before.value.bills.reduce((sum, bill) => sum + bill.totalMinor, 0)
  const sending = await move('sending', { billBeforeMinor })
  if (sending === null) return { kind: 'lost', sentOrderId }
  // A pause landed since the start: the step settled it Not sent and freed the slot.
  if (sending.state === 'not_sent') {
    return { kind: 'settled', sentOrderId, state: 'not_sent', reason: 'ordering_paused' }
  }

  const request = {
    table: prepared.table,
    lines: [...prepared.lines],
    ref: sentOrderId,
    serviceDayStartsAt: prepared.serviceDayStartsAt.toISOString(),
    excludeBills: [],
  }
  const capabilities = prepared.connector.capabilities
  const add = async () => {
    try {
      const answer = await bounded(budget, timings.writeTimeoutMs, () =>
        prepared.connector.addLines(context, request),
      )
      if (answer.kind === 'answered') return answer.value
      // No turn: the round never left. Late: it may still land, so it is read back.
      return answer.kind === 'no_turn'
        ? ({ kind: 'no_turn' } as const)
        : ({ kind: 'unknown', reason: 'the add timed out' } as const)
    } catch (error) {
      // A throw after the request left may mean it landed: treated as unknown, never resent.
      env.log.warn({ sentOrderId, err: error }, 'the round could not be added')
      return { kind: 'unknown', reason: 'the add threw' } as const
    }
  }
  let outcome = await add()
  if (outcome.kind === 'refused' && outcome.refusal.code === 'bill_closed') {
    // The bill closed between the read and the add; nothing was written, so one more try.
    outcome = await add()
  }
  if (outcome.kind === 'no_turn') return settle('not_sent', 'pos_unreachable')
  if (outcome.kind === 'refused' && LOGIN_SCOPES.has(outcome.refusal.scope)) {
    // The login or the venue was refused: the connection pauses at once.
    await record({ kind: 'refused', cause: outcome.refusal.code })
  } else if (outcome.kind === 'unknown') {
    await record({ kind: 'write_timeout' })
  } else {
    await record({ kind: 'call', ok: true })
  }
  if (outcome.kind === 'done') {
    const posBillRef = outcome.result.bill === null ? {} : { posBillRef: outcome.result.bill.pos }
    return settle(capabilities.approvalAtBar ? 'awaiting_approval' : 'added', null, posBillRef)
  }
  if (outcome.kind === 'refused') return settle('not_sent', outcome.refusal.code)

  // Unknown: read back, never send again (D115).
  if (!(await move('checking'))) return { kind: 'lost', sentOrderId }
  const sent = prepared.lines.map((line) => ({ item: line.item, quantity: line.quantity }))
  const every = deps.readBackEveryMs ?? READ_BACK_EVERY_MS
  const unconfirmed = async (reason: string) => {
    const settled = await settle('unconfirmed', reason)
    if (settled.kind === 'settled') await record({ kind: 'unconfirmed', tableId: payload.tableId })
    return settled
  }
  // The window runs on the clock, reads included: no read starts after it ends, so the run
  // settles within the checking lease (the window, the last read, a margin).
  const deadline = clock() + timings.readBackWindowMs
  while (clock() + every <= deadline) {
    await sleep(every)
    const after = await readTable()
    if (!after.complete) continue
    const verdict = checkLanded({
      before: before.value,
      after: after.value,
      sent,
      ref: sentOrderId,
      capabilities,
    })
    if (verdict.kind === 'landed') {
      return settle(capabilities.approvalAtBar ? 'awaiting_approval' : 'added', null, {
        ...(verdict.bill === null ? {} : { posBillRef: verdict.bill.pos }),
        matchedLines: verdict.lines.map((line) => line.pos),
      })
    }
    if (verdict.kind === 'ambiguous') {
      env.log.info({ sentOrderId, why: verdict.reason }, 'a round could not be told apart')
      return unconfirmed('check_ambiguous')
    }
  }
  return unconfirmed('check_timed_out')
}

/**
 * What the POS call needs: the instance's connector, the POS table, the lines as POS references
 * and the start of the service day. A reason instead when the sent order can't go (no POS table,
 * an item without its POS link): Not sent, before the POS is asked.
 */
async function prepare(
  env: SendEnvironment,
  payload: OrderSendJob,
  sentOrderId: string,
  deps: SendJobDeps,
): Promise<Prepared | { readonly reason: string }> {
  const found = await withTenant(env.pool, payload.tenantId, async (tx) => {
    const [sent] = await tx
      .select({ lines: sentOrders.lines })
      .from(sentOrders)
      .where(eq(sentOrders.id, sentOrderId))
    const [place] = await tx
      .select({ integrationId: places.integrationId, placeId: places.placeId })
      .from(places)
      .where(and(eq(places.tableId, payload.tableId), ne(places.state, 'deleted')))
    const [venue] = await tx
      .select({ timezone: venues.timezone, dayEndsAt: venues.serviceDayEndsAt })
      .from(venues)
      .where(eq(venues.id, payload.venueId))
    if (sent === undefined || place === undefined || venue === undefined) return null
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.id, place.integrationId))
    const lines = sentOrderLinesOf(sent.lines)
    const nodeIds = [...new Set(lines.flatMap((line) => [line.itemId, ...line.optionIds]))]
    const links =
      nodeIds.length === 0
        ? []
        : await tx
            .select({ nodeId: sourceLinks.nodeId, externalId: sourceLinks.externalId })
            .from(sourceLinks)
            .where(
              and(
                eq(sourceLinks.integrationId, place.integrationId),
                inArray(sourceLinks.nodeId, nodeIds),
                eq(sourceLinks.state, 'active'),
              ),
            )
    const notes = await tx
      .select({ lineId: sentOrderNotes.lineId, note: sentOrderNotes.note })
      .from(sentOrderNotes)
      .where(eq(sentOrderNotes.sentOrderId, sentOrderId))
    return { lines, place, venue, integration: integration ?? null, links, notes }
  })
  if (found === null) return { reason: 'pos_table_missing' }
  const { integration } = found
  if (integration === null || integration.removedAt !== null) return { reason: 'pos_table_missing' }

  let connector: ServiceConnector
  try {
    if (integration.kind === 'sim') assertSimAllowed(deps.sim)
    connector = (deps.connectorFor ?? serviceConnectorFor)(integration, deps.sim)
  } catch (error) {
    if (error instanceof ServiceConnectorRefused) {
      env.log.warn({ integrationId: integration.id, code: error.code }, 'the send was refused')
      return { reason: 'pos_unavailable' }
    }
    throw error
  }

  const link = new Map(found.links.map((row) => [row.nodeId, row.externalId]))
  const notes = new Map(found.notes.map((row) => [row.lineId, row.note]))
  const lines: OrderLine[] = []
  for (const line of found.lines) {
    const mapped = toOrderLine(line, link, connector.capabilities.notesReachTicket, notes)
    if (mapped === null) return { reason: 'item_not_on_pos' }
    lines.push(mapped)
  }
  if (lines.length === 0) return { reason: 'item_not_on_pos' }
  return {
    integrationId: integration.id,
    connector,
    table: posRef(found.place.placeId),
    lines,
    serviceDayStartsAt: serviceDayStartsAt(env.now(), found.venue.timezone, found.venue.dayEndsAt),
  }
}

/** A sent line as the POS takes it; null when its item or an option has no POS link. */
function toOrderLine(
  line: SentOrderLine,
  link: ReadonlyMap<string, string>,
  notesReachTicket: boolean,
  notes: ReadonlyMap<string, string>,
): OrderLine | null {
  const item = link.get(line.itemId)
  if (item === undefined) return null
  const options: ReturnType<typeof posRef>[] = []
  for (const optionId of line.optionIds) {
    const option = link.get(optionId)
    if (option === undefined) return null
    options.push(posRef(option))
  }
  return {
    item: posRef(item),
    quantity: String(line.qty),
    options,
    note: notesReachTicket ? (notes.get(line.id) ?? null) : null,
  }
}

/** One table the sweep acts on. */
export interface SlotTarget {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
}

/**
 * The tables whose slot lease passed its deadline (to expire), and the tables with a waiting sent
 * order and no live slot holder (to queue), in every organisation.
 */
export async function slotTargets(
  pool: DbPool,
): Promise<{ readonly expired: SlotTarget[]; readonly waiting: SlotTarget[] }> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const expired: SlotTarget[] = []
  const waiting: SlotTarget[] = []
  for (const organisation of organisations) {
    await withTenant(pool, organisation.id, async (tx) => {
      const dead = await tx
        .select({ venueId: locks.venueId, tableId: locks.key })
        .from(locks)
        .where(
          and(
            eq(locks.scope, 'order_slot'),
            isNotNull(locks.holder),
            lt(locks.deadline, sql`now()`),
          ),
        )
      for (const row of dead) expired.push({ tenantId: organisation.id, ...row })
      const queued = await tx
        .selectDistinct({ venueId: sentOrders.venueId, tableId: sentOrders.tableId })
        .from(sentOrders)
        .leftJoin(locks, and(eq(locks.scope, 'order_slot'), eq(locks.key, sentOrders.tableId)))
        .where(and(eq(sentOrders.state, 'waiting'), or(isNull(locks.holder), isNull(locks.key))))
      for (const row of queued) waiting.push({ tenantId: organisation.id, ...row })
    })
  }
  return { expired, waiting }
}

/** The send jobs: the sender per table and the minute sweep. */
export function createSendJobs(deps: SendJobDeps): JobDefinition[] {
  const orderSend = defineJob<OrderSendJob>({
    name: JOB_NAMES.orderSend,
    options: {
      policy: 'stately',
      queue: {
        // Never retried: a step the run didn't reach is the sweep's (a waiting order is queued
        // again, an order that may have reached the POS is settled as Unconfirmed).
        retryLimit: 0,
        // The read before, the add and a minute of read-back, with a margin.
        expireInSeconds: 5 * 60,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
      work: { pollingIntervalSeconds: 1 },
    },
    async handler(jobs: Job<OrderSendJob>[], context: WorkerContext) {
      for (const job of jobs) {
        const parsed = OrderSendJobSchema.safeParse(job.data)
        if (!parsed.success)
          throw new Error(`the ${JOB_NAMES.orderSend} job has an invalid payload`)
        const outcomes = await sendTableOrders(
          { pool: context.pool, log: context.log, now: context.now, queue: context.queue },
          parsed.data,
          deps,
        )
        for (const outcome of outcomes) {
          context.log.info({ tableId: parsed.data.tableId, ...outcome }, 'sent order settled')
        }
      }
    },
  })

  const orderSlotSweep = defineJob({
    name: JOB_NAMES.orderSlotSweep,
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
      const { expired, waiting } = await slotTargets(context.pool)
      for (const target of expired) {
        try {
          await step({ pool: context.pool, log: context.log, now: context.now }, target, {
            type: 'sent_order.expire',
            tableId: target.tableId,
          })
        } catch (error) {
          context.log.warn({ tableId: target.tableId, err: error }, 'a slot could not be swept')
        }
      }
      // A table whose slot was just freed has a waiting order to queue, too.
      const tables = new Map(
        [...expired, ...waiting].map((target) => [target.tableId, target] as const),
      )
      let queued = 0
      for (const target of tables.values()) {
        try {
          const job = prepareJob(JOB_NAMES.orderSend, OrderSendJobSchema.parse(target))
          const id = await context.queue.send(JOB_NAMES.orderSend, job.data, {
            singletonKey: job.singletonKey,
          })
          if (id !== null) queued += 1
        } catch (error) {
          context.log.warn({ err: error }, 'a send could not be queued')
        }
      }
      context.log[expired.length + queued > 0 ? 'info' : 'debug'](
        { expired: expired.length, queued },
        'order slot sweep',
      )
    },
  })

  return [orderSend, orderSlotSweep] as JobDefinition[]
}
