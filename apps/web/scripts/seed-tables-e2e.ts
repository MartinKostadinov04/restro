// Fixtures for the Tables & QR tab's end-to-end test (brief S3-07). Run by the test itself:
//
//   seed     the demo venue gets a barsy venue (if it has none) with eight tables in four halls
//            (`Главна зала`, `Тераса`, `VIP зона` and one with no hall), no codes, no names and the
//            default QR address; the token files of any codes an earlier run made are removed; and
//            the job queue the tab sends to exists (pg-boss tables and the queue, as the worker would
//            create them). Idempotent.
//   worker   waits for the REAL worker, which runs beside the e2e servers (since S3-05), to take
//            every waiting `publish-table-tokens` job, then prints one JSON line per job it
//            finished since the last call (what the tab asked for, and what the publish folder
//            now holds: files written for the venue's codes, retired codes whose file is gone), so
//            that the test can check it. If no worker takes the jobs within 30 s it runs the real
//            `writeTableTokenFiles` itself, as before.
//
// Like the other seeds it refuses to run unless NODE_ENV is development and the database is on
// this machine.
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createPublishStore, publishStoreConfig, tableTokenPath } from '@restro/assets'
import { JOB_NAMES, PublishTableTokensJobSchema } from '@restro/core'
import { loadTokenFiles, mapBarsyVenue, upsertBarsyVenues, upsertPlaces } from '@restro/core/apply'
import { authOrganization, barsyVenues, integrations, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import pg from 'pg'
import { PgBoss } from 'pg-boss'

import { writeTableTokenFiles } from '../../worker/src/publish/table-tokens'
import { getAuthDb, getPool } from '../src/server/db'
import { assertDevEnvironment } from './lib/guard'

const BID = 77
const PLACES = [
  { placeId: '9001', placeNum: '1', salonName: 'Главна зала', isPublic: true },
  { placeId: '9002', placeNum: '2', salonName: 'Главна зала', isPublic: true },
  { placeId: '9003', placeNum: '3', salonName: 'Главна зала', isPublic: true },
  { placeId: '9004', placeNum: '4', salonName: 'Главна зала', isPublic: false },
  { placeId: '9005', placeNum: '5', salonName: 'Тераса', isPublic: true },
  { placeId: '9006', placeNum: '6', salonName: 'Тераса', isPublic: true },
  { placeId: '9007', placeNum: 'VIP 1', salonName: 'VIP зона', isPublic: true },
  { placeId: '9008', placeNum: 'Бар', salonName: null, isPublic: true },
] as const

async function demo(): Promise<{ tenantId: string; venueId: string }> {
  const [organization] = await getAuthDb()
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, 'demo-club'))
    .limit(1)
  if (!organization) throw new Error('Run `pnpm db:seed:dev` first: there is no demo organisation.')
  const [venue] = await withTenant(getPool(), organization.id, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, 'demo-club')).limit(1),
  )
  if (!venue) throw new Error('Run `pnpm db:seed:dev` first: there is no demo venue.')
  return { tenantId: organization.id, venueId: venue.id }
}

/** The pg-boss tables and the queue the tab sends to; the worker does this when it runs. */
async function ensureQueue(): Promise<void> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL as string,
    schema: 'pgboss',
    createSchema: false,
    migrate: true,
    supervise: false,
    schedule: false,
    max: 2,
    application_name: 'restro-e2e-seed',
  })
  boss.on('error', () => undefined)
  await boss.start()
  try {
    await boss.createQueue(JOB_NAMES.publishTableTokens, { policy: 'stately' })
  } finally {
    await boss.stop({ graceful: false })
  }
}

