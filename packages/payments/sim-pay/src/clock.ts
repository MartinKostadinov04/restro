// The engine's clock is injected (no hidden time), as in the simulated POS. `ManualClock` is the
// one tests and the conformance harness use; anything with a `now()` will do.

export interface Clock {
  now(): Date
}

export class ManualClock implements Clock {
  #ms: number

  constructor(start: Date | string = '2026-10-25T21:00:00.000Z') {
    this.#ms = new Date(start).getTime()
  }

  now(): Date {
    return new Date(this.#ms)
  }

  advance(ms: number): void {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('a clock only moves forward')
    this.#ms += ms
  }

  set(at: Date | string): void {
    const ms = new Date(at).getTime()
    if (ms < this.#ms) throw new Error('a clock only moves forward')
    this.#ms = ms
  }
}
