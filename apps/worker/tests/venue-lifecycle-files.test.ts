// A deleted venue and the files a guest reads (brief CF-18, D76): Postgres as restro_app, a local
// publish store in a temporary folder and the publish jobs' real handlers.
//
//   - publish-files takes the venue index `v/<code>.json` out of the store for a deleted venue, so
//     `/m/<slug>-<code>` is "not available", and writes it again after a restore and a publish;
//   - the table files job withdraws `t/<token>.json` without retiring the tokens, so a restore (and
//     the till linked again) brings the same files back;
//   - a job that started before the deletion cannot bring the page back: whichever job runs last
//     leaves what the database says;
//   - a publish, a live overlay and the schedules for a deleted venue end skipped, writing nothing.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  currentPath,
  LocalPublishStore,
  livePath,
  type PublishPutOptions,
  type PublishStore,
  readTableTokenFile,
  readVenueIndex,
  tableTokenPath,
  venueIndexPath,
  writeTableTokenFile,
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
  issueTableToken,
  listVenueTables,
  mapBarsyVenue,
  restoreVenue,
  upsertPlaces,
} from '@restro/core/apply'
import type { Job } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPublishJobs } from '../src/jobs/publish'
import type { JobDefinition } from '../src/jobs/types'
import { writePublishFiles } from '../src/publish/files'
import { queueLiveRollovers } from '../src/publish/rollover'
import { writeTableTokenFiles } from '../src/publish/table-tokens'
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

/** A publish store that runs a hook after a put (a deletion that lands in the middle of a job). */
class HookedStore implements PublishStore {
  afterPut: ((file: string) => Promise<void>) | null = null
  readonly puts: string[] = []
  constructor(readonly inner: LocalPublishStore) {}
  async put(file: string, bytes: Uint8Array, options: PublishPutOptions) {
    this.puts.push(file)
    await this.inner.put(file, bytes, options)
    const hook = this.afterPut
    if (hook !== null) await hook(file)
  }
  get(file: string) {
    return this.inner.get(file)
  }
  delete(file: string) {
    return this.inner.delete(file)
  }
}

