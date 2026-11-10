// A spot is never held by two reservations for overlapping stretches of a night (ticket #323; spec
// #321, Implementation Decision 1). The turn time is **one** value (D135): it is both how long a
// spot is held and so the shortest gap before the next booking, read from the venue's reservation
// settings unless the reservation carries its own end time. A second setting for the gap would let
// the two drift apart, so there is none.
//
// Reservation management stays apart from the bill (D134, decision log 1.44): nothing in this
// module takes a bill, a payment or a sitting, so a bill closing can never read a held spot free.
// A seated party keeps its spots until it is finished, until its own end time passes, or until the
// night's sweep — the plan's state (ticket #327) derives from `holdsSpotAt` alone.
//
// The two questions this module answers are different, and a writer must pick the right one
// (ticket #329 tests both): `spotConflict` asks whether a stretch of the night may be **booked**,
// where the turn time is a planning assumption, so a spot reads free once that time has passed;
// `holdsSpotAt` asks whether anyone is **on** the spot at a moment, where an overstaying party
// still holds it. So a booking at 22:30 onto a table seated at 21:00 for ninety minutes is
// allowed, and seating a walk-in there at 22:30 is not. Booking paths check `spotConflict`;
// seating and walk-in paths check `holdsSpotAt` at the moment of seating.
//
// Pure: no I/O. The caller injects `now`.

import { z } from 'zod'

import type { Id } from '../../ids'
import { holdsSpots, type ReservationStatus } from './status'

/** How long a spot is held, in minutes: a positive whole number, never a default invented here. */
export const TurnMinutesSchema = z.number().int().positive()

/** A stretch of a night a spot is held for: `from` included, `to` excluded. */
export interface Stretch {
  readonly from: Date
  readonly to: Date
}

/** One spot held by one reservation, as the night's rows give it. */
export interface SpotHold {
  readonly reservationId: Id<'rv'>
  readonly spotId: Id<'sp'>
  readonly status: ReservationStatus
  readonly stretch: Stretch
  /**
   * A block with no end of any kind (D137): it stays on until somebody lifts it, so the turn time
   * must not end it. Left out, the hold ends where its stretch does.
   */
  readonly openEnded?: boolean
  /**
   * The reservation carries an end time of its own, so a **seated** party's hold ends at it rather
   * than running to the end of the night (`holdsSpotAt`). Left out, it has none.
   */
  readonly ownEnd?: boolean
}

/** A reservation asking for spots: the one being created, edited or moved. */
export interface SpotClaim {
  /** The reservation itself, so an edit never collides with its own hold. */
  readonly reservationId: Id<'rv'>
  readonly spotIds: readonly Id<'sp'>[]
  readonly startsAt: Date
  /** Its own end time, when staff set one; null leaves the turn time to decide. */
  readonly endsAt: Date | null
  /** Its own turn time, when it carries one; null reads the venue's. */
  readonly turnMinutes: number | null
}

/** The spot a claim could not have, and the reservation already holding it. */
export interface SpotConflict {
  readonly spotId: Id<'sp'>
  readonly reservationId: Id<'rv'>
}

/** Why a claim was refused. */
export const SPOT_CLAIM_REFUSALS = [
  /** Another reservation holds one of the spots for an overlapping stretch. */
  'spot_taken',
  /** The end time is at or before the start. */
  'end_before_start',
] as const

/** One claim refusal code. */
export type SpotClaimRefusal = (typeof SPOT_CLAIM_REFUSALS)[number]

/** The claim's held stretch, or the refusal. */
export type ClaimedStretch =
  | { readonly ok: true; readonly stretch: Stretch }
  | { readonly ok: false; readonly code: SpotClaimRefusal }

/** The turn time in force for a reservation: its own, else the venue's (D135: one value). */
export function resolveTurnMinutes(own: number | null, venueTurnMinutes: number): number {
  return own ?? venueTurnMinutes
}

/**
 * The stretch a reservation holds its spots for: from its hour, to its own end time when it has
 * one, else its hour plus the turn time in force.
 */
export function heldStretch(claim: SpotClaim, venueTurnMinutes: number): ClaimedStretch {
  const from = claim.startsAt
  if (claim.endsAt !== null) {
    return claim.endsAt.getTime() <= from.getTime()
      ? { ok: false, code: 'end_before_start' }
      : { ok: true, stretch: { from, to: claim.endsAt } }
  }
  const minutes = resolveTurnMinutes(claim.turnMinutes, venueTurnMinutes)
  return { ok: true, stretch: { from, to: new Date(from.getTime() + minutes * 60_000) } }
}

/**
 * True when two stretches share a moment. Half-open, so a booking that starts exactly when the
 * one before it ends is allowed: the turn time has already made that gap.
 */
export function overlaps(a: Stretch, b: Stretch): boolean {
  return a.from.getTime() < b.to.getTime() && b.from.getTime() < a.to.getTime()
}

/** The far end of an open-ended block: no booking of any night reaches past it. */
const FOREVER = new Date(8_640_000_000_000_000)

/** The stretch a hold covers for the overlap rule: an open-ended block never ends (D137). */
export function coveredBy(hold: SpotHold): Stretch {
  return hold.openEnded === true ? { from: hold.stretch.from, to: FOREVER } : hold.stretch
}

