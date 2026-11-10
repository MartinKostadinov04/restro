// The night's end (#332; D138) on a real Postgres, as the restro_app role: an admin's early end with
// bills still open and a card still held, the closing hour's tick after it, one reservation put
// back and its Undo, and the sweep once the night has passed. Skipped without a database.
//
// The three moments stay apart here as in the code: `night.end` (and the closing hour) is the
// night's end; `reservation_night.sweep` is a night that has passed; `reservation.put_back` is one
// reservation, one admin.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { type Id, newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS, type ServiceHours } from '../ordering-settings'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import type { ServiceActor, ServiceContext } from './context'
import type { ServiceCommand } from './index'
import { readNightEndPreview } from './night-end'
import { readBookingChecks } from './reservations/booking-checks'

// Friday nights: open 22:00, last orders 04:30, closes 05:30 (Sofia, summer time, service day 07:00).
const HOURS: ServiceHours = {
  ...DEFAULT_ORDERING_SETTINGS.serviceHours,
  fri: { opens: '22:00', lastOrders: '04:30', closes: '05:30' },
}
/** Friday 23 October 2026's night. */
const NIGHT = '2026-10-23'
/** 02:00 in Sofia: before the 05:30 closing, so ending the night now is ending it early. */
const EARLY = new Date('2026-10-23T23:00:00Z')
/** 05:31 in Sofia: the closing hour's tick. */
const AFTER_CLOSING = new Date('2026-10-24T02:31:00Z')
/** Sunday morning: the service day of Friday's night has long ended (D45). */
const PASSED = new Date('2026-10-25T12:00:00Z')

