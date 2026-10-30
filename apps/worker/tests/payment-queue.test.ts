// Repair-review, hot spot 6 (RR-16) and hot spot 9: the real queue policy on real pg-boss, with the
// options the worker registers. A send while a run of the same payment goes is not dropped (pg-boss
// `stately`: one job waiting and one running per key): it runs after, and never beside it. One
// payment's long run must not hold up another's, and one table's Send must not hold up another's.
import { tmpdir } from 'node:os'
import { JOB_NAMES } from '@restro/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorkerConfig } from '../src/config'
import { createSendJobs } from '../src/jobs/order-send'
import { createPaymentJobs, queuePrepare } from '../src/jobs/payments'
import type { JobDefinition } from '../src/jobs/types'
import { createLogger } from '../src/logger'
import { startWorker, type Worker } from '../src/worker'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
} from './database'

allowSlowSetup()

const WAIT_MS = 8_000

/** A promise and its release. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

async function waitFor(what: string, done: () => boolean, ms = WAIT_MS) {
  const until = Date.now() + ms
  while (!done() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50))
  if (!done()) throw new Error(`waited ${ms} ms for ${what}`)
}

describe.skipIf(!hasDatabase)('the payment and Send queues on real pg-boss', () => {
  let db: TestDatabase
  let worker: Worker
  /** What the test's handler does for each job of a key, in turn. */
  const scripts = new Map<string, (() => Promise<void>)[]>()
  const runs = new Map<string, number>()
  const running = new Map<string, number>()
  let beside = 0

  /** The worker's own queue options, around a handler the test scripts. */
  const scripted = (job: JobDefinition): JobDefinition => ({
    ...job,
    handler: async (jobs) => {
      for (const one of jobs) {
        const key = (one.data as { key: string }).key
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

  beforeAll(async () => {
    db = await createTestDatabase()
    const logger = await createLogger({
      level: 'silent',
      pretty: false,
      destination: { write: () => undefined },
    })
    const payments = createPaymentJobs({ sim: { env: 'test', allowHosts: [] } } as never)
    const sends = createSendJobs({ sim: { env: 'test', allowHosts: [] } } as never)
    const prepare = payments.find((job) => job.name === JOB_NAMES.paymentPrepare)
    const send = sends.find((job) => job.name === JOB_NAMES.orderSend)
    const config = {
      databaseUrl: db.appUrl,
      purgeDatabaseUrl: null,
      workerId: 'payment-queue-test',
      healthPort: 0,
      logLevel: 'silent',
      prettyLogs: false,
      seal: null,
      sim: { env: 'test', allowHosts: [] },
      assets: { kind: 'local', dir: tmpdir() },
      publish: { kind: 'local', dir: tmpdir() },
      revealToken: null,
      billIdKey: null,
      posSync: false,
      send: false,
    } as unknown as WorkerConfig
    worker = await startWorker(config, {
      logger,
      schedules: false,
      jobs: [scripted(prepare as JobDefinition), scripted(send as JobDefinition)],
    })
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await worker?.stop()
    await db?.drop()
  })

  // As `prepareJob` sends them: each key in its own group.
  const send = (name: string, key: string) =>
    worker.boss.send(name, { key }, { singletonKey: key, group: { id: key } })

  it('a send while a run of the same payment goes waits behind it: never dropped, never beside it', async () => {
    const key = 'pay-while-running'
    const first = gate()
    const started = gate()
    scripts.set(key, [
      async () => {
        started.open()
        await first.opened
      },
    ])
    expect(await send(JOB_NAMES.paymentPrepare, key)).not.toBeNull()
    await started.opened
    // RR-16: the send during the run makes one waiting job; a second is the same job.
    expect(await send(JOB_NAMES.paymentPrepare, key)).not.toBeNull()
    expect(await send(JOB_NAMES.paymentPrepare, key)).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    expect(runs.get(key)).toBe(1)
    first.open()
    await waitFor('the second run', () => runs.get(key) === 2)
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(runs.get(key)).toBe(2)
    expect(beside).toBe(0)
  }, 30_000)

  it('a run that queues its next run and then fails: both go on, one at a time', async () => {
    const key = 'pay-queues-then-throws'
    const started = gate()
    scripts.set(key, [
      async () => {
        started.open()
        await queuePrepare(
          { queue: worker.boss } as never,
          { tenantId: 'tn', venueId: 'vn', paymentId: key } as never,
        ).catch(() => undefined)
        await worker.boss.send(JOB_NAMES.paymentPrepare, { key }, { singletonKey: key })
        throw new Error('a step concluded nothing')
      },
    ])
    await send(JOB_NAMES.paymentPrepare, key)
    await started.opened
    // The waiting job runs, and the retry after it.
    await waitFor('the waiting job and the retry', () => (runs.get(key) ?? 0) >= 3, 15_000)
    expect(beside).toBe(0)
  }, 30_000)

  // RR-61: one hung run must not hold the others.
  it.each([
    ['a payment', JOB_NAMES.paymentPrepare],
    ['a table', JOB_NAMES.orderSend],
  ])(
    "%s's long run does not hold up another's",
    async (_what, name) => {
      const slow = `${name}-slow`
      const other = `${name}-other`
      const release = gate()
      const started = gate()
      scripts.set(slow, [
        async () => {
          started.open()
          await release.opened
        },
      ])
      await send(name, slow)
      await started.opened
      await send(name, other)
      try {
        // The real runs last up to 2 minutes (PAYMENT_RUN_MS) or a minute of read-back.
        await waitFor(`the other ${name} job`, () => runs.get(other) === 1)
      } finally {
        release.open()
      }
    },
    30_000,
  )

  // RR-61, the case the options alone do not cover: a hung run with a second job of its own key
  // waiting. pg-boss's fetch takes the oldest job first, and claiming it breaks the unique index
  // of `stately`, which a fetch reads as "nothing to do": that job must not block the queue.
  it.each([
    ['a payment', JOB_NAMES.paymentPrepare],
    ['a table', JOB_NAMES.orderSend],
  ])(
    "%s's hung run with its next job waiting does not hold up another's",
    async (_what, name) => {
      const hung = `${name}-hung`
      const other = `${name}-free`
      const release = gate()
      const started = gate()
      // The workers poll in step after a start, which can hide the conflict: a fetch that locks
      // the waiting job makes another skip it. Jobs of different lengths put them out of step.
      const finished: string[] = []
      for (const [index, ms] of [130, 370, 610, 850].entries()) {
        const key = `${name}-apart-${index}`
        scripts.set(key, [
          async () => {
            await new Promise((resolve) => setTimeout(resolve, ms))
            finished.push(key)
          },
        ])
        await send(name, key)
      }
      await waitFor('the jobs that put the workers apart', () => finished.length === 4)
      scripts.set(hung, [
        async () => {
          started.open()
          await release.opened
        },
      ])
      await send(name, hung)
      await started.opened
      // The waiting job of the hung key is older than the other key's.
      expect(await send(name, hung)).not.toBeNull()
      await send(name, other)
      try {
        await waitFor(`the other ${name} job`, () => runs.get(other) === 1)
        // One key never runs two, while the other key runs.
        expect(runs.get(hung)).toBe(1)
        expect(beside).toBe(0)
      } finally {
        release.open()
      }
      await waitFor('the waiting job of the hung key', () => runs.get(hung) === 2, 150_000)
      expect(beside).toBe(0)
    },
    180_000,
  )
})
