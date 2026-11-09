// What Settings › Reservations draws (ticket #325): the venue's reservation rules and its spots with
// their seats, read as plain data. Read-only, on `withTenant`; every write is a command through
// `applyService`. Part 2's values (`online`) are deliberately not here: no screen shows them, so
// no read hands them out (spec #321, Implementation Decisions 9).

import {
  type DbPool,
  reservationSettings,
  spots,
  venueSpotKinds,
  withTenant,
} from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'

import { closedDatesOf } from './closed-dates'

/** One spot as the settings list shows it. */
export interface SettingsSpot {
  readonly id: string
  readonly name: string
  /** The words staff see for the spot's kind; the code when the kind has been removed. */
  readonly kindLabel: string
  /** The spot's own seats, or null when it takes its kind's. */
  readonly seats: number | null
  /** What the kind seats unless the spot says otherwise; null when the kind names no number. */
  readonly kindSeats: number | null
}

/** The venue's reservation rules and spots. */
export interface ReservationSettingsView {
  /** False until an owner sets the turn time: nothing else on the row can be written before. */
  readonly saved: boolean
  /** How long a spot is held, in minutes; null until the venue sets it (D135: no invented default). */
  readonly turnMinutes: number | null
  readonly phoneRequired: boolean
  readonly editPastNights: boolean
  readonly privateNotesOn: boolean
  /** One-off closed service days, newest first. */
  readonly closedDates: readonly string[]
  /** The venue's spots still on a plan, by name. */
  readonly spots: readonly SettingsSpot[]
}

/** What a venue with no row yet means: D135's defaults, and no turn time. */
const NOT_SAVED = {
  saved: false,
  turnMinutes: null,
  phoneRequired: true,
  editPastNights: false,
  privateNotesOn: true,
  closedDates: [],
} as const

/** Names the way staff count them: "2" before "10", "Bar 3" before "Bar 12". */
const BY_NAME = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** The venue's reservation settings and spots. */
export async function readReservationSettings(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<ReservationSettingsView> {
  return withTenant(pool, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(reservationSettings)
      .where(eq(reservationSettings.venueId, venueId))
    const spotRows = await tx
      .select({
        id: spots.id,
        name: spots.name,
        kind: spots.kind,
        seats: spots.seats,
        kindLabel: venueSpotKinds.label,
        kindSeats: venueSpotKinds.defaultSeats,
      })
      .from(spots)
      .leftJoin(
        venueSpotKinds,
        and(
          eq(venueSpotKinds.tenantId, spots.tenantId),
          eq(venueSpotKinds.venueId, spots.venueId),
          eq(venueSpotKinds.key, spots.kind),
        ),
      )
      .where(and(eq(spots.venueId, venueId), isNull(spots.removedAt)))
    const list = spotRows
      .map(
        (spot): SettingsSpot => ({
          id: spot.id,
          name: spot.name,
          kindLabel: spot.kindLabel ?? spot.kind,
          seats: spot.seats,
          kindSeats: spot.kindSeats,
        }),
      )
      .sort((a, b) => BY_NAME.compare(a.name, b.name) || a.id.localeCompare(b.id))
    if (row === undefined) return { ...NOT_SAVED, spots: list }
    return {
      saved: true,
      turnMinutes: row.turnMinutes,
      phoneRequired: row.phoneRequired,
      editPastNights: row.editPastNights,
      privateNotesOn: row.privateNotesOn,
      closedDates: closedDatesOf(row.closedDates).reverse(),
      spots: list,
    }
  })
}
