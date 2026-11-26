// How a booking stands, as the guest who holds its link reads it (#579). Fewer words than the
// staff's statuses: a guest does not need "finished" apart from "seated", and never sees a walk-in's
// states, since his link opens only an online booking. Pure: the booking page's contract and the
// server both read it.

/** How a booking stands, as its guest reads it. */
export const GUEST_BOOKING_STATES = [
  /** Asked for, and the club has not answered yet. */
  'requested',
  /** The club took it. */
  'confirmed',
  /** The party came. */
  'arrived',
  /** Called off, by the guest or by the club. */
  'cancelled',
  /** The club could not take it. */
  'declined',
  /** The night went by without the party. */
  'ended',
] as const

/** One state of a booking as its guest reads it. */
export type GuestBookingState = (typeof GUEST_BOOKING_STATES)[number]

/** A reservation's status as its guest reads it. */
export function guestBookingStateOf(status: string): GuestBookingState {
  switch (status) {
    case 'requested':
      return 'requested'
    case 'reserved':
      return 'confirmed'
    case 'seated':
    case 'finished':
      return 'arrived'
    case 'cancelled':
      return 'cancelled'
    case 'declined':
      return 'declined'
    default:
      return 'ended'
  }
}
