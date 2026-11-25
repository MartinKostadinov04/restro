// The booking page's two handlers (#577) with core's booking module stubbed: a query or a body of the
// wrong shape is a 400 before the database is asked, a body past its cap a 413, a network past its
// limit a 429; the guest cannot choose a status, a spot or an id (the strict schema refuses them);
// a refused request answers in the page's own words; every answer is no-store, and nothing the
// guest typed reaches the log. The module itself is tested on Postgres in core (`online.test.ts`).
import { newId } from '@restro/core'
import type { DbPool } from '@restro/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BAD_CODE_LIMITS, BadCodeLimiter, type BadCodeLimits } from './guard/bad-codes'

const core = vi.hoisted(() => ({ readBookingNight: vi.fn(), requestBooking: vi.fn() }))
const log = vi.hoisted(() => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }))

vi.mock('@restro/core/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@restro/core/service')>()),
  readBookingNight: core.readBookingNight,
  requestBooking: core.requestBooking,
}))
vi.mock('./log', () => log)

const { handleBookingNight, handleBookingRequest } = await import('./booking-api')

const ORG = newId('tn')
const VENUE = newId('vn')
const ACTION = '7d1f2c3a-4b5e-4f60-8a71-92b3c4d5e6f7'
/** Only the stubbed module gets the pool, so a refusal that never calls it never asked the database. */
const pool = { sentinel: 'pool' } as unknown as DbPool
const humanCheck = vi.fn(async () => 'passed' as const)

function deps(limits: Partial<BadCodeLimits> = {}) {
  const limiter = () =>
    new BadCodeLimiter({
      ...BAD_CODE_LIMITS,
      turnstileAfter: Number.MAX_SAFE_INTEGER,
      blockAfter: 100,
      ...limits,
    })
  return { pool, humanCheck, requests: limiter(), nights: limiter() }
}

const FORM = {
  organization: ORG,
  venue: VENUE,
  actionId: ACTION,
  humanToken: 'turnstile-token',
  night: '2026-12-12',
  partySize: 4,
  name: 'Mira Ivanova',
  phone: '+359888123456',
  email: 'mira@example.com',
  note: 'By the window',
}

