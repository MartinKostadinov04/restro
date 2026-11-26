// Choosing an Area or a spot on the booking page, and bookings that confirm themselves (#580; spec
// #322 stories 4, 5, 26, 27, 32), on a real Postgres as the restro_app role: what the owner may set
// and when, the Areas and plans the booking file publishes (no Table in them, rule 3), free or taken
// per spot, the Area a request stores and the night's list names, two guests racing for one spot
// (exactly one wins), and the booking that confirms itself only where the guest picked a spot.
// Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createArea, setAreaHidden } from '../../apply/tables'
import { hasDatabase } from '../../apply/test-database'
import { BookingFileSchema } from '../../guest-files'
import type { GuestEmailJob } from '../../jobs'
import { DEFAULT_ORDERING_SETTINGS, type ServiceHours } from '../../ordering-settings'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import { forbiddenPaths } from '../bill'
import { bookingBackendValues, readBookingFile, readBookingSpots, requestBooking } from '../booking'
import type { ServiceActor, ServiceContext } from '../context'
import type { HumanCheck } from '../guest'
import type { ServiceCommand } from '../index'
import { readReservationNight } from './read'

// Friday nights only: open 22:00, closes 05:30 (Sofia, service day 07:00).
const HOURS: ServiceHours = {
  ...DEFAULT_ORDERING_SETTINGS.serviceHours,
  fri: { opens: '22:00', lastOrders: '04:30', closes: '05:30' },
}
/** Tuesday 20 October 2026, 13:00 in Sofia. */
const NOW = new Date('2026-10-20T10:00:00Z')
/** That week's Friday: open. */
const FRIDAY = '2026-10-23'
/** The Friday after. */
const NEXT_FRIDAY = '2026-10-30'
/** 22:00 on that first Friday in Sofia (summer time, UTC+3). */
const FRIDAY_OPENS = '2026-10-23T19:00:00.000Z'

const passes: HumanCheck = async () => 'passed'

