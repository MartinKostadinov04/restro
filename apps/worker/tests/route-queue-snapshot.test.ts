// #286 (designer audit DA-34): a table's next round, or a payment's next step, must start at once
// when nothing of its key is running. pg-boss fetches past the singleton keys of `singleton` and
// `stately` queues that were running at its monitor's last count (`queue.singletons_active`,
// written about once a minute, cached by each worker for `queueCacheIntervalSeconds`). On a
// `stately` route queue a job whose key ran at that count waited up to two minutes, after a restart
// and in steady state. The route's queues are `short` now (core/jobs.ts `ONE_RUN_PER_GROUP_JOBS`).
//
// Real pg-boss on Postgres, with the worker's own registry and queue options around a handler the
// test scripts. The monitor is off and the test writes its count itself, the same aggregate pg-boss
// runs (plans.js `getQueueStats`: the keys of active `singleton`/`stately` jobs; a pg-boss upgrade
// that changes it must change this copy too), so the count stays as stale as the test needs; the
// worker's cache of it is read every second instead of every minute. (pg-boss's own monitor at its
// one-second minimum would count again before a stale count could show.) No test here sleeps out a
// pg-boss interval.
import { tmpdir } from 'node:os'
import { JOB_NAMES, newId, prepareJob } from '@restro/core'
import type { DbPool } from '@restro/db'
import { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { QUEUE_SCHEMA } from '../src/connection'
import { WorkerStatus } from '../src/health'
import { createSendJobs } from '../src/jobs/order-send'
import { createPaymentJobs } from '../src/jobs/payments'
import type { JobDefinition, WorkerContext } from '../src/jobs/types'
import { createLogger } from '../src/logger'
import { registerJobs } from '../src/registry'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
  withOwnerClient,
} from './database'

allowSlowSetup()

/** How soon a job must start: a few fetches at the worker's one-second polling. */
const START_MS = 5_000
/** Longer than the worker's cache of the count here (one second), so it holds the count. */
const CACHE_MS = 2_500

type RouteQueue =
  | typeof JOB_NAMES.orderSend
  | typeof JOB_NAMES.paymentPrepare
  | typeof JOB_NAMES.paymentCheck

const QUEUES: readonly [string, RouteQueue][] = [
  ["a table's Send", JOB_NAMES.orderSend],
  ["a payment's prepare step", JOB_NAMES.paymentPrepare],
  ["a payment's check", JOB_NAMES.paymentCheck],
]

/** A payload as the producers send it: a new table or payment each time. */
function payloadOf(name: RouteQueue) {
  const venue = { tenantId: newId('tn'), venueId: newId('vn') }
  return name === JOB_NAMES.orderSend
    ? { ...venue, tableId: newId('tb') }
    : { ...venue, paymentId: newId('py') }
}

