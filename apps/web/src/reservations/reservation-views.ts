// The views of Venue › Reservations (#326), apart from the tab bar so the server can name them
// too: a 'use client' module cannot be called from a server component.
//
// The night's list is the first; the floor plan (#327) is the second. Guests (#333) adds its name
// here, an entry to `TABS` in `reservations-tabs.tsx` and a branch in `reservations-tab.tsx`; the
// bar hides itself while there is only one view, so nothing else moves.

/** Every view of Reservations, in the order of the tab bar; the first is where it opens. */
export const RESERVATION_VIEW_NAMES = ['list', 'plan'] as const

/** One view of Reservations. */
export type ReservationViewName = (typeof RESERVATION_VIEW_NAMES)[number]

export function isReservationView(value: unknown): value is ReservationViewName {
  return typeof value === 'string' && (RESERVATION_VIEW_NAMES as readonly string[]).includes(value)
}
