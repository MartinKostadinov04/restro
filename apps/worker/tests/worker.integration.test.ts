// Boots the real worker in this process against a brand-new Postgres database and checks what
// the brief promises: pg-boss starts as restro_app, the heartbeat job writes its row, /health
// answers 200, failed jobs end up in `<name>.dead` without leaking query parameters, and stop()
// finishes running jobs and leaves nothing open. See tests/database.ts for the set-up and for
// when this test is skipped.
import { randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { tmpdir } from 'node:os'

import { withSystem, workerHeartbeats } from '@restro/db'
import type { QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorkerConfig } from '../src/config'
import { HEARTBEAT_MAX_AGE_MS } from '../src/health'
import { defineJob } from '../src/jobs/types'
import { workerHeartbeat } from '../src/jobs/worker-heartbeat'
import { createLogger } from '../src/logger'
import { WORKER_VERSION } from '../src/version'
import { startWorker, type Worker } from '../src/worker'
import { createTestDatabase, hasDatabase, type TestDatabase, withOwnerClient } from './database'

const SECRET = `SECRET-${randomUUID()}`
const WORKER_ID = `it-${randomUUID().slice(0, 8)}`

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls until `check` returns something other than undefined (or the time is up). */
async function waitFor<T>(what: string, check: () => Promise<T | undefined>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await check()
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await sleep(100)
  }
}

/** GET /health on a connection of its own (no keep-alive, so it leaves no socket behind). */
function getHealth(port: number): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/health', agent: false }, (res) => {
      let text = ''
      res.on('data', (chunk) => {
        text += chunk
      })
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as Record<string, unknown> }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

function openSockets(): { clients: number; servers: number } {
  const resources = process.getActiveResourcesInfo()
  return {
    clients: resources.filter((name) => name === 'TCPSocketWrap').length,
    servers: resources.filter((name) => name === 'TCPServerWrap').length,
  }
}

// Test jobs, registered next to the real heartbeat job.
const observed = { statementTimeout: '', idleTimeout: '', slowStarted: false, slowFinished: false }

const failingJob = defineJob({
  name: 'test-failing',
  options: { queue: { retryLimit: 0 }, work: { pollingIntervalSeconds: 0.5 } },
  async handler(_jobs, { pool }) {
    // NOT NULL violation. Postgres's own detail text quotes the row, SECRET included.
    await withSystem(pool, (tx) =>
      tx
        .insert(workerHeartbeats)
        .values({ workerId: SECRET, lastBeatAt: new Date(), version: null as unknown as string }),
    )
  },
})

const sessionJob = defineJob({
  name: 'test-session',
  options: { queue: { retryLimit: 0 }, work: { pollingIntervalSeconds: 0.5 } },
  async handler(_jobs, { pool }) {
    await withSystem(pool, async (tx) => {
      const result = await tx.execute<{ st: string; it: string }>(
        "select current_setting('statement_timeout') as st, " +
          "current_setting('idle_in_transaction_session_timeout') as it",
      )
      observed.statementTimeout = result.rows[0]?.st ?? ''
      observed.idleTimeout = result.rows[0]?.it ?? ''
    })
  },
})

const slowJob = defineJob({
  name: 'test-slow',
  options: { queue: { retryLimit: 0 }, work: { pollingIntervalSeconds: 0.5 } },
  async handler() {
    observed.slowStarted = true
    await sleep(1500)
    observed.slowFinished = true
  },
})

