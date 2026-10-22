// The floor reading job (#71) on Postgres through its real code, against a real simulator server
// over HTTP (`createSimServer`, the one `pnpm sim:serve` runs): Demo Bar's two bars, twelve tables
// and four payment tables come out of `readFloor` into the venue; a partial reading concludes
// nothing; a vanished table pauses its open sitting (never ends it) and a returned one lifts the
// pause; two venues share one POS instance (picking their halls or bars, taking turns on one
// budget, stopped together by one connection pause); and a `sim` instance is refused in
// production, before the host is asked.
import { JOB_NAMES, newId } from '@restro/core'
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

import { WorkerStatus } from '../src/health'
import {
  createFloorJobs,
  FLOOR_READ_INTERVAL_MS,
  floorTargets,
  InstanceBudgets,
  readFloorOf,
} from '../src/jobs/floor'
import type { WorkerContext } from '../src/jobs/types'
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

const MAIN_BAR = '2001'
const UPSTAIRS_BAR = '9c4d1e6a-3b7f-4a02-8d15-6e0b2f7a9c48'
const PAYMENT_NAMES = ['PM1', 'PM2', 'PU1', 'PU2']

describe.skipIf(!hasDatabase)('the floor reading job', () => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  /** The simulator's clock, moved on between reads: its rate limit (5 a second) is met by pacing. */
  const simClock = new ManualClock()
  let host: string
  const tenantId = newId('tn')
  const logLines: string[] = []
  let log: Awaited<ReturnType<typeof createLogger>>
  let clock = new Date()
  let nextBid = 1
  let nextInstance = 1

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-floor-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Floor club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Floor club', $2)`,
      [tenantId, `floor-${newId('tn').slice(3, 11)}`],
    )
    log = await createLogger({
      level: 'debug',
      pretty: false,
      destination: { write: (line: string) => void logLines.push(line) },
    })
    sim = createSimServer({ scenario: 'quiet-night', print: () => {}, clock: simClock })
    host = `127.0.0.1:${await sim.listen(0)}`
  })

  afterAll(async () => {
    await sim?.close()
    await pool?.end()
    await db?.drop()
  })

  const policy = { env: 'test', allowHosts: [] } as const
  const env = () => ({ pool, log, now: () => clock })

  /** A fresh simulator state for each test: the scenario is rebuilt. */
  const resetSim = (scenario = 'quiet-night') => sim.host.load(scenario)

  /** A `sim` instance for the running server (its own host name, so it is its own instance). */
  async function instance(): Promise<string> {
    // Hosts differ by a harmless suffix label so two instances stay two rows: createIntegration
    // returns the existing row for the same kind and host.
    const created = await createIntegration(pool, tenantId, {
      kind: 'sim',
      host: `${host.replace('127.0.0.1', `i${nextInstance++}.localhost`)}`,
    })
    return created.id
  }

  /**
   * A new instance whose host really is the running server (`127.0.0.1`). An earlier test's
   * instance of that host is removed first (`createIntegration` hands back the live one for a host),
   * so each test has the floor to itself.
   */
  async function liveInstance(): Promise<string> {
    await query(
      'update restro.integrations set removed_at = now() where host = $1 and removed_at is null',
      [host],
    )
    return (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
  }

  async function venue(name: string, integrationId: string) {
    const created = await provisionVenue(pool, tenantId, { name, slug: testSlug('floor') })
    const bid = nextBid++
    await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid, name }])
    const mapped = await mapBarsyVenue(pool, tenantId, integrationId, bid, created.id)
    expect(mapped.ok).toBe(true)
    return { venueId: created.id, bid, integrationId }
  }

  const tablesOf = (venueId: string) =>
    query<{
      id: string
      number: string
      bar_id: string | null
      is_payment_table: boolean
      hidden: boolean
      archived_at: Date | null
    }>(
      'select id, number, bar_id, is_payment_table, hidden, archived_at from restro.tables where venue_id = $1 order by number',
      [venueId],
    )
  const barsOf = (venueId: string) =>
    query<{ id: string; name: string; archived_at: Date | null }>(
      'select id, name, archived_at from restro.bars where venue_id = $1 order by name',
      [venueId],
    )
  const runsOf = (venueId: string) =>
    query<{ status: string; counters: Record<string, number>; details: { notes: string[] } }>(
      `select status, counters, details from restro.job_runs
       where kind = 'floor_read' and details->>'venue_id' = $1 order by created_at`,
      [venueId],
    )

  const read = (v: { venueId: string; integrationId: string }, deps = {}) => {
    simClock.advance(1100)
    return readFloorOf(
      env(),
      { tenantId, integrationId: v.integrationId, venueId: v.venueId },
      {
        sim: policy,
        budgets: new InstanceBudgets(),
        ...deps,
      },
    )
  }

  it("reads Demo Bar's two bars, twelve tables and four payment tables from the simulator", async () => {
    resetSim()
    const demo = await venue('Demo Bar', await liveInstance())
    await setFloorSource(pool, tenantId, {
      venueId: demo.venueId,
      source: { halls: null, bars: null, paymentTables: PAYMENT_NAMES },
    })
    const outcome = await read(demo)
    if (outcome.kind !== 'read') throw new Error(`not read: ${JSON.stringify(outcome)}`)
    expect(outcome.counters).toMatchObject({
      tables_listed: 16,
      tables_created: 16,
      bars_created: 2,
    })

    const tables = await tablesOf(demo.venueId)
    expect(tables).toHaveLength(16)
    expect(
      tables
        .filter((table) => table.is_payment_table)
        .map((table) => table.number)
        .sort(),
    ).toEqual(PAYMENT_NAMES)
    // A payment table is hidden: it gets no code and no guest page.
    expect(tables.filter((table) => table.is_payment_table).every((table) => table.hidden)).toBe(
      true,
    )
    expect(tables.filter((table) => !table.is_payment_table)).toHaveLength(12)
    const bars = await barsOf(demo.venueId)
    expect(bars.map((bar) => bar.name)).toEqual(['Main bar', 'Upstairs'])
    expect(tables.every((table) => table.bar_id !== null)).toBe(true)
    // The run is the write's provenance.
    const [run] = await runsOf(demo.venueId)
    expect(run?.status).toBe('completed')
    expect(run?.counters).toMatchObject({ tables_listed: 16, bars_created: 2 })
    // The POS's own ids never reach the platform's rows (rule 3).
    expect(JSON.stringify(tables)).not.toContain('30001')
    expect(JSON.stringify(bars)).not.toContain(MAIN_BAR)
  })

  it('writes the same thing again as nothing', async () => {
    resetSim()
    const demo = await venue('Repeat Bar', await liveInstance())
    await read(demo)
    const before = JSON.stringify([await tablesOf(demo.venueId), await barsOf(demo.venueId)])
    const again = await read(demo)
    expect(again).toMatchObject({
      kind: 'read',
      counters: { tables_created: 0, tables_updated: 0, bars_created: 0 },
    })
    expect(JSON.stringify([await tablesOf(demo.venueId), await barsOf(demo.venueId)])).toBe(before)
  })

  it('concludes nothing from a partial reading: no table goes missing, no pause starts (rule 6)', async () => {
    resetSim()
    const demo = await venue('Partial Bar', await liveInstance())
    await read(demo)
    const upstairs = await tablesOf(demo.venueId)
    const t9 = upstairs.find((table) => table.number === '9')
    if (t9 === undefined) throw new Error('no table 9')
    await query(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', 'staff', 'system', 'test')`,
      [newId('st'), tenantId, demo.venueId, t9.id, new Date().toISOString().slice(0, 10)],
    )
    // Table 9 leaves the POS, but the reading that would show it is cut short.
    const state = sim.host.engine.state
    const at = state.tables.findIndex((table) => table.number === '9')
    state.tables.splice(at, 1)
    sim.host.engine.faults.add({ on: 'listTables', fault: { kind: 'dropItem' } })
    const outcome = await read(demo)
    expect(outcome).toMatchObject({ kind: 'incomplete' })
    expect(await tablesOf(demo.venueId)).toEqual(upstairs)
    expect(await query('select 1 from restro.pauses where target_id = $1', [t9.id])).toHaveLength(0)
    const runs = await runsOf(demo.venueId)
    expect(runs.at(-1)?.status).toBe('failed')
    expect(runs.at(-1)?.details.notes.join(' ')).toContain('nothing was concluded')
  })

  it('pauses the open sitting of a table that vanished, never ends it, and lifts the pause when it is back', async () => {
    resetSim()
    const demo = await venue('Vanish Bar', await liveInstance())
    await read(demo)
    const t9 = (await tablesOf(demo.venueId)).find((table) => table.number === '9')
    if (t9 === undefined) throw new Error('no table 9')
    const sittingId = newId('st')
    await query(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', 'staff', 'system', 'test')`,
      [sittingId, tenantId, demo.venueId, t9.id, new Date().toISOString().slice(0, 10)],
    )
    const state = sim.host.engine.state
    const at = state.tables.findIndex((table) => table.number === '9')
    const [removed] = state.tables.splice(at, 1)
    if (removed === undefined) throw new Error('no table removed')

    const gone = await read(demo)
    expect(gone).toMatchObject({
      kind: 'read',
      counters: { tables_vanished: 1, sittings_paused: 1 },
    })
    const after = await tablesOf(demo.venueId)
    // Never deleted, never archived.
    expect(after).toHaveLength(16)
    expect(after.find((table) => table.id === t9.id)?.archived_at).toBeNull()
    const pauses = await query<{
      scope: string
      cause: string
      lifted_at: Date | null
      actor: string
    }>('select scope, cause, lifted_at, actor from restro.pauses where target_id = $1', [t9.id])
    expect(pauses).toHaveLength(1)
    expect(pauses[0]).toMatchObject({ scope: 'table', cause: 'table_vanished', lifted_at: null })
    expect(pauses[0]?.actor).toMatch(/^integration:in_/)
    const sitting = await query<{ ended_at: Date | null }>(
      'select ended_at from restro.sittings where id = $1',
      [sittingId],
    )
    expect(sitting[0]?.ended_at).toBeNull()

    // A second read of the same floor pauses nothing twice.
    await read(demo)
    expect(await query('select 1 from restro.pauses where target_id = $1', [t9.id])).toHaveLength(1)

    // The table is back: the pause lifts.
    state.tables.splice(at, 0, removed)
    const back = await read(demo)
    expect(back).toMatchObject({ kind: 'read', counters: { tables_returned: 1, pauses_lifted: 1 } })
    const lifted = await query<{ lifted_at: Date | null; lift_reason: string | null }>(
      'select lifted_at, lift_reason from restro.pauses where target_id = $1',
      [t9.id],
    )
    expect(lifted[0]?.lifted_at).not.toBeNull()
    expect(lifted[0]?.lift_reason).toBe('table_returned')
  })

  it('shares one POS instance between two venues that pick their halls or their bars', async () => {
    resetSim()
    const shared = await liveInstance()
    const club = await venue('Club', shared)
    const restaurant = await venue('Restaurant', shared)
    await setFloorSource(pool, tenantId, {
      venueId: club.venueId,
      source: { halls: ['Main hall'], bars: null, paymentTables: [] },
    })
    await setFloorSource(pool, tenantId, {
      venueId: restaurant.venueId,
      source: { halls: null, bars: [UPSTAIRS_BAR], paymentTables: [] },
    })
    // Both at once, on one budget: the simulator allows one call at a time per login, so a
    // second read that did not wait for the first would meet `busy`.
    const budgets = new InstanceBudgets()
    const [a, b] = await Promise.all([read(club, { budgets }), read(restaurant, { budgets })])
    expect(a).toMatchObject({ kind: 'read', counters: { tables_listed: 8 } })
    expect(b).toMatchObject({ kind: 'read', counters: { tables_listed: 8 } })
    expect((await tablesOf(club.venueId)).map((table) => table.number).sort()).toEqual(
      ['1', '2', '3', '4', '5', '6', 'PM1', 'PM2'].sort(),
    )
    expect((await tablesOf(restaurant.venueId)).map((table) => table.number).sort()).toEqual(
      ['10', '11', '12', '7', '8', '9', 'PU1', 'PU2'].sort(),
    )
    expect((await barsOf(club.venueId)).map((bar) => bar.name)).toEqual(['Main bar'])
    expect((await barsOf(restaurant.venueId)).map((bar) => bar.name)).toEqual(['Upstairs'])
  })

  it('gives each instance one budget, shared by every job of the process', () => {
    const budgets = new InstanceBudgets()
    expect(budgets.forInstance('in_a')).toBe(budgets.forInstance('in_a'))
    expect(budgets.forInstance('in_a')).not.toBe(budgets.forInstance('in_b'))
  })

  it("stops both venues of an instance while the instance's connection is paused", async () => {
    resetSim()
    const shared = await liveInstance()
    const first = await venue('Paused A', shared)
    const second = await venue('Paused B', shared)
    await setFloorSource(pool, tenantId, {
      venueId: first.venueId,
      source: { halls: ['Main hall'], bars: null, paymentTables: [] },
    })
    await setFloorSource(pool, tenantId, {
      venueId: second.venueId,
      source: { halls: ['Upstairs'], bars: null, paymentTables: [] },
    })
    const pauseId = newId('pa')
    await query(
      `insert into restro.pauses (id, tenant_id, venue_id, service_date, scope, target_id, cause, restro_started, source, actor, job_id)
       values ($1, $2, $3, $4, 'connection', $5, 'login_refused', true, 'worker', 'system', 'test')`,
      [pauseId, tenantId, first.venueId, new Date().toISOString().slice(0, 10), shared],
    )
    const calls = sim.host.engine.calls().length
    expect(await read(first)).toMatchObject({ kind: 'skipped', reason: 'the connection is paused' })
    expect(await read(second)).toMatchObject({
      kind: 'skipped',
      reason: 'the connection is paused',
    })
    expect(sim.host.engine.calls().length).toBe(calls)
    expect(await tablesOf(first.venueId)).toHaveLength(0)

    await query(`update restro.pauses set lifted_at = now(), lift_reason = 'test' where id = $1`, [
      pauseId,
    ])
    expect(await read(first)).toMatchObject({ kind: 'read' })
    expect(await read(second)).toMatchObject({ kind: 'read' })
  })

  it('refuses a sim instance in production before the host is asked, and records the refusal', async () => {
    resetSim()
    const demo = await venue('Production Bar', await liveInstance())
    const asked = vi.spyOn(globalThis, 'fetch')
    const callsBefore = sim.host.engine.calls().length
    try {
      const outcome = await readFloorOf(
        env(),
        { tenantId, integrationId: demo.integrationId, venueId: demo.venueId },
        { sim: { env: 'production', allowHosts: [] }, budgets: new InstanceBudgets() },
      )
      expect(outcome).toMatchObject({ kind: 'refused', code: 'sim_in_production' })
      expect(asked).not.toHaveBeenCalled()
      expect(sim.host.engine.calls().length).toBe(callsBefore)
    } finally {
      asked.mockRestore()
    }
    expect(await tablesOf(demo.venueId)).toHaveLength(0)
    const [run] = await runsOf(demo.venueId)
    expect(run?.status).toBe('failed')
    expect(run?.details.notes.join(' ')).toContain('never used in production')
  })

  it('refuses a host the worker does not allow', async () => {
    resetSim()
    const integrationId = (
      await createIntegration(pool, tenantId, { kind: 'sim', host: 'sim.not-allowed.example' })
    ).id
    const stranger = await venue('Stranger Bar', integrationId)
    const outcome = await read(stranger)
    expect(outcome).toMatchObject({ kind: 'refused', code: 'host_not_allowed' })
  })

  it('the tick never schedules a sim venue in production, and only when a read is due', async () => {
    resetSim()
    const integrationId = await instance()
    const demo = await venue('Tick Bar', integrationId)
    const mine = (targets: Awaited<ReturnType<typeof floorTargets>>) =>
      targets.filter((target) => target.venueId === demo.venueId)

    expect(mine(await floorTargets(pool, { env: 'production', allowHosts: [] }))).toHaveLength(0)
    const targets = mine(await floorTargets(pool, policy))
    expect(targets).toHaveLength(1)
    expect(targets[0]?.lastReadAt).toBeNull()

    const sent: { name: string; data: object; singletonKey: string | undefined }[] = []
    const context: WorkerContext = {
      pool,
      log,
      workerId: 'floor-tests',
      version: '0.0.0-test',
      now: () => clock,
      status: new WorkerStatus(),
      queue: {
        async send(name, data, options) {
          sent.push({ name, data, singletonKey: options?.singletonKey })
          return `queued-${sent.length}`
        },
      },
    }
    const tick = createFloorJobs({ sim: policy })[1]
    if (tick === undefined) throw new Error('no tick job')
    const run = () => tick.handler([], context)
    const queuedFor = () =>
      sent.filter((job) => (job.data as { venueId?: string }).venueId === demo.venueId)

    await run()
    expect(queuedFor()).toHaveLength(1)
    expect(queuedFor()[0]?.name).toBe(JOB_NAMES.floorRead)
    expect(queuedFor()[0]?.singletonKey).toBe(`${integrationId}:${demo.venueId}`)

    // A read has just run for this venue: not due again until the interval passes.
    await runsRecorded(demo)
    clock = new Date(Date.now() + 60_000)
    sent.length = 0
    await run()
    expect(queuedFor()).toHaveLength(0)
    clock = new Date(Date.now() + FLOOR_READ_INTERVAL_MS + 60_000)
    await run()
    expect(queuedFor()).toHaveLength(1)
    clock = new Date()
  })

  async function runsRecorded(v: { venueId: string; integrationId: string }) {
    // A read has just run for this venue (its run is recorded).
    await query(
      `insert into restro.job_runs (id, tenant_id, integration_id, kind, status, details)
       select $1, $2, $3, 'floor_read', 'completed', jsonb_build_object('venue_id', $4::text)
       where not exists (select 1 from restro.job_runs where integration_id = $3 and kind = 'floor_read'
                         and details->>'venue_id' = $4::text)`,
      [newId('jb'), tenantId, v.integrationId, v.venueId],
    )
  }
})
