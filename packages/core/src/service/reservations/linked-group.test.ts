// Linked groups (#319, D160 §1): the party's tables read as one group, and the group's bill on the
// phone. The pure rules (which tables make a group, the group's key, the group's bill as a phone
// sees it) run everywhere; what only a database can show runs on a real Postgres as the restro_app
// role: a booked party on three tables and a walk-in on two read as one group from any member, a
// one-table party and a table outside read as none, Change tables adds and removes a member, and a
// member whose reading failed keeps its last lines and leaves the total not final, and a phone
// whose own table is not read yet still sees the group's bill. Skipped
// without a database where it needs one.
import { randomUUID } from 'node:crypto'

import { withTenant } from '@restro/db'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import { type Id, newId } from '../../ids'
import { GROUP_LABEL_MAX, GROUP_TABLES_MAX } from '../../linked-group-limits'
import { DEFAULT_ORDERING_SETTINGS } from '../../ordering-settings'
import { hashTableCode } from '../../qr'
import { serviceDate as serviceDateOf } from '../../service-day'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { BillView } from '../bill'
import { forbiddenPaths } from '../bill'
import type { ServiceActor, ServiceContext } from '../context'
import { forgetGuestCodes, groupBillOf, guestState } from '../guest'
import { GUEST_LIMITS, type GuestLimit, GuestLimiter, type GuestLimitName } from '../guest-limits'
import type { ServiceCommand } from '../index'
import { type GroupRead, groupKeyOf, readTableState, type TableStateRead } from '../read'
import { linkedGroupsAtTables, linkedGroupsOf, type PartyHold } from './linked-group'

const hold = (tableId: string, reservationId: string): PartyHold => ({
  tableId,
  sittingId: `si_${tableId}`,
  reservationId,
})

describe('which tables make a linked group (pure)', () => {
  it('groups a party on three tables, each member reading the same group, in table order', () => {
    const groups = linkedGroupsOf([hold('t3', 'rA'), hold('t1', 'rA'), hold('t2', 'rA')])
    const group = groups.get('t2')
    expect(group?.reservationId).toBe('rA')
    expect(group?.tables.map((table) => table.tableId)).toEqual(['t1', 't2', 't3'])
    expect(groups.get('t1')).toEqual(group)
    expect(groups.get('t3')).toEqual(group)
  })

  it('makes no group of a party on one table, nor of a table nobody holds', () => {
    const groups = linkedGroupsOf([hold('t1', 'rA'), hold('t2', 'rB'), hold('t3', 'rB')])
    expect(groups.has('t1')).toBe(false)
    expect(groups.get('t2')?.reservationId).toBe('rB')
    expect(groups.has('t9')).toBe(false)
  })

  it('leaves a table two parties hold out of both groups, and a group left one table is none', () => {
    const groups = linkedGroupsOf([
      hold('t1', 'rA'),
      hold('t2', 'rA'),
      hold('t3', 'rA'),
      hold('t2', 'rB'),
      hold('t4', 'rB'),
    ])
    expect(groups.has('t2')).toBe(false)
    expect(groups.get('t1')?.tables.map((table) => table.tableId)).toEqual(['t1', 't3'])
    expect(groups.has('t4')).toBe(false)
  })
})

describe("a linked group's key (pure)", () => {
  const member = (tableId: string, version: number, reading = 'complete' as const) => ({
    tableId,
    sittingId: `si_${tableId}`,
    version,
    reading,
  })

  it('is the same in any order, positive and never 0', () => {
    const key = groupKeyOf([member('t1', 3), member('t2', 5)])
    expect(groupKeyOf([member('t2', 5), member('t1', 3)])).toBe(key)
    expect(key).toBeGreaterThan(0)
    expect(Number.isInteger(key)).toBe(true)
  })

  it('changes when a member joins, its version rises, its sitting or its reading changes', () => {
    const key = groupKeyOf([member('t1', 3), member('t2', 5)])
    expect(groupKeyOf([member('t1', 3), member('t2', 5), member('t3', 1)])).not.toBe(key)
    expect(groupKeyOf([member('t1', 3), member('t2', 6)])).not.toBe(key)
    expect(groupKeyOf([member('t1', 3), { ...member('t2', 5), sittingId: 'si_new' }])).not.toBe(key)
    expect(groupKeyOf([member('t1', 3), { ...member('t2', 5), reading: 'failed' }])).not.toBe(key)
  })
})

