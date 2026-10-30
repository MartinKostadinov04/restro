// The Send job (#77; D115, D116, D120) on Postgres through its real code, against a real simulator
// server over HTTP: a waiting sent order goes to the POS as one round and is Added; a round that
// lands and then hangs is read back and found (Added), never sent again; a waiter's identical round
// slipping in makes it one Restro can't tell (Unconfirmed: the table pauses and one alert is
// raised); the POS's "no" is Not sent with the lines back; a POS that can't be read is Not sent
// before anything is written; an item with no POS link never reaches the POS. The demo bar runs
// the pilot profile: no reference read back, no "who entered it", and only a waiter opens a POS
// bill (a Send to an empty table is Not sent, `needs_first_item`).
//
// A model-based property (fc.commands) runs guests' Sends, waiters' rounds, the simulator's faults
// and the job in any order: no sent order ever reaches the POS twice, and none loses a line (each
// ends Added and on the bill, Not sent with its lines back on the table's order, or Unconfirmed
// with an alert for the staff).
import { type IntegrationId, newId, SERVICE_TIMINGS, type VenueId } from '@restro/core'
import {
  createIntegration,
  mapBarsyVenue,
  provisionTenant,
  provisionVenue,
  setFloorSource,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { applyService, BUDGET_WAIT_MS, SLOT_CHECKING_SECONDS } from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import { createSimServer, ManualClock, type SimFault, type SimServer } from '@restro/sim-pos'
import fc from 'fast-check'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ConnectionBreakers } from '../src/jobs/breaker'
import { InstanceBudgets, readFloorOf } from '../src/jobs/floor'
import { sendTableOrders, slotTargets } from '../src/jobs/order-send'
import { stockTick } from '../src/jobs/stock'
import { createLogger } from '../src/logger'
import { serviceConnectorFor } from '../src/service-connectors'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

/** Demo Bar's table 1 on the simulator, and two of its articles. */
const POS_TABLE = '30001'
const ARTICLE_A = '2001'
const ARTICLE_B = '2002'
/** The waiter's first item: on the pilot profile only a waiter opens a POS bill. */
const FIRST = '2003'

