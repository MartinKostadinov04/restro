// The wrong-PIN guard of a shared device (D122 §7; design §5): after 5 wrong PINs in 5 minutes the
// device waits, and each further trip waits longer (1, 5, 15, then 60 minutes, the schedule phones
// use for their own PIN). Each trip is a `guard.tripped` entry in the Log (`identifyStaffByPin`
// writes it).
//
// A correct PIN forgets nothing (screen round 11-18, X1): on a shared tablet the person guessing
// may hold a PIN of their own, and if their own PIN wiped the count, four guesses and their own PIN,
// repeated, would walk the 10,000 PINs without a trip and without a Log entry. The wrong PINs leave
// the window by age alone, and the trips are forgotten only after the device has gone an hour past
// its last wrong PIN and its last wait.
//
// The wait always falls on the device that guessed, never on the other tablets: one wrong PIN at the
// door never makes the bar wait on a busy night. An organisation's devices also share a high
// backstop against guesses sprayed across tablets: past `PIN_GUARD_SCOPE_FAILURES` wrong PINs in
// `PIN_GUARD_SCOPE_WINDOW_MS`, each further wrong PIN trips the device it was typed on.
//
// The numbers (screen round 11-18, X1; the lead's call, 11-19): NIST SP 800-63B §5.2.2 asks a
// verifier to rate-limit failed attempts per account (at most 100) and to prefer growing waits to
// lock-outs; OWASP's Authentication Cheat Sheet ("Account lockout") warns that a shared lock-out is
// itself a denial of service, so the wait is per device. Five per device in five minutes with waits
// of 1, 5, 15 and 60 minutes, and 20 per organisation in 10 minutes, keep the 10,000 PINs days
// away from a guesser while a typo costs one minute at one tablet.
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
/** A device this long past its last wrong PIN and its last wait starts again from the first wait. */
export const PIN_GUARD_TRIPS_FORGOTTEN_MS = 60 * 60_000
/** Wrong PINs across all the devices of one organisation that make each further one trip… */
export const PIN_GUARD_SCOPE_FAILURES = 20
/** …within this window. */
export const PIN_GUARD_SCOPE_WINDOW_MS = 10 * 60_000
/** A device not seen for this long is forgotten (its trips too). */
const FORGET_AFTER_MS = 24 * 60 * 60_000

interface DeviceState {
  /** When the wrong PINs of the current window were entered. */
  failures: number[]
  /** Trips since the device last went an hour without a wrong PIN or a wait. */
  trips: number
  /** When the last wrong PIN was entered (ms since the epoch). */
  lastFailure: number
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
  /** The wrong PINs of each organisation's devices within the scope window. */
  readonly #scopes = new Map<string, number[]>()

  /** May the device try a PIN at `now`? A waiting device is told how long is left. */
  check(deviceId: string, now: Date): PinGuardCheck {
    const state = this.#devices.get(deviceId)
    const at = now.getTime()
    if (state === undefined || state.waitUntil <= at) return { ok: true }
    return { ok: false, retryAfterSeconds: Math.ceil((state.waitUntil - at) / 1000) }
  }

  /**
   * Counts a wrong PIN; the fifth in the device's window trips the guard, and so does every wrong
   * PIN once the organisation (`scopeId`) is past its ceiling.
   */
  fail(deviceId: string, now: Date, scopeId?: string): PinGuardFailure {
    const at = now.getTime()
    this.#forgetIdle(at)
    const state = this.#devices.get(deviceId) ?? {
      failures: [],
      trips: 0,
      lastFailure: 0,
      waitUntil: 0,
      lastSeen: at,
    }
    if (at - Math.max(state.lastFailure, state.waitUntil) >= PIN_GUARD_TRIPS_FORGOTTEN_MS) {
      state.trips = 0
    }
    state.lastSeen = at
    state.lastFailure = at
    state.failures = [...state.failures.filter((time) => at - time < PIN_GUARD_WINDOW_MS), at]
    this.#devices.set(deviceId, state)
    const scopeOver =
      scopeId !== undefined && this.#countScope(scopeId, at) > PIN_GUARD_SCOPE_FAILURES
    if (state.failures.length < PIN_GUARD_FAILURES && !scopeOver) return { tripped: false }
    const wait =
      PIN_GUARD_WAITS_MS[Math.min(state.trips, PIN_GUARD_WAITS_MS.length - 1)] ?? 60 * 60_000
    state.trips += 1
    state.failures = []
    state.waitUntil = at + wait
    return { tripped: true, trip: state.trips, waitSeconds: wait / 1000 }
  }

  /** Adds a wrong PIN to the organisation's window and answers how many it now holds. */
  #countScope(scopeId: string, at: number): number {
    const failures = [
      ...(this.#scopes.get(scopeId) ?? []).filter((time) => at - time < PIN_GUARD_SCOPE_WINDOW_MS),
      at,
    ]
    this.#scopes.set(scopeId, failures)
    return failures.length
  }

  #forgetIdle(at: number): void {
    for (const [deviceId, state] of this.#devices) {
      if (at - state.lastSeen > FORGET_AFTER_MS && state.waitUntil <= at) {
        this.#devices.delete(deviceId)
      }
    }
    for (const [scopeId, failures] of this.#scopes) {
      if (failures.every((time) => at - time >= PIN_GUARD_SCOPE_WINDOW_MS))
        this.#scopes.delete(scopeId)
    }
  }
}