describe.skipIf(!hasDatabase)('worker (integration, real Postgres)', () => {
  let db: TestDatabase
  let worker: Worker
  let config: WorkerConfig
  let stopped = false
  const lines: string[] = []
  const logged = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>)
  let baseline = { clients: 0, servers: 0 }

  const query = <Row extends QueryResultRow>(sql: string, values: unknown[] = []) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query<Row>(sql, values)).rows)

  beforeAll(async () => {
    db = await createTestDatabase()
    config = {
      databaseUrl: db.appUrl,
      purgeDatabaseUrl: null,
      workerId: WORKER_ID,
      healthPort: 0,
      logLevel: 'debug',
      prettyLogs: false,
      seal: null,
      barsy: { env: 'test', allowedHostSuffixes: ['.barsyonline.com'], productionHosts: [] },
      sim: { env: 'test', allowHosts: [] },
      assets: { kind: 'local', dir: tmpdir() },
      publish: { kind: 'local', dir: tmpdir() },
      revealToken: null,
      billIdKey: null,
      posSync: true,
    }
    const logger = await createLogger({
      level: 'debug',
      pretty: false,
      destination: { write: (line: string) => void lines.push(line) },
    })
    // Let any socket the set-up opened finish closing before counting.
    await sleep(300)
    baseline = openSockets()
    worker = await startWorker(config, {
      logger,
      jobs: [workerHeartbeat, failingJob, sessionJob, slowJob],
    })
  }, 120_000)

  afterAll(async () => {
    if (worker && !stopped) await worker.stop().catch(() => undefined)
    await db?.drop().catch(() => undefined)
  }, 60_000)

  it('logs "worker started" with the version and the pg-boss state', () => {
    const started = logged().find((line) => line.msg === 'worker started')
    expect(started).toMatchObject({
      version: WORKER_VERSION,
      pgboss: 'started',
      workerId: WORKER_ID,
    })
  })

  it('records the first heartbeat through the queue and answers /health with 200', async () => {
    const row = await waitFor('the heartbeat row', async () => {
      const rows = await query<{ worker_id: string; last_beat_at: Date; version: string }>(
        'select * from restro.worker_heartbeats where worker_id = $1',
        [WORKER_ID],
      )
      return rows[0]
    })
    expect(row.version).toBe(WORKER_VERSION)
    expect(Date.now() - row.last_beat_at.getTime()).toBeLessThan(HEARTBEAT_MAX_AGE_MS)

    const health = await waitFor('a healthy /health', async () => {
      const answer = await getHealth(worker.healthPort)
      return answer.status === 200 ? answer : undefined
    })
    expect(health.body).toEqual({
      status: 'ok',
      lastBeatAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
      pgboss: 'started',
    })
  })

  it('updates the same row when the heartbeat job runs again', async () => {
    const read = async () =>
      (
        await query<{ last_beat_at: Date }>(
          'select last_beat_at from restro.worker_heartbeats where worker_id = $1',
          [WORKER_ID],
        )
      )[0]?.last_beat_at
    const before = await read()
    await sleep(20) // the clock moves on before the second beat
    await worker.boss.send(workerHeartbeat.name, {})
    await waitFor('a newer heartbeat', async () => {
      const now = await read()
      return before && now && now > before ? now : undefined
    })
    const rows = await query('select 1 from restro.worker_heartbeats where worker_id = $1', [
      WORKER_ID,
    ])
    expect(rows).toHaveLength(1)
  })

  it('schedules the heartbeat every minute, with a dead-letter queue', async () => {
    const schedule = await worker.boss.getSchedule('worker-heartbeat')
    expect(schedule).toMatchObject({ name: 'worker-heartbeat', key: '', cron: '* * * * *' })
    const queue = await worker.boss.getQueue('worker-heartbeat')
    expect(queue).toMatchObject({ deadLetter: 'worker-heartbeat.dead', retryLimit: 0 })
    expect(await worker.boss.getQueue('worker-heartbeat.dead')).not.toBeNull()
  })

  it('installs pg-boss in schema pgboss as restro_app, and restro_app cannot create in restro', async () => {
    const owners = await query<{ owner: string }>(
      `select distinct r.rolname as owner from pg_class c
       join pg_roles r on r.oid = c.relowner
       where c.relnamespace = 'pgboss'::regnamespace`,
    )
    expect(owners).toEqual([{ owner: 'restro_app' }])
    const [privileges] = await query<{ create_restro: boolean; create_db: boolean }>(
      `select has_schema_privilege('restro_app', 'restro', 'CREATE') as create_restro,
              has_database_privilege('restro_app', current_database(), 'CREATE') as create_db`,
    )
    expect(privileges).toEqual({ create_restro: false, create_db: false })
  })

  // The worker puts no timeouts in the connection string: they come from `ALTER ROLE restro_app
  // SET ...` in db:roles, which createTestDatabase() ran on this database.
  it('gives both pools the statement and idle-in-transaction timeouts of the role', async () => {
    const [queueSide] = await worker.boss
      .getDb()
      .executeSql(
        "select current_setting('statement_timeout') as st, current_setting('idle_in_transaction_session_timeout') as it",
      )
      .then((result) => result.rows as { st: string; it: string }[])
    expect(queueSide).toEqual({ st: '30s', it: '1min' })

    await worker.boss.send('test-session', {})
    await waitFor('the session job', async () => (observed.statementTimeout ? true : undefined))
    expect({ st: observed.statementTimeout, it: observed.idleTimeout }).toEqual({
      st: '30s',
      it: '1min',
    })
  })

  it('moves a failed job to <name>.dead and keeps query parameters out of logs and job records', async () => {
    await worker.boss.send('test-failing', {})
    const jobs = await waitFor('the dead-lettered job', async () => {
      const rows = await query<{ name: string; state: string; record: string }>(
        `select name, state, (to_jsonb(j)::text) as record from pgboss.job j
         where name in ('test-failing', 'test-failing.dead')`,
      )
      return rows.some((row) => row.name === 'test-failing.dead') ? rows : undefined
    })
    expect(jobs.find((job) => job.name === 'test-failing')?.state).toBe('failed')
    for (const job of jobs) {
      expect(job.record).toContain('JobFailedError')
      expect(job.record).not.toContain(SECRET)
    }

    const failure = logged().find(
      (line) => line.msg === 'job failed' && line.job === 'test-failing',
    )
    expect(failure).toBeDefined()
    expect(JSON.stringify(failure)).not.toContain(SECRET)
    // The reason is Postgres's own: the cause with its SQLSTATE (23502 = not_null_violation).
    expect(failure?.err).toMatchObject({
      type: 'DrizzleQueryError',
      cause: { code: '23502', message: expect.stringContaining('violates not-null constraint') },
    })
    expect(lines.join('\n')).not.toContain(SECRET)
  })

  it('refuses to start as the database owner, before pg-boss touches anything', async () => {
    const logger = await createLogger({ level: 'silent', pretty: false })
    await expect(
      startWorker(
        { ...config, databaseUrl: db.ownerUrl },
        { logger, jobs: [], version: 'owner-attempt' },
      ),
    ).rejects.toMatchObject({ name: 'UnsafeDatabaseRoleError' })
  })

  it('stop() lets a running job finish, then leaves nothing open', async () => {
    await worker.boss.send('test-slow', {})
    await waitFor('the slow job to start', async () => (observed.slowStarted ? true : undefined))
    expect(observed.slowFinished).toBe(false)

    await worker.stop()
    stopped = true
    // Graceful: the job was allowed to finish and was completed, not failed and retried.
    expect(observed.slowFinished).toBe(true)
    const [slow] = await query<{ state: string }>(
      "select state from pgboss.job where name = 'test-slow'",
    )
    expect(slow?.state).toBe('completed')
    expect(worker.status.pgboss).toBe('stopped')
    expect(logged().some((line) => line.msg === 'worker stopped')).toBe(true)

    // The health endpoint is gone ...
    await expect(getHealth(worker.healthPort)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    // ... both pools are closed (Postgres sees no session of the worker; the wait is short on
    // purpose: an idle pool closes itself after 10 seconds, which must not hide a missed end()) ...
    const sessions = await waitFor(
      'the worker sessions to close',
      async () => {
        const rows = await query<{ count: string }>(
          "select count(*) from pg_stat_activity where application_name like 'restro-worker%' and datname = current_database()",
        )
        return rows[0]?.count === '0' ? true : undefined
      },
      3000,
    )
    expect(sessions).toBe(true)
    // ... and this process holds no more sockets or listeners than before the worker started.
    await waitFor(
      'the sockets to be released',
      async () => {
        const now = openSockets()
        return now.clients <= baseline.clients && now.servers <= baseline.servers ? true : undefined
      },
      3000,
    )
    // A second stop() is harmless.
    await expect(worker.stop()).resolves.toBeUndefined()
  }, 60_000)
})