describe.skipIf(!hasDatabase)('the Send job', () => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  const simClock = new ManualClock()
  const tenantId = newId('tn')
  let log: Awaited<ReturnType<typeof createLogger>>
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  let tableId: `tb_${string}`
  let sittingId: string
  let references = 0
  const itemA = newId('nd')
  const itemB = newId('nd')
  const unlinked = newId('nd')

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  const policy = { env: 'test', allowHosts: [] } as const
  const env = () => ({ pool, log, now: () => new Date() })
  /** The fake clock the read-back window runs on: the fake sleeps and slow reads move it. */
  let elapsed = 0
  /** A fresh breaker per run, so one test's write timeout holds no later test's order. */
  const deps = (breakers = new ConnectionBreakers(() => 0.5)) => ({
    sim: policy,
    budgets: new InstanceBudgets(),
    breakers,
    timings: {
      probeBudgetMs: 3_000,
      readTimeoutMs: 5_000,
      writeTimeoutMs: 300,
      readBackWindowMs: 3_000,
    },
    readBackEveryMs: 1_000,
    // Each wait moves the simulator's clock past its one-second rate limit; nothing really sleeps.
    sleep: async (ms: number) => {
      elapsed += ms
      simClock.advance(Math.max(ms, 1_100))
    },
    clock: () => elapsed,
  })

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-order-send-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Send club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Send club', $2)`,
      [tenantId, `send-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
    sim = createSimServer({ scenario: 'demo-bar', print: () => {}, clock: simClock })
    const host = `127.0.0.1:${await sim.listen(0)}`

    const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
    const venue = await provisionVenue(pool, tenantId, { name: 'Demo Bar', slug: testSlug('send') })
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

    // Two menu items linked to the POS's articles (what a menu sync writes), and one without.
    await query(
      `insert into restro.nodes (id, tenant_id, node_type) values ($1, $4, 'item'), ($2, $4, 'item'), ($3, $4, 'item')`,
      [itemA, itemB, unlinked, tenantId],
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
    // A fresh simulator with no bills, no pause and a newly opened sitting on table 1.
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
      [sittingId, tenantId, demo.venueId, tableId, new Date().toISOString().slice(0, 10)],
    )
  })

  /** The waiter puts the table's first item on, opening its POS bill. */
  const firstItem = () => {
    sim.host.engine.waiter.addRound(POS_TABLE, [{ article: FIRST }])
    simClock.advance(1100)
  }

  /** A waiting sent order of the open sitting, as a guest's Send writes it. */
  async function waiting(lines: { itemId: string; qty: number; unitMinor: number }[]) {
    const id = newId('so')
    const stored = lines.map((line) => ({
      id: newId('ol'),
      itemId: line.itemId,
      optionIds: [],
      qty: line.qty,
      unitMinor: line.unitMinor,
      name: 'Item',
      optionNames: [],
    }))
    references += 1
    const reference = `T${String(references).padStart(3, '0')}`
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
        new Date().toISOString().slice(0, 10),
        reference,
        JSON.stringify(stored),
        lines.reduce((sum, line) => sum + line.qty * line.unitMinor, 0),
      ],
    )
    return id
  }

  const sentOrder = async (id: string) =>
    (
      await query<{ state: string; reason: string | null; pos_bill_ref: string | null }>(
        'select state, reason, pos_bill_ref from restro.sent_orders where id = $1',
        [id],
      )
    )[0]

  const run = (breakers?: ConnectionBreakers) =>
    sendTableOrders(env(), { tenantId, venueId: demo.venueId, tableId }, deps(breakers))

  /** Each row on the table's open bills: its article and quantity (in thousandths). */
  const onBill = () =>
    sim.host.engine
      .snapshot()
      .bills.filter((bill) => bill.table === POS_TABLE && bill.state === 'open')
      .flatMap((bill) => bill.rows.map((row) => [row.article, row.quantity]))

  /** The POS layer's `for_sale` rows of the linked items (stock marks, #80). */
  const stockMarks = () =>
    query<{ node_id: string; value: unknown; layer: string }>(
      `select node_id, value, layer from restro.field_values
        where field_key = 'for_sale' and node_id = any($1) order by node_id`,
      [[itemA, itemB]],
    )

  const addCalls = () => sim.host.engine.calls().filter((call) => call.method === 'addRows').length

  const orderLines = async () =>
    (
      await query<{ lines: { itemId: string; qty: number; removedAt: number | null }[] }>(
        'select lines from restro.table_orders where sitting_id = $1',
        [sittingId],
      )
    )[0]?.lines.filter((line) => line.removedAt === null) ?? []

  it('sends a waiting order as one round and settles it Added', async () => {
    firstItem()
    const id = await waiting([
      { itemId: itemA, qty: 1, unitMinor: 1050 },
      { itemId: itemB, qty: 2, unitMinor: 1100 },
    ])
    expect(await run()).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'added', reason: null },
    ])
    expect((await sentOrder(id))?.pos_bill_ref).not.toBeNull()
    expect(onBill()).toEqual([
      [FIRST, 1000],
      [ARTICLE_A, 1000],
      [ARTICLE_B, 2000],
    ])
    expect(addCalls()).toBe(1)
    const [slot] = await query<{ holder: string | null }>(
      `select holder from restro.locks where scope = 'order_slot' and key = $1`,
      [tableId],
    )
    expect(slot?.holder).toBeNull()
  })

  it('reads back a round that landed and then hung, finds it Added, and never sends it again', async () => {
    firstItem()
    const id = await waiting([{ itemId: itemA, qty: 2, unitMinor: 1050 }])
    sim.host.engine.faults.add({ on: 'addRows', fault: { kind: 'landsThenHangs' } })
    expect(await run()).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'added', reason: null },
    ])
    expect(onBill()).toEqual([
      [FIRST, 1000],
      [ARTICLE_A, 2000],
    ])
    expect(addCalls()).toBe(1)
  })

  it("is Unconfirmed when a waiter's identical round slips in: the table pauses, one alert", async () => {
    firstItem()
    const id = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
    const behind = await waiting([{ itemId: itemB, qty: 1, unitMinor: 1100 }])
    sim.host.engine.faults.add(
      { on: 'addRows', fault: { kind: 'waiterRoundSlipsIn', identical: true } },
      { on: 'addRows', fault: { kind: 'landsThenHangs' } },
    )
    const outcomes = await run()
    expect(outcomes[0]).toEqual({
      kind: 'settled',
      sentOrderId: id,
      state: 'unconfirmed',
      reason: 'check_ambiguous',
    })
    expect(addCalls()).toBe(1)
    expect(await sentOrder(behind)).toMatchObject({ state: 'not_sent', reason: 'ordering_paused' })
    expect((await orderLines()).map((line) => [line.itemId, line.qty])).toEqual([[itemB, 1]])
    expect(
      await query('select cause from restro.pauses where target_id = $1 and lifted_at is null', [
        tableId,
      ]),
    ).toEqual([{ cause: 'order_unconfirmed' }])
    expect(await query('select kind from restro.alerts where subject_id = $1', [id])).toEqual([
      { kind: 'order_unconfirmed' },
    ])
  })

  it("settles the POS's no as Not sent with its code, the lines back on the order", async () => {
    firstItem()
    const id = await waiting([{ itemId: itemA, qty: 3, unitMinor: 1050 }])
    sim.host.engine.faults.add({ on: 'addRows', fault: { kind: 'refuse', code: 'bill_locked' } })
    const [outcome] = await run()
    expect(outcome).toMatchObject({ kind: 'settled', sentOrderId: id, state: 'not_sent' })
    expect((await sentOrder(id))?.reason).toBe('bill_locked')
    expect((await orderLines()).map((line) => [line.itemId, line.qty])).toEqual([[itemA, 3]])
    expect(onBill()).toEqual([[FIRST, 1000]])
    expect(await stockMarks()).toEqual([])
  })

  describe('stock from the POS (#80)', () => {
    /** The jobs a run queued (`publish-live` after a stock mark). */
    let queued: { name: string; data: object }[] = []
    const queue = {
      send: async (name: string, data: object) => {
        queued.push({ name, data })
        return 'job'
      },
    }
    /** The sim connector as one that declares item availability, the POS saying `out` ran out. */
    const withAvailability =
      (out: () => ReadonlySet<string>): typeof serviceConnectorFor =>
      (integration, policy) => {
        const real = serviceConnectorFor(integration, policy)
        return {
          ...real,
          capabilities: { ...real.capabilities, itemAvailability: true },
          readAvailability: async (_context, items) => ({
            complete: true,
            value: { items: items.map((item) => ({ item, available: !out().has(item.pos) })) },
          }),
        }
      }
    const sendWith = (connectorFor?: typeof serviceConnectorFor) =>
      sendTableOrders(
        { ...env(), queue },
        { tenantId, venueId: demo.venueId, tableId },
        connectorFor === undefined ? deps() : { ...deps(), connectorFor },
      )
    const stockAlerts = () =>
      query<{ subject_id: string; done: boolean; name: string }>(
        `select subject_id, done_at is not null as done, details->>'name' as name
           from restro.alerts where kind = 'item_out_of_stock' order by raised_at`,
      )
    const flagged = async (id: string) =>
      (
        await query<{ lines: { itemId: string; outOfStock?: true }[] }>(
          'select lines from restro.sent_orders where id = $1',
          [id],
        )
      )[0]?.lines.flatMap((line) => (line.outOfStock === true ? [line.itemId] : []))

    beforeEach(async () => {
      queued = []
      await query(
        `delete from restro.field_values where field_key = 'for_sale' and node_id = any($1)`,
        [[itemA, itemB]],
      )
      await query(`delete from restro.alerts where kind = 'item_out_of_stock'`)
    })

    it('a POS refusal that names the line: Not sent, the item marked, Tonight told', async () => {
      firstItem()
      const id = await waiting([
        { itemId: itemB, qty: 1, unitMinor: 1100 },
        { itemId: itemA, qty: 3, unitMinor: 1050 },
      ])
      // A waiter marks the article sold out at the till: the POS refuses that line by its index.
      sim.host.engine.waiter.markSoldOut(ARTICLE_B)
      const [outcome] = await sendWith()
      expect(outcome).toEqual({
        kind: 'settled',
        sentOrderId: id,
        state: 'not_sent',
        reason: 'item_unavailable',
      })
      // Nothing of that order reached the POS; every line is back on the table's order.
      expect(onBill()).toEqual([[FIRST, 1000]])
      expect((await orderLines()).map((line) => line.itemId).sort()).toEqual([itemA, itemB].sort())
      // The refused line is flagged, its item marked and announced.
      expect(await flagged(id)).toEqual([itemB])
      expect(await stockMarks()).toEqual([{ node_id: itemB, value: false, layer: 'till' }])
      expect(await stockAlerts()).toEqual([{ subject_id: itemB, done: false, name: 'Item' }])
    })

    it('the availability read before a Send: nothing is sent, the run-out item marked', async () => {
      firstItem()
      const id = await waiting([
        { itemId: itemA, qty: 1, unitMinor: 1050 },
        { itemId: itemB, qty: 2, unitMinor: 1100 },
      ])
      const out = new Set([ARTICLE_B])
      expect(await sendWith(withAvailability(() => out))).toEqual([
        { kind: 'settled', sentOrderId: id, state: 'not_sent', reason: 'item_unavailable' },
      ])
      expect(addCalls()).toBe(0)
      expect(await flagged(id)).toEqual([itemB])
      expect(await stockMarks()).toEqual([{ node_id: itemB, value: false, layer: 'till' }])
      expect(await stockAlerts()).toEqual([{ subject_id: itemB, done: false, name: 'Item' }])

      // The tick asks the POS again: still out, the mark stays; back, the mark and the alert end.
      const tick = () =>
        stockTick({ ...env(), queue }, { ...deps(), connectorFor: withAvailability(() => out) })
      expect(await tick()).toEqual({ cleared: 0 })
      out.clear()
      expect(await tick()).toEqual({ cleared: 1 })
      expect(await stockMarks()).toEqual([])
      expect(await stockAlerts()).toEqual([{ subject_id: itemB, done: true, name: 'Item' }])
    })

    it('sends as before when every item is available, and lapses a mark nobody takes back', async () => {
      firstItem()
      const id = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
      expect(await sendWith(withAvailability(() => new Set()))).toEqual([
        { kind: 'settled', sentOrderId: id, state: 'added', reason: null },
      ])
      expect(await stockMarks()).toEqual([])

      // A refusal-only POS (the sim declares no read): its mark lapses with the service day.
      const refused = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
      sim.host.engine.waiter.markSoldOut(ARTICLE_A)
      expect((await sendWith())[0]).toMatchObject({
        sentOrderId: refused,
        reason: 'item_unavailable',
      })
      expect(await stockTick({ ...env(), queue }, deps())).toEqual({ cleared: 0 })
      const tomorrow = new Date(Date.now() + 24 * 60 * 60_000)
      expect(await stockTick({ ...env(), now: () => tomorrow, queue }, deps())).toEqual({
        cleared: 1,
      })
      expect(await stockMarks()).toEqual([])
      expect((await stockAlerts()).map((alert) => alert.done)).toEqual([true])
    })
  })

  it('pauses the connection when the POS refuses the login: Not sent, and the next waits', async () => {
    firstItem()
    const id = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
    sim.host.engine.faults.add({ on: 'addRows', fault: { kind: 'refuse', code: 'credentials' } })
    expect(await run()).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'not_sent', reason: 'credentials' },
    ])
    expect(
      await query(
        `select cause, restro_started from restro.pauses
         where scope = 'connection' and target_id = $1 and lifted_at is null`,
        [demo.integrationId],
      ),
    ).toEqual([{ cause: 'credentials', restro_started: true }])

    // Another worker, another breaker: the pause row stops the next order before the POS (the
    // start settles it, so the run sends nothing).
    simClock.advance(1100)
    const next = await waiting([{ itemId: itemB, qty: 1, unitMinor: 1100 }])
    expect(await run()).toEqual([])
    expect(await sentOrder(next)).toMatchObject({ state: 'not_sent', reason: 'ordering_paused' })
    expect(addCalls()).toBe(1)
  })

  it('after a write timed out, the next order goes only after a good probe', async () => {
    firstItem()
    const breakers = new ConnectionBreakers(() => 0.5)
    const connection = { tenantId, integrationId: demo.integrationId }
    const first = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
    sim.host.engine.faults.add({ on: 'addRows', fault: { kind: 'landsThenHangs' } })
    expect(await run(breakers)).toEqual([
      { kind: 'settled', sentOrderId: first, state: 'added', reason: null },
    ])
    expect(await breakers.gate(env(), connection)).toBe('hold')

    // A fresh simulator (the hung call no longer holds its one concurrent slot); the hold is the
    // breaker's, in this process.
    sim.host.load('demo-bar')
    simClock.advance(1100)
    firstItem()
    const second = await waiting([{ itemId: itemB, qty: 1, unitMinor: 1100 }])
    const pings = () => sim.host.engine.calls().filter((call) => call.method === 'ping').length
    const before = pings()
    // The simulator's clock moves only on the fake sleeps: past its rate limit after the probe.
    const connectorFor: typeof serviceConnectorFor = (integration, simPolicy) => {
      const real = serviceConnectorFor(integration, simPolicy)
      return {
        ...real,
        probe: async (ctx) => {
          const answer = await real.probe(ctx)
          simClock.advance(1100)
          return answer
        },
      }
    }
    const payload = { tenantId, venueId: demo.venueId, tableId }
    expect(await sendTableOrders(env(), payload, { ...deps(breakers), connectorFor })).toEqual([
      { kind: 'settled', sentOrderId: second, state: 'added', reason: null },
    ])
    expect(pings()).toBe(before + 1)
    expect(await breakers.gate(env(), connection)).toBe('open')
  })

  it('is Not sent on an empty table where only a waiter opens a bill (needs_first_item)', async () => {
    const id = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
    expect(await run()).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'not_sent', reason: 'needs_first_item' },
    ])
    expect(onBill()).toEqual([])
    expect((await orderLines()).map((line) => [line.itemId, line.qty])).toEqual([[itemA, 1]])
  })

  it('is Not sent before anything is written when the table cannot be read', async () => {
    const id = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
    sim.host.engine.faults.add({ on: 'read', times: Infinity, fault: { kind: 'fail' } })
    expect(await run()).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'not_sent', reason: 'pos_unreachable' },
    ])
    expect(addCalls()).toBe(0)
    sim.host.engine.faults.clear()
  })

  it('settles a round it cannot find within its checking lease, however slow each read', async () => {
    firstItem()
    const id = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
    // The real timings, every read as slow as it may be (its wait for a turn, then its timeout),
    // and a round whose answer never comes and which never lands.
    let checkingFrom: number | null = null
    const outcomes = await sendTableOrders(
      env(),
      { tenantId, venueId: demo.venueId, tableId },
      {
        ...deps(),
        timings: SERVICE_TIMINGS,
        readBackEveryMs: undefined,
        connectorFor: (integration, policy) => {
          const real = serviceConnectorFor(integration, policy)
          return {
            ...real,
            readTable: async (context, table) => {
              const reading = await real.readTable(context, table)
              elapsed += BUDGET_WAIT_MS + SERVICE_TIMINGS.readTimeoutMs
              return reading
            },
            addLines: async () => {
              checkingFrom = elapsed
              return { kind: 'unknown', reason: 'no answer' }
            },
          }
        },
      },
    )
    // The worker settled it itself: the sweep had nothing to expire.
    expect(outcomes).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'unconfirmed', reason: 'check_timed_out' },
    ])
    expect(checkingFrom).not.toBeNull()
    const took = elapsed - (checkingFrom ?? 0)
    expect(took).toBeGreaterThanOrEqual(SERVICE_TIMINGS.readBackWindowMs)
    expect(took).toBeLessThan(SLOT_CHECKING_SECONDS * 1_000)
    expect(addCalls()).toBe(0)
  })

  // Repair-review, hot spot 2: the job is never retried (retryLimit 0) and a sent order that may
  // have reached the POS is the sweep's to settle as Unconfirmed, never sent again (D115, D116).
  describe('a worker killed around the add', () => {
    class Killed extends Error {}

    const expireAndSweep = async () => {
      await query(`update restro.locks set deadline = now() - interval '1 second' where scope = 'order_slot' and key = $1`, [
        tableId,
      ])
      const { expired } = await slotTargets(pool)
      expect(expired.map((target) => target.tableId)).toContain(tableId)
      const { result } = await applyService(
        pool,
        { type: 'sent_order.expire', tableId },
        {
          tenantId,
          venueId: demo.venueId,
          origin: 'worker',
          actor: { kind: 'system' },
          jobId: `sweep-${newId('jb')}`,
        },
      )
      return result
    }

    it.each([
      [
        'after the round landed, before its answer was written',
        'sending',
        1,
        () => ({
          breakers: Object.assign(new ConnectionBreakers(() => 0.5), {
            record: async (_env: unknown, _connection: unknown, event: { kind: string; elapsedMs?: number }) => {
              // The read before carries its time; the record right after the add does not.
              if (event.kind === 'call' && event.elapsedMs === undefined) throw new Killed()
            },
          }),
        }),
      ],
      [
        'in the read-back of a round that landed and hung',
        'checking',
        1,
        () => {
          sim.host.engine.faults.add({ on: 'addRows', fault: { kind: 'landsThenHangs' } })
          return {
            sleep: async () => {
              throw new Killed()
            },
          }
        },
      ],
      [
        'in the read-back of a round that never landed',
        'checking',
        0,
        () => {
          sim.host.engine.faults.add({ on: 'addRows', fault: { kind: 'hang' } })
          return {
            sleep: async () => {
              throw new Killed()
            },
          }
        },
      ],
    ] as const)('%s: settled by the sweep, never sent again', async (_name, leftIn, landed, kill) => {
      sim.host.engine.faults.clear()
      firstItem()
      const id = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
      const before = addCalls()
      await expect(
        sendTableOrders(env(), { tenantId, venueId: demo.venueId, tableId }, { ...deps(), ...kill() }),
      ).rejects.toBeInstanceOf(Killed)
      sim.host.engine.faults.clear()
      expect((await sentOrder(id))?.state).toBe(leftIn)

      // The next job finds the slot held and sends nothing.
      simClock.advance(1_100)
      expect(await run()).toEqual([])
      expect(addCalls() - before).toBeLessThanOrEqual(1)

      // The sweep settles it, and the job after that still sends nothing.
      expect(await expireAndSweep()).toMatchObject({ details: { expired: true, sentOrderId: id } })
      expect(await sentOrder(id)).toMatchObject({ state: 'unconfirmed', reason: 'check_timed_out' })
      const calls = addCalls()
      simClock.advance(1_100)
      await run()
      expect(addCalls()).toBe(calls)
      const rows = onBill().filter(([article]) => article === ARTICLE_A)
      expect(rows).toHaveLength(landed)
      // Its lines stay out of the bag: Try again is offered only after a definite no (D116).
      expect((await orderLines()).filter((line) => line.itemId === itemA)).toEqual([])
    })
  })

  // Repair-review, RR-24 (D116: Not sent = "it never went out"): the connector's own read before
  // the round fails, so nothing was written and the connector says so in its reason.
  it('a read inside the add that fails before anything is written: Not sent, the lines back', async () => {
    sim.host.engine.faults.clear()
    firstItem()
    const id = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
    const before = addCalls()
    const outcomes = await sendTableOrders(
      env(),
      { tenantId, venueId: demo.venueId, tableId },
      {
        ...deps(),
        connectorFor: (integration, policy) => {
          const real = serviceConnectorFor(integration, policy)
          return {
            ...real,
            addLines: async (context, request) => {
              // The read inside the add fails, and only that one.
              sim.host.engine.faults.add({ on: 'read', times: 1, fault: { kind: 'fail' } })
              return real.addLines(context, request)
            },
          }
        },
      },
    )
    sim.host.engine.faults.clear()
    expect(addCalls()).toBe(before)
    expect(outcomes).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'not_sent', reason: 'pos_unreachable' },
    ])
    expect((await orderLines()).map((line) => [line.itemId, line.qty])).toContainEqual([itemA, 1])
  })

  // Repair-review, RR-33 (spec #64 §8: a waiter's identical round in the window is Unconfirmed,
  // never Added): the round never lands; a waiter enters the same round during the read-back.
  it("a waiter's identical round alone in the read-back window is not Added", async () => {
    sim.host.engine.faults.clear()
    firstItem()
    const id = await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
    sim.host.engine.faults.add({ on: 'addRows', fault: { kind: 'hang' } })
    let waiter = false
    const outcomes = await sendTableOrders(
      env(),
      { tenantId, venueId: demo.venueId, tableId },
      {
        ...deps(),
        sleep: async (ms: number) => {
          await deps().sleep(ms)
          if (!waiter) {
            waiter = true
            sim.host.engine.waiter.addRound(POS_TABLE, [{ article: ARTICLE_A }])
          }
        },
      },
    )
    sim.host.engine.faults.clear()
    expect(onBill()).toEqual([
      [FIRST, 1000],
      [ARTICLE_A, 1000],
    ])
    // Nothing tells this round from Restro's: a false Added is drinks that never come.
    expect(outcomes).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'unconfirmed', reason: 'check_ambiguous' },
    ])
  })

  it('never sends an item the POS has no link for', async () => {
    const id = await waiting([
      { itemId: itemA, qty: 1, unitMinor: 1050 },
      { itemId: unlinked, qty: 1, unitMinor: 500 },
    ])
    expect(await run()).toEqual([
      { kind: 'settled', sentOrderId: id, state: 'not_sent', reason: 'item_not_on_pos' },
    ])
    expect(addCalls()).toBe(0)
  })

  it('lists a table with a waiting order and no slot holder for the sweep', async () => {
    await waiting([{ itemId: itemA, qty: 1, unitMinor: 1050 }])
    const { waiting: queued } = await slotTargets(pool)
    expect(queued).toContainEqual({ tenantId, venueId: demo.venueId, tableId })
    await run()
    expect((await slotTargets(pool)).waiting).not.toContainEqual({
      tenantId,
      venueId: demo.venueId,
      tableId,
    })
  })

  describe('guests, waiters and faults in any order (model-based)', () => {
    /** One item per article, so each sent order of a run names its own article. */
    const ARTICLES = ['2001', '2002', '2004', '2005', '2006', '2008'] as const
    const itemOf = new Map<string, string>()

    beforeAll(async () => {
      itemOf.set('2001', itemA)
      itemOf.set('2002', itemB)
      for (const article of ARTICLES) {
        if (itemOf.has(article)) continue
        const node = newId('nd')
        itemOf.set(article, node)
        await query(`insert into restro.nodes (id, tenant_id, node_type) values ($1, $2, 'item')`, [
          node,
          tenantId,
        ])
        await query(
          `insert into restro.source_links (tenant_id, integration_id, external_type, external_id, node_id)
           values ($1, $2, 'article', $3, $4)`,
          [tenantId, demo.integrationId, article, node],
        )
      }
    })

    interface Real {
      /** The sent orders this run made, each with its article and quantity. */
      readonly orders: { id: string; article: string; qty: number }[]
    }
    interface Model {
      sends: number
    }

    /** A guest's Send: one waiting sent order of one item, unless the table is paused. */
    class GuestSends implements fc.AsyncCommand<Model, Real> {
      constructor(readonly qty: number) {}
      check = (model: Readonly<Model>) => model.sends < ARTICLES.length
      async run(model: Model, real: Real) {
        model.sends += 1
        const paused = await query(
          'select 1 from restro.pauses where target_id = $1 and lifted_at is null',
          [tableId],
        )
        // A paused table takes no Send (the guest is told before anything is written).
        if (paused.length > 0) return
        const article = ARTICLES[real.orders.length] as string
        const id = await waiting([
          { itemId: itemOf.get(article) as string, qty: this.qty, unitMinor: 1000 },
        ])
        real.orders.push({ id, article, qty: this.qty })
      }
      toString = () => `guest sends ${this.qty}`
    }

    /** A waiter puts a round on the table (opening its POS bill when none is open). */
    class WaiterRound implements fc.AsyncCommand<Model, Real> {
      constructor(readonly article: string) {}
      check = () => true
      async run() {
        sim.host.engine.waiter.addRound(POS_TABLE, [{ article: this.article }])
        simClock.advance(1_100)
      }
      toString = () => `waiter adds ${this.article}`
    }

    /** The simulator's next call of a kind goes wrong once. */
    class Fault implements fc.AsyncCommand<Model, Real> {
      constructor(
        readonly on: 'addRows' | 'read',
        readonly fault: SimFault,
      ) {}
      check = () => true
      async run() {
        sim.host.engine.faults.add({ on: this.on, times: 1, fault: this.fault })
      }
      toString = () => `${this.on} ${this.fault.kind}`
    }

    /** The Send job runs for the table. */
    class JobRuns implements fc.AsyncCommand<Model, Real> {
      check = () => true
      async run() {
        simClock.advance(1_100)
        await run()
      }
      toString = () => 'job runs'
    }

    const commands = fc.commands(
      [
        fc.integer({ min: 1, max: 3 }).map((qty) => new GuestSends(qty)),
        fc.constantFrom(FIRST, ...ARTICLES).map((article) => new WaiterRound(article)),
        fc
          .constantFrom<SimFault>(
            { kind: 'landsThenHangs' },
            { kind: 'waiterRoundSlipsIn', identical: true },
            { kind: 'waiterRoundSlipsIn', identical: false },
            { kind: 'refuse', code: 'sold_out' },
            { kind: 'fail' },
          )
          .map((fault) => new Fault('addRows', fault)),
        fc.constant(new Fault('read', { kind: 'fail' })),
        fc.constant(new JobRuns()),
      ],
      { maxCommands: 10 },
    )

    /** A fresh night: the simulator reloaded, nothing in flight, no pause, a new sitting. */
    async function reset() {
      sim.host.load('demo-bar')
      simClock.advance(1_100)
      await query(
        `update restro.sent_orders set state = 'not_sent', reason = 'test_reset', settled_at = now()
          where table_id = $1 and state in ('waiting', 'sending', 'checking')`,
        [tableId],
      )
      await query(
        `update restro.locks set holder = null, deadline = null, released_at = now()
          where scope = 'order_slot' and key = $1`,
        [tableId],
      )
      await query(
        'update restro.pauses set lifted_at = now() where target_id = $1 and lifted_at is null',
        [tableId],
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
        [sittingId, tenantId, demo.venueId, tableId, new Date().toISOString().slice(0, 10)],
      )
    }

    it('never sends a sent order twice and never loses a line', async () => {
      await fc.assert(
        fc.asyncProperty(commands, async (steps) => {
          await reset()
          const real: Real = { orders: [] }
          await fc.asyncModelRun(() => ({ model: { sends: 0 }, real }), steps)
          // The night goes on: the faults clear and the job runs once more.
          sim.host.engine.faults.clear()
          simClock.advance(1_100)
          await run()

          // The rows Restro's own login entered on the table's bills (a waiter's are by staff).
          const state = sim.host.engine.snapshot()
          const restro = new Set(
            state.logins.filter((login) => login.kind === 'api').map((login) => login.id),
          )
          const rounds = state.bills
            .filter((bill) => bill.table === POS_TABLE)
            .flatMap((bill) => bill.rows)
            .filter((row) => restro.has(row.by))
            .map((row) => row.article)
          const lines = await orderLines()
          const onTable = onBill().map(([article]) => article)
          for (const order of real.orders) {
            // Never sent twice: at most one row of Restro's carries the order's article.
            expect(
              rounds.filter((article) => article === order.article).length,
            ).toBeLessThanOrEqual(1)
            const row = await sentOrder(order.id)
            const itemId = itemOf.get(order.article) as string
            switch (row?.state) {
              case 'added':
                expect(onTable).toContain(order.article)
                break
              case 'not_sent':
                expect(lines).toContainEqual(expect.objectContaining({ itemId, qty: order.qty }))
                break
              case 'unconfirmed':
                expect(
                  await query('select 1 from restro.alerts where subject_id = $1', [order.id]),
                ).toHaveLength(1)
                break
              default:
                throw new Error(`sent order ${order.id} was left ${row?.state}`)
            }
          }
        }),
        { numRuns: 15 },
      )
    })
  })
})
