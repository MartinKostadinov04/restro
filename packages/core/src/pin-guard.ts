// The wrong-PIN guard of a shared device (D122 §7; design §5): after 5 wrong PINs in 5 minutes the
// device waits, and each further trip waits longer (1, 5, 15, then 60 minutes, the schedule phones
// use for their own PIN). A correct PIN forgets the device's trips. Each trip is a `guard.tripped`
// entry in the Log (`identifyStaffByPin` writes it).
//
// The counters live in the web process's memory (design §8: rate counters are never written to
// the database; with two web instances the limits are at most twice as loose). Pure: the clock is
// passed in. It sits beside core/service rather than in it because it writes no table;
// `@restro/core/service` exports it.

/** Wrong PINs that trip the guard… */
export const PIN_GUARD_FAILURES = 5
/** …within this window. */
export const PIN_GUARD_WINDOW_MS = 5 * 60_000
/** How long the device waits after its first, second, third and every later trip. */
export const PIN_GUARD_WAITS_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]
/** A device not seen for this long is forgotten (its trips too). */
const FORGET_AFTER_MS = 24 * 60 * 60_000

interface DeviceState {
  /** When the wrong PINs of the current window were entered. */
  failures: number[]
  /** Trips since the last correct PIN. */
  trips: number
  /** Until when the device waits (ms since the epoch); 0 when it doesn't. */
  waitUntil: number
  lastSeen: number
}

/** Whether a device may try a PIN now. */
export type PinGuardCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterSeconds: number }

/** What a wrong PIN did: nothing more, or a trip with the wait it started. */
export type PinGuardFailure =
  | { readonly tripped: false }
  | { readonly tripped: true; readonly trip: number; readonly waitSeconds: number }

/** The wrong-PIN counters of every shared device this process has seen. */
export class PinGuard {
  readonly #devices = new Map<string, DeviceState>()

  /** May the device try a PIN at `now`? A waiting device is told how long is left. */
  check(deviceId: string, now: Date): PinGuardCheck {
    const state = this.#devices.get(deviceId)
    const at = now.getTime()
    if (state === undefined || state.waitUntil <= at) return { ok: true }
    return { ok: false, retryAfterSeconds: Math.ceil((state.waitUntil - at) / 1000) }
  }

  /** Counts a wrong PIN; the fifth in the window trips the guard. */
  fail(deviceId: string, now: Date): PinGuardFailure {
    const at = now.getTime()
    this.#forgetIdle(at)
    const state = this.#devices.get(deviceId) ?? {
      failures: [],
      trips: 0,
      waitUntil: 0,
      lastSeen: at,
    }
    state.lastSeen = at
    state.failures = [...state.failures.filter((time) => at - time < PIN_GUARD_WINDOW_MS), at]
    this.#devices.set(deviceId, state)
    if (state.failures.length < PIN_GUARD_FAILURES) return { tripped: false }
    const wait =
      PIN_GUARD_WAITS_MS[Math.min(state.trips, PIN_GUARD_WAITS_MS.length - 1)] ?? 60 * 60_000
    state.trips += 1
    state.failures = []
    state.waitUntil = at + wait
    return { tripped: true, trip: state.trips, waitSeconds: wait / 1000 }
  }

  /** A correct PIN: the device starts afresh. */
  succeed(deviceId: string): void {
    this.#devices.delete(deviceId)
  }

  #forgetIdle(at: number): void {
    for (const [deviceId, state] of this.#devices) {
      if (at - state.lastSeen > FORGET_AFTER_MS && state.waitUntil <= at) {
        this.#devices.delete(deviceId)
      }
    }
  }
}
