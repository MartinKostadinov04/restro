// Fixtures for the Tables & QR tab's end-to-end test (brief S3-07). Run by the test itself:
//
//   seed     the demo venue gets a barsy venue (if it has none) with eight tables in four halls
//            (`Главна зала`, `Тераса`, `VIP зона` and one with no hall), no codes, no names and the
//            default QR address, the areas called what the till calls them, the tables shown or
//            hidden as the till says and in the till's order; the token files of any codes an earlier run made are removed; and
//            the job queue the tab sends to exists (pg-boss tables and the queue, as the worker would
//            create them). Idempotent.
//   worker   waits for the REAL worker, which runs beside the e2e servers (since S3-05), to take
//            every waiting `publish-table-tokens` job, then prints one JSON line per job it
//            finished since the last call (what the tab asked for, and what the publish folder
//            now holds: files written for the venue's codes, retired codes whose file is gone), so
//            that the test can check it. If no worker takes the jobs within 30 s it runs the real
//            `writeTableTokenFiles` itself, as before.
//
//   serve    the `worker` command kept running: a `worker` line on stdin is answered as `worker`
//            answers, then `{"done":true}`. The test starts it once, so a call skips the seconds
//            the script takes to load.
//
//   second-menu         the demo venue gets a second, published menu ("Late night") so that a menu
//                       route (S5) has something to point at, and prints its id. The venue has a
//                       till, so the menu is made with the owner's SQL, then filled and published
//                       the real way (`apply`, `publishMenu`).
//   second-menu-remove  takes that menu and everything it made away again, so that the other
//                       specs see the demo venue with its one menu. Both are idempotent, and `seed`
//                       does the removal too and clears the venue's menu routes.
//   areas-restore       puts the areas back under the till's names and shows them (what `seed` does
//                       for them, alone), for the test's `afterAll`.
//
// Like the other seeds it refuses to run unless NODE_ENV is development and the database is on
// this machine.
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'

import {
  createPublishStore,
  publishStoreConfig,
  readTableTokenFile,
  tableTokenPath,
} from '@restro/assets'
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

/**
 * The areas under the names the till gave them (the source key is `name:<hall>`, or `none` for the
 * tables in no hall, which the tab calls "Tables"): a test that renamed or hid one and did not get to
 * put it back (a timeout) would otherwise leave it for the next attempt and for the other specs.
 */
async function restoreAreas(owner: pg.Pool, venueId: string): Promise<void> {
  await owner.query(
    `update restro.areas
        set name = case when source_key = 'none' then 'Tables' else substr(source_key, 6) end,
            hidden = false
      where venue_id = $1 and archived_at is null
        and (source_key = 'none' or source_key like 'name:%')`,
    [venueId],
  )
}

