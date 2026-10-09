// The sync jobs on the real queue (pg-boss on Postgres, as restro_app): queues created with the
// `exclusive` policy and a dead-letter queue, the two schedules (tz Europe/Sofia), one pull at a
// time per integration however many senders there are, a job travelling the queue end to end, and
// the ticks that decide which venues get a pull. MSW answers for barsy; nothing leaves the machine.
import { tmpdir } from 'node:os'

import { JOB_NAMES, prepareJob } from '@restro/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorkerConfig } from '../src/config'
import { buildJobs } from '../src/jobs'
import { createBarsyJobs } from '../src/jobs/barsy'
import { createLogger } from '../src/logger'
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
    }
    worker = await startWorker(config, {
      logger,
      jobs: createBarsyJobs({
        keys: world.keys,
        policy: config.barsy,
        store: world.env.store,
        limiters: world.env.limiters,
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
    // The ticks are plain queues.
    expect(await worker.boss.getQueue(JOB_NAMES.barsyIncrementalTick)).toMatchObject({
      policy: 'standard',
    })
  })

  it('schedules the incremental tick every 5 minutes and the full pull daily at 12:00, Europe/Sofia', async () => {
    const schedules = await worker.boss.getSchedules()
    const byName = new Map(schedules.map((schedule) => [schedule.name, schedule]))
    expect(byName.get(JOB_NAMES.barsyIncrementalTick)).toMatchObject({
      cron: '*/5 * * * *',
      timezone: 'Europe/Sofia',
    })
    expect(byName.get(JOB_NAMES.barsyFullPullTick)).toMatchObject({
      cron: '0 12 * * *',
      timezone: 'Europe/Sofia',
    })
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

  describe('the ticks', () => {
    const tick = async (name: string) => {
      world.enqueued.length = 0
      await world.run(name, {})
      return world.enqueued
    }

    it('queue a pull for every connected integration with a mapped venue and a catalogue root', async () => {
      const queued = await tick(JOB_NAMES.barsyIncrementalTick)
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        name: JOB_NAMES.barsyIncremental,
        data: {
          tenantId: world.tenantId,
          integrationId: world.integrationId,
          venueId: world.venueId,
        },
        singletonKey: world.integrationId,
      })
      const full = await tick(JOB_NAMES.barsyFullPullTick)
      expect(full.map((job) => job.name)).toEqual([JOB_NAMES.barsyFullPull])
    })

    it('skip an integration that is not connected, or whose venue has no catalogue root', async () => {
      await world.query(`update restro.integrations set status = 'error' where id = $1`, [
        world.integrationId,
      ])
      expect(await tick(JOB_NAMES.barsyIncrementalTick)).toEqual([])
      await world.query(`update restro.integrations set status = 'connected' where id = $1`, [
        world.integrationId,
      ])
      await world.query(
        'update restro.barsy_venues set catalogue_root_cat_id = null where integration_id = $1',
        [world.integrationId],
      )
      expect(await tick(JOB_NAMES.barsyIncrementalTick)).toEqual([])
      await world.query(
        'update restro.barsy_venues set catalogue_root_cat_id = 1091 where integration_id = $1',
        [world.integrationId],
      )
      expect(await tick(JOB_NAMES.barsyIncrementalTick)).toHaveLength(1)
    })

    it('read the integrations through tenant scopes only (no owner role): each tenant on its own', async () => {
      // A tenant with no organisation row is invisible to the tick: tenants are listed from the
      // organisation table, then each tenant's rows are read inside its own scope.
      await world.query(`delete from restro.auth_organization where id = $1`, [world.tenantId])
      expect(await tick(JOB_NAMES.barsyIncrementalTick)).toEqual([])
      await world.query(
        `insert into restro.auth_organization (id, name, slug) values ($1, 'Sync test club', 'sync-queue-test')`,
        [world.tenantId],
      )
      expect(await tick(JOB_NAMES.barsyIncrementalTick)).toHaveLength(1)
    })
  })
})

describe('buildJobs', () => {
  const configWithoutKeys = {
    seal: null,
    barsy: { env: 'test', allowedHostSuffixes: ['.barsyonline.com'], productionHosts: [] },
    assets: { kind: 'local', dir: tmpdir() },
  } as unknown as WorkerConfig

  it('without the sealing keys it registers the heartbeat only and warns once', async () => {
    const warnings: string[] = []
    const log = {
      warn: (message: string) => warnings.push(message),
    } as unknown as Parameters<typeof buildJobs>[1]
    const jobs = await buildJobs(configWithoutKeys, log)
    expect(jobs.map((job) => job.name)).toEqual(['worker-heartbeat'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('SEAL_PUBLIC_KEY')
    expect(warnings[0]).not.toMatch(/[A-Za-z0-9_-]{40,}/)
  })

  it('with the keys it adds the four jobs and the two ticks', async () => {
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
      JOB_NAMES.barsyIncrementalTick,
      JOB_NAMES.barsyFullPullTick,
    ])
  })
})
