// barsy-full-pull (path C) against the in-memory installation: counts from the demo recordings, a
// second pull that changes nothing, a failing page, absence (rule 6) with the race guard and the
// one-venue guard, paging that halves, combos, and the refused writes that reach job_runs. As
// restro_app, on a real Postgres, through the job's real handler.
import {
  type ChangeSet,
  JOB_NAMES,
  type NodeId,
  newId,
  resolve,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'
import { apply, loadMenuDocument, provisionVenue, upsertBarsyVenues } from '@restro/core/apply'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Test-only reach into barsy's mapping to name the node it would derive (not exported on purpose).
import { deriveId } from '../../../packages/barsy/src/mapping/ids.ts'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
  testSlug,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, DEMO_BID, DEMO_ROOT_CAT, type World } from './world'

/** Gives a category of the fake tree a public title (BG and EN). Returns whether it was found. */
function titleCategory(node: Record<string, unknown>, catId: number, title: string): boolean {
  const category = node.category as Record<string, unknown>
  if (category.cat_id === catId) {
    category.cat_name_public = title
    category.cat_name_public_ml = { bg_BG: title, en_US: title }
    return true
  }
  return (node.categories as Record<string, unknown>[]).some((child) =>
    titleCategory(child, catId, title),
  )
}

allowSlowSetup()

