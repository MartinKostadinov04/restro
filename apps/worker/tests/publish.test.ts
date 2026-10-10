// The publish jobs and the photo variants (brief S3-01b): Postgres as restro_app, a local publish
// store in a temporary folder, the jobs' real handlers, and (for merging) the real queue.
//
//   - publish-menu writes the snapshot file and current.json; unchanged writes nothing new;
//   - a rollback moves current.json back (publish-files), and the files are repairable;
//   - a held publish (V11) writes no files; a refused one (V10) is recorded, not retried;
//   - two automatic publishes inside the merge window are one publish (pg-boss `stately`);
//   - asset-variants: widths, aspect ratio, no metadata, a small original, idempotence, the backfill.
import { createHash } from 'node:crypto'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  currentPath,
  LocalPublishStore,
  livePath,
  type PublishPutOptions,
  type PublishStore,
  publishPutOptions as publishPutOptionsFor,
  readVenueIndex,
  snapshotPath,
  variantPath,
  venueIndexBytes,
  venueIndexPath,
} from '@restro/assets'
import {
  type AssetId,
  type ChangeSet,
  JOB_NAMES,
  type NodeId,
  newId,
  prepareJob,
  type SnapshotId,
  type VenueId,
} from '@restro/core'
import {
  apply,
  createAsset,
  loadCurrentSnapshot,
  provisionMenu,
  provisionVenue,
  rollbackTo,
} from '@restro/core/apply'
import type { Job } from 'pg-boss'
import sharp, { type WriteableMetadata } from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { WorkerConfig } from '../src/config'
import { createPublishJobs } from '../src/jobs/publish'
import type { JobDefinition } from '../src/jobs/types'
import { createLogger } from '../src/logger'
import { assetsWithoutVariants, renderVariant, runAssetVariants } from '../src/publish/variants'
import { backfillVariants } from '../src/variants/backfill'
import { startWorker, type Worker } from '../src/worker'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, type World } from './world'

allowSlowSetup()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The slug of the venue `createWorld` provisions. */
const slug = 'demo-club'

/** A real image of the given size (sharp makes it: never a photo from barsy). */
async function makeImage(
  width: number,
  height: number,
  kind: 'png' | 'jpeg' = 'png',
  metadata: WriteableMetadata = {},
): Promise<Uint8Array> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
  const withMeta = Object.keys(metadata).length > 0 ? image.withMetadata(metadata) : image
  return kind === 'png' ? withMeta.png().toBuffer() : withMeta.jpeg().toBuffer()
}

/** A publish store that remembers what was put, so a test can say "nothing new was written". */
class CountingStore implements PublishStore {
  readonly puts: string[] = []
  constructor(readonly inner: LocalPublishStore) {}
  async put(file: string, bytes: Uint8Array, options: PublishPutOptions) {
    this.puts.push(file)
    await this.inner.put(file, bytes, options)
  }
  get(file: string) {
    return this.inner.get(file)
  }
  delete(file: string) {
    return this.inner.delete(file)
  }
}

