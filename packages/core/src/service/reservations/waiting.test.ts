// The waiting list on a real Postgres (ticket #330; D137, D138). What is pinned here is what only
// a database can show, and it is the four things the queue is:
//
// 1. **It is an order, not an hour.** The parties come back in the queue key's order, and a party
//    the hostess moves up the queue stays where she put it — which an order by hour would quietly
//    undo. The night's list and the floor plan read the same queue, so the two can never offer it
//    in two different orders.
// 2. **Giving a spot is the arrival of #329 and nothing new.** `reservation.arrive` with spots on a
//    waiting party seats it, clears its place in the queue and opens its Table's codes through the
//    one open path. There is no second way in and no "Arrived" left to tap afterwards.
// 3. **Leaving the queue is the ordinary operation.** A cancelled party drops out of the queue and
//    stays on the night in its own state, with no place in the queue left behind it.
// 4. **A booking is never waiting.** The one path that creates a reservation refuses it, and the
//    column's own check would refuse it under the path — which is what keeps the eighth status of
//    #332's sweep (Not seated) about waiting parties only.
//
// Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import type { Id } from '../../ids'
import { serviceDate as serviceDateOf } from '../../service-day'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceActor, ServiceContext } from '../context'
import type { ServiceCommand } from '../index'
import { readFloorPlan } from './plan-read'
import { readReservationNight } from './read'
import { waitedMinutes } from './waiting-read'

describe('how long a party has waited', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 10, 23, minutes, 0))

  it('counts whole minutes from the moment the party was written down', () => {
    expect(waitedMinutes(at(0), at(0))).toBe(0)
    expect(waitedMinutes(at(0), at(25))).toBe(25)
    // Part of a minute is not a minute yet: "Waiting for 1 min" at 59 seconds would be a lie.
    expect(waitedMinutes(at(0), new Date(at(0).getTime() + 59_000))).toBe(0)
  })

  it('never counts backwards, however the two clocks disagree', () => {
    expect(waitedMinutes(at(30), at(10))).toBe(0)
  })
})

