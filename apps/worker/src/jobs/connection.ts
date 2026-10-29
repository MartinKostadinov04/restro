// The connection probe (#79; D120, D122 §6).
//
//   connection-probe  probe one POS instance with the connector's read-only probe, through the
//                     instance's budget like an order, and feed the answer to its breaker
//                     (./breaker.ts), which queues the next one
//   connection-tick   every minute: queue a probe for each paused connection, so a restarted
//                     worker probes again at the time the pause row says
//
// A probe is good only when the POS answers correctly within 3 s: live (or a POS without modes),
// not degraded, the fiscal device not out. Training mode or a fiscal device out is a refusal (the
// connection stays paused, probes back off); no answer, a late or degraded one is bad. A probe that
// gets no turn at the budget never left: it is tried again in 15 s, nothing recorded.
// The send runs the same probe inline when the breaker holds orders after a write timed out.

import {
  type ConnectionProbeJob,
  ConnectionProbeJobSchema,
  JOB_NAMES,
  type ProbeResult,
  ProbeResultSchema,
  prepareJob,
  type ServiceReader,
} from '@restro/core'
import { BREAKER, BUDGET_WAIT_MS, nextProbeAt, probeDue } from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  integrations,
  pauses,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { Job } from 'pg-boss'

import type { SimPolicy } from '../config'
import {
  assertSimAllowed,
  ServiceConnectorRefused,
  serviceConnectorFor,
  serviceContext,
} from '../service-connectors'
import type { Limiter } from '../sync/limiter'
import {
  type BreakerEnvironment,
  type ConnectionBreakers,
  type ConnectionRef,
  SHARED_BREAKERS,
} from './breaker'
import { type InstanceBudgets, SHARED_BUDGETS } from './floor'
import { defineJob, type JobDefinition, type WorkerContext } from './types'

/** How a bounded POS call ended. */
export type Bounded<T> =
  | { readonly kind: 'answered'; readonly value: T }
  /** No turn at the instance's budget within `BUDGET_WAIT_MS`: the call never left. */
  | { readonly kind: 'no_turn' }
  /** It left and outlived its timeout: it may still land. */
  | { readonly kind: 'late' }

/**
 * Runs a POS call through the instance's budget, bounded here: the connector gets the same
 * timeout in its context, but a slot lease or a probe must not rest on every connector keeping it.
 */
export async function bounded<T>(
  budget: Limiter,
  timeoutMs: number,
  call: () => Promise<T>,
): Promise<Bounded<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let gaveUp = false
  const ended = new Promise<Bounded<T>>((resolve, reject) => {
    const giveUp = (as: Bounded<T>) => () => {
      gaveUp = true
      resolve(as)
    }
    timer = setTimeout(giveUp({ kind: 'no_turn' }), BUDGET_WAIT_MS)
    budget
      .run(async () => {
        if (gaveUp) return
        clearTimeout(timer)
        timer = setTimeout(giveUp({ kind: 'late' }), timeoutMs)
        resolve({ kind: 'answered', value: await call() })
      })
      .catch(reject)
  })
  try {
    return await ended
  } finally {
    clearTimeout(timer)
  }
}

/** A probe's answer as the breaker takes it. */
export interface ProbeVerdict {
  readonly outcome: 'good' | 'bad' | 'refused'
  readonly cause: string | null
}

/** The refusal causes a probe finds in an answer (D122 §6). */
export const PROBE_CAUSES = { training: 'training_mode', fiscalDevice: 'fiscal_device' } as const

/** Judges a probe's answer and how long it took. */
export function judgeProbe(result: ProbeResult, elapsedMs: number): ProbeVerdict {
  if (result.kind === 'refused') return { outcome: 'refused', cause: result.refusal.code }
  if (result.kind === 'unknown') return { outcome: 'bad', cause: null }
  if (result.mode === 'training') return { outcome: 'refused', cause: PROBE_CAUSES.training }
  if (result.fiscalDevice === 'fault') {
    return { outcome: 'refused', cause: PROBE_CAUSES.fiscalDevice }
  }
  if (result.degraded === true || elapsedMs > BREAKER.probeBudgetMs) {
    return { outcome: 'bad', cause: null }
  }
  return { outcome: 'good', cause: null }
}

