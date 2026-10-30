// A small world for the sync tests: a brand-new migrated database (tests/database.ts), a tenant
// with a venue and its menu, a barsy integration whose credentials are really sealed with a fresh
// key pair, a barsy venue mapped to ours with the demo's catalogue root, and a `SyncEnvironment`
// whose clock, queue and photo store are the test's own. The jobs run through their real handlers.

import { randomUUID } from 'node:crypto'
import { newId } from '@restro/core'
import {
  createIntegration,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { parseSealPublicKey, sealBarsyCredentials } from '@restro/core/seal'
import { generateSealKeyPair, parseSealPrivateKey } from '@restro/core/seal-open'
import { createPool, type DbPool } from '@restro/db'
import type { Job } from 'pg-boss'
import type { BarsyPolicy, SealKeys } from '../src/config'
import { APP_POOL_MAX } from '../src/connection'
import { WorkerStatus } from '../src/health'
import { createBarsyJobs } from '../src/jobs/barsy'
import type { JobDefinition, WorkerContext } from '../src/jobs/types'
import { createLogger } from '../src/logger'
import type { SyncEnvironment } from '../src/sync/context'
import { LimiterRegistry } from '../src/sync/limiter'
import { createTestDatabase, type TestDatabase, testSlug, withOwnerClient } from './database'
import type { FakeBarsy } from './fake-barsy'

export interface EnqueuedJob {
  readonly name: string
  readonly data: Record<string, unknown>
  readonly singletonKey: string | undefined
  readonly startAfter: number | undefined
}

export interface World {
  readonly db: TestDatabase
  readonly pool: DbPool
  readonly tenantId: string
  readonly venueId: string
  /** The venue's slug: `demo-club-` and a random suffix (slugs need not be unique, D68). */
  readonly venueSlug: string
  /** The venue's public code (D68): what its published files are keyed by. */
  readonly venuePublicId: string
  readonly menuId: string
  readonly integrationId: string
  readonly keys: SealKeys
  readonly publicKeyText: string
  readonly env: SyncEnvironment
  readonly context: WorkerContext
  readonly jobs: Map<string, JobDefinition>
  /** What the sync asked the queue to run. */
  readonly enqueued: EnqueuedJob[]
  /** Photo bytes by storage key. */
  readonly stored: Map<string, Uint8Array>
  readonly logLines: string[]
  /** The test's clock. */
  clock: Date
  query<Row extends object = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<Row[]>
  /** Runs a job's real handler with a payload. */
  run(name: string, data: object): Promise<void>
  close(): Promise<void>
}

/** The demo venue's till tree root ("Каса Kiosk"), the picker's choice of before D88. */
export const DEMO_ROOT_CAT = 1091
/** The demo venue's public menu root ("Публично меню", `public_cat_id`): a second menu (D88). */
export const DEMO_PUBLIC_CAT = 1171
export const DEMO_BID = 10

const POLICY: BarsyPolicy = {
  env: 'test',
  allowedHostSuffixes: ['.barsyonline.com'],
  productionHosts: ['live-club.barsyonline.com'],
}

export async function createWorld(
  fake: FakeBarsy,
  options: {
    readonly mapVenue?: boolean
    readonly database?: TestDatabase
    /** Connections of the app pool (default: the real worker's APP_POOL_MAX). */
    readonly poolMax?: number
    /** Pull locks the process may hold at once (default: the pool's size minus one). */
    readonly pullLocksMax?: number
    /** How long a full pull waits for a running pull before it is queued again (default 60 s). */
    readonly pullLockWaitMs?: number
    /** How often a waiting full pull asks again (default 2 s). */
    readonly pullLockPollMs?: number
    /**
     * Give the demo venue its public menu root as well (two menus, D88). Default: the till tree
     * only, as a venue mapped before D88 (the fake's venue list then reports no public menu).
     */
    readonly publicMenu?: boolean
  } = {},
): Promise<World> {
  const db = options.database ?? (await createTestDatabase())
  const poolMax = options.poolMax ?? APP_POOL_MAX
  const pool = createPool(db.appUrl, {
    applicationName: 'restro-worker-sync-tests',
    max: poolMax,
  })
  const pair = generateSealKeyPair()
  const keys: SealKeys = {
    publicKey: parseSealPublicKey(pair.publicKey),
    privateKey: parseSealPrivateKey(pair.privateKey),
  }

  const tenantId = newId('tn')
  await provisionTenant(pool, { tenantId, name: 'Sync test club' })
  // A slug of its own per world, so a test can tell its venue from another world's.
  const slug = testSlug('demo-club')
  const venue = await provisionVenue(pool, tenantId, { name: 'Demo club', slug })
  const menu = await provisionMenu(pool, tenantId, venue.id)

  const integrationId = newId('in')
  if (options.publicMenu !== true) {
    // As before D88: the venue list names no roots, so every venue reads the root the picker
    // chose (`catalogue_root_cat_id`), which the tests set and change themselves.
    fake.venues = fake.venues.map((venue) => ({ ...venue, cat_id: null, public_cat_id: null }))
  }
  const sealed = sealBarsyCredentials(
    { user: 'demo', password: fake.password },
    { tenantId, integrationId, host: fake.host, publicKey: pair.publicKey },
  )
  await createIntegration(pool, tenantId, {
    kind: 'barsy',
    host: fake.host,
    id: integrationId,
    credentialsSealed: sealed,
  })
  await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: DEMO_BID, name: 'Demo' }])
  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])
  if (options.mapVenue !== false) {
    await query(
      options.publicMenu === true
        ? `update restro.barsy_venues
             set venue_id = $1, catalogue_root_cat_id = $2, tree_cat_id = $2, public_cat_id = $5
           where integration_id = $3 and bid = $4`
        : `update restro.barsy_venues set venue_id = $1, catalogue_root_cat_id = $2
           where integration_id = $3 and bid = $4`,
      options.publicMenu === true
        ? [venue.id, DEMO_ROOT_CAT, integrationId, DEMO_BID, DEMO_PUBLIC_CAT]
        : [venue.id, DEMO_ROOT_CAT, integrationId, DEMO_BID],
    )
  }
  await query(`update restro.integrations set status = 'connected' where id = $1`, [integrationId])
  // The ticks list tenants from the organisation table (a system table).
  await query(
    `insert into restro.auth_organization (id, name, slug) values ($1, 'Sync test club', $2)`,
    [tenantId, `sync-${randomUUID().slice(0, 8)}`],
  )

  const logLines: string[] = []
  const log = await createLogger({
    level: 'debug',
    pretty: false,
    destination: { write: (line: string) => void logLines.push(line) },
  })
  const enqueued: EnqueuedJob[] = []
  const stored = new Map<string, Uint8Array>()
  // Real time at the start: the database stamps `state_changed_at` with its own clock, and the
  // grace-period tests move this clock forward from there.
  const world = { clock: new Date() } as { clock: Date }
  const send = async (
    name: string,
    data: object,
    options?: {
      singletonKey?: string
      startAfter?: number | undefined
      group?: { readonly id: string } | undefined
    },
  ) => {
    enqueued.push({
      name,
      data: data as Record<string, unknown>,
      singletonKey: options?.singletonKey,
      startAfter: options?.startAfter,
    })
    return `queued-${enqueued.length}`
  }
  const env: SyncEnvironment = {
    pool,
    log,
    now: () => world.clock,
    keys,
    policy: POLICY,
    limiters: new LimiterRegistry(),
    enqueue: send,
    store: {
      async put(key, bytes) {
        stored.set(key, bytes)
      },
    },
    fetch: (input, init) => fetch(input, init),
  }
  const context: WorkerContext = {
    pool,
    log,
    workerId: 'sync-tests',
    version: '0.0.0-test',
    now: () => world.clock,
    status: new WorkerStatus(),
    queue: { send },
  }
  const jobs = new Map(
    createBarsyJobs({
      keys,
      policy: POLICY,
      store: env.store,
      limiters: env.limiters,
      fetch: env.fetch,
      pullLocksMax: options.pullLocksMax ?? poolMax - 1,
      ...(options.pullLockWaitMs !== undefined ? { pullLockWaitMs: options.pullLockWaitMs } : {}),
      ...(options.pullLockPollMs !== undefined ? { pullLockPollMs: options.pullLockPollMs } : {}),
    }).map((job) => [job.name, job]),
  )

  return {
    db,
    pool,
    tenantId,
    venueId: venue.id,
    venueSlug: slug,
    venuePublicId: venue.publicId,
    menuId: menu.id,
    integrationId,
    keys,
    publicKeyText: pair.publicKey,
    env,
    context,
    jobs,
    enqueued,
    stored,
    logLines,
    get clock() {
      return world.clock
    },
    set clock(value: Date) {
      world.clock = value
    },
    query,
    async run(name, data) {
      const job = jobs.get(name)
      if (!job) throw new Error(`no job ${name}`)
      const item = {
        id: randomUUID(),
        name,
        data,
        signal: new AbortController().signal,
        retryCount: 0,
      } as unknown as Job<object>
      await job.handler([item], context)
    },
    async close() {
      await pool.end()
      // A database handed in belongs to whoever made it.
      if (options.database === undefined) await db.drop()
    },
  }
}
