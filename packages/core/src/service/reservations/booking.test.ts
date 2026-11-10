// Taking and changing a booking, on a real Postgres as the restro_app role (ticket #328; D134,
// D135, D137, D141). What only a database can show: the permission split between taking a booking
// and working one, the phone the venue requires, the overlap refusal that names the party in the
// way (a block with no end included), an edit over somebody's change that is refused and writes
// nothing, a delete that is a hostess's own or a manager's, a copy that leaves what happened
// behind, and the advice the form reads — which never refuses. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import { type Id, newId } from '../../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../../ordering-settings'
import { addDaysToDay, localInstant, serviceDate as serviceDateOf } from '../../service-day'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceActor, ServiceContext } from '../context'
import type { ServiceCommand } from '../index'
import { readBookingChecks } from './booking-checks'
import { readReservationDetail } from './read'

const TURN = 90

describe.skipIf(!hasDatabase)('taking and changing a booking (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  /** Works tonight's floor and takes bookings, and nothing else. */
  let hostessId: string
  let hostessStaffId: string
  /** A second hostess, so one can delete her own and not the other's. */
  let otherHostessId: string
  /** Holds the booking book. */
  let managerId: string
  let planId: string
  let timezone = 'UTC'
  let dayEndsAt = '07:00:00'
  let today: string
  const spots = new Map<string, string>()
  const spotId = (name: string) => spots.get(name) as Id<'sp'>

  const staff = (userId: string): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })
  const run = async (command: ServiceCommand, context: ServiceContext = staff(ownerId)) =>
    (await applyService(world.app, command, context)).result
  async function accept(command: ServiceCommand, context: ServiceContext = staff(ownerId)) {
    const result = await run(command, context)
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }

  /** The nth night after today, and an hour of it as an instant in the venue's own clock. */
  const night = (ahead: number) => addDaysToDay(today, ahead)
  const hour = (day: string, time: string) =>
    localInstant(day, time, timezone, dayEndsAt.slice(0, 5)).toISOString()
  const phone = () => `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`

  const book = async (
    day: string,
    time: string,
    spotNames: readonly string[],
    over: Record<string, unknown> = {},
  ) =>
    (
      await accept({
        type: 'reservation.create',
        serviceDate: day,
        startsAt: hour(day, time),
        kind: 'booking',
        status: 'reserved',
        partySize: 4,
        guestName: `Guest ${randomUUID().slice(0, 6)}`,
        phone: phone(),
        spotIds: spotNames.map(spotId),
        ...over,
      } as ServiceCommand)
    ).reservationId as Id<'rv'>

  const row = async (id: string) => {
    const found = (
      await world.owner.query<{
        status: string
        party_size: number | null
        guest_id: string | null
        party_label: string | null
        reason: string | null
        made_by: string | null
        deleted_at: Date | null
        ended_at: Date | null
        seated_at: Date | null
        queue_key: string | null
        note: string | null
      }>(
        `select status, party_size, guest_id, party_label, reason, made_by, deleted_at, ended_at,
                seated_at, queue_key, note
           from restro.reservations where id = $1`,
        [id],
      )
    ).rows[0]
    if (found === undefined) throw new Error(`no reservation ${id}`)
    return found
  }
  const heldNames = async (id: string) =>
    (
      await world.owner.query<{ name: string }>(
        `select s.name from restro.reservation_spots h join restro.spots s on s.id = h.spot_id
          where h.reservation_id = $1 and h.released_at is null order by s.name`,
        [id],
      )
    ).rows.map((one) => one.name)
  const setSettings = (values: Record<string, unknown>) =>
    accept({ type: 'reservation_settings.set', ...values } as ServiceCommand)

  const detailOf = async (id: string) => {
    const read = await readReservationDetail(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: staff(ownerId).actor,
      reservationId: id,
    })
    if (!read.ok || read.detail === null) throw new Error('detail not read')
    return read.detail
  }

  const checks = async (input: {
    day: string
    time: string
    endTime?: string
    partySize?: number | null
    name?: string | null
    phone?: string | null
    spotNames?: readonly string[]
    reservationId?: string
  }) => {
    const read = await readBookingChecks(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: staff(ownerId).actor,
      day: input.day,
      startsAt: new Date(hour(input.day, input.time)),
      endsAt: input.endTime === undefined ? null : new Date(hour(input.day, input.endTime)),
      partySize: input.partySize ?? null,
      name: input.name ?? null,
      phone: input.phone ?? null,
      spotIds: (input.spotNames ?? []).map(spotId),
      ...(input.reservationId === undefined ? {} : { reservationId: input.reservationId }),
    })
    if (!read.ok) throw new Error(`checks refused: ${read.code}`)
    return read.checks
  }

  beforeAll(async () => {
    world = await openServiceWorld('booking')
    ownerId = await world.addUser('owner')
    hostessId = await world.addUser('member')
    hostessStaffId = await world.addStaff(['reservations.tonight'], hostessId)
    otherHostessId = await world.addUser('member')
    await world.addStaff(['reservations.tonight'], otherHostessId)
    managerId = await world.addUser('member')
    await world.addStaff(
      ['reservations.manage', 'reservations.tonight', 'settings.guests'],
      managerId,
    )
    const venue = (
      await world.owner.query<{ timezone: string; ends_at: string }>(
        'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
        [world.venueId],
      )
    ).rows[0]
    timezone = venue?.timezone ?? 'UTC'
    dayEndsAt = venue?.ends_at ?? '07:00:00'
    today = serviceDateOf(new Date(), timezone, dayEndsAt)
    await setSettings({ turnMinutes: TURN, editPastNights: false })
    planId = (await accept({ type: 'plan.save', name: 'Hall', makeCurrent: true })).planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    for (const [index, name] of ['T1', 'T2', 'T3', 'T4'].entries()) {
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

  describe('who may do what (D135, D141)', () => {
    it('lets whoever works tonight take a booking, and not change it', async () => {
      const day = night(3)
      await book(day, '22:00', ['T1'])
      const taken = await run(
        {
          type: 'reservation.create',
          serviceDate: day,
          startsAt: hour(day, '23:00'),
          kind: 'booking',
          status: 'reserved',
          partySize: 2,
          guestName: 'Mira',
          phone: phone(),
        } as ServiceCommand,
        staff(hostessId),
      )
      expect(taken.status).toBe('accepted')
      const reservationId = taken.details.reservationId as Id<'rv'>
      // The maker is the hostess, by her staff record, even signed in as herself.
      expect((await row(reservationId)).made_by).toBe(hostessStaffId)
      for (const command of [
        { type: 'reservation.edit', reservationId, partySize: 3 },
        { type: 'reservation.cancel', reservationId },
        { type: 'reservation.restore', reservationId },
      ] as ServiceCommand[]) {
        expect(await run(command, staff(hostessId))).toMatchObject({
          status: 'refused',
          code: 'permission_denied',
        })
      }
      // The same call-off through the status door is the same act.
      expect(
        await run(
          { type: 'reservation.set_status', reservationId, status: 'cancelled' },
          staff(hostessId),
        ),
      ).toMatchObject({ status: 'refused', code: 'permission_denied' })
      expect((await row(reservationId)).status).toBe('reserved')
      // A manager works any booking, whoever took it.
      await accept({ type: 'reservation.edit', reservationId, partySize: 3 }, staff(managerId))
      expect((await row(reservationId)).party_size).toBe(3)
    })

    it('lets a hostess take out a line she made, and keeps another’s for a manager', async () => {
      const day = night(3)
      const mine = await accept(
        {
          type: 'reservation.create',
          serviceDate: day,
          startsAt: hour(day, '21:00'),
          kind: 'booking',
          status: 'reserved',
          partySize: 2,
          guestName: 'Typo',
          phone: phone(),
        } as ServiceCommand,
        staff(hostessId),
      )
      const mineId = mine.reservationId as Id<'rv'>
      const theirs = await book(day, '21:00', [])
      // Not hers, not a manager: refused, and the line is still there.
      expect(
        await run({ type: 'reservation.delete', reservationId: theirs }, staff(hostessId)),
      ).toMatchObject({ status: 'refused', code: 'permission_denied' })
      expect((await row(theirs)).deleted_at).toBeNull()
      // Another hostess did not make it either.
      expect(
        await run({ type: 'reservation.delete', reservationId: mineId }, staff(otherHostessId)),
      ).toMatchObject({ status: 'refused', code: 'permission_denied' })
      // Hers: out of the book, and only a manager brings it back.
      await accept({ type: 'reservation.delete', reservationId: mineId }, staff(hostessId))
      expect((await row(mineId)).deleted_at).not.toBeNull()
      expect(
        await run({ type: 'reservation.restore', reservationId: mineId }, staff(hostessId)),
      ).toMatchObject({ code: 'permission_denied' })
      await accept({ type: 'reservation.restore', reservationId: mineId }, staff(managerId))
      expect((await row(mineId)).deleted_at).toBeNull()
      await accept({ type: 'reservation.delete', reservationId: theirs }, staff(managerId))
      expect((await row(theirs)).deleted_at).not.toBeNull()
    })
  })

  describe('taking a booking', () => {
    it('requires a phone unless the venue switched that off, and says so by code', async () => {
      const day = night(4)
      const withoutPhone = {
        type: 'reservation.create',
        serviceDate: day,
        startsAt: hour(day, '22:00'),
        kind: 'booking',
        status: 'reserved',
        partySize: 2,
        guestName: 'Ivan',
      } as ServiceCommand
      expect(await run(withoutPhone)).toMatchObject({ status: 'refused', code: 'phone_required' })
      expect(await run({ ...withoutPhone, phone: '12' } as ServiceCommand)).toMatchObject({
        status: 'refused',
      })
      await setSettings({ phoneRequired: false })
      try {
        const details = await accept(withoutPhone)
        const saved = await row(details.reservationId as string)
        expect(saved.guest_id).toBeNull()
        expect(saved.party_label).toBe('Ivan')
      } finally {
        await setSettings({ phoneRequired: true })
      }
    })

    it('keeps the name the hostess typed when the guest is known by another', async () => {
      const day = night(4)
      const number = phone()
      const first = await book(day, '20:00', [], { guestName: 'Maria Ivanova', phone: number })
      const again = await book(day, '21:00', [], { guestName: 'Maria', phone: number })
      const sameName = await book(day, '22:00', [], { guestName: 'maria ivanova', phone: number })
      // One guest, one record; the booking says "Maria" only where it differs from the record's.
      expect((await row(first)).guest_id).toBe((await row(again)).guest_id)
      expect((await row(first)).party_label).toBeNull()
      expect((await row(again)).party_label).toBe('Maria')
      expect((await row(sameName)).party_label).toBeNull()
      expect((await detailOf(again)).row.name).toBe('Maria')
      expect((await detailOf(first)).row.name).toBe('Maria Ivanova')
    })

    it('takes the name a booking carried for a guest away with him when he is erased (D140)', async () => {
      const day = night(4)
      const number = phone()
      await book(day, '19:00', [], { guestName: 'Maria Ivanova', phone: number })
      const other = await book(day, '19:30', [], { guestName: 'Mimi', phone: number })
      expect((await row(other)).party_label).toBe('Mimi')
      const guestId = (await row(other)).guest_id as Id<'gu'>
      await accept({ type: 'guest.erase', guestId }, staff(managerId))
      const after = await row(other)
      expect(after.party_label).toBeNull()
      expect(after.party_size).toBe(4)
      expect((await detailOf(other)).row.name).toBeNull()
    })

    it('carries its reason and its several spots into the Log without a name or a number', async () => {
      const day = night(4)
      const id = await book(day, '22:30', ['T1', 'T2'], { reason: 'birthday', note: 'cake' })
      expect(await heldNames(id)).toEqual(['T1', 'T2'])
      expect((await row(id)).reason).toBe('birthday')
      const log = (
        await world.owner.query<{ details: Record<string, unknown>; reason: string | null }>(
          `select details, reason from restro.log_entries where reservation_id = $1`,
          [id],
        )
      ).rows
      expect(log).toHaveLength(1)
      expect(log[0]?.reason).toBe('birthday')
      expect(JSON.stringify(log[0]?.details)).not.toMatch(/Guest|\+359/)
    })

    it('refuses two parties on one spot, naming the one in the way and from when', async () => {
      const day = night(5)
      const holder = await book(day, '22:00', ['T3'])
      const refused = await run({
        type: 'reservation.create',
        serviceDate: day,
        startsAt: hour(day, '23:00'),
        kind: 'booking',
        status: 'reserved',
        partySize: 2,
        guestName: 'Late',
        phone: phone(),
        spotIds: [spotId('T3')],
      } as ServiceCommand)
      expect(refused).toMatchObject({
        status: 'refused',
        code: 'spot_taken',
        details: { spotId: spotId('T3'), reservationId: holder },
      })
      // The turn time has passed by the next booking: 22:00 + 90 minutes ends before 23:45.
      await accept({
        type: 'reservation.create',
        serviceDate: day,
        startsAt: hour(day, '23:45'),
        kind: 'booking',
        status: 'reserved',
        partySize: 2,
        guestName: 'Later',
        phone: phone(),
        spotIds: [spotId('T3')],
      } as ServiceCommand)
    })

    it('refuses a spot that a block with no end keeps back, even from an earlier night', async () => {
      const first = night(6)
      const second = night(7)
      const block = await accept({
        type: 'block.save',
        serviceDate: first,
        startsAt: hour(first, '20:00'),
        spotIds: [spotId('T4')],
        reason: 'broken',
      } as ServiceCommand)
      for (const [day, time] of [
        [first, '22:00'],
        [second, '22:00'],
      ] as const) {
        expect(
          await run({
            type: 'reservation.create',
            serviceDate: day,
            startsAt: hour(day, time),
            kind: 'booking',
            status: 'reserved',
            partySize: 2,
            guestName: 'Blocked',
            phone: phone(),
            spotIds: [spotId('T4')],
          } as ServiceCommand),
        ).toMatchObject({
          status: 'refused',
          code: 'spot_taken',
          details: { reservationId: block.reservationId },
        })
      }
      // The block is lifted; the spot is a spot again. A booking command never lifts a block.
      expect(
        await run({ type: 'reservation.cancel', reservationId: block.reservationId as Id<'rv'> }),
      ).toMatchObject({ status: 'refused', code: 'kind_not_allowed' })
      await accept({ type: 'block.remove', reservationId: block.reservationId as Id<'rv'> })
      await book(second, '22:00', ['T4'])
    })

    it('refuses a night that has passed, unless the venue switched the past on', async () => {
      const past = addDaysToDay(today, -2)
      const command = {
        type: 'reservation.create',
        serviceDate: past,
        startsAt: hour(past, '22:00'),
        kind: 'booking',
        status: 'reserved',
        partySize: 2,
        guestName: 'Past',
        phone: phone(),
      } as ServiceCommand
      expect(await run(command)).toMatchObject({ status: 'refused', code: 'night_passed' })
    })
  })

  describe('changing a booking', () => {
    it('changes the name, phone, size, hours, note, reason and spots in one edit', async () => {
      const day = night(8)
      const id = await book(day, '22:00', ['T1'], { guestName: 'Old Name' })
      const before = await detailOf(id)
      const number = phone()
      await accept({
        type: 'reservation.edit',
        reservationId: id,
        expectedVersion: before.version,
        name: 'New Name',
        phone: number,
        partySize: 6,
        startsAt: hour(day, '23:00'),
        endsAt: hour(day, '23:59'),
        note: 'window',
        reason: 'company',
        spotIds: [spotId('T2'), spotId('T3')],
      } as ServiceCommand)
      const after = await detailOf(id)
      expect(after.row).toMatchObject({ name: 'New Name', partySize: 6, note: 'window' })
      expect(after.row.reason).toBe('company')
      expect(after.row.spots).toEqual(['T2', 'T3'])
      expect([...after.spotIds].sort()).toEqual([spotId('T2'), spotId('T3')].sort())
      // The old table is free again for somebody else.
      await book(day, '23:00', ['T1'])
      // The Log names the change and never what the guest became.
      const entry = (
        await world.owner.query<{ details: Record<string, unknown> }>(
          `select details from restro.log_entries
            where reservation_id = $1 and kind = 'reservation.changed'`,
          [id],
        )
      ).rows
      expect(entry).toHaveLength(1)
      expect(JSON.stringify(entry[0]?.details)).not.toMatch(/New Name|\+359/)
    })

    it('refuses an edit whose spot a colleague took first, by name, and writes nothing', async () => {
      const day = night(8)
      const holder = await book(day, '20:00', ['T4'])
      const mine = await book(day, '20:30', ['T3'])
      const result = await run({
        type: 'reservation.edit',
        reservationId: mine,
        spotIds: [spotId('T4')],
        partySize: 9,
      } as ServiceCommand)
      expect(result).toMatchObject({
        status: 'refused',
        code: 'spot_taken',
        details: { spotId: spotId('T4'), reservationId: holder },
      })
      expect(await heldNames(mine)).toEqual(['T3'])
      expect((await row(mine)).party_size).toBe(4)
    })

    it('refuses an edit over somebody’s change and never saves over their work', async () => {
      const day = night(9)
      const id = await book(day, '22:00', ['T1'])
      const opened = await detailOf(id)
      // A colleague changes the party size while the form is open.
      await accept({ type: 'reservation.edit', reservationId: id, partySize: 7 }, staff(managerId))
      const stale = await run({
        type: 'reservation.edit',
        reservationId: id,
        expectedVersion: opened.version,
        partySize: 2,
        note: 'mine',
      } as ServiceCommand)
      expect(stale).toMatchObject({ status: 'refused', code: 'reservation_stale' })
      const kept = await row(id)
      expect(kept.party_size).toBe(7)
      expect(kept.note).toBeNull()
      // Opened again, the same change goes through.
      const fresh = await detailOf(id)
      expect(fresh.version).not.toBe(opened.version)
      await accept({
        type: 'reservation.edit',
        reservationId: id,
        expectedVersion: fresh.version,
        partySize: 2,
      } as ServiceCommand)
      expect((await row(id)).party_size).toBe(2)
    })

    it('counts a change of tables as a change, so a form over it is stale too', async () => {
      const day = night(9)
      const id = await book(day, '20:00', ['T2'])
      const opened = await detailOf(id)
      await accept({ type: 'reservation.release_spots', reservationId: id } as ServiceCommand)
      expect(
        await run({
          type: 'reservation.edit',
          reservationId: id,
          expectedVersion: opened.version,
          note: 'x',
        } as ServiceCommand),
      ).toMatchObject({ code: 'reservation_stale' })
    })

    it('takes the phone off a booking only where the venue does not require one', async () => {
      const day = night(9)
      const id = await book(day, '19:00', [])
      expect(
        await run({ type: 'reservation.edit', reservationId: id, phone: null } as ServiceCommand),
      ).toMatchObject({ code: 'phone_required' })
    })
  })

  describe('cancel, delete, restore', () => {
    it('keeps a cancelled booking on the night and takes a deleted one off every list', async () => {
      const day = night(10)
      const cancelled = await book(day, '20:00', ['T1'])
      const deleted = await book(day, '20:00', ['T2'])
      await accept({ type: 'reservation.cancel', reservationId: cancelled })
      await accept({ type: 'reservation.delete', reservationId: deleted })
      expect((await row(cancelled)).status).toBe('cancelled')
      expect((await row(cancelled)).deleted_at).toBeNull()
      expect(await heldNames(cancelled)).toEqual([])
      expect((await row(deleted)).deleted_at).not.toBeNull()
      expect((await row(deleted)).status).toBe('reserved')
      // The Log keeps who and when.
      const log = (
        await world.owner.query<{ kind: string; to_state: string | null; actor: string }>(
          `select kind, to_state, actor from restro.log_entries where reservation_id = $1`,
          [deleted],
        )
      ).rows
      expect(log.some((entry) => entry.to_state === 'deleted')).toBe(true)
    })

    it('brings a deleted booking back without its spot when somebody took it meanwhile', async () => {
      const day = night(10)
      const id = await book(day, '22:00', ['T3'])
      await accept({ type: 'reservation.delete', reservationId: id })
      const taker = await book(day, '22:00', ['T3'])
      const details = await accept({ type: 'reservation.restore', reservationId: id })
      expect(details.spotsLost).toBe(true)
      expect(await heldNames(id)).toEqual([])
      expect(await heldNames(taker)).toEqual(['T3'])
      expect((await row(id)).deleted_at).toBeNull()
    })
  })

  describe('copying to another night', () => {
    it('keeps the details and leaves out anything that happened', async () => {
      const day = night(11)
      const id = await book(day, '22:00', ['T1'], {
        note: 'quiet corner',
        reason: 'birthday',
        partySize: 5,
      })
      await accept({ type: 'reservation.set_status', reservationId: id, status: 'seated' })
      const target = night(12)
      const copied = await accept({
        type: 'reservation.copy',
        reservationId: id,
        serviceDate: target,
        startsAt: hour(target, '22:30'),
        spotIds: [spotId('T1')],
      } as ServiceCommand)
      const copy = await row(copied.reservationId as string)
      const source = await row(id)
      expect(copy).toMatchObject({
        status: 'reserved',
        party_size: 5,
        note: 'quiet corner',
        reason: 'birthday',
        guest_id: source.guest_id,
      })
      expect(copy.seated_at).toBeNull()
      expect(copy.ended_at).toBeNull()
      expect(await heldNames(copied.reservationId as string)).toEqual(['T1'])
      expect(source.status).toBe('seated')
    })

    it('asks for other spots when those are taken, naming who holds them', async () => {
      const day = night(11)
      const id = await book(day, '21:00', [])
      const target = night(13)
      const holder = await book(target, '21:00', ['T2'])
      expect(
        await run({
          type: 'reservation.copy',
          reservationId: id,
          serviceDate: target,
          startsAt: hour(target, '21:30'),
          spotIds: [spotId('T2')],
        } as ServiceCommand),
      ).toMatchObject({
        status: 'refused',
        code: 'spot_taken',
        details: { reservationId: holder },
      })
      const ok = await accept({
        type: 'reservation.copy',
        reservationId: id,
        serviceDate: target,
        startsAt: hour(target, '21:30'),
        spotIds: [spotId('T3')],
      } as ServiceCommand)
      expect(await heldNames(ok.reservationId as string)).toEqual(['T3'])
    })

    it('cannot copy a walk-in, which has no details, or a block', async () => {
      const day = night(11)
      const walkIn = await accept({
        type: 'reservation.create',
        serviceDate: day,
        startsAt: hour(day, '22:00'),
        kind: 'walk_in',
        status: 'reserved',
        partySize: 2,
      } as ServiceCommand)
      expect(
        await run({
          type: 'reservation.copy',
          reservationId: walkIn.reservationId as Id<'rv'>,
          serviceDate: night(12),
          startsAt: hour(night(12), '22:00'),
        } as ServiceCommand),
      ).toMatchObject({ code: 'kind_not_allowed' })
    })

    it('refuses an unknown reservation by code', async () => {
      expect(
        await run({
          type: 'reservation.copy',
          reservationId: newId('rv'),
          serviceDate: night(12),
          startsAt: hour(night(12), '22:00'),
        } as ServiceCommand),
      ).toMatchObject({ code: 'reservation_missing' })
    })
  })

  describe('the advice the form reads (it never refuses)', () => {
    it('warns when there are more guests than the spots seat', async () => {
      const day = night(14)
      expect(
        (await checks({ day, time: '22:00', partySize: 9, spotNames: ['T1', 'T2'] })).seats,
      ).toEqual({ guests: 9, seats: 8 })
      expect(
        (await checks({ day, time: '22:00', partySize: 8, spotNames: ['T1', 'T2'] })).seats,
      ).toBeNull()
      expect((await checks({ day, time: '22:00', partySize: 30 })).seats).toBeNull()
    })

    it('warns about the same phone or name that night, and not about the booking itself', async () => {
      const day = night(14)
      const number = phone()
      const id = await book(day, '21:00', [], { guestName: 'Dora', phone: number })
      const byPhone = await checks({ day, time: '23:00', name: 'Somebody', phone: number })
      expect(byPhone.sameContact).toMatchObject({ name: 'Dora' })
      // The digits are the key, not the way the number is written.
      const written = `00${number.slice(1)}`.replace(/(\d{3})(?=\d)/g, '$1 ')
      expect((await checks({ day, time: '23:00', phone: written })).sameContact).not.toBeNull()
      const byName = await checks({ day, time: '23:00', name: ' dora ', phone: phone() })
      expect(byName.sameContact).not.toBeNull()
      expect(
        (await checks({ day, time: '21:00', name: 'Dora', phone: number, reservationId: id }))
          .sameContact,
      ).toBeNull()
      // Another night is another night; a booking called off is not "already booked".
      expect(
        (await checks({ day: night(15), time: '21:00', phone: number })).sameContact,
      ).toBeNull()
      await accept({ type: 'reservation.cancel', reservationId: id })
      expect((await checks({ day, time: '23:00', phone: number })).sameContact).toBeNull()
    })

    it('names a one-off closed date, a closed weekday, an early hour and one after closing', async () => {
      const day = night(16)
      expect((await checks({ day, time: '22:00' })).closedNight).toBe(false)
      await accept({ type: 'reservation_closed_date.add', date: day } as ServiceCommand)
      expect((await checks({ day, time: '22:00' })).closedNight).toBe(true)
      await accept({ type: 'reservation_closed_date.remove', date: day } as ServiceCommand)

      // Open every night from 22:00 to 05:00 except the weekday of `day`.
      const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
      const [y, m, d] = day.split('-').map(Number) as [number, number, number]
      const closedWeekday = weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] as string
      const hours = Object.fromEntries(
        weekdays.map((name) => [
          name,
          name === closedWeekday ? null : { opens: '22:00', lastOrders: '04:00', closes: '05:00' },
        ]),
      )
      await world.owner.query(
        `update restro.venues set settings = settings || jsonb_build_object('ordering', $2::jsonb) where id = $1`,
        [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, serviceHours: hours })],
      )
      try {
        expect((await checks({ day, time: '22:00' })).closedNight).toBe(true)
        const open = night(17)
        const quiet = await checks({ day: open, time: '22:30' })
        expect(quiet).toMatchObject({
          closedNight: false,
          beforeOpening: null,
          afterClosing: false,
        })
        expect((await checks({ day: open, time: '20:00' })).beforeOpening).not.toBeNull()
        expect((await checks({ day: open, time: '05:30' })).afterClosing).toBe(true)
      } finally {
        await world.owner.query(
          `update restro.venues set settings = settings - 'ordering' where id = $1`,
          [world.venueId],
        )
      }
    })

    it('shows the party in the way and the hour, while the write path stays the authority', async () => {
      const day = night(18)
      const holder = await book(day, '22:00', ['T1'], { guestName: 'Holder' })
      const asked = await checks({ day, time: '22:30', spotNames: ['T1'] })
      expect(asked.taken).toMatchObject({
        spotName: 'T1',
        reservationId: holder,
        name: 'Holder',
        kind: 'booking',
      })
      // Its own hold is not in its own way.
      expect(
        (await checks({ day, time: '22:00', spotNames: ['T1'], reservationId: holder })).taken,
      ).toBeNull()
      expect((await checks({ day, time: '22:00', spotNames: ['T2'] })).taken).toBeNull()
    })

    it('says why a night cannot be written, instead of leaving the form to find out on Save', async () => {
      const past = addDaysToDay(today, -3)
      expect((await checks({ day: past, time: '22:00' })).night).toBe('night_passed')
      expect((await checks({ day: night(1), time: '22:00' })).night).toBeNull()
    })
  })
})