const night = (query: string) => new Request(`http://localhost/api/booking/night?${query}`)
const post = (body: unknown) =>
  new Request('http://localhost/api/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

function logged(): string {
  return JSON.stringify([
    ...log.logInfo.mock.calls,
    ...log.logWarn.mock.calls,
    ...log.logError.mock.calls,
  ])
}

beforeEach(() => {
  core.readBookingNight.mockReset()
  core.requestBooking.mockReset()
  log.logError.mockReset()
  log.logInfo.mockReset()
  log.logWarn.mockReset()
  humanCheck.mockClear()
})

describe('GET /api/booking/night', () => {
  it('answers only whether the night can be booked, never stored', async () => {
    core.readBookingNight.mockResolvedValue('closed_date')
    const response = await handleBookingNight(
      night(`organization=${ORG}&venue=${VENUE}&night=2026-12-24`),
      deps(),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ night: '2026-12-24', answer: 'closed_date' })
    expect(core.readBookingNight).toHaveBeenCalledWith(
      pool,
      ORG,
      VENUE,
      '2026-12-24',
      expect.any(Date),
    )
  })

  it('refuses a query of the wrong shape before asking the database', async () => {
    for (const query of [
      `organization=${ORG}&venue=${VENUE}`,
      `organization=${ORG}&venue=${VENUE}&night=24.12.2026`,
      `organization=acme&venue=${VENUE}&night=2026-12-24`,
    ]) {
      const response = await handleBookingNight(night(query), deps())
      expect(response.status).toBe(400)
    }
    expect(core.readBookingNight).not.toHaveBeenCalled()
  })

  it('says a venue it cannot see is unknown', async () => {
    core.readBookingNight.mockResolvedValue(null)
    const response = await handleBookingNight(
      night(`organization=${ORG}&venue=${VENUE}&night=2026-12-24`),
      deps(),
    )
    expect(response.status).toBe(404)
  })

  it('makes a network that asks too often wait', async () => {
    core.readBookingNight.mockResolvedValue('open')
    const limited = deps({ blockAfter: 2 })
    const ask = () =>
      handleBookingNight(night(`organization=${ORG}&venue=${VENUE}&night=2026-12-24`), limited)
    expect((await ask()).status).toBe(200)
    expect((await ask()).status).toBe(429)
    expect(core.readBookingNight).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/booking', () => {
  it('passes the request to core with Turnstile and answers ok', async () => {
    core.requestBooking.mockResolvedValue({
      status: 'accepted',
      actionId: ACTION,
      ref: null,
      details: {},
    })
    const response = await handleBookingRequest(post(FORM), deps())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true })
    expect(core.requestBooking).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        tenantId: ORG,
        venueId: VENUE,
        actionId: ACTION,
        serviceDate: '2026-12-12',
        partySize: 4,
        guestName: 'Mira Ivanova',
        humanToken: 'turnstile-token',
        humanCheck,
      }),
    )
  })

  it('refuses a status, a spot or an id the guest tries to choose', async () => {
    for (const extra of [{ status: 'confirmed' }, { spotId: newId('sp') }, { id: newId('rv') }]) {
      const response = await handleBookingRequest(post({ ...FORM, ...extra }), deps())
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, refusal: 'invalid_request' })
    }
    expect(core.requestBooking).not.toHaveBeenCalled()
  })

  it('refuses a body past its cap and one that is not JSON', async () => {
    const big = await handleBookingRequest(post({ ...FORM, note: 'x'.repeat(5000) }), deps())
    expect(big.status).toBe(413)
    const broken = await handleBookingRequest(post('{not json'), deps())
    expect(broken.status).toBe(400)
    expect(core.requestBooking).not.toHaveBeenCalled()
  })

  it('answers a failed human check with 403 and a closed night in the page words', async () => {
    core.requestBooking.mockResolvedValueOnce({
      status: 'refused',
      actionId: ACTION,
      code: 'human_check',
      details: {},
    })
    const human = await handleBookingRequest(post(FORM), deps())
    expect(human.status).toBe(403)
    expect(await human.json()).toEqual({ ok: false, refusal: 'human_check' })

    core.requestBooking.mockResolvedValueOnce({
      status: 'refused',
      actionId: ACTION,
      code: 'closed_night',
      details: {},
    })
    const closed = await handleBookingRequest(post(FORM), deps())
    expect(closed.status).toBe(409)
    expect(await closed.json()).toEqual({ ok: false, refusal: 'closed_night' })
  })

  it('names a refusal the page has no words for as unavailable', async () => {
    core.requestBooking.mockResolvedValue({
      status: 'refused',
      actionId: ACTION,
      code: 'venue_closed',
      details: {},
    })
    const response = await handleBookingRequest(post(FORM), deps())
    expect(await response.json()).toEqual({ ok: false, refusal: 'unavailable' })
  })

  it('makes a network that sends too often wait', async () => {
    core.requestBooking.mockResolvedValue({
      status: 'accepted',
      actionId: ACTION,
      ref: null,
      details: {},
    })
    const limited = deps({ blockAfter: 2 })
    expect((await handleBookingRequest(post(FORM), limited)).status).toBe(200)
    const second = await handleBookingRequest(post(FORM), limited)
    expect(second.status).toBe(429)
    expect(await second.json()).toEqual({ ok: false, refusal: 'rate_limited' })
  })

  it('logs nothing the guest typed', async () => {
    core.requestBooking.mockResolvedValueOnce({
      status: 'accepted',
      actionId: ACTION,
      ref: null,
      details: {},
    })
    await handleBookingRequest(post(FORM), deps())
    core.requestBooking.mockRejectedValueOnce(new Error('database down'))
    const failed = await handleBookingRequest(post(FORM), deps())
    expect(failed.status).toBe(500)
    const text = logged()
    for (const value of [FORM.name, FORM.phone, FORM.email, FORM.note, '203.0.113.7']) {
      expect(text).not.toContain(value)
    }
    expect(text).toContain(VENUE)
  })
})
