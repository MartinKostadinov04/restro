// The worker process: pg-boss on our Postgres, the registered jobs, the health endpoint.
//
// Start order (any failure undoes what already started and rethrows):
//   1. health endpoint (an unusable port fails fast; probes see 503 "starting" until step 5);
//   2. the @restro/db pool, and one scoped transaction to prove the database is reachable and
//      that the role cannot bypass row-level security (UnsafeDatabaseRoleError otherwise). This
//      happens BEFORE pg-boss, so a mistaken owner URL never gets to create tables;
//   3. pg-boss with `createSchema: false` (the migration owner created schema `pgboss`; the app
//      role may only use and create in it) and `migrate: true` (pg-boss installs and upgrades
//      its own tables);
//   4. the jobs from jobs/index.ts (registry.ts), plus one immediate heartbeat so /health turns
//      green within seconds instead of after the first cron tick;
//   5. "worker started".
//
// Stop order (stop() is idempotent; the signal handling lives in shutdown.ts):
//   1. /health starts answering 503 "stopping";
//   2. `boss.stop({ graceful: true, timeout: 20000 })`: no new work is fetched, running jobs get
//      up to 20 seconds to finish, then are failed and retried by the next worker; pg-boss's own
//      pool is closed;
//   3. the @restro/db pool is closed;
//   4. the health endpoint is closed last, so the process stays probe-able until the end.
import { createPool, type DbPool, withSystem } from '@restro/db'
import { PgBoss } from 'pg-boss'

import type { WorkerConfig } from './config'
import { APP_POOL_MAX, QUEUE_POOL_MAX, QUEUE_SCHEMA, withSessionTimeouts } from './connection'
import { WorkerStatus } from './health'
import { type HealthServer, startHealthServer } from './health-server'
import { jobs as defaultJobs } from './jobs'
import type { JobDefinition, WorkerContext } from './jobs/types'
import { WORKER_HEARTBEAT_JOB } from './jobs/worker-heartbeat'
import type { Logger } from './logger'
import { registerJobs } from './registry'
import { WORKER_VERSION } from './version'

/** How long running jobs get to finish when the worker stops. */
export const SHUTDOWN_TIMEOUT_MS = 20_000

export interface StartWorkerOptions {
  readonly logger: Logger
  /** The jobs to run. Default: the list in jobs/index.ts. Tests pass their own. */
  readonly jobs?: readonly JobDefinition[]
  readonly now?: () => Date
  readonly version?: string
}

export interface Worker {
  readonly boss: PgBoss
  readonly status: WorkerStatus
  /** The port GET /health listens on. */
  readonly healthPort: number
  /** Stops the worker (see the header). Safe to call more than once. */
  stop(): Promise<void>
}

/** Warning payloads can hold SQL and values (pg-boss's slow_query); keep numbers and booleans. */
function safeWarningData(data: unknown): Record<string, number | boolean> {
  if (typeof data !== 'object' || data === null) return {}
  return Object.fromEntries(
    Object.entries(data).filter(
      (entry): entry is [string, number | boolean] =>
        typeof entry[1] === 'number' || typeof entry[1] === 'boolean',
    ),
  )
}

export async function startWorker(
  config: WorkerConfig,
  options: StartWorkerOptions,
): Promise<Worker> {
  const log = options.logger.child({ workerId: config.workerId })
  const jobs = options.jobs ?? defaultJobs
  const now = options.now ?? (() => new Date())
  const version = options.version ?? WORKER_VERSION
  const status = new WorkerStatus()
  const databaseUrl = withSessionTimeouts(config.databaseUrl)

  let health: HealthServer | undefined
  let pool: DbPool | undefined
  let boss: PgBoss | undefined

  /** Closes whatever was opened. Every step runs; the first failure is rethrown at the end. */
  async function closeAll(graceful: boolean): Promise<void> {
    const failures: unknown[] = []
    const attempt = async (what: string, close: () => Promise<unknown>) => {
      try {
        await close()
      } catch (error) {
        failures.push(error)
        log.error({ err: error }, `could not close ${what}`)
      }
    }
    if (boss) {
      const queue = boss
      await attempt('pg-boss', () => queue.stop({ graceful, timeout: SHUTDOWN_TIMEOUT_MS }))
    }
    status.setPgBoss('stopped')
    if (pool) await attempt('the database pool', () => (pool as DbPool).end())
    if (health) await attempt('the health endpoint', () => (health as HealthServer).close())
    if (failures.length > 0) throw failures[0]
  }

  try {
    health = await startHealthServer(config.healthPort, () => status.report(now()))

    pool = createPool(databaseUrl, {
      max: APP_POOL_MAX,
      applicationName: 'restro-worker',
      onIdleError: (error) => log.error({ err: error }, 'idle database connection failed'),
    })
    await withSystem(pool, async () => undefined)

    boss = new PgBoss({
      connectionString: databaseUrl,
      schema: QUEUE_SCHEMA,
      createSchema: false,
      migrate: true,
      max: QUEUE_POOL_MAX,
      application_name: 'restro-worker-queue',
    })
    boss.on('error', (error) => log.error({ err: error }, 'pg-boss error'))
    boss.on('warning', (warning) =>
      log.warn({ warning: warning.message, ...safeWarningData(warning.data) }, 'pg-boss warning'),
    )
    boss.on('stopped', () => status.setPgBoss('stopped'))
    await boss.start()
    status.setPgBoss('started')

    const context: WorkerContext = {
      pool,
      log,
      workerId: config.workerId,
      version,
      now,
      status,
    }
    await registerJobs(boss, jobs, context)
    if (jobs.some((job) => job.name === WORKER_HEARTBEAT_JOB)) {
      await boss.send(WORKER_HEARTBEAT_JOB, {})
    }
  } catch (error) {
    // Nothing is running yet that needs a grace period.
    await closeAll(false).catch(() => undefined)
    throw error
  }

  log.info({ version, pgboss: status.pgboss, healthPort: health.port }, 'worker started')

  let stopping: Promise<void> | undefined
  return {
    boss,
    status,
    healthPort: health.port,
    stop() {
      stopping ??= (async () => {
        log.info('worker stopping')
        status.setPgBoss('stopping')
        await closeAll(true)
        log.info('worker stopped')
      })()
      return stopping
    },
  }
}