describe("a linked group's bill as a phone sees it (pure)", () => {
  const bill = (owedMinor: number, complete = true): BillView => ({
    readAt: new Date(10_000),
    complete,
    currency: 'EUR',
    totalMinor: owedMinor,
    paidMinor: 0,
    owedMinor,
    bills: [
      {
        id: `rd_${owedMinor}`,
        beingPaid: false,
        totalMinor: owedMinor,
        paidMinor: 0,
        lines: [
          {
            id: `bn_${owedMinor}`,
            name: { en_US: 'Beer' },
            quantity: '1',
            amountMinor: owedMinor,
            beingPaid: false,
          },
        ],
      },
    ],
    paidLines: [],
  })
  const groupOf = (tables: GroupRead['tables'], unread = false): GroupRead => ({
    key: 7,
    unread,
    tables,
  })

  it('gives each table its own lines and totals and one total, signed sums through money', () => {
    const view = groupBillOf(
      groupOf([
        { tableId: 'tb_1', label: '1', own: true, reading: 'complete', bill: bill(1_250) },
        { tableId: 'tb_2', label: '2', own: false, reading: 'complete', bill: bill(-200) },
      ]),
    )
    expect(view).toMatchObject({ complete: true, totalMinor: 1_050, owedMinor: 1_050 })
    expect(view.tables.map((table) => [table.label, table.own, table.owedMinor])).toEqual([
      ['1', true, 1_250],
      ['2', false, -200],
    ])
    expect(view.tables[0]?.parts[0]?.lines[0]?.name).toEqual({ en_US: 'Beer' })
  })

  it('marks a table that did not read as not complete, keeps its last lines, and the total not final', () => {
    const view = groupBillOf(
      groupOf(
        [
          { tableId: 'tb_1', label: '1', own: true, reading: 'complete', bill: bill(1_250) },
          { tableId: 'tb_2', label: '2', own: false, reading: 'failed', bill: bill(500, false) },
        ],
        true,
      ),
    )
    expect(view.complete).toBe(false)
    expect(view.tables[1]).toMatchObject({ complete: false, owedMinor: 500 })
    expect(view.tables[1]?.parts[0]?.lines).toHaveLength(1)
  })

  it('draws a table with no reading yet as empty and not complete', () => {
    const view = groupBillOf(
      groupOf(
        [
          { tableId: 'tb_1', label: '1', own: true, reading: 'complete', bill: bill(1_250) },
          { tableId: 'tb_2', label: '2', own: false, reading: 'none', bill: null },
        ],
        true,
      ),
    )
    expect(view.tables[1]).toMatchObject({
      complete: false,
      owedMinor: 0,
      parts: [],
    })
    expect(view).toMatchObject({ complete: false, owedMinor: 1_250 })
  })

  it('carries this table and the first others by name up to the cap, and the total not final', () => {
    const others = Array.from({ length: GROUP_TABLES_MAX + 1 }, (_, index) => ({
      tableId: `tb_${index}`,
      label: `T${String(index).padStart(3, '0')}`,
      own: false,
      reading: 'complete' as const,
      bill: bill(100),
    }))
    const own = {
      tableId: 'tb_own',
      label: `Z${'x'.repeat(GROUP_LABEL_MAX + 10)}`,
      own: true,
      reading: 'complete' as const,
      bill: bill(1_000),
    }
    const view = groupBillOf(groupOf([...others, own]))
    expect(view.tables).toHaveLength(GROUP_TABLES_MAX)
    expect(view.tables.at(-1)).toMatchObject({ own: true, owedMinor: 1_000 })
    expect(view.tables.at(-1)?.label).toHaveLength(GROUP_LABEL_MAX)
    expect(view.tables.at(-2)?.label).toBe(`T${String(GROUP_TABLES_MAX - 2).padStart(3, '0')}`)
    expect(view.complete).toBe(false)
  })
})

const KEY = 'linked-group-test-key-'.padEnd(48, 'x')
const LOOSE = Object.fromEntries(
  Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
) as Record<GuestLimitName, GuestLimit>

