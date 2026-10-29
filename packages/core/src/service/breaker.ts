// The connection breaker (D120, D122 §6; the ordering check's round 2 §4; ticket #79): one pure
// function with an injected clock and random source, one state per POS connection (the POS
// instance's login). The worker feeds it what happens on the connection and does what it answers;
// a connection pause is a `pauses` row of scope `connection`, and when every connection of a venue
// is paused, that is the venue pause.
//
// What pauses the connection (a Restro pause: no button, it lifts by itself):
// - no POS call has succeeded for 60 s, with at least 3 attempts in that time;
// - a refusal scoped to the login or the venue (a wrong login, a closed day), or a probe that finds
//   the POS in training mode or its fiscal device out: at once;
// - 3 sent orders at different tables end Unconfirmed within 10 minutes;
// - during the 5-minute watch after a lift: one Unconfirmed order, or 2 failed calls in a row.
// How it lifts: a probe (the connector's read-only probe, good only when it answers correctly
// within 3 s) at 15 s, 30 s, then every 60 s while failing (60 s, 2 min, then 5 min after a
// refusal), each ±20 %; after a good one every 15 s; 3 good in a row lift it, never before it has
// lasted 60 s. The third automatic pause within 30 minutes holds at least 10 minutes and tells
// Restro's team the connection is unstable. While paused, a good read-back of an order already
// sent counts as the probe that is due.
// After a write times out, the next order waits for a good probe (`hold`), and one is due at once.
//
// The state is plain JSON: the worker keeps it in memory and writes it on the active pause row,
// so a restart neither lifts nor doubles a pause. These numbers are starting values (D120:
// tuned from practice, without a new decision).

import { z } from 'zod'

import { SERVICE_TIMINGS } from '../timings'

const SECOND = 1000
const MINUTE = 60 * SECOND

/** The breaker's numbers (D120, D122 §6, round 2 §4). */
export const BREAKER = Object.freeze({
  /** No call succeeded for this long, with at least `tripMinAttempts` in it: pause. */
  tripWindowMs: 60 * SECOND,
  tripMinAttempts: 3,
  /** This many Unconfirmed sent orders at different tables within the window: pause. */
  unconfirmedTables: 3,
  unconfirmedWindowMs: 10 * MINUTE,
  /** A pause lasts at least this long. */
  minPauseMs: 60 * SECOND,
  /** The `unstableCount`th automatic pause within `unstableWindowMs` holds this long. */
  unstableHoldMs: 10 * MINUTE,
  unstableCount: 3,
  unstableWindowMs: 30 * MINUTE,
  /** After a lift: probes go on, and less is needed to pause again. */
  watchMs: 5 * MINUTE,
  watchFailuresInRow: 2,
  /** Good probes in a row that lift a pause. */
  goodProbesToLift: 3,
  /** The gaps between probes while failing, after a refusal, and once a probe was good. */
  failingGapsMs: [15 * SECOND, 30 * SECOND, 60 * SECOND] as readonly number[],
  refusedGapsMs: [60 * SECOND, 2 * MINUTE, 5 * MINUTE] as readonly number[],
  goodGapMs: 15 * SECOND,
  /** Each gap is randomised by up to this share either way. */
  jitter: 0.2,
  /** A probe (or a read-back that stands for one) is good only within this. */
  probeBudgetMs: SERVICE_TIMINGS.probeBudgetMs,
})

/** Why Restro paused a connection: the window, too many Unconfirmed, or the POS's own words. */
export const BREAKER_CAUSES = {
  unreachable: 'pos_unreachable',
  unconfirmed: 'unconfirmed_orders',
} as const

const Time = z.number().int().nonnegative()
const Cause = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

const OpenSchema = z.strictObject({
  since: Time,
  cause: Cause,
  /** The last bad answer was a refusal: probes back off gently. */
  refused: z.boolean(),
  /** It lifts no earlier than this. */
  holdUntil: Time,
  goodInRow: z.number().int().nonnegative(),
  /** Bad probes since the pause or the last good probe: the index into the gaps. */
  attempt: z.number().int().nonnegative(),
  nextProbeAt: Time,
})

/** One connection's breaker. */
export const BreakerStateSchema = z.strictObject({
  /** The paused side, or null while orders flow. */
  open: OpenSchema.nullable(),
  /** When the automatic pauses of the last 30 minutes started. */
  autoPauses: z.array(Time),
  /** The first failed call since the last good one. */
  failingSince: Time.nullable(),
  /** The failed calls of the last minute. */
  failures: z.array(Time),
  failsInRow: z.number().int().nonnegative(),
  /** Unconfirmed sent orders since the last lift, within the window. */
  unconfirmed: z.array(z.strictObject({ at: Time, tableId: z.string().min(1) })),
  /** The watch after a lift ends here. */
  watchUntil: Time.nullable(),
  /** A write timed out: the next order waits for a good probe. */
  hold: z.boolean(),
  /** The next probe while orders flow (during the watch, or for a hold); null for none. */
  nextProbeAt: Time.nullable(),
})
export type BreakerState = z.output<typeof BreakerStateSchema>

