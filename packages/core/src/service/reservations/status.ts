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

/**
 * Where "Put back" returns a party the night's end marked (D138): a no-show was booked, so it goes
 * back to Reserved; a party marked Not seated was in the queue, so it goes back to Waiting.
 * Nothing else is put back — a finished party is finished, and a cancelled one is re-made, not
 * restored.
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

/**
 * Whether this status counts on a guest's card as a time he did not come (D140). Only No-show
 * does: Not seated is the venue's own doing — nobody had a table for him — and Cancelled is an
 * answer, not an absence.
 */
export function countsAsNoShow(status: ReservationStatus): boolean {
  return status === 'no_show'
}
