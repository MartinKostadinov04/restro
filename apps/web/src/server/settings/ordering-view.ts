// What the Hours and Ordering sections draw (#87, plan `2026-10-27-settings-hours-ordering-plan.md`):
// the venue's saved ordering settings (the defaults where none are saved) and, for the venue's spot,
// when it was last set: the Log's `settings.changed` entry that names it (nothing else keeps the
// time, and no table is added). Reads only; plain data safe for the browser.
import { type OrderingSettings, readOrderingSettings } from '@restro/core'
import { logEntries, type Venue, withTenant } from '@restro/db'
import { and, desc, eq, sql } from 'drizzle-orm'

import { getPool } from '../db'

/** Everything the two sections draw. */
export interface OrderingView {
  readonly venueId: string
  readonly settings: OrderingSettings
  /** When the venue's service day ends, `HH:MM`. */
  readonly dayEndsAt: string
  /** The venue's time zone: the spot's date reads in it. */
  readonly timezone: string
  /** The venue's currency, for the cap. */
  readonly currency: string
  /** True when the person holds `settings.guards`: otherwise the values are read-only. */
  readonly canChange: boolean
  /** True for a venue with a POS: only then is there a connection to check before opening. */
  readonly hasPos: boolean
  /** When the spot was last set (ISO), or null. */
  readonly spotSetAt: string | null
  /** The signed-in person's email, for the password again. */
  readonly email: string
}

/** The time of the Log entry that last changed the spot, or null. */
async function spotSetAt(tenantId: string, venueId: string): Promise<Date | null> {
  const [row] = await withTenant(getPool(), tenantId, (tx) =>
    tx
      .select({ at: logEntries.at })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.venueId, venueId),
          eq(logEntries.kind, 'settings.changed'),
          sql`${logEntries.details} ->> 'keys' ~ '(^|,)spot(,|$)'`,
        ),
      )
      .orderBy(desc(logEntries.at))
      .limit(1),
  )
  return row?.at ?? null
}

/** The sections' view of a venue for a person who does or doesn't hold `settings.guards`. */
export async function loadOrderingView(input: {
  readonly tenantId: string
  readonly venue: Venue
  readonly hasPos: boolean
  readonly canChange: boolean
  readonly email: string
}): Promise<OrderingView> {
  const settings = readOrderingSettings(input.venue.settings)
  const at = settings.spot === null ? null : await spotSetAt(input.tenantId, input.venue.id)
  return {
    venueId: input.venue.id,
    settings,
    dayEndsAt: input.venue.serviceDayEndsAt.slice(0, 5),
    timezone: input.venue.timezone,
    currency: input.venue.currency,
    canChange: input.canChange,
    hasPos: input.hasPos,
    spotSetAt: at === null ? null : at.toISOString(),
    email: input.email,
  }
}