/** `areas-restore`: only that, for the test's `afterAll` (the test's own page may be gone by then). */
async function areasRestore(): Promise<void> {
  assertDevEnvironment(process.env)
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-tables-e2e needs DATABASE_URL_OWNER (see .env.example).')
  const { venueId } = await demo()
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await restoreAreas(owner, venueId)
  } finally {
    await owner.end()
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
    // A file is named after the code's hash; one from before #70 after the code itself.
    const old = await owner.query<{ qr_token: string | null; qr_code_hash: string }>(
      'select qr_token, qr_code_hash from restro.tables where tenant_id = $1 and qr_code_hash is not null',
      [tenantId],
    )
    for (const row of old.rows) {
      for (const name of [row.qr_code_hash, row.qr_token]) {
        if (name !== null) await store.delete(tableTokenPath(name))
      }
    }
    await owner.query(
      `update restro.tables set qr_token = null, qr_code_hash = null, qr_code_sealed = null,
                                name = null
       where venue_id = $1`,
      [venueId],
    )
    await owner.query(`update restro.venues set settings = settings - 'qr' where id = $1`, [
      venueId,
    ])
    await restoreAreas(owner, venueId)
    // Hidden follows the till (`is_public`): the manager's hidden flag outlives a sync, so a test
    // that hid a table and then failed would leave it hidden for the next attempt.
    await owner.query(
      `update restro.tables t set hidden = not p.is_public
         from restro.places p
        where p.table_id = t.id and t.venue_id = $1 and t.hidden <> not p.is_public`,
      [venueId],
    )
    // Tables go back to the till's order within their area (by number): a failure between a move
    // up and its move down leaves two swapped. Each table takes the existing key whose rank by key
    // equals its own rank by number; one statement, as `sort_key` has no unique index.
    await owner.query(
      `with ranked as (
         select id, area_id, sort_key,
                row_number() over (partition by area_id order by sort_key, id) as by_key,
                row_number() over (partition by area_id order by number collate "C", id) as by_number
           from restro.tables where venue_id = $1
       )
       update restro.tables t set sort_key = k.sort_key
         from ranked n join ranked k on k.area_id = n.area_id and k.by_key = n.by_number
        where t.id = n.id and t.sort_key <> k.sort_key`,
      [venueId],
    )
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

/**
 * Do the venue's files in the store say what its codes say (name and menu of every code that has a
 * file), and are the codes the finished jobs retired gone? True when the store has caught up.
 */
async function filesLanded(
  queue: pg.Pool,
  store: Awaited<ReturnType<typeof createPublishStore>>,
  since: Date,
): Promise<boolean> {
  const { tenantId, venueId } = await demo()
  const wanted = await loadTokenFiles(getPool(), tenantId, venueId)
  if (wanted === null || wanted.archived || wanted.unpublished) return true
  const active = new Set<string>()
  for (const file of wanted.files) {
    active.add(file.codeHash)
    const stored = await readTableTokenFile(store, file.codeHash)
    if (stored === null || stored.table_label !== file.tableLabel) return false
    if ((stored.menu_id ?? null) !== file.menuId) return false
  }
  const { rows } = await queue.query<{ data: unknown }>(
    `select data from pgboss.job where name = $1 and state = 'completed' and completed_on > $2`,
    [JOB_NAMES.publishTableTokens, since],
  )
  for (const row of rows) {
    for (const name of PublishTableTokensJobSchema.parse(row.data).retired) {
      if (!active.has(name) && (await store.get(tableTokenPath(name))) !== null) return false
    }
  }
  return true
}

async function worker(): Promise<void> {
  assertDevEnvironment(process.env)
  const queue = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const store = await createPublishStore(publishStoreConfig(process.env))
  try {
    const since = readMark()
    // The real worker takes the jobs (polling every second): wait until none is waiting or running
    // and the files in the store are what the database says (a job can still be on its way to the
    // store when the queue looks empty, and the test reads the files next).
    const deadline = Date.now() + 30_000
    const landedBy = Date.now() + 10_000
    for (;;) {
      const waiting = await queue.query<{ n: number }>(
        `select count(*)::int as n from pgboss.job where name = $1 and state in ('created', 'retry', 'active')`,
        [JOB_NAMES.publishTableTokens],
      )
      if ((waiting.rows[0]?.n ?? 0) === 0) {
        if ((await filesLanded(queue, store, since)) || Date.now() > landedBy) break
      } else if (Date.now() > deadline) {
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
        if ((await store.get(tableTokenPath(file.codeHash))) !== null) written += 1
      }
      let removed = 0
      for (const name of payload.retired) {
        if ((await store.get(tableTokenPath(name))) === null) removed += 1
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

/**
 * Stays running and answers each `worker` line on stdin with what the `worker` command prints,
 * then `{"done":true}` (after `{"error":…}` if it failed), so that a test does not pay the start-up
 * of the platform's code (several seconds) on every call. Ends when stdin does.
 */
async function serve(): Promise<void> {
  assertDevEnvironment(process.env)
  console.log(JSON.stringify({ ready: true }))
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() !== 'worker') continue
    try {
      await worker()
    } catch (error) {
      console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    console.log(JSON.stringify({ done: true }))
  }
  process.exit(0)
}

const commands = {
  seed,
  worker,
  serve,
  'second-menu': secondMenu,
  'second-menu-remove': secondMenuRemove,
  'areas-restore': areasRestore,
} as const
const command = process.argv[2] as keyof typeof commands | undefined

if (command === undefined || !(command in commands)) {
  console.error(
    'usage: seed-tables-e2e.ts seed|worker|serve|second-menu|second-menu-remove|areas-restore',
  )
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
