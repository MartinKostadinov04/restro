// What the booking page offers beyond the night (#580; spec #322 stories 4, 5 and 27; D136): the
// venue's Areas a guest may ask for, its floor plans a guest may pick his own spot on, and whether
// each spot is free on one night.
//
// **An Area is not a floor plan.** A plan is a drawing of one floor with its spots, and one floor
// may hold several Areas. A spot belongs to an Area through the Table its orders go to (a spot
// links to a table, a table belongs to an Area), so a spot with no Table belongs to no Area and is
// booked only by picking it. The Areas offered are the visible ones that hold at least one spot
// of a plan still drawn; the hostess places a party that asked for one.
//
// **A hidden Area hides its spots** (D95: hiding an Area hides its tables from guests). A spot
// whose Table is hidden, or sits in a hidden Area, is left out of the file, and so refused at the
// write too (`guestPickOf` checks a pick against this very read: `spot_missing`). A spot with no
// Table belongs to no Area and stays bookable.
//
// **Public by design.** What is read here goes into the published booking file (rule 3): a plan's
// prefixed id, name and drawing, an Area's prefixed id and name, a spot's prefixed id, name, its
// kind's symbol, its seats and its Area. Never a table id, a Table's name or code, a kind's own
// label or a POS key — the Table is only how a spot reaches its Area, and stays here.
//
// **Free or taken, and nothing else** (story 32). A spot is free on a night when a booking from
// the night's opening for the venue's turn time would not overlap anything holding it: the very
// rule the write applies (`spotConflict` over `heldSpotsOn`), read without a lock. So a blocked
// spot reads taken, as does one an online request is waiting on. The write still has the last
// word: two guests who both saw a spot free race for it at the write, and one is refused.
//
// Read-only on any transaction (`ReadTx`); nothing here writes.

import { areas, floorPlans, type ReadTx, spots, venueSpotKinds, venueTables } from '@restro/db'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'

import { BOOKING_SPOTS_PICKED_MAX } from '../../guest-files'
import type { Id } from '../../ids'
import { checkSpotPlace, type SpotPlace, type SpotSymbol, spotSymbolOf } from '../../spot-shapes'
import { isSpotConflict, spotConflict } from './overlap'
import { compareSpots } from './plan-state'
import { heldSpotsOn } from './rows'

export { BOOKING_SPOTS_PICKED_MAX }

/** The most plans one booking file carries. */
export const BOOKING_PLANS_MAX = 20

/** The most spots one plan of the booking file carries. */
export const BOOKING_PLAN_SPOTS_MAX = 400

/** An Area a guest may ask for. */
export interface BookingAreaRead {
  readonly id: string
  readonly name: string
}

/** A spot as the booking page draws it. */
export interface BookingSpotRead {
  readonly id: string
  readonly name: string
  readonly symbol: SpotSymbol
  /** Its own seats, else its kind's; null when neither says. */
  readonly seats: number | null
  /** The offered Area its Table belongs to; null for a spot with no Table, or one of no offer. */
  readonly area: string | null
  readonly place: SpotPlace
}

/** One floor plan as the booking page draws it. */
export interface BookingPlanRead {
  readonly id: string
  readonly name: string
  readonly spots: readonly BookingSpotRead[]
}

/** What the booking page offers beyond the night. */
export interface BookingPlanOffer {
  readonly areas: readonly BookingAreaRead[]
  readonly plans: readonly BookingPlanRead[]
}

/**
 * The venue's offered Areas and its plans with their spots: plans still drawn, the current one
 * first, then by name; spots by name; a spot whose drawing the shape folder refuses is left off
 * (as the staff plan leaves it off), so the page is never handed numbers nobody checked.
 */
