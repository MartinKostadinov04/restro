// What Settings › Reservations draws (#325, #397): the venue's reservation rules, one-off closed dates
// and its floor plan as the editor changes it (plans, spots with their numbers, spot kinds, the
// Tables a spot may name) and the online booking switch with its page's address (#577), as plain
// data safe for the browser. Reads only; the writes are the server
// actions in `reservations-actions.ts`, which the service write path checks again. Part 2's values
// are not read here: no screen shows them (spec #321, decision 9).
import { guestBookingPath, serviceDate } from '@restro/core'
import { organizationAddress } from '@restro/core/apply'
import {
  type PlanEditorRead,
  type ReservationSettingsView,
  readPlanEditor,
  readReservationSettings,
} from '@restro/core/service'
import type { Venue } from '@restro/db'

import { getPool } from '../db'

/** Everything the section draws. */
export interface ReservationsView {
  readonly venueId: string
  readonly settings: ReservationSettingsView
  /**
   * The venue's booking page (#577), `/book/<organisation>/<venue>`; null when the organisation has
   * no address yet.
   */
  readonly bookingPath: string | null
  /** The floor plan as the editor draws it (#397). */
  readonly plan: PlanEditorRead
  /** True when the person holds `settings.reservations`: otherwise the section is read-only. */
  readonly canChange: boolean
  /** The signed-in person's email, for the password again. */
  readonly email: string
}

/** The booking page's path, or null when the names cannot make one. */
function bookingPathOf(organization: string | null, venue: string): string | null {
  if (organization === null) return null
  try {
    return guestBookingPath({ organization, venue })
  } catch {
    return null
  }
}

/** The venue's Reservations view. */
export async function loadReservationsView(input: {
  readonly tenantId: string
  readonly venue: Venue
  readonly canChange: boolean
  readonly email: string
}): Promise<ReservationsView> {
  const today = serviceDate(new Date(), input.venue.timezone, input.venue.serviceDayEndsAt)
  const [settings, plan, organization] = await Promise.all([
    readReservationSettings(getPool(), input.tenantId, input.venue.id),
    readPlanEditor(getPool(), input.tenantId, input.venue.id, today),
    organizationAddress(getPool(), input.tenantId),
  ])
  return {
    venueId: input.venue.id,
    settings,
    bookingPath: bookingPathOf(organization?.slug ?? null, input.venue.slug),
    plan,
    canChange: input.canChange,
    email: input.email,
  }
}
