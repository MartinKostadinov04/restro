// The read side of the waiting list (ticket #330; D137, D138): one night's parties with no spot,
// oldest first, as both the night's list and a free spot's sheet read them.
//
// **It is not a list of its own** (D137, log 3.23 and 3.24): a waiting party is a reservation like
// any other — kind `walk_in`, status `waiting`, with a fractional `queue_key` — so it is already in
// the night's rows, under the night's own "Waiting" filter. What this module adds is the three
// things the queue needs and a row of the night's list does not: **the order** (the queue key, not
// the hour), **how long the party has waited**, and **the telephone number**, because the whole
// point of a queue is that the hostess calls the next one by hand. Nothing here is automated:
// nothing is matched by party size and nobody is texted.
//
// The number is on the row here, as it is on the venue's guest list (#333) and unlike the night's
// list: a queue is a short list of whom to ring next, never a busy night's every booking, and
// `MAX_WAITING_ROWS` keeps it short whatever the night does. Our own prefixed ids and public
// fields only (rule 3).
//
// Read-only: nothing here writes, and the queue's order is written in exactly one place — the
// `queue_key`, by `waiting.add` and `waiting.reorder` (`tonight.ts`). The key is a byte-ordered
// column, so the database's order and a JavaScript comparison of the same keys agree.

import { guests, type ReadTx, reservations } from '@restro/db'
import { and, asc, eq, isNull } from 'drizzle-orm'

/** How many waiting parties one read returns: twenty on a Saturday is a busy queue (#330). */
export const MAX_WAITING_ROWS = 100

/** One party on the night's waiting list, as its row and a free spot's sheet read it. */
export interface WaitingPartyRead {
  readonly reservationId: string
  /** Its place in the queue: the fractional key the order is kept in, never shown. */
  readonly queueKey: string
  /** What to call the party: the guest record's name, or the name written on the book. */
  readonly name: string | null
  /** The number to ring, for the call link; null where nobody took one. */
  readonly phone: string | null
  readonly partySize: number | null
  readonly note: string | null
  readonly guestId: string | null
  /** When the party was written down: what the waiting time counts from. */
  readonly since: Date
  /** Whole minutes waited at the moment of the read; never negative. */
  readonly waitedMinutes: number
}

/** Whole minutes from the moment a party was written down, floored at nothing. */
export function waitedMinutes(since: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000))
}

/**
 * One night's waiting list, oldest first. The order is the queue key's and nothing else's: a party
 * the hostess moved up the queue has the same hour it was written down, so an hour's order would
 * quietly undo her move.
 *
 * Shared by the night's list and the floor plan, so the two can never offer the same queue in two
 * different orders.
 */
export async function waitingParties(
  tx: ReadTx,
  venueId: string,
  day: string,
  now: Date,
): Promise<WaitingPartyRead[]> {
  const rows = await tx
    .select({
      id: reservations.id,
      queueKey: reservations.queueKey,
      partyLabel: reservations.partyLabel,
      guestId: reservations.guestId,
      guestName: guests.name,
      guestPhone: guests.phone,
      partySize: reservations.partySize,
      note: reservations.note,
      startsAt: reservations.startsAt,
    })
    .from(reservations)
    .leftJoin(guests, eq(guests.id, reservations.guestId))
    .where(
      and(
        eq(reservations.venueId, venueId),
        eq(reservations.serviceDate, day),
        eq(reservations.status, 'waiting'),
        isNull(reservations.deletedAt),
      ),
    )
    .orderBy(asc(reservations.queueKey), asc(reservations.id))
    .limit(MAX_WAITING_ROWS)
  return rows.map((row) => ({
    reservationId: row.id,
    // The column's own check says a waiting party always has a key; the empty string would sort
    // first rather than throw, and the order of the read above is the database's in any case.
    queueKey: row.queueKey ?? '',
    name: row.partyLabel ?? row.guestName,
    phone: row.guestPhone,
    partySize: row.partySize,
    note: row.note,
    guestId: row.guestId,
    since: row.startsAt,
    waitedMinutes: waitedMinutes(row.startsAt, now),
  }))
}
