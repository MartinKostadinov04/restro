// What Settings › Reservations draws (#325): the venue's reservation rules, one-off closed dates and
// spots with their seats, as plain data safe for the browser. Reads only; the writes are the server
// actions in `reservations-actions.ts`, which the service write path checks again. Part 2's values
// are not read here: no screen shows them (spec #321, decision 9).
import { type ReservationSettingsView, readReservationSettings } from '@restro/core/service'
import type { Venue } from '@restro/db'

import { getPool } from '../db'

/** Everything the section draws. */
export interface ReservationsView {
  readonly venueId: string
  readonly settings: ReservationSettingsView
  /** True when the person holds `settings.reservations`: otherwise the section is read-only. */
  readonly canChange: boolean
  /** The signed-in person's email, for the password again. */
  readonly email: string
}

/** The venue's Reservations view. */
export async function loadReservationsView(input: {
  readonly tenantId: string
  readonly venue: Venue
  readonly canChange: boolean
  readonly email: string
}): Promise<ReservationsView> {
  return {
    venueId: input.venue.id,
    settings: await readReservationSettings(getPool(), input.tenantId, input.venue.id),
    canChange: input.canChange,
    email: input.email,
  }
}
