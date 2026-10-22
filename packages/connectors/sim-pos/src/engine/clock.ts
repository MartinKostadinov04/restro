// The engine's clock is injected (#51 design §2.1: no I/O, no hidden time). `ManualClock` is the
// one tests and the conformance harness use; anything with a `now()` will do.

export interface Clock {
  now(): Date
}

export class ManualClock implements Clock {
  #ms: number

  constructor(start: Date | string = '2026-10-22T19:00:00.000Z') {
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
    this.#ms = new Date(at).getTime()
  }
}
