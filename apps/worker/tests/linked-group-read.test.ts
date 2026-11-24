// A linked group's bill when one member table's reading fails (#319, D160 log 1.8, rule 6), on
// Postgres through the real reading job, against a real simulator server over HTTP: a party is
// seated on tables 1 and 2, the waiter adds an order on each, both are read, then the simulator
// fails table 2's next read. Table 1's phone still sees both tables' lines, table 2's last lines
// marked as updating, and the group's total said to be not final; a good read of table 2 makes it
// final again. Only the simulator is ever called (rule 7).
import { randomUUID } from 'node:crypto'

import { type IntegrationId, newId, serviceDate, type VenueId } from '@restro/core'
import {
  createIntegration,
  mapBarsyVenue,
  provisionTenant,
  provisionVenue,
  setFloorSource,
  upsertBarsyVenues,
} from '@restro/core/apply'
import {
  applyService,
  projectGuestState,
  readTableState,
  type ServiceCommand,
  type ServiceContext,
  type TableStateRead,
} from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import { createSimServer, ManualClock, type SimServer } from '@restro/sim-pos'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readFloorOf } from '../src/jobs/floor'
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
import { simBudgets } from './sim-pace'

allowSlowSetup()

const KEY = 'linked-group-read-key-'.padEnd(48, 'x')
/** Demo Bar's tables 1 and 2 on the simulator. */
const POS_TABLES = { '1': '30001', '2': '30002' } as const

