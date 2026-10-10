// One pull of an integration at a time (brief S2-08): the Postgres advisory lock both pull
// handlers run inside, on a real Postgres as restro_app with the real handlers and a slow
// in-memory barsy. The fake installation records the order of its calls, so "never overlap" is
// checked on what barsy saw: one pull's first call (the tree) never comes before the previous
// pull's last (the places).
import { JOB_NAMES } from '@restro/core'
import { tryAdvisoryLock } from '@restro/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { PULL_LOCKS_MAX, pullLockName, withPullLock } from '../src/sync/pull-lock'
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
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

allowSlowSetup()

describe.skipIf(!hasDatabase)('the pull lock', () => {
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
  // Short waits so the tests are quick; the pool is the real worker's (two connections).
  const open = async (options: Parameters<typeof createWorld>[1] = {}) => {
    world = await createWorld(fake, {
      database: db,
      pullLockWaitMs: 10_000,
      pullLockPollMs: 25,
      ...options,
    })
  }
  beforeEach(async () => {
    fake.reset()
    await open()
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

  const runs = (kind: string) =>
    world.query<{ status: string; counters: Record<string, number>; error_summary: string | null }>(
      `select status, counters, error_summary from restro.job_runs
       where integration_id = $1 and kind = $2 order by created_at`,
      [world.integrationId, kind],
    )
  /** Advisory locks held in this database right now (any session). */
  const advisoryLocks = async () =>
    Number(
      (
        await world.query<{ n: string }>(
          `select count(*) as n from pg_locks
           where locktype = 'advisory'
             and database = (select oid from pg_database where datname = current_database())`,
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
  /** What marks a pull in the fake's call log: it starts with the tree and ends with the places. */
  const pullMarks = () =>
    fake.calls
      .map((call) => call.method)
      .filter((method) => method === 'Categories_getalltree' || method === 'Places_getlist')
  const TREE = 'Categories_getalltree'
  const PLACES = 'Places_getlist'

  /** Holds the integration's lock from outside the worker, like another process would. */
  const holdElsewhere = async () => {
    const lock = await tryAdvisoryLock(world.pool, pullLockName(world.integrationId))
    if (lock === null) throw new Error('the lock was not free')
    return lock
  }
  /** Makes the first article page of the next pull slow, and says when it is being served. */
  const slowArticles = (ms: number) => {
    let serving: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      serving = resolve
    })
    fake.onCall = async (method) => {
      if (method !== 'Articles_getlist') return
      serving()
      await sleep(ms)
    }
    return started
  }

  describe.each([
    ['the real worker’s pool of two (one lock at a time)', {}],
    ['a pool of four (the lock itself keeps them apart)', { poolMax: 4, pullLocksMax: 3 }],
  ] as const)('two full pulls of one integration started together, %s', (_name, options) => {
    it('never overlap: one is over before the other begins', async () => {
      await world.close()
      await open(options)
      slowArticles(300)
      await Promise.all([fullPull(), fullPull()])
      expect(pullMarks()).toEqual([TREE, PLACES, TREE, PLACES])
      expect((await runs('barsy_full_pull')).map((run) => run.status)).toEqual([
        'completed',
        'completed',
      ])
      expect(await advisoryLocks()).toBe(0)
    })
  })

  it('is held for the whole pull and gone when it ends', async () => {
    let during = -1
    fake.onCall = async (method) => {
      if (method === 'Articles_getlist') during = await advisoryLocks()
    }
    await fullPull()
    expect(during).toBe(1)
    expect(await advisoryLocks()).toBe(0)
  })

  it('an incremental run started while a full pull holds the lock is skipped and reads no article', async () => {
    await fullPull()
    fake.calls.length = 0
    world.clock = new Date(world.clock.getTime() + 5 * MINUTE)
    const reading = slowArticles(400)
    const full = fullPull()
    await reading
    await incremental()
    await full
    // Only the full pull read: one tree, one article page.
    expect(fake.callsOf(TREE)).toHaveLength(1)
    expect(fake.callsOf('Articles_getlist')).toHaveLength(1)
    const [skipped] = await runs('barsy_incremental')
    expect(skipped).toMatchObject({ status: 'completed' })
    expect(skipped?.error_summary).toContain('skipped: another pull is running')
    expect(await advisoryLocks()).toBe(0)
  })

  it('an incremental run is skipped too when the lock is held outside the worker', async () => {
    await fullPull()
    fake.calls.length = 0
    world.clock = new Date(world.clock.getTime() + 5 * MINUTE)
    const held = await holdElsewhere()
    try {
      await incremental()
    } finally {
      await held.release()
    }
    expect(fake.calls).toEqual([])
    expect((await runs('barsy_incremental'))[0]?.error_summary).toContain(
      'skipped: another pull is running',
    )
  })

  it('a full pull requested while an incremental run holds the lock runs after it ends', async () => {
    await fullPull()
    fake.calls.length = 0
    world.clock = new Date(world.clock.getTime() + 5 * MINUTE)
    const reading = slowArticles(400)
    let incrementalDoneWhenFullBegan: boolean | undefined
    const slow = fake.onCall
    fake.onCall = async (method, params) => {
      if (method === TREE && fake.callsOf(TREE).length === 2) {
        incrementalDoneWhenFullBegan = (await syncState()).last_incremental_at !== undefined
      }
      await slow?.(method, params)
    }
    const running = incremental()
    await reading
    world.enqueued.length = 0
    await fullPull()
    await running

    expect(incrementalDoneWhenFullBegan).toBe(true)
    const [full] = (await runs('barsy_full_pull')).slice(-1)
    expect(full?.status).toBe('completed')
    expect(full?.counters).toMatchObject({ items_mapped: expect.any(Number) })
    expect(full?.error_summary ?? '').not.toContain('another pull')
    // It waited rather than being queued again.
    expect(world.enqueued.filter((job) => job.name === JOB_NAMES.barsyFullPull)).toEqual([])
  })

  it('a full pull still blocked after its wait is queued again for later, and says so', async () => {
    await world.close()
    await open({ pullLockWaitMs: 200 })
    const held = await holdElsewhere()
    try {
      await fullPull()
    } finally {
      await held.release()
    }
    const [run] = await runs('barsy_full_pull')
    expect(run).toMatchObject({ status: 'completed' })
    expect(run?.error_summary).toContain('another pull is running')
    // It did not even open the integration.
    expect(fake.calls).toEqual([])

    const again = world.enqueued.filter((job) => job.name === JOB_NAMES.barsyFullPull)
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ data: payload(), startAfter: 60 })
    // The running job still holds the plain key, and the queue's exclusive policy would drop a
    // second job with it, so the copy has a key of its own.
    expect(again[0]?.singletonKey).not.toBe(world.integrationId)
    expect(again[0]?.singletonKey).toMatch(new RegExp(`^${world.integrationId}:later:\\d+$`))

    // The queued copy runs normally once the lock is free.
    await world.run(JOB_NAMES.barsyFullPull, again[0]?.data ?? {})
    expect((await runs('barsy_full_pull')).at(-1)?.counters).toMatchObject({
      items_mapped: expect.any(Number),
    })
  })

  it('a different integration is never blocked', async () => {
    await world.close()
    await open({ poolMax: 4, pullLocksMax: 3 })
    const other = world.integrationId.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))
    const options = { waitMs: 0, maxHeld: 3 }
    const result = await withPullLock(
      world.env,
      world.integrationId,
      async () => ({
        other: await withPullLock(world.env, other, async () => 'ran', options),
        same: await withPullLock(world.env, world.integrationId, async () => 'ran', options),
      }),
      options,
    )
    expect(result).toEqual({
      acquired: true,
      value: {
        other: { acquired: true, value: 'ran' },
        same: { acquired: false },
      },
    })
    expect(await advisoryLocks()).toBe(0)
  })

  it('a process never holds every connection of its pool as a lock', async () => {
    // With the real worker's pool of two, a second lock is refused instead of taken, so that a
    // pull always has a connection left for its own queries.
    expect(PULL_LOCKS_MAX).toBe(1)
    const result = await withPullLock(
      world.env,
      world.integrationId,
      async () => withPullLock(world.env, 'in_otherintegration', async () => 'ran', { waitMs: 0 }),
      { waitMs: 0 },
    )
    expect(result).toEqual({ acquired: true, value: { acquired: false } })
  })

  describe('is released after an error', () => {
    it('thrown by the work', async () => {
      await expect(
        withPullLock(
          world.env,
          world.integrationId,
          async () => {
            throw new Error('boom')
          },
          { waitMs: 0 },
        ),
      ).rejects.toThrow('boom')
      expect(await advisoryLocks()).toBe(0)
      const again = await withPullLock(world.env, world.integrationId, async () => 1, {
        waitMs: 0,
      })
      expect(again).toEqual({ acquired: true, value: 1 })
    })

    it('in a pull that fails for good (the run fails, nothing is thrown)', async () => {
      fake.password = 'changed-after-the-credentials-were-sealed'
      await fullPull()
      expect((await runs('barsy_full_pull'))[0]?.status).toBe('failed')
      expect(await advisoryLocks()).toBe(0)
    })

    it('in a pull that throws (the queue retries it)', async () => {
      fake.tree = null as never
      await expect(fullPull()).rejects.toThrow()
      expect((await runs('barsy_full_pull'))[0]?.status).toBe('failed')
      expect(await advisoryLocks()).toBe(0)

      fake.reset()
      await fullPull()
      expect((await runs('barsy_full_pull')).at(-1)?.status).toBe('completed')
    })
  })
})
