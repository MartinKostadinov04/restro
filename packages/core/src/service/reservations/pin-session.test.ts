// The permissions, where the PIN falls and the session on a remembered device, on a real Postgres
// as the restro_app role (ticket #324; D141 12.9 to 12.11). What only a database can show is
// pinned here: that the reservation permissions decide one by one, so a role that holds tonight's
// floor does not hold the booking book; that a shared device lets D141's taps through and asks for
// four digits on the booking book; that a venue may move a line either way and the next command
// obeys it; that a PIN starts the person's own short session on the device, which their writes
// push forward and a few idle minutes end; and that a person who has left has no session.
// Skipped without a database.
import { generateKeyPairSync, randomUUID } from 'node:crypto'

import { withTenant } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import type { Id } from '../../ids'
import { PinGuard } from '../../pin-guard'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceActor, ServiceContext } from '../context'
import { identifyStaffByPin } from '../identify'
import type { ServiceCommand } from '../index'
import { pinHmac } from '../pins'
import { devicePersonOf } from '../shared-device'

const { publicKey } = generateKeyPairSync('x25519')
const PEPPER = 'a-test-pepper-of-at-least-32-characters'
const OPTIONS = { sealPublicKey: publicKey, pinPepper: PEPPER }

/** The venue's turn time, as a club's would be. */
const TURN = 90

/** The night these tests work on, and an hour of it as an instant. */
const NIGHT = '2026-12-12'
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 11, 12, hour, minute, 0)).toISOString()

