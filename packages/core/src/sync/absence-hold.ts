// A safety net on rule 6 (see conclude-full-pull.ts): even after a complete full pull, a read that
// found nothing, or sharply less than we hold, is not evidence that everything was removed. It is
// far more likely that the scope of the read changed (another menu category, another barsy venue,
// an empty answer for a user without the right) than that a venue deleted its whole menu. In that
// case the pull concludes nothing about absence and says why (T62, B1-F1, B1-F4).
//
// This only ever adds cases where nothing is concluded. It never makes a pull conclude more than
// `concludeFullPull` does, and it never looks at an incomplete pull (that one concludes nothing
// already).
//
// Pure: no I/O, no clock.

/** More than this share of the active links going missing in one pull is held for a person. */
export const ABSENCE_HOLD_RATIO = 0.3

/** A pull hides at least this many links before the share above counts (a small menu may shrink). */
export const ABSENCE_HOLD_MIN = 5

/** Why a conclusion was held. */
export type AbsenceHoldReason = 'empty_read' | 'too_many_missing'

/** The verdict: carry on concluding absence, or hold it. */
export type AbsenceHold =
  | { readonly hold: false }
  | { readonly hold: true; readonly reason: AbsenceHoldReason }

/** What the verdict is based on. All three are whole counts of one kind of link (or place). */
export interface AbsenceHoldInput {
  /** How many were active before the pull. */
  readonly activeBefore: number
  /** How many the pull saw (listed by the source). */
  readonly seen: number
  /** How many active ones the pull would move to `missing` (after the race guard, if any). */
  readonly wouldGoMissing: number
}

/** A held conclusion, as the callers report it: why, and how much it would have hidden. */
export interface AbsenceHeld {
  readonly reason: AbsenceHoldReason
  /** How many active ones the pull would have moved to `missing`. */
  readonly wouldHide: number
  /** How many were active before the pull. */
  readonly active: number
}

function checkCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative whole number`)
  }
}

/**
 * Decides whether a full pull's absence conclusion is held back.
 *
 * - An empty read (it saw nothing while something was active, and would hide it) holds:
 *   `empty_read`.
 * - Hiding at least `ABSENCE_HOLD_MIN` and more than `ABSENCE_HOLD_RATIO` of the active ones
 *   holds: `too_many_missing`.
 * - Otherwise there is no hold. Nothing is ever held when `wouldGoMissing` is 0: a hold exists to
 *   stop a hiding, and there is none to stop.
 *
 * The empty-read rule asks for `wouldGoMissing > 0` only so that the last sentence is true for
 * every input; in a consistent call (an empty read of `activeBefore > 0` active links would hide
 * all of them) the two come to the same. Throws a `TypeError` (a caller bug, so the pull
 * concludes nothing) for a count that is not a non-negative whole number.
 */
export function absenceHold(input: AbsenceHoldInput): AbsenceHold {
  const { activeBefore, seen, wouldGoMissing } = input
  checkCount('activeBefore', activeBefore)
  checkCount('seen', seen)
  checkCount('wouldGoMissing', wouldGoMissing)
  if (wouldGoMissing === 0) return { hold: false }
  if (seen === 0 && activeBefore > 0) return { hold: true, reason: 'empty_read' }
  if (wouldGoMissing >= ABSENCE_HOLD_MIN && wouldGoMissing / activeBefore > ABSENCE_HOLD_RATIO) {
    return { hold: true, reason: 'too_many_missing' }
  }
  return { hold: false }
}
