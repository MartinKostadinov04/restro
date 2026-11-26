// What Settings › Reservations draws (#325, #397): the venue's reservation rules, one-off closed dates
// and its floor plan as the editor changes it (plans, spots with their numbers, spot kinds, the
// Tables a spot may name) and the online booking switch with its page's address (#577) and embed code (#581), as plain
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
import { defaultQrBaseUrl } from '../env'

/** Everything the section draws. */
export interface ReservationsView {
  readonly venueId: string
  readonly settings: ReservationSettingsView
  /**
   * The venue's booking page (#577): `<guest pages' origin>/book/<organisation>/<venue>`, the
   * address a web designer links or frames (#581); the path alone when no origin is configured;
   * null when the organisation has no address yet.
   */
  readonly bookingAddress: string | null
  /** The floor plan as the editor draws it (#397). */
  readonly plan: PlanEditorRead
  /** True when the person holds `settings.reservations`: otherwise the section is read-only. */
  readonly canChange: boolean
  /** The signed-in person's email, for the password again. */
  readonly email: string
}

/** The origin of an address, or '' when there is none or it is not one. */
function originOf(base: string | null): string {
  if (base === null) return ''
  try {
    const url = new URL(base)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : ''
  } catch {
    return ''
  }
}

/**
 * The booking page's address, or null when the names cannot make one. Its origin is the guest
 * pages' (`PUBLIC_BASE_URL`, else `BETTER_AUTH_URL`: the guest link in an email uses the same).
 */
export function bookingAddressOf(
  organization: string | null,
  venue: string,
  base: string | null,
): string | null {
  if (organization === null) return null
  try {
    return `${originOf(base)}${guestBookingPath({ organization, venue })}`
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
    bookingAddress: bookingAddressOf(
      organization?.slug ?? null,
      input.venue.slug,
      defaultQrBaseUrl(),
    ),
    plan,
    canChange: input.canChange,
    email: input.email,
  }
}
