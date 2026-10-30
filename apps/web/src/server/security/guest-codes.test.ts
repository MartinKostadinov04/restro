// RR-74. D122 §9: "After 20 wrong codes in 10 minutes from one network, Turnstile is required. After
// 50, a 15-minute block and an alert." The guest API takes the code in a header. Here the code is
// looked up first and only a wrong one counts: a club's guests share one address, so a right code
// must work whatever its network's count. On Postgres as restro_app.
import { randomUUID } from 'node:crypto'

import type { DbPool } from '@restro/db'
import { GUEST_PAYMENT_HEADER, GUEST_PHONE_HEADER } from '@restro/shell'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getPool } from '../db'
import { BAD_CODE_LIMITS, BadCodeLimiter, badCodes } from '../guard/bad-codes'
import { handleGuestAction, handleGuestPayment, handleGuestState } from '../guest-api'
import { hasDatabase, openOwnerPool, useTestServerEnvironment } from '../test-database'
import { removeOrgs, type SeededOrg, seedOrg } from './tests/attack-world'

vi.mock('@/server/session', async () => (await import('./attack-session')).sessionModule)
vi.mock('next/cache', async () => (await import('./attack-session')).cacheModule)
vi.mock('next/headers', async () => (await import('./attack-session')).headersModule)
vi.mock('next-intl/server', async () => (await import('./attack-session')).intlModule)
vi.mock('@/server/jobs', async () => (await import('./attack-session')).jobsModule)
vi.mock('@/server/log', async () => (await import('./attack-session')).logModule)

const NETWORK = '198.51.100.7'
const wrong = (attempt: number) => String(attempt).padStart(22, 'x')

describe.skipIf(!hasDatabase)('wrong codes at the guest API', () => {
  let app: DbPool
  let owner: pg.Pool
  let org: SeededOrg

  beforeAll(async () => {
    useTestServerEnvironment()
    app = getPool()
    owner = openOwnerPool()
    org = await seedOrg(app, owner, 'GUESTCODES')
  }, 120_000)

  afterAll(async () => {
    await removeOrgs(owner, [org])
    await owner.end()
  }, 60_000)

  const deps = (limiter?: BadCodeLimiter) => ({
    pool: app,
    queueReading: async () => {},
    passKey: null,
    humanCheck: async () => 'passed' as const,
    queueSend: async () => {},
    queuePayment: async () => {},
    ...(limiter === undefined ? {} : { badCodes: limiter }),
  })

  const state = (code: string, limiter?: BadCodeLimiter, network = NETWORK) =>
    handleGuestState(
      new Request('http://localhost/api/guest/state?view=menu', {
        headers: { authorization: `Table ${code}`, 'x-forwarded-for': network },
      }),
      deps(limiter),
    )

  /** A limiter whose network has just crossed the line. */
  function blocked(): BadCodeLimiter {
    const limiter = new BadCodeLimiter()
    for (let attempt = 0; attempt < BAD_CODE_LIMITS.blockAfter; attempt++) {
      limiter.recordWrong(NETWORK)
    }
    expect(limiter.check(NETWORK).kind).toBe('blocked')
    return limiter
  }

  it('one network trying 60 codes is blocked, as at /t/<code>', async () => {
    const statuses: number[] = []
    let retryAfter: string | null = null
    for (let attempt = 0; attempt < 60; attempt++) {
      const answer = await state(wrong(attempt), undefined, '198.51.100.40')
      statuses.push(answer.status)
      retryAfter ??= answer.headers.get('Retry-After')
    }
    expect(statuses.slice(0, 49).every((status) => status === 401)).toBe(true)
    expect(statuses.slice(49).every((status) => status === 429)).toBe(true)
    expect(Number(retryAfter)).toBeGreaterThan(0)
  }, 120_000)

  it('a right code from a network over the limit still works', async () => {
    const limiter = blocked()
    const code = org.venues[0].tableCode
    expect((await state(code, limiter)).status).toBe(200)
    // It neither lifts the block nor adds to the count.
    expect(limiter.check(NETWORK).kind).toBe('blocked')
    expect((await state(wrong(1), limiter)).status).toBe(429)
    expect((await state(code, limiter)).status).toBe(200)
  }, 30_000)

  it('right codes never count', async () => {
    const limiter = new BadCodeLimiter()
    expect((await state(org.venues[0].tableCode, limiter)).status).toBe(200)
    let left = 0
    while (limiter.check(NETWORK).kind !== 'blocked') {
      limiter.recordWrong(NETWORK)
      left += 1
    }
    expect(left).toBe(BAD_CODE_LIMITS.blockAfter)
  }, 30_000)

  it('another network is not blocked by this one', async () => {
    const limiter = blocked()
    expect((await state(wrong(2), limiter, '203.0.113.9')).status).toBe(401)
  }, 30_000)

  it('the count is the API’s own: /t/<code> is not blocked by it', async () => {
    for (let attempt = 0; attempt < BAD_CODE_LIMITS.blockAfter + 1; attempt++) {
      await state(wrong(attempt), undefined, '192.0.2.8')
    }
    expect(badCodes.check('192.0.2.8').kind).toBe('ok')
  }, 120_000)

  it('the action and payment routes count too, and so does a malformed code', async () => {
    const limiter = new BadCodeLimiter()
    const headers = { authorization: `Table ${wrong(3)}`, 'x-forwarded-for': NETWORK }
    const act = await handleGuestAction(
      new Request('http://localhost/api/guest/actions', {
        method: 'POST',
        headers: { ...headers, [GUEST_PHONE_HEADER]: 'attack-phone-aaaaaaaaa' },
        body: JSON.stringify({
          command: {
            kind: 'order.add',
            actionId: randomUUID(),
            itemId: org.venues[0].item,
            optionIds: [],
            qty: 1,
            note: '',
          },
          ageMs: 1_000,
          view: 'order',
        }),
      }),
      deps(limiter),
    )
    expect(act.status).toBe(401)
    const pay = await handleGuestPayment(
      new Request('http://localhost/api/guest/payment', {
        headers: { ...headers, [GUEST_PAYMENT_HEADER]: 'h'.repeat(22) },
      }),
      deps(limiter),
    )
    expect(pay.status).toBe(401)
    const malformed = await handleGuestState(
      new Request('http://localhost/api/guest/state?view=menu', {
        headers: { authorization: 'Table short', 'x-forwarded-for': NETWORK },
      }),
      deps(limiter),
    )
    expect(malformed.status).toBe(401)
    let left = 0
    while (limiter.check(NETWORK).kind !== 'blocked') {
      limiter.recordWrong(NETWORK)
      left += 1
    }
    expect(left).toBe(BAD_CODE_LIMITS.blockAfter - 3)
  }, 30_000)
})