describe.skipIf(!hasDatabase)('a deleted venue and the files guests read (CF-18)', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let root: string
  let store: HookedStore
  let jobs: Map<string, JobDefinition>
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

  const scope = () => ({ menuId: world.menuId as NodeId, venueId: world.venueId as VenueId })
  const tenantId = () => world.tenantId
  const publishPayload = () =>
    prepareJob(JOB_NAMES.publishMenu, {
      tenantId: world.tenantId,
      menuId: world.menuId,
      venueId: world.venueId,
      reason: 'manual',
      actor: 'user:us_test',
    }).data
  const scopePayload = () => ({
    tenantId: world.tenantId,
    menuId: world.menuId,
    venueId: world.venueId,
  })

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
    world.query<{ status: string; error_summary: string | null }>(
      `select status, error_summary from restro.job_runs
       where tenant_id = $1 and kind = $2 order by created_at`,
      [world.tenantId, kind],
    )
  const indexNow = () => readVenueIndex(store, world.venuePublicId)
  const snapshotCount = async () =>
    Number(
      (
        await world.query<{ n: string }>(
          'select count(*) as n from restro.snapshots where tenant_id = $1',
          [world.tenantId],
        )
      )[0]?.n,
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
    root = await mkdtemp(path.join(tmpdir(), 'restro-worker-cf18-'))
    store = new HookedStore(new LocalPublishStore({ rootDir: root }))
    world = await createWorld(fake, { database: db })
    section = newId('nd')
    items = Array.from({ length: 3 }, () => newId('nd'))
    jobs = new Map(
      createPublishJobs({
        publishStore: store,
        assetStore: { get: async (key) => world.stored.get(key) ?? null },
      }).map((job) => [job.name, job]),
    )
    const result = await apply(
      world.pool,
      world.tenantId,
      changeSet([
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
      ]),
    )
    expect(result.rejected).toEqual([])
  })
  afterEach(async () => {
    await world.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world.close()
    await rm(root, { recursive: true, force: true })
  })

  describe('the venue index (publish-files)', () => {
    it('withdraws the index of a deleted venue and writes it back after a restore and a publish', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      expect(await indexNow()).toMatchObject({ venue_id: world.venueId, menu_id: world.menuId })
      const pointer = currentPath(scope().menuId, scope().venueId)
      expect(await store.get(pointer)).not.toBeNull()

      await archiveVenue(world.pool, tenantId(), world.venueId)
      await runJob(JOB_NAMES.publishFiles, scopePayload())
      // The address is gone: this is what makes `/m/<slug>-<code>` say "not available".
      expect(await indexNow()).toBeNull()
      expect(await store.get(venueIndexPath(world.venuePublicId))).toBeNull()
      // The snapshot, the pointer and the overlay stay (unreachable without the index).
      expect(await store.get(pointer)).not.toBeNull()
      const run = (await runsOf('publish_files')).at(-1)
      expect(run).toMatchObject({ status: 'completed' })
      expect(run?.error_summary).toContain('deleted')

      // Running it again finds the work done.
      const puts = store.puts.length
      await runJob(JOB_NAMES.publishFiles, scopePayload())
      expect(await indexNow()).toBeNull()
      expect(store.puts).toHaveLength(puts)

      // Restore, then publish: the same address answers again.
      await restoreVenue(world.pool, tenantId(), world.venueId)
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      expect(await indexNow()).toMatchObject({ venue_id: world.venueId, menu_id: world.menuId })
    })

    it('does not touch an index that names another venue', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      const other = newId('vn')
      const file = venueIndexPath(world.venuePublicId)
      const foreign = new TextEncoder().encode(
        JSON.stringify({ venue_id: other, menu_id: newId('nd'), slug: 'someone-else' }),
      )
      await store.inner.put(file, foreign, { contentType: 'application/json', cacheControl: '' })
      await archiveVenue(world.pool, tenantId(), world.venueId)
      const result = await writePublishFiles(
        { pool: world.pool, store, now: () => new Date() },
        { tenantId: world.tenantId, ...scope() },
      )
      expect(result).toMatchObject({ status: 'withdrawn', removed: false })
      const left = await store.get(file)
      expect(left === null ? null : new TextDecoder().decode(left)).toBe(
        new TextDecoder().decode(foreign),
      )
    })

    it('a publish that started before the deletion cannot bring the page back (the last run wins)', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      // Lose the index, so the next run has to write it, and delete the venue in the middle of it:
      // right after the index is put. The run looks again and takes it out.
      await store.delete(venueIndexPath(world.venuePublicId))
      store.afterPut = async (file) => {
        if (file === venueIndexPath(world.venuePublicId)) {
          store.afterPut = null
          await archiveVenue(world.pool, tenantId(), world.venueId)
        }
      }
      await runJob(JOB_NAMES.publishFiles, scopePayload())
      expect(store.puts).toContain(venueIndexPath(world.venuePublicId))
      expect(await indexNow()).toBeNull()
    })

    it('a publish queued before the deletion ends skipped: no run, no snapshot, no file', async () => {
      await archiveVenue(world.pool, tenantId(), world.venueId)
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      expect(await snapshotCount()).toBe(0)
      expect(store.puts).toEqual([])
      expect(await runsOf('publish_menu')).toEqual([])
      expect(world.logLines.join('\n')).toContain('publish skipped')
      expect(world.enqueued).toEqual([])
    })

    it('an automatic publish after a sync is skipped the same way, and queues no table files', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      await archiveVenue(world.pool, tenantId(), world.venueId)
      world.enqueued.length = 0
      store.puts.length = 0
      const auto = prepareJob(JOB_NAMES.publishMenu, {
        tenantId: world.tenantId,
        menuId: world.menuId,
        venueId: world.venueId,
        reason: 'auto_sync',
        actor: 'system',
      }).data
      await runJob(JOB_NAMES.publishMenu, auto)
      expect(store.puts).toEqual([])
      expect(world.enqueued).toEqual([])
    })

    it('the live overlay of a deleted venue is not written, and the rollover does not ask for it', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      const live = livePath(scope().menuId, scope().venueId)
      await store.delete(live)
      await archiveVenue(world.pool, tenantId(), world.venueId)
      await runJob(JOB_NAMES.publishLive, scopePayload())
      expect(await store.get(live)).toBeNull()

      const asked: string[] = []
      const report = await queueLiveRollovers({
        pool: world.pool,
        log: world.context.log,
        now: () => new Date(),
        enqueue: async (_name, data) => {
          asked.push(String((data as { venueId?: string }).venueId))
          return 'queued'
        },
        asks: new Map(),
      })
      expect(report.failed).toBe(0)
      expect(asked).not.toContain(world.venueId)
    })

    it('a publish queues the venue’s table files, which is what brings them back after a restore', async () => {
      await runJob(JOB_NAMES.publishMenu, publishPayload())
      const tableJobs = world.enqueued.filter((job) => job.name === JOB_NAMES.publishTableTokens)
      expect(tableJobs.map((job) => job.data)).toEqual([
        { tenantId: world.tenantId, venueId: world.venueId, retired: [] },
      ])
    })
  })

  describe('the table files (publish-table-tokens)', () => {
    /** Two tables of the venue's till venue, each with a code and its file. */
    async function twoTables() {
      await upsertPlaces(
        world.pool,
        world.tenantId,
        world.integrationId,
        DEMO_BID,
        [
          { placeId: 'a1', placeNum: '1', salonName: 'Hall', isPublic: true },
          { placeId: 'a2', placeNum: '2', salonName: 'Hall', isPublic: true },
        ],
        { pagesOk: [true] },
      )
      const tokens: string[] = []
      for (const table of await listVenueTables(world.pool, world.tenantId, world.venueId)) {
        const issued = await issueTableToken(world.pool, world.tenantId, table.id)
        if (!issued.ok) throw new Error(issued.reason)
        tokens.push(issued.table.token ?? '')
      }
      await runJob(JOB_NAMES.publishTableTokens, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        retired: [],
      })
      return tokens
    }
    const files = (tokens: string[]) =>
      Promise.all(tokens.map((token) => readTableTokenFile(store, token)))

    it('withdraws the files of a deleted venue, keeps the tokens, and a restore brings the same files back', async () => {
      const tokens = await twoTables()
      const written = await files(tokens)
      expect(written.every((file) => file?.venue_public_id === world.venuePublicId)).toBe(true)
      const bytesBefore = await Promise.all(tokens.map((t) => store.get(tableTokenPath(t))))

      const archived = await archiveVenue(world.pool, tenantId(), world.venueId)
      expect(archived.tableTokens).toEqual([...tokens].sort())
      await runJob(JOB_NAMES.publishTableTokens, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        retired: archived.tableTokens,
      })
      // /t/<token> finds nothing: "not active".
      expect(await files(tokens)).toEqual([null, null])
      // The codes were not retired: they are still on the tables.
      const stored = await world.query<{ qr_token: string }>(
        'select qr_token from restro.tables where venue_id = $1',
        [world.venueId],
      )
      expect(stored.map((row) => row.qr_token).sort()).toEqual([...tokens].sort())

      // A repeated job finds the work done.
      await runJob(JOB_NAMES.publishTableTokens, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        retired: archived.tableTokens,
      })
      expect(await files(tokens)).toEqual([null, null])

      // Restore: the venue comes back as a Draft (D86, unpublished) with its till venue linked
      // again (adjustments V1), so nothing is served until it is published; the tables are the
      // venue's own (D95), so the publish brings the same files back.
      expect(await restoreVenue(world.pool, tenantId(), world.venueId)).toMatchObject({
        relinked: true,
      })
      await runJob(JOB_NAMES.publishTableTokens, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        retired: [],
      })
      expect(await files(tokens)).toEqual([null, null])
      // What a publish does to the flag (the world's menu has no items to publish, V10).
      await world.query('update restro.venues set unpublished_at = null where id = $1', [
        world.venueId,
      ])
      await runJob(JOB_NAMES.publishTableTokens, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        retired: [],
      })
      const bytesAfter = await Promise.all(tokens.map((t) => store.get(tableTokenPath(t))))
      expect(bytesAfter).toEqual(bytesBefore)
      const linked = await mapBarsyVenue(
        world.pool,
        world.tenantId,
        world.integrationId,
        DEMO_BID,
        world.venueId,
      )
      expect(linked.ok).toBe(true)
      expect(await listVenueTables(world.pool, world.tenantId, world.venueId)).toHaveLength(2)
      await runJob(JOB_NAMES.publishTableTokens, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        retired: [],
      })
      expect(await Promise.all(tokens.map((t) => store.get(tableTokenPath(t))))).toEqual(
        bytesBefore,
      )
    })

    it('leaves alone a file that meanwhile belongs to another venue', async () => {
      const tokens = await twoTables()
      const archived = await archiveVenue(world.pool, tenantId(), world.venueId)
      // The first token now leads to another venue (its till venue was linked to one).
      await writeTableTokenFile(store, tokens[0] ?? '', {
        venue_public_id: 'zzzzzzzzzzzz',
        venue_slug: 'someone-else',
        table_label: '1',
      })
      const result = await writeTableTokenFiles(
        { pool: world.pool, store },
        { tenantId: world.tenantId, venueId: world.venueId, retired: archived.tableTokens },
      )
      expect(result).toEqual({ status: 'withdrawn', removed: 1 })
      expect((await readTableTokenFile(store, tokens[0] ?? ''))?.venue_public_id).toBe(
        'zzzzzzzzzzzz',
      )
      expect(await readTableTokenFile(store, tokens[1] ?? '')).toBeNull()
    })

    it('a job that started before the deletion cannot bring the codes back (the last run wins)', async () => {
      const tokens = await twoTables()
      for (const token of tokens) await store.delete(tableTokenPath(token))
      // Delete the venue right after the first file is put: the run looks again and takes back
      // what it wrote.
      store.afterPut = async (file) => {
        if (file.startsWith('t/')) {
          store.afterPut = null
          await archiveVenue(world.pool, tenantId(), world.venueId)
        }
      }
      const result = await writeTableTokenFiles(
        { pool: world.pool, store },
        { tenantId: world.tenantId, venueId: world.venueId, retired: [] },
      )
      expect(result).toMatchObject({ status: 'withdrawn' })
      expect(await files(tokens)).toEqual([null, null])
    })

    it('a deleted venue with no tokens to withdraw is not an error', async () => {
      await archiveVenue(world.pool, tenantId(), world.venueId)
      const result = await writeTableTokenFiles(
        { pool: world.pool, store },
        { tenantId: world.tenantId, venueId: world.venueId, retired: [] },
      )
      expect(result).toEqual({ status: 'withdrawn', removed: 0 })
    })
  })
})
