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
//   second-menu         the demo venue gets a second, published menu ("Late night") so that a menu
//                       route (S5) has something to point at, and prints its id. The venue has a
//                       till, so the menu is made with the owner's SQL, then filled and published
//                       the real way (`apply`, `publishMenu`).
//   second-menu-remove  takes that menu and everything it made away again, so that the other
//                       specs see the demo venue with its one menu. Both are idempotent, and `seed`
//                       does the removal too and clears the venue's menu routes.
//
// Like the other seeds it refuses to run unless NODE_ENV is development and the database is on
// this machine.
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createPublishStore, publishStoreConfig, tableTokenPath } from '@restro/assets'
import {
  type ChangeSet,
  JOB_NAMES,
  newId,
  PublishTableTokensJobSchema,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'
import {
  apply,
  loadTokenFiles,
  mapBarsyVenue,
  publishMenu,
  upsertBarsyVenues,
  upsertPlaces,
} from '@restro/core/apply'
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
      'select qr_token from restro.tables where tenant_id = $1 and qr_token is not null',
      [tenantId],
    )
    for (const { qr_token } of old.rows) await store.delete(tableTokenPath(qr_token))
    await owner.query('update restro.tables set qr_token = null, name = null where venue_id = $1', [
      venueId,
    ])
    await owner.query(`update restro.venues set settings = settings - 'qr' where id = $1`, [
      venueId,
    ])
    // No menu routes of an earlier run, and no second menu left behind by one that failed.
    await removeSecondMenu(owner)
    await owner.query('delete from restro.menu_routes where venue_id = $1', [venueId])
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

/** Fixed ids of the second menu, its section and its drink, so that it can be found and removed. */
const nodeId = (name: string) => `nd_${name.padEnd(22, '0')}`
const SECOND = {
  menu: nodeId('E2eTablesLateMenu'),
  section: nodeId('E2eTablesLateSection'),
  item: nodeId('E2eTablesLateDrink'),
}
const SECOND_NODES = [SECOND.item, SECOND.section, SECOND.menu]

/** Takes the second menu away with everything it made (the owner role: the app role cannot). */
async function removeSecondMenu(owner: pg.Pool): Promise<void> {
  await owner.query('delete from restro.item_first_published where menu_id = $1', [SECOND.menu])
  await owner.query('delete from restro.menu_routes where menu_id = $1', [SECOND.menu])
  await owner.query('delete from restro.publish_pointers where menu_id = $1', [SECOND.menu])
  await owner.query('delete from restro.snapshots where menu_id = $1', [SECOND.menu])
  await owner.query(
    'delete from restro.placements where item_id = any($1) or section_id = any($1)',
    [SECOND_NODES],
  )
  await owner.query('delete from restro.field_values where node_id = any($1)', [SECOND_NODES])
  await owner.query('delete from restro.events where node_id = any($1)', [SECOND_NODES])
  await owner.query('delete from restro.menus where id = $1', [SECOND.menu])
  // Children first: the drink, the section, then the menu's root.
  for (const id of SECOND_NODES) await owner.query('delete from restro.nodes where id = $1', [id])
}

async function secondMenu(): Promise<void> {
  assertDevEnvironment(process.env)
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-tables-e2e needs DATABASE_URL_OWNER (see .env.example).')
  const { tenantId, venueId } = await demo()
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await removeSecondMenu(owner)
    await owner.query(
      `insert into restro.nodes (id, tenant_id, node_type, parent_id) values ($1, $2, 'menu', null)`,
      [SECOND.menu, tenantId],
    )
    await owner.query(
      `insert into restro.menus (id, tenant_id, venue_id, template_key, template_version, root_node_id, name, sort_key)
       values ($1, $2, $3, $4, $5, $1, 'Late night', 'a9')`,
      [SECOND.menu, tenantId, venueId, VENUE_MENU_TEMPLATE.key, VENUE_MENU_TEMPLATE.version],
    )
  } finally {
    await owner.end()
  }
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const result = await apply(getPool(), tenantId, {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'system',
    observedAt: new Date().toISOString(),
    ops: [
      {
        op: 'createNode',
        id: SECOND.section,
        nodeType: 'section',
        parent: { id: SECOND.menu },
        status: 'active',
        sortKey: 'end',
      },
      manual(SECOND.section, 'title', { bg_BG: 'Нощно меню', en_US: 'Late night' }),
      { op: 'createNode', id: SECOND.item, nodeType: 'item', parent: null, status: 'active' },
      manual(SECOND.item, 'name', { bg_BG: 'Еспресо мартини', en_US: 'Espresso martini' }),
      manual(SECOND.item, 'price', { amount_minor: 1100, currency: 'EUR' }),
      manual(SECOND.item, 'allergens', []),
      {
        op: 'setPlacement',
        item: { id: SECOND.item },
        section: { id: SECOND.section },
        sortKey: 'end',
      },
    ],
  } as ChangeSet)
  if (result.rejected.length > 0) {
    throw new Error(`the second menu was rejected: ${JSON.stringify(result.rejected)}`)
  }
  await publishMenu(getPool(), tenantId, {
    menuId: SECOND.menu,
    venueId,
    reason: 'manual',
    actor: 'system',
  })
  console.log(JSON.stringify({ event: 'second_menu', menuId: SECOND.menu }))
}

async function secondMenuRemove(): Promise<void> {
  assertDevEnvironment(process.env)
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-tables-e2e needs DATABASE_URL_OWNER (see .env.example).')
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await removeSecondMenu(owner)
  } finally {
    await owner.end()
  }
  console.log(JSON.stringify({ event: 'second_menu_removed' }))
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

const commands = {
  seed,
  worker,
  'second-menu': secondMenu,
  'second-menu-remove': secondMenuRemove,
} as const
const command = process.argv[2] as keyof typeof commands | undefined

if (command === undefined || !(command in commands)) {
  console.error('usage: seed-tables-e2e.ts seed|worker|second-menu|second-menu-remove')
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