/** What happened on the connection. */
export type BreakerEvent =
  /** Any POS call through the connection: a read, a write, a read-back. */
  | { readonly kind: 'call'; readonly ok: boolean; readonly elapsedMs?: number }
  /** A write ended `unknown` (a failed call too). */
  | { readonly kind: 'write_timeout' }
  /** A refusal scoped to the login or the venue; `cause` is its code. */
  | { readonly kind: 'refused'; readonly cause: string }
  /** A sent order ended Unconfirmed. */
  | { readonly kind: 'unconfirmed'; readonly tableId: string }
  /**
   * A probe's answer: good (answered correctly within the budget), bad (no answer, too slow,
   * degraded), or refused (a refusal, training mode, the fiscal device out) with its cause.
   */
  | {
      readonly kind: 'probe'
      readonly outcome: 'good' | 'bad' | 'refused'
      readonly cause: string | null
    }
  /** Time passed. */
  | { readonly kind: 'tick' }

/** What the worker must do. */
export type BreakerAction =
  | { readonly kind: 'pause'; readonly cause: string; readonly unstable: boolean }
  | { readonly kind: 'lift' }

/** Whether the connection takes an order now. */
export type BreakerGate = 'open' | 'hold' | 'paused'

/** A breaker with nothing on record. */
export function closedBreaker(): BreakerState {
  return {
    open: null,
    autoPauses: [],
    failingSince: null,
    failures: [],
    failsInRow: 0,
    unconfirmed: [],
    watchUntil: null,
    hold: false,
    nextProbeAt: null,
  }
}

/** Whether an order may go: paused, waiting for a good probe after a timeout, or open. */
export function breakerGate(state: BreakerState, _now: number): BreakerGate {
  if (state.open !== null) return 'paused'
  return state.hold ? 'hold' : 'open'
}

/** When the next probe is due, or null. */
export function nextProbeAt(state: BreakerState): number | null {
  return state.open?.nextProbeAt ?? state.nextProbeAt
}

/** True when a probe is due at `now`. */
export function probeDue(state: BreakerState, now: number): boolean {
  const at = nextProbeAt(state)
  return at !== null && at <= now
}

/** A gap with its jitter, from `random` in [0, 1). */
function jittered(gap: number, random: () => number): number {
  return Math.round(gap * (1 + BREAKER.jitter * (2 * random() - 1)))
}

function gapAt(gaps: readonly number[], attempt: number): number {
  return gaps[Math.min(attempt, gaps.length - 1)] as number
}

/** Drops what fell out of its window. */
function prune(state: BreakerState, now: number): BreakerState {
  return {
    ...state,
    autoPauses: state.autoPauses.filter((at) => now - at < BREAKER.unstableWindowMs),
    failures: state.failures.filter((at) => now - at <= BREAKER.tripWindowMs),
    unconfirmed: state.unconfirmed.filter((one) => now - one.at < BREAKER.unconfirmedWindowMs),
  }
}

/** Pauses the connection. */
function trip(
  state: BreakerState,
  now: number,
  cause: string,
  refused: boolean,
  random: () => number,
): { state: BreakerState; actions: BreakerAction[] } {
  const autoPauses = [...state.autoPauses, now]
  const unstable = autoPauses.length >= BREAKER.unstableCount
  const gaps = refused ? BREAKER.refusedGapsMs : BREAKER.failingGapsMs
  return {
    state: {
      ...closedBreaker(),
      autoPauses,
      open: {
        since: now,
        cause,
        refused,
        holdUntil: now + (unstable ? BREAKER.unstableHoldMs : BREAKER.minPauseMs),
        goodInRow: 0,
        attempt: 0,
        nextProbeAt: now + jittered(gapAt(gaps, 0), random),
      },
    },
    actions: [{ kind: 'pause', cause, unstable }],
  }
}

/** The failing window has run its course: pause. */
function windowTrips(state: BreakerState, now: number): boolean {
  return (
    state.failingSince !== null &&
    now - state.failingSince >= BREAKER.tripWindowMs &&
    state.failures.length >= BREAKER.tripMinAttempts
  )
}

function inWatch(state: BreakerState, now: number): boolean {
  return state.watchUntil !== null && now < state.watchUntil
}

/** One failed call while orders flow. */
function failed(state: BreakerState, now: number): BreakerState {
  return {
    ...state,
    failingSince: state.failingSince ?? now,
    failures: [...state.failures, now],
    failsInRow: state.failsInRow + 1,
  }
}

