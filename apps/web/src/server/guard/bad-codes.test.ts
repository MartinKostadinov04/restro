// The bad-code limiter (D122 §9, #70): its counting window, its two lines, its memory bound and
// how it reads the client's network. Pure: an injected clock, no I/O.
import { describe, expect, it } from 'vitest'

import { BAD_CODE_LIMITS, BadCodeLimiter, clientNetwork, networkOf } from './bad-codes'

const MINUTE = 60_000

function limiterAt(start = 0) {
  const clock = { now: start }
  return { clock, limiter: new BadCodeLimiter(BAD_CODE_LIMITS, () => clock.now) }
}

describe('the bad-code limiter', () => {
  it('asks for Turnstile from the 20th wrong code in 10 minutes, and blocks at the 50th', () => {
    const { limiter } = limiterAt()
    const net = '203.0.113.7'
    expect(limiter.check(net)).toEqual({ kind: 'ok' })
    for (let wrong = 1; wrong < 20; wrong += 1) {
      expect(limiter.recordWrong(net)).toMatchObject({
        verdict: { kind: 'ok' },
        turnstileNow: false,
      })
    }
    expect(limiter.recordWrong(net)).toEqual({
      verdict: { kind: 'turnstile' },
      turnstileNow: true,
      blockedNow: false,
    })
    expect(limiter.check(net)).toEqual({ kind: 'turnstile' })
    for (let wrong = 21; wrong < 50; wrong += 1) {
      expect(limiter.recordWrong(net)).toMatchObject({ turnstileNow: false, blockedNow: false })
    }
    expect(limiter.recordWrong(net)).toEqual({
      verdict: { kind: 'blocked', retryAfterSeconds: 15 * 60 },
      turnstileNow: false,
      blockedNow: true,
    })
    // Wrong codes during the block neither extend it nor block again.
    expect(limiter.recordWrong(net)).toMatchObject({
      blockedNow: false,
      verdict: { kind: 'blocked' },
    })
  })

  it('counts over a sliding 10 minutes, and a block lasts 15 minutes', () => {
    const { clock, limiter } = limiterAt()
    const net = '203.0.113.8'
    for (let wrong = 0; wrong < 19; wrong += 1) limiter.recordWrong(net)
    clock.now += 10 * MINUTE + 1
    // The old ones fell out of the window.
    expect(limiter.recordWrong(net).verdict).toEqual({ kind: 'ok' })

    for (let wrong = 0; wrong < 49; wrong += 1) limiter.recordWrong(net)
    expect(limiter.check(net)).toMatchObject({ kind: 'blocked' })
    clock.now += 14 * MINUTE
    expect(limiter.check(net)).toEqual({ kind: 'blocked', retryAfterSeconds: 60 })
    clock.now += MINUTE
    // Over, and it starts from nothing.
    expect(limiter.check(net)).toEqual({ kind: 'ok' })
  })

  it('keeps each network apart, and forgets the least recently seen beyond its bound', () => {
    const clock = { now: 0 }
    const limiter = new BadCodeLimiter({ ...BAD_CODE_LIMITS, maxNetworks: 3 }, () => clock.now)
    for (const net of ['a', 'b', 'c']) limiter.recordWrong(net)
    for (let wrong = 0; wrong < 19; wrong += 1) limiter.recordWrong('a')
    expect(limiter.check('a')).toEqual({ kind: 'turnstile' })
    expect(limiter.check('b')).toEqual({ kind: 'ok' })
    limiter.recordWrong('d')
    expect(limiter.size).toBe(3)
    // `b` was seen least recently and went; `a` stays.
    expect(limiter.check('a')).toEqual({ kind: 'turnstile' })
  })
})

describe("the client's network", () => {
  it("is Cloudflare's address first, then X-Real-IP, then the last X-Forwarded-For entry", () => {
    const headers = (entries: Record<string, string>) => new Headers(entries)
    expect(
      clientNetwork(
        headers({
          'cf-connecting-ip': '203.0.113.7',
          'x-real-ip': '10.0.0.1',
          'x-forwarded-for': '1.1.1.1',
        }),
      ),
    ).toBe('203.0.113.7')
    expect(
      clientNetwork(headers({ 'x-real-ip': ' 198.51.100.2 ', 'x-forwarded-for': '1.1.1.1' })),
    ).toBe('198.51.100.2')
    // The first entries are what the client claimed; the last is our proxy's.
    expect(clientNetwork(headers({ 'x-forwarded-for': '6.6.6.6, 198.51.100.3' }))).toBe(
      '198.51.100.3',
    )
    expect(clientNetwork(headers({}))).toBe('unknown')
  })

  it('is an IPv4 address as it is, and an IPv6 address by its /64', () => {
    expect(networkOf('203.0.113.7')).toBe('203.0.113.7')
    expect(networkOf('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(networkOf('2001:db8:85a3:42:1:2:3:4')).toBe('2001:db8:85a3:42::/64')
    expect(networkOf('2001:0db8:85a3:0042:ffff:0:0:1')).toBe('2001:db8:85a3:42::/64')
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(networkOf('[2001:db8:1:2::9]:443')).toBe('2001:db8:1:2::/64')
    // Two addresses of one subscriber are one network.
    expect(networkOf('2001:db8:1:2::a')).toBe(networkOf('2001:db8:1:2:ffff::b'))
  })
})
