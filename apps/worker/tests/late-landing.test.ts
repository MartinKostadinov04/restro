// The late landing of an Unconfirmed sent order (#135; D115, D116, D122 §4) on Postgres through the
// real Send and reading jobs, against a real simulator server over HTTP. A round whose write lands
// only after the read-back window ends Unconfirmed (the table pauses, one alert); the table goes on
// being read, and the reading that shows the round after all writes one Log entry
// (`sent_order.landed_late`) and the matched POS lines on the sent order, once. It never sends the
// round again and never moves the sent order back to Added. A reading that shows other changes too
// (a waiter's round), a partial reading and a reading after the service day concluded nothing
// (rule 6).
import { type IntegrationId, newId, serviceDate, type VenueId } from '@restro/core'
import {
  createIntegration,
  mapBarsyVenue,
  provisionTenant,
  provisionVenue,
  setFloorSource,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import { createSimServer, ManualClock, type SimServer } from '@restro/sim-pos'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ConnectionBreakers } from '../src/jobs/breaker'
import { InstanceBudgets, readFloorOf } from '../src/jobs/floor'
import { sendTableOrders } from '../src/jobs/order-send'
import { ReadingBudgets, readTableOf, TABLE_READ_MIN_GAP_MS } from '../src/jobs/readings'
import { createLogger } from '../src/logger'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

const KEY = 'late-landing-test-key-'.padEnd(48, 'x')
/** Demo Bar's table 1 on the simulator, and three of its articles. */
const POS_TABLE = '30001'
const ARTICLE_A = '2001'
const ARTICLE_B = '2002'
const FIRST = '2003'
/** More than the simulator's `lateLandingMs` (two minutes). */
const LATE_MS = 130_000

