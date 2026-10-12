// The table QR code files (brief S3-07), against Postgres and the in-memory barsy installation,
// through the real job handlers:
//
//   - `publish-table-tokens` writes `t/<token>.json` for every active code of a venue, with the
//     table's name (the manager's, else barsy's number), and removes the files of retired codes;
//   - it is idempotent: a second run puts nothing;
//   - a full pull that concludes a table deleted takes its code off and queues this job with the
//     token, so the file goes too; a table that is only missing keeps its code.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  LocalPublishStore,
  type PublishPutOptions,
  type PublishStore,
  readTableTokenFile,
} from '@restro/assets'
import { JOB_NAMES, prepareJob } from '@restro/core'
import {
  issueAllTableTokens,
  issueTableToken,
  listVenueTables,
  renameVenueSlug,
  retireTableToken,
  setTableName,
  tableLabel,
} from '@restro/core/apply'
import type { Job } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPublishJobs } from '../src/jobs/publish'
import type { JobDefinition } from '../src/jobs/types'
import { writeTableTokenFiles } from '../src/publish/table-tokens'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
  testSlug,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, type World } from './world'

allowSlowSetup()

const DAY = 24 * 60 * 60 * 1000

/** A publish store that remembers what was put and deleted. */
class CountingStore implements PublishStore {
  readonly puts: string[] = []
  readonly deletes: string[] = []
  constructor(readonly inner: LocalPublishStore) {}
  async put(file: string, bytes: Uint8Array, options: PublishPutOptions) {
    this.puts.push(file)
    await this.inner.put(file, bytes, options)
  }
  get(file: string) {
    return this.inner.get(file)
  }
  async delete(file: string) {
    this.deletes.push(file)
    await this.inner.delete(file)
  }
}

