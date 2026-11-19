// The wrong-PIN guard (D122 §7; design §5; #72): five wrong PINs in five minutes make the device
// wait 1, 5, 15, then 60 minutes; only time forgets wrong PINs and trips (screen round 11-18, X1);
// each device counts alone, under one ceiling for the organisation.
import { describe, expect, it } from 'vitest'

import {
  PIN_GUARD_FAILURES,
  PIN_GUARD_SCOPE_FAILURES,
  PIN_GUARD_SCOPE_WINDOW_MS,
  PIN_GUARD_TRIPS_FORGOTTEN_MS,
  PIN_GUARD_WAITS_MS,
  PIN_GUARD_WINDOW_MS,
  PinGuard,
} from './pin-guard'

const START = new Date('2026-10-22T21:00:00Z')
const at = (ms: number) => new Date(START.getTime() + ms)

/** Fails `count` times, one second apart from `from`; returns the last answer. */
function failTimes(guard: PinGuard, device: string, count: number, from = 0, scope?: string) {
  let last = guard.fail(device, at(from), scope)
  for (let index = 1; index < count; index += 1) {
    last = guard.fail(device, at(from + index * 1000), scope)
  }
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

  it("one device's wrong PINs never make another device of the organisation wait", () => {
    const guard = new PinGuard()
    expect(failTimes(guard, 'dv_door', PIN_GUARD_FAILURES, 0, 'tn_a')).toMatchObject({
      tripped: true,
    })
    expect(guard.check('dv_door', at(6000)).ok).toBe(false)
    // The bar's tablet, same organisation: free to try, and its own typo is only a typo.
    expect(guard.check('dv_bar', at(6000)).ok).toBe(true)
    expect(guard.fail('dv_bar', at(7000), 'tn_a')).toEqual({ tripped: false })
    expect(guard.check('dv_bar', at(8000)).ok).toBe(true)
  })

  it('another device counts alone', () => {
    const guard = new PinGuard()
    failTimes(guard, 'dv_a', PIN_GUARD_FAILURES)
    expect(guard.check('dv_a', at(6000)).ok).toBe(false)
    expect(guard.check('dv_b', at(6000)).ok).toBe(true)
    expect(guard.fail('dv_b', at(7000))).toEqual({ tripped: false })
  })

  it('forgets the trips only an hour after the last wrong PIN and the last wait', () => {
    const guard = new PinGuard()
    failTimes(guard, 'dv_a', PIN_GUARD_FAILURES)
    // The first wait ends at 64 s; an hour past it the device starts again from the first wait.
    const wellAfter = 4000 + 60_000 + PIN_GUARD_TRIPS_FORGOTTEN_MS
    expect(failTimes(guard, 'dv_a', PIN_GUARD_FAILURES, wellAfter - 1000)).toMatchObject({
      trip: 2,
    })
    const later = wellAfter + 4000 + 300_000 + PIN_GUARD_TRIPS_FORGOTTEN_MS
    expect(failTimes(guard, 'dv_a', PIN_GUARD_FAILURES, later)).toMatchObject({ trip: 1 })
  })

  it('trips every device once the organisation is past its ceiling', () => {
    const guard = new PinGuard()
    const devices = Math.ceil(PIN_GUARD_SCOPE_FAILURES / (PIN_GUARD_FAILURES - 1))
    for (let index = 0; index < devices; index += 1) {
      const answer = failTimes(guard, `dv_${index}`, PIN_GUARD_FAILURES - 1, index * 10_000, 'tn_a')
      if (index * (PIN_GUARD_FAILURES - 1) + PIN_GUARD_FAILURES - 1 <= PIN_GUARD_SCOPE_FAILURES) {
        expect(answer).toEqual({ tripped: false })
      }
    }
    expect(guard.fail('dv_new', at(devices * 10_000), 'tn_a')).toEqual({
      tripped: true,
      trip: 1,
      waitSeconds: 60,
    })
    // Another organisation keeps its own count, and the ceiling's window passes.
    expect(guard.fail('dv_other', at(devices * 10_000), 'tn_b')).toEqual({ tripped: false })
    const after = devices * 10_000 + PIN_GUARD_SCOPE_WINDOW_MS + 1000
    expect(guard.fail('dv_late', at(after), 'tn_a')).toEqual({ tripped: false })
  })
})
