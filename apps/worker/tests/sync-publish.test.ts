// The publish after a sync (brief S3-01b, doc "Publish policy"): a pull that applied at least one
// op queues an automatic publish of the venue's menu (30 s delay, one key per menu + venue), unless
// the venue says `publish.after_sync = manual` (CF-09b), or, for a venue that never saved its
// rules, the integration's old `publish.after_sync = manual` (or the older flat key
// `publish_after_sync = false`). Against the in-memory barsy installation,
// through the pull jobs' real handlers.
import { JOB_NAMES } from '@restro/core'
import { provisionVenue } from '@restro/core/apply'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { queuePublishAfterSync, venuePublishesAfterSync } from '../src/publish/after-sync'
import { localTimeText } from '../src/sync/cursor'
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

const MINUTE = 60_000

allowSlowSetup()

describe.skipIf(!hasDatabase)('the publish after a sync', () => {
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
  const logged = () => world.logLines.join('\n')
  const publishes = () => world.enqueued.filter((job) => job.name === JOB_NAMES.publishMenu)
  const setConfig = (patch: Record<string, unknown>) =>
    world.query('update restro.integrations set config = config || $2::jsonb where id = $1', [
      world.integrationId,
      JSON.stringify(patch),
    ])
  const lastRun = async (kind: string) => {
    const rows = await world.query<{
      status: string
      counters: Record<string, number>
      details: { notes: string[] } | null
    }>(
      `select status, counters, details from restro.job_runs
       where integration_id = $1 and kind = $2 order by created_at`,
      [world.integrationId, kind],
    )
    const row = rows.at(-1)
    if (!row) throw new Error(`no ${kind} run`)
    return row
  }
  const articleOf = (id: number) => {
    const article = fake.articles.find((a) => a.article_id === id)
    if (!article) throw new Error(`no article ${id}`)
    return article
  }
  /** barsy changes a price; the next incremental run picks it up. */
  const changePrice = (price: number) => {
    const article = articleOf(11)
    article.actual_price = price
    article.last_update = localTimeText(world.clock, 'Europe/Sofia')
  }

  it('a full pull that changed the document queues an automatic publish, 30 s later', async () => {
    await fullPull()
    expect(publishes()).toEqual([
      {
        name: JOB_NAMES.publishMenu,
        data: {
          tenantId: world.tenantId,
          menuId: world.menuId,
          venueId: world.venueId,
          reason: 'auto_sync',
          actor: `integration:${world.integrationId}`,
        },
        // One key for automatic publishes of this menu + venue: a second sync joins this one.
        singletonKey: `${world.menuId}:${world.venueId}:auto`,
        startAfter: 30,
      },
    ])
    // The queue is logged, not added to the pull's run text.
    const run = await lastRun('barsy_full_pull')
    expect(run.status).toBe('completed')
    expect(run.details?.notes).toEqual([])
    expect(logged()).toContain('publish queued to run in 30 s')
  })

  it('a pull that applied nothing queues no publish', async () => {
    await fullPull()
    world.enqueued.length = 0
    advance(5)
    await incremental()
    expect((await lastRun('barsy_incremental')).counters).toMatchObject({ ops_applied: 0 })
    expect(publishes()).toEqual([])
    // A second full pull of an unchanged installation applies nothing either.
    await fullPull()
    expect((await lastRun('barsy_full_pull')).counters).toMatchObject({ ops_applied: 0 })
    expect(publishes()).toEqual([])
  })

  it('an incremental run that applied a changed price queues one too', async () => {
    await fullPull()
    world.enqueued.length = 0
    advance(5)
    changePrice(1.25)
    await incremental()
    expect((await lastRun('barsy_incremental')).counters.ops_applied).toBeGreaterThan(0)
    expect(publishes()).toHaveLength(1)
    expect(publishes()[0]).toMatchObject({
      data: { reason: 'auto_sync', menuId: world.menuId },
      startAfter: 30,
    })
  })

  it('publish_after_sync = false: nothing is queued, and the run says so', async () => {
    await setConfig({ publish_after_sync: false })
    await fullPull()
    expect((await lastRun('barsy_full_pull')).counters.ops_applied).toBeGreaterThan(0)
    expect(publishes()).toEqual([])
    expect(logged()).toContain('publish after sync is off for this venue: nothing was queued')

    advance(5)
    changePrice(1.5)
    await incremental()
    expect(publishes()).toEqual([])

    // Switched on again, the next change publishes.
    await setConfig({ publish_after_sync: true })
    advance(5)
    changePrice(1.75)
    await incremental()
    expect(publishes()).toHaveLength(1)
  })

  it('publish.after_sync = manual (D59): nothing is queued, until the setting is auto again', async () => {
    await setConfig({ publish: { after_sync: 'manual', new_items: 'show' } })
    await fullPull()
    expect((await lastRun('barsy_full_pull')).counters.ops_applied).toBeGreaterThan(0)
    expect(publishes()).toEqual([])
    expect(logged()).toContain('publish after sync is off for this venue: nothing was queued')

    advance(5)
    changePrice(1.5)
    await incremental()
    expect(publishes()).toEqual([])

    await setConfig({ publish: { after_sync: 'auto', new_items: 'show' } })
    advance(5)
    changePrice(1.75)
    await incremental()
    expect(publishes()).toHaveLength(1)
    expect(publishes()[0]).toMatchObject({ data: { reason: 'auto_sync' }, startAfter: 30 })
  })

  it('publish.after_sync wins over the flat key of S3-01b, and the flat key still works alone', async () => {
    // New key says auto, the old one says false: auto.
    await setConfig({ publish_after_sync: false, publish: { after_sync: 'auto' } })
    await fullPull()
    expect(publishes()).toHaveLength(1)

    // New key says manual, the old one says nothing: manual.
    world.enqueued.length = 0
    await setConfig({ publish_after_sync: true, publish: { after_sync: 'manual' } })
    advance(5)
    changePrice(2.25)
    await incremental()
    expect(publishes()).toEqual([])

    // An unknown new value falls back to the old key.
    await setConfig({ publish_after_sync: false, publish: { after_sync: 'later' } })
    advance(5)
    changePrice(2.5)
    await incremental()
    expect(publishes()).toEqual([])
  })

  it('a missing setting means publish (the default of the doc’s publish policy)', async () => {
    const [row] = await world.query<{ config: Record<string, unknown> }>(
      'select config from restro.integrations where id = $1',
      [world.integrationId],
    )
    expect(row?.config).not.toHaveProperty('publish_after_sync')
    await fullPull()
    expect(publishes()).toHaveLength(1)
  })

  describe('queuePublishAfterSync', () => {
    const target = () => ({ ...payload(), config: {} as unknown })
    const env = () => ({ pool: world.pool, log: world.env.log, enqueue: world.env.enqueue })

    it('notes a venue without a menu instead of failing', async () => {
      const bare = await provisionVenue(world.pool, world.tenantId, {
        name: 'Bare',
        slug: testSlug('bare'),
      })
      const note = await queuePublishAfterSync(env(), { ...target(), venueId: bare.id }, 3)
      expect(note).toBe('this venue has no menu yet: nothing was queued to publish')
      expect(publishes()).toEqual([])
    })

    it('says a waiting publish absorbed this sync (the queue answered null)', async () => {
      const note = await queuePublishAfterSync({ ...env(), enqueue: async () => null }, target(), 1)
      expect(note).toBe('a publish is already waiting for this menu: this sync joins it')
    })

    it('never throws when the queue is down: the pull is already applied', async () => {
      const note = await queuePublishAfterSync(
        {
          ...env(),
          enqueue: async () => {
            throw new Error('queue down')
          },
        },
        target(),
        1,
      )
      expect(note).toBe('the publish after this sync could not be queued')
    })

    it('does nothing for a pull that applied nothing', async () => {
      expect(await queuePublishAfterSync(env(), target(), 0)).toBeNull()
      expect(publishes()).toEqual([])
    })

    it('reads the setting: only an explicit false turns it off', () => {
      for (const config of [
        {},
        null,
        undefined,
        'text',
        { publish_after_sync: true },
        { other: 1 },
      ]) {
        expect(venuePublishesAfterSync({}, config), JSON.stringify(config)).toBe(true)
      }
      expect(venuePublishesAfterSync({}, { publish_after_sync: false })).toBe(false)
    })
  })
})
