// The wrong-PIN guard (D122 §7; design §5; #72): five wrong PINs in five minutes make the device
// wait 1, 5, 15, then 60 minutes; a correct PIN starts it afresh; each device counts alone.
import { describe, expect, it } from 'vitest'

import { PIN_GUARD_FAILURES, PIN_GUARD_WAITS_MS, PIN_GUARD_WINDOW_MS, PinGuard } from './pin-guard'

const START = new Date('2026-10-22T21:00:00Z')
const at = (ms: number) => new Date(START.getTime() + ms)

/** Fails `count` times, one second apart from `from`; returns the last answer. */
function failTimes(guard: PinGuard, device: string, count: number, from = 0) {
  let last = guard.fail(device, at(from))
  for (let index = 1; index < count; index += 1) last = guard.fail(device, at(from + index * 1000))
  return last
}

describe('the wrong-PIN guard', () => {
  it('trips on the fifth wrong PIN within five minutes, and the device waits a minute', () => {
    const guard = new PinGuard()
    expect(failTimes(guard, 'dv_a', PIN_GUARD_FAILURES - 1)).toEqual({ tripped: false })
    expect(guard.check('dv_a', at(4000)).ok).toBe(true)
    expect(guard.fail('dv_a', at(5000))).toEqual({ tripped: true, trip: 1, waitSeconds: 60 })
    expect(guard.check('dv_a', at(6000))).toEqual({ ok: false, retryAfterSeconds: 59 })
    expect(guard.check('dv_a', at(65_000)).ok).toBe(true)
  })

  it('does not count wrong PINs older than the window', () => {
    const guard = new PinGuard()
    failTimes(guard, 'dv_a', PIN_GUARD_FAILURES - 1)
    expect(guard.fail('dv_a', at(PIN_GUARD_WINDOW_MS + 4000))).toEqual({ tripped: false })
  })

  it('waits longer on each trip, up to an hour', () => {
    const guard = new PinGuard()
    const waits: number[] = []
    let clock = 0
    for (let trip = 0; trip < PIN_GUARD_WAITS_MS.length + 1; trip += 1) {
      const answer = failTimes(guard, 'dv_a', PIN_GUARD_FAILURES, clock)
      if (!answer.tripped) throw new Error('expected a trip')
      waits.push(answer.waitSeconds)
      clock += PIN_GUARD_FAILURES * 1000 + answer.waitSeconds * 1000
    }
    expect(waits).toEqual([60, 300, 900, 3600, 3600])
  })

  it('a correct PIN forgets the trips; another device counts alone', () => {
    const guard = new PinGuard()
    failTimes(guard, 'dv_a', PIN_GUARD_FAILURES)
    expect(guard.check('dv_b', at(6000)).ok).toBe(true)
    guard.succeed('dv_a')
    expect(guard.check('dv_a', at(6000)).ok).toBe(true)
    expect(failTimes(guard, 'dv_a', PIN_GUARD_FAILURES, 7000)).toMatchObject({ trip: 1 })
  })
})
