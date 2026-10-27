// The worker process: pg-boss on our Postgres, the registered jobs, the health endpoint.
//
// Start order (any failure undoes what already started and rethrows):
//   1. health endpoint (an unusable port fails fast; probes see 503 "starting" until step 6);
//   2. the @restro/db pool, and one scoped transaction to prove the database is reachable and
//      that the role cannot bypass row-level security (UnsafeDatabaseRoleError otherwise). This
//      happens BEFORE pg-boss, so a mistaken owner URL never gets to create tables;
//   3. pg-boss with `createSchema: false` (the migration owner created schema `pgboss`; the app
//      role may only use and create in it) and `migrate: true` (pg-boss installs and upgrades
//      its own tables);
//   4. the jobs from jobs/index.ts (registry.ts), plus one immediate heartbeat so /health turns
//      green within seconds instead of after the first cron tick, and one `seal-table-codes` run
//      (#70) so a deploy moves the table codes still in plain at once, and one payment recovery
//      pass (#112) so a payment a dead worker left goes on at once;
//   5. the reveal endpoint, when REVEAL_SERVICE_TOKEN and the seal keys are set (reveal.ts);
//   6. the Telegram long poll for Done presses, when TELEGRAM_BOT_TOKEN is set (#83);
//   7. "worker started".
//
// Stop order (stop() is idempotent; the signal handling lives in shutdown.ts):
//   1. /health starts answering 503 "stopping"; the Telegram poll stops;
//   2. `boss.stop({ graceful: true, timeout: 20000 })`: no new work is fetched, running jobs get
//      up to 20 seconds to finish, then are failed and retried by the next worker; pg-boss's own
//      pool is closed;
//   3. the @restro/db pool is closed;
//   4. the health endpoint is closed last, so the process stays probe-able until the end.
import { JOB_NAMES } from '@restro/core'
import { createPool, type DbPool, withSystem } from '@restro/db'
import { PgBoss } from 'pg-boss'
import { createTelegramClient } from './alerts/telegram'
import { type Poller, startTelegramPoller } from './alerts/telegram-poller'
import type { WorkerConfig } from './config'
import { APP_POOL_MAX, QUEUE_POOL_MAX, QUEUE_SCHEMA } from './connection'
import { WorkerStatus } from './health'
import { type HealthServer, startHealthServer } from './health-server'
import { buildJobs } from './jobs'
import type { JobDefinition, WorkerContext } from './jobs/types'
import { WORKER_HEARTBEAT_JOB } from './jobs/worker-heartbeat'
import type { Logger } from './logger'
import { registerJobs } from './registry'
import { reveal } from './reveal'
import { WORKER_VERSION } from './version'

/** How long running jobs get to finish when the worker stops. */
export const SHUTDOWN_TIMEOUT_MS = 20_000

export interface StartWorkerOptions {
  readonly logger: Logger
  /** The jobs to run. Default: the list in jobs/index.ts. Tests pass their own. */
  readonly jobs?: readonly JobDefinition[]
  /**
   * False for a worker beside the deployment's own on the same queue (the e2e pay harness): it
   * leaves the schedules alone (registry.ts). Default true.
   */
  readonly schedules?: boolean
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
  const now = options.now ?? (() => new Date())
  const version = options.version ?? WORKER_VERSION
  const status = new WorkerStatus()

  let health: HealthServer | undefined
  let pool: DbPool | undefined
  let boss: PgBoss | undefined
  let poller: Poller | undefined

  /** Closes whatever was opened. Every step runs; the first failure is rethrown at the end. */
  async function closeAll(graceful: boolean): Promise<void> {
    health?.setRevealHandler(null)
    const failures: unknown[] = []
    const attempt = async (what: string, close: () => Promise<unknown>) => {
      try {
        await close()
      } catch (error) {
        failures.push(error)
        log.error({ err: error }, `could not close ${what}`)
      }
    }
    if (poller) await attempt('the Telegram poll', () => (poller as Poller).stop())
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
    // Before anything is opened: a bad asset store setting stops the start here.
    const jobs = options.jobs ?? (await buildJobs(config, log))
    health = await startHealthServer(config.healthPort, () => status.report(now()))

    pool = createPool(config.databaseUrl, {
      max: APP_POOL_MAX,
      applicationName: 'restro-worker',
      onIdleError: (error) => log.error({ err: error }, 'idle database connection failed'),
    })
    await withSystem(pool, async () => undefined)

    boss = new PgBoss({
      connectionString: config.databaseUrl,
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
      queue: boss,
    }
    await registerJobs(boss, jobs, context, { schedules: options.schedules ?? true })
    if (jobs.some((job) => job.name === WORKER_HEARTBEAT_JOB)) {
      await boss.send(WORKER_HEARTBEAT_JOB, {})
    }
    if (jobs.some((job) => job.name === JOB_NAMES.sealTableCodes)) {
      await boss.send(JOB_NAMES.sealTableCodes, {})
    }
    // The payment recovery (#112) runs at once: a payment a dead worker left goes on now.
    if (jobs.some((job) => job.name === JOB_NAMES.paymentRecoveryTick)) {
      await boss.send(JOB_NAMES.paymentRecoveryTick, {})
    }
    if (config.revealToken !== null && config.seal !== null) {
      const deps = { pool, privateKey: config.seal.privateKey }
      health.setRevealHandler({
        token: config.revealToken,
        reveal: (request) => reveal(deps, request),
        failed: (error) => log.error({ err: error }, 'a reveal failed'),
      })
    } else if (config.revealToken !== null) {
      log.warn('REVEAL_SERVICE_TOKEN is set without the seal keys: the reveal endpoint is off')
    }
    // "Done" from the venue's Telegram group (#83): long polling, so no public endpoint.
    const telegramToken = config.alerts?.telegramToken ?? null
    if (telegramToken !== null) {
      poller = startTelegramPoller({
        pool,
        telegram: createTelegramClient({ token: telegramToken }),
        log,
        now,
      })
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
