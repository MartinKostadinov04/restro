// The booking page's writes and reads (#577; spec #322 Implementation Decisions 1 and 2, stories 1–9,
// 26, 30, 32, 33), on a real Postgres as the restro_app role: the owner's switch, a guest's request
// behind Turnstile that lands as Requested on a guest record, the nights it refuses (closed, outside
// the hours, past, the page off), the narrow night answer, and the booking file the worker
// publishes. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import { BookingFileSchema } from '../../guest-files'
import { DEFAULT_ORDERING_SETTINGS, type ServiceHours } from '../../ordering-settings'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import { readBookingFile, readBookingNight, requestBooking } from '../booking'
import type { ServiceActor, ServiceContext } from '../context'
import type { HumanCheck } from '../guest'
import type { ServiceCommand } from '../index'

// Friday nights only: open 22:00, closes 05:30 (Sofia, service day 07:00).
const HOURS: ServiceHours = {
  ...DEFAULT_ORDERING_SETTINGS.serviceHours,
  fri: { opens: '22:00', lastOrders: '04:30', closes: '05:30' },
}
/** Tuesday 20 October 2026, 13:00 in Sofia. */
const NOW = new Date('2026-10-20T10:00:00Z')
/** That week's Friday: open. */
const FRIDAY = '2026-10-23'
/** The Friday after: one of the venue's closed dates. */
const CLOSED_FRIDAY = '2026-10-30'
/** That week's Thursday: the venue keeps Thursdays closed. */
const THURSDAY = '2026-10-22'
/** The Friday before: past. */
const LAST_FRIDAY = '2026-10-16'

const passes: HumanCheck = async () => 'passed'
const fails: HumanCheck = async () => 'failed'

