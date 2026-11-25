// Answering an online request (#578; spec #322, Implementation Decision 2), on a real Postgres as
// the restro_app role: Confirm gives the request its spots in the same command, a spot somebody
// took meanwhile is refused by name and nothing is written, Decline frees what it held, a role
// without tonight's reservations is refused, and the night's end declines a request nobody
// answered — each with its Log entry and the email it owes. Skipped without a database.
//
// A request is seeded by the owner role: the booking page that makes them is part 2's, so no
// command writes Requested yet.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import type { Id } from '../../ids'
import { DEFAULT_ORDERING_SETTINGS, type ServiceHours } from '../../ordering-settings'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceActor, ServiceContext } from '../context'
import type { ServiceCommand } from '../index'
import { nightEndGuestEmailJobs } from './guest-email'

// Friday nights: open 22:00, closes 05:30 (Sofia, service day 07:00), as the night's end test.
const HOURS: ServiceHours = {
  ...DEFAULT_ORDERING_SETTINGS.serviceHours,
  fri: { opens: '22:00', lastOrders: '04:30', closes: '05:30' },
}
/** Friday 23 October 2026's night. */
const NIGHT = '2026-10-23'
/** 02:00 in Sofia, during that night: answering happens now, and ending the night is early. */
const NOW = new Date('2026-10-23T23:00:00Z')
/** 23:00 in Sofia on that night: every party's hour here. */
const AT = '2026-10-23T20:00:00.000Z'

