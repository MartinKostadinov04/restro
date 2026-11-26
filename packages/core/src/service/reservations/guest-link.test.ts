// The guest's own link to his booking (#579; spec #322 stories 8 and 34), on a real Postgres as the
// restro_app role: a request stores only its token's hash and owes the "We got your request" email;
// a token opens its own booking and no other; a link past its days, a tampered or a malformed token
// opens nothing; the Cancel calls the booking off with the guest as the Log's actor and owes the
// cancellation's email, once; and a Cancel once the night has started is refused. Skipped without a
// database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import type { Id } from '../../ids'
import { DEFAULT_ORDERING_SETTINGS, type ServiceHours } from '../../ordering-settings'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import { cancelGuestBooking, readGuestBooking, requestBooking } from '../booking'
import { GUEST_LINK_HASH_PATTERN, guestLinkToken, guestLinkTokenHash } from '../booking-link'
import type { ServiceActor, ServiceContext } from '../context'
import type { HumanCheck } from '../guest'
import type { ServiceCommand } from '../index'
import type { ServiceResult } from '../results'
import { guestEmailJobOf } from './guest-email'

// Friday nights only: open 22:00, closes 05:30 (Sofia, service day 07:00).
const HOURS: ServiceHours = {
  ...DEFAULT_ORDERING_SETTINGS.serviceHours,
  fri: { opens: '22:00', lastOrders: '04:30', closes: '05:30' },
}
/** Tuesday 20 October 2026, 13:00 in Sofia. */
const NOW = new Date('2026-10-20T10:00:00Z')
/** That week's Friday. */
const FRIDAY = '2026-10-23'
/** The Friday after. */
const NEXT_FRIDAY = '2026-10-30'
/** 23:00 in Sofia on FRIDAY: its night has started. */
const DURING_FRIDAY = new Date('2026-10-23T20:00:00Z')
/** Seven days after FRIDAY, 13:00 in Sofia: the link's last day. */
const LAST_DAY = new Date('2026-10-30T10:00:00Z')
/** Eight days after FRIDAY: the link has passed. */
const PASSED = new Date('2026-10-31T10:00:00Z')

const KEY = `test-guest-link-key-${'x'.repeat(32)}`
/** A booking that was never made. */
const NEVER_MADE = 'rv_0123456789ABCDEFGHIJKL'
const passes: HumanCheck = async () => 'passed'

