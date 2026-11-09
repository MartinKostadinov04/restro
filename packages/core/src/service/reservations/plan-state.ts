// What one spot on the floor plan reads as (ticket #327; D134, D135, D137, D141). Pure: no I/O and
// no clock of its own — the caller injects `now`, as every rule module here does.
//
// **A spot's state is never stored.** It is derived, every time, from the reservations that hold
// it and from nothing else: there is no column on `spots` saying free or taken, and a screen that
// wanted one would have two answers to the same question the first time a write went half way.
//
// **The bill is not in it** (D134, log 1.44). Nothing here reads a sitting, a bill or a sent order:
// a POS bill closing changes nothing, a party whose bill closed still reads Sitting, and its spots
// stay held until the night's end or until staff free them. A spot never reads free because a bill
// went away.
//
// The holds themselves are the overlap rule's (`overlap.ts`): `holdsSpotAt` answers whether anyone
// is **on** a spot at a moment, which is the plan's question — not `spotConflict`, which answers
// whether a stretch may still be booked.

import { holdsSpotAt, type Stretch } from './overlap'
import type { ReservationKind, ReservationStatus } from './status'

/**
 * What a spot reads as tonight. Each one is a word on the screen and a line in the legend, never a
 * colour on its own (D134, log 13.11): the person reading the plan is a hostess at 02:00 under
 * club lighting.
 */
export const SPOT_STATES = [
  /** Nobody holds it at this moment. */
  'free',
  /** A booking holds it: the party is expected and nobody is there yet. */
  'held',
  /** A party is at it. */
  'sitting',
  /** A booking is past its hour and nobody has marked the party present (D135). */
  'late',
  /** Kept out of use by a block (D137): a reservation of the block kind, with a reason. */
  'blocked',
] as const

/** One spot state. */
export type SpotState = (typeof SPOT_STATES)[number]

/**
 * One reservation's hold on one spot, as the plan reads it: the overlap rule's stretch, plus what
 * kind of line it is and who it is, so the spot's sheet can say "who is sitting in it now, who
 * booked it and from when".
 */
export interface SpotHoldFact {
  readonly reservationId: string
  readonly kind: ReservationKind
  readonly status: ReservationStatus
  /** From when to when it holds the spot (the turn time's, or the end staff set). */
  readonly stretch: Stretch
  /** The reservation carries an end time of its own, so a seated party's hold ends at it. */
  readonly ownEnd: boolean
  /** The hour the party is expected, which is what the sheet says ("booked from 23:00"). */
  readonly startsAt: Date
  /** When the party was marked present; null for one that never arrived, and for a block. */
  readonly seatedAt: Date | null
  /** The guest's name, or the name on the book; null for a walk-in nobody named, and for a block. */
  readonly name: string | null
  readonly partySize: number | null
  /** A block's reason, as its code (D135: only blocking requires one). */
  readonly reason: string | null
  /** A block with no until date, which stays on until somebody lifts it (D137). */
  readonly openEnded: boolean
}

/**
 * Whether a hold covers a moment. A block with no until date is the one hold with no end: D137
 * has it "staying on until removed when none are set", so the turn time must not quietly lift it
 * at the end of its first two hours. Every other hold is the overlap rule's own `holdsSpotAt`.
 */
export function holdCoversAt(hold: SpotHoldFact, now: Date): boolean {
  if (hold.kind === 'block' && hold.openEnded) {
    return hold.status === 'reserved' && hold.stretch.from.getTime() <= now.getTime()
  }
  return holdsSpotAt(hold, now)
}

/**
 * How long after its hour a party nobody marked present reads as late (D135: it is warned, and
 * nothing is freed by itself). Fifteen minutes is the grace the trade keeps — the window a
 * restaurant holds a table before it calls the booking late — so a hostess is not told at
 * 23:00:30 that the 23:00 party is late while they are still at the door. The night's list reads
 * the same value from here, so the list and the plan never call one party two things.
 */
export const LATE_AFTER_MINUTES = 15

/** True when a hold is a party past its hour that nobody has marked present. */
export function isLateHold(hold: SpotHoldFact, now: Date, afterMinutes = LATE_AFTER_MINUTES) {
  if (hold.kind === 'block' || hold.status !== 'reserved') return false
  return hold.startsAt.getTime() + afterMinutes * 60_000 <= now.getTime()
}

/**
 * What a spot reads as at a moment, out of the holds on it. A block cannot sit on top of a party —
 * the overlap rule refuses one where a party already holds the spot — so the order below never has
 * to choose between a block and the people at the table; it is written down all the same, because
 * a reader of the screen must be able to say why a spot shows the word it shows.
 */
export function spotStateAt(
  holds: readonly SpotHoldFact[],
  now: Date,
  afterMinutes = LATE_AFTER_MINUTES,
): SpotState {
  const covering = holds.filter((hold) => holdCoversAt(hold, now))
  if (covering.some((hold) => hold.kind === 'block')) return 'blocked'
  if (covering.some((hold) => hold.status === 'seated')) return 'sitting'
  if (covering.some((hold) => isLateHold(hold, now, afterMinutes))) return 'late'
  return covering.length > 0 ? 'held' : 'free'
}

/**
 * What a spot reads as on a night that has passed (D141, 9.21: a month of plans is readable). A
 * night that is over has no "now" to ask about, so the question becomes what the spot was used for
 * that night: a spot a party sat at reads Sitting, one only ever booked reads Held, one a block
 * kept out reads Blocked, and one nothing touched reads Free. Late is a state of the night in
 * progress and never appears here — by the morning, a party that never came is a no-show on the
 * list, and the spot was simply held.
 */
export function spotStateOfNight(holds: readonly SpotHoldFact[]): SpotState {
  // A line called off held nothing: a booking the guest cancelled, and a block somebody lifted,
  // both leave the night as if the spot had been free (the Log still says they were there).
  const real = holds.filter((hold) => hold.status !== 'cancelled')
  if (real.some((hold) => hold.kind === 'block')) return 'blocked'
  if (real.some((hold) => hold.status === 'seated' || hold.seatedAt !== null)) return 'sitting'
  return real.length > 0 ? 'held' : 'free'
}

/** The hold that explains a spot's state: what the sheet names first. */
export function leadingHold(
  holds: readonly SpotHoldFact[],
  state: SpotState,
  now: Date,
  afterMinutes = LATE_AFTER_MINUTES,
): SpotHoldFact | null {
  const covering = holds.filter((hold) => holdCoversAt(hold, now))
  const pick =
    state === 'blocked'
      ? covering.find((hold) => hold.kind === 'block')
      : state === 'sitting'
        ? covering.find((hold) => hold.status === 'seated')
        : state === 'late'
          ? covering.find((hold) => isLateHold(hold, now, afterMinutes))
          : covering[0]
  return pick ?? null
}
