// The idle order job (#75) on Postgres: an order nobody touched for the idle time is set aside as
// the table's earlier order, once; an order still in use and a table with no open sitting are left
// alone, so a run that races a phone changes nothing.
import { randomUUID } from 'node:crypto'

import { hashTableCode, newId, serviceDate } from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { forgetGuestCodes, guestAct, guestState } from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idleOrders, tidyIdleOrders } from '../src/jobs/order-tidy'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

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
    const area = await createArea(pool, tenantId, venue.id, 'Hall')
    if (!area.ok) throw new Error(area.reason)
    for (const number of ['1', '2']) {
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
    expect(await idleOrders(pool, new Date())).toEqual([{ tenantId, venueId, tableId: idle }])
    expect(await tidyIdleOrders(pool, new Date())).toBe(1)
    expect(await tidyIdleOrders(pool, new Date())).toBe(0)

    forgetGuestCodes()
    const read = async (code: string) => {
      const answer = await guestState(pool, { code, view: 'order' })
      if (!answer.ok || answer.answer.unchanged) throw new Error('expected a full state')
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
    expect(await idleOrders(pool, new Date())).toEqual([])
    expect(await tidyIdleOrders(pool, new Date())).toBe(0)
  })
})
