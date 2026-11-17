// The door's counts at the night's close (#408; D144 §3) on a real Postgres, as the restro_app role:
// a night of two bookings (one seated, one no-show), a walk-in that was seated, a cancelled one, a
// party not seated and a block is written into `service_days.totals` by D144's definitions, and a
// repeated close writes nothing again. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceContext } from './context'
import { applyService } from './index'
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

describe.skipIf(!hasDatabase)('the door’s counts at the close (as the restro_app role)', () => {
  let world: ServiceWorld
  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `service-day-test-${randomUUID()}`,
  })
  const close = async () =>
    (await applyService(world.app, { type: 'service_day.close', serviceDate: NIGHT }, worker()))
      .result

  async function add(kind: string, status: string, size: number | null, deleted = false) {
    await world.owner.query(
      `insert into restro.reservations
         (id, tenant_id, venue_id, service_date, starts_at, kind, status, party_size, party_label,
          seated_at, ended_at, deleted_at, source, actor, job_id)
       values ($1, $2, $3, $4, '2026-01-12T20:00:00Z', $5, $6, $7, $8,
               case when $6 in ('seated', 'finished') then '2026-01-12T20:10:00Z'::timestamptz end,
               case when $6 in ('finished', 'no_show', 'cancelled', 'not_seated')
                    then '2026-01-12T23:00:00Z'::timestamptz end,
               case when $9 then now() end, 'staff', 'system', 'test-seed')`,
      [
        `rv_${randomUUID().replaceAll('-', '')}`,
        world.tenantId,
        world.venueId,
        NIGHT,
        kind,
        status,
        size,
        kind === 'block' ? null : 'Party',
        deleted,
      ],
    )
  }

  beforeAll(async () => {
    world = await openServiceWorld('door-counts')
    await add('booking', 'finished', 4)
    await add('booking', 'no_show', 6)
    await add('booking', 'cancelled', 2)
    await add('walk_in', 'finished', 3)
    await add('walk_in', 'not_seated', 5)
    await add('block', 'reserved', null)
    // Taken out of the book: not counted.
    await add('booking', 'no_show', 9, true)
  })
  afterAll(async () => {
    await world?.close()
  })

  it('writes them into the night’s totals at the close, once', async () => {
    expect(await close()).toMatchObject({ status: 'accepted', details: { changed: true } })
    const read = async () =>
      (
        await world.owner.query<{ totals: Record<string, number> }>(
          'select totals from restro.service_days where venue_id = $1 and service_date = $2',
          [world.venueId, NIGHT],
        )
      ).rows[0]?.totals
    const totals = await read()
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

    // A repeat changes nothing, and a later edit of the rows does not move a written night.
    await world.owner.query(
      `update restro.reservations set status = 'finished' where status = 'no_show'`,
    )
    expect(await close()).toMatchObject({ status: 'accepted', details: { changed: false } })
    expect(await read()).toEqual(totals)
  })
})
