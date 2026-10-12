// A deleted venue and the sync (brief CF-18, D76): Postgres as restro_app, the jobs' real handlers,
// the in-memory barsy installation.
//
//   - a sync queued for a deleted (or unlinked) venue ends skipped: no run, no failure, no call to
//     the till, no write;
//   - the schedule never queues a deleted venue, not even when its link is still there;
//   - a till venue released by a deletion and linked to another venue builds that venue's own
//     sections; the deleted venue's nodes are neither moved nor reused (the CF-16 keys).
import { JOB_NAMES, type NodeId } from '@restro/core'
import {
  archiveVenue,
  mapBarsyVenue,
  provisionMenu,
  provisionVenue,
  restoreVenue,
  setCatalogueRoot,
} from '@restro/core/apply'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Test-only reach into barsy's mapping test data: the category tree of catalogue 72 (the same
// import sync-venues.test.ts makes).
import { C72_ROOT, catalogue72Tree } from '../../../packages/barsy/src/mapping/test-data.ts'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
  testSlug,
} from './database'
import { createFakeBarsy, fixtureJson } from './fake-barsy'
import { createWorld, DEMO_BID, type World } from './world'

type Json = Record<string, unknown>

allowSlowSetup()

describe.skipIf(!hasDatabase)('a deleted venue and the sync (CF-18)', () => {
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
    await world.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world.close()
  })

  const payload = (venueId = world.venueId) => ({
    tenantId: world.tenantId,
    integrationId: world.integrationId,
    venueId,
  })
  const runs = () =>
    world.query<{ kind: string; status: string }>(
      'select kind, status from restro.job_runs where tenant_id = $1',
      [world.tenantId],
    )
  const count = async (table: string) =>
    Number(
      (
        await world.query<{ n: string }>(
          `select count(*) as n from restro.${table} where tenant_id = $1`,
          [world.tenantId],
        )
      )[0]?.n,
    )

  describe('a sync queued for a deleted venue', () => {
    it.each([
      ['a full pull', JOB_NAMES.barsyFullPull],
      ['a change check', JOB_NAMES.barsyIncremental],
      ['a places read', JOB_NAMES.placesRead],
    ])('%s ends skipped: no run, no call to the till, nothing written', async (_label, name) => {
      await archiveVenue(world.pool, world.tenantId, world.venueId)
      const before = { nodes: await count('nodes'), links: await count('source_links') }
      world.logLines.length = 0

      await expect(world.run(name, payload())).resolves.toBeUndefined()

      expect(await runs()).toEqual([])
      expect(fake.calls).toHaveLength(0)
      expect(world.enqueued).toEqual([])
      expect({ nodes: await count('nodes'), links: await count('source_links') }).toEqual(before)
      expect(world.logLines.join('\n')).toContain('sync skipped: this venue was deleted')
    })

    it('also when its link is still there (a deletion the release has not reached)', async () => {
      await world.query('update restro.venues set archived_at = now() where id = $1', [
        world.venueId,
      ])
      await world.run(JOB_NAMES.barsyFullPull, payload())
      expect(await runs()).toEqual([])
      expect(fake.calls).toHaveLength(0)
    })

    it('after a restore the same sync is unlinked, and skipped for that reason, until the till is linked again', async () => {
      await archiveVenue(world.pool, world.tenantId, world.venueId)
      await restoreVenue(world.pool, world.tenantId, world.venueId)
      world.logLines.length = 0
      await world.run(JOB_NAMES.barsyFullPull, payload())
      expect(await runs()).toEqual([])
      expect(fake.calls).toHaveLength(0)
      expect(world.logLines.join('\n')).toContain('not linked')

      // Linked again, it runs.
      await mapBarsyVenue(world.pool, world.tenantId, world.integrationId, DEMO_BID, world.venueId)
      await world.run(JOB_NAMES.barsyFullPull, payload())
      expect((await runs()).map((run) => run.status)).toEqual(['completed'])
    })
  })

  describe('the schedule', () => {
    const tick = async () => {
      world.enqueued.length = 0
      world.clock = new Date('2026-10-10T09:07:20Z')
      await world.run(JOB_NAMES.barsySyncTick, {})
      return world.enqueued
    }

    it('queues a live venue, and never a deleted one (also with its link still in place)', async () => {
      expect((await tick()).map((job) => job.name)).toContain(JOB_NAMES.barsyFullPull)

      await world.query(`update restro.integrations set config = config - 'sync' where id = $1`, [
        world.integrationId,
      ])
      // The deletion that has not released the link yet: the join on the venue is the second line.
      await world.query('update restro.venues set archived_at = now() where id = $1', [
        world.venueId,
      ])
      expect(await tick()).toEqual([])
      await world.query('update restro.venues set archived_at = null where id = $1', [
        world.venueId,
      ])
      // And the real deletion, which releases the link.
      await archiveVenue(world.pool, world.tenantId, world.venueId)
      expect(await tick()).toEqual([])
    })

    it('never queues anything of a removed instance (D81), and queues again if it is not removed', async () => {
      await world.query('update restro.integrations set removed_at = now() where id = $1', [
        world.integrationId,
      ])
      expect(await tick()).toEqual([])
      await world.query('update restro.integrations set removed_at = null where id = $1', [
        world.integrationId,
      ])
      expect((await tick()).map((job) => job.name)).toContain(JOB_NAMES.barsyFullPull)
    })
  })

  describe('a till venue released by a deletion and linked to another venue (CF-16 keys)', () => {
    const sections = (menuId: string) =>
      world.query<{ external_id: string; node_id: string; parent_id: string }>(
        `with recursive tree as (
           select id, parent_id from restro.nodes where parent_id = $2
           union
           select n.id, n.parent_id from restro.nodes n join tree t on n.parent_id = t.id
         )
         select sl.external_id, t.id as node_id, t.parent_id from tree t
         join restro.source_links sl on sl.node_id = t.id
         where sl.integration_id = $1 and sl.external_type = 'category'`,
        [world.integrationId, menuId],
      )
    const nodeRows = (ids: string[]) =>
      world.query(
        `select id, parent_id, node_type, status, sort_key, revision from restro.nodes
         where id = any($1::text[])`,
        [ids],
      )
    const linkRows = (ids: string[]) =>
      world.query(
        `select external_id, node_id, state, state_changed_at, last_hash from restro.source_links
         where integration_id = $1 and external_type = 'category' and node_id = any($2::text[])`,
        [world.integrationId, ids],
      )
    const placementRows = (ids: string[]) =>
      world.query(
        'select section_id, item_id, sort_key from restro.placements where section_id = any($1::text[])',
        [ids],
      )
    const byKey = <T extends Json>(rows: T[], key: (row: T) => string) =>
      [...rows].sort((a, b) => {
        const left = key(a)
        const right = key(b)
        return left < right ? -1 : left > right ? 1 : 0
      })

    it("builds the other venue's own sections and never moves or reuses the deleted venue's nodes", async () => {
      fake.venues = fake.venues.map((venue) =>
        venue.barsy_id === DEMO_BID ? { ...venue, menu_id: 72 } : venue,
      )
      const articles = fixtureJson('articles-bid10-menu72.json') as Json[]
      for (const item of articles) item.article_name_public = `Article ${item.article_id}`
      fake.byBid.set(String(DEMO_BID), { articles, tree: catalogue72Tree() as never })
      await world.query(
        `update restro.barsy_venues set catalogue_root_cat_id = $1 where integration_id = $2 and bid = $3`,
        [C72_ROOT, world.integrationId, DEMO_BID],
      )

      // Venue A pulls the whole menu: plain section keys under its menu.
      await world.run(JOB_NAMES.barsyFullPull, payload())
      const ofA = await sections(world.menuId)
      expect(ofA.length).toBeGreaterThan(3)
      expect(ofA.every((section) => !section.external_id.includes('@'))).toBe(true)
      const nodesA = ofA.map((section) => section.node_id)
      const frozen = {
        nodes: byKey(await nodeRows(nodesA), (row) => String(row.id)),
        links: byKey(await linkRows(nodesA), (row) => String(row.external_id)),
        placements: byKey(
          await placementRows(nodesA),
          (row) => `${String(row.section_id)}:${String(row.item_id)}`,
        ),
      }
      expect(frozen.placements.length).toBeGreaterThan(0)

      // Delete A: the till venue is free. Venue B takes it over and pulls the same menu.
      const archived = await archiveVenue(world.pool, world.tenantId, world.venueId)
      expect(archived.releasedTill).toBe(true)
      const venueB = (
        await provisionVenue(world.pool, world.tenantId, {
          name: 'Second owner',
          slug: testSlug('second-owner'),
        })
      ).id
      const menuB = (await provisionMenu(world.pool, world.tenantId, venueB)).id
      expect(
        await mapBarsyVenue(world.pool, world.tenantId, world.integrationId, DEMO_BID, venueB),
      ).toMatchObject({ ok: true })
      expect(
        await setCatalogueRoot(world.pool, world.tenantId, world.integrationId, DEMO_BID, C72_ROOT),
      ).toMatchObject({ ok: true })
      world.clock = new Date(world.clock.getTime() + 60_000)
      await world.run(JOB_NAMES.barsyFullPull, payload(venueB))
      expect((await runs()).filter((run) => run.status === 'failed')).toEqual([])

      // B has sections of its own: the keys are qualified by B's menu (D88), they hang under B's
      // menu and are other nodes than A's.
      const ofB = await sections(menuB as NodeId)
      expect(ofB.length).toBe(ofA.length)
      expect(ofB.every((section) => section.external_id.endsWith(`@${menuB}`))).toBe(true)
      expect(new Set(ofB.map((section) => section.node_id))).not.toEqual(new Set(nodesA))
      for (const id of ofB.map((section) => section.node_id)) expect(nodesA).not.toContain(id)

      // A's nodes, links and placements are exactly what they were: nothing moved, hidden or reused.
      expect(byKey(await nodeRows(nodesA), (row) => String(row.id))).toEqual(frozen.nodes)
      expect(byKey(await linkRows(nodesA), (row) => String(row.external_id))).toEqual(frozen.links)
      expect(
        byKey(
          await placementRows(nodesA),
          (row) => `${String(row.section_id)}:${String(row.item_id)}`,
        ),
      ).toEqual(frozen.placements)
      expect((await sections(world.menuId)).length).toBe(ofA.length)
    })
  })
})
