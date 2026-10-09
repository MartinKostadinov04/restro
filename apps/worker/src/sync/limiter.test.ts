import { describe, expect, it } from 'vitest'

import { BARSY_CONCURRENCY, createLimiter, LimiterRegistry } from './limiter'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createLimiter', () => {
  it('runs at most N tasks at once and the rest in order', async () => {
    const limiter = createLimiter(2)
    let active = 0
    let peak = 0
    const started: number[] = []
    const gates = Array.from({ length: 5 }, () => {
      let open: () => void = () => undefined
      const promise = new Promise<void>((resolve) => {
        open = resolve
      })
      return { promise, open }
    })
    const runs = gates.map((gate, index) =>
      limiter.run(async () => {
        active += 1
        peak = Math.max(peak, active)
        started.push(index)
        await gate.promise
        active -= 1
        return index
      }),
    )
    await tick()
    expect(started).toEqual([0, 1])
    gates[0]?.open()
    await tick()
    expect(started).toEqual([0, 1, 2])
    for (const gate of gates) gate.open()
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
    expect(started).toEqual([0, 1, 2, 3, 4])
  })

  it('a failing task frees its slot', async () => {
    const limiter = createLimiter(1)
    await expect(limiter.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(await limiter.run(async () => 'ok')).toBe('ok')
  })

  it('refuses a limit that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => createLimiter(bad)).toThrow(RangeError)
  })
})

describe('LimiterRegistry', () => {
  it('gives one limiter of two per installation host, shared by every caller', () => {
    const registry = new LimiterRegistry()
    expect(BARSY_CONCURRENCY).toBe(2)
    expect(registry.forHost('a.barsyonline.com')).toBe(registry.forHost('a.barsyonline.com'))
    expect(registry.forHost('a.barsyonline.com')).not.toBe(registry.forHost('b.barsyonline.com'))
  })
})
