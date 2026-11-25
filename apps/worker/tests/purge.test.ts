// The purge (D83, D96, D91): Postgres with both roles, a local publish store, the real purge
// functions and the jobs' handlers. A deleted venue is erased with its own rows and files, its
// code and tokens are tombstoned, what another venue uses stays and the till's places survive;
// a live venue is refused; old versions go by the rule; a binned menu, deleted tables and the
// old change log go after their time. Skipped without a database or the purge role.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  currentPath,
  LocalPublishStore,
  readOrganizationFile,
  snapshotPath,
  tableTokenPath,
  venueIndexPath,
} from '@restro/assets'
import {
  type ChangeSet,
  JOB_NAMES,
  type NodeId,
  newId,
  prepareJob,
  type VenueId,
} from '@restro/core'
import {
  apply,
  archiveVenue,
  createArea,
  createMenu,
  createTable,
  deleteMenu,
  deleteTable,
  issueAllTableTokens,
  listVenueTables,
  provisionMenu,
  provisionVenue,
  publishMenu,
  upsertPlaces,
} from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type { Job } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPublishJobs } from '../src/jobs/publish'
import {
  createPurgeJobs,
  purgeChangeLog,
  purgeMenu,
  purgeTables,
  purgeVenue,
  purgeVersions,
} from '../src/jobs/purge'
import type { JobDefinition } from '../src/jobs/types'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, DEMO_BID, type World } from './world'

allowSlowSetup()

const hasPurge =
  hasDatabase && (process.env.DATABASE_PURGE_PASSWORD || process.env.DATABASE_URL_PURGE)

