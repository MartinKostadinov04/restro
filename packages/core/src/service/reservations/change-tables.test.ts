// Change tables on a real Postgres (ticket #331): adding a spot, taking one back, moving a party
// and swapping two, each through `applyService`, with the codes checked after each. What only a
// database can show is pinned here: that the tables a sitting party leaves are closed and the ones
// it comes to are opened through the door's own paths, that a swap is one write on a full floor,
// that a bill left behind is said and logged and never moved, and that a refusal leaves both
// parties exactly as they were.
//
// Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import type { Id } from '../../ids'
import { serviceDate as serviceDateOf } from '../../service-day'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceActor, ServiceContext } from '../context'
import type { ServiceCommand } from '../index'

const TURN = 90

describe.skipIf(!hasDatabase)('changing tables (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let planId: string
  let today: string
  /** The spots of the plan, each one its own Table: `C1` is `world.tables[0]`, and so on. */
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

  const run = async (command: ServiceCommand) =>
    (await applyService(world.app, command, staff())).result

  async function accept(command: ServiceCommand): Promise<Record<string, unknown>> {
    const result = await run(command)
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }

  const spotId = (name: string) => spots.get(name) as Id<'sp'>
  const ids = (...names: string[]) => names.map(spotId)
  const tableOf = (name: string) => world.tables[Number(name.slice(1)) - 1] as Id<'tb'>

  const openSittingOf = async (name: string) =>
    (
      await world.owner.query<{ id: string }>(
        'select id from restro.sittings where table_id = $1 and ended_at is null',
        [tableOf(name)],
      )
    ).rows[0]?.id ?? null

  const heldBy = async (reservationId: string) =>
    (
      await world.owner.query<{ spot_id: string }>(
        `select spot_id from restro.reservation_spots
          where reservation_id = $1 and released_at is null order by spot_id`,
        [reservationId],
      )
    ).rows
      .map((row) => row.spot_id)
      .sort()

  const lastSpotsLine = async (reservationId: string) =>
    (
      await world.owner.query<{ to_state: string; details: Record<string, unknown> }>(
        `select to_state, details from restro.log_entries
          where reservation_id = $1 and kind = 'reservation.spots' order by seq desc limit 1`,
        [reservationId],
      )
    ).rows[0]

  const book = async (names: readonly string[]): Promise<Id<'rv'>> =>
    (
      await accept({
        type: 'reservation.create',
        serviceDate: today,
        startsAt: new Date().toISOString(),
        kind: 'booking',
        status: 'reserved',
        partySize: 4,
        partyLabel: `Party ${randomUUID().slice(0, 6)}`,
        phone: `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
        spotIds: ids(...names),
      } as ServiceCommand)
    ).reservationId as Id<'rv'>

  /** A party booked on these spots and marked present: its tables are open for phones. */
  const seated = async (names: readonly string[]): Promise<Id<'rv'>> => {
    const id = await book(names)
    await accept({ type: 'reservation.arrive', reservationId: id })
    return id
  }

  const change = (
    reservationId: string,
    from: readonly string[],
    to: readonly string[],
    more: Partial<{ swap: unknown; sameGuests: boolean }> = {},
  ) =>
    ({
      type: 'reservation.change_tables',
      reservationId,
      from: ids(...from),
      spotIds: ids(...to),
      ...more,
    }) as ServiceCommand

  beforeAll(async () => {
    world = await openServiceWorld('change-tables')
    ownerId = await world.addUser('owner')
    const venue = (
      await world.owner.query<{ timezone: string; ends_at: string }>(
        'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
        [world.venueId],
      )
    ).rows[0]
    today = serviceDateOf(new Date(), venue?.timezone ?? 'UTC', venue?.ends_at ?? '07:00:00')
    await accept({ type: 'reservation_settings.set', turnMinutes: TURN } as ServiceCommand)
    planId = (await accept({ type: 'plan.save', name: 'Floor', makeCurrent: true }))
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

  it('adds a spot: its code opens, and the table the party kept keeps its sitting', async () => {
    const id = await seated(['C1'])
    const kept = await openSittingOf('C1')
    expect(await openSittingOf('C2')).toBeNull()
    expect(await accept(change(id, ['C1'], ['C1', 'C2']))).toMatchObject({
      changed: true,
      opened: tableOf('C2'),
      closed: '',
      billLeft: '',
    })
    expect(await heldBy(id)).toEqual(ids('C1', 'C2').sort())
    expect(await openSittingOf('C1')).toBe(kept)
    expect(await openSittingOf('C2')).not.toBeNull()
  })

  it('takes a spot back: its code closes, and the other table is left alone', async () => {
    const id = await seated(['C1', 'C2'])
    const kept = await openSittingOf('C1')
    expect(await accept(change(id, ['C1', 'C2'], ['C1']))).toMatchObject({
      closed: tableOf('C2'),
      opened: '',
    })
    expect(await heldBy(id)).toEqual(ids('C1'))
    expect(await openSittingOf('C1')).toBe(kept)
    expect(await openSittingOf('C2')).toBeNull()
  })

  it('moves a party: the old code closes, the new one opens, and an open bill is said and logged, never moved', async () => {
    const id = await seated(['C1'])
    const sittingId = await openSittingOf('C1')
    if (sittingId === null) throw new Error('the table did not open')
    await world.addSentOrder({
      tableId: tableOf('C1'),
      sittingId,
      actionId: randomUUID(),
      reference: randomUUID().slice(0, 6).toUpperCase(),
      serviceDate: today,
    })
    expect(await accept(change(id, ['C1'], ['C3']))).toMatchObject({
      closed: tableOf('C1'),
      opened: tableOf('C3'),
      billLeft: tableOf('C1'),
    })
    expect(await heldBy(id)).toEqual(ids('C3'))
    expect(await openSittingOf('C1')).toBeNull()
    expect(await openSittingOf('C3')).not.toBeNull()
    // The Log keeps that the party changed tables while a bill was open on the one it left.
    expect(await lastSpotsLine(id)).toMatchObject({
      to_state: 'moved_bill',
      details: { billLeft: tableOf('C1'), removed: spotId('C1'), added: spotId('C3') },
    })
  })

  it('moves a party with no bill as a plain move', async () => {
    const id = await seated(['C1'])
    expect(await accept(change(id, ['C1'], ['C2']))).toMatchObject({ billLeft: '' })
    expect(await lastSpotsLine(id)).toMatchObject({ to_state: 'moved' })
  })

  it('swaps two sitting parties in one write on a full floor, and all four codes follow', async () => {
    const a = await seated(['C1'])
    const b = await seated(['C2'])
    const c = await seated(['C3'])
    const d = await seated(['C4'])
    const wasA = await openSittingOf('C1')
    const wasB = await openSittingOf('C2')
    const details = await accept(
      change(a, ['C1'], ['C2'], {
        swap: { reservationId: b, from: ids('C2'), spotIds: ids('C1') },
      }),
    )
    expect(details).toMatchObject({ swapWith: b, closed: `${tableOf('C1')},${tableOf('C2')}` })
    expect(await heldBy(a)).toEqual(ids('C2'))
    expect(await heldBy(b)).toEqual(ids('C1'))
    // Each table was closed for the party that left and opened afresh for the one that came.
    const nowA = await openSittingOf('C2')
    const nowB = await openSittingOf('C1')
    expect(nowA).not.toBeNull()
    expect(nowB).not.toBeNull()
    expect(nowA).not.toBe(wasB)
    expect(nowB).not.toBe(wasA)
    // The rest of the floor did not move.
    expect(await heldBy(c)).toEqual(ids('C3'))
    expect(await heldBy(d)).toEqual(ids('C4'))
  })

  it('swaps a sitting party with one still expected: only the sitting party moves codes', async () => {
    const a = await seated(['C1'])
    const b = await book(['C2'])
    await accept(
      change(a, ['C1'], ['C2'], {
        swap: { reservationId: b, from: ids('C2'), spotIds: ids('C1') },
      }),
    )
    expect(await heldBy(a)).toEqual(ids('C2'))
    expect(await heldBy(b)).toEqual(ids('C1'))
    expect(await openSittingOf('C2')).not.toBeNull()
    // The party still expected opens its codes when it arrives, as every party does.
    expect(await openSittingOf('C1')).toBeNull()
  })

  it('moves a party still expected without touching any code', async () => {
    const id = await book(['C1'])
    expect(await accept(change(id, ['C1'], ['C2']))).toMatchObject({ opened: '', closed: '' })
    expect(await heldBy(id)).toEqual(ids('C2'))
    expect(await openSittingOf('C1')).toBeNull()
    expect(await openSittingOf('C2')).toBeNull()
  })

  it('refuses a spot another party holds by its name, and leaves the party as it was', async () => {
    const id = await seated(['C1'])
    const was = await openSittingOf('C1')
    const other = await book(['C4'])
    expect(await run(change(id, ['C1'], ['C4']))).toMatchObject({
      status: 'refused',
      code: 'spot_taken',
      details: { spotId: spotId('C4'), reservationId: other },
    })
    // Never half-moved: the codes it had are open, the ones it asked for are shut.
    expect(await heldBy(id)).toEqual(ids('C1'))
    expect(await openSittingOf('C1')).toBe(was)
    expect(await openSittingOf('C4')).toBeNull()
  })

  it('asks the same-guests question for a table already open, as the arrival does', async () => {
    const id = await seated(['C1'])
    await accept({ type: 'table.open', tableId: tableOf('C2') })
    expect(await run(change(id, ['C1'], ['C2']))).toMatchObject({
      status: 'refused',
      code: 'same_guests_unanswered',
    })
    expect(await openSittingOf('C1')).not.toBeNull()
    expect(await accept(change(id, ['C1'], ['C2'], { sameGuests: false }))).toMatchObject({
      renewed: tableOf('C2'),
      closed: tableOf('C1'),
    })
  })

  it('refuses a save drawn over spots that changed meanwhile, and answers a repeat as done', async () => {
    const id = await book(['C1'])
    await accept(change(id, ['C1'], ['C2']))
    // The same save again: the party is already where it was to go.
    expect(await accept(change(id, ['C1'], ['C2']))).toMatchObject({ changed: false })
    // A save from a screen that still shows the party on C1, asking for C3: refused, unchanged.
    expect(await run(change(id, ['C1'], ['C3']))).toMatchObject({
      status: 'refused',
      code: 'spots_changed',
    })
    expect(await heldBy(id)).toEqual(ids('C2'))
  })
})