describe.skipIf(!hasDatabase)('the table code files', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let root: string
  let store: CountingStore
  let publishJobs: Map<string, JobDefinition>

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
    root = await mkdtemp(path.join(tmpdir(), 'restro-table-tokens-'))
    store = new CountingStore(new LocalPublishStore({ rootDir: root }))
    publishJobs = new Map(
      createPublishJobs({ publishStore: store, assetStore: { get: async () => null } }).map(
        (job) => [job.name, job],
      ),
    )
  })
  afterEach(async () => {
    await world.query('delete from restro.assets where tenant_id = $1', [world.tenantId])
    await world.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world.close()
    await rm(root, { recursive: true, force: true })
  })

  const pull = () =>
    world.run(JOB_NAMES.barsyFullPull, {
      tenantId: world.tenantId,
      integrationId: world.integrationId,
      venueId: world.venueId,
    })
  const tables = () => listVenueTables(world.pool, world.tenantId, world.venueId)
  const tableJobs = () => world.enqueued.filter((job) => job.name === JOB_NAMES.publishTableTokens)

  /** Runs `publish-table-tokens` through its registered handler, like the queue would. */
  async function runTokenJob(retired: readonly string[] = []) {
    const job = publishJobs.get(JOB_NAMES.publishTableTokens)
    if (!job) throw new Error('the publish-table-tokens job is not registered')
    const data = prepareJob(JOB_NAMES.publishTableTokens, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      retired: [...retired],
    }).data
    await job.handler(
      [
        { id: 'j', name: job.name, data, signal: new AbortController().signal },
      ] as unknown as Job<object>[],
      world.context,
    )
  }

  it('is registered as a stately queue, with the other publish jobs', () => {
    const job = publishJobs.get(JOB_NAMES.publishTableTokens)
    expect(job?.options.policy).toBe('stately')
  })

  it('writes a file per active code with the right name, repeats without writing, and follows a rename', async () => {
    await pull()
    const listed = await tables()
    expect(listed.length).toBe(fake.places.length)
    expect(await issueAllTableTokens(world.pool, world.tenantId, world.venueId)).toMatchObject({
      ok: true,
    })
    await runTokenJob()
    const coded = (await tables()).filter((table) => table.token !== null)
    expect(coded.length).toBeGreaterThan(0)
    expect(store.puts).toHaveLength(coded.length)
    for (const table of coded) {
      expect(await readTableTokenFile(store, table.token as string)).toMatchObject({
        venue_public_id: world.venuePublicId,
        venue_slug: world.venueSlug,
        organization_slug: expect.stringMatching(/^sync-/),
        table_label: tableLabel(table),
      })
    }

    // The same job again finds everything in place.
    store.puts.length = 0
    await runTokenJob()
    expect(store.puts).toEqual([])
    expect(
      await writeTableTokenFiles(
        { pool: world.pool, store },
        {
          tenantId: world.tenantId,
          venueId: world.venueId,
          retired: [],
        },
      ),
    ).toMatchObject({ status: 'done', written: 0, unchanged: coded.length, removed: 0 })

    // A manager's name replaces barsy's number on the guest page, and only that file changes.
    const first = coded[0]
    if (!first) throw new Error('no coded table')
    await setTableName(world.pool, world.tenantId, first.id, 'VIP 3')
    await runTokenJob()
    expect(store.puts).toEqual([`t/${first.token}.json`])
    expect(await readTableTokenFile(store, first.token as string)).toMatchObject({
      table_label: 'VIP 3',
    })
  })

  it('writes every file again, with the new slug and the same public code, after a venue rename', async () => {
    await pull()
    await issueAllTableTokens(world.pool, world.tenantId, world.venueId)
    await runTokenJob()
    const coded = (await tables()).filter((table) => table.token !== null)
    expect(coded.length).toBeGreaterThan(0)

    const renamed = testSlug('renamed-club')
    await renameVenueSlug(world.pool, world.tenantId, world.venueId, renamed)
    store.puts.length = 0
    await runTokenJob()
    expect(store.puts.sort()).toEqual(coded.map((table) => `t/${table.token}.json`).sort())
    for (const table of coded) {
      expect(await readTableTokenFile(store, table.token as string)).toMatchObject({
        venue_public_id: world.venuePublicId,
        venue_slug: renamed,
      })
    }
  })

  it('removes the files of retired codes: a turned-off table and a table given a new code', async () => {
    await pull()
    await issueAllTableTokens(world.pool, world.tenantId, world.venueId)
    await runTokenJob()
    const [a, b] = (await tables()).filter((table) => table.token !== null)
    if (!a || !b) throw new Error('need two coded tables')

    const off = await retireTableToken(world.pool, world.tenantId, a.id)
    const renewed = await issueTableToken(world.pool, world.tenantId, b.id)
    if (!off.ok || !renewed.ok) throw new Error('the writers refused')
    await runTokenJob([off.retired as string, renewed.retired as string])

    expect(await readTableTokenFile(store, a.token as string)).toBeNull()
    expect(await readTableTokenFile(store, b.token as string)).toBeNull()
    expect(await readTableTokenFile(store, renewed.table.token as string)).toMatchObject({
      venue_public_id: world.venuePublicId,
      venue_slug: world.venueSlug,
    })
    expect(store.deletes.sort()).toEqual([`t/${a.token}.json`, `t/${b.token}.json`].sort())
    // Again: the files are gone already, and nothing fails.
    await runTokenJob([off.retired as string])
  })

  it('never removes the file of a code that is active, whatever the job names', async () => {
    await pull()
    await issueAllTableTokens(world.pool, world.tenantId, world.venueId)
    await runTokenJob()
    const active = (await tables()).find((table) => table.token !== null)
    if (!active) throw new Error('no coded table')
    await runTokenJob([active.token as string])
    expect(await readTableTokenFile(store, active.token as string)).not.toBeNull()
  })

  it('does nothing for a venue the tenant does not have', async () => {
    expect(
      await writeTableTokenFiles(
        { pool: world.pool, store },
        {
          tenantId: world.tenantId,
          venueId: 'vn_0000000000000000000000',
          retired: ['Ab3dEfGh1jKlMnOpQrStUv'],
        },
      ),
    ).toEqual({ status: 'unknown_venue' })
    expect(store.deletes).toEqual([])
  })

  describe('a full pull that finds a table gone', () => {
    it('keeps the code of a missing table, retires the code of a deleted one and queues the job with its token', async () => {
      await pull()
      await issueAllTableTokens(world.pool, world.tenantId, world.venueId)
      await runTokenJob()
      const before = await tables()
      const gone = before.find((table) => table.token !== null)
      if (!gone) throw new Error('no coded table')
      const goneToken = gone.token as string
      // barsy stops listing that table (its place_id is the one we mapped it from).
      const [row] = await world.query<{ place_id: string }>(
        'select place_id from restro.places where table_id = $1',
        [gone.id],
      )
      fake.places = fake.places.filter((place) => String(place.place_id) !== row?.place_id)

      world.enqueued.length = 0
      await pull()
      // Missing: the table stays, with its code; only the place knows it was not listed.
      const missing = (await tables()).find((table) => table.id === gone.id)
      expect(missing).toMatchObject({ token: goneToken })
      expect(
        await world.query<{ state: string }>(
          'select state from restro.places where table_id = $1',
          [gone.id],
        ),
      ).toEqual([{ state: 'missing' }])
      expect(tableJobs()).toEqual([])

      world.clock = new Date(Date.now() + 8 * DAY)
      await pull()
      expect((await tables()).find((table) => table.id === gone.id)).toBeUndefined()
      const [stored] = await world.query<{
        state: string
        qr_token: string | null
        archived: boolean
      }>(
        `select p.state, t.qr_token, t.archived_at is not null as archived
         from restro.places p join restro.tables t on t.id = p.table_id
         where t.id = $1`,
        [gone.id],
      )
      // The token stays on the archived row, for the purge's tombstone (D83); its file is gone.
      expect(stored).toEqual({ state: 'deleted', qr_token: goneToken, archived: true })

      // The sync queued the job for the venue, naming the token.
      expect(tableJobs()).toHaveLength(1)
      const queued = tableJobs()[0]
      expect(queued?.data).toEqual({
        tenantId: world.tenantId,
        venueId: world.venueId,
        retired: [goneToken],
      })
      expect(queued?.singletonKey).toMatch(new RegExp(`^${world.venueId}:[0-9a-f]{16}$`))

      // Running it takes the file out of the store, and the guest page can no longer find the table.
      expect(await readTableTokenFile(store, goneToken)).not.toBeNull()
      await runTokenJob([goneToken])
      expect(await readTableTokenFile(store, goneToken)).toBeNull()
    })

    it('queues the job when barsy renames a table, so the guest page follows (unless it has its own name)', async () => {
      await pull()
      await issueAllTableTokens(world.pool, world.tenantId, world.venueId)
      await runTokenJob()
      const coded = (await tables()).filter((table) => table.token !== null)
      const target = coded[0]
      if (!target) throw new Error('no coded table')
      const [row] = await world.query<{ place_id: string }>(
        'select place_id from restro.places where table_id = $1',
        [target.id],
      )
      fake.places = fake.places.map((place) =>
        String(place.place_id) === row?.place_id ? { ...place, place_num: 'Renamed 1' } : place,
      )
      world.enqueued.length = 0
      await pull()
      expect(tableJobs()).toHaveLength(1)
      expect(tableJobs()[0]?.data).toMatchObject({ retired: [] })
      await runTokenJob()
      expect(await readTableTokenFile(store, target.token as string)).toMatchObject({
        table_label: 'Renamed 1',
      })
    })

    it('queues nothing when no table changed', async () => {
      await pull()
      await issueAllTableTokens(world.pool, world.tenantId, world.venueId)
      world.enqueued.length = 0
      await pull()
      expect(tableJobs()).toEqual([])
    })
  })
})