describe.skipIf(!hasDatabase)("a linked group's bill when a member table did not read", () => {
  let db: TestDatabase
  let pool: DbPool
  let sim: SimServer
  const simClock = new ManualClock()
  const tenantId = newId('tn')
  const ownerId = `svc-${newId('us').slice(3)}`
  let log: Awaited<ReturnType<typeof createLogger>>
  let clock = new Date()
  let demo: { venueId: VenueId; integrationId: IntegrationId }
  const tables = new Map<'1' | '2', `tb_${string}`>()

  const query = <Row extends object = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as Row[])

  const policy = { env: 'test', allowHosts: [] } as const
  const env = () => ({ pool, log, now: () => clock })

  const staff = (): ServiceContext => ({
    tenantId,
    venueId: demo.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })

  async function accept(command: ServiceCommand): Promise<Record<string, unknown>> {
    const { result } = await applyService(pool, command, staff())
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }

  const tableId = (number: '1' | '2') => tables.get(number) as `tb_${string}`

  /** One read of the table, past the per-table gap and the simulator's rate limit. */
  const read = (number: '1' | '2') => {
    simClock.advance(1100)
    clock = new Date(clock.getTime() + TABLE_READ_MIN_GAP_MS + 1)
    return readTableOf(
      env(),
      { tenantId, venueId: demo.venueId, tableId: tableId(number) },
      {
        sim: policy,
        billIdKey: KEY,
        budgets: simBudgets(simClock),
        readingBudgets: new ReadingBudgets(),
      },
    )
  }

  const stateOf = async (number: '1' | '2'): Promise<TableStateRead> => {
    const state = await readTableState(pool, { tenantId, tableId: tableId(number) })
    if (state === null || state.unchanged) throw new Error('no table state')
    return state
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-linked-group-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Group club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Group club', $2)`,
      [tenantId, `group-${newId('tn').slice(3, 11)}`],
    )
    await query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      ownerId,
      'Test owner',
      `${ownerId}@example.test`,
    ])
    await query(
      'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
      [`mb-${ownerId}`, tenantId, ownerId, 'owner'],
    )
    log = await createLogger({ level: 'debug', pretty: false, destination: { write: () => {} } })
    sim = createSimServer({ scenario: 'demo-bar', print: () => {}, clock: simClock })
    const host = `127.0.0.1:${await sim.listen(0)}`

    const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host })).id
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Demo Bar',
      slug: testSlug('group'),
    })
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
    for (const number of ['1', '2'] as const) {
      const [table] = await query<{ id: `tb_${string}` }>(
        'select id from restro.tables where venue_id = $1 and number = $2',
        [demo.venueId, number],
      )
      if (table === undefined) throw new Error(`no table ${number}`)
      tables.set(number, table.id)
    }

    // A floor plan with a spot on each table, and a party booked on both and marked present:
    // its tables open, and they are one linked group.
    await accept({ type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand)
    const planId = (
      await accept({ type: 'plan.save', name: 'Floor', makeCurrent: true } as ServiceCommand)
    ).planId as string
    await accept({
      type: 'spot_kind.save',
      key: 'table',
      label: 'Table',
      defaultSeats: 4,
    } as ServiceCommand)
    const spotIds: string[] = []
    for (const [index, number] of (['1', '2'] as const).entries()) {
      const details = await accept({
        type: 'spot.save',
        planId,
        name: `T${number}`,
        kind: 'table',
        shape: 'rect',
        x: index * 100,
        y: 0,
        width: 80,
        height: 80,
        tableId: tableId(number),
      } as ServiceCommand)
      spotIds.push(details.spotId as string)
    }
    const [venueRow] = await query<{ timezone: string; ends_at: string }>(
      'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
      [demo.venueId],
    )
    const today = serviceDate(
      new Date(),
      venueRow?.timezone ?? 'UTC',
      venueRow?.ends_at ?? '07:00:00',
    )
    const reservationId = (
      await accept({
        type: 'reservation.create',
        serviceDate: today,
        startsAt: new Date().toISOString(),
        kind: 'booking',
        status: 'reserved',
        partySize: 6,
        partyLabel: 'Group',
        phone: '+359888123456',
        spotIds,
      } as ServiceCommand)
    ).reservationId as string
    await accept({ type: 'reservation.arrive', reservationId } as ServiceCommand)
  })

  afterAll(async () => {
    await sim?.close()
    await pool?.end()
    await db?.drop()
  })

  it("shows the other table's last lines as updating and the total as not final, until it reads well again", async () => {
    sim.host.engine.waiter.addRound(POS_TABLES['1'], [{ article: '2001' }])
    sim.host.engine.waiter.addRound(POS_TABLES['2'], [{ article: '2002', quantity: '2' }])
    expect(await read('1')).toMatchObject({ kind: 'recorded', complete: true })
    expect(await read('2')).toMatchObject({ kind: 'recorded', complete: true })

    const good = projectGuestState(await stateOf('1'), 'bill').bill?.group
    expect(good?.complete).toBe(true)
    expect(good?.tables).toHaveLength(2)
    const owed = good?.owedMinor ?? 0
    expect(owed).toBeGreaterThan(0)
    const otherGood = good?.tables.find((table) => !table.own)

    // The simulator fails table 2's next read: that reading is partial and concludes nothing.
    sim.host.engine.faults.add({ on: 'read', from: 1, times: Infinity, fault: { kind: 'fail' } })
    const failed = await read('2')
    sim.host.engine.faults.clear()
    expect(failed).toMatchObject({ kind: 'recorded', complete: false })

    const state = await stateOf('1')
    expect(state.group?.unread).toBe(true)
    const group = projectGuestState(state, 'bill').bill?.group
    if (group === undefined) throw new Error('no group bill')
    expect(group.complete).toBe(false)
    const own = group.tables.find((table) => table.own)
    const other = group.tables.find((table) => !table.own)
    expect(own?.complete).toBe(true)
    // Table 2 keeps its last lines, marked as updating; the total stays what was last known.
    expect(other?.complete).toBe(false)
    expect(other?.parts).toEqual(otherGood?.parts)
    expect(group.owedMinor).toBe(owed)

    // Table 2 reads well again: the total is final.
    expect(await read('2')).toMatchObject({ kind: 'recorded', complete: true })
    expect(projectGuestState(await stateOf('1'), 'bill').bill?.group?.complete).toBe(true)
  })
})
