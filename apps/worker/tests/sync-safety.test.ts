// The barsy sync safety fixes (brief CF-02, T62, B1-F1/F2/F4/F6): a complete full pull that finds
// nothing, or would hide most of the menu, concludes nothing (links and tables); a changed menu
// category or sync setting makes the next incremental queue a full pull instead of running as a
// partial one; and an incremental run that holds a combo but not its option articles never clears
// the option names. On a real Postgres, as restro_app, through the jobs' real handlers, against the
// in-memory installation (nothing leaves the machine).
import { JOB_NAMES } from '@restro/core'
import { issueAllTableTokens, setCatalogueRoot } from '@restro/core/apply'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { localTimeText } from '../src/sync/cursor'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, DEMO_BID, DEMO_ROOT_CAT, type World } from './world'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** A category of the demo tree under the root 1091 with few articles in the 60-article page. */
const SMALL_ROOT_CAT = 1100

allowSlowSetup()

type Json = Record<string, unknown>

function findNode(node: Json, catId: number): Json | undefined {
  const category = node.category as Json
  if (category.cat_id === catId) return node
  for (const child of node.categories as Json[]) {
    const found = findNode(child, catId)
    if (found) return found
  }
  return undefined
}

describe.skipIf(!hasDatabase)('barsy sync safety (CF-02)', () => {
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
    await world.close()
  })

  const payload = () => ({
    tenantId: world.tenantId,
    integrationId: world.integrationId,
    venueId: world.venueId,
  })
  const fullPull = () => world.run(JOB_NAMES.barsyFullPull, payload())
  const incremental = () => world.run(JOB_NAMES.barsyIncremental, payload())
  const advance = (minutes: number) => {
    world.clock = new Date(world.clock.getTime() + minutes * MINUTE)
  }
  const fullPullJobs = () => world.enqueued.filter((job) => job.name === JOB_NAMES.barsyFullPull)

  interface RunRow {
    status: string
    counters: Record<string, number>
    error_summary: string | null
    details: {
      notes: string[]
      deletionCheckSkipped?: boolean
      absence_held?: { reason: string; would_hide: number; active: number }
    } | null
  }
  const lastRun = async (kind: 'barsy_full_pull' | 'barsy_incremental') => {
    const rows = await world.query<RunRow>(
      `select status, counters, error_summary, details from restro.job_runs
       where integration_id = $1 and kind = $2 order by created_at`,
      [world.integrationId, kind],
    )
    const row = rows.at(-1)
    if (!row) throw new Error(`no ${kind} run`)
    return row
  }
  const links = () =>
    world.query<{
      external_type: string
      external_id: string
      state: string
      last_seen_at: Date
    }>(
      `select external_type, external_id, state, last_seen_at from restro.source_links
       where integration_id = $1 order by external_type, external_id`,
      [world.integrationId],
    )
  const articleLinks = async () => (await links()).filter((l) => l.external_type === 'article')
  const activeArticleIds = async () =>
    (await articleLinks())
      .filter((l) => l.state === 'active')
      .map((l) => Number(l.external_id))
      .sort((a, b) => a - b)
  const syncState = async () => {
    const [row] = await world.query<{ config: { sync?: Record<string, Record<string, string>> } }>(
      'select config from restro.integrations where id = $1',
      [world.integrationId],
    )
    return row?.config.sync?.[String(DEMO_BID)] ?? {}
  }
  const articleOf = (id: number) => {
    const article = fake.articles.find((a) => a.article_id === id)
    if (!article) throw new Error(`no article ${id}`)
    return article
  }
  /** The demo has 58 mapped articles: add seven more so that the menu holds 65, as in T62. */
  const addArticles = (count: number) => {
    for (let i = 0; i < count; i += 1) {
      fake.articles.push({
        ...articleOf(11),
        article_id: 90001 + i,
        article_name_public: `Extra ${i}`,
      })
    }
  }
  const keepArticles = (keep: (id: number) => boolean) => {
    fake.articles = fake.articles.filter((article) => keep(Number(article.article_id)))
  }
  const setConfig = (patch: Json) =>
    world.query('update restro.integrations set config = config || $2::jsonb where id = $1', [
      world.integrationId,
      JSON.stringify(patch),
    ])
  const placeCounts = async () => {
    const rows = await world.query<{ state: string; n: string }>(
      `select state, count(*) as n from restro.places where integration_id = $1 group by state`,
      [world.integrationId],
    )
    return Object.fromEntries(rows.map((row) => [row.state, Number(row.n)]))
  }

  // --- 1. an empty or sharply smaller read concludes nothing -----------------------------------

  describe('absence is not concluded from an empty or sharply smaller read (links)', () => {
    beforeEach(async () => {
      addArticles(7)
      await fullPull()
      expect(await activeArticleIds()).toHaveLength(65)
      advance(10)
    })

    it('a complete pull that returns 0 articles over a menu with active links hides nothing and says why', async () => {
      fake.articles = []
      await fullPull()

      const run = await lastRun('barsy_full_pull')
      expect(run.status).toBe('completed')
      expect(run.counters).toMatchObject({ missing: 0, deleted: 0, failed_pages: 0 })
      expect(run.error_summary).toBe(
        'deletion check held: the read found no items but 65 are on the menu; nothing was hidden',
      )
      expect(run.details).toMatchObject({
        notes: [
          'deletion check held: the read found no items but 65 are on the menu; nothing was hidden',
        ],
        deletionCheckSkipped: true,
        absence_held: { reason: 'empty_read', would_hide: 65, active: 65 },
      })
      // Every link is as it was.
      expect(await activeArticleIds()).toHaveLength(65)
      expect((await links()).every((l) => l.state === 'active')).toBe(true)
      // The read itself was complete, so the cursor moved.
      expect((await syncState()).cursor).toBe(world.clock.toISOString())
    })

    it('a pull that would hide 61 of 65 is held; the 4 it did see are marked seen', async () => {
      fake.articles = fake.articles.filter((article) =>
        [90001, 90002, 90003, 90004].includes(Number(article.article_id)),
      )
      await fullPull()

      const run = await lastRun('barsy_full_pull')
      expect(run.counters).toMatchObject({ missing: 0, deleted: 0, articles_seen: 4 })
      expect(run.error_summary).toBe(
        'deletion check held: the read would hide 61 of 65 items (94%); nothing was hidden',
      )
      expect(run.details).toMatchObject({
        deletionCheckSkipped: true,
        absence_held: { reason: 'too_many_missing', would_hide: 61, active: 65 },
      })
      expect(await activeArticleIds()).toHaveLength(65)
      // The seen ops were applied: the four were seen by this run, the others were not.
      const stamp = world.clock.getTime()
      const articles = await articleLinks()
      const seenNow = articles.filter((l) => l.last_seen_at.getTime() === stamp)
      expect(seenNow.map((l) => Number(l.external_id)).sort((a, b) => a - b)).toEqual([
        90001, 90002, 90003, 90004,
      ])
    })

    it('a pull that drops 2 of 65 is not held: those 2 go missing as before', async () => {
      keepArticles((id) => id !== 90001 && id !== 90002)
      await fullPull()

      const run = await lastRun('barsy_full_pull')
      expect(run.counters).toMatchObject({ missing: 2, deleted: 0 })
      expect(run.error_summary).toBeNull()
      expect(run.details).toMatchObject({ notes: [] })
      expect(run.details).not.toHaveProperty('absence_held')
      expect(run.details?.deletionCheckSkipped).toBeFalsy()
      const missing = (await articleLinks()).filter((l) => l.state === 'missing')
      expect(missing.map((l) => l.external_id).sort()).toEqual(['90001', '90002'])
    })

    it('the share is exact: 19 of 65 (29%) goes through, 20 of 65 (31%) is held', async () => {
      const ids = await activeArticleIds()
      const dropped = new Set(ids.slice(0, 19))
      keepArticles((id) => !dropped.has(id))
      await fullPull()
      expect((await lastRun('barsy_full_pull')).counters).toMatchObject({ missing: 19 })

      // Back to a full menu, then 20 gone at once.
      advance(10)
      fake.reset()
      addArticles(7)
      await fullPull()
      advance(10)
      const droppedTwenty = new Set(ids.slice(0, 20))
      keepArticles((id) => !droppedTwenty.has(id))
      await fullPull()
      const run = await lastRun('barsy_full_pull')
      expect(run.counters).toMatchObject({ missing: 0 })
      expect(run.details).toMatchObject({
        absence_held: { reason: 'too_many_missing', would_hide: 20, active: 65 },
      })
      expect(run.error_summary).toBe(
        'deletion check held: the read would hide 20 of 65 items (31%); nothing was hidden',
      )
    })

    it('a read that saw no menu section while sections are active is held too', async () => {
      // The root has no child category any more, and every article sits directly in the root:
      // the read sees all its articles but no section.
      const root = findNode(fake.tree, DEMO_ROOT_CAT)
      if (!root) throw new Error('the demo tree has no root 1091')
      root.categories = []
      for (const article of fake.articles) article.categories = [String(DEMO_ROOT_CAT)]
      await fullPull()

      const run = await lastRun('barsy_full_pull')
      expect(run.counters).toMatchObject({ missing: 0, deleted: 0, categories_seen: 0 })
      expect(run.error_summary).toContain(
        'deletion check held: the read found no menu sections but 11 are on the menu; nothing was hidden',
      )
      expect(run.details).toMatchObject({
        deletionCheckSkipped: true,
        absence_held: { reason: 'empty_read', would_hide: 11, active: 11 },
      })
      expect((await links()).every((l) => l.state === 'active')).toBe(true)
    })

    it('the hold lasts only as long as the read is suspicious: a sane read concludes as usual', async () => {
      const all = fake.articles
      fake.articles = []
      await fullPull()
      expect((await lastRun('barsy_full_pull')).details?.absence_held).toBeDefined()

      // Still empty a week later: still nothing hidden, nothing deleted.
      world.clock = new Date(world.clock.getTime() + 8 * DAY)
      await fullPull()
      expect((await lastRun('barsy_full_pull')).counters).toMatchObject({ missing: 0, deleted: 0 })
      expect((await links()).every((l) => l.state === 'active')).toBe(true)

      // The menu is back, with one article gone: that one goes missing, nothing is held.
      fake.articles = all.filter((article) => Number(article.article_id) !== 90007)
      advance(10)
      await fullPull()
      const run = await lastRun('barsy_full_pull')
      expect(run.counters).toMatchObject({ missing: 1 })
      expect(run.details).not.toHaveProperty('absence_held')
    })

    it('option groups and options going missing with their combos are not a menu emptying', async () => {
      // Two combos whose supplements stop being listed: 8 groups and 28 options go missing at
      // once, more than 30% of the 67 article links in number, but they are not articles.
      fake.reset()
      addArticles(7)
      for (const id of [7183, 7184]) {
        fake.articles.push({
          ...articleOf(11),
          article_id: id,
          has_supplements: 1,
          categories: ['370'],
        })
        fake.supplements.set(String(id), fake.supplements.get('7183'))
      }
      advance(10)
      await fullPull()
      advance(10)
      for (const id of [7183, 7184]) articleOf(id).has_supplements = 0
      await fullPull()
      const run = await lastRun('barsy_full_pull')
      expect(run.details).not.toHaveProperty('absence_held')
      const gone = (await links()).filter(
        (l) => l.external_type === 'supplement' || l.external_type === 'supplement_group',
      )
      expect(gone).toHaveLength(36)
      expect(gone.every((l) => l.state === 'missing')).toBe(true)
    })
  })

  // --- 1b. the tables ---------------------------------------------------------------------------

  describe('absence is not concluded from an empty or sharply smaller places read', () => {
    const tableJobs = () =>
      world.enqueued.filter((job) => job.name === JOB_NAMES.publishTableTokens)

    beforeEach(async () => {
      await fullPull()
      const counts = await placeCounts()
      expect(counts.active).toBe(92)
      await issueAllTableTokens(world.pool, world.tenantId, world.venueId)
      world.enqueued.length = 0
      advance(10)
    })

    const codes = async () =>
      Number(
        (
          await world.query<{ n: string }>(
            'select count(*) as n from restro.tables where venue_id = $1 and qr_token is not null',
            [world.venueId],
          )
        )[0]?.n,
      )

    it('an empty list over 92 stored places: none goes missing, no code is retired, and the run says why', async () => {
      const coded = await codes()
      expect(coded).toBeGreaterThan(0)
      fake.places = []
      await fullPull()

      const run = await lastRun('barsy_full_pull')
      expect(run.status).toBe('completed')
      expect(run.counters).toMatchObject({ places_seen: 0, places_missing: 0, places_deleted: 0 })
      expect(run.error_summary).toBe(
        'table check held: the read found no tables but 92 are stored; none was marked missing or deleted',
      )
      expect(await placeCounts()).toEqual({ active: 92 })
      expect(await codes()).toBe(coded)
      expect(tableJobs()).toEqual([])

      // A week later, still empty: the grace period never starts, so nothing is deleted.
      world.clock = new Date(world.clock.getTime() + 8 * DAY)
      await fullPull()
      expect((await lastRun('barsy_full_pull')).counters).toMatchObject({ places_deleted: 0 })
      expect(await placeCounts()).toEqual({ active: 92 })
      expect(await codes()).toBe(coded)
      expect(tableJobs()).toEqual([])
    })

    it('a list that would drop 82 of 92 is held', async () => {
      const keep = new Set(fake.places.slice(0, 10).map((place) => place.place_id))
      fake.places = fake.places.filter((place) => keep.has(place.place_id))
      await fullPull()
      const run = await lastRun('barsy_full_pull')
      expect(run.counters).toMatchObject({ places_seen: 10, places_missing: 0 })
      expect(run.error_summary).toBe(
        'table check held: the read would mark 82 of 92 tables missing (89%); none was marked missing or deleted',
      )
      expect(await placeCounts()).toEqual({ active: 92 })
    })

    it('a list that drops 2 of 92 marks those 2 missing as before', async () => {
      const gone = new Set(fake.places.slice(0, 2).map((place) => place.place_id))
      fake.places = fake.places.filter((place) => !gone.has(place.place_id))
      await fullPull()
      const run = await lastRun('barsy_full_pull')
      expect(run.counters).toMatchObject({ places_missing: 2, places_deleted: 0 })
      expect(run.error_summary).toBeNull()
      expect(await placeCounts()).toEqual({ active: 90, missing: 2 })
    })
  })

  // --- 2. a changed scope forces a full read ----------------------------------------------------

  describe('a changed menu category or setting forces a full read', () => {
    const SCOPE_CHANGED = 'the menu category or sync settings changed'

    beforeEach(async () => {
      await fullPull()
      // Out of the 15-minute cool-down of that full pull.
      advance(20)
    })

    it('the full pull stores the scope hash with the cursor and the tree hash', async () => {
      const state = await syncState()
      expect(state.scope_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(state.cursor).toBeDefined()
      expect(state.tree_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('with an unchanged scope the incremental runs as before and queues nothing', async () => {
      const before = (await syncState()).scope_hash
      const articleCalls = fake.callsOf('Articles_getlist').length
      await incremental()
      const run = await lastRun('barsy_incremental')
      expect(run.error_summary).toBeNull()
      expect(run.counters).toMatchObject({ articles_seen: 0, created: 0, updated: 0 })
      expect(fake.callsOf('Articles_getlist')).toHaveLength(articleCalls + 1)
      expect(fullPullJobs()).toHaveLength(0)
      // The incremental does not touch the scope hash.
      expect((await syncState()).scope_hash).toBe(before)
    })

    it('after setCatalogueRoot the next incremental queues a full pull and reads no article', async () => {
      const changed = await setCatalogueRoot(
        world.pool,
        world.tenantId,
        world.integrationId,
        DEMO_BID,
        SMALL_ROOT_CAT,
      )
      expect(changed.ok).toBe(true)
      const articleCalls = fake.callsOf('Articles_getlist').length
      await incremental()

      expect(fake.callsOf('Articles_getlist')).toHaveLength(articleCalls)
      expect(fullPullJobs()).toHaveLength(1)
      expect(fullPullJobs()[0]).toMatchObject({
        data: payload(),
        singletonKey: `${world.integrationId}:${world.venueId}`,
      })
      const run = await lastRun('barsy_incremental')
      expect(run.status).toBe('completed')
      expect(run.error_summary).toBe(`${SCOPE_CHANGED}: a full pull was queued`)
    })

    it('respects the cool-down: a full pull that ran a moment ago is not asked for again', async () => {
      // Back inside the cool-down of the full pull of the set-up.
      world.clock = new Date(world.clock.getTime() - 15 * MINUTE)
      await setCatalogueRoot(
        world.pool,
        world.tenantId,
        world.integrationId,
        DEMO_BID,
        SMALL_ROOT_CAT,
      )
      const articleCalls = fake.callsOf('Articles_getlist').length
      await incremental()
      expect(fullPullJobs()).toHaveLength(0)
      expect(fake.callsOf('Articles_getlist')).toHaveLength(articleCalls)
      expect((await lastRun('barsy_incremental')).error_summary).toBe(
        `${SCOPE_CHANGED}; a full pull ran a moment ago`,
      )
    })

    it('the price source, the allergen key and the language are each part of the scope', async () => {
      // One change at a time, each followed by the full pull it asks for, so that every setting
      // is shown to queue a pull on its own.
      for (const patch of [
        { price_source: 'current_price' },
        { allergen_detail_key: 'k102' },
        { default_locale: 'en_US' },
      ]) {
        const before = fullPullJobs().length
        await setConfig(patch)
        await incremental()
        expect(fullPullJobs()).toHaveLength(before + 1)
        expect((await lastRun('barsy_incremental')).error_summary).toBe(
          `${SCOPE_CHANGED}: a full pull was queued`,
        )
        await fullPull()
        advance(20)
        await incremental()
        expect(fullPullJobs()).toHaveLength(before + 1)
        advance(20)
      }
    })

    it('the default language written out is not a change: an unset language hashes like bg_BG', async () => {
      await setConfig({ default_locale: 'bg_BG', price_source: 'actual_price' })
      await incremental()
      expect(fullPullJobs()).toHaveLength(0)
      expect((await lastRun('barsy_incremental')).error_summary).toBeNull()
    })

    it('state written before the scope hash existed counts as changed: one extra full pull', async () => {
      await world.query(
        `update restro.integrations set config = config #- '{sync,${DEMO_BID},scope_hash}' where id = $1`,
        [world.integrationId],
      )
      await incremental()
      expect(fullPullJobs()).toHaveLength(1)
      // That full pull writes the hash again, and the incremental runs normally afterwards.
      await fullPull()
      expect((await syncState()).scope_hash).toMatch(/^[0-9a-f]{64}$/)
      advance(20)
      await incremental()
      expect(fullPullJobs()).toHaveLength(1)
      expect((await lastRun('barsy_incremental')).error_summary).toBeNull()
    })

    it('A to B to A never reuses a stale cursor: each switch reads everything', async () => {
      const hashA = (await syncState()).scope_hash

      // A -> B: queued; the full pull reads B (a small category) and holds, so nothing is hidden.
      await setCatalogueRoot(
        world.pool,
        world.tenantId,
        world.integrationId,
        DEMO_BID,
        SMALL_ROOT_CAT,
      )
      await incremental()
      expect(fullPullJobs()).toHaveLength(1)
      await fullPull()
      const heldRun = await lastRun('barsy_full_pull')
      expect(heldRun.details?.absence_held).toBeDefined()
      expect((await links()).every((l) => l.state === 'active')).toBe(true)
      const hashB = (await syncState()).scope_hash
      expect(hashB).not.toBe(hashA)

      // B -> A: queued again, not an incremental against B's cursor.
      advance(20)
      await setCatalogueRoot(
        world.pool,
        world.tenantId,
        world.integrationId,
        DEMO_BID,
        DEMO_ROOT_CAT,
      )
      const articleCalls = fake.callsOf('Articles_getlist').length
      await incremental()
      expect(fullPullJobs()).toHaveLength(2)
      expect(fake.callsOf('Articles_getlist')).toHaveLength(articleCalls)
      await fullPull()
      expect((await syncState()).scope_hash).toBe(hashA)

      // Back on A and fully read: the incremental goes on as before.
      advance(20)
      await incremental()
      expect(fullPullJobs()).toHaveLength(2)
      expect((await lastRun('barsy_incremental')).error_summary).toBeNull()
    })

    it('a wrong menu category can no longer hide the menu: queued, read in full, held', async () => {
      const menuBefore = (await links()).filter((l) => l.state === 'active').length
      expect(menuBefore).toBeGreaterThan(50)
      await setCatalogueRoot(
        world.pool,
        world.tenantId,
        world.integrationId,
        DEMO_BID,
        SMALL_ROOT_CAT,
      )
      await incremental()
      await fullPull()

      const run = await lastRun('barsy_full_pull')
      expect(run.status).toBe('completed')
      expect(run.counters).toMatchObject({ missing: 0, deleted: 0 })
      expect(run.details?.deletionCheckSkipped).toBe(true)
      expect(run.details?.absence_held).toMatchObject({
        would_hide: expect.any(Number),
        active: expect.any(Number),
      })
      expect(run.error_summary).toContain('deletion check held:')
      expect((await links()).filter((l) => l.state === 'active')).toHaveLength(menuBefore)
    })
  })

  // --- 3. an incremental run never clears option names ------------------------------------------

  describe('an incremental run never clears an option name', () => {
    const optionNames = () =>
      world.query<{ external_id: string; value: Record<string, string> }>(
        `select sl.external_id, fv.value from restro.field_values fv
         join restro.source_links sl on sl.node_id = fv.node_id
         where sl.integration_id = $1 and sl.external_type = 'supplement'
           and fv.field_key = 'name' and fv.layer = 'till'
         order by sl.external_id`,
        [world.integrationId],
      )

    it('a changed combo whose option articles are not in the batch keeps the names it has', async () => {
      // The combo and three of its option articles (public names) are in the full pull.
      const named: [number, string][] = [
        [7095, 'Сос BBQ'],
        [6970, 'Бекон'],
        [7102, 'Чедър'],
      ]
      fake.articles.push({
        ...articleOf(11),
        article_id: 7183,
        has_supplements: 1,
        categories: ['370'],
      })
      for (const [id, name] of named) {
        fake.articles.push({
          ...articleOf(11),
          article_id: id,
          article_name_public: name,
          article_name_public_ml: { bg_BG: name },
          categories: ['370'],
        })
      }
      await fullPull()
      const before = await optionNames()
      expect(before.map((row) => row.external_id).sort()).toEqual(
        ['7183:160:6970', '7183:191:7095', '7183:192:7102'].sort(),
      )

      // Only the combo changed in barsy (its price): the batch holds the combo and nothing else.
      advance(5)
      const combo = articleOf(7183)
      combo.actual_price = 5.55
      combo.last_update = localTimeText(world.clock, 'Europe/Sofia')
      await incremental()

      const run = await lastRun('barsy_incremental')
      expect(run.error_summary).toBeNull()
      expect(run.counters).toMatchObject({ articles_seen: 1, updated: 1 })
      // The supplements were read again, and no option lost its name.
      expect(fake.callsOf('Articlesupplements_get')).toHaveLength(2)
      expect(await optionNames()).toEqual(before)
      // The options are still seen, so none of them is concluded missing.
      const options = (await links()).filter((l) => l.external_type === 'supplement')
      expect(options).toHaveLength(14)
      expect(options.every((l) => l.state === 'active')).toBe(true)
    })
  })
})