describe.skipIf(!hasDatabase)('the late landing of an Unconfirmed sent order', () => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  const simClock = new ManualClock()
  const tenantId = newId('tn')
  let log: Awaited<ReturnType<typeof createLogger>>
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  let tableId: `tb_${string}`
  let sittingId: string
  let today = ''
  let references = 0
  let readClock = new Date()
  const itemA = newId('nd')
  const itemB = newId('nd')

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  const policy = { env: 'test', allowHosts: [] } as const
  const env = () => ({ pool, log, now: () => new Date() })
  let elapsed = 0
  const deps = () => ({
    sim: policy,
    budgets: new InstanceBudgets(),
    breakers: new ConnectionBreakers(() => 0.5),
    timings: {
      probeBudgetMs: 3_000,
      readTimeoutMs: 5_000,
      writeTimeoutMs: 300,
      readBackWindowMs: 3_000,
    },
    readBackEveryMs: 1_000,
    sleep: async (ms: number) => {
      elapsed += ms
      simClock.advance(Math.max(ms, 1_100))
    },
    clock: () => elapsed,
  })

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-late-landing-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Late club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Late club', $2)`,
      [tenantId, `late-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
    sim = createSimServer({ scenario: 'demo-bar', print: () => {}, clock: simClock })
    const host = `127.0.0.1:${await sim.listen(0)}`

    const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
    const venue = await provisionVenue(pool, tenantId, { name: 'Demo Bar', slug: testSlug('late') })
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Demo Bar' }])
    expect((await mapBarsyVenue(pool, tenantId, integrationId, 1, venue.id)).ok).toBe(true)
    demo = { venueId: venue.id as VenueId, integrationId: integrationId as IntegrationId }
    await setFloorSource(pool, tenantId, {
      venueId: demo.venueId,
      source: { halls: null, bars: null, paymentTables: [] },
    })
    simClock.advance(1100)
    const floor = await readFloorOf(
      env(),
      { tenantId, ...demo },
      { sim: policy, budgets: new InstanceBudgets() },
    )
    expect(floor.kind).toBe('read')
    const [table] = await query<{ id: `tb_${string}` }>(
      `select id from restro.tables where venue_id = $1 and number = '1'`,
      [demo.venueId],
    )
    if (table === undefined) throw new Error('no table 1')
    tableId = table.id
    const [venueRow] = await query<{ timezone: string; service_day_ends_at: string }>(
      'select timezone, service_day_ends_at from restro.venues where id = $1',
      [demo.venueId],
    )
    if (venueRow === undefined) throw new Error('no venue')
    today = serviceDate(new Date(), venueRow.timezone, venueRow.service_day_ends_at)

    await query(
      `insert into restro.nodes (id, tenant_id, node_type) values ($1, $3, 'item'), ($2, $3, 'item')`,
      [itemA, itemB, tenantId],
    )
    await query(
      `insert into restro.source_links (tenant_id, integration_id, external_type, external_id, node_id)
       values ($1, $2, 'article', $3, $4), ($1, $2, 'article', $5, $6)`,
      [tenantId, integrationId, ARTICLE_A, itemA, ARTICLE_B, itemB],
    )
  })

  afterAll(async () => {
    await sim?.close()
    await pool?.end()
    await db?.drop()
  })

  beforeEach(async () => {
    sim.host.load('demo-bar')
    simClock.advance(1100)
    await query(
      'update restro.pauses set lifted_at = now() where target_id = any($1) and lifted_at is null',
      [[tableId, demo.integrationId]],
    )
    await query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
       where table_id = $1 and ended_at is null`,
      [tableId],
    )
    sittingId = newId('st')
    await query(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', 'staff', 'system', 'test')`,
      [sittingId, tenantId, demo.venueId, tableId, today],
    )
    // The waiter puts the table's first item on, opening its POS bill.
    sim.host.engine.waiter.addRound(POS_TABLE, [{ article: FIRST }])
    simClock.advance(1100)
  })

  async function waiting(qty: number) {
    const id = newId('so')
    references += 1
    await query(
      `insert into restro.sent_orders
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state,
          lines, total_minor, action_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, 'waiting', $8::jsonb, $9, gen_random_uuid(),
               'guest', 'guest', 'test-seed')`,
      [
        id,
        tenantId,
        demo.venueId,
        tableId,
        sittingId,
        today,
        `L${String(references).padStart(3, '0')}`,
        JSON.stringify([
          {
            id: newId('ol'),
            itemId: itemA,
            optionIds: [],
            qty,
            unitMinor: 1050,
            name: 'Item',
            optionNames: [],
          },
        ]),
        qty * 1050,
      ],
    )
    return id
  }

  /** A sent order whose write lands only after the read-back window: Unconfirmed. */
  async function unconfirmed(qty = 2, fault: 'landsLate' | 'hang' = 'landsLate'): Promise<string> {
    const id = await waiting(qty)
    sim.host.engine.faults.add({ on: 'addRows', fault: { kind: fault } })
    const outcomes = await sendTableOrders(
      env(),
      { tenantId, venueId: demo.venueId, tableId },
      deps(),
    )
    expect(outcomes).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'unconfirmed', reason: 'check_timed_out' },
    ])
    return id
  }

  const read = () => {
    simClock.advance(1100)
    readClock = new Date(readClock.getTime() + TABLE_READ_MIN_GAP_MS + 1)
    return readTableOf(
      { pool, log, now: () => readClock },
      { tenantId, venueId: demo.venueId, tableId },
      {
        sim: policy,
        billIdKey: KEY,
        budgets: new InstanceBudgets(),
        readingBudgets: new ReadingBudgets(),
      },
    )
  }

  const sentOrder = async (id: string) =>
    (
      await query<{
        state: string
        matched_lines: string[] | null
        landing_basis: unknown
        pos_bill_ref: string | null
      }>(
        'select state, matched_lines, landing_basis, pos_bill_ref from restro.sent_orders where id = $1',
        [id],
      )
    )[0]

  const landedEntries = (id: string) =>
    query<{ kind: string; details: Record<string, unknown>; table_id: string }>(
      `select kind, details, table_id from restro.log_entries
        where sent_order_id = $1 and kind = 'sent_order.landed_late'`,
      [id],
    )

  const addCalls = () => sim.host.engine.calls().filter((call) => call.method === 'addRows').length
  const onBill = () =>
    sim.host.engine
      .snapshot()
      .bills.filter((bill) => bill.table === POS_TABLE && bill.state === 'open')
      .flatMap((bill) => bill.rows.map((row) => [row.article, row.quantity]))

  it('keeps the reading before with the Unconfirmed sent order, and nothing of it once it is Added', async () => {
    const id = await unconfirmed()
    const kept = await sentOrder(id)
    expect(kept?.state).toBe('unconfirmed')
    expect(kept?.landing_basis).toMatchObject({
      sent: [{ quantity: '2' }],
      before: [{ quantity: '1' }],
    })

    // A sent order that settles Added forgets it.
    sim.host.load('demo-bar')
    await query(
      `update restro.pauses set lifted_at = now() where target_id = $1 and lifted_at is null`,
      [tableId],
    )
    sim.host.engine.waiter.addRound(POS_TABLE, [{ article: FIRST }])
    simClock.advance(1100)
    const added = await waiting(1)
    await sendTableOrders(env(), { tenantId, venueId: demo.venueId, tableId }, deps())
    expect(await sentOrder(added)).toMatchObject({ state: 'added', landing_basis: null })
  })

  it('files a late landing once: one Log entry and the matched lines, never a resend or Added', async () => {
    const id = await unconfirmed()
    expect(await landedEntries(id)).toEqual([])
    // Before the write lands, readings find nothing and write nothing.
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true })
    expect(await landedEntries(id)).toEqual([])

    simClock.advance(LATE_MS)
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true })
    expect(onBill()).toEqual([
      [FIRST, 1000],
      [ARTICLE_A, 2000],
    ])

    const entries = await landedEntries(id)
    expect(entries).toEqual([
      { kind: 'sent_order.landed_late', details: { lines: 1 }, table_id: tableId },
    ])
    const after = await sentOrder(id)
    expect(after).toMatchObject({ state: 'unconfirmed', landing_basis: null })
    expect(after?.matched_lines).toHaveLength(1)
    expect(after?.pos_bill_ref).not.toBeNull()
    expect(addCalls()).toBe(1)
    // No POS id in the Log.
    expect(JSON.stringify(entries)).not.toContain(String(after?.matched_lines?.[0]))

    // Once: later readings write nothing more.
    await read()
    await read()
    expect(await landedEntries(id)).toHaveLength(1)
    expect(await sentOrder(id)).toMatchObject({ state: 'unconfirmed' })
  })

  it("writes nothing when a waiter's round came as well (ambiguous), and tries again on the next reading", async () => {
    const id = await unconfirmed()
    simClock.advance(LATE_MS)
    sim.host.engine.waiter.addRound(POS_TABLE, [{ article: ARTICLE_B }])
    simClock.advance(1100)
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true })
    expect(await landedEntries(id)).toEqual([])
    const kept = await sentOrder(id)
    expect(kept?.matched_lines).toBeNull()
    expect(kept?.landing_basis).not.toBeNull()
  })

  it('concludes nothing from a partial reading (rule 6), and files the landing on the next complete one', async () => {
    const id = await unconfirmed()
    simClock.advance(LATE_MS)
    sim.host.engine.faults.add({
      on: 'read',
      from: 1,
      times: Infinity,
      fault: { kind: 'dropItem' },
    })
    expect(await read()).toMatchObject({ kind: 'recorded', complete: false })
    expect(await landedEntries(id)).toEqual([])
    sim.host.engine.faults.clear()
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true })
    expect(await landedEntries(id)).toHaveLength(1)
  })

  it('stops with the service day: a sent order of an earlier day is left alone', async () => {
    const id = await unconfirmed()
    await query(`update restro.sent_orders set service_date = ($2::date - 1) where id = $1`, [
      id,
      today,
    ])
    simClock.advance(LATE_MS)
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true })
    expect(await landedEntries(id)).toEqual([])
    expect((await sentOrder(id))?.matched_lines).toBeNull()
  })

  /** Staff resumed the table: the next sent order may go (a second on, past the POS rate limit). */
  const resume = async () => {
    simClock.advance(1100)
    await query(
      `update restro.pauses set lifted_at = now() where target_id = $1 and lifted_at is null`,
      [tableId],
    )
  }

  it('does not take a later identical round that was confirmed for the Unconfirmed one (A never reached the POS, B did and was Added)', async () => {
    const a = await unconfirmed(2, 'hang')
    await resume()
    const b = await waiting(2)
    await sendTableOrders(env(), { tenantId, venueId: demo.venueId, tableId }, deps())
    expect((await sentOrder(b))?.state).toBe('added')
    simClock.advance(LATE_MS)
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true })
    expect(onBill()).toEqual([
      [FIRST, 1000],
      [ARTICLE_A, 2000],
    ])
    expect(await landedEntries(a)).toEqual([])
    expect((await sentOrder(a))?.matched_lines).toBeNull()
  })

  it('does not take the lines the read-back matched for another sent order (B confirmed by the read-back)', async () => {
    const a = await unconfirmed(2, 'hang')
    await resume()
    const b = await waiting(2)
    sim.host.engine.faults.add({ on: 'addRows', fault: { kind: 'landsThenHangs' } })
    await sendTableOrders(env(), { tenantId, venueId: demo.venueId, tableId }, deps())
    const added = await sentOrder(b)
    expect(added?.state).toBe('added')
    expect(added?.matched_lines).toHaveLength(1)
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true })
    expect(await landedEntries(a)).toEqual([])
    expect((await sentOrder(a))?.matched_lines).toBeNull()
    expect((await sentOrder(b))?.matched_lines).toEqual(added?.matched_lines)
  })

  it('writes nothing for two Unconfirmed sent orders that would take the same lines', async () => {
    const first = await unconfirmed(2, 'hang')
    await resume()
    const second = await unconfirmed(2, 'landsLate')
    simClock.advance(LATE_MS)
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true })
    expect(onBill()).toEqual([
      [FIRST, 1000],
      [ARTICLE_A, 2000],
    ])
    expect(await landedEntries(first)).toEqual([])
    expect(await landedEntries(second)).toEqual([])
    expect((await sentOrder(first))?.matched_lines).toBeNull()
    expect((await sentOrder(second))?.matched_lines).toBeNull()
  })
})