export async function bookingPlanOf(tx: ReadTx, venueId: string): Promise<BookingPlanOffer> {
  const plans = await tx
    .select({ id: floorPlans.id, name: floorPlans.name })
    .from(floorPlans)
    .where(and(eq(floorPlans.venueId, venueId), isNull(floorPlans.removedAt)))
    .orderBy(desc(floorPlans.isCurrent), asc(floorPlans.name), asc(floorPlans.id))
    .limit(BOOKING_PLANS_MAX)
  if (plans.length === 0) return { areas: [], plans: [] }
  const rows = await tx
    .select({
      id: spots.id,
      planId: spots.planId,
      name: spots.name,
      shape: spots.shape,
      x: spots.x,
      y: spots.y,
      width: spots.width,
      height: spots.height,
      rotation: spots.rotation,
      seats: spots.seats,
      kindSymbol: venueSpotKinds.symbol,
      kindSeats: venueSpotKinds.defaultSeats,
      tableHidden: venueTables.hidden,
      areaId: areas.id,
      areaName: areas.name,
      areaSortKey: areas.sortKey,
      areaHidden: areas.hidden,
    })
    .from(spots)
    .leftJoin(
      venueSpotKinds,
      and(
        eq(venueSpotKinds.tenantId, spots.tenantId),
        eq(venueSpotKinds.venueId, spots.venueId),
        eq(venueSpotKinds.key, spots.kind),
        isNull(venueSpotKinds.removedAt),
      ),
    )
    .leftJoin(
      venueTables,
      and(
        eq(venueTables.tenantId, spots.tenantId),
        eq(venueTables.id, spots.tableId),
        eq(venueTables.venueId, spots.venueId),
        isNull(venueTables.archivedAt),
      ),
    )
    .leftJoin(
      areas,
      and(
        eq(areas.tenantId, venueTables.tenantId),
        eq(areas.id, venueTables.areaId),
        isNull(areas.archivedAt),
      ),
    )
    .where(
      and(
        eq(spots.venueId, venueId),
        inArray(
          spots.planId,
          plans.map((plan) => plan.id),
        ),
        isNull(spots.removedAt),
      ),
    )

  const offered = new Map<string, { name: string; sortKey: string }>()
  const byPlan = new Map<string, BookingSpotRead[]>()
  for (const row of rows) {
    const checked = checkSpotPlace({
      shape: row.shape,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
    })
    if (!checked.ok) continue
    // Hidden from guests with its Table or its Area (D95).
    if (row.tableHidden === true || row.areaHidden === true) continue
    if (row.areaId !== null && row.areaName !== null && row.areaSortKey !== null) {
      offered.set(row.areaId, { name: row.areaName, sortKey: row.areaSortKey })
    }
    const list = byPlan.get(row.planId) ?? []
    list.push({
      id: row.id,
      name: row.name,
      symbol: spotSymbolOf(row.kindSymbol),
      seats: row.seats ?? row.kindSeats ?? null,
      area: row.areaId,
      place: checked.place,
    })
    byPlan.set(row.planId, list)
  }
  return {
    areas: [...offered.entries()]
      .sort(([aId, a], [bId, b]) =>
        a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : aId < bId ? -1 : 1,
      )
      .map(([id, area]) => ({ id, name: area.name })),
    plans: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      spots: (byPlan.get(plan.id) ?? []).sort(compareSpots).slice(0, BOOKING_PLAN_SPOTS_MAX),
    })),
  }
}

/** Whether one spot can be booked on the night asked about. */
export type BookingSpotState = 'free' | 'taken'

/**
 * Free or taken, per spot of the venue's plans, for a booking that starts at `opensAt` and runs
 * the venue's turn time: the claim the guest's own request makes (`requestReservation`).
 */
export async function bookingSpotStates(
  tx: ReadTx,
  venue: { readonly id: string; readonly timezone: string; readonly serviceDayEndsAt: string },
  night: { readonly serviceDate: string; readonly opensAt: Date; readonly turnMinutes: number },
  spotIds: readonly string[],
): Promise<Record<string, BookingSpotState>> {
  const held = await heldSpotsOn(tx, venue, night.serviceDate, night.turnMinutes)
  const states: Record<string, BookingSpotState> = {}
  for (const spotId of spotIds) {
    const clash = spotConflict(
      {
        // Nobody's: the page's look at the night is no reservation, so every hold is in the way.
        reservationId: 'rv_0' as Id<'rv'>,
        spotIds: [spotId as Id<'sp'>],
        startsAt: night.opensAt,
        endsAt: null,
        turnMinutes: null,
      },
      held,
      night.turnMinutes,
    )
    states[spotId] = isSpotConflict(clash) || clash !== null ? 'taken' : 'free'
  }
  return states
}
