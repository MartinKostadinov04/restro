// Drives a running worker through one barsy sync, the way the web app will (S2-05): makes a
// tenant with a venue and an integration whose credentials are sealed with the worker's PUBLIC
// key, queues `barsy-connect`, maps the venue to the demo's catalogue root, queues a full pull,
// waits for the photos, runs the full pull again (all no-ops) and an incremental run, and prints
// what ended up in the database. Run it while the worker runs (see fake-barsy-preload.ts):
//
//   SEAL_PUBLIC_KEY=... DATABASE_URL=<restro_app> DATABASE_URL_OWNER=<owner> \
//     pnpm --filter @restro/worker exec tsx tests/manual/drive.ts
//
// It uses the owner connection only for the two things the Integration tab (S2-05) will do
// through its own writer: mapping the venue and listing the organisation.

import { randomBytes } from 'node:crypto'

import { JOB_NAMES, newId, prepareJob } from '@restro/core'
import {
  createIntegration,
  provisionMenu,
  provisionTenant,
  provisionVenue,
} from '@restro/core/apply'
import { parseSealPublicKey, sealBarsyCredentials } from '@restro/core/seal'
import { createPool } from '@restro/db'
import pg from 'pg'
import { PgBoss } from 'pg-boss'

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const appUrl = need('DATABASE_URL')
const ownerUrl = need('DATABASE_URL_OWNER')
const publicKey = parseSealPublicKey(need('SEAL_PUBLIC_KEY'))
const password = process.env.MANUAL_BARSY_PASSWORD ?? 'demo-password'
const HOST = 'demo.barsyonline.com'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const owner = new pg.Client({ connectionString: ownerUrl })
await owner.connect()
const rows = async <T extends object>(sql: string, values: unknown[] = []) =>
  (await owner.query(sql, values)).rows as T[]

async function until<T>(what: string, check: () => Promise<T | undefined>, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await check()
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(500)
  }
}

const pool = createPool(appUrl, { max: 2, applicationName: 'restro-manual-drive' })
const boss = new PgBoss({
  connectionString: appUrl,
  schema: 'pgboss',
  createSchema: false,
  migrate: false,
  supervise: false,
  schedule: false,
  max: 1,
})
await boss.start()

const tenantId = newId('tn')
await provisionTenant(pool, { tenantId, name: 'Manual run club' })
const venue = await provisionVenue(pool, tenantId, {
  name: 'Manual run venue',
  slug: `manual-${randomBytes(3).toString('hex')}`,
})
await provisionMenu(pool, tenantId, venue.id)
const integrationId = newId('in')
await createIntegration(pool, tenantId, {
  kind: 'barsy',
  host: HOST,
  id: integrationId,
  credentialsSealed: sealBarsyCredentials(
    { user: 'demo', password },
    { tenantId, integrationId, host: HOST, publicKey },
  ),
})
await owner.query(`insert into restro.auth_organization (id, name, slug) values ($1, $2, $3)`, [
  tenantId,
  'Manual run club',
  `manual-${randomBytes(3).toString('hex')}`,
])
console.log(`[drive] tenant ${tenantId}, integration ${integrationId}, venue ${venue.id}`)

async function send(
  name:
    | typeof JOB_NAMES.barsyConnect
    | typeof JOB_NAMES.barsyFullPull
    | typeof JOB_NAMES.barsyIncremental,
  data: object,
): Promise<string | null> {
  // The same validation and singleton key the web app's enqueueJob uses.
  const job = prepareJob(name as typeof JOB_NAMES.barsyFullPull, data)
  // The worker creates the queues when it starts: wait for them.
  return until(`queue ${name}`, async () => {
    try {
      return (await boss.send(name, job.data, { singletonKey: job.singletonKey })) ?? 'dropped'
    } catch {
      return undefined
    }
  })
}

const runsOf = (kind: string) =>
  rows<{ status: string }>(
    `select status from restro.job_runs where integration_id = $1 and kind = $2 order by created_at`,
    [integrationId, kind],
  )
const waitForRuns = async (kind: string, count: number) =>
  until(`${count} ${kind} run(s)`, async () => {
    const runs = await runsOf(kind)
    return runs.filter((run) => run.status !== 'running').length >= count ? runs : undefined
  })

// 1. connect
await send(JOB_NAMES.barsyConnect, { tenantId, integrationId })
await waitForRuns('barsy_connect', 1)
const [integration] = await rows<{ status: string; status_detail: string | null }>(
  'select status, status_detail from restro.integrations where id = $1',
  [integrationId],
)
console.log(`[drive] connect: status ${integration?.status}, detail ${integration?.status_detail}`)

// 2. map the venue (the Integration tab will do this) and pull
await owner.query(
  `update restro.barsy_venues set venue_id = $1, catalogue_root_cat_id = 1091
   where integration_id = $2 and bid = 10`,
  [venue.id, integrationId],
)
const payload = { tenantId, integrationId, venueId: venue.id }
await send(JOB_NAMES.barsyFullPull, payload)
await waitForRuns('barsy_full_pull', 1)

// 3. photos
await until('the photo jobs', async () => {
  const [open] = await rows<{ n: string }>(
    `select count(*) as n from pgboss.job where name = 'asset-fetch' and state < 'completed'`,
  )
  const [done] = await rows<{ n: string }>(
    `select count(*) as n from restro.job_runs where integration_id = $1 and kind = 'asset_fetch'`,
    [integrationId],
  )
  return Number(open?.n) === 0 && Number(done?.n) > 0 ? true : undefined
})

// 4. the same pull again, then an incremental run
await sleep(1500)
await send(JOB_NAMES.barsyFullPull, payload)
await waitForRuns('barsy_full_pull', 2)
await sleep(1500)
await send(JOB_NAMES.barsyIncremental, payload)
await waitForRuns('barsy_incremental', 1)

// What is in the database now.
console.log('\n[drive] job runs')
console.table(
  await rows(
    `select kind, status, counters, error_summary from restro.job_runs
     where integration_id = $1 order by created_at`,
    [integrationId],
  ),
)
console.log('[drive] nodes by type')
console.table(
  await rows(
    `select node_type, count(*) from restro.nodes where tenant_id = $1 group by 1 order by 1`,
    [tenantId],
  ),
)
console.log('[drive] links by state')
console.table(
  await rows(
    `select external_type, state, count(*) from restro.source_links where integration_id = $1
     group by 1, 2 order by 1, 2`,
    [integrationId],
  ),
)
console.log('[drive] photos')
console.table(
  await rows(
    `select (select count(*) from restro.assets where tenant_id = $1) as assets,
            (select count(*) from restro.field_values where tenant_id = $1 and field_key = 'image' and layer = 'till') as items_with_till_photo`,
    [tenantId],
  ),
)
console.log('[drive] sync state')
console.log(
  JSON.stringify(
    (
      await rows<{ config: { sync: unknown } }>(
        'select config from restro.integrations where id = $1',
        [integrationId],
      )
    )[0]?.config.sync,
    null,
    2,
  ),
)

await boss.stop({ graceful: false })
await pool.end()
await owner.end()
