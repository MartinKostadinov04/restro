import { describe, expect, it } from 'vitest'

import { GUEST_LIMITS, GuestLimiter } from './guest-limits'

describe('the guest limits in memory', () => {
  it('holds D122’s numbers', () => {
    expect(GUEST_LIMITS).toEqual({
      additions: { max: 30, windowMs: 60_000 },
      sendGap: { max: 1, windowMs: 15_000 },
      sends: { max: 10, windowMs: 600_000 },
      // #110: one Pay per 15 s and 5 in 10 minutes per phone (D127 §Limits).
      payGap: { max: 1, windowMs: 15_000 },
      pays: { max: 5, windowMs: 600_000 },
      // RR-26: the failed human checks the 10 Sends in 10 minutes used to stop.
      humanFails: { max: 10, windowMs: 600_000 },
      locationTries: { max: 5, windowMs: 600_000 },
      codeRequests: { max: 20, windowMs: 1_000 },
    })
  })

  it('lets 30 additions a minute through, refuses the 31st, and frees one as the window slides', () => {
    const limiter = new GuestLimiter()
    for (let n = 0; n < 30; n += 1) {
      expect(limiter.take('phone', ['additions'], 1_000 + n).ok).toBe(true)
    }
    expect(limiter.take('phone', ['additions'], 2_000)).toEqual({ ok: false, retryAfterMs: 59_000 })
    // Another phone at the table is not blocked by this one.
    expect(limiter.take('friend', ['additions'], 2_000).ok).toBe(true)
    expect(limiter.take('phone', ['additions'], 61_000).ok).toBe(true)
  })

  it('takes one Send per 15 s and 10 in 10 minutes, all or none', () => {
    const limiter = new GuestLimiter()
    const send = ['sendGap', 'sends'] as const
    expect(limiter.take('phone', send, 0).ok).toBe(true)
    expect(limiter.take('phone', send, 5_000)).toEqual({ ok: false, retryAfterMs: 10_000 })
    // The refused Send counted against neither window.
    for (let n = 1; n < 10; n += 1) expect(limiter.take('phone', send, n * 15_000).ok).toBe(true)
    const eleventh = limiter.take('phone', send, 10 * 15_000)
    expect(eleventh).toEqual({ ok: false, retryAfterMs: 600_000 - 150_000 })
  })

  it('takes 5 location tries in 10 minutes and 20 requests a second per code', () => {
    const limiter = new GuestLimiter()
    for (let n = 0; n < 5; n += 1) expect(limiter.take('p', ['locationTries'], n).ok).toBe(true)
    expect(limiter.take('p', ['locationTries'], 10).ok).toBe(false)
    for (let n = 0; n < 20; n += 1) expect(limiter.take('code', ['codeRequests'], 0).ok).toBe(true)
    expect(limiter.take('code', ['codeRequests'], 999)).toEqual({ ok: false, retryAfterMs: 1 })
    expect(limiter.take('code', ['codeRequests'], 1_000).ok).toBe(true)
  })

  it('gives a hit back by its time, once, and leaves the other hits (RR-26)', () => {
    const limiter = new GuestLimiter()
    const send = ['sendGap', 'sends'] as const
    expect(limiter.take('phone', send, 1_000).ok).toBe(true)
    limiter.giveBack('phone', send, 1_000)
    expect(limiter.take('phone', send, 1_001).ok).toBe(true)
    // A hit that isn't there frees nothing, and the Send that went out still holds the 15 s.
    limiter.giveBack('phone', send, 1_000)
    expect(limiter.take('phone', send, 1_002)).toEqual({ ok: false, retryAfterMs: 14_999 })
  })

  it('remembers the last Send until it is forgotten, and clear forgets it', () => {
    const limiter = new GuestLimiter()
    expect(limiter.lastSend('phone')).toBeNull()
    limiter.setLastSend('phone', { sentOrderId: 'so_1', at: 5 })
    expect(limiter.lastSend('phone')).toEqual({ sentOrderId: 'so_1', at: 5 })
    limiter.forgetLastSend('phone')
    expect(limiter.lastSend('phone')).toBeNull()
    limiter.setLastSend('phone', { sentOrderId: 'so_2', at: 6 })
    limiter.clear()
    expect(limiter.lastSend('phone')).toBeNull()
  })

  it('forgets everything on clear', () => {
    const limiter = new GuestLimiter()
    expect(limiter.take('p', ['sendGap'], 0).ok).toBe(true)
    limiter.clear()
    expect(limiter.take('p', ['sendGap'], 1).ok).toBe(true)
  })
})