describe.skipIf(!hasDatabase)('the publish jobs and photo variants', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let root: string
  let store: CountingStore
  let jobs: Map<string, JobDefinition>

  // New ids for every test: node ids are unique across the whole database.
  let section: NodeId
  let items: NodeId[]

  const changeSet = (ops: unknown[]): ChangeSet =>
    ({
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops,
    }) as ChangeSet
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
  async function change(ops: unknown[]) {
    const result = await apply(world.pool, world.tenantId, changeSet(ops))
    expect(result.rejected).toEqual([])
  }

  const scope = () => ({ menuId: world.menuId as NodeId, venueId: world.venueId as VenueId })
  const publishPayload = (reason: 'manual' | 'auto_sync' = 'manual') =>
    prepareJob(JOB_NAMES.publishMenu, {
      tenantId: world.tenantId,
      menuId: world.menuId,
      venueId: world.venueId,
      reason,
      actor: reason === 'manual' ? 'user:us_test' : 'system',
    }).data
  const scopePayload = () => ({
    tenantId: world.tenantId,
    menuId: world.menuId,
    venueId: world.venueId,
  })

  /** Runs a publish job's real handler. */
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

  const runsOf = (kind: string) =>
    world.query<{
      status: string
      counters: Record<string, number>
      error_summary: string | null
      details: { notes: string[] } | null
      integration_id: string | null
    }>(
      `select status, counters, error_summary, details, integration_id from restro.job_runs
       where tenant_id = $1 and kind = $2 order by created_at`,
      [world.tenantId, kind],
    )
  const lastRun = async (kind: string) => {
    const row = (await runsOf(kind)).at(-1)
    if (!row) throw new Error(`no ${kind} run`)
    return row
  }
  const readJson = async (file: string) => {
    const bytes = await store.get(file)
    return bytes === null ? null : (JSON.parse(new TextDecoder().decode(bytes)) as unknown)
  }
  const snapshotRows = () =>
    world.query<{ id: string; version: number; status: string; reason: string }>(
      `select id, version, status, reason from restro.snapshots
       where tenant_id = $1 and menu_id = $2 order by version`,
      [world.tenantId, world.menuId],
    )

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
    root = await mkdtemp(path.join(tmpdir(), 'restro-worker-publish-'))
    store = new CountingStore(new LocalPublishStore({ rootDir: root }))
    world = await createWorld(fake, { database: db })
    section = newId('nd')
    items = Array.from({ length: 5 }, () => newId('nd'))
    jobs = new Map(
      createPublishJobs({
        publishStore: store,
        assetStore: { get: async (key) => world.stored.get(key) ?? null },
      }).map((job) => [job.name, job]),
    )
    await change([
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: world.menuId },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
      ...items.flatMap((id, index) => [
        { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
        manual(id, 'name', { bg_BG: `Напитка ${index}`, en_US: `Drink ${index}` }),
        manual(id, 'price', eur(500 + index * 100)),
        manual(id, 'allergens', []),
        { op: 'setPlacement', item: { id }, section: { id: section }, sortKey: 'end' },
      ]),
    ])
  })
  afterEach(async () => {
    // The backfill walks every organisation of the database: leave nothing of this test behind.
    await world.query('delete from restro.assets where tenant_id = $1', [world.tenantId])
    await world.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world.close()
    await rm(root, { recursive: true, force: true })
  })

  describe('publish-menu', () => {
    it('publishes, writes the snapshot file and current.json, and records the run', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())

      const current = await loadCurrentSnapshot(world.pool, world.tenantId, scope())
      expect(current).toMatchObject({ version: 1, status: 'published' })
      const snapshotFile = snapshotPath(current?.id as SnapshotId)
      // The file is the stored body; the pointer file names it.
      expect(await readJson(snapshotFile)).toEqual(JSON.parse(JSON.stringify(current?.body)))
      expect(await readJson(currentPath(scope().menuId, scope().venueId))).toEqual({
        snapshot_id: current?.id,
        version: 1,
        hash: current?.hash,
      })
      // live.json is made for this snapshot too.
      expect(await readJson(livePath(scope().menuId, scope().venueId))).toEqual({
        version: 1,
        items: {},
      })
      expect(store.puts.sort()).toEqual(
        [
          snapshotFile,
          currentPath(scope().menuId, scope().venueId),
          livePath(scope().menuId, scope().venueId),
          venueIndexPath(slug),
        ].sort(),
      )

      const run = await lastRun('publish_menu')
      // The run's text is its notes (the column is called error_summary for failed runs).
      expect(run).toMatchObject({
        status: 'completed',
        error_summary: 'published version 1',
        integration_id: null,
      })
      expect(run.counters).toMatchObject({ snapshot_version: 1, published: 1, files_written: 3 })
      expect(run.details?.notes).toEqual(['published version 1'])
    })

    it('republishing an unchanged menu writes nothing new', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      store.puts.length = 0
      await runJob(JOB_NAMES.publishMenu, publishPayload('auto_sync'))
      expect(store.puts).toEqual([])
      expect(await snapshotRows()).toHaveLength(1)
      const run = await lastRun('publish_menu')
      expect(run).toMatchObject({ status: 'completed' })
      expect(run.counters).toMatchObject({ published: 0, unchanged: 1, files_written: 0 })
    })

    it('a changed price is version 2 with its own immutable file; version 1 stays', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      const v1 = (await loadCurrentSnapshot(world.pool, world.tenantId, scope()))?.id
      await change([manual(items[0] as string, 'price', eur(777))])
      store.puts.length = 0
      await runJob(JOB_NAMES.publishMenu, publishPayload('auto_sync'))
      const v2 = await loadCurrentSnapshot(world.pool, world.tenantId, scope())
      expect(v2?.version).toBe(2)
      expect(store.puts.sort()).toEqual(
        [
          snapshotPath(v2?.id as SnapshotId),
          currentPath(scope().menuId, scope().venueId),
          livePath(scope().menuId, scope().venueId),
        ].sort(),
      )
      expect(await store.get(snapshotPath(v1 as SnapshotId))).not.toBeNull()
      expect(await readJson(currentPath(scope().menuId, scope().venueId))).toMatchObject({
        snapshot_id: v2?.id,
        version: 2,
      })
    })

    it('a held publish (V11) writes no files and says why', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      const pointerBefore = await readJson(currentPath(scope().menuId, scope().venueId))
      // Three of five items hidden: more than 30% of what was visible.
      await change(items.slice(0, 3).map((id) => manual(id, 'visible', false)))
      store.puts.length = 0
      await runJob(JOB_NAMES.publishMenu, publishPayload('auto_sync'))

      expect(store.puts).toEqual([])
      expect(await readJson(currentPath(scope().menuId, scope().venueId))).toEqual(pointerBefore)
      const rows = await snapshotRows()
      expect(rows.map((row) => [row.version, row.status])).toEqual([
        [1, 'published'],
        [2, 'held'],
      ])
      const run = await lastRun('publish_menu')
      expect(run.status).toBe('completed')
      expect(run.counters).toMatchObject({ held: 1, snapshot_version: 2 })
      expect(run.details?.notes[0]).toContain('held for review (V11): 3 of 5 visible items')

      // A person publishes it: the files follow, and nothing stays held.
      await runJob(JOB_NAMES.publishMenu, publishPayload('manual'))
      expect(await readJson(currentPath(scope().menuId, scope().venueId))).toMatchObject({
        version: 3,
      })
    })

    it('a refused publish (V10) is recorded as failed and is not retried', async () => {
      const venue = await provisionVenue(world.pool, world.tenantId, {
        name: 'Empty',
        slug: 'empty-venue',
      })
      const menu = await provisionMenu(world.pool, world.tenantId, venue.id)
      await runJob(JOB_NAMES.publishMenu, {
        tenantId: world.tenantId,
        menuId: menu.id,
        venueId: venue.id,
        reason: 'manual',
        actor: 'user:us_test',
      })
      const run = await lastRun('publish_menu')
      expect(run.status).toBe('failed')
      expect(run.details?.notes).toEqual(['publish refused: no_visible_items (V10)'])
      expect(store.puts).toEqual([])
    })

    it('rejects a payload that is not a publish', async () => {
      await expect(runJob(JOB_NAMES.publishMenu, { tenantId: world.tenantId })).rejects.toThrow(
        /invalid payload/,
      )
    })
  })

  describe('publish-files', () => {
    it('after a rollback, current.json points back at the restored snapshot', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      const v1 = await loadCurrentSnapshot(world.pool, world.tenantId, scope())
      await change([manual(items[1] as string, 'price', eur(888))])
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      expect(await readJson(currentPath(scope().menuId, scope().venueId))).toMatchObject({
        version: 2,
      })

      await rollbackTo(world.pool, world.tenantId, {
        ...scope(),
        snapshotId: v1?.id as SnapshotId,
        actor: 'user:us_test',
      })
      // The database moved; the file has not yet.
      expect(await readJson(currentPath(scope().menuId, scope().venueId))).toMatchObject({
        version: 2,
      })
      store.puts.length = 0
      await runJob(JOB_NAMES.publishFiles, scopePayload())
      expect(await readJson(currentPath(scope().menuId, scope().venueId))).toEqual({
        snapshot_id: v1?.id,
        version: 1,
        hash: v1?.hash,
      })
      // Snapshot files never change: only the pointer (and the overlay made for it) was written.
      expect(store.puts.sort()).toEqual(
        [
          currentPath(scope().menuId, scope().venueId),
          livePath(scope().menuId, scope().venueId),
        ].sort(),
      )
      expect((await lastRun('publish_files')).status).toBe('completed')
    })

    it('repairs a missing snapshot file and a missing pointer, and is a no-op when all is there', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      const current = await loadCurrentSnapshot(world.pool, world.tenantId, scope())

      store.puts.length = 0
      await runJob(JOB_NAMES.publishFiles, scopePayload())
      expect(store.puts).toEqual([])

      await unlink(path.join(root, ...snapshotPath(current?.id as SnapshotId).split('/')))
      await unlink(path.join(root, ...currentPath(scope().menuId, scope().venueId).split('/')))
      await runJob(JOB_NAMES.publishFiles, scopePayload())
      expect(await readJson(snapshotPath(current?.id as SnapshotId))).toEqual(
        JSON.parse(JSON.stringify(current?.body)),
      )
      expect(await readJson(currentPath(scope().menuId, scope().venueId))).toMatchObject({
        snapshot_id: current?.id,
      })
    })

    it('writes the slug index {venue_id, menu_id} with the first publish, and repairs it', async () => {
      expect(await readVenueIndex(store, slug)).toBeNull()
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      expect(await readJson(venueIndexPath(slug))).toEqual({
        venue_id: world.venueId,
        menu_id: world.menuId,
      })

      store.puts.length = 0
      await runJob(JOB_NAMES.publishFiles, scopePayload())
      expect(store.puts).toEqual([])

      await unlink(path.join(root, ...venueIndexPath(slug).split('/')))
      await runJob(JOB_NAMES.publishFiles, scopePayload())
      expect(store.puts).toEqual([venueIndexPath(slug)])
      expect(await readVenueIndex(store, slug)).toEqual({
        venue_id: world.venueId,
        menu_id: world.menuId,
      })
    })

    it('never overwrites the slug index of another venue, and says so in the run', async () => {
      const other = { venue_id: newId('vn'), menu_id: newId('nd') }
      await store.inner.put(
        venueIndexPath(slug),
        venueIndexBytes(other),
        publishPutOptionsFor(venueIndexPath(slug)),
      )
      store.puts.length = 0
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      // The menu is published and its files are out, but the address stays with the first venue.
      expect(store.puts).not.toContain(venueIndexPath(slug))
      expect(await readVenueIndex(store, slug)).toEqual(other)
      const run = await lastRun('publish_menu')
      expect(run.details?.notes.join(' ')).toContain(`/m/${slug} belongs to another venue`)
    })

    it('replaces a slug index file that cannot be read', async () => {
      await store.inner.put(
        venueIndexPath(slug),
        new TextEncoder().encode('{broken'),
        publishPutOptionsFor(venueIndexPath(slug)),
      )
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      expect(await readVenueIndex(store, slug)).toEqual({
        venue_id: world.venueId,
        menu_id: world.menuId,
      })
    })

    it('has nothing to write before the first publish', async () => {
      await runJob(JOB_NAMES.publishFiles, scopePayload())
      expect(store.puts).toEqual([])
      expect((await lastRun('publish_files')).details?.notes).toEqual([
        'nothing is published for this menu yet',
      ])
    })
  })

  describe('publish-live', () => {
    it('writes the sold-out overlay of the current snapshot, and nothing before a publish', async () => {
      await runJob(JOB_NAMES.publishLive, scopePayload())
      expect(store.puts).toEqual([])
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      expect(await readJson(livePath(scope().menuId, scope().venueId))).toEqual({
        version: 1,
        items: {},
      })
    })
  })

  describe('two automatic publishes in the merge window (the real queue)', () => {
    let worker: Worker

    beforeEach(async () => {
      const logger = await createLogger({
        level: 'silent',
        pretty: false,
        destination: { write: () => undefined },
      })
      const config: WorkerConfig = {
        databaseUrl: db.appUrl,
        workerId: 'publish-merge-test',
        healthPort: 0,
        logLevel: 'silent',
        prettyLogs: false,
        seal: null,
        barsy: { env: 'test', allowedHostSuffixes: ['.barsyonline.com'], productionHosts: [] },
        assets: { kind: 'local', dir: tmpdir() },
        publish: { kind: 'local', dir: root },
      }
      worker = await startWorker(config, { logger, jobs: [...jobs.values()] })
    }, SETUP_TIMEOUT_MS)
    afterEach(async () => {
      await worker?.stop()
    })

    it('the queues use the stately policy', async () => {
      for (const name of [JOB_NAMES.publishMenu, JOB_NAMES.publishFiles, JOB_NAMES.publishLive]) {
        expect(await worker.boss.getQueue(name), name).toMatchObject({
          policy: 'stately',
          deadLetter: `${name}.dead`,
        })
      }
      expect(await worker.boss.getQueue(JOB_NAMES.assetVariants)).toMatchObject({
        policy: 'exclusive',
      })
    })

    it('is one publish, with everything that changed by the time it runs', async () => {
      const auto = prepareJob(JOB_NAMES.publishMenu, publishPayload('auto_sync'))
      // The real delay is 30 s (core/jobs.test.ts); a second keeps this test short.
      const send = () =>
        worker.boss.send(JOB_NAMES.publishMenu, auto.data, {
          singletonKey: auto.singletonKey,
          startAfter: 1,
        })

      await change([manual(items[0] as string, 'price', eur(611))])
      expect(await send()).toEqual(expect.any(String))
      // A second sync finishes while the first job still waits: it joins it.
      await change([manual(items[1] as string, 'price', eur(622))])
      expect(await send()).toBeNull()

      const deadline = Date.now() + 30_000
      while (
        (await runsOf('publish_menu')).length === 0 ||
        (await lastRun('publish_menu')).status === 'running'
      ) {
        if (Date.now() > deadline) throw new Error('the publish never ran')
        await sleep(200)
      }
      // Time for a second job to run, if there were one.
      await sleep(2_500)

      expect(await runsOf('publish_menu')).toHaveLength(1)
      const rows = await snapshotRows()
      expect(rows).toHaveLength(1)
      const body = (await loadCurrentSnapshot(world.pool, world.tenantId, scope()))?.body
      expect(body?.items[items[0] as NodeId]?.price?.amount_minor).toBe(611)
      expect(body?.items[items[1] as NodeId]?.price?.amount_minor).toBe(622)
      expect(await readJson(currentPath(scope().menuId, scope().venueId))).toMatchObject({
        version: 1,
      })
    })
  })

  describe('asset-variants', () => {
    async function storeAsset(bytes: Uint8Array, width: number, height: number) {
      const id = newId('as')
      const storageKey = `tenants/${world.tenantId}/assets/${id}/original.png`
      world.stored.set(storageKey, bytes)
      await createAsset(world.pool, world.tenantId, {
        id,
        origin: 'upload',
        contentType: 'image/png',
        checksum: createHash('sha256').update(id).digest('hex'),
        width,
        height,
        storageKey,
      })
      return { id: id as AssetId, storageKey }
    }
    const variantsOf = async (id: string) =>
      (
        await world.query<{ variants: unknown }>(
          'select variants from restro.assets where id = $1',
          [id],
        )
      )[0]?.variants
    const metadataOf = async (id: AssetId, width: number) => {
      const bytes = await store.get(variantPath(id, width))
      if (bytes === null) throw new Error(`no variant w${width}`)
      return { bytes, meta: await sharp(Buffer.from(bytes)).metadata() }
    }
    const run = (assetId: string) =>
      runAssetVariants(
        {
          pool: world.pool,
          assets: { get: async (key) => world.stored.get(key) ?? null },
          store,
        },
        { tenantId: world.tenantId, assetId },
      )

    it('a 2000×1500 PNG gives three webp files of 320, 640 and 1280 px, aspect ratio kept', async () => {
      const asset = await storeAsset(await makeImage(2000, 1500), 2000, 1500)
      expect(await run(asset.id)).toMatchObject({ status: 'made', files: [320, 640, 1280] })
      for (const [width, height] of [
        [320, 240],
        [640, 480],
        [1280, 960],
      ] as const) {
        const { meta } = await metadataOf(asset.id, width)
        expect([meta.format, meta.width, meta.height]).toEqual(['webp', width, height])
      }
      expect(await variantsOf(asset.id)).toEqual({ thumb: 320, card: 640, full: 1280 })
      expect([...store.puts].sort()).toEqual(
        [320, 640, 1280].map((width) => variantPath(asset.id, width)).sort(),
      )
    })

    it('a 300 px image gets only one file, at its own width', async () => {
      const asset = await storeAsset(await makeImage(300, 200), 300, 200)
      expect(await run(asset.id)).toMatchObject({ status: 'made', files: [300] })
      expect(store.puts).toEqual([variantPath(asset.id, 300)])
      const { meta } = await metadataOf(asset.id, 300)
      expect([meta.width, meta.height]).toEqual([300, 200])
      expect(await variantsOf(asset.id)).toEqual({ thumb: 300, card: 300, full: 300 })
    })

    it('never makes a variant wider than the original (500 px: 320 and 500)', async () => {
      const asset = await storeAsset(await makeImage(500, 500), 500, 500)
      expect(await run(asset.id)).toMatchObject({ status: 'made', files: [320, 500] })
      expect(await variantsOf(asset.id)).toEqual({ thumb: 320, card: 500, full: 500 })
    })

    it('strips metadata (EXIF) and applies the orientation to the pixels', async () => {
      const original = await makeImage(400, 200, 'jpeg', {
        orientation: 6,
        exif: { IFD0: { Copyright: 'do-not-keep-this' } },
      })
      expect((await sharp(Buffer.from(original)).metadata()).exif).toBeDefined()
      const bytes = await renderVariant(original, 400)
      const meta = await sharp(Buffer.from(bytes)).metadata()
      expect(meta.exif).toBeUndefined()
      expect(meta.orientation).toBeUndefined()
      expect(Buffer.from(bytes).includes(Buffer.from('do-not-keep-this'))).toBe(false)
      // Rotated by its orientation: shown 200 wide and 400 tall.
      expect([meta.width, meta.height]).toEqual([200, 400])

      // The job plans by the shown width, so the 400 x 200 original with orientation 6 is 200 wide.
      const asset = await storeAsset(original, 400, 200)
      expect(await run(asset.id)).toMatchObject({ status: 'made', files: [200] })
      expect(await variantsOf(asset.id)).toEqual({ thumb: 200, card: 200, full: 200 })
    })

    it('is idempotent: an asset that has its variants is left alone', async () => {
      const asset = await storeAsset(await makeImage(800, 600), 800, 600)
      expect((await run(asset.id)).status).toBe('made')
      store.puts.length = 0
      expect(await run(asset.id)).toEqual({ status: 'already' })
      expect(store.puts).toEqual([])
    })

    it('throws for a missing original (the queue retries), skips what is not an image', async () => {
      const missing = await storeAsset(await makeImage(100, 100), 100, 100)
      world.stored.delete(missing.storageKey)
      await expect(run(missing.id)).rejects.toThrow(/not in the asset store/)

      const junk = await storeAsset(new TextEncoder().encode('not an image at all'), 10, 10)
      expect(await run(junk.id)).toEqual({ status: 'skipped', reason: 'unreadable' })
      expect(await variantsOf(junk.id)).toBeNull()

      expect(await run(newId('as'))).toEqual({ status: 'skipped', reason: 'unknown_asset' })
      expect(store.puts).toEqual([])
    })

    it('never puts an original or a private path in the publish store', async () => {
      const asset = await storeAsset(await makeImage(900, 900), 900, 900)
      await run(asset.id)
      expect(store.puts.every((file) => /^a\/as_[0-9A-Za-z]+\/w\d+\.webp$/.test(file))).toBe(true)
      expect(store.puts.some((file) => file.includes('original') || file.includes('tenants'))).toBe(
        false,
      )
    })

    it('feeds the next publish: the snapshot names the files, and they exist', async () => {
      const asset = await storeAsset(await makeImage(1600, 1200), 1600, 1200)
      await change([
        manual(items[0] as string, 'image', { asset_id: asset.id, alt: {}, focal: null }),
      ])
      // Before the variants exist the image is left out, not linked to nothing.
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      let body = (await loadCurrentSnapshot(world.pool, world.tenantId, scope()))?.body
      expect(body?.assets).toEqual({})

      await run(asset.id)
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      body = (await loadCurrentSnapshot(world.pool, world.tenantId, scope()))?.body
      const entry = body?.assets[asset.id]
      expect(entry?.variants).toEqual({
        thumb: `/a/${asset.id}/w320.webp`,
        card: `/a/${asset.id}/w640.webp`,
        full: `/a/${asset.id}/w1280.webp`,
      })
      for (const variant of Object.values(entry?.variants ?? {})) {
        expect(await store.get(variant.slice(1))).not.toBeNull()
      }
      // The snapshot FILE carries the same.
      const current = await loadCurrentSnapshot(world.pool, world.tenantId, scope())
      expect(
        ((await readJson(snapshotPath(current?.id as SnapshotId))) as typeof body)?.assets[asset.id]
          ?.variants.card,
      ).toBe(`/a/${asset.id}/w640.webp`)
    })

    describe('the backfill', () => {
      it('finds only assets without variants, makes them, and finds nothing the second time', async () => {
        const a = await storeAsset(await makeImage(700, 500), 700, 500)
        const b = await storeAsset(await makeImage(350, 350), 350, 350)
        const done = await storeAsset(await makeImage(900, 600), 900, 600)
        await run(done.id)
        store.puts.length = 0

        expect(new Set(await assetsWithoutVariants(world.pool, world.tenantId))).toEqual(
          new Set([a.id, b.id]),
        )
        const log = await createLogger({
          level: 'silent',
          pretty: false,
          destination: { write: () => undefined },
        })
        const deps = {
          pool: world.pool,
          log,
          assets: { get: async (key: string) => world.stored.get(key) ?? null },
          store,
        }
        // The tenants come from the organisation table, which the test world filled.
        const first = await backfillVariants(deps)
        expect(first).toEqual({ found: 2, made: 2, skipped: 0, failed: 0 })
        expect(await variantsOf(a.id)).toEqual({ thumb: 320, card: 640, full: 700 })
        expect(await variantsOf(b.id)).toEqual({ thumb: 320, card: 350, full: 350 })
        // Nothing of the finished asset was touched.
        expect(store.puts.some((file) => file.startsWith(`a/${done.id}/`))).toBe(false)

        expect(await assetsWithoutVariants(world.pool, world.tenantId)).toEqual([])
        expect(await backfillVariants(deps)).toEqual({ found: 0, made: 0, skipped: 0, failed: 0 })
      })

      it('counts a photo it cannot make and goes on with the others', async () => {
        const broken = await storeAsset(await makeImage(100, 100), 100, 100)
        world.stored.delete(broken.storageKey)
        const fine = await storeAsset(await makeImage(640, 480), 640, 480)
        const log = await createLogger({
          level: 'silent',
          pretty: false,
          destination: { write: () => undefined },
        })
        const summary = await backfillVariants({
          pool: world.pool,
          log,
          assets: { get: async (key: string) => world.stored.get(key) ?? null },
          store,
        })
        expect(summary).toEqual({ found: 2, made: 1, skipped: 0, failed: 1 })
        expect(await variantsOf(fine.id)).not.toBeNull()
        expect(await variantsOf(broken.id)).toBeNull()
      })
    })
  })
})
