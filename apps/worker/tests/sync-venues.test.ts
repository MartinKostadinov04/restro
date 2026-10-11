// Several venues on one barsy account (brief CF-16, T50, T67, T71, D73), on Postgres through the
// jobs' real handlers, against the in-memory installation answering with the recordings of
// catalogue 72 read in two venues' contexts (articles-bid10-menu72.json, articles-bid102-menu72.json).
// The two recordings come from bid 10 and bid 102; here both venues sell from catalogue 72.
//
//   - one item per article; each venue's price and for-sale written in its own scope; sections of
//     its own (venue B's links are qualified, venue A keeps the plain ones);
//   - neither venue's pull drops the other's (the tick queues both, keyed per venue);
//   - an item outside one venue's root is never concluded absent by its pull; one its root no
//     longer holds is hidden in that venue only, and comes back when the root holds it again;
//   - a deleted or recreated article is concluded once per catalogue;
//   - a venue whose root would drop most of its menu holds (CF-02 per venue);
//   - the tables of a newly mapped venue are read without a catalogue root (T67);
//   - the publishing rules are the venue's (CF-09b, CF-04): after a pull that changed a shared
//     catalogue, each venue on it publishes by its own rule, and holds new items by its own rule.
import { JOB_NAMES, type NodeId, resolve, VENUE_MENU_TEMPLATE, type VenueId } from '@restro/core'
import {
  loadMenuDocument,
  provisionMenu,
  provisionVenue,
  setVenuePublishRules,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Test-only reach into barsy's mapping test data: the category tree of catalogue 72.
import {
  C72_DRINKS,
  C72_FOOD,
  C72_ROOT,
  catalogue72Tree,
} from '../../../packages/barsy/src/mapping/test-data.ts'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
  testSlug,
} from './database'
import { createFakeBarsy, fixtureJson } from './fake-barsy'
import { createWorld, type World } from './world'

type Json = Record<string, unknown>

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const BID_A = 10
const BID_B = 102

allowSlowSetup()

