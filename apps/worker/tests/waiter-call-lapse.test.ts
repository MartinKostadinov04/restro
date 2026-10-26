// The waiter-call lapse (#81) on Postgres: a call nobody answered in the venue's time lapses once,
// a live call is left alone, a call whose sitting ended lapses at once, and a call that throws is
// skipped, not the run.
import { randomUUID } from 'node:crypto'

import { DEFAULT_ORDERING_SETTINGS, hashTableCode, newId, serviceDate } from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { forgetGuestCodes, guestAct } from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { dueWaiterCalls, lapseWaiterCalls } from '../src/jobs/waiter-call-lapse'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

// The call whose `waiter_call.lapse` throws, for the one test that wants a failing call.
const failing = vi.hoisted(() => ({ waiterCallId: null as string | null }))
vi.mock('@restro/core/service', async (original) => {
  const service = await original<typeof import('@restro/core/service')>()
  return {
    ...service,
    applyService: (...args: Parameters<typeof service.applyService>) => {
      const command = args[1] as { readonly waiterCallId?: string }
      if (command.waiterCallId !== undefined && command.waiterCallId === failing.waiterCallId) {
        return Promise.reject(new Error('the call could not lapse'))
      }
      return service.applyService(...args)
    },
  }
})

allowSlowSetup()

const quiet = { warn: () => undefined }

describe.skipIf(!hasDatabase)('the waiter-call lapse job', () => {
  let db: TestDatabase
  let pool: DbPool
  const tenantId = newId('tn')
  let venueId: string
  const tables: string[] = []
  const calls: string[] = []

  const query = (sql: string, values: unknown[] = []) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows)
  const stateOf = async (id: string) =>
    (
      (await query('select state from restro.waiter_calls where id = $1', [id])) as {
        state: string
      }[]
    )[0]?.state

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-waiter-lapse-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Lapse club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Lapse club', $2)`,
      [tenantId, `lapse-${newId('tn').slice(3, 11)}`],
    )
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Lapse Bar',
      slug: testSlug('lapse'),
    })
    venueId = venue.id
    await query(
      `update restro.venues
          set settings = settings || jsonb_build_object(
            'ordering', $2::jsonb,
            'guest_features', $3::jsonb)
        where id = $1`,
      [
        venue.id,
        JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, callLapseMinutes: 15 }),
        JSON.stringify({
          filters: true,
          call_waiter: { enabled: true, kinds: ['waiter'] },
          bill: false,
          ordering: true,
          pay: false,
        }),
      ],
    )
    const area = await createArea(pool, tenantId, venue.id, 'Hall')
    if (!area.ok) throw new Error(area.reason)
    for (const number of ['1', '2', '3', '4']) {
      const table = await createTable(pool, tenantId, { areaId: area.area.id, name: null, number })
      if (!table.ok) throw new Error(table.reason)
      tables.push(table.table.id)
      const code = `lapse${randomUUID().replaceAll('-', '')}`
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
      const called = await guestAct(pool, {
        code,
        command: { type: 'service.request', actionId: randomUUID(), request: 'waiter', note: '' },
        ageMs: 10,
        view: 'menu',
        phone: randomUUID(),
      })
      if (!called.ok || called.result.status !== 'accepted') throw new Error('the call was refused')
      calls.push(called.state?.waiterCall?.id as string)
    }
    forgetGuestCodes()
  })

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  it('lapses only the call that is past its time, once', async () => {
    const [old, fresh] = calls as [string, string]
    await query(
      `update restro.waiter_calls set called_at = now() - interval '16 minutes' where id = $1`,
      [old],
    )
    expect(await dueWaiterCalls(pool, new Date())).toEqual([
      { tenantId, venueId, waiterCallId: old },
    ])
    expect(await lapseWaiterCalls(pool, new Date(), quiet)).toBe(1)
    expect(await lapseWaiterCalls(pool, new Date(), quiet)).toBe(0)
    expect(await stateOf(old)).toBe('lapsed')
    expect(await stateOf(fresh)).toBe('open')
  })

  it('lapses a call at once when its sitting has ended', async () => {
    const ended = calls[1] as string
    await query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
        where table_id = $1 and ended_at is null`,
      [tables[1]],
    )
    expect(await lapseWaiterCalls(pool, new Date(), quiet)).toBe(1)
    expect(await stateOf(ended)).toBe('lapsed')
  })

  it('logs a call that throws and still lapses the others', async () => {
    const [broken, fine] = calls.slice(2) as [string, string]
    await query(
      `update restro.waiter_calls set called_at = now() - interval '20 minutes' where id = any($1)`,
      [[broken, fine]],
    )
    failing.waiterCallId = broken
    const warn = vi.fn()
    try {
      expect(await lapseWaiterCalls(pool, new Date(), { warn })).toBe(1)
    } finally {
      failing.waiterCallId = null
    }
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ waiterCallId: broken, err: expect.any(Error) })
    expect(await stateOf(fine)).toBe('lapsed')
    expect(await stateOf(broken)).toBe('open')
  })
})
