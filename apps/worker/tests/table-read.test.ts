// The table reading job (#74) on Postgres through its real code, against a real simulator server
// over HTTP (`createSimServer`): a waiter's round shows on the table's bill under our ids; the
// sitting ends when the waiter closes the bill; a table opened before its first item is not
// ended; a table is read at most once in the gap and an instance within its budget; a `sim`
// instance is refused in production; and (rule 6) no fault plan that makes a reading partial ends
// a sitting or changes the bill a phone sees: every plan of the simulator's read faults is tried.
import { type IntegrationId, newId, type VenueId } from '@restro/core'
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ConnectionBreakers } from '../src/jobs/breaker'
import { readFloorOf } from '../src/jobs/floor'
import { ReadingBudgets, readTableOf, TABLE_READ_MIN_GAP_MS } from '../src/jobs/readings'
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
import { simBudgets } from './sim-pace'

allowSlowSetup()

const KEY = 'table-read-test-key-'.padEnd(48, 'x')
/** Demo Bar's table 1 on the simulator. */
const POS_TABLE = '30001'

describe.skipIf(!hasDatabase)('the table reading job', () => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  const simClock = new ManualClock()
  let host: string
  const tenantId = newId('tn')
  let log: Awaited<ReturnType<typeof createLogger>>
  let clock = new Date()
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  let tableId: `tb_${string}`

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  const policy = { env: 'test', allowHosts: [] } as const
  const env = () => ({ pool, log, now: () => clock })

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-table-read-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Reading club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Reading club', $2)`,
      [tenantId, `reading-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
    sim = createSimServer({ scenario: 'demo-bar', print: () => {}, clock: simClock })
    host = `127.0.0.1:${await sim.listen(0)}`

    const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
    const venue = await provisionVenue(pool, tenantId, { name: 'Demo Bar', slug: testSlug('read') })
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
      { sim: policy, budgets: simBudgets(simClock) },
    )
    expect(floor.kind).toBe('read')
    const [table] = await query<{ id: `tb_${string}` }>(
      `select id from restro.tables where venue_id = $1 and number = '1'`,
      [demo.venueId],
    )
    if (table === undefined) throw new Error('no table 1')
    tableId = table.id
  })

  afterAll(async () => {
    await sim?.close()
    await pool?.end()
    await db?.drop()
  })

  /** One read of the table, past the per-table gap and the simulator's rate limit. */
  const read = (
    deps: {
      readingBudgets?: ReadingBudgets
      sim?: typeof policy | { env: 'production'; allowHosts: [] }
    } = {},
  ) => {
    simClock.advance(1100)
    clock = new Date(clock.getTime() + TABLE_READ_MIN_GAP_MS + 1)
    return readTableOf(
      env(),
      { tenantId, venueId: demo.venueId, tableId },
      {
        sim: deps.sim ?? policy,
        billIdKey: KEY,
        budgets: simBudgets(simClock),
        readingBudgets: deps.readingBudgets ?? new ReadingBudgets(),
      },
    )
  }

  /** A fresh simulator with no bills, and a newly opened sitting on table 1 (any earlier one ended). */
  async function freshSitting(): Promise<string> {
    sim.host.load('demo-bar')
    await query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
       where table_id = $1 and ended_at is null`,
      [tableId],
    )
    const id = newId('st')
    await query(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', 'staff', 'system', 'test')`,
      [id, tenantId, demo.venueId, tableId, new Date().toISOString().slice(0, 10)],
    )
    return id
  }
  const sittingOf = async (id: string) =>
    (
      await query<{ ended_at: Date | null; end_reason: string | null }>(
        'select ended_at, end_reason from restro.sittings where id = $1',
        [id],
      )
    )[0]
  const readingRow = async () =>
    (
      await query<{
        read_at: Date
        complete: boolean
        bills: { id: string; lines: { id: string; quantity: string; amountMinor: number }[] }[]
      }>('select read_at, complete, bills from restro.bill_readings where table_id = $1', [tableId])
    )[0]

  it("records the waiter's round under our ids, and ends the sitting when the waiter closes the bill", async () => {
    const sittingId = await freshSitting()
    const round = sim.host.engine.waiter.addRound(POS_TABLE, [
      { article: '2001' },
      { article: '2002', quantity: '2' },
    ])
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true, ended: false })
    const row = await readingRow()
    expect(row?.complete).toBe(true)
    expect(row?.bills).toHaveLength(1)
    expect(row?.bills[0]?.id).toMatch(/^rd_/)
    expect(row?.bills[0]?.lines.map((line) => [line.quantity, line.amountMinor])).toEqual([
      ['1', 1050],
      ['2', 2200],
    ])

    // The same bill read again keeps its ids.
    const ids = JSON.stringify(row?.bills.map((bill) => [bill.id, bill.lines.map((l) => l.id)]))
    await read()
    expect(
      JSON.stringify(
        (await readingRow())?.bills.map((bill) => [bill.id, bill.lines.map((l) => l.id)]),
      ),
    ).toBe(ids)

    sim.host.engine.waiter.closeBill(round.bill, 'cash')
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true, ended: true })
    expect(await sittingOf(sittingId)).toMatchObject({ end_reason: 'bill_closed' })
    expect((await readingRow())?.bills).toEqual([])
    expect(await read()).toMatchObject({ kind: 'skipped' })
  })

  it('does not end a table opened before its first item', async () => {
    const sittingId = await freshSitting()
    expect(await read()).toMatchObject({ kind: 'recorded', complete: true, ended: false })
    expect(await sittingOf(sittingId)).toMatchObject({ ended_at: null })
  })

  it('reads a table at most once in the gap, and only with room in the login budget', async () => {
    await freshSitting()
    const budgets = new ReadingBudgets()
    const instance = simBudgets(simClock)
    simClock.advance(1100)
    const now = clock
    const once = () =>
      readTableOf(
        env(),
        { tenantId, venueId: demo.venueId, tableId },
        {
          sim: policy,
          billIdKey: KEY,
          budgets: instance,
          readingBudgets: budgets,
        },
      )
    expect(await once()).toMatchObject({ kind: 'recorded' })
    expect(await once()).toEqual({ kind: 'skipped', reason: 'the table was read moments ago' })
    clock = new Date(now.getTime() + TABLE_READ_MIN_GAP_MS + 1)
    // A chain has used this second's calls: the read is skipped, and it asked the POS nothing.
    simClock.advance(1100)
    const pace = instance.paceOf(demo.integrationId, { callsPerSecond: 5 })
    for (let call = 0; call < 5; call++) await pace(new AbortController().signal)
    const calls = sim.host.engine.calls().length
    expect(await once()).toEqual({
      kind: 'skipped',
      reason: "the instance's reading budget is spent",
    })
    expect(sim.host.engine.calls().length).toBe(calls)
    // A skipped read did not count as the table's read: the next second it goes through.
    simClock.advance(1100)
    expect(await once()).toMatchObject({ kind: 'recorded' })
  })

  // RR-67: on the simulator a rate-limit answer comes before anything is done, so it says nothing
  // of the table or the connection: the same as a read the budget skipped.
  it('a rate-limit answer on a reading: skipped, no pause, no breaker count', async () => {
    const sittingId = await freshSitting()
    sim.host.engine.waiter.addRound(POS_TABLE, [{ article: '2001' }])
    expect(await read()).toMatchObject({ complete: true })
    const good = await readingRow()
    const breakers = new ConnectionBreakers(() => 0.5)
    const record = vi.spyOn(breakers, 'record')
    simClock.advance(1100)
    clock = new Date(clock.getTime() + TABLE_READ_MIN_GAP_MS + 1)
    const outcome = await readTableOf(
      env(),
      { tenantId, venueId: demo.venueId, tableId },
      {
        sim: policy,
        billIdKey: KEY,
        budgets: simBudgets(simClock),
        readingBudgets: new ReadingBudgets(),
        breakers,
        connectorFor: (integration, simPolicy) => {
          const real = serviceConnectorFor(integration, simPolicy)
          return {
            ...real,
            readTable: async (context, table) => {
              // The login's second is used up, by calls this run's budget did not see.
              for (let call = 0; call < 5; call++) {
                await real.probe({ now: context.now, timings: context.timings })
              }
              return real.readTable(context, table)
            },
          }
        },
      },
    )
    expect(outcome).toEqual({ kind: 'skipped', reason: 'the POS was busy' })
    expect(sim.host.engine.calls().at(-1)?.status).toBe(429)
    expect(record).not.toHaveBeenCalled()
    expect(await readingRow()).toEqual(good)
    expect(await sittingOf(sittingId)).toMatchObject({ ended_at: null })
    expect(
      await query('select cause from restro.pauses where target_id = $1 and lifted_at is null', [
        tableId,
      ]),
    ).toEqual([])
  })

  it('refuses a sim instance in production before the POS is asked', async () => {
    await freshSitting()
    const calls = sim.host.engine.calls().length
    expect(await read({ sim: { env: 'production', allowHosts: [] } })).toMatchObject({
      kind: 'refused',
    })
    expect(sim.host.engine.calls().length).toBe(calls)
  })

  it('no fault plan that makes a reading partial ends the sitting or changes the bill shown (rule 6)', async () => {
    // Every plan: the faults that cut a read short, on any read or any call, from the bill list
    // or the first bill's rows on, after the waiter closed the bill, added a round or did nothing.
    const faults = [
      { kind: 'fail' },
      { kind: 'dropItem' },
      { kind: 'loginOffline' },
      { kind: 'refuse', code: 'busy' },
    ] as const
    const plans = faults.flatMap((fault) =>
      (['read', 'any'] as const).flatMap((on) =>
        [1, 2].flatMap((from) =>
          (['closed', 'added', 'nothing'] as const).map((waiter) => ({ fault, on, from, waiter })),
        ),
      ),
    )
    let partials = 0
    for (const plan of plans) {
      const sittingId = await freshSitting()
      const round = sim.host.engine.waiter.addRound(POS_TABLE, [{ article: '2001' }])
      expect(await read()).toMatchObject({ complete: true, ended: false })
      const good = await readingRow()

      if (plan.waiter === 'closed') sim.host.engine.waiter.closeBill(round.bill, 'cash')
      if (plan.waiter === 'added') sim.host.engine.waiter.addRound(POS_TABLE, [{ article: '2003' }])
      sim.host.engine.faults.add({
        on: plan.on,
        from: plan.from,
        times: Infinity,
        fault: plan.fault,
      })
      const outcome = await read()
      if (outcome.kind === 'skipped') {
        // A definite busy on a call of the read is a read skipped: nothing is recorded at all.
        expect(plan.fault.kind, JSON.stringify(plan)).toBe('refuse')
        expect(await sittingOf(sittingId)).toMatchObject({ ended_at: null })
        expect(await readingRow()).toEqual(good)
        partials += 1
        continue
      }
      if (outcome.kind !== 'recorded') throw new Error(`not recorded: ${JSON.stringify(outcome)}`)
      // A plan that missed every call (a fault from the second call of a one-call read, an item
      // dropped from an empty list) gave a complete reading: not this test's case.
      if (outcome.complete) continue
      partials += 1
      const name = JSON.stringify(plan)
      expect(outcome.ended, name).toBe(false)
      expect(await sittingOf(sittingId), name).toMatchObject({ ended_at: null })
      const after = await readingRow()
      expect(after?.complete, name).toBe(false)
      expect(after?.read_at, name).toEqual(good?.read_at)
      expect(after?.bills, name).toEqual(good?.bills)
    }
    expect(partials).toBeGreaterThan(plans.length / 2)
  })
})