/**
 * The first spot of the claim another reservation already holds for an overlapping stretch, or
 * null when every spot is free. Holds of the claim's own reservation and of a status that holds no
 * spot (a waiting walk-in, an end state) are not in the way. The spots are checked in the claim's
 * own order, so the refusal names the spot the person tapped first.
 */
export function spotConflict(
  claim: SpotClaim,
  held: readonly SpotHold[],
  venueTurnMinutes: number,
): SpotConflict | { readonly code: SpotClaimRefusal } | null {
  const claimed = heldStretch(claim, venueTurnMinutes)
  if (!claimed.ok) return { code: claimed.code }
  const wanted = new Set(claim.spotIds)
  const inTheWay = held.filter(
    (hold) =>
      hold.reservationId !== claim.reservationId &&
      wanted.has(hold.spotId) &&
      holdsSpots(hold.status) &&
      overlaps(claimed.stretch, coveredBy(hold)),
  )
  for (const spotId of claim.spotIds) {
    const hold = inTheWay.find((candidate) => candidate.spotId === spotId)
    if (hold !== undefined) return { spotId, reservationId: hold.reservationId }
  }
  return null
}

/** A conflict that names a spot, as against a refusal of the claim itself. */
export function isSpotConflict(
  result: SpotConflict | { readonly code: SpotClaimRefusal } | null,
): result is SpotConflict {
  return result !== null && 'spotId' in result
}

/**
 * Whether a reservation is sitting on its spots at `now`, which is what the floor plan reads
 * (ticket #327) — never a bill, never a sitting (D134, log 1.44):
 * - a booking (or an online request) holds its spots for its stretch, and not before it: a party
 *   booked for later in the night has its spot kept for it, which is the overlap rule above, but
 *   it is not sitting on it now;
 * - a seated party holds them from the moment it was seated — its hour does not come into it, so a
 *   party seated early never reads as free — until its own end time, and where it set none, until
 *   its status leaves Seated: the night's sweep, or staff freeing the spots;
 * - a waiting walk-in and every end state hold nothing.
 */
export function holdsSpotAt(
  hold: { readonly status: ReservationStatus; readonly stretch: Stretch; readonly ownEnd: boolean },
  now: Date,
): boolean {
  if (!holdsSpots(hold.status)) return false
  if (hold.status === 'seated') return !hold.ownEnd || now.getTime() < hold.stretch.to.getTime()
  return hold.stretch.from.getTime() <= now.getTime() && now.getTime() < hold.stretch.to.getTime()
}

/**
 * Whether a hold has somebody **on** the spot at `now`: `holdsSpotAt`, with the one hold that has
 * no end of any kind taken account of — a block nobody put a date on stays on until it is lifted
 * (D137), so the turn time must not quietly clear it at the end of its first two hours.
 *
 * This is the question the floor plan asks (`plan-state.ts`) and the question seating asks
 * (`seatConflict`); it is never the question a booking asks (`spotConflict`). The two screens read
 * it through this one function on purpose: a spot that reads Sitting on the plan is exactly a spot
 * a walk-in cannot be seated on.
 */
export function holdsSpotNow(
  hold: {
    readonly status: ReservationStatus
    readonly stretch: Stretch
    readonly ownEnd?: boolean
    readonly openEnded?: boolean
  },
  now: Date,
): boolean {
  if (hold.openEnded === true) {
    return holdsSpots(hold.status) && hold.stretch.from.getTime() <= now.getTime()
  }
  return holdsSpotAt(
    { status: hold.status, stretch: hold.stretch, ownEnd: hold.ownEnd ?? false },
    now,
  )
}

/** What a party being seated wants: the spots, and the line itself so it never blocks itself. */
export interface SeatClaim {
  readonly reservationId: Id<'rv'>
  readonly spotIds: readonly Id<'sp'>[]
}

/**
 * The first spot a party cannot be seated on, because somebody is **on** it at this moment, or
 * null when every spot is free to sit at (ticket #329).
 *
 * This is deliberately not `spotConflict`, and the two disagree on purpose: a party still at its
 * table an hour past the turn time holds its spots here, while a *booking* for that same hour is
 * allowed, because the turn time is a planning assumption and not a clock that clears tables. So
 * every seating path — "Arrived", a walk-in off the plan, a party given another table at the door —
 * asks this one, at the moment of seating, and the booking paths ask the other.
 *
 * The spots are checked in the caller's own order, so the refusal names the spot the hostess
 * tapped first.
 */
export function seatConflict(
  claim: SeatClaim,
  held: readonly SpotHold[],
  now: Date,
): SpotConflict | null {
  const wanted = new Set<string>(claim.spotIds)
  const inTheWay = held.filter(
    (hold) =>
      hold.reservationId !== claim.reservationId &&
      wanted.has(hold.spotId) &&
      holdsSpotNow(hold, now),
  )
  for (const spotId of claim.spotIds) {
    const hold = inTheWay.find((candidate) => candidate.spotId === spotId)
    if (hold !== undefined) return { spotId, reservationId: hold.reservationId }
  }
  return null
}
