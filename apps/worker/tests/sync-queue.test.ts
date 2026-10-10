// The sync jobs on the real queue (pg-boss on Postgres, as restro_app): queues created with the
// `exclusive` policy and a dead-letter queue, the one-minute schedule (tz Europe/Sofia) that
// replaced the two fixed ones, one pull at a time per integration however many senders there are,
// a job travelling the queue end to end, and the tick that decides which venues get a pull. MSW
// answers for barsy; nothing leaves the machine.
import { tmpdir } from 'node:os'

import { JOB_NAMES, prepareJob } from '@restro/core'
import { tryAdvisoryLock } from '@restro/db'
import { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { WorkerConfig } from '../src/config'
import { QUEUE_SCHEMA } from '../src/connection'
import { buildJobs } from '../src/jobs'
import { createBarsyJobs } from '../src/jobs/barsy'
import { createLogger } from '../src/logger'
import { pullLockName } from '../src/sync/pull-lock'
import { startWorker, type Worker } from '../src/worker'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, type World } from './world'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(what: string, check: () => Promise<T | undefined>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await check()
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await sleep(200)
  }
}

allowSlowSetup()

describe.skipIf(!hasDatabase)('sync jobs on pg-boss', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let worker: Worker

  beforeAll(async () => {
    db = await createTestDatabase()
    fake.listen()
    // A database that an earlier version of the worker ran on: its two fixed schedules are in
    // pg-boss, and the new worker must remove them when it starts.
    const earlier = new PgBoss({
      connectionString: db.appUrl,
      schema: QUEUE_SCHEMA,
      createSchema: false,
      migrate: true,
    })
    await earlier.start()
    for (const [name, cron] of [
      ['barsy-incremental-tick', '*/5 * * * *'],
      ['barsy-full-pull-tick', '0 12 * * *'],
    ] as const) {
      await earlier.createQueue(name)
      await earlier.schedule(name, cron, null, { tz: 'Europe/Sofia' })
    }
    await earlier.stop({ graceful: true, timeout: 5_000 })
    world = await createWorld(fake, { database: db })
    const logger = await createLogger({
      level: 'silent',
      pretty: false,
      destination: { write: () => undefined },
    })
    const policy = { env: 'test', allowedHostSuffixes: ['.barsyonline.com'], productionHosts: [] }
    const config: WorkerConfig = {
      databaseUrl: db.appUrl,
      workerId: 'sync-queue-test',
      healthPort: 0,
      logLevel: 'silent',
      prettyLogs: false,
      seal: world.keys,
      barsy: policy as WorkerConfig['barsy'],
      assets: { kind: 'local', dir: tmpdir() },
      publish: { kind: 'local', dir: tmpdir() },
    }
    worker = await startWorker(config, {
      logger,
      jobs: createBarsyJobs({
        keys: world.keys,
        policy: config.barsy,
        store: world.env.store,
        limiters: world.env.limiters,
        // A full pull that finds another pull running gives up quickly in this test.
        pullLockWaitMs: 300,
        pullLockPollMs: 50,
      }),
    })
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await worker?.stop()
    await world?.close()
    fake.close()
    await db?.drop()
  })

  it('creates the queues with the exclusive policy and a dead-letter queue each', async () => {
    for (const name of [
      JOB_NAMES.barsyConnect,
      JOB_NAMES.barsyFullPull,
      JOB_NAMES.barsyIncremental,
      JOB_NAMES.assetFetch,
    ]) {
      const queue = await worker.boss.getQueue(name)
      expect(queue, name).toMatchObject({ policy: 'exclusive', deadLetter: `${name}.dead` })
      expect(await worker.boss.getQueue(`${name}.dead`)).not.toBeNull()
    }
    // The tick is a plain queue.
    expect(await worker.boss.getQueue(JOB_NAMES.barsySyncTick)).toMatchObject({
      policy: 'standard',
    })
  })

  it('has one schedule, a tick every minute in Europe/Sofia, and removed the two old ones at start', async () => {
    const schedules = (await worker.boss.getSchedules()).filter(
      (schedule) => schedule.name.startsWith('barsy-') && schedule.name.endsWith('-tick'),
    )
    expect(schedules.map((schedule) => schedule.name)).toEqual([JOB_NAMES.barsySyncTick])
    expect(schedules[0]).toMatchObject({ cron: '* * * * *', timezone: 'Europe/Sofia' })
    const names = (await worker.boss.getSchedules()).map((schedule) => schedule.name)
    expect(names).not.toContain('barsy-incremental-tick')
    expect(names).not.toContain('barsy-full-pull-tick')
  })

  it('a full pull that finds another pull running is queued again, and the real queue takes it', async () => {
    // The running job holds the integration's plain singleton key, and the exclusive policy drops
    // a second job with it (send returns null). The copy is accepted because its key is its own.
    const job = prepareJob(JOB_NAMES.barsyFullPull, {
      tenantId: world.tenantId,
      integrationId: world.integrationId,
      venueId: world.venueId,
    })
    const held = await tryAdvisoryLock(world.pool, pullLockName(world.integrationId))
    if (held === null) throw new Error('the pull lock was not free')
    try {
      expect(
        await worker.boss.send(JOB_NAMES.barsyFullPull, job.data, {
          singletonKey: job.singletonKey,
        }),
      ).toEqual(expect.any(String))
      const jobs = await waitFor('the full pull to be queued again', async () => {
        const rows = await world.query<{
          state: string
          singleton_key: string | null
          in_a_minute: boolean
        }>(
          `select state, singleton_key, start_after > now() + interval '50 seconds' as in_a_minute
           from pgboss.job where name = $1 order by created_on`,
          [JOB_NAMES.barsyFullPull],
        )
        // The handler queues the copy and only then completes: wait for both, or a busy machine
        // reads the first job while it is still active.
        return rows.length === 2 && rows[0]?.state === 'completed' ? rows : undefined
      })
      expect(jobs[0]).toMatchObject({ state: 'completed', singleton_key: job.singletonKey })
      expect(jobs[1]?.state).toBe('created')
      expect(jobs[1]?.singleton_key).toMatch(new RegExp(`^${world.integrationId}:later:\\d+$`))
      expect(jobs[1]?.in_a_minute).toBe(true)
      const [run] = await world.query<{ status: string; error_summary: string }>(
        `select status, error_summary from restro.job_runs
         where integration_id = $1 and kind = 'barsy_full_pull'`,
        [world.integrationId],
      )
      expect(run?.status).toBe('completed')
      expect(run?.error_summary).toContain('queued again')
    } finally {
      await held.release()
      // Leave the queue as the next test expects it.
      await world.query(`delete from pgboss.job where name = $1`, [JOB_NAMES.barsyFullPull])
      await world.query(`delete from restro.job_runs where integration_id = $1`, [
        world.integrationId,
      ])
    }
  })

  it('two pulls of one integration are never queued at once; another integration is not blocked', async () => {
    await worker.boss.offWork(JOB_NAMES.barsyFullPull)
    const base = { tenantId: world.tenantId, venueId: world.venueId }
    const mine = prepareJob(JOB_NAMES.barsyFullPull, {
      ...base,
      integrationId: world.integrationId,
    })
    const send = (job: typeof mine) =>
      worker.boss.send(JOB_NAMES.barsyFullPull, job.data, { singletonKey: job.singletonKey })

    const first = await send(mine)
    expect(first).toEqual(expect.any(String))
    // The web app's "Sync now", the daily tick, an incremental run that saw the tree change:
    // whoever sends, a second pull of the same integration is dropped.
    expect(await send(mine)).toBeNull()
    expect(await send(mine)).toBeNull()

    const other = prepareJob(JOB_NAMES.barsyFullPull, {
      ...base,
      integrationId: world.integrationId.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')),
    })
    expect(await send(other)).toEqual(expect.any(String))
    const rows = await world.query<{ n: string }>(
      `select count(*) as n from pgboss.job where name = $1`,
      [JOB_NAMES.barsyFullPull],
    )
    expect(Number(rows[0]?.n)).toBe(2)
  })

  it('a job travels the queue end to end: barsy-connect connects the integration', async () => {
    await world.query(`update restro.integrations set status = 'new' where id = $1`, [
      world.integrationId,
    ])
    const job = prepareJob(JOB_NAMES.barsyConnect, {
      tenantId: world.tenantId,
      integrationId: world.integrationId,
    })
    expect(
      await worker.boss.send(JOB_NAMES.barsyConnect, job.data, { singletonKey: job.singletonKey }),
    ).toEqual(expect.any(String))
    await waitFor('the integration to connect', async () => {
      const [row] = await world.query<{ status: string }>(
        'select status from restro.integrations where id = $1',
        [world.integrationId],
      )
      return row?.status === 'connected' ? row : undefined
    })
    const [run] = await world.query<{ status: string }>(
      `select status from restro.job_runs where integration_id = $1 and kind = 'barsy_connect'`,
      [world.integrationId],
    )
    expect(run?.status).toBe('completed')
  })

  describe('the tick', () => {
    const tick = async () => {
      world.enqueued.length = 0
      await world.run(JOB_NAMES.barsySyncTick, {})
      return world.enqueued
    }

    beforeEach(async () => {
      // 12:07 in Sofia, after the daily time, with nothing recorded yet: both pulls are due.
      world.clock = new Date('2026-10-10T09:07:20Z')
      await world.query(
        `update restro.integrations set config = config - 'sync' - 'schedule' - 'publish'
         where id = $1`,
        [world.integrationId],
      )
    })

    it('queues the due pulls for every connected integration with a mapped venue and a catalogue root', async () => {
      const queued = await tick()
      expect(queued.map((job) => job.name)).toEqual([
        JOB_NAMES.barsyIncremental,
        JOB_NAMES.barsyFullPull,
      ])
      for (const job of queued) {
        expect(job).toMatchObject({
          data: {
            tenantId: world.tenantId,
            integrationId: world.integrationId,
            venueId: world.venueId,
          },
          singletonKey: world.integrationId,
        })
      }
    })

    it('skips an integration that is not connected, or whose venue has no catalogue root', async () => {
      await world.query(`update restro.integrations set status = 'error' where id = $1`, [
        world.integrationId,
      ])
      expect(await tick()).toEqual([])
      await world.query(`update restro.integrations set status = 'connected' where id = $1`, [
        world.integrationId,
      ])
      await world.query(
        'update restro.barsy_venues set catalogue_root_cat_id = null where integration_id = $1',
        [world.integrationId],
      )
      expect(await tick()).toEqual([])
      await world.query(
        'update restro.barsy_venues set catalogue_root_cat_id = 1091 where integration_id = $1',
        [world.integrationId],
      )
      expect(await tick()).toHaveLength(2)
    })

    it('reads the integrations through tenant scopes only (no owner role): each tenant on its own', async () => {
      // A tenant with no organisation row is invisible to the tick: tenants are listed from the
      // organisation table, then each tenant's rows are read inside its own scope.
      await world.query(`delete from restro.auth_organization where id = $1`, [world.tenantId])
      expect(await tick()).toEqual([])
      await world.query(
        `insert into restro.auth_organization (id, name, slug) values ($1, 'Sync test club', 'sync-queue-test')`,
        [world.tenantId],
      )
      expect(await tick()).toHaveLength(2)
    })
  })
})

