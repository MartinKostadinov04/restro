// The guest's own link's two handlers (#579) with core's booking module stubbed: the booking goes
// out with the contract's fields only; an unknown, a malformed and an expired token get the same
// 404; a query or body of the wrong shape is refused before the database is asked; a Cancel passes
// the token (never in a command) with Turnstile and answers the booking as it stands; a refusal is
// worded; every answer is no-store with no referrer; the token never reaches the log. The module
// itself is tested on Postgres in core (`guest-link.test.ts`).
import { newId } from '@restro/core'
import type { DbPool } from '@restro/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BAD_CODE_LIMITS, BadCodeLimiter, type BadCodeLimits } from './guard/bad-codes'

const core = vi.hoisted(() => ({ readGuestBooking: vi.fn(), cancelGuestBooking: vi.fn() }))
const log = vi.hoisted(() => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }))

vi.mock('@restro/core/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@restro/core/service')>()),
  readGuestBooking: core.readGuestBooking,
  cancelGuestBooking: core.cancelGuestBooking,
}))
vi.mock('./log', () => log)

const { handleGuestLinkCancel, handleGuestLinkRead } = await import('./booking-link-api')

const ORG = newId('tn')
const VENUE = newId('vn')
const ACTION = '7d1f2c3a-4b5e-4f60-8a71-92b3c4d5e6f7'
/** A token's shape; core is stubbed, so it opens what the stub says. */
const TOKEN = `${'Ab0_'.repeat(10)}Ab0`
const pool = { sentinel: 'pool' } as unknown as DbPool
const humanCheck = vi.fn(async () => 'passed' as const)
const queueJobs = vi.fn(async () => {})

/** What core answers for a booking: more than the wire may carry. */
const CORE_BOOKING = {
  venueName: 'Club Night',
  night: '2026-12-12',
  time: '22:30',
  partySize: 4,
  spots: ['Bar 2'],
  state: 'confirmed',
  canCancel: true,
  nightStarted: false,
}

const WIRE_BOOKING = {
  night: '2026-12-12',
  time: '22:30',
  partySize: 4,
  spots: ['Bar 2'],
  state: 'confirmed',
  canCancel: true,
  nightStarted: false,
}

function deps(limits: Partial<BadCodeLimits> = {}) {
  const limiter = new BadCodeLimiter({
    ...BAD_CODE_LIMITS,
    turnstileAfter: Number.MAX_SAFE_INTEGER,
    blockAfter: 100,
    ...limits,
  })
  return { pool, humanCheck, limiter, queueJobs }
}

const read = (token = TOKEN, query = `organization=${ORG}&venue=${VENUE}`) =>
  new Request(`http://localhost/api/booking/link/${token}?${query}`)
