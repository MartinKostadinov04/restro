// The eight statuses of a reservation and the moves between them (ticket #323; spec #321,
// Implementation Decision 1). D135 names seven — Requested, Reserved, Waiting, Seated, Finished,
// No-show, Cancelled — and the later D138 names an eighth for a party still on the waiting list
// when the night ends: Not seated. One table of allowed moves, so every command and every screen
// reads the same rule and a move nobody allowed is refused by its name instead of being written.
//
// Requested is here for part 2 (booking online): nothing in part 1 creates it, and a booking a
// hostess takes over the phone is Reserved.
//
// Not seated is an end state of its own and is never counted as a no-show on a guest's card: the
// counts there are a rough count for a hostess, not a record (D140).
//
// Pure: no I/O. The clock belongs to the writers, not here: which status the night's sweep gives a
// party is the sweep's decision (the night's end), and whether a past night may be written at all
// is the command's guard.

import { z } from 'zod'

/** Every status a reservation can hold. */
export const RESERVATION_STATUSES = [
  /** Asked for online and not yet answered (part 2; nothing in part 1 creates it). */
  'requested',
  /** Booked: the spot is held for the party. */
  'reserved',
  /** A walk-in in the queue, holding no spot yet (D137: the waiting list is a simple queue). */
  'waiting',
  /** At the table: the spots are theirs until they are finished or the night ends. */
  'seated',
  /** The party came and left. */
  'finished',
  /** Booked and never came. */
  'no_show',
  /** Called off, by the guest or by the venue. */
  'cancelled',
  /** Still waiting when the night ended (D138): never a no-show. */
  'not_seated',
] as const

/** One reservation status. */
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

/** Zod schema of one status. */
export const ReservationStatusSchema = z.enum(RESERVATION_STATUSES)

/**
 * The moves each status allows. The only way out of an end state is "Put back" (`putBack`), an
 * admin's single action on one reservation (D138: there is no bulk undo).
 */
export const RESERVATION_STATUS_MOVES: Readonly<
  Record<ReservationStatus, readonly ReservationStatus[]>
> = {
  requested: ['reserved', 'cancelled'],
  reserved: ['seated', 'no_show', 'cancelled'],
  waiting: ['seated', 'not_seated', 'cancelled'],
  seated: ['finished'],
  finished: [],
  no_show: [],
  cancelled: [],
  not_seated: [],
}

/** The statuses nothing moves out of, except "Put back". */
export const END_STATUSES = [
  'finished',
  'no_show',
  'cancelled',
  'not_seated',
] as const satisfies readonly ReservationStatus[]

/** True for a status the night is over for. */
export function isEndStatus(status: ReservationStatus): boolean {
  return (END_STATUSES as readonly ReservationStatus[]).includes(status)
}

/**
 * The statuses that hold a spot against another booking: an online request waiting for its answer
 * (part 2), a booking, and a party at the table. A waiting walk-in holds no spot, and an end state
 * holds none.
 */
export const HOLDING_STATUSES = [
  'requested',
  'reserved',
  'seated',
] as const satisfies readonly ReservationStatus[]

/** True when a reservation in this status holds its spots. */
export function holdsSpots(status: ReservationStatus): boolean {
  return (HOLDING_STATUSES as readonly ReservationStatus[]).includes(status)
}

/** Why a status move was refused. The command answers with the code; the screen words it. */
export const RESERVATION_STATUS_REFUSALS = [
  /** The table of moves does not allow this one. */
  'status_move_not_allowed',
  /** "Put back" was asked for a status it does not return from. */
  'put_back_not_allowed',
  /** An arrival was undone for a reservation that is not at a table, or for a block. */
  'undo_arrival_not_allowed',
  /** The Undo of a put back found the party moved since, or nothing the night's end did. */
  'undo_put_back_not_allowed',
] as const

/** One status refusal code. */
export type ReservationStatusRefusal = (typeof RESERVATION_STATUS_REFUSALS)[number]

