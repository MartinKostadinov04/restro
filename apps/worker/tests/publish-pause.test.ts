// The pause of automatic publishing after a rollback (brief S3-05): Postgres as restro_app, the
// publish jobs' real handlers, a local publish store in a temporary folder.
//
//   - while `config.publish.auto_paused` is set, an `auto_sync` publish does not run, whoever
//     queued it (a sync, a photo, a job that was already waiting), and neither trigger queues one;
//   - a manual publish runs while paused, and resumes automatic publishing when it goes through;
//   - a manual publish that is refused leaves the pause alone.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalPublishStore } from '@restro/assets'
import { autoPublishPaused, type ChangeSet, JOB_NAMES, type NodeId, newId } from '@restro/core'
import { apply, createAsset, setAutoPublishPaused } from '@restro/core/apply'
import type { Job } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPublishJobs } from '../src/jobs/publish'
import type { JobDefinition } from '../src/jobs/types'
import {
  autoPublishIsPaused,
  queuePublishAfterSync,
  queuePublishForAsset,
  resumeAutoPublish,
} from '../src/publish/after-sync'
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

describe.skipIf(!hasDatabase)('the pause of automatic publishing after a rollback', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let root: string
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
  async function change(ops: unknown[]) {
    const result = await apply(world.pool, world.tenantId, changeSet(ops))
    expect(result.rejected).toEqual([])
  }

  const payload = (reason: 'manual' | 'auto_sync') => ({
    tenantId: world.tenantId,
    menuId: world.menuId,
    venueId: world.venueId,
    reason,
    actor: reason === 'manual' ? 'user:us_test' : `integration:${world.integrationId}`,
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
  const pause = () => setAutoPublishPaused(world.pool, world.tenantId, world.integrationId, true)
  const configOf = async () =>
    (
      await world.query<{ config: unknown }>(
        'select config from restro.integrations where id = $1',
        [world.integrationId],
      )
    )[0]?.config
  const versions = async () =>
    (
      await world.query<{ version: number; reason: string }>(
        `select version, reason from restro.snapshots where tenant_id = $1 and menu_id = $2
         order by version`,
        [world.tenantId, world.menuId],
      )
    ).map((row) => `${row.version}:${row.reason}`)
  const runs = () =>
    world.query<{ status: string; error_summary: string | null }>(
      `select status, error_summary from restro.job_runs
       where tenant_id = $1 and kind = 'publish_menu' order by created_at`,
      [world.tenantId],
    )
  const queued = () => world.enqueued.filter((job) => job.name === JOB_NAMES.publishMenu)

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
    root = await mkdtemp(path.join(tmpdir(), 'restro-worker-pause-'))
    world = await createWorld(fake, { database: db })
    section = newId('nd')
    items = Array.from({ length: 3 }, () => newId('nd'))
    jobs = new Map(
      createPublishJobs({
        publishStore: new LocalPublishStore({ rootDir: root }),
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
    await world.query('delete from restro.assets where tenant_id = $1', [world.tenantId])
    await world.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world.close()
    await rm(root, { recursive: true, force: true })
  })

  describe('the publish-menu job', () => {
    it('does not run an automatic publish while paused: no snapshot, no run, no files', async () => {
      await runJob(JOB_NAMES.publishMenu, payload('manual'))
      await change([manual(items[0] as string, 'price', eur(777))])
      await pause()

      await runJob(JOB_NAMES.publishMenu, payload('auto_sync'))

      expect(await versions()).toEqual(['1:manual'])
      expect((await runs()).length).toBe(1)
      expect(world.logLines.join('\n')).toContain('automatic publish skipped')
      expect(autoPublishPaused(await configOf())).toBe(true)
    })

    it('a job that was queued before the pause is stopped too (the pause is read when it runs)', async () => {
      await runJob(JOB_NAMES.publishMenu, payload('manual'))
      await change([manual(items[0] as string, 'price', eur(777))])
      // Queued while not paused; the rollback comes before it runs.
      const waiting = payload('auto_sync')
      await pause()
      await runJob(JOB_NAMES.publishMenu, waiting)
      expect(await versions()).toEqual(['1:manual'])
    })

    it('publishes automatically again once it is not paused', async () => {
      await runJob(JOB_NAMES.publishMenu, payload('manual'))
      await change([manual(items[0] as string, 'price', eur(777))])
      await pause()
      await runJob(JOB_NAMES.publishMenu, payload('auto_sync'))
      await setAutoPublishPaused(world.pool, world.tenantId, world.integrationId, false)
      await runJob(JOB_NAMES.publishMenu, payload('auto_sync'))
      expect(await versions()).toEqual(['1:manual', '2:auto_sync'])
    })

    it('a manual publish runs while paused, and resumes automatic publishing', async () => {
      await runJob(JOB_NAMES.publishMenu, payload('manual'))
      await change([manual(items[0] as string, 'price', eur(777))])
      await pause()

      await runJob(JOB_NAMES.publishMenu, payload('manual'))

      expect(await versions()).toEqual(['1:manual', '2:manual'])
      expect(autoPublishPaused(await configOf())).toBe(false)
      const last = (await runs()).at(-1)
      expect(last?.status).toBe('completed')
      expect(last?.error_summary).toContain('automatic publishing is on again')

      await change([manual(items[1] as string, 'price', eur(888))])
      await runJob(JOB_NAMES.publishMenu, payload('auto_sync'))
      expect(await versions()).toEqual(['1:manual', '2:manual', '3:auto_sync'])
    })

    it('a manual publish that finds nothing new resumes it as well', async () => {
      await runJob(JOB_NAMES.publishMenu, payload('manual'))
      await pause()
      await runJob(JOB_NAMES.publishMenu, payload('manual'))
      expect(await versions()).toEqual(['1:manual'])
      expect(autoPublishPaused(await configOf())).toBe(false)
    })

    it('leaves the other publish settings alone when it resumes', async () => {
      await world.query(
        `update restro.integrations set config = config || '{"publish":{"after_sync":"auto","new_items":"hold"}}'::jsonb
         where id = $1`,
        [world.integrationId],
      )
      await pause()
      await runJob(JOB_NAMES.publishMenu, payload('manual'))
      expect((await configOf()) as object).toMatchObject({
        publish: { after_sync: 'auto', new_items: 'hold' },
      })
      expect(autoPublishPaused(await configOf())).toBe(false)
    })

    it('a refused manual publish (V10) leaves the pause in place', async () => {
      await runJob(JOB_NAMES.publishMenu, payload('manual'))
      await pause()
      await change(items.map((id) => manual(id, 'visible', false)))
      await runJob(JOB_NAMES.publishMenu, payload('manual'))
      expect((await runs()).at(-1)?.status).toBe('failed')
      expect(autoPublishPaused(await configOf())).toBe(true)
    })

    it('a venue with no integration has nothing to pause: automatic publishes run', async () => {
      await world.query(
        'update restro.barsy_venues set venue_id = null where integration_id = $1',
        [world.integrationId],
      )
      await pause()
      expect(await autoPublishIsPaused(world, world)).toBe(false)
      await runJob(JOB_NAMES.publishMenu, payload('auto_sync'))
      expect(await versions()).toEqual(['1:auto_sync'])
    })
  })

  describe('the two triggers', () => {
    const env = () => ({ pool: world.pool, log: world.env.log, enqueue: world.env.enqueue })
    const target = (config: unknown) => ({
      tenantId: world.tenantId,
      integrationId: world.integrationId,
      venueId: world.venueId,
      config,
    })

    it('a sync queues no publish while paused', async () => {
      const note = await queuePublishAfterSync(env(), target({ publish: { auto_paused: true } }), 5)
      expect(note).toContain('paused after a rollback')
      expect(queued()).toEqual([])
      // Not paused: the same sync queues one.
      await queuePublishAfterSync(env(), target({}), 5)
      expect(queued()).toHaveLength(1)
    })

    it('a photo that arrives queues no publish while paused', async () => {
      const assetId = newId('as')
      await createAsset(world.pool, world.tenantId, {
        id: assetId,
        origin: 'barsy',
        contentType: 'image/png',
        checksum: 'a'.repeat(64),
        width: 8,
        height: 8,
        storageKey: `tenants/${world.tenantId}/assets/${assetId}/original.png`,
      })
      await change([
        manual(items[0] as string, 'image', { asset_id: assetId, alt: {}, focal: null }),
      ])

      await pause()
      const paused = await queuePublishForAsset(env(), { tenantId: world.tenantId, assetId })
      expect(paused).toHaveLength(1)
      expect(paused[0]).toContain('paused after a rollback')
      expect(queued()).toEqual([])

      await setAutoPublishPaused(world.pool, world.tenantId, world.integrationId, false)
      await queuePublishForAsset(env(), { tenantId: world.tenantId, assetId })
      expect(queued()).toHaveLength(1)
      expect(queued()[0]?.data).toMatchObject({ reason: 'auto_sync' })
    })
  })

  it('resumeAutoPublish says whether it was paused, and writes only then', async () => {
    expect(await resumeAutoPublish(world, world)).toBe(false)
    await pause()
    expect(await resumeAutoPublish(world, world)).toBe(true)
    expect(autoPublishPaused(await configOf())).toBe(false)
    expect(await resumeAutoPublish(world, world)).toBe(false)
  })
})
