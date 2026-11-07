// One POS login's calls per second (RR-67; rule 9: one login per connection). Every call on the
// wire takes a place here right before it leaves, a round's and a payment's as much as a read-back
// or a table read, so a chain and the tick can't together pass the limit, whichever job asks. The
// figure is the connector's. In memory, per process: the worker is the only process that calls a
// POS, and a restart waits out nothing more than the POS's own limit would.

/** The clock the budget runs on: the real one, or in tests the simulated POS's. */
export interface PacerClock {
  now(): number
  sleep(ms: number): Promise<void>
}

const REAL_CLOCK: PacerClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * How long a call counts: the POS's second, and a margin since a call reaches the POS a little
 * after it leaves here, and not always equally late.
 */
const WINDOW_MS = 1_100

export class CallPacer {
  readonly perSecond: number
  readonly #clock: PacerClock
  /** The moments of the calls still in the window, oldest first; some may be still to come. */
  #starts: number[] = []

  constructor(perSecond: number, clock: PacerClock = REAL_CLOCK) {
    if (!Number.isSafeInteger(perSecond) || perSecond < 1) {
      throw new RangeError('perSecond must be a whole number of at least 1')
    }
    this.perSecond = perSecond
    this.#clock = clock
  }

  #inWindow(now: number): number[] {
    this.#starts = this.#starts.filter((at) => at > now - WINDOW_MS)
    return this.#starts
  }

  /**
   * Waits for this call's place. False when `signal` ended first: the call never left. Its place
   * is not given back, which only ever errs on the side of fewer calls.
   */
  async take(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false
    const now = this.#clock.now()
    const starts = this.#inWindow(now)
    const blocking = starts[starts.length - this.perSecond]
    const at = blocking === undefined ? now : Math.max(now, blocking + WINDOW_MS)
    starts.push(at)
    if (at <= now) return true
    const waited = this.#clock.sleep(at - now)
    return new Promise<boolean>((resolve) => {
      const onAbort = () => resolve(false)
      signal.addEventListener('abort', onAbort, { once: true })
      void waited.then(() => {
        signal.removeEventListener('abort', onAbort)
        resolve(!signal.aborted)
      })
    })
  }

  /**
   * True while under half the budget is used. This does what the read-only bucket did: a read
   * (at least two calls) that starts now still leaves a round its calls, and reads alone come to
   * about one table a second at five calls a second. A read with no room is skipped, not queued.
   */
  hasRoomForRead(): boolean {
    return this.#inWindow(this.#clock.now()).length < Math.max(1, Math.floor(this.perSecond / 2))
  }
}
