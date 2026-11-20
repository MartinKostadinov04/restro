// The idle order job (#75) on Postgres: an order nobody touched for the idle time is set aside as
// the table's earlier order, once; an order still in use and a table with no open sitting are left
// alone, so a run that races a phone changes nothing; a table that throws is skipped, not the run.
import { randomUUID } from 'node:crypto'

import {
  DEFAULT_GUEST_FEATURES,
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  newId,
  serviceDate,
} from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { forgetGuestCodes, guestAct, guestState } from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { idleOrders, orderTidyTick, tidyIdleOrders } from '../src/jobs/order-tidy'
import type { WorkerContext } from '../src/jobs/types'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

// The table whose `order.tidy` throws, for the one test that wants a failing table.
const failing = vi.hoisted(() => ({ tableId: null as string | null }))
vi.mock('@restro/core/service', async (original) => {
  const service = await original<typeof import('@restro/core/service')>()
  return {
    ...service,
    applyService: (...args: Parameters<typeof service.applyService>) => {
      const command = args[1] as { readonly tableId?: string }
      if (command.tableId !== undefined && command.tableId === failing.tableId) {
        return Promise.reject(new Error('the table could not be tidied'))
      }
      return service.applyService(...args)
    },
  }
})

// A database that answers in memory, for the tests that want one organisation's listing to fail.
const fake = vi.hoisted(() => ({
  on: false,
  organisations: [] as string[],
  broken: null as string | null,
  rows: [] as { venueId: string; tableId: string }[],
}))
vi.mock('@restro/db', async (original) => {
  const db = await original<typeof import('@restro/db')>()
  return {
    ...db,
    withSystem: ((...args: Parameters<typeof db.withSystem>) =>
      fake.on
        ? Promise.resolve(fake.organisations.map((id) => ({ id })))
        : db.withSystem(...args)) as typeof db.withSystem,
    withTenant: ((...args: Parameters<typeof db.withTenant>) => {
      if (!fake.on) return db.withTenant(...args)
      if (args[1] === fake.broken) return Promise.reject(new Error('this organisation is down'))
      return Promise.resolve(fake.rows)
    }) as typeof db.withTenant,
  }
})

allowSlowSetup()

const quiet = { warn: () => undefined, error: () => undefined }

describe('the minute tick (screen round 11-18, C4)', () => {
  it('runs every pass when the one before it fails, then fails the tick', async () => {
    const down = (): never => {
      throw new Error('the database is down')
    }
    const pool = { connect: async () => down(), query: async () => down() } as unknown as DbPool
    const error = vi.fn()
    const log = { info: vi.fn(), warn: vi.fn(), error, child: () => log }
    const context = { pool, log, now: () => new Date() } as unknown as WorkerContext
    await expect(orderTidyTick.handler([], context)).rejects.toThrow(
      'order-tidy-tick: tidy, lapse, sweep failed',
    )
    const passes = error.mock.calls
      .map((call) => (call[0] as { pass?: string }).pass)
      .filter((pass) => pass !== undefined)
    expect(passes).toEqual(['tidy', 'lapse', 'sweep'])
  })

  it("lists the other organisations' idle orders when one cannot be listed, then fails the pass", async () => {
    Object.assign(fake, {
      on: true,
      organisations: ['tn_down', 'tn_up'],
      broken: 'tn_down',
      rows: [{ venueId: 'vn_up', tableId: 'tb_up' }],
    })
    failing.tableId = 'tb_up'
    try {
      const error = vi.fn()
      const failed: unknown[] = []
      const pool = {} as DbPool
      expect(await idleOrders(pool, new Date(), { warn: vi.fn(), error }, failed)).toEqual([
        { tenantId: 'tn_up', venueId: 'vn_up', tableId: 'tb_up' },
      ])
      expect(failed).toHaveLength(1)
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tn_down' }),
        'the idle orders could not be listed',
      )
      // The listed table is still tried (here it throws and is skipped); then the pass fails.
      const warn = vi.fn()
      await expect(tidyIdleOrders(pool, new Date(), { warn, error })).rejects.toThrow(
        '1 organisation(s) could not list idle orders',
      )
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ tableId: 'tb_up' }),
        'an idle order could not be set aside',
      )
    } finally {
      fake.on = false
      failing.tableId = null
    }
  })
})