const post = (body: unknown) =>
  new Request(`http://localhost/api/booking/link/${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const FORM = { organization: ORG, venue: VENUE, actionId: ACTION, humanToken: 'turnstile-token' }

function logged(): string {
  return JSON.stringify([
    ...log.logInfo.mock.calls,
    ...log.logWarn.mock.calls,
    ...log.logError.mock.calls,
  ])
}

beforeEach(() => {
  core.readGuestBooking.mockReset()
  core.cancelGuestBooking.mockReset()
  log.logError.mockReset()
  log.logInfo.mockReset()
  log.logWarn.mockReset()
  humanCheck.mockClear()
})

describe('GET /api/booking/link/<token>', () => {
  it("answers that one booking with the contract's fields only, never stored", async () => {
    core.readGuestBooking.mockResolvedValue(CORE_BOOKING)
    const response = await handleGuestLinkRead(read(), TOKEN, deps())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.json()).toEqual(WIRE_BOOKING)
    expect(core.readGuestBooking).toHaveBeenCalledWith(pool, {
      tenantId: ORG,
      venueId: VENUE,
      token: TOKEN,
      now: expect.any(Date),
    })
  })

  it('gives an unknown, a malformed and an expired token the same 404', async () => {
    core.readGuestBooking.mockResolvedValue(null)
    const bodies: unknown[] = []
    for (const token of [TOKEN, 'not-a-token', 'x'.repeat(4000)]) {
      const response = await handleGuestLinkRead(read(token), token, deps())
      expect(response.status).toBe(404)
      bodies.push(await response.json())
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1)
    expect(bodies[0]).toEqual({ ok: false, refusal: 'link_unknown' })
    // A long path is cut before it is hashed: no more work than a real token.
    const longest = core.readGuestBooking.mock.calls[2]?.[1] as { token: string }
    expect(longest.token.length).toBeLessThanOrEqual(128)
  })

  it('refuses a query of the wrong shape before asking the database', async () => {
    for (const query of [`venue=${VENUE}`, `organization=acme&venue=${VENUE}`, `token=${TOKEN}`]) {
      const response = await handleGuestLinkRead(read(TOKEN, query), TOKEN, deps())
      expect(response.status).toBe(404)
    }
    expect(core.readGuestBooking).not.toHaveBeenCalled()
  })

  it('makes a network that asks too often wait', async () => {
    core.readGuestBooking.mockResolvedValue(CORE_BOOKING)
    const limited = deps({ blockAfter: 2 })
    expect((await handleGuestLinkRead(read(), TOKEN, limited)).status).toBe(200)
    expect((await handleGuestLinkRead(read(), TOKEN, limited)).status).toBe(429)
    expect(core.readGuestBooking).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/booking/link/<token>', () => {
  it('cancels with Turnstile and the email queued, and answers the booking as it stands', async () => {
    core.cancelGuestBooking.mockResolvedValue({
      status: 'accepted',
      actionId: ACTION,
      ref: null,
      details: {},
    })
    core.readGuestBooking.mockResolvedValue({
      ...CORE_BOOKING,
      state: 'cancelled',
      canCancel: false,
    })
    const response = await handleGuestLinkCancel(post(FORM), TOKEN, deps())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      ok: true,
      booking: { ...WIRE_BOOKING, state: 'cancelled', canCancel: false },
    })
    expect(core.cancelGuestBooking).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        tenantId: ORG,
        venueId: VENUE,
        token: TOKEN,
        actionId: ACTION,
        humanToken: 'turnstile-token',
        humanCheck,
        queueJobs,
      }),
    )
  })

  it('answers a night that has started in the page words, and a gone link with the 404', async () => {
    core.cancelGuestBooking.mockResolvedValueOnce({
      status: 'refused',
      actionId: ACTION,
      code: 'night_started',
      details: {},
    })
    const started = await handleGuestLinkCancel(post(FORM), TOKEN, deps())
    expect(started.status).toBe(409)
    expect(await started.json()).toEqual({ ok: false, refusal: 'night_started' })

    core.cancelGuestBooking.mockResolvedValueOnce({
      status: 'refused',
      actionId: ACTION,
      code: 'link_unknown',
      details: {},
    })
    const gone = await handleGuestLinkCancel(post(FORM), TOKEN, deps())
    expect(gone.status).toBe(404)
    expect(await gone.json()).toEqual({ ok: false, refusal: 'link_unknown' })

    core.cancelGuestBooking.mockResolvedValueOnce({
      status: 'refused',
      actionId: ACTION,
      code: 'human_check',
      details: {},
    })
    expect((await handleGuestLinkCancel(post(FORM), TOKEN, deps())).status).toBe(403)
  })

  it('refuses a body of the wrong shape, past its cap or not JSON', async () => {
    for (const body of [
      { ...FORM, reservationId: newId('rv') },
      { ...FORM, tokenHash: 'a'.repeat(64) },
      { ...FORM, actionId: 'one' },
      '{not json',
    ]) {
      const response = await handleGuestLinkCancel(post(body), TOKEN, deps())
      expect(response.status).toBe(400)
    }
    const big = await handleGuestLinkCancel(
      post({ ...FORM, humanToken: 'x'.repeat(9000) }),
      TOKEN,
      deps(),
    )
    expect(big.status).toBe(413)
    expect(core.cancelGuestBooking).not.toHaveBeenCalled()
  })

  it('logs neither the token nor the network', async () => {
    core.readGuestBooking.mockResolvedValueOnce(null)
    await handleGuestLinkRead(read(), TOKEN, deps())
    core.cancelGuestBooking.mockRejectedValueOnce(new Error('database down'))
    const failed = await handleGuestLinkCancel(post(FORM), TOKEN, deps())
    expect(failed.status).toBe(500)
    core.cancelGuestBooking.mockResolvedValueOnce({
      status: 'accepted',
      actionId: ACTION,
      ref: null,
      details: {},
    })
    core.readGuestBooking.mockResolvedValueOnce(CORE_BOOKING)
    await handleGuestLinkCancel(post(FORM), TOKEN, deps())
    const text = logged()
    for (const value of [TOKEN, '203.0.113.7']) expect(text).not.toContain(value)
    expect(text).toContain(VENUE)
  })
})
