// barsy-incremental (path E) against the in-memory installation: the tree check that turns into a
// full pull, the `last_update` filter built from the cursor, a changed price landing after one
// run, a cursor that advances only after success, and a run that never concludes absence.
import { JOB_NAMES } from '@restro/core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { lastUpdateFilter, localTimeText } from '../src/sync/cursor'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, DEMO_BID, type World } from './world'

const MINUTE = 60_000

allowSlowSetup()

describe.skipIf(!hasDatabase)('barsy-incremental', () => {
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

  interface RunRow {
    status: string
    counters: Record<string, number>
    error_summary: string | null
  }
  const lastRun = async (kind: string) => {
    const rows = await world.query<RunRow>(
      `select status, counters, error_summary from restro.job_runs
       where integration_id = $1 and kind = $2 order by created_at`,
      [world.integrationId, kind],
    )
    const row = rows.at(-1)
    if (!row) throw new Error(`no ${kind} run`)
    return row
  }
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
  const priceOf = async (articleId: string) =>
    (
      await world.query<{ value: { amount_minor: number } }>(
        `select fv.value from restro.field_values fv
         join restro.source_links sl on sl.node_id = fv.node_id
         where sl.integration_id = $1 and sl.external_type = 'article' and sl.external_id = $2
           and fv.field_key = 'price' and fv.layer = 'barsy'`,
        [world.integrationId, articleId],
      )
    )[0]?.value.amount_minor
  const linkStates = async () =>
    world.query<{ external_type: string; external_id: string; state: string }>(
      `select external_type, external_id, state from restro.source_links
       where integration_id = $1 order by 1, 2`,
      [world.integrationId],
    )

  it('with nothing changed it reads no article, writes nothing and moves the cursor', async () => {
    await fullPull()
    const before = await syncState()
    advance(5)
    await incremental()
    const run = await lastRun('barsy_incremental')
    expect(run.status).toBe('completed')
    expect(run.error_summary).toBeNull()
    expect(run.counters).toMatchObject({ articles_seen: 0, created: 0, updated: 0, ops_applied: 0 })
    const state = await syncState()
    expect(state.cursor).toBe(world.clock.toISOString())
    expect(state.cursor).not.toBe(before.cursor)
    expect(state.last_incremental_at).toBe(world.clock.toISOString())
    expect(state.tree_hash).toBe(before.tree_hash)
  })

  it('asks barsy for changes after the previous run minus 65 minutes, in venue-local time', async () => {
    await fullPull()
    const fullPullStart = world.clock
    advance(5)
    await incremental()
    const calls = fake.callsOf('Articles_getlist')
    // [0] is the full pull's page, [1] the incremental's.
    expect(calls[0]?.params.filters).toEqual({ cat_id_deep: '1091' })
    const expected = `>${lastUpdateFilter(fullPullStart, 'Europe/Sofia')}`
    expect(expected).toMatch(/^>\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
    expect(calls[1]?.params.filters).toEqual({ cat_id_deep: '1091', last_update: expected })
    // The cursor moved to the first incremental's start; the next one looks back from there.
    const firstIncremental = world.clock
    advance(5)
    await incremental()
    expect(fake.callsOf('Articles_getlist')[2]?.params.filters).toMatchObject({
      last_update: `>${lastUpdateFilter(firstIncremental, 'Europe/Sofia')}`,
    })
  })

  it('a price changed in barsy: the new minor price lands after one run', async () => {
    await fullPull()
    expect(await priceOf('11')).toBe(97)
    advance(5)
    const article = articleOf(11)
    article.actual_price = 1.25
    article.last_update = localTimeText(world.clock, 'Europe/Sofia')
    await incremental()

    expect(await priceOf('11')).toBe(125)
    const run = await lastRun('barsy_incremental')
    expect(run.counters).toMatchObject({
      articles_seen: 1,
      items_mapped: 1,
      updated: 1,
      created: 0,
    })
    // Only that article was asked for and recorded.
    expect(
      Number(
        (
          await world.query<{ n: string }>(
            `select count(*) as n from restro.source_records
             where integration_id = $1 and external_type = 'article' and external_id = '11'`,
            [world.integrationId],
          )
        )[0]?.n,
      ),
    ).toBe(2)
  })

  it('a new article in barsy is created, placed in its section and marked seen', async () => {
    await fullPull()
    advance(5)
    fake.articles.push({
      ...articleOf(11),
      article_id: 90001,
      article_name_public: 'Нов кокетейл',
      last_update: localTimeText(world.clock, 'Europe/Sofia'),
    })
    await incremental()
    const run = await lastRun('barsy_incremental')
    expect(run.counters).toMatchObject({ created: 1, updated: 0 })
    const created = (await linkStates()).find((l) => l.external_id === '90001')
    expect(created?.state).toBe('active')
    const [placed] = await world.query<{ n: string }>(
      `select count(*) as n from restro.placements p
       join restro.source_links sl on sl.node_id = p.item_id
       where sl.integration_id = $1 and sl.external_id = '90001'`,
      [world.integrationId],
    )
    expect(Number(placed?.n)).toBe(1)
  })

  it('the cursor advances only after a complete run', async () => {
    await fullPull()
    const first = (await syncState()).cursor
    advance(5)
    fake.articleFault = () => 'server_error'
    await incremental()
    const failed = await lastRun('barsy_incremental')
    expect(failed.status).toBe('completed')
    expect(failed.counters.failed_pages).toBeGreaterThan(0)
    expect((await syncState()).cursor).toBe(first)

    advance(5)
    fake.articleFault = undefined
    await incremental()
    expect((await syncState()).cursor).toBe(world.clock.toISOString())
  })

  it('wrong credentials leave the cursor where it was and mark the integration', async () => {
    await fullPull()
    const first = (await syncState()).cursor
    advance(5)
    fake.password = 'changed-in-barsy'
    await expect(incremental()).resolves.toBeUndefined()
    expect((await lastRun('barsy_incremental')).status).toBe('failed')
    expect((await syncState()).cursor).toBe(first)
  })

  it('never concludes absence: an empty answer leaves every link active', async () => {
    await fullPull()
    const before = await linkStates()
    fake.articles = []
    advance(5)
    await incremental()
    const after = await linkStates()
    expect(after).toEqual(before)
    expect(after.every((link) => link.state === 'active')).toBe(true)
    expect((await lastRun('barsy_incremental')).counters).toMatchObject({ missing: 0, deleted: 0 })
  })

  describe('the category tree check', () => {
    it('a changed tree enqueues a full pull and stops: no article is read', async () => {
      await fullPull()
      // Not within the cool-down of the full pull that just ran.
      await world.query(
        `update restro.job_runs set started_at = started_at - interval '1 hour' where integration_id = $1`,
        [world.integrationId],
      )
      const category = (fake.tree.categories as { category: Record<string, unknown> }[])[0]
      if (!category) throw new Error('the demo tree has no categories')
      category.category.cat_name = 'Renamed in barsy'
      advance(5)
      const articleCalls = fake.callsOf('Articles_getlist').length
      await incremental()

      expect(fake.callsOf('Articles_getlist')).toHaveLength(articleCalls)
      const queued = world.enqueued.filter((job) => job.name === JOB_NAMES.barsyFullPull)
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({ data: payload(), singletonKey: world.integrationId })
      const run = await lastRun('barsy_incremental')
      expect(run.status).toBe('completed')
      expect(run.error_summary).toContain('a full pull was queued')
      // Nothing was marked as done: the cursor is the full pull's.
      expect((await syncState()).last_incremental_at).toBeUndefined()
    })

    it('does not ask again while a full pull ran a moment ago', async () => {
      await fullPull()
      const category = (fake.tree.categories as { category: Record<string, unknown> }[])[0]
      if (!category) throw new Error('the demo tree has no categories')
      category.category.cat_name = 'Renamed in barsy'
      advance(5)
      await incremental()
      expect(world.enqueued.filter((job) => job.name === JOB_NAMES.barsyFullPull)).toHaveLength(0)
      expect((await lastRun('barsy_incremental')).error_summary).toContain('ran a moment ago')
    })

    it('an integration that never had a full pull asks for one', async () => {
      await incremental()
      expect(world.enqueued.filter((job) => job.name === JOB_NAMES.barsyFullPull)).toHaveLength(1)
      expect(fake.callsOf('Articles_getlist')).toHaveLength(0)
    })

    it('after the full pull it asked for, the incremental runs go on normally', async () => {
      await incremental()
      await fullPull()
      advance(5)
      await incremental()
      expect((await lastRun('barsy_incremental')).error_summary).toBeNull()
      expect(fake.callsOf('Articles_getlist')).toHaveLength(2)
    })
  })

  it('is skipped while a full pull is running', async () => {
    await fullPull()
    await world.query(
      `insert into restro.job_runs (id, tenant_id, integration_id, kind, status, started_at)
       values ($1, $2, $3, 'barsy_full_pull', 'running', now())`,
      [`jb_${'R'.repeat(22)}`, world.tenantId, world.integrationId],
    )
    const calls = fake.calls.length
    advance(5)
    await incremental()
    expect(fake.calls).toHaveLength(calls)
    expect((await lastRun('barsy_incremental')).error_summary).toContain(
      'skipped: a full pull is running',
    )
  })

  it('a full pull that crashed long ago does not block the incremental runs for ever', async () => {
    await fullPull()
    await world.query(
      `insert into restro.job_runs (id, tenant_id, integration_id, kind, status, started_at)
       values ($1, $2, $3, 'barsy_full_pull', 'running', now() - interval '3 hours')`,
      [`jb_${'S'.repeat(22)}`, world.tenantId, world.integrationId],
    )
    advance(5)
    await incremental()
    expect((await lastRun('barsy_incremental')).error_summary).toBeNull()
  })
})
