// The guest's own link, inside the service write path (#579; spec #322 stories 8 and 34): the one
// thing the link can change, calling the booking off, and how a reservation's status reads to the
// guest who holds the link.
//
// `reservation.guest_cancel` is a guest command with no table and no permission, like the request
// itself: what lets it in is the link's token, whose hash it carries (the token never enters a
// command), and nothing else. It finds the venue's online booking with that hash, compares it in
// constant time, and refuses alike a hash that finds nothing, a booking taken out of the book and
// a link past its days (`link_unknown`), so a refusal says nothing about which it was. Once the
// night has started (the venue's service day has reached it) the guest calls the club instead
// (`night_started`); before that it is the staff's own cancellation (`cancelReservation`): the
// spots freed, the Log entry (the guest as its actor, from the engine's context) and the email.

import { reservations } from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'

import { guestLinkExpired, guestLinkHashesEqual } from '../booking-link'
import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { cancelReservation } from './book'
import { refuse } from './rows'
import type { ReservationStatus } from './status'

/** The statuses a guest may still call off from his link. */
const CANCELLABLE: readonly string[] = ['requested', 'reserved'] satisfies ReservationStatus[]

/**
 * True when the guest may call the booking off from his link: it is asked for or booked, and its
 * night is still to come (`today` is the venue's service day).
 */
export function guestCanCancel(
  booking: { readonly status: string; readonly serviceDate: string },
  today: string,
): boolean {
  return CANCELLABLE.includes(booking.status) && booking.serviceDate > today
}

/** What the link's Cancel sends: the hash of the link's token, never the token. */
export interface GuestCancelCommand {
  readonly tokenHash: string
}

/**
 * Calls off the online booking whose link's token hashes to `tokenHash`. Refused `link_unknown`
 * for no such booking (or one taken out of the book, or past the link's days), `night_started`
 * once its night has begun; calling off a booking already cancelled is answered as done, once.
 */
export async function cancelReservationByGuest(
  stx: ServiceTx,
  command: GuestCancelCommand,
): Promise<ServiceResult> {
  const [found] = await stx.tx
    .select({
      id: reservations.id,
      status: reservations.status,
      serviceDate: reservations.serviceDate,
      guestTokenHash: reservations.guestTokenHash,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.venueId, stx.venueId),
        eq(reservations.guestTokenHash, command.tokenHash),
        eq(reservations.kind, 'booking'),
        isNull(reservations.deletedAt),
      ),
    )
    .limit(1)
  if (
    found === undefined ||
    !guestLinkHashesEqual(found.guestTokenHash, command.tokenHash) ||
    guestLinkExpired(found.serviceDate, stx.serviceDate)
  ) {
    return refuse('link_unknown')
  }
  if (found.serviceDate <= stx.serviceDate) return refuse('night_started')
  // A second tap after the first went through: done, and nothing new is written or sent.
  if (found.status === 'cancelled') {
    return accepted(null, { details: { reservationId: found.id, repeated: true } })
  }
  // The staff's own cancellation, re-reading the line under its lock (a hostess may have just
  // answered it): the move is refused there when the booking is no longer one to call off.
  return cancelReservation(stx, { reservationId: found.id })
}