export interface ProbeDeps {
  readonly budgets?: InstanceBudgets | undefined
  readonly breakers?: ConnectionBreakers | undefined
  /** A clock in milliseconds for the probe's elapsed time; tests pass a fake. */
  readonly clock?: (() => number) | undefined
}

/**
 * Asks the connector's read-only probe once, through the instance's budget, and judges the answer;
 * `no_turn` when the probe never left. Records nothing: `probeConnection` feeds the breaker, and
 * the pre-opening check (#82) records what it needs itself.
 */
export async function probeOnce(
  env: Pick<BreakerEnvironment, 'log' | 'now'>,
  ref: ConnectionRef,
  connector: Pick<ServiceReader, 'probe'>,
  deps: ProbeDeps,
): Promise<ProbeVerdict | 'no_turn'> {
  const budget = (deps.budgets ?? SHARED_BUDGETS).forInstance(ref.integrationId)
  const clock = deps.clock ?? (() => performance.now())
  try {
    const answer = await bounded(budget, BREAKER.probeBudgetMs, async () => {
      const started = clock()
      const result = await connector.probe(serviceContext(env.now))
      return { result, elapsedMs: clock() - started }
    })
    if (answer.kind === 'no_turn') return 'no_turn'
    if (answer.kind === 'late') return { outcome: 'bad', cause: null }
    const parsed = ProbeResultSchema.safeParse(answer.value.result)
    return parsed.success
      ? judgeProbe(parsed.data, answer.value.elapsedMs)
      : { outcome: 'bad', cause: null }
  } catch (error) {
    env.log.warn({ integrationId: ref.integrationId, err: error }, 'the probe failed')
    return { outcome: 'bad', cause: null }
  }
}

/** Probes the connection once and feeds the breaker; `no_turn` when the probe never left. */
export async function probeConnection(
  env: BreakerEnvironment,
  ref: ConnectionRef,
  connector: Pick<ServiceReader, 'probe'>,
  deps: ProbeDeps,
): Promise<ProbeVerdict['outcome'] | 'no_turn'> {
  const verdict = await probeOnce(env, ref, connector, deps)
  if (verdict === 'no_turn') return 'no_turn'
  await (deps.breakers ?? SHARED_BREAKERS).record(env, ref, { kind: 'probe', ...verdict })
  return verdict.outcome
}

export interface ConnectionJobDeps extends ProbeDeps {
  readonly sim: SimPolicy
  /** Builds the connector of an instance; tests pass their own. */
  readonly connectorFor?: typeof serviceConnectorFor | undefined
}

/** What one probe run did. */
export type ProbeRun =
  /** The instance is gone or has no service connector: nothing to probe. */
  | { readonly kind: 'skipped'; readonly reason: string }
  /** No probe is due now: the next one is queued for its time (or none is wanted). */
  | { readonly kind: 'not_due'; readonly at: number | null }
  | { readonly kind: 'probed'; readonly outcome: ProbeVerdict['outcome'] | 'no_turn' }

/** Runs a `connection-probe` job: probes when the breaker says one is due. */
export async function runProbe(
  env: BreakerEnvironment,
  payload: ConnectionProbeJob,
  deps: ConnectionJobDeps,
): Promise<ProbeRun> {
  const ref = { tenantId: payload.tenantId, integrationId: payload.integrationId }
  const [integration] = await withTenant(env.pool, ref.tenantId, (tx) =>
    tx.select().from(integrations).where(eq(integrations.id, ref.integrationId)),
  )
  if (integration === undefined || integration.removedAt !== null) {
    return { kind: 'skipped', reason: 'this tenant has no such instance' }
  }
  let connector: ServiceReader
  try {
    if (integration.kind === 'sim') assertSimAllowed(deps.sim)
    connector = (deps.connectorFor ?? serviceConnectorFor)(integration, deps.sim)
  } catch (error) {
    if (error instanceof ServiceConnectorRefused) return { kind: 'skipped', reason: error.code }
    throw error
  }

  const breakers = deps.breakers ?? SHARED_BREAKERS
  const state = await breakers.state(env, ref)
  const now = env.now().getTime()
  if (!probeDue(state, now)) {
    const at = nextProbeAt(state)
    if (at !== null) await requeue(env, ref, at)
    return { kind: 'not_due', at }
  }
  const outcome = await probeConnection(env, ref, connector, deps)
  // A probe that never left is tried again soon; a probe's answer queued the next one already.
  if (outcome === 'no_turn') await requeue(env, ref, now + BREAKER.goodGapMs)
  return { kind: 'probed', outcome }
}