describe.skipIf(!hasPurge)('the purge (as the restro_purge role)', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let root: string
  let store: LocalPublishStore
  let purgePool: DbPool
  let jobs: Map<string, JobDefinition>
  /** An item both venues place: it must survive the purge of either. */
  let sharedItem: NodeId
  /** An item only the world's venue places: it goes with the venue. */
  let ownItem: NodeId

  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  async function change(ops: unknown[]) {
    const result = await apply(world.pool, world.tenantId, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet)
    expect(result.rejected).toEqual([])
  }
  /** A section with `items` in `menuId`; items not given are made here (name, price). */
  async function fill(menuId: string, items: NodeId[], create: NodeId[]) {
    const section = newId('nd')
    await change([
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: menuId },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', { bg_BG: 'Секция', en_US: 'Section' }),
      ...create.flatMap((id) => [
        { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
        manual(id, 'name', { bg_BG: `Артикул ${id.slice(-4)}`, en_US: `Item ${id.slice(-4)}` }),
        manual(id, 'price', { amount_minor: 700, currency: 'EUR' }),
        manual(id, 'allergens', []),
      ]),
      ...items.map((id) => ({
        op: 'setPlacement',
        item: { id },
        section: { id: section },
        sortKey: 'end',
      })),
    ])
  }
  async function runJob(name: string, data: object) {
    const job = jobs.get(name)
    if (!job) throw new Error(`no job ${name}`)
    const item = {
      id: newId('jb'),
      name,
      data,
      signal: new AbortController().signal,
      retryCount: 0,
    } as unknown as Job<object>
    await job.handler([item], world.context)
  }
  const publish = (menuId: string, venueId: string) =>
    runJob(
      JOB_NAMES.publishMenu,
      prepareJob(JOB_NAMES.publishMenu, {
        tenantId: world.tenantId,
        menuId,
        venueId,
        reason: 'manual',
        actor: 'user:us_test',
      }).data,
    )
  const countOf = async (table: string, where: string, params: unknown[]) =>
    Number(
      (
        await world.query<{ n: string }>(
          `select count(*) as n from restro.${table} where ${where}`,
          params,
        )
      )[0]?.n,
    )
  const scoped = () => ({ purgePool, pool: world.pool, store })
  /** Ages rows as the database owner: the app role may not touch these columns. */
  const asOwner = (statement: string, params: unknown[]) =>
    withOwnerClient(db.ownerUrl, (client) => client.query(statement, params))
  /** Ages snapshots: their guard trigger refuses every change, so it is off for the update. */
  const ageSnapshots = (ids: string[], days: number) =>
    withOwnerClient(db.ownerUrl, async (client) => {
      await client.query('alter table restro.snapshots disable trigger snapshots_guard_update')
      try {
        await client.query(
          'update restro.snapshots set created_at = now() - make_interval(days => $2) where id = any($1)',
          [ids, days],
        )
      } finally {
        await client.query('alter table restro.snapshots enable trigger snapshots_guard_update')
      }
    })

  beforeAll(async () => {
    db = await createTestDatabase()
    if (db.purgeUrl === null) throw new Error('no purge role')
    fake.listen()
    root = await mkdtemp(path.join(tmpdir(), 'restro-worker-purge-'))
    store = new LocalPublishStore({ rootDir: root })
    world = await createWorld(fake, { database: db })
    purgePool = createPool(db.purgeUrl, { max: 1, applicationName: 'restro-purge-tests' })
    jobs = new Map(
      [
        ...createPublishJobs({
          publishStore: store,
          assetStore: { get: async (key) => world.stored.get(key) ?? null },
        }),
        ...createPurgeJobs({ purgeDatabaseUrl: db.purgeUrl, publishStore: store }),
      ].map((job) => [job.name, job]),
    )
    sharedItem = newId('nd')
    ownItem = newId('nd')
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await purgePool?.end()
    await world?.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world?.close()
    fake.close()
    await db?.drop()
    await rm(root, { recursive: true, force: true })
  })

  it('erases a deleted venue: its rows, files, codes and tokens; what others use stays', async () => {
    // The world's venue (a till venue): one menu with a shared and an own item, two tables with
    // codes (from the till's places), published.
    const second = (
      await provisionVenue(world.pool, world.tenantId, { name: 'Second', slug: testSlug('second') })
    ).id
    const secondMenu = (await provisionMenu(world.pool, world.tenantId, second)).id
    await fill(world.menuId, [sharedItem, ownItem], [sharedItem, ownItem])
    await fill(secondMenu, [sharedItem], [])
    await upsertPlaces(
      world.pool,
      world.tenantId,
      world.integrationId,
      DEMO_BID,
      [
        { placeId: 'p1', placeNum: '1', salonName: 'Hall', isPublic: true },
        { placeId: 'p2', placeNum: '2', salonName: 'Hall', isPublic: true },
      ],
      { pagesOk: [true] },
    )
    await issueAllTableTokens(world.pool, world.tenantId, world.venueId, world.publicKeyText)
    const tokens = (await listVenueTables(world.pool, world.tenantId, world.venueId)).map(
      (table) => table.codeHash as string,
    )
    expect(tokens).toHaveLength(2)
    await publish(world.menuId, world.venueId)
    await runJob(JOB_NAMES.publishTableTokens, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      retired: [],
    })
    expect(await store.get(venueIndexPath(world.venuePublicId))).not.toBeNull()
    expect(await store.get(tableTokenPath(tokens[0] ?? ''))).not.toBeNull()
    const [snapshot] = await world.query<{ id: string }>(
      'select id from restro.snapshots where venue_id = $1',
      [world.venueId],
    )

    // Not deleted: nothing happens.
    expect(
      await purgeVenue(scoped(), { tenantId: world.tenantId, venueId: world.venueId }),
    ).toEqual({
      status: 'not_deleted',
    })
    expect(await purgeVenue(scoped(), { tenantId: world.tenantId, venueId: newId('vn') })).toEqual({
      status: 'missing',
    })

    await archiveVenue(world.pool, world.tenantId, world.venueId)
    const result = await purgeVenue(scoped(), { tenantId: world.tenantId, venueId: world.venueId })
    expect(result).toMatchObject({ status: 'purged', publicId: world.venuePublicId })
    if (result.status !== 'purged') throw new Error('not purged')
    expect([...result.tokens].sort()).toEqual([...tokens].sort())
    expect(result.counts).toMatchObject({ venues: 1, tables: 2, areas: 1, menus: 1, snapshots: 1 })

    // Rows: the venue, its menu, sections, own item and tables are gone; the shared item and the
    // second venue's menu stay; the till's places lost their tables but are still there.
    expect(await countOf('venues', 'id = $1', [world.venueId])).toBe(0)
    expect(await countOf('menus', 'venue_id = $1', [world.venueId])).toBe(0)
    expect(await countOf('nodes', 'id = $1', [ownItem])).toBe(0)
    expect(await countOf('nodes', 'id = $1', [sharedItem])).toBe(1)
    expect(await countOf('placements', 'item_id = $1', [sharedItem])).toBe(1)
    expect(await countOf('tables', 'venue_id = $1', [world.venueId])).toBe(0)
    expect(
      await countOf('places', 'integration_id = $1 and bid = $2 and table_id is null', [
        world.integrationId,
        DEMO_BID,
      ]),
    ).toBe(2)
    expect(await countOf('snapshots', 'venue_id = $1', [world.venueId])).toBe(0)
    expect(
      await countOf('tombstones', "kind = 'public_code' and value = $1", [world.venuePublicId]),
    ).toBe(1)
    expect(await countOf('tombstones', "kind = 'table_token' and value = any($1)", [tokens])).toBe(
      2,
    )
    const [log] = await world.query<{
      kind: string
      subject_id: string
      counts: Record<string, number>
    }>(
      "select kind, subject_id, counts from restro.purge_log where tenant_id = $1 and kind = 'venue'",
      [world.tenantId],
    )
    expect(log).toMatchObject({ kind: 'venue', subject_id: world.venueId })
    expect(log?.counts).toMatchObject({ venues: 1 })
    // Files: the venue's index, the table files, the pointer and the snapshot are gone; the
    // organisation's index no longer lists it.
    expect(await store.get(venueIndexPath(world.venuePublicId))).toBeNull()
    for (const token of tokens) expect(await store.get(tableTokenPath(token))).toBeNull()
    expect(
      await store.get(currentPath(world.menuId as NodeId, world.venueId as VenueId)),
    ).toBeNull()
    expect(await store.get(snapshotPath((snapshot?.id ?? '') as never))).toBeNull()
    const [organization] = await world.query<{ slug: string }>(
      'select slug from restro.auth_organization where id = $1',
      [world.tenantId],
    )
    const index = await readOrganizationFile(store, organization?.slug ?? '')
    expect(index && 'venues' in index ? index.venues : null).toEqual({})

    // The purge job itself answers the same way for a venue that is gone.
    await runJob(JOB_NAMES.purgeVenue, { tenantId: world.tenantId, venueId: world.venueId })
    const [run] = await world.query<{ status: string; error_summary: string | null }>(
      "select status, error_summary from restro.job_runs where tenant_id = $1 and kind = 'purge_venue' order by created_at desc limit 1",
      [world.tenantId],
    )
    expect(run).toMatchObject({ status: 'completed' })
    expect(run?.error_summary).toContain('missing')

    // A new venue never gets the tombstoned code (the draw is random; the tombstone is checked).
    const another = await provisionVenue(world.pool, world.tenantId, {
      name: 'Another',
      slug: testSlug('another'),
    })
    expect(another.publicId).not.toBe(world.venuePublicId)
  })

  it('purges versions by the rule (D96): the live one and the two newest young ones stay', async () => {
    const venueId = (
      await provisionVenue(world.pool, world.tenantId, {
        name: 'Versions',
        slug: testSlug('versions'),
      })
    ).id
    const menuId = (await provisionMenu(world.pool, world.tenantId, venueId)).id
    const item = newId('nd')
    await fill(menuId, [item], [item])
    const ids: string[] = []
    for (let version = 1; version <= 4; version++) {
      await change([manual(item, 'price', { amount_minor: 700 + version, currency: 'EUR' })])
      const published = await publishMenu(world.pool, world.tenantId, {
        menuId,
        venueId,
        reason: 'manual',
        actor: 'user:us_test',
      })
      ids.push(published.snapshot.id)
      await runJob(JOB_NAMES.publishFiles, { tenantId: world.tenantId, menuId, venueId })
    }
    // Versions 1 and 2 are 40 days old; 3 is 10 days old; 4 is live.
    await ageSnapshots(ids.slice(0, 2), 40)
    await ageSnapshots([ids[2] ?? ''], 10)
    for (const id of ids) expect(await store.get(snapshotPath(id as never))).not.toBeNull()

    const result = await purgeVersions(scoped(), {
      tenantId: world.tenantId,
      venueId,
      menuId,
      now: new Date(),
    })
    expect(result).toEqual({ purged: 2 })
    const left = (
      await world.query<{ id: string }>('select id from restro.snapshots where menu_id = $1', [
        menuId,
      ])
    ).map((row) => row.id)
    expect(left.sort()).toEqual([ids[2], ids[3]].sort())
    expect(await store.get(snapshotPath((ids[0] ?? '') as never))).toBeNull()
    expect(await store.get(snapshotPath((ids[3] ?? '') as never))).not.toBeNull()
    // Again: nothing more to do.
    expect(
      await purgeVersions(scoped(), { tenantId: world.tenantId, venueId, menuId, now: new Date() }),
    ).toEqual({ purged: 0 })
  })

  it('purges a binned menu, deleted tables after their time, and the change log past two months', async () => {
    const venueId = (
      await provisionVenue(world.pool, world.tenantId, { name: 'Bins', slug: testSlug('bins') })
    ).id
    const live = (await provisionMenu(world.pool, world.tenantId, venueId)).id
    const created = await createMenu(world.pool, world.tenantId, { venueId, name: 'Late' })
    if (!created.ok) throw new Error('no second menu')
    const binned = created.menu.id
    const item = newId('nd')
    await fill(binned, [item], [item])
    expect(await deleteMenu(world.pool, world.tenantId, { venueId, menuId: binned })).toMatchObject(
      { ok: true },
    )
    expect(await purgeMenu(scoped(), { tenantId: world.tenantId, venueId, menuId: live })).toEqual({
      status: 'not_binned',
    })
    expect(
      await purgeMenu(scoped(), { tenantId: world.tenantId, venueId, menuId: binned }),
    ).toMatchObject({
      status: 'purged',
    })
    expect(await countOf('menus', 'id = $1', [binned])).toBe(0)
    expect(await countOf('nodes', 'id = $1', [item])).toBe(0)
    expect(await countOf('menus', 'id = $1', [live])).toBe(1)

    // A hand-made table, coded, deleted: purged once it waited 30 days; its code is tombstoned.
    const area = await createArea(world.pool, world.tenantId, venueId, 'Garden')
    if (!area.ok) throw new Error('no area')
    const table = await createTable(world.pool, world.tenantId, {
      areaId: area.area.id,
      name: null,
      number: '9',
    })
    if (!table.ok) throw new Error('no table')
    await issueAllTableTokens(world.pool, world.tenantId, venueId, world.publicKeyText)
    const [coded] = await listVenueTables(world.pool, world.tenantId, venueId)
    const token = coded?.codeHash as string
    expect(await deleteTable(world.pool, world.tenantId, table.table.id)).toMatchObject({
      ok: true,
      retired: [token],
    })
    expect(
      await purgeTables(scoped(), { tenantId: world.tenantId, venueId, now: new Date() }),
    ).toEqual({ tables: 0, areas: 0 })
    await asOwner(
      "update restro.tables set archived_at = now() - interval '31 days' where id = $1",
      [table.table.id],
    )
    expect(
      await purgeTables(scoped(), { tenantId: world.tenantId, venueId, now: new Date() }),
    ).toEqual({ tables: 1, areas: 0 })
    expect(await countOf('tables', 'id = $1', [table.table.id])).toBe(0)
    expect(await countOf('tombstones', "kind = 'table_token' and value = $1", [token])).toBe(1)

    // The change log: an event of the venue's item, aged past two months, goes; a young one stays.
    const young = await countOf('events', 'tenant_id = $1', [world.tenantId])
    expect(young).toBeGreaterThan(0)
    await asOwner(
      "update restro.events set at = now() - interval '70 days' where tenant_id = $1 and node_id = $2",
      [world.tenantId, sharedItem],
    )
    const aged = await countOf('events', 'tenant_id = $1 and node_id = $2', [
      world.tenantId,
      sharedItem,
    ])
    expect(aged).toBeGreaterThan(0)
    expect(await purgeChangeLog(scoped(), { tenantId: world.tenantId, now: new Date() })).toEqual({
      events: aged,
    })
    expect(await countOf('events', 'tenant_id = $1', [world.tenantId])).toBe(young - aged)

    // The daily tick runs it all once more and records a run per organisation.
    await runJob(JOB_NAMES.purgeTick, {})
    const [run] = await world.query<{ status: string }>(
      "select status from restro.job_runs where tenant_id = $1 and kind = 'purge_tick' order by created_at desc limit 1",
      [world.tenantId],
    )
    expect(run).toMatchObject({ status: 'completed' })
  })
})