async function seed(): Promise<void> {
  assertDevEnvironment(process.env)
  writeFileSync(MARK_FILE, new Date().toISOString())
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-tables-e2e needs DATABASE_URL_OWNER (see .env.example).')
  const pool = getPool()
  const { tenantId, venueId } = await demo()

  // The barsy venue of the demo venue: the one it has, else a new one.
  const [existing] = await withTenant(pool, tenantId, (tx) =>
    tx.select().from(barsyVenues).where(eq(barsyVenues.venueId, venueId)),
  )
  let integrationId = existing?.integrationId
  let bid = existing?.bid ?? BID
  if (existing === undefined) {
    const [integration] = await withTenant(pool, tenantId, (tx) =>
      tx.select({ id: integrations.id }).from(integrations).limit(1),
    )
    if (!integration) throw new Error('The demo venue has no integration: run db:seed:dev first.')
    integrationId = integration.id
    bid = BID
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid, name: 'Demo tables' }])
    const mapped = await mapBarsyVenue(pool, tenantId, integrationId, bid, venueId)
    if (!mapped.ok) throw new Error(`could not map the barsy venue: ${mapped.error}`)
  }
  if (integrationId === undefined) throw new Error('no integration')
  await upsertPlaces(pool, tenantId, integrationId, bid, PLACES, { pagesOk: [true] })

  // A clean slate: no codes (and no files of earlier codes), no names, the default address.
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  const store = await createPublishStore(publishStoreConfig(process.env))
  try {
    const old = await owner.query<{ qr_token: string }>(
      'select qr_token from restro.places where tenant_id = $1 and qr_token is not null',
      [tenantId],
    )
    for (const { qr_token } of old.rows) await store.delete(tableTokenPath(qr_token))
    await owner.query(
      `update restro.places set qr_token = null, label = null
       where tenant_id = $1 and integration_id = $2 and bid = $3`,
      [tenantId, integrationId, bid],
    )
    await owner.query(`update restro.venues set settings = settings - 'qr' where id = $1`, [
      venueId,
    ])
    // Jobs left by an earlier run would be run by the stand-in for a venue state that is gone.
    await owner
      .query(`delete from pgboss.job where name = $1`, [JOB_NAMES.publishTableTokens])
      .catch(() => undefined)
  } finally {
    await owner.end()
  }
  await ensureQueue()
  console.log(
    JSON.stringify({ level: 'info', event: 'seed_tables_e2e_done', tables: PLACES.length }),
  )
}

/** When the last `worker` call reported (the jobs it printed finished before this); reset by `seed`. */
const MARK_FILE = path.join(os.tmpdir(), 'restro-e2e-tables-worker-mark')

function readMark(): Date {
  try {
    return new Date(readFileSync(MARK_FILE, 'utf8').trim())
  } catch {
    return new Date(0)
  }
}

async function worker(): Promise<void> {
  assertDevEnvironment(process.env)
  const queue = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const store = await createPublishStore(publishStoreConfig(process.env))
  try {
    const since = readMark()
    // The real worker takes the jobs (polling every second): wait until none is waiting or running.
    const deadline = Date.now() + 30_000
    for (;;) {
      const waiting = await queue.query<{ n: number }>(
        `select count(*)::int as n from pgboss.job where name = $1 and state in ('created', 'retry', 'active')`,
        [JOB_NAMES.publishTableTokens],
      )
      if ((waiting.rows[0]?.n ?? 0) === 0) break
      if (Date.now() > deadline) {
        await runWaitingJobsHere(queue, store)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const { rows } = await queue.query<{ data: unknown; completed_on: Date }>(
      `select data, completed_on from pgboss.job
       where name = $1 and state = 'completed' and completed_on > $2 order by completed_on, id`,
      [JOB_NAMES.publishTableTokens, since],
    )
    for (const row of rows) {
      const payload = PublishTableTokensJobSchema.parse(row.data)
      const wanted = await loadTokenFiles(getPool(), payload.tenantId, payload.venueId)
      let written = 0
      for (const file of wanted?.files ?? []) {
        if ((await store.get(tableTokenPath(file.token))) !== null) written += 1
      }
      let removed = 0
      for (const token of payload.retired) {
        if ((await store.get(tableTokenPath(token))) === null) removed += 1
      }
      console.log(
        JSON.stringify({
          job: JOB_NAMES.publishTableTokens,
          retired: payload.retired,
          result: { status: 'done', written, removed },
        }),
      )
    }
    const last = rows.at(-1)?.completed_on
    if (last) writeFileSync(MARK_FILE, last.toISOString())
  } finally {
    await queue.end()
  }
}

/** No worker took the jobs: run the real file writer here (the old stand-in), then mark them done. */
async function runWaitingJobsHere(
  queue: pg.Pool,
  store: Awaited<ReturnType<typeof createPublishStore>>,
): Promise<void> {
  const { rows } = await queue.query<{ id: string; data: unknown }>(
    `select id, data from pgboss.job where name = $1 and state < 'active' order by created_on, id`,
    [JOB_NAMES.publishTableTokens],
  )
  for (const row of rows) {
    const payload = PublishTableTokensJobSchema.parse(row.data)
    await writeTableTokenFiles({ pool: getPool(), store }, payload)
    await queue.query(
      `update pgboss.job set state = 'completed', completed_on = now() where id = $1`,
      [row.id],
    )
  }
}

const commands = { seed, worker } as const
const command = process.argv[2] as keyof typeof commands | undefined

if (command === undefined || !(command in commands)) {
  console.error('usage: seed-tables-e2e.ts seed|worker')
  process.exit(2)
}

commands[command]()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