describe.skipIf(!hasDatabase)(
  'an Area or a spot on the booking page (as the restro_app role)',
  () => {
    let world: ServiceWorld
    let ownerId: string
    let hallId: string
    let terraceId: string
    const spotIds = new Map<string, string>()

    const staff = (userId: string): ServiceContext => ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'staff',
      actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
      jobId: `req-${randomUUID()}`,
      signedInAt: NOW,
      now: NOW,
    })
    const run = async (command: ServiceCommand) =>
      (await applyService(world.app, command, staff(ownerId))).result
    async function accept(command: ServiceCommand) {
      const result = await run(command)
      if (result.status !== 'accepted') {
        throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
      }
      return result.details
    }
    const guests = (over: Partial<{ guestMay: string; autoConfirm: boolean }>) =>
      run({ type: 'reservation_online_guests.set', ...over } as ServiceCommand)

    const phone = () => `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`
    /** What the request owed beyond its answer, as `queueJobs` was handed it. */
    let owed: GuestEmailJob[] = []
    const ask = (over: Partial<Parameters<typeof requestBooking>[1]> = {}) =>
      requestBooking(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actionId: randomUUID(),
        serviceDate: FRIDAY,
        partySize: 4,
        guestName: 'Maria',
        phone: phone(),
        email: 'maria@example.com',
        note: null,
        humanToken: 'token',
        humanCheck: passes,
        now: NOW,
        queueJobs: async (_result, _queue, jobs) => {
          owed.push(...jobs.guestEmails)
        },
        ...over,
      })
    const spot = (name: string) => {
      const id = spotIds.get(name)
      if (id === undefined) throw new Error(`no spot ${name}`)
      return id
    }
    const reservationOf = async (id: unknown) =>
      (
        await world.owner.query<{ status: string; requested_area_id: string | null }>(
          'select status, requested_area_id from restro.reservations where id = $1',
          [id],
        )
      ).rows[0]
    const statesOn = (night: string) =>
      readBookingSpots(world.app, world.tenantId, world.venueId, night, NOW)

    beforeAll(async () => {
      world = await openServiceWorld('booking-plan')
      ownerId = await world.addUser('owner')
      await world.owner.query(
        `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
        [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, serviceHours: HOURS })],
      )
      const hall = await world.owner.query<{ area_id: string }>(
        'select area_id from restro.tables where id = $1',
        [world.tables[0]],
      )
      hallId = hall.rows[0]?.area_id ?? ''
      // A second Area holding no spot, and so never offered.
      const terrace = await createArea(world.app, world.tenantId, world.venueId, 'Terrace')
      if (!terrace.ok) throw new Error('no terrace')
      terraceId = terrace.area.id
      await accept({ type: 'reservation_settings.set', turnMinutes: 120 } as ServiceCommand)
      await accept({ type: 'reservation_online.set', bookingPage: true })
    }, 60_000)

    afterAll(async () => {
      await world?.close()
    })

    it('offers an Area or a spot only once a plan is drawn, and confirms only with a spot', async () => {
      expect(await guests({ guestMay: 'spot' })).toMatchObject({ code: 'plan_missing' })
      expect(await guests({ guestMay: 'area' })).toMatchObject({ code: 'plan_missing' })
      expect(await guests({ autoConfirm: true })).toMatchObject({ code: 'auto_confirm_needs_spot' })

      const planId = (await accept({ type: 'plan.save', name: 'Ground floor', makeCurrent: true }))
        .planId as string
      await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
      // A drawn spot with no Table belongs to no Area: still no Area can be offered.
      const loose = await accept({
        type: 'spot.save',
        planId,
        name: 'Bar 1',
        kind: 'table',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      } as ServiceCommand)
      spotIds.set('Bar 1', loose.spotId as string)
      expect(await guests({ guestMay: 'area' })).toMatchObject({ code: 'areas_missing' })
      for (const [index, name] of ['T1', 'T2', 'T3'].entries()) {
        const details = await accept({
          type: 'spot.save',
          planId,
          name,
          kind: 'table',
          shape: 'rect',
          x: (index + 1) * 100,
          y: 0,
          width: 80,
          height: 80,
          seats: index === 0 ? 6 : null,
          tableId: world.tables[index],
        } as ServiceCommand)
        spotIds.set(name, details.spotId as string)
      }

      expect(
        await accept({ type: 'reservation_online_guests.set', guestMay: 'area' } as ServiceCommand),
      ).toEqual({ guestMay: 'area', autoConfirm: false })
      expect(await guests({ autoConfirm: true })).toMatchObject({ code: 'auto_confirm_needs_spot' })
      expect(
        await accept({
          type: 'reservation_online_guests.set',
          guestMay: 'spot',
          autoConfirm: true,
        } as ServiceCommand),
      ).toEqual({ guestMay: 'spot', autoConfirm: true })
      // Leaving "pick their spot" leaves the switch nothing to apply to: it goes off in the same write.
      expect(
        await accept({
          type: 'reservation_online_guests.set',
          guestMay: 'night',
        } as ServiceCommand),
      ).toEqual({ guestMay: 'night', autoConfirm: false })
      const lines = await world.owner.query<{ to_state: string }>(
        `select to_state from restro.log_entries
        where venue_id = $1 and kind = 'reservation_settings.changed'
          and (to_state like 'guests_may%' or to_state like 'auto_confirm%')
        order by seq`,
        [world.venueId],
      )
      expect(lines.rows.map((line) => line.to_state)).toEqual([
        'guests_may_area',
        'guests_may_spot',
        'auto_confirm_on',
        'guests_may_night',
        'auto_confirm_off',
      ])
    })

    it('takes the Area a guest asks for, stores it, and the night’s list names it', async () => {
      await accept({ type: 'reservation_online_guests.set', guestMay: 'area' } as ServiceCommand)
      const file = await readBookingFile(world.app, world.tenantId, world.venueId, NOW)
      expect(BookingFileSchema.parse(file)).toEqual(file)
      expect(file?.guest_may).toBe('area')
      // Only the visible Area that holds a spot; and no plan, which only "pick their spot" draws.
      expect(file?.areas).toEqual([{ id: hallId, name: 'Hall' }])
      expect(file?.plans).toEqual([])

      expect(await ask({ spotIds: [spot('T1')] })).toMatchObject({ code: 'choice_not_offered' })
      expect(await ask({ areaId: terraceId })).toMatchObject({ code: 'area_missing' })
      const asked = await ask({ areaId: hallId, guestName: 'Area guest' })
      expect(asked).toMatchObject({ status: 'accepted', details: { status: 'requested' } })
      if (asked.status !== 'accepted') return
      expect(await reservationOf(asked.details.reservationId)).toEqual({
        status: 'requested',
        requested_area_id: hallId,
      })
      const read = await readReservationNight(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
        day: FRIDAY,
        now: NOW,
      })
      if (!read.ok) throw new Error(read.code)
      const row = read.night.rows.find((line) => line.id === asked.details.reservationId)
      expect(row?.askedFor).toBe('Hall')
    })

    it('publishes the plans with their spots and Areas, and never a Table', async () => {
      await accept({ type: 'reservation_online_guests.set', guestMay: 'spot' } as ServiceCommand)
      const file = await readBookingFile(world.app, world.tenantId, world.venueId, NOW)
      expect(BookingFileSchema.parse(file)).toEqual(file)
      expect(file?.plans).toHaveLength(1)
      expect(file?.plans[0]?.name).toBe('Ground floor')
      expect(file?.plans[0]?.spots.map((one) => one.name)).toEqual(['Bar 1', 'T1', 'T2', 'T3'])
      expect(file?.plans[0]?.spots[0]).toEqual({
        id: spot('Bar 1'),
        name: 'Bar 1',
        symbol: 'dot',
        seats: 4,
        area: null,
        shape: 'rect',
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        rotation: 0,
      })
      expect(file?.plans[0]?.spots[1]).toMatchObject({ name: 'T1', seats: 6, area: hallId })
      const text = JSON.stringify(file)
      for (const tableId of world.tables) expect(text).not.toContain(tableId)
      expect(text).not.toContain(world.tenantId)
      expect(text).not.toContain('"Table"')
      // The worker's walk finds nothing either: no table id, code or code hash, no tenant id.
      if (file === null) throw new Error('no file')
      const scope = { tenantId: world.tenantId, venueId: world.venueId }
      const backend = await bookingBackendValues(world.app, file, scope)
      for (const tableId of world.tables) expect(backend.has(tableId)).toBe(true)
      expect(forbiddenPaths(file, backend)).toEqual([])
    })

    it('says free or taken per spot, and nothing else; a blocked spot reads taken', async () => {
      expect(await statesOn(NEXT_FRIDAY)).toEqual({
        [spot('Bar 1')]: 'free',
        [spot('T1')]: 'free',
        [spot('T2')]: 'free',
        [spot('T3')]: 'free',
      })
      await accept({
        type: 'block.save',
        serviceDate: NEXT_FRIDAY,
        startsAt: '2026-10-30T20:00:00.000Z',
        endsAt: '2026-10-31T02:00:00.000Z',
        spotIds: [spot('Bar 1')],
      } as ServiceCommand)
      const picked = await ask({ serviceDate: NEXT_FRIDAY, spotIds: [spot('T2')] })
      expect(picked.status).toBe('accepted')
      expect(await statesOn(NEXT_FRIDAY)).toEqual({
        [spot('Bar 1')]: 'taken',
        [spot('T1')]: 'free',
        [spot('T2')]: 'taken',
        [spot('T3')]: 'free',
      })
      // Not offered, or not a night that can be booked: no answer at all.
      expect(await statesOn('2026-10-22')).toBeNull()
    })

    it('lets exactly one of two guests racing for one spot have it', async () => {
      const answers = await world.saveTogether([
        () => ask({ spotIds: [spot('T3')], guestName: 'First' }),
        () => ask({ spotIds: [spot('T3')], guestName: 'Second' }),
      ])
      const won = answers.filter((answer) => answer.status === 'accepted')
      const lost = answers.filter((answer) => answer.status === 'refused')
      expect(won).toHaveLength(1)
      expect(lost).toHaveLength(1)
      expect(lost[0]).toMatchObject({ code: 'spot_taken' })
      const holders = await world.owner.query<{ reservation_id: string }>(
        `select reservation_id from restro.reservation_spots
        where spot_id = $1 and released_at is null`,
        [spot('T3')],
      )
      expect(holders.rows).toHaveLength(1)
      // The one who lost asks again for the spot: refused by name, for the page to show the plan again.
      expect(await ask({ spotIds: [spot('T3')] })).toMatchObject({ code: 'spot_taken' })
    })

    it('confirms itself only where the guest picked a spot, with the confirmed email owed', async () => {
      await accept({ type: 'reservation_online_guests.set', autoConfirm: true } as ServiceCommand)
      owed = []
      const plain = await ask({ guestName: 'No spot' })
      expect(plain).toMatchObject({ status: 'accepted', details: { status: 'requested' } })
      if (plain.status !== 'accepted') return
      expect((await reservationOf(plain.details.reservationId))?.status).toBe('requested')
      expect(owed).toEqual([])

      const mine = await ask({ spotIds: [spot('T1')], guestName: 'Own spot' })
      expect(mine).toMatchObject({ status: 'accepted', details: { status: 'reserved' } })
      if (mine.status !== 'accepted') return
      expect((await reservationOf(mine.details.reservationId))?.status).toBe('reserved')
      const moves = await world.owner.query<{
        seq: string
        kind: string
        from_state: string | null
        to_state: string
        reason: string | null
      }>(
        `select seq, kind, from_state, to_state, reason from restro.log_entries
        where reservation_id = $1 order by seq`,
        [mine.details.reservationId],
      )
      expect(moves.rows.map(({ seq: _seq, ...line }) => line)).toEqual([
        { kind: 'reservation.created', from_state: null, to_state: 'requested', reason: 'online' },
        {
          kind: 'reservation.status',
          from_state: 'requested',
          to_state: 'reserved',
          reason: 'auto_confirm',
        },
      ])
      expect(owed).toEqual([
        {
          tenantId: world.tenantId,
          venueId: world.venueId,
          reservationId: mine.details.reservationId,
          kind: 'reservation_confirmed',
          entry: Number(moves.rows[1]?.seq),
        },
      ])
    })

    it('answers a true repeat once, and refuses a repeat with another pick by name (#580 review)', async () => {
      const mine = phone()
      const first = await ask({ phone: mine, serviceDate: NEXT_FRIDAY, spotIds: [spot('T1')] })
      expect(first).toMatchObject({ status: 'accepted', details: { repeated: false } })
      if (first.status !== 'accepted') return
      // The same pick again is the same request: answered with the booking he has.
      expect(
        await ask({ phone: mine, serviceDate: NEXT_FRIDAY, spotIds: [spot('T1')] }),
      ).toMatchObject({
        status: 'accepted',
        details: { reservationId: first.details.reservationId, repeated: true },
      })
      // Another spot, or none, is not dropped without a word: the page says he already asked.
      for (const spotIds of [[spot('T3')], []]) {
        expect(await ask({ phone: mine, serviceDate: NEXT_FRIDAY, spotIds })).toMatchObject({
          status: 'refused',
          code: 'already_requested',
        })
      }
      const held = await world.owner.query<{ spot_id: string }>(
        `select spot_id from restro.reservation_spots
        where reservation_id = $1 and released_at is null`,
        [first.details.reservationId],
      )
      expect(held.rows.map((row) => row.spot_id)).toEqual([spot('T1')])
    })

    it('leaves the spots of a hidden Area out of the file and refuses them at the write (D95)', async () => {
      const hidden = await setAreaHidden(world.app, world.tenantId, hallId, true)
      expect(hidden.ok).toBe(true)
      try {
        const file = await readBookingFile(world.app, world.tenantId, world.venueId, NOW)
        // A spot with no Table belongs to no Area, and stays bookable.
        expect(file?.plans[0]?.spots.map((one) => one.name)).toEqual(['Bar 1'])
        expect(await ask({ serviceDate: NEXT_FRIDAY, spotIds: [spot('T3')] })).toMatchObject({
          status: 'refused',
          code: 'spot_missing',
        })
      } finally {
        const shown = await setAreaHidden(world.app, world.tenantId, hallId, false)
        expect(shown.ok).toBe(true)
      }
      const file = await readBookingFile(world.app, world.tenantId, world.venueId, NOW)
      expect(file?.plans[0]?.spots.map((one) => one.name)).toEqual(['Bar 1', 'T1', 'T2', 'T3'])
    })

    it('lets exactly one of a block with no end and a guest on a later night have a spot (#580 review)', async () => {
      const plan = await world.owner.query<{ plan_id: string }>(
        'select plan_id from restro.spots where id = $1',
        [spot('Bar 1')],
      )
      const nine = await accept({
        type: 'spot.save',
        planId: plan.rows[0]?.plan_id,
        name: 'Bar 9',
        kind: 'table',
        shape: 'rect',
        x: 0,
        y: 200,
        width: 80,
        height: 80,
      } as ServiceCommand)
      const spotId = nine.spotId as string
      // The block starts on Friday and has no end: it is in the way of the guest's next Friday.
      const answers = await world.saveTogether([
        () =>
          run({
            type: 'block.save',
            serviceDate: FRIDAY,
            startsAt: FRIDAY_OPENS,
            spotIds: [spotId],
          } as ServiceCommand),
        () => ask({ serviceDate: NEXT_FRIDAY, spotIds: [spotId], guestName: 'Late guest' }),
      ])
      const won = answers.filter((answer) => answer.status === 'accepted')
      const lost = answers.filter((answer) => answer.status === 'refused')
      expect(won).toHaveLength(1)
      expect(lost).toHaveLength(1)
      expect(lost[0]).toMatchObject({ code: 'spot_taken' })
      const holders = await world.owner.query<{ reservation_id: string }>(
        `select reservation_id from restro.reservation_spots
        where spot_id = $1 and released_at is null`,
        [spotId],
      )
      expect(holders.rows).toHaveLength(1)
    })
  },
)