describe.skipIf(!hasDatabase)('the booking page (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string

  const staff = (userId: string): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt: NOW,
    now: NOW,
  })
  const run = async (command: ServiceCommand, context: ServiceContext = staff(ownerId)) =>
    (await applyService(world.app, command, context)).result
  async function accept(command: ServiceCommand) {
    const result = await run(command)
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }

  const phone = () => `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`
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
      ...over,
    })

  const reservationsOfNight = async (night: string) =>
    (
      await world.owner.query<{ id: string }>(
        'select id from restro.reservations where venue_id = $1 and service_date = $2',
        [world.venueId, night],
      )
    ).rows

  beforeAll(async () => {
    world = await openServiceWorld('booking-page')
    ownerId = await world.addUser('owner')
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, serviceHours: HOURS })],
    )
  }, 60_000)

  afterAll(async () => {
    await world?.close()
  })

  it('is off until the venue has its settings and an owner switches the page on', async () => {
    expect(await run({ type: 'reservation_online.set', bookingPage: true })).toMatchObject({
      status: 'refused',
      code: 'settings_missing',
    })
    expect(await ask()).toMatchObject({ status: 'refused', code: 'booking_off' })
    await accept({ type: 'reservation_settings.set', turnMinutes: 120 } as ServiceCommand)
    expect(await ask()).toMatchObject({ status: 'refused', code: 'booking_off' })
    expect(await readBookingNight(world.app, world.tenantId, world.venueId, FRIDAY, NOW)).toBe(
      'booking_off',
    )

    expect(await accept({ type: 'reservation_online.set', bookingPage: true })).toEqual({
      bookingPage: true,
    })
    // Setting it again writes nothing: one Log line for the one change.
    await accept({ type: 'reservation_online.set', bookingPage: true })
    const lines = await world.owner.query<{ to_state: string }>(
      `select to_state from restro.log_entries
        where venue_id = $1 and kind = 'reservation_settings.changed' and to_state like 'booking_page%'`,
      [world.venueId],
    )
    expect(lines.rows.map((line) => line.to_state)).toEqual(['booking_page_on'])
    const online = await world.owner.query<{ online: { bookingPage: boolean; guestMay: string } }>(
      'select online from restro.reservation_settings where venue_id = $1',
      [world.venueId],
    )
    // Only the switch moved: the rest of part 2's values keep their defaults.
    expect(online.rows[0]?.online).toMatchObject({ bookingPage: true, guestMay: 'night' })
    await accept({ type: 'reservation_closed_date.add', date: CLOSED_FRIDAY } as ServiceCommand)
  })

  it('refuses a request without a passing Turnstile check, before anything is written', async () => {
    const guards: string[] = []
    const without = await ask({ humanToken: undefined, onGuard: (kind) => guards.push(kind) })
    expect(without).toMatchObject({ status: 'refused', code: 'human_check' })
    expect(await ask({ humanCheck: fails })).toMatchObject({ code: 'human_check' })
    expect(await ask({ humanCheck: undefined })).toMatchObject({ code: 'human_check' })
    expect(guards).toEqual(['human_check_failed'])
    expect(await reservationsOfNight(FRIDAY)).toEqual([])
  })

  it('lands a request as Requested, with no spot, on a guest record holding the address', async () => {
    const number = phone()
    const result = await ask({ phone: number, partySize: 6, note: 'Birthday' })
    expect(result).toMatchObject({ status: 'accepted', details: { repeated: false } })
    const id = result.status === 'accepted' ? (result.details.reservationId as string) : ''
    const row = (
      await world.owner.query<{
        status: string
        kind: string
        party_size: number
        note: string | null
        made_by: string | null
        source: string
        starts_at: Date
        email: string | null
        name: string | null
        phone: string | null
        spots: string
      }>(
        `select r.status, r.kind, r.party_size, r.note, r.made_by, r.source, r.starts_at,
                g.email, g.name, g.phone,
                (select count(*) from restro.reservation_spots s where s.reservation_id = r.id)::text as spots
           from restro.reservations r join restro.guests g on g.id = r.guest_id
          where r.id = $1`,
        [id],
      )
    ).rows[0]
    expect(row).toMatchObject({
      status: 'requested',
      kind: 'booking',
      party_size: 6,
      note: 'Birthday',
      made_by: null,
      source: 'guest',
      email: 'maria@example.com',
      name: 'Maria',
      phone: number,
      spots: '0',
    })
    // It starts at the night's opening: 22:00 in Sofia.
    expect(row?.starts_at.toISOString()).toBe('2026-10-23T19:00:00.000Z')
    const log = await world.owner.query<{ to_state: string; reason: string; source: string }>(
      `select to_state, reason, source from restro.log_entries
        where reservation_id = $1 and kind = 'reservation.created'`,
      [id],
    )
    expect(log.rows).toEqual([{ to_state: 'requested', reason: 'online', source: 'guest' }])

    // Asking again for the same night is answered with the same request.
    const again = await ask({ phone: number })
    expect(again).toMatchObject({
      status: 'accepted',
      details: { reservationId: id, repeated: true },
    })
  })

  it('fills a known guest record but never replaces his name or address', async () => {
    const number = phone()
    const first = await ask({ phone: number, guestName: 'Ivan', email: 'ivan@example.com' })
    expect(first.status).toBe('accepted')
    // Somebody else, with Ivan's number, asks for another Friday.
    const second = await ask({
      phone: number,
      serviceDate: '2026-11-06',
      guestName: 'Not Ivan',
      email: 'someone@example.com',
    })
    expect(second.status).toBe('accepted')
    const record = await world.owner.query<{ name: string; email: string }>(
      `select name, email from restro.guests where venue_id = $1 and phone = $2`,
      [world.venueId, number],
    )
    expect(record.rows).toEqual([{ name: 'Ivan', email: 'ivan@example.com' }])
  })

  it('refuses a closed night, a night outside the hours and a night that has passed', async () => {
    expect(await ask({ serviceDate: CLOSED_FRIDAY })).toMatchObject({ code: 'closed_night' })
    expect(await ask({ serviceDate: THURSDAY })).toMatchObject({ code: 'outside_hours' })
    expect(await ask({ serviceDate: LAST_FRIDAY })).toMatchObject({ code: 'night_passed' })
    expect(await ask({ serviceDate: '2027-06-04' })).toMatchObject({ code: 'too_far' })
    expect(await ask({ phone: '12' })).toMatchObject({ code: 'invalid_command' })
    for (const night of [CLOSED_FRIDAY, THURSDAY, LAST_FRIDAY]) {
      expect(await reservationsOfNight(night), night).toEqual([])
    }
  })

  it('takes no status, spot, time or id from the guest', async () => {
    const command = {
      type: 'reservation.request',
      actionId: randomUUID(),
      serviceDate: FRIDAY,
      partySize: 2,
      guestName: 'Eve',
      phone: phone(),
      email: 'eve@example.com',
    }
    const guest: ServiceContext = {
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'guest',
      actor: { kind: 'guest' },
      jobId: `guest-${randomUUID()}`,
      now: NOW,
    }
    for (const extra of [
      { status: 'reserved' },
      { spotIds: ['sp_0123456789ABCDEFGHIJKL'] },
      { startsAt: '2026-10-23T20:00:00.000Z' },
      { reservationId: 'rv_0123456789ABCDEFGHIJKL' },
    ]) {
      const { result } = await applyService(world.app, { ...command, ...extra }, guest)
      expect(result, JSON.stringify(extra)).toMatchObject({ code: 'invalid_command' })
    }
    // And a staff screen cannot send a guest's request.
    expect(await run(command as ServiceCommand)).toMatchObject({ code: 'origin_not_allowed' })
  })

  it('answers whether a night can be booked, and nothing more', async () => {
    const night = (date: string) =>
      readBookingNight(world.app, world.tenantId, world.venueId, date, NOW)
    expect(await night(FRIDAY)).toBe('open')
    expect(await night(CLOSED_FRIDAY)).toBe('closed_date')
    expect(await night(THURSDAY)).toBe('outside_hours')
    expect(await night(LAST_FRIDAY)).toBe('past')
    expect(
      await readBookingNight(world.app, world.tenantId, 'vn_0123456789ABCDEFGHIJKL', FRIDAY, NOW),
    ).toBeNull()
  })

  it('publishes the venue name, the switch, the hours and the closed dates from today, nothing internal', async () => {
    const file = await readBookingFile(world.app, world.tenantId, world.venueId, NOW)
    expect(BookingFileSchema.parse(file)).toEqual(file)
    expect(file).toMatchObject({
      venue_id: world.venueId,
      on: true,
      time_zone: 'Europe/Sofia',
      day_ends_at: '07:00',
      closed_dates: [CLOSED_FRIDAY],
    })
    expect(file?.hours.fri).toEqual({ opens: '22:00', closes: '05:30' })
    expect(file?.hours.thu).toBeNull()
    const text = JSON.stringify(file)
    expect(text).not.toContain(world.tenantId)
    expect(text).not.toContain('lastOrders')
    // A closed date that has passed is not published.
    const later = await readBookingFile(
      world.app,
      world.tenantId,
      world.venueId,
      new Date('2026-11-02T10:00:00Z'),
    )
    expect(later?.closed_dates).toEqual([])
  })

  it('switches the page off again, and a request is then refused', async () => {
    await accept({ type: 'reservation_online.set', bookingPage: false })
    expect(await ask()).toMatchObject({ code: 'booking_off' })
    const file = await readBookingFile(world.app, world.tenantId, world.venueId, NOW)
    expect(file?.on).toBe(false)
  })
})
