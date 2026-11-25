// Why a booking is made, when the person says (#328; D135: any action may carry a reason, only
// blocking requires one). A **code**, never free text, as a block's reason is (`block-reasons.ts`):
// the reservation row allows a code only, and the screen words it in the next person's language.
//
// The list is the browser's. The form offers them as a segmented pick with none chosen, and the
// reason can be taken away again, because most bookings have none.

/** The reasons the booking form offers, in the order it shows them. */
export const BOOKING_REASONS = ['birthday', 'celebration', 'company', 'other'] as const

/** One booking reason. */
export type BookingReason = (typeof BOOKING_REASONS)[number]

/** True for a reason the list holds, so a stored code we no longer offer is not preselected. */
export function isBookingReason(value: unknown): value is BookingReason {
  return typeof value === 'string' && (BOOKING_REASONS as readonly string[]).includes(value)
}