/** A move that was allowed, or the code that refuses it. */
export type StatusMove =
  | { readonly ok: true; readonly status: ReservationStatus }
  | { readonly ok: false; readonly code: ReservationStatusRefusal }

/** True when the table of moves allows this one. A status never moves to itself. */
export function canMove(from: ReservationStatus, to: ReservationStatus): boolean {
  return RESERVATION_STATUS_MOVES[from].includes(to)
}

/** The move, or its refusal. The only place a status change is decided. */
export function moveStatus(from: ReservationStatus, to: ReservationStatus): StatusMove {
  return canMove(from, to)
    ? { ok: true, status: to }
    : { ok: false, code: 'status_move_not_allowed' }
}

/** The reason the night's end gives the status moves it makes (D138), in the Log. */
export const NIGHT_END_REASON = 'night_ended'

/** The reason "Put back" writes, in the Log. */
export const PUT_BACK_REASON = 'put_back'

/** The reason the Undo of a "Put back" writes: the night's end's status is back (#332). */
export const PUT_BACK_UNDONE_REASON = 'put_back_undone'

/**
 * What the night's end does to one party (D138; spec #321, Implementation Decision 6): the seated
 * become Finished, a booking nobody came for No-show, a party still waiting Not seated. A block is
 * untouched, and so is everything already over. **Requested** is untouched too: none can exist in
 * part 1 (#323), and declining one, releasing its hold and emailing the guest are part 2's.
 *
 * The same rule serves the closing hour, an admin's early end and the sweep once a night has
 * passed, so a party is marked the same way whichever of them reaches it first, and a second run
 * finds nothing left to move.
 */
export function nightEndStatus(
  status: ReservationStatus,
  kind: ReservationKind,
): ReservationStatus | null {
  if (kind === 'block') return null
  switch (status) {
    case 'seated':
      return 'finished'
    case 'reserved':
      return 'no_show'
    case 'waiting':
      return 'not_seated'
    default:
      return null
  }
}

/**
 * Where "Put back" returns a party (D138): a no-show was booked, so it goes back to Reserved; a
 * party marked Not seated was in the queue, so it goes back to Waiting. Nothing else is put back —
 * a finished party is finished (its codes are closed), and a cancelled one is re-made, not
 * restored. Whether the night's end or a hostess's tap ended it decides only **who** may put it
 * back (`endedByNightEnd`), never where it goes.
 */
export function putBackStatus(from: ReservationStatus): ReservationStatus | null {
  if (from === 'no_show') return 'reserved'
  if (from === 'not_seated') return 'waiting'
  return null
}

/** "Put back" as a move: the status it returns to, or the refusal. */
export function putBack(from: ReservationStatus): StatusMove {
  const status = putBackStatus(from)
  return status === null ? { ok: false, code: 'put_back_not_allowed' } : { ok: true, status }
}

/** One status line of a reservation's Log, as "Put back" reads it. */
export interface StatusEntry {
  readonly fromState: string | null
  readonly toState: string | null
  readonly reason: string | null
}

/**
 * Whether the night's end put a party where it is now: its newest status line moved it there with
 * the night's end's reason (or an Undo of a put back moved it back there). Read from the Log, never
 * from a second copy on the row (D141). `entries` are the party's status lines, oldest first.
 */
export function endedByNightEnd(
  entries: readonly StatusEntry[],
  status: ReservationStatus,
): boolean {
  const last = entries.at(-1)
  if (last === undefined || last.toState !== status) return false
  return last.reason === NIGHT_END_REASON || last.reason === PUT_BACK_UNDONE_REASON
}

/**
 * The Undo of one "Put back" (#332): the party goes back to the status the night's end had given
 * it. The newest status line must be that put back, and the line before it the night's end's (or
 * an earlier Undo's), so the status is read from the Log and never guessed at. Anything else — a
 * party somebody has moved since, a put back of a hostess's own No-show, whose Undo is her own
 * tap again — is refused. `entries` are the party's status lines, oldest first.
 */