describe.skipIf(!hasDatabase)('the idle order job', () => {
  let db: TestDatabase
  let pool: DbPool
  const tenantId = newId('tn')
  let venueId: string
  const tables: string[] = []
  const codes: string[] = []

  const query = (sql: string, values: unknown[] = []) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows)

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-order-tidy-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Tidy club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Tidy club', $2)`,
      [tenantId, `tidy-${newId('tn').slice(3, 11)}`],
    )
    const venue = await provisionVenue(pool, tenantId, { name: 'Tidy Bar', slug: testSlug('tidy') })
    venueId = venue.id
    // The location check (#76) off: these phones hold no pass.
    await query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [venue.id, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )
    // Ordering from the phone is on: these phones add to their orders.
    await query(
      `update restro.venues set settings = jsonb_set(settings, '{guest_features}', $2::jsonb) where id = $1`,
      [venue.id, JSON.stringify({ ...DEFAULT_GUEST_FEATURES, ordering: true })],
    )
    const area = await createArea(pool, tenantId, venue.id, 'Hall')
    if (!area.ok) throw new Error(area.reason)
    for (const number of ['1', '2', '3', '4']) {
      const table = await createTable(pool, tenantId, { areaId: area.area.id, name: null, number })
      if (!table.ok) throw new Error(table.reason)
      tables.push(table.table.id)
      const code = `tidy${randomUUID().replaceAll('-', '')}`
      codes.push(code)
      await query('update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1', [
        table.table.id,
        code,
        await hashTableCode(code),
      ])
      await query(
        `insert into restro.sittings
           (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
         values ($1, $2, $3, $4, $5, 'one', 'restro', 'system', 'test-seed')`,
        [
          newId('st'),
          tenantId,
          venue.id,
          table.table.id,
          serviceDate(new Date(), venue.timezone, venue.serviceDayEndsAt),
        ],
      )
      const added = await guestAct(pool, {
        code,
        command: {
          type: 'order.add',
          actionId: randomUUID(),
          itemId: newId('nd'),
          optionIds: [],
          qty: 1,
          note: '',
        },
        ageMs: 10,
        view: 'order',
        phone: randomUUID(),
      })
      if (!added.ok || added.result.status !== 'accepted') throw new Error('the add was refused')
    }
  })

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  it('sets aside only the order that went idle, once', async () => {
    const idle = tables[0] as string
    await query(
      `update restro.table_orders set idle_expires_at = now() - interval '1 second'
        where table_id = $1`,
      [idle],
    )
    expect(await idleOrders(pool, new Date(), quiet)).toEqual([
      { tenantId, venueId, tableId: idle },
    ])
    expect(await tidyIdleOrders(pool, new Date(), quiet)).toBe(1)
    expect(await tidyIdleOrders(pool, new Date(), quiet)).toBe(0)

    forgetGuestCodes()
    const read = async (code: string) => {
      const answer = await guestState(pool, { code, view: 'order' })
      if (!answer.ok || answer.answer.unchanged || answer.answer.order === null) {
        throw new Error('expected a full state with the order')
      }
      return answer.answer.order
    }
    const aside = await read(codes[0] as string)
    expect(aside.lines).toEqual([])
    expect(aside.earlier?.lines).toHaveLength(1)
    const kept = await read(codes[1] as string)
    expect(kept.lines).toHaveLength(1)
    expect(kept.earlier).toBeNull()
  })

  it('leaves a table whose sitting ended alone', async () => {
    const busy = tables[1] as string
    await query(
      `update restro.table_orders set idle_expires_at = now() - interval '1 second'
        where table_id = $1`,
      [busy],
    )
    await query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
        where table_id = $1 and ended_at is null`,
      [busy],
    )
    expect(await idleOrders(pool, new Date(), quiet)).toEqual([])
    expect(await tidyIdleOrders(pool, new Date(), quiet)).toBe(0)
  })

  it('logs a table that throws and still sets aside the others', async () => {
    const [broken, fine] = tables.slice(2) as [string, string]
    await query(
      `update restro.table_orders set idle_expires_at = now() - interval '1 second'
        where table_id = any($1)`,
      [[broken, fine]],
    )
    failing.tableId = broken
    const warn = vi.fn()
    try {
      expect(await tidyIdleOrders(pool, new Date(), { warn, error: () => undefined })).toBe(1)
    } finally {
      failing.tableId = null
    }
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ tableId: broken, err: expect.any(Error) })
    expect(await idleOrders(pool, new Date(), quiet)).toEqual([
      { tenantId, venueId, tableId: broken },
    ])
  })
})
