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
      overlaps(claimed.stretch, hold.stretch),
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