describe.skipIf(!hasDatabase)('barsy-full-pull', () => {
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
  const pull = () => world.run(JOB_NAMES.barsyFullPull, payload())

  interface RunRow {
    status: string
    counters: Record<string, number>
    error_summary: string | null
    details: { deletionCheckSkipped?: boolean } | null
  }
  const fullPulls = () =>
    world.query<RunRow>(
      `select status, counters, error_summary, details from restro.job_runs
       where integration_id = $1 and kind = 'barsy_full_pull' order by created_at`,
      [world.integrationId],
    )
  const lastPull = async () => {
    const rows = await fullPulls()
    const row = rows.at(-1)
    if (!row) throw new Error('no full pull ran')
    return row
  }
  const links = () =>
    world.query<{
      external_type: string
      external_id: string
      state: string
      last_hash: string | null
      node_id: string
    }>(
      `select external_type, external_id, state, last_hash, node_id from restro.source_links
       where integration_id = $1 order by external_type, external_id`,
      [world.integrationId],
    )
  const linkOf = async (type: string, id: string) => {
    const link = (await links()).find((l) => l.external_type === type && l.external_id === id)
    if (!link) throw new Error(`no link ${type}:${id}`)
    return link
  }
  const count = async (table: string, where = 'true') =>
    Number(
      (
        await world.query<{ n: string }>(
          `select count(*) as n from restro.${table} where tenant_id = $1 and ${where}`,
          [world.tenantId],
        )
      )[0]?.n,
    )
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

  it('pulls the demo catalogue: sections, items, placements, links, prices, counters, sync state', async () => {
    await pull()
    const run = await lastPull()
    expect(run.status).toBe('completed')
    expect(run.error_summary).toBeNull()
    expect(run.counters).toMatchObject({
      categories_seen: 11,
      articles_seen: 60,
      items_mapped: 58,
      created: 58,
      updated: 0,
      unchanged: 0,
      missing: 0,
      deleted: 0,
      reactivated: 0,
      failed_pages: 0,
    })
    expect(run.counters.refused_writes).toBeUndefined()

    expect(await count('nodes', "node_type = 'section'")).toBe(11)
    expect(await count('nodes', "node_type = 'item'")).toBe(58)
    expect(await count('placements')).toBe(58)
    const all = await links()
    expect(all.filter((l) => l.external_type === 'category')).toHaveLength(11)
    expect(all.filter((l) => l.external_type === 'article')).toHaveLength(58)
    expect(all.every((l) => l.state === 'active')).toBe(true)
    // Every link has the hash of the record it was last seen in.
    expect(all.every((l) => /^[0-9a-f]{64}$/.test(l.last_hash ?? ''))).toBe(true)

    // Money is integer minor units, from the decimal text (0.97 -> 97), in the venue scope.
    const [price] = await world.query<{ value: { amount_minor: number; currency: string } }>(
      `select fv.value from restro.field_values fv
       join restro.source_links sl on sl.node_id = fv.node_id
       where sl.integration_id = $1 and sl.external_type = 'article' and sl.external_id = '11'
         and fv.field_key = 'price' and fv.layer = 'till' and fv.scope = $2`,
      [world.integrationId, `venue:${world.venueId}`],
    )
    expect(price?.value).toEqual({ amount_minor: 97, currency: 'EUR' })

    // Everything the run wrote carries the run's job id.
    const jobs = await world.query<{ job_id: string }>(
      'select distinct job_id from restro.events where tenant_id = $1',
      [world.tenantId],
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.job_id).toMatch(/^jb_/)

    // Sync state: cursor and tree hash, per barsy venue.
    const state = await syncState()
    expect(state.cursor).toBe(world.clock.toISOString())
    expect(state.tree_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(state.last_full_pull_at).toBe(world.clock.toISOString())

    // Places (tables) of the venue, and the tier-1 records.
    expect(await count('places')).toBe(fake.places.length)
    expect(await count('source_records', "external_type = 'article'")).toBe(60)
    expect(await count('source_records', "external_type = 'category'")).toBe(11)
    expect(await count('source_records', "external_type = 'modificator'")).toBe(
      fake.modificators.length,
    )
  })

  it('queues a photo fetch for each mapped article that has a picture, once', async () => {
    await pull()
    const photos = world.enqueued.filter((job) => job.name === JOB_NAMES.assetFetch)
    const mapped = new Set(
      (await links()).filter((l) => l.external_type === 'article').map((l) => l.external_id),
    )
    // Pictures on the integration's own host are queued. The demo has three whose `picture` is a
    // full URL on a Cloudflare Images host: counted, not queued (the job would refuse them).
    const withPicture = fake.articles.filter(
      (article) => mapped.has(String(article.article_id)) && article.picture,
    )
    const expected = withPicture.filter((article) => article.picture_url)
    expect(expected.length).toBeGreaterThan(40)
    expect(withPicture.length - expected.length).toBe(3)
    expect(photos).toHaveLength(expected.length)
    expect((await lastPull()).counters.photos_elsewhere).toBe(3)
    expect(photos[0]?.data).toMatchObject({
      tenantId: world.tenantId,
      integrationId: world.integrationId,
    })
    expect(photos[0]?.singletonKey).toBe(
      `${world.integrationId}:${photos[0]?.data.articleExternalId}`,
    )
    expect((await lastPull()).counters.photos_queued).toBe(expected.length)
  })

  it('a second pull is all no-ops: no new records, no applied ops, nothing created or changed', async () => {
    await pull()
    const events = await count('events')
    const values = await count('field_values')
    const records = await count('source_records')
    world.clock = new Date(world.clock.getTime() + 60 * 60 * 1000)
    await pull()

    const run = await lastPull()
    expect(run.counters).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 58,
      missing: 0,
      deleted: 0,
      records_new: 0,
      ops_applied: 0,
      nodes_created: 0,
    })
    expect(run.counters.ops_unchanged).toBeGreaterThan(0)
    expect(await count('events')).toBe(events)
    expect(await count('field_values')).toBe(values)
    expect(await count('source_records')).toBe(records)
    // The cursor moved with the successful run.
    expect((await syncState()).cursor).toBe(world.clock.toISOString())
  })

  it('a changed article is an update: the new price lands, the old record stays (append-only)', async () => {
    await pull()
    articleOf(11).actual_price = 1.25
    await pull()
    expect((await lastPull()).counters).toMatchObject({ created: 0, updated: 1, unchanged: 57 })
    const [price] = await world.query<{ value: { amount_minor: number } }>(
      `select fv.value from restro.field_values fv
       join restro.source_links sl on sl.node_id = fv.node_id
       where sl.integration_id = $1 and sl.external_type = 'article' and sl.external_id = '11'
         and fv.field_key = 'price' and fv.layer = 'till'`,
      [world.integrationId],
    )
    expect(price?.value.amount_minor).toBe(125)
    expect(await count('source_records', "external_type = 'article' and external_id = '11'")).toBe(
      2,
    )
  })

  describe('paging', () => {
    it('halves a page that barsy cannot serve in time, down to 25, and keeps going', async () => {
      // Pages longer than 25 "take too long" (barsy's own 30 s error).
      fake.articleFault = (_offset, length) => (length > 25 ? 'server_error' : undefined)
      await pull()
      const lengths = fake.callsOf('Articles_getlist').map((call) => Number(call.params.length))
      expect(lengths).toEqual([500, 250, 125, 62, 31, 25, 25, 25])
      const offsets = fake.callsOf('Articles_getlist').map((call) => Number(call.params.offset))
      expect(offsets).toEqual([0, 0, 0, 0, 0, 0, 25, 50])
      const run = await lastPull()
      expect(run.status).toBe('completed')
      expect(run.counters).toMatchObject({ articles_seen: 60, items_mapped: 58, failed_pages: 0 })
      expect(run.error_summary).toBeNull()
    })

    it('a page that fails three times at 25 is marked failed and the read continues', async () => {
      fake.articleFault = (offset, length) =>
        length > 25 || offset === 25 ? 'server_error' : undefined
      await pull()
      const run = await lastPull()
      expect(run.status).toBe('completed')
      expect(run.counters.failed_pages).toBe(1)
      expect(run.counters.articles_seen).toBe(35)
      expect(run.error_summary).toMatch(/deletion check skipped: 1 of \d+ pages failed/)
      // The structured flag reaches the run's details too (the Integration tab reads it).
      expect(run.details).toMatchObject({ deletionCheckSkipped: true })
      // The other pages were applied; the cursor did not move.
      expect(await count('nodes', "node_type = 'item'")).toBeGreaterThan(0)
      expect((await syncState()).cursor).toBeUndefined()
      expect((await syncState()).tree_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('an unreadable page (not JSON) is a failed page at once, without halving', async () => {
      fake.articleFault = (offset) => (offset === 0 ? 'bad_json' : undefined)
      await pull()
      expect(fake.callsOf('Articles_getlist').map((call) => Number(call.params.length))).toEqual([
        500, 500,
      ])
      expect((await lastPull()).error_summary).toContain('deletion check skipped')
    })

    it('stops after three failed pages in a row', async () => {
      fake.articleFault = () => 'network'
      await pull()
      const run = await lastPull()
      expect(run.counters.failed_pages).toBe(3)
      expect(run.error_summary).toMatch(/deletion check skipped: 3 of \d+ pages failed/)
    })
  })

  describe('absence (rule 6)', () => {
    it('removed from barsy: missing after a complete pull, hidden by the resolver, enrichment kept; put back: active', async () => {
      // The demo's till categories have no public title, and a section without one is blocked.
      // Give the coffee section one in barsy, so that article 40 (public name) can be shown.
      expect(titleCategory(fake.tree, 1, 'Бар')).toBe(true)
      expect(titleCategory(fake.tree, 340, 'Кафе')).toBe(true)
      await pull()
      const link = await linkOf('article', '40')
      const node = link.node_id as NodeId

      // The manager enriches the item (manual layer), as the composer would.
      const enrich: ChangeSet = {
        id: newId('cs'),
        source: 'manual',
        jobId: newId('jb'),
        actor: 'system',
        observedAt: new Date().toISOString(),
        ops: [
          {
            op: 'setField',
            node: { id: node },
            fieldKey: 'description',
            layer: 'manual',
            scope: 'master',
            value: { bg_BG: 'Нашето еспресо' },
          },
        ],
      }
      expect((await apply(world.pool, world.tenantId, enrich)).rejected).toEqual([])

      const visibleItem = async () => {
        const doc = await loadMenuDocument(world.pool, world.tenantId, world.menuId as NodeId)
        const resolved = resolve(VENUE_MENU_TEMPLATE, doc, {
          venueScope: `venue:${world.venueId}`,
          locales: ['bg_BG', 'en_US'],
          now: world.clock.toISOString(),
        })
        return resolved.items[node]?.visible
      }
      expect(await visibleItem()).toBe(true)

      // Gone from barsy (a complete pull without it).
      const kept = fake.articles
      fake.articles = fake.articles.filter((article) => article.article_id !== 40)
      world.clock = new Date(world.clock.getTime() + 10 * 60 * 1000)
      await pull()
      let run = await lastPull()
      expect(run.error_summary).toBeNull()
      expect(run.counters).toMatchObject({ missing: 1, deleted: 0 })
      expect((await linkOf('article', '40')).state).toBe('missing')
      expect(await visibleItem()).toBe(false)
      // The sync did not touch the node's status, and the manager's text is still there.
      const [status] = await world.query<{ status: string }>(
        'select status from restro.nodes where id = $1',
        [node],
      )
      expect(status?.status).toBe('active')
      expect(await count('field_values', `node_id = '${node}' and layer = 'manual'`)).toBe(1)

      // Back in barsy: active again, shown again, with its enrichment.
      fake.articles = kept
      world.clock = new Date(world.clock.getTime() + 10 * 60 * 1000)
      await pull()
      run = await lastPull()
      expect(run.counters).toMatchObject({ missing: 0, reactivated: 1 })
      expect((await linkOf('article', '40')).state).toBe('active')
      expect(await visibleItem()).toBe(true)
    })

    it('missing for seven days: deleted (still hidden, enrichment kept)', async () => {
      await pull()
      fake.articles = fake.articles.filter((article) => article.article_id !== 11)
      await pull()
      expect((await linkOf('article', '11')).state).toBe('missing')
      const day = 24 * 60 * 60 * 1000
      world.clock = new Date(world.clock.getTime() + 8 * day)
      await pull()
      expect((await lastPull()).counters).toMatchObject({ deleted: 1 })
      expect((await linkOf('article', '11')).state).toBe('deleted')
    })

    it('a pull with a failed page concludes nothing, however many articles are absent', async () => {
      await pull()
      const before = await links()
      fake.articles = fake.articles.filter((article) => Number(article.article_id) > 1000)
      fake.articleFault = (offset, length) =>
        length > 25 || offset === 25 ? 'server_error' : undefined
      await pull()
      const run = await lastPull()
      expect(run.counters).toMatchObject({ missing: 0, deleted: 0 })
      expect(run.error_summary).toContain('deletion check skipped')
      const after = await links()
      expect(after.filter((l) => l.state !== 'active')).toEqual([])
      expect(after).toHaveLength(before.length)
    })

    it('a failed combo fetch is a failed unit too: nothing is concluded', async () => {
      fake.articles.push({
        ...articleOf(11),
        article_id: 7183,
        has_supplements: 1,
        categories: ['370'],
      })
      await pull()
      fake.articles = fake.articles.filter((article) => article.article_id !== 40)
      fake.supplementFault = () => true
      await pull()
      const run = await lastPull()
      expect(run.counters.missing).toBe(0)
      expect(run.error_summary).toContain('deletion check skipped')
      expect((await linkOf('article', '40')).state).toBe('active')
    })

    it('the race guard: a link an incremental run saw after this pull began is not absent', async () => {
      await pull()
      const seenAt = world.clock
      fake.articles = fake.articles.filter((article) => article.article_id !== 11)
      // This pull "began" ten minutes before the link was last seen (an incremental run saw it
      // meanwhile): the absence is not evidence.
      world.clock = new Date(seenAt.getTime() - 10 * 60 * 1000)
      await pull()
      let run = await lastPull()
      expect(run.counters.missing).toBe(0)
      expect(run.error_summary).toContain('left alone')
      expect((await linkOf('article', '11')).state).toBe('active')

      // A later pull, started after the last sighting, does conclude it.
      world.clock = new Date(seenAt.getTime() + 10 * 60 * 1000)
      await pull()
      run = await lastPull()
      expect(run.counters.missing).toBe(1)
      expect((await linkOf('article', '11')).state).toBe('missing')
    })

    it('two mapped venues on one catalogue: absence is concluded per catalogue, once (CF-16, T50)', async () => {
      // Before CF-16 a second mapped venue switched the deletion check off for every venue. Now
      // each full pull reads the whole catalogue and concludes for it.
      await pull()
      const second = await provisionVenue(world.pool, world.tenantId, {
        name: 'Second club',
        slug: testSlug('second-club'),
      })
      const [first] = fake.venues
      fake.venues = [...fake.venues, { ...first, barsy_id: 11, name: 'Second', menu_id: 1 }]
      await upsertBarsyVenues(world.pool, world.tenantId, world.integrationId, [
        { bid: 11, name: 'Second' },
      ])
      await world.query(
        `update restro.barsy_venues set venue_id = $1, catalogue_root_cat_id = $2
         where integration_id = $3 and bid = 11`,
        [second.id, DEMO_ROOT_CAT, world.integrationId],
      )
      fake.articles = fake.articles.filter((article) => article.article_id !== 11)
      world.clock = new Date(world.clock.getTime() + 10 * 60 * 1000)
      await pull()
      let run = await lastPull()
      expect(run.counters.missing).toBe(1)
      expect(run.error_summary).toBeNull()
      expect((await linkOf('article', '11')).state).toBe('missing')

      // The second venue reads the same catalogue: it agrees, and has nothing more to conclude.
      world.clock = new Date(world.clock.getTime() + 10 * 60 * 1000)
      await world.run(JOB_NAMES.barsyFullPull, { ...payload(), venueId: second.id })
      run = await lastPull()
      expect(run.status).toBe('completed')
      expect(run.counters).toMatchObject({ missing: 0, deleted: 0, hidden_here: 0 })
      expect((await linkOf('article', '11')).state).toBe('missing')
    })
  })

  describe('combos', () => {
    it('reads the supplements of a combo article and maps groups and options', async () => {
      fake.articles.push({
        ...articleOf(11),
        article_id: 7183,
        has_supplements: 1,
        categories: ['370'],
      })
      await pull()
      const run = await lastPull()
      expect(run.status).toBe('completed')
      expect(run.counters.refused_writes).toBeUndefined()
      expect(await count('nodes', "node_type = 'modifier_group'")).toBe(4)
      expect(await count('nodes', "node_type = 'option'")).toBe(14)
      expect(fake.callsOf('Articlesupplements_get')).toHaveLength(1)
      expect(fake.callsOf('Articlesupplements_get')[0]?.params).toEqual({ article_id: '7183' })
      // Their links are active and carry the supplements record's hash.
      const groups = (await links()).filter((l) => l.external_type === 'supplement_group')
      expect(groups).toHaveLength(4)
      expect(groups.every((l) => l.state === 'active' && l.last_hash !== null)).toBe(true)
    })

    it('the combo disappears from barsy: its groups and options go missing with the next complete pull', async () => {
      fake.articles.push({
        ...articleOf(11),
        article_id: 7183,
        has_supplements: 1,
        categories: ['370'],
      })
      await pull()
      articleOf(7183).has_supplements = 0
      await pull()
      const options = (await links()).filter((l) => l.external_type === 'supplement')
      expect(options.length).toBe(14)
      expect(options.every((l) => l.state === 'missing')).toBe(true)
    })
  })

  it('writes the refused writes into the job run: counters by code and a line of text', async () => {
    // The node id the mapper derives for article 11 is already taken by a section: every write
    // for that item is refused by apply() (id_conflict, invalid_link_type, unknown_node). The
    // pull goes on with the rest and says what it was refused.
    const taken = deriveId('nd', world.integrationId, 'article', '11')
    const occupy: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'system',
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: taken,
          nodeType: 'section',
          parent: { id: world.menuId as NodeId },
          status: 'active',
        },
      ],
    }
    expect((await apply(world.pool, world.tenantId, occupy)).rejected).toEqual([])

    await pull()
    const run = await lastPull()
    expect(run.status).toBe('completed')
    expect(run.counters.refused_writes).toBeGreaterThan(0)
    expect(run.counters.refused_id_conflict).toBeGreaterThan(0)
    expect(run.error_summary).toMatch(/\d+ writes? refused/)
    expect(run.error_summary).toContain('id_conflict')
    // The rest of the catalogue went in.
    expect(await count('nodes', "node_type = 'item'")).toBe(57)
  })

  it('wrong credentials: status error, the run fails, nothing is written, no retry', async () => {
    fake.password = 'changed-in-barsy'
    await expect(pull()).resolves.toBeUndefined()
    const run = await lastPull()
    expect(run.status).toBe('failed')
    expect(await count('nodes', "node_type = 'item'")).toBe(0)
    const [row] = await world.query<{ status: string; status_detail: string }>(
      'select status, status_detail from restro.integrations where id = $1',
      [world.integrationId],
    )
    expect(row).toMatchObject({ status: 'error', status_detail: 'wrong_credentials' })
  })

  it('a venue that is not mapped is skipped without a run, a failure or a call to barsy (CF-18)', async () => {
    await world.query(
      'update restro.barsy_venues set venue_id = null, catalogue_root_cat_id = null where integration_id = $1',
      [world.integrationId],
    )
    await expect(pull()).resolves.toBeUndefined()
    // Skipped with the reason in the log: no run, so nothing is recorded as failed and nothing is
    // written; the till was not asked.
    expect(await fullPulls()).toEqual([])
    expect(world.logLines.join('\n')).toContain('not linked')
    expect(fake.callsOf('Categories_getalltree')).toHaveLength(0)
    expect(fake.calls).toHaveLength(0)
  })

  it('no network leaks: the only host the sync talked to is the integration’s own', async () => {
    await pull()
    expect(fake.calls.length).toBeGreaterThan(5)
    // MSW would have failed the test on any other host (onUnhandledRequest: error).
    expect(fake.calls.every((call) => call.method !== '')).toBe(true)
  })
})