/** A promise and its release. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

async function waitFor(what: string, done: () => boolean, ms: number) {
  const until = Date.now() + ms
  while (!done() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50))
  if (!done()) throw new Error(`waited ${ms} ms for ${what}`)
}

describe.skipIf(!hasDatabase)("the route's queues and pg-boss's count of running keys", () => {
  let db: TestDatabase
  let boss: PgBoss | undefined
  let context: WorkerContext
  let jobs: JobDefinition[]
  /** What the handler does for each job of a key, in turn. */
  const scripts = new Map<string, (() => Promise<void>)[]>()
  const runs = new Map<string, number>()
  const running = new Map<string, number>()
  let beside = 0

  /** The worker's own queue options, around a handler the test scripts. */
  const scripted = (job: JobDefinition): JobDefinition => ({
    ...job,
    handler: async (batch) => {
      for (const one of batch) {
        const data = one.data as { tableId?: string; paymentId?: string }
        const key = data.tableId ?? data.paymentId ?? ''
        runs.set(key, (runs.get(key) ?? 0) + 1)
        running.set(key, (running.get(key) ?? 0) + 1)
        if ((running.get(key) ?? 0) > 1) beside += 1
        try {
          await scripts.get(key)?.shift()?.()
        } finally {
          running.set(key, (running.get(key) ?? 0) - 1)
        }
      }
    },
  })

  /** A worker's pg-boss: no monitor, and its cache of the count read every second. */
  async function startBoss(): Promise<PgBoss> {
    const started = new PgBoss({
      connectionString: db.appUrl,
      schema: QUEUE_SCHEMA,
      createSchema: false,
      migrate: true,
      supervise: false,
      schedule: false,
      queueCacheIntervalSeconds: 1,
      max: 4,
      application_name: 'restro-worker-queue-snapshot-test',
    })
    started.on('error', () => undefined)
    await started.start()
    return started
  }

  /** Starts a worker: its registry, its queues and its fetch options. */
  async function startWorker(): Promise<PgBoss> {
    const started = await startBoss()
    await registerJobs(started, jobs, context, { schedules: false })
    return started
  }

  /** pg-boss's monitor counting now: the keys of the queue's running singleton/stately jobs. */
  async function countRunningKeys(name: string): Promise<void> {
    await withOwnerClient(db.ownerUrl, (client) =>
      client.query(
        `UPDATE ${QUEUE_SCHEMA}.queue SET singletons_active = (
           SELECT array_agg(j.singleton_key) FROM ${QUEUE_SCHEMA}.job j
           WHERE j.name = $1 AND j.state = 'active' AND j.policy IN ('singleton', 'stately')
         ) WHERE name = $1`,
        [name],
      ),
    )
  }

  /** Sends a job as the producers do (`prepareJob`: its key, and its group). */
  function send(name: RouteQueue, payload: ReturnType<typeof payloadOf>) {
    const job = prepareJob(name, payload)
    return (boss as PgBoss).send(name, job.data, {
      singletonKey: job.singletonKey,
      ...(job.group === undefined ? {} : { group: job.group }),
    })
  }

  /** Sends a first job of a new key and holds its run until `release` opens. */
  async function holdFirstRun(name: RouteQueue) {
    const payload = payloadOf(name)
    const key = prepareJob(name, payload).singletonKey
    const release = gate()
    const started = gate()
    scripts.set(key, [
      async () => {
        started.open()
        await release.opened
      },
    ])
    expect(await send(name, payload)).not.toBeNull()
    await started.opened
    return { payload, key, release }
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    const log = await createLogger({
      level: 'silent',
      pretty: false,
      destination: { write: () => undefined },
    })
    context = {
      pool: {} as DbPool,
      log,
      workerId: 'queue-snapshot-test',
      version: '0.0.0',
      now: () => new Date(),
      status: new WorkerStatus(),
      queue: { send: async () => null },
    }
    const deps = { sim: { env: 'test', allowHosts: [] }, assets: { kind: 'local', dir: tmpdir() } }
    const all = [
      ...createSendJobs(deps as never),
      ...createPaymentJobs(deps as never),
    ] as JobDefinition[]
    jobs = QUEUES.map(([, name]) => scripted(all.find((job) => job.name === name) as JobDefinition))

    // A database from before #286: the three queues were created `stately`.
    const old = await startBoss()
    for (const [, name] of QUEUES) await old.createQueue(name, { policy: 'stately' })
    await old.stop({ graceful: false })
    boss = await startWorker()
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await boss?.stop({ graceful: false })
    await db?.drop()
  })

  it('the worker creates a queue it finds on its old policy again, with the new one', async () => {
    for (const [, name] of QUEUES) {
      expect((await (boss as PgBoss).getQueue(name))?.policy, name).toBe('short')
    }
  })

  it.each(QUEUES)(
    '%s whose key ran at the last count starts at once after a restart',
    async (_what, name) => {
      const first = await holdFirstRun(name)
      // The monitor counts while the run goes; the run ends; the worker restarts and reads the
      // count when it starts (by default the next count is up to a minute away).
      await countRunningKeys(name)
      first.release.open()
      await waitFor('the first run to end', () => running.get(first.key) === 0, START_MS)
      await (boss as PgBoss).stop({ graceful: true, timeout: 5_000 })
      boss = await startWorker()

      expect(await send(name, first.payload)).not.toBeNull()
      await waitFor('the next run', () => runs.get(first.key) === 2, START_MS)
      expect(beside).toBe(0)
    },
    60_000,
  )

  it.each(QUEUES)(
    '%s whose key ran at the last count starts at once in steady state',
    async (_what, name) => {
      const first = await holdFirstRun(name)
      // The monitor counts while the run goes and the worker caches the count; the run ends
      // before the next count.
      await countRunningKeys(name)
      await new Promise((resolve) => setTimeout(resolve, CACHE_MS))
      first.release.open()
      await waitFor('the first run to end', () => running.get(first.key) === 0, START_MS)

      expect(await send(name, first.payload)).not.toBeNull()
      await waitFor('the next run', () => runs.get(first.key) === 2, START_MS)
      expect(beside).toBe(0)
    },
    60_000,
  )

  it.each(QUEUES)(
    '%s sent while its key runs waits behind it, once, and never runs beside it',
    async (_what, name) => {
      const first = await holdFirstRun(name)
      expect(await send(name, first.payload)).not.toBeNull()
      // A send while one waits is the same job.
      expect(await send(name, first.payload)).toBeNull()
      await new Promise((resolve) => setTimeout(resolve, CACHE_MS))
      expect(runs.get(first.key)).toBe(1)
      first.release.open()
      await waitFor('the waiting run', () => runs.get(first.key) === 2, START_MS)
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      expect(runs.get(first.key)).toBe(2)
      expect(beside).toBe(0)
    },
    60_000,
  )
})
