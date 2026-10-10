// The sync settings of D59 (brief S3-04), against Postgres and the in-memory barsy installation,
// through the jobs' real handlers:
//
//   - the minute tick follows `schedule.*`: the interval, off switches, the daily full pull in the
//     venue's own clock, the two daylight-saving days, and what is recorded so that a pull that
//     failed is not asked for again every minute;
//   - `publish.new_items = hold` hides the items a pull creates, and only those;
//   - a barsy picture whose variants were just made publishes the menus that use it, unless the
//     integration waits for Publish.
//
// (`publish.after_sync = manual` after a pull is in sync-publish.test.ts, beside its siblings.)
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalPublishStore } from '@restro/assets'
import {
  type ChangeSet,
  JOB_NAMES,
  type NodeId,
  newId,
  resolve,
  VENUE_MENU_TEMPLATE,
  type VenueId,
} from '@restro/core'
import {
  apply,
  createAsset,
  loadCurrentSnapshot,
  loadHeldNewItemIds,
  loadMenuDocument,
} from '@restro/core/apply'
import type { Job } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Test-only reach into the asset package's sample images.
import { makePng } from '../../../packages/assets/src/test-images.ts'
import { createPublishJobs } from '../src/jobs/publish'
import type { JobDefinition } from '../src/jobs/types'
import { localTimeText } from '../src/sync/cursor'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, DEMO_BID, type World } from './world'

allowSlowSetup()