describe.skipIf(!hasDatabase)('reservations: the permissions and the shared device', () => {
  let world: ServiceWorld
  /** The organisation's owner: holds every permission (D122 §7). */
  let ownerId: string
  /** The bar tablet's own account, staff-only, and the session that names the device. */
  let tabletId: string
  let tabletSession: string
  /** The hostess: tonight's floor, the booking book and the reservation settings. */
  let hostessStaffId: string
  let hostessPin: string
  /** Someone else with a PIN, to take the device over. */
  let barmanStaffId: string
  let barmanPin: string
  /** A spot of the venue's plan: the walk-in's table. */
  let spotT1: Id<'sp'>

  beforeAll(async () => {
    world = await openServiceWorld('reservations-pin')
    ownerId = await world.addUser('owner')
    tabletId = await world.addUser('member')
    tabletSession = `sess-${randomUUID()}`
    await world.addSharedDevice(tabletSession)
    hostessStaffId = await world.addStaff([
      'reservations.tonight',
      'reservations.manage',
      'settings.reservations',
    ])
    barmanStaffId = await world.addStaff(['reservations.tonight'])
    hostessPin = await givePin(hostessStaffId)
    barmanPin = await givePin(barmanStaffId)
    await accept({ type: 'reservation_settings.set', turnMinutes: TURN })
    // One spot, so seating a walk-in has somewhere to go (#329).
    const planId = (await accept({ type: 'plan.save', name: 'Hall', makeCurrent: true }))
      .planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    spotT1 = (
      await accept({
        type: 'spot.save',
        planId,
        name: 'T1',
        kind: 'table',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      } as ServiceCommand)
    ).spotId as Id<'sp'>
  })

  afterAll(async () => {
    await world?.close()
  })

  const context = (actor: ServiceActor): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor,
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })
  const owner = (): ServiceActor => ({
    kind: 'user',
    userId: ownerId,
    sessionId: `sess-${randomUUID()}`,
  })
  /** The tablet's own account on the shared device: nobody has typed a PIN. */
  const tablet = (): ServiceActor => ({ kind: 'user', userId: tabletId, sessionId: tabletSession })
  /** A person named by their PIN on the device. */
  const person = (staffMemberId: string): ServiceActor => ({
    kind: 'staff',
    staffMemberId,
    sessionId: tabletSession,
  })

  const run = async (command: ServiceCommand, actor: ServiceActor = owner()) =>
    (await applyService(world.app, command, context(actor), OPTIONS)).result

  async function accept(
    command: ServiceCommand,
    actor: ServiceActor = owner(),
  ): Promise<Record<string, unknown>> {
    const result = await run(command, actor)
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }

  /** A booking of the night, by the owner, so each test works on a party of its own. */
  async function book(hour: number, minute = 0): Promise<Id<'rv'>> {
    const details = await accept({
      type: 'reservation.create',
      serviceDate: NIGHT,
      startsAt: at(hour, minute),
      kind: 'booking',
      status: 'reserved',
      partySize: 4,
      partyLabel: `Party ${hour}:${minute}`,
      phone: '+359888765432',
    })
    return details.reservationId as Id<'rv'>
  }

  /** Gives a person a PIN and finds it, as the staff tests do (the seal is never opened). */
  async function givePin(staffMemberId: string): Promise<string> {
    await accept({ type: 'pin.reset', staffMemberId: staffMemberId as Id<'sm'> })
    const { rows } = await world.owner.query<{ pin_hmac: string | null }>(
      'select pin_hmac from restro.staff_members where id = $1',
      [staffMemberId],
    )
    for (let n = 0; n < 10_000; n += 1) {
      const pin = String(n).padStart(4, '0')
      if (pinHmac(PEPPER, world.tenantId, pin) === rows[0]?.pin_hmac) return pin
    }
    throw new Error('no PIN matches')
  }

  /** Moves one line of "Where the PIN falls" at this venue. */
  const move = async (action: string, fall: 'tap' | 'pin') =>
    accept({ type: 'reservation_settings.set', pinActions: { [action]: fall } } as ServiceCommand)

  /** Who the device has on it now, through the read the web app uses. */
  const personOn = (now = new Date()) =>
    withTenant(world.app, world.tenantId, (tx) =>
      devicePersonOf(tx, { venueId: world.venueId, sessionId: tabletSession, now }),
    )

  /** When the device last saw its person act. */
  async function personAtOf(): Promise<Date | null> {
    const { rows } = await world.owner.query<{ person_at: Date | null }>(
      'select person_at from restro.shared_devices where session_id = $1',
      [tabletSession],
    )
    return rows[0]?.person_at ?? null
  }

  it('gives each reservation permission on its own, and nothing with it', async () => {
    const tonightOnly = await world.addStaff(['reservations.tonight'])
    const bookOnly = await world.addStaff(['reservations.manage'])
    const party = await book(21)
    const seat = { type: 'reservation.arrive', reservationId: party } as const
    const newBooking = {
      type: 'reservation.create',
      serviceDate: NIGHT,
      startsAt: at(21, 30),
      kind: 'booking',
      status: 'reserved',
      partySize: 2,
      partyLabel: 'Another',
      phone: '+359888765432',
    } as const
    // Taking a booking is the hostess's key (#328); changing one is the booking book's, and the
    // book's key does not take one.
    const edit = { type: 'reservation.edit', reservationId: party, partySize: 5 } as const
    expect(await run(edit, person(tonightOnly))).toMatchObject({ code: 'permission_denied' })
    expect(await run(seat, person(tonightOnly))).toMatchObject({ status: 'accepted' })
    expect(await run(newBooking, person(tonightOnly))).toMatchObject({ status: 'accepted' })
    expect(await run(newBooking, person(bookOnly))).toMatchObject({ code: 'permission_denied' })
    expect(await run(edit, person(bookOnly))).toMatchObject({ status: 'accepted' })
    // Blocking a spot and ending the night are keys of their own again.
    expect(
      await run({ type: 'block.remove', reservationId: party }, person(bookOnly)),
    ).toMatchObject({ code: 'permission_denied' })
    expect(
      await run({ type: 'reservation_night.close', serviceDate: NIGHT }, person(bookOnly)),
    ).toMatchObject({ code: 'permission_denied' })
    // A PIN never reaches the settings-class two, whoever's PIN it is (`isSettingsPermission`).
    expect(
      await run(
        { type: 'reservation_settings.set', turnMinutes: 120 } as ServiceCommand,
        person(hostessStaffId),
      ),
    ).toMatchObject({ code: 'own_sign_in_required' })
  })

  it('lets D141s taps through on the tablet and asks for four digits on the booking book', async () => {
    const party = await book(22)
    // "If the tap only says where people are sitting tonight, it is a tap."
    expect(await run({ type: 'reservation.arrive', reservationId: party }, tablet())).toMatchObject(
      { status: 'accepted' },
    )
    expect(
      await run(
        { type: 'waiting.add', serviceDate: NIGHT, partySize: 3 } as ServiceCommand,
        tablet(),
      ),
    ).toMatchObject({ status: 'accepted' })
    // "If it writes the booking book […] or ends the night, it is four digits."
    expect(await run({ type: 'reservation.cancel', reservationId: party }, tablet())).toMatchObject(
      {
        code: 'pin_required',
      },
    )
    expect(
      await run({ type: 'reservation_night.close', serviceDate: NIGHT }, tablet()),
    ).toMatchObject({ code: 'pin_required' })
    // Seating a walk-in is a tap in D141, and the hostess's key in the code (#328): the tablet's
    // own account holds it, so the tap goes through. Taking a booking is four digits.
    expect(
      await run(
        {
          type: 'reservation.seat_walk_in',
          serviceDate: NIGHT,
          spotIds: [spotT1],
          partySize: 2,
          partyLabel: 'Walk-in',
        } as ServiceCommand,
        tablet(),
      ),
    ).toMatchObject({ status: 'accepted' })
    expect(
      await run(
        {
          type: 'reservation.create',
          serviceDate: NIGHT,
          startsAt: at(23, 30),
          kind: 'booking',
          status: 'reserved',
          partySize: 2,
          partyLabel: 'By phone',
          phone: '+359888765432',
        } as ServiceCommand,
        tablet(),
      ),
    ).toMatchObject({ code: 'pin_required' })
  })

  it('obeys the venues own choice, in both directions', async () => {
    const party = await book(23)
    const seat = { type: 'reservation.arrive', reservationId: party } as const
    await move('status', 'pin')
    expect(await run(seat, tablet())).toMatchObject({ code: 'pin_required' })
    // The person's PIN still does it, and their own role decides as always.
    expect(await run(seat, person(hostessStaffId))).toMatchObject({ status: 'accepted' })
    await move('status', 'tap')
    const next = await book(23, 30)
    expect(await run({ type: 'reservation.arrive', reservationId: next }, tablet())).toMatchObject({
      status: 'accepted',
    })
    // A line moved the other way: this venue wants a name on the waiting list.
    await move('waiting', 'pin')
    expect(
      await run(
        { type: 'waiting.add', serviceDate: NIGHT, partySize: 5 } as ServiceCommand,
        tablet(),
      ),
    ).toMatchObject({ code: 'pin_required' })
    // What the night's record says about where the PIN fell while it was being kept.
    const { rows } = await world.owner.query<{ details: Record<string, unknown> }>(
      `select details from restro.log_entries
       where venue_id = $1 and kind = 'reservation_settings.changed' order by seq desc limit 1`,
      [world.venueId],
    )
    expect(String(rows[0]?.details.pinFall)).toContain('waiting')
    expect(String(rows[0]?.details.pinFall)).toContain('end_night')
    expect(String(rows[0]?.details.pinFall)).not.toContain('status')
    await move('waiting', 'tap')
  })

  it('starts the persons own short session with the PIN, and keeps it while they work', async () => {
    const guard = new PinGuard()
    const identify = (pin: string) =>
      identifyStaffByPin(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        userId: tabletId,
        sessionId: tabletSession,
        pin,
        pepper: PEPPER,
        guard,
        jobId: `req-${randomUUID()}`,
      })
    const party = await book(20)

    expect(await identify(hostessPin)).toMatchObject({ ok: true, staffMemberId: hostessStaffId })
    expect(await personOn()).toMatchObject({ staffMemberId: hostessStaffId })
    // A write of hers pushes the session forward: a run of record work is typed once, not once per
    // action, and nobody is cut off mid-task.
    const before = await personAtOf()
    await accept(
      { type: 'reservation.edit', reservationId: party, partySize: 6 },
      person(hostessStaffId),
    )
    expect((await personAtOf())?.getTime() ?? 0).toBeGreaterThanOrEqual(before?.getTime() ?? 0)
    expect(await personOn()).toMatchObject({ staffMemberId: hostessStaffId })

    // A few idle minutes and the device has nobody on it again.
    expect(await personOn(new Date(Date.now() + 10 * 60_000))).toBeNull()
    // Another PIN takes the device over; a device holds one person at a time.
    expect(await identify(barmanPin)).toMatchObject({ ok: true, staffMemberId: barmanStaffId })
    expect(await personOn()).toMatchObject({ staffMemberId: barmanStaffId })
    // Someone who has left has no session, even inside the window.
    await accept({ type: 'staff.archive', staffMemberId: barmanStaffId as Id<'sm'> })
    expect(await personOn()).toBeNull()
  })
})