describe.skipIf(!hasDatabase)('several venues on one barsy account (CF-16)', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let venueB: string
  let menuB: string
  let articlesA: Json[]
  let articlesB: Json[]

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
    // Both venues sell from catalogue 72, each read in its own context.
    fake.venues = fake.venues.map((venue) =>
      venue.barsy_id === BID_A ? { ...venue, menu_id: 72 } : venue,
    )
    articlesA = fixtureJson('articles-bid10-menu72.json') as Json[]
    articlesB = fixtureJson('articles-bid102-menu72.json') as Json[]
    // The catalogue recordings asked for no texts: give every article a public name, so that the
    // resolver shows it (a nameless item is blocked).
    for (const item of [...articlesA, ...articlesB]) {
      item.article_name_public = `Article ${item.article_id}`
    }
    fake.byBid.set(String(BID_A), { articles: articlesA, tree: catalogue72Tree() as never })
    fake.byBid.set(String(BID_B), { articles: articlesB, tree: catalogue72Tree() as never })
    fake.byBid.set('70', { places: fixtureJson('places-bid70.json') as Json[] })
    // Venue A (the world's venue) on bid 10 with the whole menu; venue B on bid 102, drinks only.
    await world.query(
      `update restro.barsy_venues set catalogue_root_cat_id = $1 where integration_id = $2 and bid = $3`,
      [C72_ROOT, world.integrationId, BID_A],
    )
    const second = await provisionVenue(world.pool, world.tenantId, {
      name: 'Burgers bar',
      slug: testSlug('burgers'),
    })
    venueB = second.id
    menuB = (await provisionMenu(world.pool, world.tenantId, venueB)).rootNodeId
    await upsertBarsyVenues(world.pool, world.tenantId, world.integrationId, [
      { bid: BID_B, name: 'Burgers' },
    ])
    await world.query(
      `update restro.barsy_venues set venue_id = $1, catalogue_root_cat_id = $2
       where integration_id = $3 and bid = $4`,
      [venueB, C72_DRINKS, world.integrationId, BID_B],
    )
  })
  afterEach(async () => {
    await world.close()
  })

  const payload = (venueId: string) => ({
    tenantId: world.tenantId,
    integrationId: world.integrationId,
    venueId,
  })
  const advance = (ms: number) => {
    world.clock = new Date(world.clock.getTime() + ms)
  }
  const pullA = () => world.run(JOB_NAMES.barsyFullPull, payload(world.venueId))
  const pullB = () => world.run(JOB_NAMES.barsyFullPull, payload(venueB))
  const lastRun = async (kind = 'barsy_full_pull') => {
    const rows = await world.query<{
      status: string
      counters: Record<string, number>
      error_summary: string | null
      details: Json | null
    }>(
      `select status, counters, error_summary, details from restro.job_runs
       where integration_id = $1 and kind = $2 order by created_at desc, id desc limit 1`,
      [world.integrationId, kind],
    )
    const [row] = rows
    if (!row) throw new Error(`no ${kind} run`)
    return row
  }
  const links = (type: string) =>
    world.query<{ external_id: string; node_id: string; state: string }>(
      `select external_id, node_id, state from restro.source_links
       where integration_id = $1 and external_type = $2`,
      [world.integrationId, type],
    )
  const linkOf = async (type: string, id: string) => {
    const found = (await links(type)).find((link) => link.external_id === id)
    if (!found) throw new Error(`no link ${type}:${id}`)
    return found
  }
  const tillValue = async (articleId: string, field: string, venueId: string) => {
    const rows = await world.query<{ value: unknown }>(
      `select fv.value from restro.field_values fv
       join restro.source_links sl on sl.node_id = fv.node_id
       where sl.integration_id = $1 and sl.external_type = 'article' and sl.external_id = $2
         and fv.field_key = $3 and fv.layer = 'till' and fv.scope = $4`,
      [world.integrationId, articleId, field, `venue:${venueId}`],
    )
    return rows[0]?.value
  }
  const article = (list: Json[], id: number) => {
    const found = list.find((a) => a.article_id === id)
    if (!found) throw new Error(`no article ${id}`)
    return found
  }
  /** Changes an article the same way in both venues' answers (a catalogue-wide change). */
  const everywhere = (change: (list: Json[]) => void) => {
    change(articlesA)
    change(articlesB)
  }
  const visibleIn = async (venueId: string, menuId: string, articleId: string) => {
    const { node_id } = await linkOf('article', articleId)
    const doc = await loadMenuDocument(world.pool, world.tenantId, menuId as NodeId)
    const resolved = resolve(VENUE_MENU_TEMPLATE, doc, {
      venueScope: `venue:${venueId as VenueId}`,
      locales: ['bg_BG', 'en_US'],
      now: world.clock.toISOString(),
    })
    return resolved.items[node_id as NodeId]?.visible
  }
  const sectionParents = (menuId: string) =>
    world.query<{ external_id: string; parent_id: string }>(
      `with recursive tree as (
         select id, parent_id from restro.nodes where parent_id = $2
         union
         select n.id, n.parent_id from restro.nodes n join tree t on n.parent_id = t.id
       )
       select sl.external_id, t.parent_id from tree t
       join restro.source_links sl on sl.node_id = t.id
       where sl.integration_id = $1 and sl.external_type = 'category'`,
      [world.integrationId, menuId],
    )

  it('one item per article, each venue’s price and for-sale in its own scope, sections of its own', async () => {
    // Venue B's context: another price for 7409 (in both halves), and 7408 not for sale there.
    article(articlesB, 7409).actual_price = 7.1
    article(articlesB, 7408).is_for_sale_barsys = { '102': '0' }
    await pullA()
    advance(MINUTE)
    await pullB()

    const runA = await world.query<{
      counters: Record<string, number>
      error_summary: string | null
    }>(
      `select counters, error_summary from restro.job_runs
       where integration_id = $1 and kind = 'barsy_full_pull' order by created_at`,
      [world.integrationId],
    )
    expect(runA.map((run) => run.error_summary)).toEqual([null, null])
    expect(runA.map((run) => run.counters.missing)).toEqual([0, 0])

    // Items: one per article, shared. B maps a subset of A's (its root is A's drinks half).
    const items = await links('article')
    expect(new Set(items.map((l) => l.node_id)).size).toBe(items.length)
    const [itemNodes] = await world.query<{ n: string }>(
      `select count(*) as n from restro.nodes where tenant_id = $1 and node_type = 'item'`,
      [world.tenantId],
    )
    expect(Number(itemNodes?.n)).toBe(items.length)
    expect(runA[1]?.counters.created).toBe(0)
    expect(runA[1]?.counters.items_mapped).toBeGreaterThan(0)

    // Price and for-sale per venue.
    expect(await tillValue('7409', 'price', world.venueId)).toEqual({
      amount_minor: 665,
      currency: 'EUR',
    })
    expect(await tillValue('7409', 'price', venueB)).toEqual({ amount_minor: 710, currency: 'EUR' })
    expect(await tillValue('7408', 'for_sale', world.venueId)).toBe(true)
    expect(await tillValue('7408', 'for_sale', venueB)).toBe(false)
    // A food item has no price in B: B does not sell from that part of the menu.
    expect(await tillValue('7405', 'price', venueB)).toBeUndefined()

    // Sections: A has the plain keys under its menu; B its own, qualified, under its own menu.
    const ofA = await sectionParents(world.menuId)
    const ofB = await sectionParents(menuB)
    expect(ofA.map((s) => s.external_id)).toContain(String(C72_FOOD))
    expect(ofA.every((s) => !s.external_id.includes('@'))).toBe(true)
    expect(ofB.map((s) => s.external_id).sort()).toEqual(
      ['1140', '1142', '1143', '1144', '1154', '1155', '1156']
        .map((id) => `${id}@${venueB}`)
        .sort(),
    )
    expect(ofB.every((s) => s.parent_id === menuB)).toBe(true)
    // 7409 sits in both menus (food 1131 in A, drinks 1142 in both).
    expect(await visibleIn(world.venueId, world.menuId, '7409')).toBe(true)
    expect(await visibleIn(venueB, menuB, '7409')).toBe(true)

    // B's change check keeps to B's own sections and scope.
    advance(5 * MINUTE)
    article(articlesB, 7409).actual_price = 7.2
    article(articlesB, 7409).last_update = '2099-01-01 00:00:00'
    await world.run(JOB_NAMES.barsyIncremental, payload(venueB))
    expect((await lastRun('barsy_incremental')).status).toBe('completed')
    expect(await tillValue('7409', 'price', venueB)).toEqual({ amount_minor: 720, currency: 'EUR' })
    expect(await tillValue('7409', 'price', world.venueId)).toEqual({
      amount_minor: 665,
      currency: 'EUR',
    })
    expect(await sectionParents(world.menuId)).toHaveLength(ofA.length)
    expect(await sectionParents(menuB)).toHaveLength(ofB.length)
  })

  it('neither venue’s pull drops the other’s: the tick queues both, keyed per venue', async () => {
    // 12:00:10 in Sofia: a change check and the daily full read are due for both.
    world.clock = new Date('2026-10-10T09:00:10Z')
    world.enqueued.length = 0
    await world.run(JOB_NAMES.barsySyncTick, {})
    const pulls = world.enqueued.filter((job) => job.name === JOB_NAMES.barsyFullPull)
    expect(pulls.map((job) => job.data.venueId).sort()).toEqual([world.venueId, venueB].sort())
    expect(new Set(pulls.map((job) => job.singletonKey)).size).toBe(2)
    for (const job of pulls) {
      expect(job.singletonKey).toBe(`${world.integrationId}:${job.data.venueId}`)
    }
  })

  it('an item outside one venue’s root is never concluded absent by its pull; one its root dropped is hidden there only', async () => {
    await pullA()
    advance(MINUTE)
    await pullB()
    // B's pull saw the whole catalogue: A's food items are untouched.
    const food = '7405'
    expect((await linkOf('article', food)).state).toBe('active')
    expect(await visibleIn(world.venueId, world.menuId, food)).toBe(true)

    // 7408 moves from drinks (1140) to food (1131) in barsy.
    everywhere((list) => {
      article(list, 7408).categories = ['1131']
    })
    advance(10 * MINUTE)
    await pullB()
    const run = await lastRun()
    expect(run.error_summary).toBeNull()
    expect(run.counters).toMatchObject({ missing: 0, deleted: 0, hidden_here: 1 })
    expect((await linkOf('article', '7408')).state).toBe('active')
    expect(await tillValue('7408', 'visible', venueB)).toBe(false)
    expect(await visibleIn(venueB, menuB, '7408')).toBe(false)
    expect(await visibleIn(world.venueId, world.menuId, '7408')).toBe(true)
    // A's own pull changes nothing about that.
    advance(MINUTE)
    await pullA()
    expect((await lastRun()).counters).toMatchObject({ missing: 0, hidden_here: 0 })
    expect(await visibleIn(world.venueId, world.menuId, '7408')).toBe(true)

    // Back in drinks: shown in B again.
    everywhere((list) => {
      article(list, 7408).categories = ['1140']
    })
    advance(10 * MINUTE)
    await pullB()
    expect(await tillValue('7408', 'visible', venueB)).toBeUndefined()
    expect(await visibleIn(venueB, menuB, '7408')).toBe(true)
  })

  it('a deleted or recreated article is concluded once per catalogue', async () => {
    await pullA()
    advance(MINUTE)
    await pullB()
    // Staff delete 7409 and create it again under a new id (T71: ids are per installation).
    everywhere((list) => {
      const old = article(list, 7409)
      list.splice(list.indexOf(old), 1)
      list.push({ ...old, article_id: 97409 })
    })
    advance(10 * MINUTE)
    await pullA()
    expect((await lastRun()).counters).toMatchObject({ missing: 1, created: 1 })
    expect((await linkOf('article', '7409')).state).toBe('missing')
    advance(MINUTE)
    await pullB()
    expect((await lastRun()).counters).toMatchObject({ missing: 0, created: 0, hidden_here: 0 })
    // The new article is one item, in both menus.
    expect(await visibleIn(world.venueId, world.menuId, '97409')).toBe(true)
    expect(await visibleIn(venueB, menuB, '97409')).toBe(true)
    expect(await visibleIn(venueB, menuB, '7409')).toBe(false)

    // A week later: deleted, once.
    advance(8 * DAY)
    await pullB()
    expect((await lastRun()).counters).toMatchObject({ deleted: 1 })
    advance(MINUTE)
    await pullA()
    expect((await lastRun()).counters).toMatchObject({ deleted: 0, missing: 0 })
    expect((await linkOf('article', '7409')).state).toBe('deleted')
    const moves = await world.query<{ n: string }>(
      `select count(*) as n from restro.events
       where tenant_id = $1 and op = 'setLinkState' and node_id = $2`,
      [world.tenantId, (await linkOf('article', '7409')).node_id],
    )
    expect(Number(moves[0]?.n)).toBe(2) // active → missing, missing → deleted
  })

  it('a venue whose new root would hide most of its menu holds that venue only (CF-02 per venue)', async () => {
    await pullA()
    advance(MINUTE)
    await pullB()
    // B's root is switched to the food half by mistake.
    await world.query(
      `update restro.barsy_venues set catalogue_root_cat_id = $1 where integration_id = $2 and bid = $3`,
      [C72_FOOD, world.integrationId, BID_B],
    )
    advance(10 * MINUTE)
    await pullB()
    const run = await lastRun()
    expect(run.counters).toMatchObject({ missing: 0, hidden_here: 0 })
    expect(run.error_summary).toMatch(
      /^deletion check held: the read would hide \d+ of \d+ items of this venue’s menu \(\d+%\); nothing was hidden$/,
    )
    expect(run.details).toMatchObject({ deletionCheckSkipped: true })
    expect(await visibleIn(venueB, menuB, '7408')).toBe(true)
    expect((await sectionParents(menuB)).length).toBeGreaterThan(0)
    expect((await links('category')).every((link) => link.state === 'active')).toBe(true)
  })

  describe('the publishing rules belong to the venue (CF-09b)', () => {
    const publishes = () =>
      world.enqueued
        .filter((job) => job.name === JOB_NAMES.publishMenu)
        .map((job) => job.data.venueId as string)
        .sort()
    const rules = (venueId: string, after_sync: 'auto' | 'manual', new_items: 'show' | 'hold') =>
      setVenuePublishRules(world.pool, world.tenantId, {
        venueId,
        rules: { after_sync, new_items },
      })
    /** Both venues know their catalogue, so a pull of one reaches the other (CF-16). */
    const knowCatalogues = async () => {
      await pullA()
      advance(MINUTE)
      await pullB()
      advance(10 * MINUTE)
      world.enqueued.length = 0
    }

    it('with no rule of their own, both venues on the catalogue publish after a change', async () => {
      await knowCatalogues()
      everywhere((list) => {
        article(list, 7409).actual_price = 7.3
      })
      await pullA()
      expect(publishes()).toEqual([world.venueId, venueB].sort())
    })

    it('two venues on one catalogue with different after_sync rules: only the automatic one publishes', async () => {
      await knowCatalogues()
      await rules(world.venueId, 'auto', 'show')
      await rules(venueB, 'manual', 'show')
      everywhere((list) => {
        article(list, 7409).actual_price = 7.4
      })
      await pullA()
      expect(publishes()).toEqual([world.venueId])

      // The other way round, and the pull of the other venue: the rule is still each venue's own.
      await rules(world.venueId, 'manual', 'show')
      await rules(venueB, 'auto', 'show')
      advance(10 * MINUTE)
      world.enqueued.length = 0
      everywhere((list) => {
        article(list, 7409).actual_price = 7.5
      })
      await pullB()
      expect(publishes()).toEqual([venueB])
    })

    it('a venue with its own rule is not moved by the integration’s old one, and one without follows it', async () => {
      await knowCatalogues()
      await world.query(
        `update restro.integrations set config = config || '{"publish":{"after_sync":"manual","new_items":"show"}}'::jsonb
         where id = $1`,
        [world.integrationId],
      )
      await rules(venueB, 'auto', 'show')
      everywhere((list) => {
        article(list, 7409).actual_price = 7.6
      })
      await pullA()
      // A never saved its rules: it reads the integration's (manual). B saved its own (auto).
      expect(publishes()).toEqual([venueB])
    })

    it('new items are held by the rule of the venue whose pull creates them', async () => {
      const heldArticles = async () =>
        (
          await world.query<{ external_id: string }>(
            `select distinct sl.external_id from restro.field_values fv
             join restro.source_links sl on sl.node_id = fv.node_id
             where sl.integration_id = $1 and sl.external_type = 'article'
               and fv.field_key = 'visible' and fv.layer = 'manual' and fv.value = 'false'::jsonb`,
            [world.integrationId],
          )
        ).map((row) => row.external_id)
      await rules(world.venueId, 'auto', 'hold')
      await rules(venueB, 'auto', 'show')
      // B's pull creates the drinks: B shows new items, so none is held.
      await pullB()
      expect(await heldArticles()).toEqual([])
      advance(MINUTE)
      // A's pull creates the food, which is new: A holds new items, so only those are held.
      await pullA()
      const held = await heldArticles()
      expect(held).toContain('7405')
      expect(held).not.toContain('7409')
    })
  })

  it('reads the tables of a venue as soon as it is mapped, without a catalogue root (T67)', async () => {
    const third = await provisionVenue(world.pool, world.tenantId, {
      name: 'Catering',
      slug: testSlug('catering'),
    })
    await upsertBarsyVenues(world.pool, world.tenantId, world.integrationId, [
      { bid: 70, name: 'Catering' },
    ])
    await world.query(
      `update restro.barsy_venues set venue_id = $1 where integration_id = $2 and bid = 70`,
      [third.id, world.integrationId],
    )
    world.clock = new Date('2026-10-10T05:00:10Z')
    world.enqueued.length = 0
    await world.run(JOB_NAMES.barsySyncTick, {})
    const reads = world.enqueued.filter((job) => job.name === JOB_NAMES.placesRead)
    const forThird = reads.filter((job) => job.data.venueId === third.id)
    expect(forThird).toHaveLength(1)
    expect(forThird[0]?.singletonKey).toBe(`${world.integrationId}:${third.id}`)
    // No pull for a venue without a root.
    expect(
      world.enqueued.filter(
        (job) => job.name !== JOB_NAMES.placesRead && job.data.venueId === third.id,
      ),
    ).toEqual([])

    // Asked again only after ten minutes, and never once read.
    advance(5 * MINUTE)
    world.enqueued.length = 0
    await world.run(JOB_NAMES.barsySyncTick, {})
    expect(world.enqueued.filter((job) => job.data.venueId === third.id)).toEqual([])

    await world.run(JOB_NAMES.placesRead, payload(third.id))
    const run = await lastRun('places_read')
    expect(run.status).toBe('completed')
    expect(run.counters.places_seen).toBe((fixtureJson('places-bid70.json') as Json[]).length)
    const [stored] = await world.query<{ n: string }>(
      `select count(*) as n from restro.places where integration_id = $1 and bid = 70`,
      [world.integrationId],
    )
    expect(Number(stored?.n)).toBe(run.counters.places_seen)
    expect(fake.callsOf('Places_getlist').at(-1)?.bid).toBe('70')

    advance(20 * MINUTE)
    world.enqueued.length = 0
    await world.run(JOB_NAMES.barsySyncTick, {})
    expect(world.enqueued.filter((job) => job.data.venueId === third.id)).toEqual([])
  })
})