describe.skipIf(!hasDatabase)('linked groups (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let today: string
  const integrationId = newId('in')
  /** The spots of the plan, each one its own table: `C1` is `world.tables[0]`, and so on. */
  const spots = new Map<string, string>()

  const staff = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: {
      kind: 'user',
      userId: ownerId,
      sessionId: `sess-${randomUUID()}`,
    } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })

  async function accept(command: ServiceCommand): Promise<Record<string, unknown>> {
    const { result } = await applyService(world.app, command, staff())
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }

  const spotIds = (...names: string[]) => names.map((name) => spots.get(name) as Id<'sp'>)
  const tableOf = (name: string) => world.tables[Number(name.slice(1)) - 1] as Id<'tb'>

  const seated = async (names: readonly string[]): Promise<Id<'rv'>> => {
    const id = (
      await accept({
        type: 'reservation.create',
        serviceDate: today,
        startsAt: new Date().toISOString(),
        kind: 'booking',
        status: 'reserved',
        partySize: 6,
        partyLabel: `Party ${randomUUID().slice(0, 6)}`,
        phone: `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
        spotIds: spotIds(...names),
      } as ServiceCommand)
    ).reservationId as Id<'rv'>
    await accept({ type: 'reservation.arrive', reservationId: id })
    return id
  }

  const walkIn = async (names: readonly string[]): Promise<Id<'rv'>> =>
    (
      await accept({
        type: 'reservation.seat_walk_in',
        serviceDate: today,
        spotIds: spotIds(...names),
        partySize: 4,
      } as ServiceCommand)
    ).reservationId as Id<'rv'>

  const changeTables = (reservationId: string, from: string[], to: string[]) =>
    accept({
      type: 'reservation.change_tables',
      reservationId,
      from: spotIds(...from),
      spotIds: spotIds(...to),
    } as ServiceCommand)

  /** A reading of the table's POS bill, by the worker: one line of `amountMinor`. */
  const record = async (name: string, reading: 'complete' | 'failed', amountMinor = 500) => {
    const pos = `B-${name}`
    const { result } = await applyService(
      world.app,
      {
        type: 'reading.record',
        tableId: tableOf(name),
        reading:
          reading === 'failed'
            ? { complete: false, reason: 'the POS did not answer' }
            : {
                complete: true,
                currency: 'EUR',
                bills: [
                  {
                    pos,
                    totalMinor: amountMinor,
                    paidMinor: 0,
                    openedAt: '2026-11-24T20:00:00.000Z',
                    openedByRestro: false,
                    paymentInFlight: false,
                    lines: [
                      {
                        pos: `${pos}-1`,
                        itemPos: null,
                        posName: `till name ${name}`,
                        quantity: '1',
                        amountMinor,
                        enteredBy: 'staff',
                        enteredAt: null,
                        restroRef: null,
                      },
                    ],
                  },
                ],
              },
      } as never,
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'worker',
        actor: { kind: 'integration', integrationId },
        jobId: `table-read-${randomUUID()}`,
      },
      { billIdKey: KEY },
    )
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
  }

  const state = async (name: string): Promise<TableStateRead> => {
    const read = await readTableState(world.app, {
      tenantId: world.tenantId,
      tableId: tableOf(name),
    })
    if (read === null || read.unchanged) throw new Error('no table state')
    return read
  }
  const membersOf = (read: TableStateRead) =>
    read.group?.tables.map((table) => [table.tableId, table.own]) ?? null

  beforeAll(async () => {
    world = await openServiceWorld('linked-group')
    ownerId = await world.addUser('owner')
    const venue = (
      await world.owner.query<{ timezone: string; ends_at: string }>(
        'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
        [world.venueId],
      )
    ).rows[0]
    today = serviceDateOf(new Date(), venue?.timezone ?? 'UTC', venue?.ends_at ?? '07:00:00')
    await world.owner.query(
      `insert into restro.integrations (id, tenant_id, kind, host)
       values ($1, $2, 'sim', '127.0.0.1:9')`,
      [integrationId, world.tenantId],
    )
    await accept({ type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand)
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )
    const planId = (await accept({ type: 'plan.save', name: 'Floor', makeCurrent: true }))
      .planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    for (const [index, name] of ['C1', 'C2', 'C3', 'C4'].entries()) {
      const details = await accept({
        type: 'spot.save',
        planId,
        name,
        kind: 'table',
        shape: 'rect',
        x: index * 100,
        y: 0,
        width: 80,
        height: 80,
        tableId: world.tables[index],
      } as ServiceCommand)
      spots.set(name, details.spotId as string)
    }
  }, 60_000)

  afterAll(async () => {
    await world?.close()
  })

  afterEach(async () => {
    if (world === undefined) return
    await world.owner.query(
      `update restro.reservation_spots set released_at = now()
        where released_at is null and tenant_id = $1`,
      [world.tenantId],
    )
    await world.owner.query(
      `update restro.reservations set status = 'finished', ended_at = now()
        where venue_id = $1 and status in ('requested', 'reserved', 'waiting', 'seated')`,
      [world.venueId],
    )
    await world.owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
        where venue_id = $1 and ended_at is null`,
      [world.venueId],
    )
  })

  it('reads a booked party on three tables as one group from any member, and a one-table party as none', async () => {
    const party = await seated(['C1', 'C2', 'C3'])
    await seated(['C4'])
    const members = [tableOf('C1'), tableOf('C2'), tableOf('C3')].sort()
    for (const name of ['C1', 'C2', 'C3']) {
      const read = await state(name)
      expect(read.group?.tables.map((table) => table.tableId).sort()).toEqual(members)
      expect(read.group?.tables.filter((table) => table.own).map((t) => t.tableId)).toEqual([
        tableOf(name),
      ])
    }
    expect((await state('C4')).group).toBeNull()

    const venueWide = await withTenant(world.app, world.tenantId, (tx) =>
      linkedGroupsAtTables(tx, { venueId: world.venueId }),
    )
    expect(venueWide.get(tableOf('C2'))?.reservationId).toBe(party)
    expect(venueWide.has(tableOf('C4'))).toBe(false)
  })

  it('reads a walk-in on two tables as one group', async () => {
    await walkIn(['C1', 'C2'])
    expect(membersOf(await state('C2'))).toEqual(
      expect.arrayContaining([
        [tableOf('C1'), false],
        [tableOf('C2'), true],
      ]),
    )
    expect((await state('C3')).group).toBeNull()
  })

  it("shows every member's lines and one total to a phone in the group, and nothing to one outside", async () => {
    await seated(['C1', 'C2', 'C3'])
    await seated(['C4'])
    await record('C1', 'complete', 1_000)
    await record('C2', 'complete', 700)
    await record('C3', 'complete', 300)
    await record('C4', 'complete', 900)
    const read = await state('C2')
    const group = read.group
    if (group === null) throw new Error('no group')
    expect(group.unread).toBe(false)
    const view = groupBillOf(group)
    expect(view).toMatchObject({ complete: true, owedMinor: 2_000 })
    expect(view.tables.map((table) => table.owedMinor).sort()).toEqual([1_000, 300, 700].sort())
    // This table's own bill stays what its Pay reads.
    expect(read.bill?.owedMinor).toBe(700)
    // Nothing backend of any member reaches the phone (rule 3).
    expect(read.backendValues.has('B-C1')).toBe(true)
    expect(forbiddenPaths(view, read.backendValues)).toEqual([])
    // The table outside sees its own bill alone.
    const outside = await state('C4')
    expect(outside.group).toBeNull()
    expect(outside.bill?.owedMinor).toBe(900)
  })

  it('adds a table through Change tables to the group, and takes one out of it', async () => {
    const party = await seated(['C1', 'C2'])
    await record('C1', 'complete', 1_000)
    await record('C2', 'complete', 700)
    const before = (await state('C1')).group
    await changeTables(party, ['C1', 'C2'], ['C1', 'C2', 'C3'])
    await record('C3', 'complete', 300)
    const grown = (await state('C1')).group
    expect(grown?.tables.map((table) => table.tableId).sort()).toEqual(
      [tableOf('C1'), tableOf('C2'), tableOf('C3')].sort(),
    )
    expect(grown?.key).not.toBe(before?.key)
    expect(groupBillOf(grown as GroupRead).owedMinor).toBe(2_000)

    await changeTables(party, ['C1', 'C2', 'C3'], ['C1', 'C3'])
    const shrunk = (await state('C3')).group
    expect(shrunk?.tables.map((table) => table.tableId).sort()).toEqual(
      [tableOf('C1'), tableOf('C3')].sort(),
    )
    // The table taken out is closed (D137): its sitting ended, it is in no group.
    const left = await readTableState(world.app, {
      tenantId: world.tenantId,
      tableId: tableOf('C2'),
    })
    expect(left !== null && !left.unchanged ? left.group : null).toBeNull()

    await changeTables(party, ['C1', 'C3'], ['C1'])
    expect((await state('C1')).group).toBeNull()
  })

  it('keeps a member whose reading failed with its last lines, marked updating, and the total not final', async () => {
    await seated(['C1', 'C2', 'C3'])
    await record('C1', 'complete', 1_000)
    await record('C2', 'complete', 700)
    await record('C3', 'complete', 300)
    const good = (await state('C1')).group
    await record('C2', 'failed')
    const read = await state('C1')
    const group = read.group
    if (group === null) throw new Error('no group')
    expect(group.unread).toBe(true)
    expect(group.key).not.toBe(good?.key)
    const failed = group.tables.find((table) => table.tableId === tableOf('C2'))
    expect(failed?.reading).toBe('failed')
    const view = groupBillOf(group)
    expect(view.complete).toBe(false)
    const shown = view.tables.find((table) => table.owedMinor === 700)
    expect(shown).toMatchObject({ complete: false })
    expect(shown?.parts[0]?.lines).toHaveLength(1)
    expect(view.owedMinor).toBe(2_000)
  })

  it('answers "unchanged" with the group key, which moves when another member reads', async () => {
    await seated(['C1', 'C2'])
    await record('C1', 'complete', 1_000)
    await record('C2', 'complete', 700)
    const full = await state('C1')
    const since = await readTableState(world.app, {
      tenantId: world.tenantId,
      tableId: tableOf('C1'),
      since: full.version,
    })
    if (since === null || !since.unchanged) throw new Error('expected an unchanged answer')
    expect(since.group?.key).toBe(full.group?.key)
    expect(since.group?.others.map((other) => other.tableId)).toEqual([tableOf('C2')])

    await record('C2', 'complete', 900)
    const after = await readTableState(world.app, {
      tenantId: world.tenantId,
      tableId: tableOf('C1'),
      since: full.version,
    })
    if (after === null || !after.unchanged) throw new Error('expected an unchanged answer')
    expect(after.group?.key).not.toBe(full.group?.key)
  })

  it("gives a phone the group's bill through the guest API, and asks fresh readings of the other members", async () => {
    forgetGuestCodes()
    await seated(['C1', 'C2'])
    await record('C1', 'complete', 1_000)
    await record('C2', 'complete', 700)
    const code = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableOf('C1'), code, await hashTableCode(code)],
    )
    // The other member was read a minute ago in its sitting: a phone looking at the bill asks it
    // to be read again.
    await world.owner.query(
      `update restro.sittings set opened_at = now() - interval '5 minutes'
        where table_id = $1 and ended_at is null`,
      [tableOf('C2')],
    )
    await world.owner.query(
      `update restro.bill_readings set read_at = now() - interval '1 minute' where table_id = $1`,
      [tableOf('C2')],
    )
    const queued: string[] = []
    const read = await guestState(world.app, {
      code,
      view: 'bill',
      limiter: new GuestLimiter(LOOSE),
      queueReading: async (target) => {
        queued.push(target.tableId)
      },
    })
    if (!read.ok || read.answer.unchanged) throw new Error('expected a full state')
    expect(read.answer.groupKey).toBeGreaterThan(0)
    expect(read.answer.bill?.owedMinor).toBe(1_000)
    expect(read.answer.group).toMatchObject({ complete: true, owedMinor: 1_700 })
    expect(read.answer.group?.tables.map((table) => table.own).sort()).toEqual([false, true])
    expect(JSON.stringify(read.answer)).not.toContain('B-C2')
    expect(queued).toContain(tableOf('C2'))
  })

  it("gives a phone the group's bill before its own table's bill is read", async () => {
    forgetGuestCodes()
    await seated(['C1', 'C2'])
    await record('C2', 'complete', 700)
    const code = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableOf('C1'), code, await hashTableCode(code)],
    )
    const read = await guestState(world.app, {
      code,
      view: 'bill',
      limiter: new GuestLimiter(LOOSE),
    })
    if (!read.ok || read.answer.unchanged) throw new Error('expected a full state')
    expect(read.answer.bill).toBeNull()
    expect(read.answer.group).toMatchObject({ complete: false, owedMinor: 700 })
    const tables = read.answer.group?.tables ?? []
    expect(tables.find((table) => table.own)).toMatchObject({ complete: false, owedMinor: 0 })
    expect(tables.find((table) => !table.own)).toMatchObject({ complete: true, owedMinor: 700 })
  })
})