describe.skipIf(!hasDatabase)("a guest's own link to his booking (as the restro_app role)", () => {
  let world: ServiceWorld
  let ownerId: string
  let t1: Id<'sp'>
  const queued: ServiceResult[] = []

  const staff = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: {
      kind: 'user',
      userId: ownerId,
      sessionId: `sess-${randomUUID()}`,
    } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt: NOW,
    now: NOW,
  })
  async function accept(command: ServiceCommand) {
    const { result } = await applyService(world.app, command, staff())
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }
  const queueJobs = async (result: ServiceResult) => {
    queued.push(result)
  }
  const scope = () => ({ tenantId: world.tenantId, venueId: world.venueId })

  /** A guest's request through the booking page, made with the link's key. */
  async function ask(over: { serviceDate?: string; partySize?: number } = {}) {
    const result = await requestBooking(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actionId: randomUUID(),
      serviceDate: over.serviceDate ?? FRIDAY,
      partySize: over.partySize ?? 4,
      guestName: 'Maria',
      phone: `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      email: 'maria@example.com',
      note: 'By the window',
      humanToken: 'token',
      humanCheck: passes,
      now: NOW,
      guestLinkKey: KEY,
      queueJobs,
    })
    if (result.status !== 'accepted') throw new Error(`request refused: ${result.code}`)
    const id = result.details.reservationId as Id<'rv'>
    return { id, token: guestLinkToken(KEY, id), result }
  }
  const open = (token: string, now: Date = NOW, venueId: string = world.venueId) =>
    readGuestBooking(world.app, { tenantId: world.tenantId, venueId, token, now })
  const cancel = (token: string, now: Date = NOW, withTurnstile = true) =>
    cancelGuestBooking(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      token,
      actionId: randomUUID(),
      ...(withTurnstile ? { humanToken: 'token' } : {}),
      humanCheck: passes,
      queueJobs,
      now,
    })
  const statusOf = async (id: string) =>
    (
      await world.owner.query<{ status: string }>(
        'select status from restro.reservations where id = $1',
        [id],
      )
    ).rows[0]?.status

  beforeAll(async () => {
    world = await openServiceWorld('guest-link')
    ownerId = await world.addUser('owner')
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, serviceHours: HOURS })],
    )
    await accept({ type: 'reservation_settings.set', turnMinutes: 120 } as ServiceCommand)
    await accept({ type: 'reservation_online.set', bookingPage: true })
    const planId = (await accept({ type: 'plan.save', name: 'Hall', makeCurrent: true }))
      .planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    const spot = await accept({
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
    t1 = spot.spotId as Id<'sp'>
  }, 60_000)

  afterAll(async () => {
    await world?.close()
  })

  it('stores only the hash of the token, made at booking, and owes the request email', async () => {
    queued.length = 0
    const { id, token, result } = await ask()
    const stored = (
      await world.owner.query<{ guest_token_hash: string | null }>(
        'select guest_token_hash from restro.reservations where id = $1',
        [id],
      )
    ).rows[0]?.guest_token_hash
    expect(stored).toMatch(GUEST_LINK_HASH_PATTERN)
    expect(stored).toBe(guestLinkTokenHash(token))
    expect(stored).not.toContain(token)
    // Neither the answer nor the Log carries the token or its hash.
    const log = await world.owner.query<{ details: unknown }>(
      'select details from restro.log_entries where reservation_id = $1',
      [id],
    )
    const text = JSON.stringify([result, log.rows])
    expect(text).not.toContain(token)
    expect(text).not.toContain(stored)
    expect(queued.map((one) => guestEmailJobOf(one, scope())?.kind)).toEqual([
      'reservation_requested',
    ])
  })

  it('opens its own booking and no other, and says nothing of the others', async () => {
    const first = await ask({ partySize: 4 })
    const second = await ask({ serviceDate: NEXT_FRIDAY, partySize: 2 })
    await accept({ type: 'reservation.confirm', reservationId: second.id, spotIds: [t1] })

    expect(await open(first.token)).toEqual({
      venueName: expect.any(String),
      night: FRIDAY,
      time: '22:00',
      partySize: 4,
      spots: [],
      state: 'requested',
      canCancel: true,
      nightStarted: false,
    })
    expect(await open(second.token)).toMatchObject({
      night: NEXT_FRIDAY,
      partySize: 2,
      spots: ['T1'],
      state: 'confirmed',
    })
    const text = JSON.stringify(await open(first.token))
    for (const hidden of [first.id, second.id, 'Maria', 'maria@example.com', 'By the window']) {
      expect(text).not.toContain(hidden)
    }
    // A tampered token, a malformed one, another key's token and another venue open nothing.
    const tampered = `${first.token.slice(0, -1)}${first.token.endsWith('A') ? 'B' : 'A'}`
    expect(await open(tampered)).toBeNull()
    expect(await open('not a token')).toBeNull()
    expect(await open('')).toBeNull()
    expect(await open(guestLinkToken(`another-key-${'y'.repeat(32)}`, first.id))).toBeNull()
    expect(await open(first.token, NOW, 'vn_0123456789ABCDEFGHIJKL')).toBeNull()
  })

  it('opens the booking up to seven days after its night, and nothing after', async () => {
    const { token } = await ask()
    expect(await open(token, DURING_FRIDAY)).toMatchObject({
      canCancel: false,
      nightStarted: true,
    })
    expect(await open(token, LAST_DAY)).toMatchObject({ night: FRIDAY, nightStarted: true })
    expect(await open(token, PASSED)).toBeNull()
    expect(await cancel(token, PASSED)).toMatchObject({ status: 'refused', code: 'link_unknown' })
  })

  it('cancels the booking with the guest as the actor, owes the email, and only once', async () => {
    const { id, token } = await ask()
    queued.length = 0
    expect(await cancel(token)).toMatchObject({ status: 'accepted' })
    expect(await statusOf(id)).toBe('cancelled')
    const lines = await world.owner.query<{
      to_state: string
      source: string
      actor: string
      via: string | null
    }>(
      `select to_state, source, actor, via from restro.log_entries
        where reservation_id = $1 and kind = 'reservation.status' order by seq`,
      [id],
    )
    expect(lines.rows).toEqual([
      { to_state: 'cancelled', source: 'guest', actor: 'guest', via: 'guest_page' },
    ])
    expect(queued.map((one) => guestEmailJobOf(one, scope())?.kind)).toEqual([
      'reservation_cancelled',
    ])
    expect(await open(token)).toMatchObject({ state: 'cancelled', canCancel: false })

    // A second tap: answered as done, nothing new written or owed.
    queued.length = 0
    expect(await cancel(token)).toMatchObject({ status: 'accepted', details: { repeated: true } })
    expect(queued.map((one) => guestEmailJobOf(one, scope())).filter(Boolean)).toEqual([])
    const after = await world.owner.query(
      `select 1 from restro.log_entries where reservation_id = $1 and kind = 'reservation.status'`,
      [id],
    )
    expect(after.rowCount).toBe(1)
  })

  it('refuses a cancel once the night has started, and one without Turnstile', async () => {
    const { id, token } = await ask()
    expect(await cancel(token, NOW, false)).toMatchObject({
      status: 'refused',
      code: 'human_check',
    })
    expect(await cancel(token, DURING_FRIDAY)).toMatchObject({
      status: 'refused',
      code: 'night_started',
    })
    expect(await statusOf(id)).toBe('requested')
  })

  it('refuses a token that opens nothing, whatever it is, with the same code', async () => {
    for (const token of ['', 'abc', 'A'.repeat(43), guestLinkToken(KEY, NEVER_MADE)]) {
      expect(await cancel(token), token).toMatchObject({ status: 'refused', code: 'link_unknown' })
    }
  })
})
