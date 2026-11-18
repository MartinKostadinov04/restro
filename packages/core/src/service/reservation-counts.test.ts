// The door's counts at the night's close (#408; D144 §3) on a real Postgres, as the restro_app role:
// a night of bookings, walk-ins, a cancelled one, a party not seated and a block is written into
// `service_days.totals` by D144's definitions, a repeated close writes nothing again, a closed night
// whose reservations are changed later is written whole again (D144), and the end of the night's
// reservation group follows its display rules. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceContext } from './context'
import { applyService } from './index'
import { readNight } from './night-read'
import { noShowRatePercent, storedReservationCounts } from './reservation-counts'

const NIGHT = '2026-01-12'

describe('the no-show rate (D144)', () => {
  const counts = {
    resBookings: 0,
    resWalkIns: 0,
    resArrived: 0,
    resBookingsArrived: 0,
    resNoShows: 0,
    resCancelled: 0,
    resNotSeated: 0,
    resCoversBooked: 0,
    resCoversSeated: 0,
  }
  it('counts reservations, leaves walk-ins out of both sides and says nothing without a divisor', () => {
    expect(noShowRatePercent(counts)).toBeNull()
    expect(
      noShowRatePercent({ ...counts, resNoShows: 1, resBookingsArrived: 3, resArrived: 9 }),
    ).toBe(25)
  })
  it('reads the written counts only when all of them are there', () => {
    expect(storedReservationCounts({ sittings: 3 })).toBeNull()
    expect(storedReservationCounts(counts)).toEqual(counts)
  })
})

/** A reservation row seeded straight into a world; returns its id. */
async function seedReservation(
  world: ServiceWorld,
  night: string,
  kind: string,
  status: string,
  size: number | null,
  deleted = false,
): Promise<string> {
  const id = `rv_${randomUUID().replaceAll('-', '')}`
  await world.owner.query(
    `insert into restro.reservations
       (id, tenant_id, venue_id, service_date, starts_at, kind, status, party_size, party_label,
        seated_at, ended_at, deleted_at, source, actor, job_id)
     values ($1, $2, $3, $4, ($4::date + time '20:00') at time zone 'UTC', $5, $6, $7, $8,
             case when $6 in ('seated', 'finished')
                  then ($4::date + time '20:10') at time zone 'UTC' end,
             case when $6 in ('finished', 'no_show', 'cancelled', 'not_seated')
                  then ($4::date + time '23:00') at time zone 'UTC' end,
             case when $9 then now() end, 'staff', 'system', 'test-seed')`,
    [
      id,
      world.tenantId,
      world.venueId,
      night,
      kind,
      status,
      size,
      kind === 'block' ? null : 'Party',
      deleted,
    ],
  )
  return id
}

async function seedSettings(world: ServiceWorld, editPastNights: boolean) {
  await world.owner.query(
    `insert into restro.reservation_settings
       (tenant_id, venue_id, turn_minutes, edit_past_nights, source, actor, job_id)
     values ($1, $2, 90, $3, 'staff', 'system', 'test-seed')
     on conflict (tenant_id, venue_id) do update set edit_past_nights = excluded.edit_past_nights`,
    [world.tenantId, world.venueId, editPastNights],
  )
}