describe('buildJobs', () => {
  const configWithoutKeys = {
    seal: null,
    barsy: { env: 'test', allowedHostSuffixes: ['.barsyonline.com'], productionHosts: [] },
    assets: { kind: 'local', dir: tmpdir() },
    publish: { kind: 'local', dir: tmpdir() },
  } as unknown as WorkerConfig

  it('without the sealing keys it registers the heartbeat and the publish jobs, and warns once', async () => {
    const warnings: string[] = []
    const log = {
      warn: (message: string) => warnings.push(message),
    } as unknown as Parameters<typeof buildJobs>[1]
    const jobs = await buildJobs(configWithoutKeys, log)
    expect(jobs.map((job) => job.name)).toEqual([
      'worker-heartbeat',
      JOB_NAMES.publishMenu,
      JOB_NAMES.publishFiles,
      JOB_NAMES.publishLive,
      JOB_NAMES.assetVariants,
      JOB_NAMES.publishTableTokens,
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('SEAL_PUBLIC_KEY')
    expect(warnings[0]).not.toMatch(/[A-Za-z0-9_-]{40,}/)
  })

  it('with the keys it adds the four sync jobs and the one tick to the publish jobs', async () => {
    const world = await import('../src/config').then(async ({ loadConfig }) => {
      const { generateSealKeyPair } = await import('@restro/core/seal-open')
      const pair = generateSealKeyPair()
      return loadConfig({
        DATABASE_URL: 'postgres://restro_app:x@localhost:54329/restro',
        SEAL_PUBLIC_KEY: pair.publicKey,
        SEAL_PRIVATE_KEY: pair.privateKey,
      })
    })
    const jobs = await buildJobs(world, { warn: () => undefined } as never)
    expect(jobs.map((job) => job.name)).toEqual([
      'worker-heartbeat',
      JOB_NAMES.barsyConnect,
      JOB_NAMES.barsyFullPull,
      JOB_NAMES.barsyIncremental,
      JOB_NAMES.assetFetch,
      JOB_NAMES.barsySyncTick,
      JOB_NAMES.publishMenu,
      JOB_NAMES.publishFiles,
      JOB_NAMES.publishLive,
      JOB_NAMES.assetVariants,
      JOB_NAMES.publishTableTokens,
    ])
  })
})
