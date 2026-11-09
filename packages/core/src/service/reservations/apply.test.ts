// The reservations on a real Postgres, as the restro_app role (ticket #323; D134 to D141). What is
// pinned here is what only a database can show: that every write goes in through `applyService`
// with its permission and its Log entry, that the overlap rule holds through the real path, that a
// night that has passed or has been closed refuses, that a bill closing changes nothing about a
// party, that erasing a guest is an update which leaves his reservations standing, that the
// worker's sweep is idempotent, and that nothing of another organisation is readable or writable.
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

/** The venue's turn time in these tests: ninety minutes, as a club's would be. */
const TURN = 90

/** An hour of the night as an instant; the service day is the night's own (D45). */
const at = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 10, day, hour, minute, 0)).toISOString()

describe.skipIf(!hasDatabase)('the reservations (as the restro_app role)', () => {
  let world: ServiceWorld
  /** The owner of the organisation: holds every permission (D122 §7). */
  let ownerId: string
  /** A person whose role may work tonight's floor, and nothing else. */
  let hostessId: string
  /** A person whose role holds the booking book but not a night that has passed. */
  let managerId: string
  let planId: string
  /** The venue's service day right now (D45): the night the bill test works on. */
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
  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `job-${randomUUID()}`,
  })

  const run = async (command: ServiceCommand, context: ServiceContext = staff(ownerId)) =>
    (await applyService(world.app, command, context)).result

  /** Runs a command that must be accepted and gives back its details. */
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

  const reservationRows = async (serviceDate?: string) =>
    (
      await world.owner.query<{
        id: string
        status: string
        kind: string
        party_size: number | null
        guest_id: string | null
        queue_key: string | null
        deleted_at: Date | null
        ended_at: Date | null
        service_date: string
      }>(
        `select id, status, kind, party_size, guest_id, queue_key, deleted_at, ended_at,
                to_char(service_date, 'YYYY-MM-DD') as service_date
           from restro.reservations
          where venue_id = $1 ${serviceDate === undefined ? '' : 'and service_date = $2'}
          order by created_at, id`,
        serviceDate === undefined ? [world.venueId] : [world.venueId, serviceDate],
      )
    ).rows

  const reservationOf = async (id: string) => {
    const rows = await reservationRows()
    const row = rows.find((candidate) => candidate.id === id)
    if (row === undefined) throw new Error(`no reservation ${id}`)
    return row
  }

  /** The spots a reservation still holds (a released row is kept, so it is filtered here). */
  const heldSpotsOf = async (reservationId: string) =>
    (
      await world.owner.query<{ spot_id: string; held_to: Date | null; released_at: Date | null }>(
        `select spot_id, held_to, released_at from restro.reservation_spots
          where reservation_id = $1 order by spot_id`,
        [reservationId],
      )
    ).rows

  const logOf = async (kinds: readonly string[]) =>
    (
      await world.owner.query<{
        kind: string
        from_state: string | null
        to_state: string | null
        reason: string | null
        actor: string
        reservation_id: string | null
        guest_id: string | null
        details: Record<string, string>
      }>(
        `select kind, from_state, to_state, reason, actor, reservation_id, guest_id, details
           from restro.log_entries
          where venue_id = $1 and kind = any($2::text[]) order by seq`,
        [world.venueId, [...kinds]],
      )
    ).rows

  const setSettings = (values: Record<string, unknown>) =>
    accept({ type: 'reservation_settings.set', ...values } as ServiceCommand)

  const spotId = (name: string) => spots.get(name) as Id<'sp'>

  /** A booking at `startsAt` on `spotNames`, with a label rather than a person's details. */
  const book = async (
    serviceDate: string,
    startsAt: string,
    spotNames: readonly string[],
    over: Record<string, unknown> = {},
  ) =>
    (
      await accept({
        type: 'reservation.create',
        serviceDate,
        startsAt,
        kind: 'booking',
        status: 'reserved',
        partySize: 4,
        partyLabel: `Party ${randomUUID().slice(0, 6)}`,
        spotIds: spotNames.map(spotId),
        ...over,
      } as ServiceCommand)
    ).reservationId as Id<'rv'>

  beforeAll(async () => {
    world = await openServiceWorld('reservations')
    ownerId = await world.addUser('owner')
    hostessId = await world.addUser('member')
    await world.addStaff(['reservations.tonight'], hostessId)
    managerId = await world.addUser('member')
    await world.addStaff(
      ['reservations.manage', 'reservations.tonight', 'reservations.end_night', 'settings.guests'],
      managerId,
    )
    const venue = (
      await world.owner.query<{ timezone: string; ends_at: string }>(
        'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
        [world.venueId],
      )
    ).rows[0]
    today = serviceDateOf(new Date(), venue?.timezone ?? 'UTC', venue?.ends_at ?? '07:00:00')
    await setSettings({ turnMinutes: TURN, editPastNights: false, privateNotesOn: true })
    planId = (await accept({ type: 'plan.save', name: 'Hall', makeCurrent: true })).planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    for (const [index, name] of ['T1', 'T2', 'T3'].entries()) {
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
      } as ServiceCommand)
      spots.set(name, details.spotId as string)
    }
  }, 60_000)

  afterAll(async () => {
    await world?.close()
  })

  it('refuses a role that does not hold the command, with its own code, and writes nothing', async () => {
    const night = '2026-11-10'
    // The hostess works tonight's floor; the booking book is not hers.
    expect(
      await run(
        {
          type: 'reservation.create',
          serviceDate: night,
          startsAt: at(10, 21),
          kind: 'booking',
          status: 'reserved',
          partySize: 2,
          partyLabel: 'Ivan',
        } as ServiceCommand,
        staff(hostessId),
      ),
    ).toMatchObject({ status: 'refused', code: 'permission_denied' })
    // The plan and the venue's settings are settings-class: a manager's role here holds neither.
    expect(
      await run({ type: 'plan.save', name: 'Second floor' } as ServiceCommand, staff(managerId)),
    ).toMatchObject({ status: 'refused', code: 'permission_denied' })
    expect(await reservationRows(night)).toEqual([])
  })

  it('takes a booking in through applyService, with its spots, its provenance and one Log entry', async () => {
    const night = '2026-11-11'
    const id = await book(night, at(11, 21, 30), ['T1'])
    const row = await reservationOf(id)
    expect(row).toMatchObject({ status: 'reserved', kind: 'booking', party_size: 4 })
    expect(row.service_date).toBe(night)
    const held = await heldSpotsOf(id)
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ spot_id: spotId('T1'), held_to: null, released_at: null })

    const stored = await world.owner.query<{ source: string; actor: string; job_id: string }>(
      'select source, actor, job_id from restro.reservations where id = $1',
      [id],
    )
    // Service provenance, NOT NULL, and no layer (D122 §9): the source is where the write came
    // from, which for a booking taken on the staff app is the staff app itself.
    expect(stored.rows[0]).toMatchObject({ source: 'staff', actor: `user:${ownerId}` })
    expect(stored.rows[0]?.job_id).toBeTruthy()
    const log = (await logOf(['reservation.created'])).filter(
      (entry) => entry.reservation_id === id,
    )
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ to_state: 'reserved', actor: `user:${ownerId}` })
  })

  it('keeps the overlap rule: one spot, one party at a time, and the refusal names the booking', async () => {
    const night = '2026-11-12'
    const first = await book(night, at(12, 22), ['T1'])
    const clash = await run({
      type: 'reservation.create',
      serviceDate: night,
      startsAt: at(12, 23),
      kind: 'booking',
      status: 'reserved',
      partySize: 2,
      partyLabel: 'Later party',
      spotIds: [spotId('T1')],
    } as ServiceCommand)
    expect(clash).toMatchObject({
      status: 'refused',
      code: 'spot_taken',
      details: { spotId: spotId('T1'), reservationId: first },
    })
    // Once the turn time has passed, the same spot is free again.
    const after = await book(night, at(12, 23, 30), ['T1'])
    expect(await heldSpotsOf(after)).toHaveLength(1)
    // A spot of no plan of this venue is refused by name, not taken.
    expect(
      await run({
        type: 'reservation.create',
        serviceDate: night,
        startsAt: at(12, 22),
        kind: 'booking',
        status: 'reserved',
        partySize: 2,
        partyLabel: 'Nowhere',
        spotIds: ['sp_notaspotofthisvenue012'],
      } as ServiceCommand),
    ).toMatchObject({ status: 'refused', code: 'spot_missing' })
  })

  it('refuses a night that has passed until the venue switches it on, then asks for the right to', async () => {
    const past = '2026-11-01'
    const booking = {
      type: 'reservation.create',
      serviceDate: past,
      startsAt: at(1, 22),
      kind: 'booking',
      status: 'reserved',
      partySize: 2,
      partyLabel: 'Last week',
    } as ServiceCommand
    expect(await run(booking)).toMatchObject({ status: 'refused', code: 'night_passed' })
    await setSettings({ editPastNights: true })
    // The switch is the venue's; the right to use it is the person's (D135, D141).
    expect(await run(booking, staff(managerId))).toMatchObject({
      status: 'refused',
      code: 'past_night_denied',
    })
    expect(await run(booking)).toMatchObject({ status: 'accepted' })
    await setSettings({ editPastNights: false })
    expect(await reservationRows(past)).toHaveLength(1)
  })

  it('leaves a party seated with its spots when the table closes: the bill is not the booking (D134)', async () => {
    const tableId = world.tables[0] as Id<'tb'>
    const id = await book(today, new Date().toISOString(), ['T2'])
    await accept({ type: 'reservation.set_status', reservationId: id, status: 'seated' })
    await accept({ type: 'table.open', tableId })
    await accept({ type: 'table.close', tableId })
    // Closing the bill is the ordering side's; nothing of it reaches the reservation.
    const row = await reservationOf(id)
    expect(row.status).toBe('seated')
    expect(row.ended_at).toBeNull()
    expect((await heldSpotsOf(id)).every((held) => held.released_at === null)).toBe(true)
    // Letting go of the spots early is its own tap (D141), and it frees them without ending the party.
    await accept({ type: 'reservation.release_spots', reservationId: id })
    expect((await heldSpotsOf(id)).every((held) => held.released_at !== null)).toBe(true)
    expect((await reservationOf(id)).status).toBe('seated')
  })

  it('moves a party through the statuses and gives its spots back only at an end (D136)', async () => {
    const night = '2026-11-14'
    const id = await book(night, at(14, 22), ['T3'])
    expect(
      await accept({ type: 'reservation.set_status', reservationId: id, status: 'seated' }),
    ).toMatchObject({ status: 'seated', changed: true })
    // The same status again changes nothing, which is what a second tap means.
    expect(
      await accept({ type: 'reservation.set_status', reservationId: id, status: 'seated' }),
    ).toMatchObject({ status: 'seated', changed: false })
    // Reserved is not reachable from Seated: the machine refuses, it is not written around.
    expect(
      await run({ type: 'reservation.set_status', reservationId: id, status: 'reserved' }),
    ).toMatchObject({ status: 'refused' })
    await accept({ type: 'reservation.set_status', reservationId: id, status: 'finished' })
    const row = await reservationOf(id)
    expect(row.status).toBe('finished')
    expect(row.ended_at).not.toBeNull()
    expect((await heldSpotsOf(id)).every((held) => held.released_at !== null)).toBe(true)
  })

  it('keeps the waiting list as a queue of reservations, and Not seated is no no-show (D137, D140)', async () => {
    const night = '2026-11-15'
    const first = (
      await accept({ type: 'waiting.add', serviceDate: night, partySize: 2, partyLabel: 'First' })
    ).reservationId as Id<'rv'>
    const second = (
      await accept({ type: 'waiting.add', serviceDate: night, partySize: 3, partyLabel: 'Second' })
    ).reservationId as Id<'rv'>
    const waiting = (await reservationRows(night)).filter((row) => row.status === 'waiting')
    expect(waiting.map((row) => row.id)).toEqual([first, second])
    expect(waiting.every((row) => row.kind === 'walk_in' && row.queue_key !== null)).toBe(true)
    const keys = waiting.map((row) => String(row.queue_key))
    expect(String(keys[0]) < String(keys[1])).toBe(true)

    // A reorder moves one row's key and nothing else.
    await accept({ type: 'waiting.reorder', reservationId: second, beforeId: first })
    const after = (await reservationRows(night)).filter((row) => row.status === 'waiting')
    const keyOf = (id: string) => after.find((row) => row.id === id)?.queue_key as string
    expect(keyOf(second) < keyOf(first)).toBe(true)

    // The worker's sweep is the only way to Not seated, and a second run changes nothing.
    expect(
      await accept({ type: 'reservation_night.sweep', serviceDate: night }, worker()),
    ).toMatchObject({ changed: true, notSeated: 2 })
    expect(
      await accept({ type: 'reservation_night.sweep', serviceDate: night }, worker()),
    ).toMatchObject({ changed: false })
    const swept = await reservationRows(night)
    expect(swept.map((row) => row.status)).toEqual(['not_seated', 'not_seated'])
    expect(swept.every((row) => row.queue_key === null)).toBe(true)
    const moves = (await logOf(['reservation.status'])).filter(
      (entry) => entry.reason === 'night_ended',
    )
    expect(moves).toHaveLength(2)
    expect(moves.every((entry) => entry.to_state === 'not_seated')).toBe(true)
  })

  it('closes a night once: afterwards every command on it is refused, whatever the past switch says', async () => {
    const night = '2026-11-16'
    const id = await book(night, at(16, 22), ['T1'])
    expect(
      await accept(
        { type: 'reservation_night.close', serviceDate: night, early: true, openBills: 2 },
        staff(managerId),
      ),
    ).toMatchObject({ closed: true, changed: true })
    expect(
      await accept({ type: 'reservation_night.close', serviceDate: night }, staff(managerId)),
    ).toMatchObject({ closed: true, changed: false })
    const record = await world.owner.query<{
      closed_early: boolean
      open_bills_at_close: number | null
      swept_at: Date | null
    }>(
      `select closed_early, open_bills_at_close, swept_at from restro.reservation_nights
        where venue_id = $1 and service_date = $2`,
      [world.venueId, night],
    )
    expect(record.rows[0]).toMatchObject({ closed_early: true, open_bills_at_close: 2 })
    expect(record.rows[0]?.swept_at).not.toBeNull()

    expect(
      await run({ type: 'reservation.set_status', reservationId: id, status: 'seated' }),
    ).toMatchObject({ status: 'refused', code: 'night_closed' })
    await setSettings({ editPastNights: true })
    expect(
      await run({ type: 'reservation.cancel', reservationId: id } as ServiceCommand),
    ).toMatchObject({ status: 'refused', code: 'night_closed' })
    await setSettings({ editPastNights: false })
  })

  it('deletes nothing: a cancelled, taken-out or restored booking is the same row throughout', async () => {
    const night = '2026-11-17'
    const id = await book(night, at(17, 22), ['T2'])
    const before = (await reservationRows()).length
    await accept({ type: 'reservation.cancel', reservationId: id, reason: 'guest_called' })
    expect((await reservationOf(id)).status).toBe('cancelled')
    await accept({ type: 'reservation.delete', reservationId: id })
    const deleted = await reservationOf(id)
    expect(deleted.deleted_at).not.toBeNull()
    await accept({ type: 'reservation.restore', reservationId: id })
    expect((await reservationOf(id)).deleted_at).toBeNull()
    expect((await reservationRows()).length).toBe(before)
    // The spots it had are its own again, and the released rows are still readable.
    expect((await heldSpotsOf(id)).length).toBeGreaterThan(0)
  })

  it('erases a guest as an update: his details go, his reservations and the night stay (D140, D83)', async () => {
    const night = '2026-11-18'
    const phone = '+359888123456'
    const guestId = (
      await accept(
        { type: 'guest.save', phone, name: 'Ivan Petrov', email: 'ivan@example.test' },
        staff(managerId),
      )
    ).guestId as Id<'gu'>
    // One person is one row, however many bookings he has: the number is refused a second record,
    // and the record it already belongs to is updated by name.
    expect(
      await run({ type: 'guest.save', phone, isRegular: true } as ServiceCommand, staff(managerId)),
    ).toMatchObject({ status: 'refused', code: 'guest_exists' })
    expect(
      await accept({ type: 'guest.save', guestId, phone, isRegular: true }, staff(managerId)),
    ).toMatchObject({ guestId })
    await accept(
      { type: 'guest.private_note', guestId, note: 'asks for the corner booth' },
      staff(managerId),
    )
    const id = await book(night, at(18, 22), ['T3'], { guestId, partyLabel: undefined })
    expect((await reservationOf(id)).guest_id).toBe(guestId)

    await accept({ type: 'guest.erase', guestId }, staff(managerId))
    const erased = await world.owner.query<{
      phone_key: string | null
      phone: string | null
      name: string | null
      email: string | null
      erased_at: Date | null
    }>('select phone_key, phone, name, email, erased_at from restro.guests where id = $1', [
      guestId,
    ])
    expect(erased.rows).toHaveLength(1)
    expect(erased.rows[0]).toMatchObject({ phone_key: null, phone: null, name: null, email: null })
    expect(erased.rows[0]?.erased_at).not.toBeNull()
    const notes = await world.owner.query<{ note: string | null }>(
      'select note from restro.guest_private_notes where guest_id = $1',
      [guestId],
    )
    expect(notes.rows.every((row) => row.note === null)).toBe(true)
    // His reservation stands, with its party size and its spot.
    const kept = await reservationOf(id)
    expect(kept).toMatchObject({ guest_id: guestId, party_size: 4 })
    expect(await heldSpotsOf(id)).toHaveLength(1)
    // The Log keeps that it happened and names the record alone: never a detail of the person.
    const log = (await logOf(['guest.erased'])).filter((entry) => entry.guest_id === guestId)
    expect(log).toHaveLength(1)
    expect(JSON.stringify(log)).not.toContain('888123456')
    expect(JSON.stringify(log)).not.toContain('Ivan')
    // The number is free again: a later booking from it starts a new record.
    const next = (await accept({ type: 'guest.save', phone }, staff(managerId))).guestId as Id<'gu'>
    expect(next).not.toBe(guestId)
  })

  it('shows another organisation nothing: its reservation is missing, and its rows never move', async () => {
    const other = await openServiceWorld('reservations-other')
    try {
      const otherOwner = await other.addUser('owner')
      const otherContext: ServiceContext = {
        tenantId: other.tenantId,
        venueId: other.venueId,
        origin: 'staff',
        actor: { kind: 'user', userId: otherOwner, sessionId: `sess-${randomUUID()}` },
        jobId: `req-${randomUUID()}`,
        signedInAt: new Date(),
      }
      const result = await applyService(
        other.app,
        {
          type: 'reservation_settings.set',
          turnMinutes: TURN,
        } as ServiceCommand,
        otherContext,
      )
      expect(result.result.status).toBe('accepted')
      const night = '2026-11-19'
      const theirs = (
        await applyService(
          other.app,
          {
            type: 'reservation.create',
            serviceDate: night,
            startsAt: at(19, 22),
            kind: 'booking',
            status: 'reserved',
            partySize: 2,
            partyLabel: 'Theirs',
          } as ServiceCommand,
          otherContext,
        )
      ).result
      if (theirs.status !== 'accepted') throw new Error(`refused: ${theirs.code}`)
      const theirId = theirs.details.reservationId as Id<'rv'>

      // Our organisation names their row: it is not there to be read, let alone written.
      for (const command of [
        { type: 'reservation.cancel', reservationId: theirId },
        { type: 'reservation.delete', reservationId: theirId },
        { type: 'reservation.set_status', reservationId: theirId, status: 'seated' },
      ] as ServiceCommand[]) {
        expect(await run(command), command.type).toMatchObject({
          status: 'refused',
          code: 'reservation_missing',
        })
      }
      const still = await other.owner.query<{ status: string }>(
        'select status from restro.reservations where id = $1',
        [theirId],
      )
      expect(still.rows[0]?.status).toBe('reserved')
      // And our own venue's list never held their row.
      expect((await reservationRows(night)).map((row) => row.id)).not.toContain(theirId)
    } finally {
      await other.close()
    }
  }, 60_000)
})