async function requeue(env: BreakerEnvironment, ref: ConnectionRef, at: number): Promise<void> {
  if (env.queue === undefined) return
  const job = prepareJob(JOB_NAMES.connectionProbe, ConnectionProbeJobSchema.parse(ref))
  await env.queue.send(JOB_NAMES.connectionProbe, job.data, {
    singletonKey: job.singletonKey,
    startAfter: Math.max(0, Math.ceil((at - env.now().getTime()) / 1000)),
  })
}

/** The paused connections, in every organisation, with when each is probed next. */
export async function pausedConnections(
  pool: DbPool,
): Promise<{ tenantId: string; integrationId: string; nextProbeAt: Date | null }[]> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const found: { tenantId: string; integrationId: string; nextProbeAt: Date | null }[] = []
  for (const organisation of organisations) {
    const rows = await withTenant(pool, organisation.id, (tx) =>
      tx
        .select({ integrationId: pauses.targetId, nextProbeAt: pauses.nextProbeAt })
        .from(pauses)
        .where(and(eq(pauses.scope, 'connection'), isNull(pauses.liftedAt))),
    )
    for (const row of rows) found.push({ tenantId: organisation.id, ...row })
  }
  return found
}

/** The probe and the minute tick that queues it for each paused connection. */
export function createConnectionJobs(deps: ConnectionJobDeps): JobDefinition[] {
  const connectionProbe = defineJob<ConnectionProbeJob>({
    name: JOB_NAMES.connectionProbe,
    options: {
      policy: 'stately',
      queue: {
        // Never retried: the breaker queues the next probe, and the tick covers a lost one.
        retryLimit: 0,
        expireInSeconds: 60,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
      work: { pollingIntervalSeconds: 1 },
    },
    async handler(jobs: Job<ConnectionProbeJob>[], context: WorkerContext) {
      for (const job of jobs) {
        const parsed = ConnectionProbeJobSchema.safeParse(job.data)
        if (!parsed.success) {
          throw new Error(`the ${JOB_NAMES.connectionProbe} job has an invalid payload`)
        }
        const run = await runProbe(
          { pool: context.pool, log: context.log, now: context.now, queue: context.queue },
          parsed.data,
          deps,
        )
        context.log.info({ integrationId: parsed.data.integrationId, ...run }, 'connection probe')
      }
    },
  })

  const connectionTick = defineJob({
    name: JOB_NAMES.connectionTick,
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
      const now = context.now().getTime()
      let queued = 0
      for (const paused of await pausedConnections(context.pool)) {
        try {
          const job = prepareJob(
            JOB_NAMES.connectionProbe,
            ConnectionProbeJobSchema.parse({
              tenantId: paused.tenantId,
              integrationId: paused.integrationId,
            }),
          )
          const at = paused.nextProbeAt?.getTime() ?? now
          const id = await context.queue.send(JOB_NAMES.connectionProbe, job.data, {
            singletonKey: job.singletonKey,
            startAfter: Math.max(0, Math.ceil((at - now) / 1000)),
          })
          if (id !== null) queued += 1
        } catch (error) {
          context.log.warn({ err: error }, 'a probe could not be queued')
        }
      }
      if (queued > 0) context.log.info({ queued }, 'connection probes queued')
    },
  })

  return [connectionProbe, connectionTick] as JobDefinition[]
}