describe.skipIf(!hasDatabase)('answering an online request (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let hostessId: string
  /** Blocks spots and nothing else: no answer to a request. */
  let blockerId: string
  const spots = new Map<string, string>()
  const spotId = (name: string) => spots.get(name) as Id<'sp'>

  const staff = (userId: string, jobId = `req-${randomUUID()}`): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
    jobId,
    signedInAt: NOW,
    now: NOW,
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

  /** A booking on the night, at the hour, holding these spots. */
  const book = async (spotNames: readonly string[], over: Record<string, unknown> = {}) =>
    (
      await accept({
        type: 'reservation.create',
        serviceDate: NIGHT,
        startsAt: AT,
        kind: 'booking',
        status: 'reserved',
        partySize: 4,
        guestName: `Guest ${randomUUID().slice(0, 6)}`,
        phone: `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
        spotIds: spotNames.map(spotId),
        ...over,
      } as ServiceCommand)
    ).reservationId as Id<'rv'>

  /** An online request: a booking the owner role turns back into one nobody answered yet. */
  const request = async (email: string | null, spotNames: readonly string[] = []) => {
    const id = await book(spotNames)
    await world.owner.query(`update restro.reservations set status = 'requested' where id = $1`, [
      id,
    ])
    const guestId = (await row(id)).guest_id
    if (guestId === null) throw new Error('a booking with a phone has a guest record')
    if (email !== null) await accept({ type: 'guest.save', guestId, email } as ServiceCommand)
    return id
  }

  const row = async (id: string) => {
    const found = (
      await world.owner.query<{
        status: string
        guest_id: string | null
        ended_at: Date | null
      }>('select status, guest_id, ended_at from restro.reservations where id = $1', [id])
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
  const statusLines = async (id: string) =>
    (
      await world.owner.query<{
        seq: string
        from_state: string | null
        to_state: string | null
        reason: string | null
        job_id: string
      }>(
        `select seq::text, from_state, to_state, reason, job_id from restro.log_entries
          where reservation_id = $1 and kind = 'reservation.status' order by seq`,
        [id],
      )
    ).rows

  beforeAll(async () => {
    world = await openServiceWorld('answer')
    ownerId = await world.addUser('owner')
    hostessId = await world.addUser('member')
    await world.addStaff(['reservations.tonight'], hostessId)
    blockerId = await world.addUser('member')
    await world.addStaff(['reservations.block'], blockerId)
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, serviceHours: HOURS })],
    )
    await accept({ type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand)
    const planId = (await accept({ type: 'plan.save', name: 'Hall', makeCurrent: true }))
      .planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    for (const [index, name] of ['T1', 'T2', 'T3', 'T4', 'T5'].entries()) {
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

  it('confirms a request with the spots chosen, in one command, and owes the guest an email', async () => {
    const id = await request('guest@example.com')
    const details = await accept(
      { type: 'reservation.confirm', reservationId: id, spotIds: [spotId('T1')] },
      staff(hostessId),
    )
    expect(await row(id)).toMatchObject({ status: 'reserved', ended_at: null })
    expect(await heldNames(id)).toEqual(['T1'])
    const lines = await statusLines(id)
    expect(lines.at(-1)).toMatchObject({ from_state: 'requested', to_state: 'reserved' })
    expect(details).toEqual({
      reservationId: id,
      guestEmail: 'reservation_confirmed',
      guestEmailEntry: Number(lines.at(-1)?.seq),
    })
    expect(JSON.stringify(details)).not.toContain('example.com')
    // Only a request is confirmed: a second Confirm is refused by name.
    expect(
      await run({ type: 'reservation.confirm', reservationId: id }, staff(hostessId)),
    ).toMatchObject({ status: 'refused' })
  })

  it('keeps the spots a request already holds when none are chosen', async () => {
    const id = await request(null, ['T2'])
    const details = await accept({ type: 'reservation.confirm', reservationId: id })
    expect(await heldNames(id)).toEqual(['T2'])
    // No address, no email.
    expect(details).not.toHaveProperty('guestEmail')
  })

  it('refuses a spot somebody took meanwhile, naming it and its party, and writes nothing', async () => {
    const id = await request('guest@example.com')
    const holder = await book(['T3'])
    const before = await statusLines(id)
    expect(
      await run(
        { type: 'reservation.confirm', reservationId: id, spotIds: [spotId('T3')] },
        staff(hostessId),
      ),
    ).toMatchObject({
      status: 'refused',
      code: 'spot_taken',
      details: { spotId: spotId('T3'), reservationId: holder },
    })
    expect(await row(id)).toMatchObject({ status: 'requested' })
    expect(await heldNames(id)).toEqual([])
    expect(await statusLines(id)).toEqual(before)
  })

  it('declines a request: Declined, its spots freed, its end stamped, the guest owed an email', async () => {
    const id = await request('guest@example.com', ['T4'])
    const details = await accept(
      { type: 'reservation.decline', reservationId: id },
      staff(hostessId),
    )
    const after = await row(id)
    expect(after.status).toBe('declined')
    expect(after.ended_at).not.toBeNull()
    expect(await heldNames(id)).toEqual([])
    const lines = await statusLines(id)
    expect(lines.at(-1)).toMatchObject({ from_state: 'requested', to_state: 'declined' })
    expect(details).toEqual({
      reservationId: id,
      guestEmail: 'reservation_declined',
      guestEmailEntry: Number(lines.at(-1)?.seq),
    })
    // Declined is final: it is neither confirmed nor declined again, and a booking is never declined.
    expect(await run({ type: 'reservation.confirm', reservationId: id })).toMatchObject({
      status: 'refused',
    })
    expect(await run({ type: 'reservation.decline', reservationId: id })).toMatchObject({
      status: 'refused',
    })
    const booking = await book([])
    expect(await run({ type: 'reservation.decline', reservationId: booking })).toMatchObject({
      status: 'refused',
    })
  })

  it('refuses a role that does not work tonight’s reservations, and writes nothing', async () => {
    const id = await request('guest@example.com')
    const before = await statusLines(id)
    const commands: readonly ServiceCommand[] = [
      { type: 'reservation.confirm', reservationId: id, spotIds: [spotId('T5')] },
      { type: 'reservation.decline', reservationId: id },
    ]
    for (const command of commands) {
      expect(await run(command, staff(blockerId))).toMatchObject({
        status: 'refused',
        code: 'permission_denied',
      })
    }
    expect(await row(id)).toMatchObject({ status: 'requested' })
    expect(await statusLines(id)).toEqual(before)
  })

  it('declines at the night’s end a request nobody answered, and finds its email by its job', async () => {
    const answered = await request('kept@example.com')
    await accept({ type: 'reservation.confirm', reservationId: answered })
    const unanswered = await request('guest@example.com', ['T5'])
    const silent = await request(null)
    const jobId = `req-${randomUUID()}`
    const ended = await accept({ type: 'night.end' } as ServiceCommand, staff(ownerId, jobId))
    expect(ended).toMatchObject({ changed: true })
    // Every request left from the tests above, plus these two (one with an address, one without).
    expect(Number(ended.declined)).toBeGreaterThanOrEqual(2)
    expect(await row(unanswered)).toMatchObject({ status: 'declined' })
    expect(await row(silent)).toMatchObject({ status: 'declined' })
    expect(await heldNames(unanswered)).toEqual([])
    const line = (await statusLines(unanswered)).at(-1)
    expect(line).toMatchObject({
      from_state: 'requested',
      to_state: 'declined',
      reason: 'night_ended',
      job_id: jobId,
    })
    // The confirmed one is a booking now: the night's end makes it a no-show, never Declined.
    expect(await row(answered)).toMatchObject({ status: 'no_show' })

    const jobs = await nightEndGuestEmailJobs(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      jobId,
    })
    const mine = jobs.filter((job) => job.reservationId === unanswered)
    expect(mine).toEqual([
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        reservationId: unanswered,
        kind: 'reservation_declined',
        entry: Number(line?.seq),
      },
    ])
    // A guest with no address is not in the list; another job's entries never are.
    expect(jobs.some((job) => job.reservationId === silent)).toBe(false)
    expect(
      await nightEndGuestEmailJobs(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        jobId: `req-${randomUUID()}`,
      }),
    ).toEqual([])
  })
})