describe.skipIf(!hasDatabase)('the waiting list (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let planId: string
  /** Tonight, as the venue counts a service day (D45). */
  let today: string
  const spots = new Map<string, string>()

  const staff = (userId: string): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })

  const reader = (userId: string) => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
  })

  const run = async (command: ServiceCommand, context: ServiceContext = staff(ownerId)) =>
    (await applyService(world.app, command, context)).result

  async function accept(
    command: ServiceCommand,
    context: ServiceContext = staff(ownerId),
  ): Promise<Record<string, unknown>> {
    const result = await run(command, context)
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }

  const spotId = (name: string) => spots.get(name) as Id<'sp'>
  const tableOf = (name: string) => world.tables[Number(name.slice(1)) - 1] as Id<'tb'>

  /** The open sitting of a table, or null: this is "the table is open for phones". */
  const openSittingOf = async (tableId: string) =>
    (
      await world.owner.query<{ id: string }>(
        'select id from restro.sittings where table_id = $1 and ended_at is null',
        [tableId],
      )
    ).rows[0]?.id ?? null

  const reservationOf = async (id: string) =>
    (
      await world.owner.query<{ status: string; kind: string; queue_key: string | null }>(
        'select status, kind, queue_key from restro.reservations where id = $1',
        [id],
      )
    ).rows[0]

  /** One party onto the night's list, by the one command that writes a waiting line. */
  const wait = async (name: string, partySize = 2): Promise<Id<'rv'>> =>
    (
      await accept({
        type: 'waiting.add',
        serviceDate: today,
        partySize,
        partyLabel: name,
      } as ServiceCommand)
    ).reservationId as Id<'rv'>

  /** The queue as the night's list reads it: the names, oldest first. */
  const queue = async (): Promise<readonly (string | null)[]> => {
    const read = await readReservationNight(world.app, reader(ownerId))
    if (!read.ok) throw new Error(`the night refused: ${read.code}`)
    return read.night.waiting.map((party) => party.name)
  }

  beforeAll(async () => {
    world = await openServiceWorld('waiting')
    ownerId = await world.addUser('owner')
    const venue = (
      await world.owner.query<{ timezone: string; ends_at: string }>(
        'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
        [world.venueId],
      )
    ).rows[0]
    today = serviceDateOf(new Date(), venue?.timezone ?? 'UTC', venue?.ends_at ?? '07:00:00')
    await accept({ type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand)
    planId = (await accept({ type: 'plan.save', name: 'Floor', makeCurrent: true }))
      .planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    for (const [index, name] of ['D1', 'D2'].entries()) {
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

  it('reads the queue oldest first, and keeps a party where the hostess moved it', async () => {
    const first = await wait('Ivanova')
    const second = await wait('Dimitrov')
    const third = await wait('Petrov')
    expect(await queue()).toEqual(['Ivanova', 'Dimitrov', 'Petrov'])
    // The hour is the same for all three (each waits from the moment it was written down), so an
    // order by hour could put them in any order; the queue key is why this is the order.
    await accept({
      type: 'waiting.reorder',
      reservationId: third,
      beforeId: first,
    } as ServiceCommand)
    expect(await queue()).toEqual(['Petrov', 'Ivanova', 'Dimitrov'])
    // The plan reads the same queue, so a free spot's sheet offers it in the same order.
    const plan = await readFloorPlan(world.app, reader(ownerId))
    expect(plan.ok && plan.plan.waiting.map((party) => party.reservationId)).toEqual([
      third,
      first,
      second,
    ])
    // They are the night's own rows under the Waiting state, not a list of their own (D137).
    const night = await readReservationNight(world.app, reader(ownerId))
    expect(
      night.ok && night.night.rows.filter((row) => row.status === 'waiting').length,
    ).toBeGreaterThanOrEqual(3)
    expect(night.ok && night.night.counts.byStatus.waiting).toBeGreaterThanOrEqual(3)
    for (const id of [first, second, third]) {
      await accept({ type: 'reservation.cancel', reservationId: id } as ServiceCommand)
    }
  })

  it('seats a waiting party on the spot it is given, through the one arrival path', async () => {
    const id = await wait('Kolev', 4)
    expect(await reservationOf(id)).toMatchObject({ status: 'waiting', kind: 'walk_in' })
    expect((await reservationOf(id))?.queue_key).not.toBeNull()
    expect(await openSittingOf(tableOf('D1'))).toBeNull()
    const details = await accept({
      type: 'reservation.arrive',
      reservationId: id,
      spotIds: [spotId('D1')],
    } as ServiceCommand)
    // The same details #329's arrival gives, because it *is* that arrival: one path, one opener.
    expect(details).toMatchObject({ status: 'seated', changed: true, opened: tableOf('D1') })
    expect(await openSittingOf(tableOf('D1'))).not.toBeNull()
    // Seated, and out of the queue: its place in the queue is given up with its waiting.
    expect(await reservationOf(id)).toMatchObject({ status: 'seated', queue_key: null })
    expect(await queue()).not.toContain('Kolev')
    await accept({ type: 'table.close', tableId: tableOf('D1') } as ServiceCommand)
  })

  it('drops a cancelled party out of the queue and leaves it on the night', async () => {
    const id = await wait('Georgiev')
    expect(await queue()).toContain('Georgiev')
    await accept({ type: 'reservation.cancel', reservationId: id } as ServiceCommand)
    expect(await reservationOf(id)).toMatchObject({ status: 'cancelled', queue_key: null })
    expect(await queue()).not.toContain('Georgiev')
    const night = await readReservationNight(world.app, reader(ownerId))
    expect(night.ok && night.night.rows.find((row) => row.id === id)).toMatchObject({
      status: 'cancelled',
    })
  })

  it('refuses to make a booking wait: only a walk-in has a place in the queue', async () => {
    expect(
      await run({
        type: 'reservation.create',
        serviceDate: today,
        startsAt: new Date().toISOString(),
        kind: 'booking',
        status: 'waiting',
        partySize: 2,
        partyLabel: 'Nikolov',
        phone: '+359881234567',
      } as ServiceCommand),
    ).toMatchObject({ status: 'refused', code: 'kind_not_allowed' })
  })
})
