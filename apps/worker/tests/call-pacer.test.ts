// The login's per-second budget (RR-67) on a fake clock: however many ask at once, no second holds
// more than the figure, nobody is refused, and a wait that ends early never leaves.
import { describe, expect, it } from 'vitest'

import { CallPacer } from '../src/jobs/call-pacer'

function fakeClock() {
  let at = 1_000
  const sleepers: { until: number; wake: () => void }[] = []
  return {
    now: () => at,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        sleepers.push({ until: at + ms, wake: resolve })
      }),
    advance(ms: number) {
      at += ms
      for (const sleeper of sleepers.splice(0)) {
        if (sleeper.until <= at) sleeper.wake()
        else sleepers.push(sleeper)
      }
    },
  }
}

const signal = () => new AbortController().signal

describe('the per-second budget of a login', () => {
  it('lets the figure through at once, and the next waits out the second', async () => {
    const clock = fakeClock()
    const pacer = new CallPacer(5, clock)
    for (let call = 0; call < 5; call++) expect(await pacer.take(signal())).toBe(true)
    let left = false
    const sixth = pacer.take(signal()).then((ok) => {
      left = ok
    })
    clock.advance(999)
    await Promise.resolve()
    expect(left).toBe(false)
    clock.advance(200)
    await sixth
    expect(left).toBe(true)
  })

  it('keeps any number asking at once inside the figure, in any second', async () => {
    const clock = fakeClock()
    const pacer = new CallPacer(5, clock)
    const left: number[] = []
    const asked = Array.from({ length: 23 }, () =>
      pacer.take(signal()).then(() => {
        left.push(clock.now())
      }),
    )
    let done = false
    const all = Promise.all(asked).then(() => {
      done = true
    })
    while (!done) {
      clock.advance(50)
      await new Promise((resolve) => setImmediate(resolve))
    }
    await all
    expect(left).toHaveLength(23)
    for (const start of left) {
      expect(left.filter((at) => at >= start && at < start + 1_000).length).toBeLessThanOrEqual(5)
    }
  })

  it('a wait that ends early says the call never left', async () => {
    const clock = fakeClock()
    const pacer = new CallPacer(1, clock)
    await pacer.take(signal())
    const controller = new AbortController()
    const waiting = pacer.take(controller.signal)
    controller.abort()
    expect(await waiting).toBe(false)
    expect(await pacer.take(controller.signal)).toBe(false)
  })

  it('has room for a read only while under half the figure is used', async () => {
    const clock = fakeClock()
    const pacer = new CallPacer(5, clock)
    expect(pacer.hasRoomForRead()).toBe(true)
    await pacer.take(signal())
    expect(pacer.hasRoomForRead()).toBe(true)
    await pacer.take(signal())
    expect(pacer.hasRoomForRead()).toBe(false)
    clock.advance(1_200)
    expect(pacer.hasRoomForRead()).toBe(true)
  })

  it('a figure of one still lets a read through when nothing is going on', () => {
    expect(new CallPacer(1, fakeClock()).hasRoomForRead()).toBe(true)
  })

  it('refuses a figure that is no whole number of at least one', () => {
    expect(() => new CallPacer(0)).toThrow(RangeError)
    expect(() => new CallPacer(1.5)).toThrow(RangeError)
  })
})