describe.skipIf(!hasDatabase)('the door’s counts at the close (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `service-day-test-${randomUUID()}`,
  })
  const staff = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })
  const close = async () =>
    (await applyService(world.app, { type: 'service_day.close', serviceDate: NIGHT }, worker()))
      .result
  const readTotals = async () =>
    (
      await world.owner.query<{ totals: Record<string, number> }>(
        'select totals from restro.service_days where venue_id = $1 and service_date = $2',
        [world.venueId, NIGHT],
      )
    ).rows[0]?.totals

  const ids: Record<string, string> = {}

  beforeAll(async () => {
    world = await openServiceWorld('door-counts')
    ownerId = await world.addUser('owner')
    ids.finishedBooking = await seedReservation(world, NIGHT, 'booking', 'finished', 4)
    ids.noShow = await seedReservation(world, NIGHT, 'booking', 'no_show', 6)
    ids.cancelled = await seedReservation(world, NIGHT, 'booking', 'cancelled', 2)
    await seedReservation(world, NIGHT, 'walk_in', 'finished', 3)
    await seedReservation(world, NIGHT, 'walk_in', 'not_seated', 5)
    await seedReservation(world, NIGHT, 'block', 'reserved', null)
    // Taken out of the book: not counted.
    await seedReservation(world, NIGHT, 'booking', 'no_show', 9, true)
  })
  afterAll(async () => {
    await world?.close()
  })

  it('refuses the close while a party of the night is still Reserved, Waiting or Seated', async () => {
    const open = await seedReservation(world, NIGHT, 'booking', 'seated', 2)
    expect(await close()).toMatchObject({ status: 'refused', code: 'reservations_open' })
    expect(await readTotals()).toBeUndefined()
    // The sweep (or a hostess) finishes it; the next try closes. A block is not a party.
    await world.owner.query(`update restro.reservations set status = 'finished' where id = $1`, [
      open,
    ])
    await world.owner.query(`delete from restro.reservations where id = $1`, [open])
  })

  it('writes them into the night’s totals at the close, once', async () => {
    expect(await close()).toMatchObject({ status: 'accepted', details: { changed: true } })
    const totals = await readTotals()
    expect(totals).toMatchObject({
      resBookings: 3,
      resWalkIns: 2,
      resArrived: 2,
      resBookingsArrived: 1,
      resNoShows: 1,
      resCancelled: 1,
      resNotSeated: 1,
      resCoversBooked: 12,
      resCoversSeated: 7,
    })
    // 1 no-show of (1 no-show + 1 booking that arrived); the walk-in and the Not seated are out.
    expect(noShowRatePercent(storedReservationCounts(totals ?? {}) as never)).toBe(50)
    // A repeat of the close changes nothing.
    expect(await close()).toMatchObject({ status: 'accepted', details: { changed: false } })
    expect(await readTotals()).toEqual(totals)
  })

  it('re-rolls a closed night whole when a reservation of it is changed later (D144)', async () => {
    await seedSettings(world, true)
    const before = await readTotals()
    // A stand-in for the night's other numbers: a re-roll leaves every non-`res` key alone.
    await world.owner.query(
      `update restro.service_days
          set totals = totals || '{"sittings": 11, "addedMinor": 4200}'::jsonb
        where venue_id = $1 and service_date = $2`,
      [world.venueId, NIGHT],
    )
    const others = { sittings: 11, addedMinor: 4200 }

    // The manager puts the no-show back: No-shows falls to 0 and Reserved counts nowhere.
    expect(
      (
        await applyService(
          world.app,
          { type: 'reservation.put_back', reservationId: ids.noShow as never },
          staff(),
        )
      ).result,
    ).toMatchObject({ status: 'accepted' })
    expect(await readTotals()).toMatchObject({ ...others, resNoShows: 0, resBookings: 3 })

    // The cancelled booking is taken out of the book: bookings, cancelled and covers booked move.
    expect(
      (
        await applyService(
          world.app,
          { type: 'reservation.delete', reservationId: ids.cancelled as never },
          staff(),
        )
      ).result,
    ).toMatchObject({ status: 'accepted' })
    const after = await readTotals()
    expect(after).toMatchObject({
      ...others,
      resBookings: 2,
      resCancelled: 0,
      resNoShows: 0,
      resCoversBooked: 10,
      resArrived: 2,
      resCoversSeated: 7,
    })
    // Before the edits the night said otherwise; the same keys are there after, none dropped.
    expect(before).toMatchObject({ resBookings: 3, resNoShows: 1, resCancelled: 1 })
    expect(Object.keys(after ?? {}).sort()).toEqual(
      [...new Set([...Object.keys(before ?? {}), ...Object.keys(others)])].sort(),
    )

    // The page of that night reads the re-rolled counts.
    const read = await readNight(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
      day: NIGHT,
    })
    if (!read.ok) throw new Error(read.code)
    expect(read.night.reservations).toMatchObject({ resBookings: 2, resNoShows: 0 })
  })
})

describe.skipIf(!hasDatabase)('the door on the end of the night (as the restro_app role)', () => {
  let world: ServiceWorld
  let viewer: string
  const OPEN_NIGHT = '2026-01-14'
  const read = async (day: string) => {
    const result = await readNight(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: { kind: 'user', userId: viewer, sessionId: `sess-${randomUUID()}` },
      day,
    })
    if (!result.ok) throw new Error(result.code)
    return result.night
  }

  beforeAll(async () => {
    world = await openServiceWorld('door-read')
    // A role with `night.view` and nothing of the money.
    viewer = await world.addUser('member')
    await world.addStaff(['night.view'], viewer)
  })
  afterAll(async () => {
    await world?.close()
  })

  it('hides the group where the venue works no reservations', async () => {
    expect((await read(OPEN_NIGHT)).reservations).toBeNull()
  })

  it('shows zeros once reservations are on, with no bookings and no rate', async () => {
    await seedSettings(world, false)
    expect((await read(OPEN_NIGHT)).reservations).toEqual({
      resBookings: 0,
      resWalkIns: 0,
      resArrived: 0,
      resBookingsArrived: 0,
      resNoShows: 0,
      resCancelled: 0,
      resNotSeated: 0,
      resCoversBooked: 0,
      resCoversSeated: 0,
      noShowRate: null,
    })
  })

  it('counts the rows live while the night is open, for a role with night.view alone and no money', async () => {
    await seedReservation(world, OPEN_NIGHT, 'booking', 'seated', 4)
    await seedReservation(world, OPEN_NIGHT, 'booking', 'no_show', 2)
    await seedReservation(world, OPEN_NIGHT, 'walk_in', 'waiting', 3)
    const night = await read(OPEN_NIGHT)
    expect(night.closedAt).toBeNull()
    expect(night.reservations).toMatchObject({
      resBookings: 2,
      resWalkIns: 1,
      resArrived: 1,
      resNoShows: 1,
      resCoversBooked: 6,
      resCoversSeated: 4,
      noShowRate: 50,
    })
    expect(night.full).toBe(false)
    expect(night.money).toBeNull()
  })
})
