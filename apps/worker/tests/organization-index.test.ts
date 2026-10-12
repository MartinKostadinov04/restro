// The organisation's index on the CDN (D84, D86): Postgres as restro_app, a local publish store,
// the real publish jobs. A venue is listed once its live menu is published, under its address
// name; a renamed venue keeps its old name as a redirect entry; an unpublished or deleted venue
// leaves the list (and loses its own index file); a renamed organisation gets its index under the
// new slug and a redirect under the old one.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  LocalPublishStore,
  organizationIndexPath,
  readOrganizationFile,
  readVenueIndex,
  venueIndexPath,
} from '@restro/assets'
import { type ChangeSet, JOB_NAMES, type NodeId, newId, prepareJob } from '@restro/core'
import {
  apply,
  archiveVenue,
  recordOrganizationSlug,
  renameVenueSlug,
  unpublishVenue,
} from '@restro/core/apply'
import type { Job } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPublishJobs } from '../src/jobs/publish'
import type { JobDefinition } from '../src/jobs/types'
import { writeOrganizationIndex } from '../src/publish/organization-index'
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

describe.skipIf(!hasDatabase)('the organisation index (o/<slug>.json)', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let root: string
  let store: LocalPublishStore
  let jobs: Map<string, JobDefinition>
  let organizationSlug: string

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
  const index = (slug = organizationSlug) => readOrganizationFile(store, slug)
  const publish = () =>
    runJob(
      JOB_NAMES.publishMenu,
      prepareJob(JOB_NAMES.publishMenu, {
        tenantId: world.tenantId,
        menuId: world.menuId,
        venueId: world.venueId,
        reason: 'manual',
        actor: 'user:us_test',
      }).data,
    )
  const files = () =>
    runJob(JOB_NAMES.publishFiles, {
      tenantId: world.tenantId,
      menuId: world.menuId,
      venueId: world.venueId,
    })

  beforeAll(async () => {
    db = await createTestDatabase()
    fake.listen()
    root = await mkdtemp(path.join(tmpdir(), 'restro-worker-organization-'))
    store = new LocalPublishStore({ rootDir: root })
    world = await createWorld(fake, { database: db })
    jobs = new Map(
      createPublishJobs({
        publishStore: store,
        assetStore: { get: async (key) => world.stored.get(key) ?? null },
      }).map((job) => [job.name, job]),
    )
    const [organization] = await world.query<{ slug: string }>(
      'select slug from restro.auth_organization where id = $1',
      [world.tenantId],
    )
    organizationSlug = organization?.slug ?? ''
    // One section with one priced item, so the menu can be published (V10).
    const section = newId('nd')
    const item = newId('nd')
    const manual = (node: string, fieldKey: string, value: unknown) => ({
      op: 'setField',
      node: { id: node },
      fieldKey,
      layer: 'manual',
      scope: 'master',
      value,
    })
    const result = await apply(world.pool, world.tenantId, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: world.menuId },
          status: 'active',
          sortKey: 'end',
        },
        manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: 'Мохито', en_US: 'Mojito' }),
        manual(item, 'price', { amount_minor: 900, currency: 'EUR' }),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      ],
    } as ChangeSet)
    expect(result.rejected).toEqual([])
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await world?.query('delete from restro.organization_slug_history where organization_id = $1', [
      world.tenantId,
    ])
    await world?.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world?.close()
    fake.close()
    await db?.drop()
    await rm(root, { recursive: true, force: true })
  })

  it('lists nothing before a publish, and the venue once its live menu is published', async () => {
    expect(organizationSlug).toMatch(/^sync-/)
    expect(await writeOrganizationIndex({ pool: world.pool, store }, world.tenantId)).toEqual({
      status: 'done',
      slug: organizationSlug,
      venues: 0,
      written: [organizationIndexPath(organizationSlug)],
    })
    expect(await index()).toEqual({
      organization_id: world.tenantId,
      slug: organizationSlug,
      venues: {},
      old_names: {},
    })

    await publish()
    expect(await index()).toEqual({
      organization_id: world.tenantId,
      slug: organizationSlug,
      venues: {
        [world.venueSlug]: {
          venue_id: world.venueId,
          menu_id: world.menuId,
          public_id: world.venuePublicId,
        },
      },
      old_names: {},
    })
    // The venue's own file names the organisation, so the old address leads to the new one.
    expect(await readVenueIndex(store, world.venuePublicId)).toEqual({
      venue_id: world.venueId,
      menu_id: world.menuId,
      slug: world.venueSlug,
      organization: organizationSlug,
    })
    // Nothing to write the second time.
    const again = await writeOrganizationIndex({ pool: world.pool, store }, world.tenantId)
    expect(again.status === 'done' ? again.written : again).toEqual([])
    expect(await writeOrganizationIndex({ pool: world.pool, store }, newId('tn'))).toEqual({
      status: 'unknown_organization',
    })
  })

  it('a renamed venue is listed under its new name, with the old one leading to it', async () => {
    const renamed = testSlug('renamed-club')
    const before = world.venueSlug
    await renameVenueSlug(world.pool, world.tenantId, world.venueId, renamed)
    await files()
    const file = await index()
    expect(file && 'venues' in file ? Object.keys(file.venues) : null).toEqual([renamed])
    expect(file && 'old_names' in file ? file.old_names : null).toEqual({ [before]: renamed })
  })

  it('an unpublished venue leaves the list and loses its file; a publish brings it back', async () => {
    await unpublishVenue(world.pool, world.tenantId, world.venueId)
    await files()
    const gone = await index()
    expect(gone && 'venues' in gone ? gone.venues : null).toEqual({})
    expect(await readVenueIndex(store, world.venuePublicId)).toBeNull()

    await publish()
    const back = await index()
    expect(back && 'venues' in back ? Object.keys(back.venues) : null).toHaveLength(1)
    expect(await readVenueIndex(store, world.venuePublicId)).not.toBeNull()
  })

  it('a renamed organisation gets its index under the new slug and a redirect under the old', async () => {
    const renamed = testSlug('night-group')
    await world.query('update restro.auth_organization set slug = $2 where id = $1', [
      world.tenantId,
      renamed,
    ])
    expect(
      await recordOrganizationSlug(world.pool, {
        organizationId: world.tenantId,
        previousSlug: organizationSlug,
      }),
    ).toEqual({ ok: true, recorded: true })
    await runJob(JOB_NAMES.publishOrganizationIndex, { tenantId: world.tenantId })
    expect(await index(organizationSlug)).toEqual({ redirect_to: renamed })
    const moved = await index(renamed)
    expect(moved && 'slug' in moved ? moved.slug : null).toBe(renamed)
    expect(moved && 'venues' in moved ? Object.keys(moved.venues) : null).toHaveLength(1)
    organizationSlug = renamed
  })

  it('a deleted venue leaves the list', async () => {
    await archiveVenue(world.pool, world.tenantId, world.venueId)
    await files()
    const file = await index()
    expect(file && 'venues' in file ? file.venues : null).toEqual({})
    expect(await readVenueIndex(store, world.venuePublicId)).toBeNull()
    // A `t/` file is never written for it either; `venueIndexPath` is the only `v/` path.
    expect(venueIndexPath(world.venuePublicId)).toBe(`v/${world.venuePublicId}.json`)
    expect(world.menuId as NodeId).toMatch(/^nd_/)
  })
})