describe.skipIf(!hasDatabase)('the sync settings (D59)', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World

  beforeAll(async () => {
    db = await createTestDatabase()
    fake.listen()
  }, SETUP_TIMEOUT_MS)
  afterAll(async () => {
    fake.close()
    await db?.drop()
  })
  beforeEach(async () => {
    fake.reset()
    world = await createWorld(fake, { database: db })
  })
  afterEach(async () => {
    await world.query('delete from restro.assets where tenant_id = $1', [world.tenantId])
    await world.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world.close()
  })

  const payload = () => ({
    tenantId: world.tenantId,
    integrationId: world.integrationId,
    venueId: world.venueId,
  })
  const setConfig = (patch: Record<string, unknown>) =>
    world.query('update restro.integrations set config = config || $2::jsonb where id = $1', [
      world.integrationId,
      JSON.stringify(patch),
    ])
  const settings = (schedule: Record<string, unknown>, publish: Record<string, unknown> = {}) =>
    setConfig({ schedule, publish })
  const manualChange = (ops: unknown[]): ChangeSet =>
    ({
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops,
    }) as ChangeSet
  const syncState = async () => {
    const [row] = await world.query<{ state: Record<string, string> | null }>(
      `select config -> 'sync' -> $2 as state from restro.integrations where id = $1`,
      [world.integrationId, String(DEMO_BID)],
    )
    return row?.state ?? {}
  }

  // --- the minute tick ---------------------------------------------------------------------

  describe('the minute tick', () => {
    /** The tick at an instant: the names of the jobs it queued, in order. */
    const tickAt = async (instant: string) => {
      world.clock = new Date(instant)
      world.enqueued.length = 0
      await world.run(JOB_NAMES.barsySyncTick, {})
      return world.enqueued.map((job) => job.name)
    }
    const INC = JOB_NAMES.barsyIncremental
    const FULL = JOB_NAMES.barsyFullPull

    it('by default: a change check every 5 minutes, and a full pull once noon has passed', async () => {
      // 05:00 UTC is 08:00 in Sofia (summer time): before the daily time.
      expect(await tickAt('2026-10-10T05:00:00.300Z')).toEqual([INC])
      for (const minute of ['01', '02', '03', '04']) {
        expect(await tickAt(`2026-10-10T05:${minute}:00.200Z`), minute).toEqual([])
      }
      // The tick fires a few milliseconds off the minute: still every 5, not every 6.
      expect(await tickAt('2026-10-10T05:05:00.100Z')).toEqual([INC])
      expect(await tickAt('2026-10-10T05:09:59.900Z')).toEqual([])
      expect(await tickAt('2026-10-10T05:10:00.050Z')).toEqual([INC])

      // 09:00 UTC is 12:00 in Sofia: the full pull comes with that minute's change check.
      expect(await tickAt('2026-10-10T08:55:00.100Z')).toEqual([INC])
      expect(await tickAt('2026-10-10T09:00:00.200Z')).toEqual([INC, FULL])
      expect((await syncState()).last_full_pull_slot).toBe('2026-10-10T09:00:00.000Z')
      // Once a day.
      expect(await tickAt('2026-10-10T09:01:00.100Z')).toEqual([])
      expect(await tickAt('2026-10-10T20:00:00.100Z')).toEqual([INC])
      expect(await tickAt('2026-10-11T08:55:00.100Z')).toEqual([INC])
      expect(await tickAt('2026-10-11T09:00:00.200Z')).toEqual([INC, FULL])
    })

    it('every 1 minute: a change check at each minute tick, none twice in the same minute', async () => {
      await settings({ incremental_minutes: 1, full_pull_enabled: false })
      expect(await tickAt('2026-10-10T05:00:00.200Z')).toEqual([INC])
      expect(await tickAt('2026-10-10T05:00:40.000Z')).toEqual([])
      for (const minute of ['01', '02', '03', '04', '05']) {
        expect(await tickAt(`2026-10-10T05:${minute}:00.100Z`), minute).toEqual([INC])
      }
    })

    it.each([
      [10, ['05:09', '05:10']],
      [15, ['05:14', '05:15']],
      [30, ['05:29', '05:30']],
    ] as const)('every %i minutes', async (minutes, [early, due]) => {
      await settings({ incremental_minutes: minutes, full_pull_enabled: false })
      expect(await tickAt('2026-10-10T05:00:00.200Z')).toEqual([INC])
      expect(await tickAt(`2026-10-10T${early}:00.200Z`)).toEqual([])
      expect(await tickAt(`2026-10-10T${due}:00.200Z`)).toEqual([INC])
    })

    it('switched off: nothing, however long it has been', async () => {
      await settings({ incremental_enabled: false, full_pull_enabled: false })
      for (const instant of [
        '2026-10-10T05:00:00Z',
        '2026-10-10T09:00:00Z',
        '2026-10-10T09:05:00Z',
        '2026-10-12T09:00:00Z',
      ]) {
        expect(await tickAt(instant), instant).toEqual([])
      }
      expect(await syncState()).toEqual({})
    })

    it('each loop has its own switch', async () => {
      await settings({ incremental_enabled: false })
      expect(await tickAt('2026-10-10T09:00:00.200Z')).toEqual([FULL])
      await settings({ incremental_enabled: true, full_pull_enabled: false })
      expect(await tickAt('2026-10-11T09:00:00.200Z')).toEqual([INC])
    })

    it('a pull that never finished is not asked for again every minute', async () => {
      // The tick recorded what it queued; the jobs never ran (no last_*_at appears).
      await settings({ incremental_minutes: 5 })
      expect(await tickAt('2026-10-10T09:00:00.200Z')).toEqual([INC, FULL])
      const state = await syncState()
      expect(state.last_incremental_at).toBeUndefined()
      expect(state.last_full_pull_at).toBeUndefined()
      for (const minute of ['01', '02', '03', '04']) {
        expect(await tickAt(`2026-10-10T09:${minute}:00.200Z`), minute).toEqual([])
      }
      expect(await tickAt('2026-10-10T09:05:00.200Z')).toEqual([INC])
    })

    it('a queue that drops the job (one is already waiting) records nothing, so the next tick asks again', async () => {
      const job = world.jobs.get(JOB_NAMES.barsySyncTick)
      if (!job) throw new Error('no tick job')
      world.clock = new Date('2026-10-10T09:00:00.200Z')
      const dropped = { ...world.context, queue: { send: async () => null } }
      await job.handler([], dropped)
      expect(await syncState()).toEqual({})
      expect(await tickAt('2026-10-10T09:01:00.200Z')).toEqual([INC, FULL])
    })

    it('counts the interval from the last successful run too, when that is the latest', async () => {
      await settings({ full_pull_enabled: false })
      world.clock = new Date('2026-10-10T05:00:00Z')
      await world.run(JOB_NAMES.barsyFullPull, payload())
      world.clock = new Date('2026-10-10T05:00:30Z')
      await world.run(JOB_NAMES.barsyIncremental, payload())
      const state = await syncState()
      expect(state.last_incremental_at).toBe('2026-10-10T05:00:30.000Z')
      expect(await tickAt('2026-10-10T05:04:00.200Z')).toEqual([])
      expect(await tickAt('2026-10-10T05:05:00.200Z')).toEqual([INC])
    })

    it('reads the full pull time in the venue’s own time zone', async () => {
      await settings({ incremental_enabled: false })
      await world.query(`update restro.venues set timezone = 'America/New_York' where id = $1`, [
        world.venueId,
      ])
      // Noon in New York in October is 16:00 UTC (EDT).
      expect(await tickAt('2026-10-10T15:59:30Z')).toEqual([])
      expect(await tickAt('2026-10-10T16:00:10Z')).toEqual([FULL])
    })

    it('spring change day in Sofia: a time inside the skipped hour runs once, shifted forward', async () => {
      await settings({ incremental_enabled: false, full_pull_time: '03:30' })
      expect(await tickAt('2026-03-29T01:29:30Z')).toEqual([]) // 04:29 local: before 03:30 read as 04:30
      expect(await tickAt('2026-03-29T01:30:10Z')).toEqual([FULL])
      expect(await tickAt('2026-03-29T01:31:10Z')).toEqual([])
      expect(await tickAt('2026-03-29T12:00:10Z')).toEqual([])
      expect(await tickAt('2026-03-30T00:30:10Z')).toEqual([FULL]) // 03:30 EEST
    })

    it('autumn change day in Sofia: a repeated time runs once, in the first of the two hours', async () => {
      await settings({ incremental_enabled: false, full_pull_time: '03:30' })
      expect(await tickAt('2026-10-25T00:29:30Z')).toEqual([])
      expect(await tickAt('2026-10-25T00:30:10Z')).toEqual([FULL]) // 03:30 EEST
      expect(await tickAt('2026-10-25T01:30:10Z')).toEqual([]) // 03:30 EET, the clock reads it again
      expect(await tickAt('2026-10-26T01:30:10Z')).toEqual([FULL]) // 03:30 EET
    })

    it('midnight: 00:00 runs in the first minute of the local day, 23:59 in the last', async () => {
      await settings({ incremental_enabled: false, full_pull_time: '00:00' })
      // Local midnight on 11 Oct is 21:00 UTC on the 10th (EEST).
      expect(await tickAt('2026-10-10T20:59:30Z')).toEqual([FULL]) // today's (10 Oct 00:00), not yet done
      expect(await tickAt('2026-10-10T21:00:10Z')).toEqual([FULL]) // a new local day
      expect(await tickAt('2026-10-10T21:01:10Z')).toEqual([])
      await settings({ incremental_enabled: false, full_pull_time: '23:59' })
      expect(await tickAt('2026-10-11T20:58:30Z')).toEqual([])
      expect(await tickAt('2026-10-11T20:59:10Z')).toEqual([FULL])
    })

    it('does not stop the others when one venue’s settings are unreadable', async () => {
      // Unreadable values fall back to the defaults (core/sync-settings); the tick goes on.
      await setConfig({ schedule: 'junk', publish: 12 })
      expect(await tickAt('2026-10-10T09:00:00.200Z')).toEqual([INC, FULL])
    })
  })

  // --- publish.new_items -------------------------------------------------------------------

  describe('publish.new_items = hold', () => {
    const fullPull = () => world.run(JOB_NAMES.barsyFullPull, payload())
    const incremental = () => world.run(JOB_NAMES.barsyIncremental, payload())
    const advance = (minutes: number) => {
      world.clock = new Date(world.clock.getTime() + minutes * 60_000)
    }
    const itemIds = async () =>
      (
        await world.query<{ id: string }>(
          `select id from restro.nodes where tenant_id = $1 and node_type = 'item' order by id`,
          [world.tenantId],
        )
      ).map((row) => row.id)
    const manualHides = () =>
      world.query<{
        node_id: string
        value: unknown
        source: string
        actor: string
        scope: string
        job_id: string
      }>(
        `select node_id, value, source, actor, scope, job_id from restro.field_values
         where tenant_id = $1 and field_key = 'visible' and layer = 'manual' order by node_id`,
        [world.tenantId],
      )
    const lastRun = async (kind: string) => {
      const rows = await world.query<{
        counters: Record<string, number>
        details: { refused: unknown[] } | null
      }>(
        `select counters, details from restro.job_runs
         where integration_id = $1 and kind = $2 order by created_at`,
        [world.integrationId, kind],
      )
      const row = rows.at(-1)
      if (!row) throw new Error(`no ${kind} run`)
      return row
    }
    const resolved = async () => {
      const document = await loadMenuDocument(world.pool, world.tenantId, world.menuId)
      return resolve(VENUE_MENU_TEMPLATE, document, {
        venueScope: `venue:${world.venueId}`,
        locales: ['bg_BG'],
        now: new Date().toISOString(),
      })
    }
    const newArticle = (id: number) => {
      const template = fake.articles.find((article) => article.article_id === 11)
      if (!template) throw new Error('no article 11')
      fake.articles.push({
        ...template,
        article_id: id,
        article_name_public: `Нов ${id}`,
        last_update: localTimeText(world.clock, 'Europe/Sofia'),
      })
    }
    it('hides every item the pull created: manual layer, source manual, actor system', async () => {
      await settings({}, { new_items: 'hold' })
      await fullPull()
      // Compared in one order (JavaScript's): SQL `order by` follows the database collation, which
      // differs between the CI Postgres (en_US) and the local one (C) for mixed-case ids.
      const items = (await itemIds()).sort()
      expect(items.length).toBeGreaterThan(5)

      const hides = await manualHides()
      expect(hides.map((row) => row.node_id).sort()).toEqual(items)
      for (const row of hides) {
        expect(row).toMatchObject({
          value: false,
          source: 'manual',
          actor: 'system',
          scope: 'master',
        })
        expect(row.job_id).toMatch(/^jb_/)
      }
      expect((await loadHeldNewItemIds(world.pool, world.tenantId)).sort()).toEqual(items)

      const run = await lastRun('barsy_full_pull')
      expect(run.counters.items_held).toBe(items.length)
      expect(run.details?.refused).toEqual([])
      // Nothing of them is visible to guests.
      const menu = await resolved()
      for (const id of items) expect(menu.items[id as NodeId]?.visible, id).toBe(false)
    })

    it('hides nothing by default, and with `show`', async () => {
      await fullPull()
      expect(await manualHides()).toEqual([])
      expect((await lastRun('barsy_full_pull')).counters).not.toHaveProperty('items_held')
      await settings({}, { new_items: 'show' })
      newArticle(90001)
      advance(5)
      await incremental()
      expect(await manualHides()).toEqual([])
    })

    it('leaves the items that were there before untouched, and holds only the new one', async () => {
      await fullPull() // default: show
      const before = await itemIds()
      await settings({}, { new_items: 'hold' })
      advance(5)
      newArticle(90001)
      await incremental()
      const after = await itemIds()
      const created = after.filter((id) => !before.includes(id))
      expect(created).toHaveLength(1)
      expect((await manualHides()).map((row) => row.node_id)).toEqual(created)
      expect((await lastRun('barsy_incremental')).counters).toMatchObject({
        created: 1,
        items_held: 1,
      })
      // A later pull that creates nothing holds nothing.
      advance(5)
      await incremental()
      expect((await manualHides()).map((row) => row.node_id)).toEqual(created)
    })

    it('shows an item once a manager clears the hide, and no later pull hides it again', async () => {
      await settings({}, { new_items: 'hold' })
      await fullPull()
      const [shown] = await itemIds()
      expect(shown).toBeDefined()
      const result = await apply(
        world.pool,
        world.tenantId,
        manualChange([
          {
            op: 'clearField',
            node: { id: shown },
            fieldKey: 'visible',
            layer: 'manual',
            scope: 'master',
          },
        ]),
      )
      expect(result.rejected).toEqual([])
      expect((await loadHeldNewItemIds(world.pool, world.tenantId)).includes(shown as NodeId)).toBe(
        false,
      )

      advance(5)
      await fullPull() // the same installation again: nothing is new
      expect((await manualHides()).map((row) => row.node_id)).not.toContain(shown)
      // Nothing hides it any more (the barsy layer's own value stays).
      expect((await resolved()).items[shown as NodeId]?.fields.visible?.value).not.toBe(false)
    })

    it('a person’s own hide is not mistaken for a held new item', async () => {
      await fullPull()
      const [item] = await itemIds()
      await apply(
        world.pool,
        world.tenantId,
        manualChange([
          {
            op: 'setField',
            node: { id: item },
            fieldKey: 'visible',
            layer: 'manual',
            scope: 'master',
            value: false,
          },
        ]),
      )
      expect(await loadHeldNewItemIds(world.pool, world.tenantId)).toEqual([])
    })
  })

  // --- pictures arriving after the publish ---------------------------------------------------

  describe('publishing again when a barsy picture’s variants arrive', () => {
    let root: string
    let publishJobs: Map<string, JobDefinition>

    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), 'restro-worker-photos-'))
      publishJobs = new Map(
        createPublishJobs({
          publishStore: new LocalPublishStore({ rootDir: root }),
          assetStore: { get: async (key) => world.stored.get(key) ?? null },
        }).map((job) => [job.name, job]),
      )
    })
    afterEach(async () => {
      await rm(root, { recursive: true, force: true })
    })

    const runPublishJob = async (name: string, data: object) => {
      const job = publishJobs.get(name)
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
    const queued = (name: string) => world.enqueued.filter((job) => job.name === name)
    const publishes = () => queued(JOB_NAMES.publishMenu)
    const lastPublishRun = async () => {
      const rows = await world.query<{ status: string; details: { notes: string[] } | null }>(
        `select status, details from restro.job_runs
         where tenant_id = $1 and kind = 'publish_menu' order by created_at`,
        [world.tenantId],
      )
      const row = rows.at(-1)
      if (!row) throw new Error('no publish run')
      return row
    }
    /** The demo's categories have no public titles, so the resolver blocks them: title them. */
    const titleSections = async () => {
      const sections = await world.query<{ id: string }>(
        `select id from restro.nodes where tenant_id = $1 and node_type = 'section'`,
        [world.tenantId],
      )
      const result = await apply(
        world.pool,
        world.tenantId,
        manualChange(
          sections.map((section) => ({
            op: 'setField',
            node: { id: section.id },
            fieldKey: 'title',
            layer: 'manual',
            scope: 'master',
            value: { bg_BG: 'Раздел' },
          })),
        ),
      )
      expect(result.rejected).toEqual([])
    }
    const scope = () => ({ menuId: world.menuId as NodeId, venueId: world.venueId as VenueId })
    const currentBody = async () =>
      (await loadCurrentSnapshot(world.pool, world.tenantId, scope()))?.body

    /** The picture of article 11, served as a real PNG; returns the job a pull would queue for it. */
    const servePicture = () => {
      const article = fake.articles.find((candidate) => candidate.article_id === 11)
      const url = new URL(String(article?.picture_url))
      fake.photos.set(`${url.pathname}${url.search}`, {
        status: 200,
        body: makePng(1000, 800),
      })
      return {
        tenantId: world.tenantId,
        integrationId: world.integrationId,
        articleExternalId: '11',
        pictureName: String(article?.picture),
        url: String(article?.picture_url),
      }
    }
    /** The variants job the picture's download queued (the world’s queue is only a recorder). */
    async function variantsJobData() {
      const rows = await world.query<{ id: string }>(
        `select id from restro.assets where tenant_id = $1 and origin = 'barsy'`,
        [world.tenantId],
      )
      const asset = rows[0]
      if (!asset) throw new Error('the picture was not stored')
      return { tenantId: world.tenantId, assetId: asset.id }
    }

    it('pull → publish without images → variants land → one more publish, with images', async () => {
      // Every article has the picture, so whichever items the snapshot shows have one to show.
      const job = servePicture()
      for (const article of fake.articles) {
        const template = fake.articles.find((candidate) => candidate.article_id === 11)
        article.picture = template?.picture ?? null
        article.picture_url = template?.picture_url ?? null
      }
      await world.run(JOB_NAMES.barsyFullPull, payload())
      await titleSections()
      // The publish the pull queued runs before the picture is ready: no image in the snapshot.
      const [first] = publishes()
      expect(first).toMatchObject({ data: { reason: 'auto_sync' }, startAfter: 30 })
      await runPublishJob(JOB_NAMES.publishMenu, (first as { data: object }).data)
      expect((await lastPublishRun()).status).toBe('completed')
      expect((await currentBody())?.assets).toEqual({})

      // The picture of an article whose item the snapshot shows arrives afterwards.
      const [shown] = await world.query<{ external_id: string }>(
        `select external_id from restro.source_links
         where integration_id = $1 and external_type = 'article' and node_id = $2`,
        [world.integrationId, Object.keys((await currentBody())?.items ?? {})[0]],
      )
      if (!shown) throw new Error('the snapshot shows no barsy item')
      await world.run(JOB_NAMES.assetFetch, { ...job, articleExternalId: shown.external_id })
      world.enqueued.length = 0
      const variants = await variantsJobData()
      await runPublishJob(JOB_NAMES.assetVariants, variants)

      // The variants job queued the publish of the menu that uses the picture, once.
      expect(publishes()).toHaveLength(1)
      expect(publishes()[0]).toEqual({
        name: JOB_NAMES.publishMenu,
        data: {
          tenantId: world.tenantId,
          menuId: world.menuId,
          venueId: world.venueId,
          reason: 'auto_sync',
          actor: `integration:${world.integrationId}`,
        },
        singletonKey: `${world.menuId}:${world.venueId}:auto`,
        startAfter: 30,
      })

      await runPublishJob(JOB_NAMES.publishMenu, (publishes()[0] as { data: object }).data)
      const body = await currentBody()
      expect(Object.keys(body?.assets ?? {})).toEqual([variants.assetId])
      expect(Object.values(body?.items ?? {}).filter((item) => item.image !== null)).toHaveLength(1)
      const snapshots = await world.query<{ version: number }>(
        'select version from restro.snapshots where tenant_id = $1 order by version',
        [world.tenantId],
      )
      expect(snapshots.map((row) => row.version)).toEqual([1, 2])
    })

    it('publish.after_sync = manual: the variants queue nothing; a person presses Publish', async () => {
      await settings({}, { after_sync: 'manual' })
      const job = servePicture()
      await world.run(JOB_NAMES.barsyFullPull, payload())
      await world.run(JOB_NAMES.assetFetch, job)
      world.enqueued.length = 0
      await runPublishJob(JOB_NAMES.assetVariants, await variantsJobData())
      expect(publishes()).toEqual([])
      // The old flat key means the same.
      await setConfig({ publish: {}, publish_after_sync: false })
      await runPublishJob(JOB_NAMES.assetVariants, await variantsJobData())
      expect(publishes()).toEqual([])
    })

    it('a picture someone uploaded is published when they press Publish, not by itself', async () => {
      const node = newId('nd')
      const assetId = newId('as')
      const storageKey = `tenants/${world.tenantId}/assets/${assetId}/original.png`
      world.stored.set(storageKey, makePng(800, 600))
      await createAsset(world.pool, world.tenantId, {
        id: assetId,
        origin: 'upload',
        contentType: 'image/png',
        checksum: createHash('sha256').update(assetId).digest('hex'),
        width: 800,
        height: 600,
        storageKey,
      })
      const section = newId('nd')
      await apply(
        world.pool,
        world.tenantId,
        manualChange([
          {
            op: 'createNode',
            id: section,
            nodeType: 'section',
            parent: { id: world.menuId },
            status: 'active',
            sortKey: 'end',
          },
          { op: 'createNode', id: node, nodeType: 'item', parent: null, status: 'active' },
          { op: 'setPlacement', item: { id: node }, section: { id: section }, sortKey: 'end' },
          {
            op: 'setField',
            node: { id: node },
            fieldKey: 'image',
            layer: 'manual',
            scope: 'master',
            value: { asset_id: assetId, alt: {}, focal: null },
          },
        ]),
      )
      await runPublishJob(JOB_NAMES.assetVariants, { tenantId: world.tenantId, assetId })
      expect(publishes()).toEqual([])
      expect(world.logLines.join('\n')).toContain('a person uploaded this picture')
    })

    it('a picture no menu uses yet queues nothing', async () => {
      const job = servePicture()
      await world.run(JOB_NAMES.barsyFullPull, payload())
      await world.run(JOB_NAMES.assetFetch, job)
      const data = await variantsJobData()
      // The item loses its image (a person replaced it): the picture belongs to no menu now.
      await world.query(
        `delete from restro.field_values where tenant_id = $1 and field_key = 'image'`,
        [world.tenantId],
      )
      world.enqueued.length = 0
      await runPublishJob(JOB_NAMES.assetVariants, data)
      expect(publishes()).toEqual([])
    })

    it('does not publish again for a picture that already had its variants', async () => {
      const job = servePicture()
      await world.run(JOB_NAMES.barsyFullPull, payload())
      await world.run(JOB_NAMES.assetFetch, job)
      const data = await variantsJobData()
      await runPublishJob(JOB_NAMES.assetVariants, data)
      world.enqueued.length = 0
      await runPublishJob(JOB_NAMES.assetVariants, data)
      expect(publishes()).toEqual([])
    })

    it('a burst of pictures is one key: the queue merges them into one publish', async () => {
      await world.run(JOB_NAMES.barsyFullPull, payload())
      const ids: string[] = []
      const other = Number(
        fake.articles.find(
          (a) =>
            a.article_id !== 11 &&
            a.picture &&
            a.picture_url &&
            (a.categories as string[]).length > 0 &&
            !a.is_service,
        )?.article_id,
      )
      for (const article of [11, other]) {
        const found = fake.articles.find((candidate) => candidate.article_id === article)
        if (!found?.picture_url) continue
        const url = new URL(String(found.picture_url))
        fake.photos.set(`${url.pathname}${url.search}`, {
          status: 200,
          body: makePng(700 + article, 500),
        })
        await world.run(JOB_NAMES.assetFetch, {
          tenantId: world.tenantId,
          integrationId: world.integrationId,
          articleExternalId: String(article),
          pictureName: String(found.picture),
          url: String(found.picture_url),
        })
      }
      const rows = await world.query<{ id: string }>(
        `select id from restro.assets where tenant_id = $1 and origin = 'barsy' order by id`,
        [world.tenantId],
      )
      ids.push(...rows.map((row) => row.id))
      expect(ids.length).toBeGreaterThanOrEqual(2)
      world.enqueued.length = 0
      for (const assetId of ids) {
        await runPublishJob(JOB_NAMES.assetVariants, { tenantId: world.tenantId, assetId })
      }
      expect(publishes().length).toBe(ids.length)
      expect(new Set(publishes().map((job) => job.singletonKey)).size).toBe(1)
      expect(new Set(publishes().map((job) => job.startAfter))).toEqual(new Set([30]))
    })
  })
})