/** A good call while orders flow. */
function succeeded(state: BreakerState): BreakerState {
  return { ...state, failingSince: null, failures: [], failsInRow: 0 }
}

/** A good probe (or a read-back standing for it) while paused. */
function goodWhileOpen(
  state: BreakerState,
  open: NonNullable<BreakerState['open']>,
  now: number,
  random: () => number,
): { state: BreakerState; actions: BreakerAction[] } {
  const goodInRow = open.goodInRow + 1
  if (goodInRow >= BREAKER.goodProbesToLift && now >= open.holdUntil) {
    return {
      state: {
        ...closedBreaker(),
        autoPauses: state.autoPauses,
        watchUntil: now + BREAKER.watchMs,
        nextProbeAt: now + jittered(BREAKER.goodGapMs, random),
      },
      actions: [{ kind: 'lift' }],
    }
  }
  return {
    state: {
      ...state,
      open: {
        ...open,
        goodInRow,
        attempt: 0,
        nextProbeAt: now + jittered(BREAKER.goodGapMs, random),
      },
    },
    actions: [],
  }
}

/** A bad or refused probe while paused: back to the gaps (step 4 restarts after a good one). */
function badWhileOpen(
  state: BreakerState,
  open: NonNullable<BreakerState['open']>,
  now: number,
  refused: boolean,
  random: () => number,
): BreakerState {
  const attempt = open.goodInRow > 0 ? 0 : open.attempt + 1
  const gaps = refused ? BREAKER.refusedGapsMs : BREAKER.failingGapsMs
  return {
    ...state,
    open: {
      ...open,
      refused,
      goodInRow: 0,
      attempt,
      nextProbeAt: now + jittered(gapAt(gaps, attempt), random),
    },
  }
}

/** The breaker's step: the state, what happened and when, to the new state and what to do. */
export function stepBreaker(
  input: BreakerState,
  event: BreakerEvent,
  now: number,
  random: () => number,
): { readonly state: BreakerState; readonly actions: readonly BreakerAction[] } {
  const state = prune(input, now)
  const open = state.open

  if (open !== null) {
    switch (event.kind) {
      case 'probe':
        if (event.outcome === 'good') return goodWhileOpen(state, open, now, random)
        return {
          state: badWhileOpen(state, open, now, event.outcome === 'refused', random),
          actions: [],
        }
      case 'refused':
        return { state: badWhileOpen(state, open, now, true, random), actions: [] }
      case 'call':
        // A good read-back of an order already sent stands for the probe that is due.
        if (
          event.ok &&
          now >= open.nextProbeAt &&
          (event.elapsedMs ?? Number.POSITIVE_INFINITY) <= BREAKER.probeBudgetMs
        ) {
          return goodWhileOpen(state, open, now, random)
        }
        return { state, actions: [] }
      default:
        return { state, actions: [] }
    }
  }

  // Orders flow.
  const watching = inWatch(state, now)
  let next: BreakerState = watching ? state : { ...state, watchUntil: null }
  if (!watching && !next.hold && state.watchUntil !== null) next = { ...next, nextProbeAt: null }

  switch (event.kind) {
    case 'refused':
      return trip(next, now, event.cause, true, random)
    case 'unconfirmed': {
      next = { ...next, unconfirmed: [...next.unconfirmed, { at: now, tableId: event.tableId }] }
      const tables = new Set(next.unconfirmed.map((one) => one.tableId))
      if (watching || tables.size >= BREAKER.unconfirmedTables) {
        return trip(next, now, BREAKER_CAUSES.unconfirmed, false, random)
      }
      return { state: next, actions: [] }
    }
    case 'call':
      next = event.ok ? succeeded(next) : failed(next, now)
      break
    case 'write_timeout':
      next = { ...failed(next, now), hold: true, nextProbeAt: now }
      break
    case 'probe':
      if (event.outcome === 'refused') {
        return trip(next, now, event.cause ?? BREAKER_CAUSES.unreachable, true, random)
      }
      if (event.outcome === 'good') {
        next = {
          ...succeeded(next),
          hold: false,
          nextProbeAt: watching ? now + jittered(BREAKER.goodGapMs, random) : null,
        }
      } else {
        next = {
          ...failed(next, now),
          nextProbeAt:
            watching || next.hold ? now + jittered(gapAt(BREAKER.failingGapsMs, 0), random) : null,
        }
      }
      break
    case 'tick':
      break
  }
  if (watching && next.failsInRow >= BREAKER.watchFailuresInRow) {
    return trip(next, now, BREAKER_CAUSES.unreachable, false, random)
  }
  if (windowTrips(next, now)) return trip(next, now, BREAKER_CAUSES.unreachable, false, random)
  return { state: next, actions: [] }
}
