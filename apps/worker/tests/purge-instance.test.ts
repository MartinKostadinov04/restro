// The purge of a removed POS instance (D91 point 2, D83): Postgres with both roles, the real
// `purgeInstance` and the daily tick. A removed instance's till layer, records and links go with
// the items that came only from it and no menu places and its sections that sit in no menu; an
// item a live venue places, and a section in a menu, stay without their link (when an item
// carries the instance's till values, the records they cite and
// the instance row stay until no menu uses it); an instance a venue links to is skipped; the
// tick picks an instance removed 31 days ago and leaves one removed yesterday. Skipped without a
// database or the purge role.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalPublishStore } from '@restro/assets'
import { type ChangeSet, JOB_NAMES, newId, tillSource } from '@restro/core'
import {
  appendSourceRecords,
  apply,
  createIntegration,
  createMenu,
  provisionMenu,
  provisionVenue,
  removeIntegration,
  upsertBarsyVenues,
  upsertPlaces,
} from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type { Job } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPurgeJobs, purgeInstance } from '../src/jobs/purge'
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
import { createWorld, type World } from './world'

allowSlowSetup()

const hasPurge =
  hasDatabase && (process.env.DATABASE_PURGE_PASSWORD || process.env.DATABASE_URL_PURGE)

describe.skipIf(!hasPurge)('the purge of a removed POS instance (as the restro_purge role)', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let root: string
  let store: LocalPublishStore
  let purgePool: DbPool
  let jobs: Map<string, JobDefinition>

  const scoped = () => ({ purgePool })
  const purge = (integrationId: string) =>
    purgeInstance(scoped(), { tenantId: world.tenantId, integrationId })
  const asOwner = (statement: string, params: unknown[]) =>
    withOwnerClient(db.ownerUrl, (client) => client.query(statement, params))
  const countOf = async (table: string, where: string, params: unknown[]) =>
    Number(
      (
        await world.query<{ n: string }>(
          `select count(*) as n from restro.${table} where ${where}`,
          params,
        )
      )[0]?.n,
    )
  const logsOf = (subjectId: string) =>
    world.query<{ kind: string; subject_id: string; counts: Record<string, number> }>(
      'select kind, subject_id, counts from restro.purge_log where subject_id = $1 order by seq',
      [subjectId],
    )

  /** A new instance of the tenant (its own host, so it is not the world's). */
  async function newInstance(): Promise<{ id: string; host: string }> {
    const host = `${testSlug('till')}.barsyonline.com`
    const created = await createIntegration(world.pool, world.tenantId, { kind: 'barsy', host })
    return { id: created.id, host }
  }
  /** Tier-1 records of `instance` for the till writes to cite (`<type>:<external id>`). */
  async function records(instance: string, keys: string[]): Promise<string[]> {
    const stored = await appendSourceRecords(
      world.pool,
      world.tenantId,
      instance,
      keys.map((key) => {
        const [externalType = '', externalId = ''] = key.split('=')
        return {
          externalType,
          externalId,
          scope: 'master' as const,
          raw: JSON.stringify({ key, at: newId('jb') }),
          payload: { key },
        }
      }),
    )
    return stored.map((record) => record.id)
  }
  async function change(source: string, ops: unknown[]) {
    const result = await apply(world.pool, world.tenantId, {
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? 'user:us_test' : `integration:${source.slice('till:'.length)}`,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet)
    expect(result.rejected).toEqual([])
  }
  const node = (id: string, nodeType: string, parent: string | null) => ({
    op: 'createNode',
    id,
    nodeType,
    parent: parent === null ? null : { id: parent },
    status: 'active',
    ...(parent === null ? {} : { sortKey: 'end' }),
  })
  const link = (id: string, integration: string, externalType: string, externalId: string) => ({
    op: 'linkSource',
    node: { id },
    link: { integration, externalType, externalId },
  })
  const tillName = (id: string, record: string, text: string) => ({
    op: 'setField',
    node: { id },
    fieldKey: 'name',
    layer: 'till',
    scope: 'master',
    value: { bg_BG: text, en_US: text },
    sourceRecordId: record,
    mappingVersion: 1,
  })
  const place = (item: string, section: string) => ({
    op: 'setPlacement',
    item: { id: item },
    section: { id: section },
    sortKey: 'end',
  })
  /** A live hand-made venue with its menu. */
  async function liveVenue(name: string): Promise<{ venueId: string; menuId: string }> {
    const venueId = (
      await provisionVenue(world.pool, world.tenantId, { name, slug: testSlug('live') })
    ).id
    const menuId = (await provisionMenu(world.pool, world.tenantId, venueId)).id
    return { venueId, menuId }
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

  beforeAll(async () => {
    db = await createTestDatabase()
    if (db.purgeUrl === null) throw new Error('no purge role')
    fake.listen()
    root = await mkdtemp(path.join(tmpdir(), 'restro-worker-purge-instance-'))
    store = new LocalPublishStore({ rootDir: root })
    world = await createWorld(fake, { database: db })
    purgePool = createPool(db.purgeUrl, { max: 1, applicationName: 'restro-purge-tests' })
    jobs = new Map(
      createPurgeJobs({ purgeDatabaseUrl: db.purgeUrl, publishStore: store }).map((job) => [
        job.name,
        job,
      ]),
    )
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await purgePool?.end()
    await world?.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world?.close()
    fake.close()
    await db?.drop()
    await rm(root, { recursive: true, force: true })
  })

  it('erases a removed instance and what no menu uses; placed items and menu sections stay, unlinked', async () => {
    const instance = await newInstance()
    const till = tillSource(instance.id)
    // The till layer: a till venue with two places, and a run.
    await upsertBarsyVenues(world.pool, world.tenantId, instance.id, [
      { bid: 20, name: 'Second bar' },
    ])
    await upsertPlaces(
      world.pool,
      world.tenantId,
      instance.id,
      20,
      [
        { placeId: 'p1', placeNum: '1', salonName: 'Hall', isPublic: true },
        { placeId: 'p2', placeNum: '2', salonName: 'Hall', isPublic: true },
      ],
      { pagesOk: [true] },
    )
    await asOwner(
      `insert into restro.job_runs (id, tenant_id, integration_id, kind, status)
       values ($1, $2, $3, 'full_pull', 'completed')`,
      [newId('jb'), world.tenantId, instance.id],
    )
    // Records: the unplaced item's, its supplement group's, and one nothing cites.
    const [itemRecord = '', groupRecord = ''] = await records(instance.id, [
      'article=502',
      'supplement_group=502:7',
      'article=503',
    ])
    // A live venue places one of the instance's items, in a section that came from the instance;
    // an empty section of the instance sits next to it; the other item (with a modifier group)
    // is placed nowhere. A second menu's section of the instance holds a third item, and that
    // menu's row is gone (what a purge that stopped half-way could leave): the section sits in no
    // menu any more.
    const live = await liveVenue('Live')
    const placed = newId('nd')
    const unplaced = newId('nd')
    const group = newId('nd')
    const holding = newId('nd')
    const empty = newId('nd')
    const created = await createMenu(world.pool, world.tenantId, {
      venueId: live.venueId,
      name: 'Gone',
    })
    if (!created.ok) throw new Error('no second menu')
    const stray = newId('nd')
    const strayed = newId('nd')
    await change(till, [
      node(stray, 'section', created.menu.id),
      link(stray, instance.id, 'category', '902'),
      node(strayed, 'item', null),
      link(strayed, instance.id, 'article', '504'),
      node(placed, 'item', null),
      link(placed, instance.id, 'article', '501'),
      node(unplaced, 'item', null),
      link(unplaced, instance.id, 'article', '502'),
      tillName(unplaced, itemRecord, 'Unplaced'),
      node(group, 'modifier_group', unplaced),
      link(group, instance.id, 'supplement_group', '502:7'),
      tillName(group, groupRecord, 'Extras'),
      node(holding, 'section', live.menuId),
      link(holding, instance.id, 'category', '900'),
      node(empty, 'section', live.menuId),
      link(empty, instance.id, 'category', '901'),
    ])
    await change('manual', [place(placed, holding), place(strayed, stray)])
    await asOwner('delete from restro.menus where id = $1', [created.menu.id])
    expect(await removeIntegration(world.pool, world.tenantId, instance.id)).toEqual({ ok: true })

    const result = await purge(instance.id)
    expect(result).toMatchObject({ status: 'purged', instanceErased: true })
    if (result.status !== 'purged') throw new Error('not purged')
    expect(result.counts).toMatchObject({
      places: 2,
      till_venue_links: 1,
      job_runs: 1,
      nodes: 4,
      placements: 1,
      source_links: 7,
      source_records: 3,
      integrations: 1,
    })

    // The placed item, the section holding it and the empty section stay (their menu exists),
    // with no link to the instance.
    expect(await countOf('nodes', 'id = any($1)', [[placed, holding, empty]])).toBe(3)
    expect(await countOf('placements', 'item_id = $1 and section_id = $2', [placed, holding])).toBe(
      1,
    )
    // The unplaced item and its group are gone with their values, and so are the section in no
    // menu and the item only it placed.
    expect(await countOf('nodes', 'id = any($1)', [[unplaced, group, stray, strayed]])).toBe(0)
    expect(await countOf('field_values', 'node_id = any($1)', [[unplaced, group]])).toBe(0)
    // Nothing of the instance is left; the live venue's menu is untouched otherwise.
    for (const table of ['source_links', 'source_records', 'places', 'barsy_venues', 'job_runs']) {
      expect(await countOf(table, 'integration_id = $1', [instance.id])).toBe(0)
    }
    expect(await countOf('integrations', 'id = $1', [instance.id])).toBe(0)
    expect(await countOf('menus', 'id = $1', [live.menuId])).toBe(1)

    // One log row, without content.
    const logs = await logsOf(instance.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ kind: 'instance', subject_id: instance.id })
    expect(logs[0]?.counts).toEqual(result.counts)
    const logged = JSON.stringify(logs[0])
    expect(logged).not.toContain(instance.host)
    expect(logged).not.toContain('Second bar')

    // Again: nothing to do, nothing logged.
    expect(await purge(instance.id)).toEqual({ status: 'missing' })
    expect(await logsOf(instance.id)).toHaveLength(1)
    expect(await countOf('nodes', 'id = any($1)', [[placed, holding]])).toBe(2)
  })

  it('keeps the records a placed item cites, and the instance row, until no menu uses it', async () => {
    const instance = await newInstance()
    const [record = ''] = await records(instance.id, ['article=601'])
    const live = await liveVenue('Keeps')
    const kept = newId('nd')
    const section = newId('nd')
    await change(tillSource(instance.id), [
      node(kept, 'item', null),
      link(kept, instance.id, 'article', '601'),
      tillName(kept, record, 'Kept'),
    ])
    await change('manual', [
      node(section, 'section', live.menuId),
      {
        op: 'setField',
        node: { id: section },
        fieldKey: 'title',
        layer: 'manual',
        scope: 'master',
        value: { bg_BG: 'Своя', en_US: 'Own' },
      },
      place(kept, section),
    ])
    expect(await removeIntegration(world.pool, world.tenantId, instance.id)).toEqual({ ok: true })

    // The item stays with its till value; its link goes; the record that value cites and the
    // instance row stay (a foreign key).
    expect(await purge(instance.id)).toMatchObject({
      status: 'purged',
      instanceErased: false,
      counts: { source_links: 1, source_records: 0 },
    })
    expect(await countOf('field_values', 'node_id = $1 and layer = $2', [kept, 'till'])).toBe(1)
    expect(await countOf('source_links', 'integration_id = $1', [instance.id])).toBe(0)
    expect(await countOf('source_records', 'integration_id = $1', [instance.id])).toBe(1)
    expect(await countOf('integrations', 'id = $1', [instance.id])).toBe(1)
    expect(await logsOf(instance.id)).toHaveLength(1)

    // Again: nothing to erase while the item is placed; nothing logged.
    expect(await purge(instance.id)).toEqual({ status: 'skipped', skipped: 'in_use' })
    expect(await logsOf(instance.id)).toHaveLength(1)

    // The venue takes the item off its menu: the next run erases it, the record and the row; the
    // venue's own section stays.
    await change('manual', [
      { op: 'removePlacement', item: { id: kept }, section: { id: section } },
    ])
    expect(await purge(instance.id)).toMatchObject({
      status: 'purged',
      instanceErased: true,
      counts: { nodes: 1, source_records: 1, integrations: 1 },
    })
    expect(await countOf('nodes', 'id = $1', [kept])).toBe(0)
    expect(await countOf('nodes', 'id = $1', [section])).toBe(1)
    expect(await countOf('integrations', 'id = $1', [instance.id])).toBe(0)
    expect(await logsOf(instance.id)).toHaveLength(2)
  })

  it('skips an instance a venue links to, one in use and one it does not know', async () => {
    expect(await purge(world.integrationId)).toEqual({ status: 'skipped', skipped: 'not_removed' })
    expect(await purge(newId('in'))).toEqual({ status: 'missing' })

    // A removed instance whose till venue a venue of ours serves again (a restore relinks it).
    const instance = await newInstance()
    await upsertBarsyVenues(world.pool, world.tenantId, instance.id, [{ bid: 30, name: 'Third' }])
    expect(await removeIntegration(world.pool, world.tenantId, instance.id)).toEqual({ ok: true })
    const live = await liveVenue('Relinked')
    await asOwner('update restro.barsy_venues set venue_id = $1 where integration_id = $2', [
      live.venueId,
      instance.id,
    ])
    expect(await purge(instance.id)).toEqual({ status: 'skipped', skipped: 'has_venues' })
    expect(await countOf('integrations', 'id = $1', [instance.id])).toBe(1)
    expect(await countOf('barsy_venues', 'integration_id = $1', [instance.id])).toBe(1)
    expect(await logsOf(instance.id)).toHaveLength(0)
  })

  it('the daily tick purges an instance removed 31 days ago, not one removed yesterday', async () => {
    const due = await newInstance()
    const young = await newInstance()
    for (const instance of [due, young]) {
      await records(instance.id, ['article=701'])
      expect(await removeIntegration(world.pool, world.tenantId, instance.id)).toEqual({ ok: true })
    }
    await asOwner(
      "update restro.integrations set removed_at = now() - interval '31 days' where id = $1",
      [due.id],
    )
    await asOwner(
      "update restro.integrations set removed_at = now() - interval '1 day' where id = $1",
      [young.id],
    )

    await runJob(JOB_NAMES.purgeTick, {})
    expect(await countOf('integrations', 'id = $1', [due.id])).toBe(0)
    expect(await countOf('source_records', 'integration_id = $1', [due.id])).toBe(0)
    expect(await countOf('integrations', 'id = $1', [young.id])).toBe(1)
    expect(await countOf('source_records', 'integration_id = $1', [young.id])).toBe(1)
    const [run] = await world.query<{ status: string; counters: Record<string, number> }>(
      "select status, counters from restro.job_runs where tenant_id = $1 and kind = 'purge_tick' order by created_at desc limit 1",
      [world.tenantId],
    )
    expect(run).toMatchObject({ status: 'completed', counters: { instances: 1 } })
  })
})