export function undoPutBack(from: ReservationStatus, entries: readonly StatusEntry[]): StatusMove {
  const refused = { ok: false, code: 'undo_put_back_not_allowed' } as const
  const last = entries.at(-1)
  if (last === undefined || last.reason !== PUT_BACK_REASON || last.toState !== from) return refused
  const previous = ReservationStatusSchema.safeParse(last.fromState)
  if (!previous.success || putBackStatus(previous.data) !== from) return refused
  return endedByNightEnd(entries.slice(0, -1), previous.data)
    ? { ok: true, status: previous.data }
    : refused
}

/**
 * Whether this status counts on a guest's card as a time he did not come (D140). Only No-show
 * does: Not seated is the venue's own doing — nobody had a table for him — and Cancelled is an
 * answer, not an absence.
 */
export function countsAsNoShow(status: ReservationStatus): boolean {
  return status === 'no_show'
}

/** What a reservation is: a booking, a walk-in off the queue, or a block of the spot (D137). */
export const RESERVATION_KINDS = ['booking', 'walk_in', 'block'] as const

/** One reservation kind. */
export type ReservationKind = (typeof RESERVATION_KINDS)[number]

/** Zod schema of one kind. */
export const ReservationKindSchema = z.enum(RESERVATION_KINDS)

/**
 * The reason a reservation Cancelled by an undone arrival carries, so the one case where an undo
 * cannot put a party back reads as what it is wherever it is shown or logged.
 */
export const UNDONE_ARRIVAL_REASON = 'arrival_undone'

/**
 * Undoing "Arrived" inside the undo window Tonight already enforces (ticket #329): the party goes
 * back to where it was a moment before the tap. **Where it was is what the caller passes**, not
 * something read off the kind, because a walk-in reaches Seated by two routes (D141 lists them as
 * two actions, and #329 builds them as two):
 * - off the waiting list, where Waiting is where it was: `previous` is `waiting`, and it goes back
 *   on the queue;
 * - straight off the plan, where the seat tap *created* the reservation and there is no earlier
 *   status at all: `previous` is null, and the party is **Cancelled**. It cannot go to Waiting —
 *   that would put a party a hostess works by hand (#330) onto a list it was never on, holding a
 *   place in the queue for somebody who does not exist — and the row cannot be deleted, since app
 *   code deletes nothing (CLAUDE.md's never-list). Cancelled with the reason
 *   `UNDONE_ARRIVAL_REASON` is the honest record: a walk-in was seated and the write was undone.
 *   It counts against nobody (`countsAsNoShow` is false for Cancelled).
 *
 * A booking goes back to Reserved. The pair must make sense, so a booking with no previous status
 * and a walk-in that was somehow Reserved are both refused rather than guessed at.
 *
 * It is deliberately **not** an edge in the table of moves: nothing leaves Seated but Finished,
 * because a party at a table that is suddenly not there again is not a state anyone may move it
 * to. An undo is the erasure of a write, not a change of state, and only the person who just made
 * that write may do it, only within the window. It lives here all the same, so that no command
 * writes a status this module has not decided — the whole point of the table above is that there
 * is one place to read.
 *
 * A block is never seated, so undoing an arrival of one is refused. What the undo does besides the
 * status — closing the codes the arrival opened, writing the reason and the Log entry, and
 * refusing once the window has passed — is the command's, in ticket #329.
 */
export function undoArrival(
  from: ReservationStatus,
  kind: ReservationKind,
  previous: ReservationStatus | null,
): StatusMove {
  const refused = { ok: false, code: 'undo_arrival_not_allowed' } as const
  if (from !== 'seated' || kind === 'block') return refused
  if (kind === 'booking')
    return previous === 'reserved' ? { ok: true, status: 'reserved' } : refused
  if (previous === null) return { ok: true, status: 'cancelled' }
  return previous === 'waiting' ? { ok: true, status: 'waiting' } : refused
}