describe.skipIf(!hasDatabase)('the night’s end (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let hostessId: string

  const staff = (userId: string, now: Date): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt: now,
    now,
  })
  const worker = (now: Date): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `jb-${randomUUID()}`,
    now,
  })
  const run = async (command: ServiceCommand, context: ServiceContext) =>
    (await applyService(world.app, command, context)).result
  const accept = async (command: ServiceCommand, context: ServiceContext) => {
    const result = await run(command, context)
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }
  const statusOf = async (id: string) =>
    (
      await world.owner.query<{ status: string }>(
        'select status from restro.reservations where id = $1',
        [id],
      )
    ).rows[0]?.status
  const logCount = async (kind: string) =>
    Number(
      (
        await world.owner.query<{ n: string }>(
          'select count(*) as n from restro.log_entries where venue_id = $1 and kind = $2',
          [world.venueId, kind],
        )
      ).rows[0]?.n,
    )
  const sittingEnd = async (id: string) =>
    (
      await world.owner.query<{ ended_at: Date | null; end_reason: string | null }>(
        'select ended_at, end_reason from restro.sittings where id = $1',
        [id],
      )
    ).rows[0]
  /** A card payment held on the table, not settled: the night's end must wait for it. */
  const holdCard = async (tableId: string, sittingId: string) =>
    world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          action_id, amount_minor, tip_minor, currency, provider_kind, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'held', $7, $8, 1200, 0, 'EUR',
               'sim', 'guest', 'guest', 'test-seed')`,
      [
        `py_${randomUUID().replaceAll('-', '')}`,
        world.tenantId,
        world.venueId,
        tableId,
        sittingId,
        NIGHT,
        createHash('sha256').update(randomUUID()).digest('hex'),
        randomUUID(),
      ],
    )

  beforeAll(async () => {
    world = await openServiceWorld('night-end')
    ownerId = await world.addUser('owner')
    hostessId = await world.addUser('member')
    await world.addStaff(['reservations.tonight'], hostessId)
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, serviceHours: HOURS })],
    )
    await accept(
      { type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand,
      staff(ownerId, EARLY),
    )
  })
  afterAll(async () => {
    await world?.close()
  })

  it('ends the night early once, keeping the held card, and puts one reservation back', async () => {
    const owner = () => staff(ownerId, EARLY)
    const booked = (
      await accept(
        {
          type: 'reservation.create',
          serviceDate: NIGHT,
          startsAt: '2026-10-23T20:00:00.000Z',
          kind: 'booking',
          status: 'reserved',
          partySize: 4,
          partyLabel: 'Never came',
          phone: '+359881234567',
        } as ServiceCommand,
        owner(),
      )
    ).reservationId as Id<'rv'>
    const waiting = (
      await accept(
        { type: 'waiting.add', serviceDate: NIGHT, partySize: 2, partyLabel: 'At the door' },
        owner(),
      )
    ).reservationId as Id<'rv'>
    const [withBill, paying, empty] = [
      await world.openSitting(world.tables[0] as string, NIGHT),
      await world.openSitting(world.tables[1] as string, NIGHT),
      await world.openSitting(world.tables[2] as string, NIGHT),
    ]
    await world.owner.query('update restro.sittings set had_bill_lines = true where id = any($1)', [
      [withBill, paying],
    ])
    await holdCard(world.tables[1] as string, paying as string)
    // The first of the tables that close carries a guard pause: ending its sitting lifts the pause,
    // and the next table's bill reading must already be held by then (the lock order, #332).
    const firstClosing = [world.tables[0], world.tables[2]].map(String).sort()[0] as string
    await world.owner.query(
      `insert into restro.pauses
         (id, tenant_id, venue_id, service_date, scope, target_id, cause, restro_started, details,
          source, actor, job_id)
       values ($1, $2, $3, $4, 'table', $5, 'guard_tripped', true, '{}'::jsonb, 'restro', 'system', 'test-seed')`,
      [newId('pa'), world.tenantId, world.venueId, NIGHT, firstClosing],
    )

    // The preview, read before she confirms: what will change, and the bills still open.
    const preview = await readNightEndPreview(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
      now: EARLY,
    })
    expect(preview).toMatchObject({
      ok: true,
      preview: {
        serviceDate: NIGHT,
        ended: false,
        finished: 0,
        noShow: 1,
        notSeated: 1,
        codesClose: 2,
        codesKept: 1,
        openBills: 2,
        early: true,
        closesAt: '2026-10-24T02:30:00.000Z',
      },
    })
    // A hostess who may not end the night is refused, by the read and by the write.
    expect(
      await readNightEndPreview(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: { kind: 'user', userId: hostessId, sessionId: `sess-${randomUUID()}` },
        now: EARLY,
      }),
    ).toMatchObject({ ok: false, code: 'permission_denied' })
    expect(await run({ type: 'night.end' }, staff(hostessId, EARLY))).toMatchObject({
      status: 'refused',
      code: 'permission_denied',
    })

    expect(await accept({ type: 'night.end' }, owner())).toMatchObject({
      changed: true,
      serviceDate: NIGHT,
      finished: 0,
      noShow: 1,
      notSeated: 1,
      closed: 2,
      kept: 1,
      openBills: 2,
    })
    expect(await statusOf(booked)).toBe('no_show')
    expect(await statusOf(waiting)).toBe('not_seated')
    expect(await sittingEnd(withBill as string)).toMatchObject({ end_reason: 'staff_closed' })
    expect(await sittingEnd(empty as string)).toMatchObject({ end_reason: 'staff_closed' })
    // The closed table's pause is lifted with its sitting.
    expect(
      (
        await world.owner.query<{ lifted_at: Date | null }>(
          'select lifted_at from restro.pauses where target_id = $1',
          [firstClosing],
        )
      ).rows[0]?.lifted_at,
    ).not.toBeNull()
    // The held card keeps its table's code: nothing about a payment is touched.
    expect((await sittingEnd(paying as string))?.ended_at).toBeNull()
    const record = (
      await world.owner.query<{
        closed_at: Date | null
        closed_by: string | null
        closed_early: boolean
        open_bills_at_close: number | null
      }>(
        `select closed_at, closed_by, closed_early, open_bills_at_close from restro.reservation_nights
          where venue_id = $1 and service_date = $2`,
        [world.venueId, NIGHT],
      )
    ).rows[0]
    expect(record).toMatchObject({ closed_early: true, open_bills_at_close: 2 })
    expect(record?.closed_by).toBe(`user:${ownerId}`)

    // The night's end runs once: a second tap and the closing hour's tick change nothing more.
    expect(await accept({ type: 'night.end' }, owner())).toMatchObject({ changed: false })
    expect(
      await accept({ type: 'hours.close_tables' } as ServiceCommand, worker(AFTER_CLOSING)),
    ).toMatchObject({ closed: 0 })
    expect(await logCount('night.closed')).toBe(1)
    expect((await sittingEnd(paying as string))?.ended_at).toBeNull()

    // A booking on the ended night is taken, and the form is told the night is closed.
    const checks = await readBookingChecks(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
      now: EARLY,
      day: NIGHT,
      startsAt: new Date('2026-10-23T23:30:00Z'),
      endsAt: null,
      partySize: 2,
      name: null,
      phone: null,
      spotIds: [],
    })
    expect(checks).toMatchObject({ ok: true, checks: { nightEnded: true } })

    // Putting one back is the admin's, not the hostess's: the night's end marked it.
    expect(
      await run({ type: 'reservation.put_back', reservationId: booked }, staff(hostessId, EARLY)),
    ).toMatchObject({ status: 'refused', code: 'permission_denied' })
    expect(
      await accept({ type: 'reservation.put_back', reservationId: booked }, owner()),
    ).toMatchObject({ status: 'reserved' })
    expect(await statusOf(booked)).toBe('reserved')
    // Nothing else moved: there is no bulk undo.
    expect(await statusOf(waiting)).toBe('not_seated')
    // Its Undo returns it to the night's end's status, read from the Log.
    expect(
      await accept({ type: 'reservation.undo_put_back', reservationId: booked }, owner()),
    ).toMatchObject({ status: 'no_show' })
    expect(
      await run({ type: 'reservation.undo_put_back', reservationId: booked }, owner()),
    ).toMatchObject({ status: 'refused', code: 'undo_put_back_not_allowed' })
    await accept({ type: 'reservation.put_back', reservationId: booked }, owner())
    const moves = (
      await world.owner.query<{ reason: string | null; to_state: string | null }>(
        `select reason, to_state from restro.log_entries
          where reservation_id = $1 and kind = 'reservation.status' order by seq`,
        [booked],
      )
    ).rows
    expect(moves.map((row) => row.reason)).toEqual([
      'night_ended',
      'put_back',
      'put_back_undone',
      'put_back',
    ])

    // Once the night has passed, the sweep finishes what was left — once.
    expect(
      await accept({ type: 'reservation_night.sweep', serviceDate: NIGHT }, worker(PASSED)),
    ).toMatchObject({ changed: true, noShow: 1, finished: 0, notSeated: 0 })
    expect(
      await accept({ type: 'reservation_night.sweep', serviceDate: NIGHT }, worker(PASSED)),
    ).toMatchObject({ changed: false })
    expect(await statusOf(booked)).toBe('no_show')
    expect(await logCount('night.swept')).toBe(1)
    // A night still going is never the passed sweep's.
    expect(
      await accept({ type: 'reservation_night.sweep', serviceDate: NIGHT }, worker(EARLY)),
    ).toMatchObject({ changed: false })
  })
})
