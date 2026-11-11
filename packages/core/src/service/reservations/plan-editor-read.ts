// What the plan editor in Settings › Reservations draws (#397; D134, D141): the venue's plans, the
// spots of each with their stored geometry, the venue's own spot kinds with how many spots use
// each, the venue's Tables a spot may be linked to, and how many bookings still to come hold each
// spot — so removing one can say what it costs before it happens.
//
// Read-only, on `withTenant`, as `settings-read.ts` is: every write is a command through
// `applyService` (`plan.save`, `spot.save`, `spot.remove`, `spot_kind.save`, `spot_kind.remove`).
// The page decides whether the person may change anything (`settings.reservations`); this read
// only hands out what the settings screen already shows, plus each spot's numbers.
//
// The geometry is checked here, not trusted, exactly as the night's plan does (`plan-read.ts`):
// every row goes through the shape folder, and a row it refuses is counted, never drawn.

import {
  areas,
  type DbPool,
  floorPlans,
  reservationSpots,
  reservations,
  spots,
  venueSpotKinds,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, asc, count, eq, gte, inArray, isNull, ne } from 'drizzle-orm'

import { checkSpotPlace, type SpotPlace, type SpotSymbol, spotSymbolOf } from '../../spot-shapes'
import { HOLDING_STATUSES } from './status'

/** One of the venue's plans. */
export interface EditorPlan {
  readonly id: string
  readonly name: string
  /** The plan tonight's screens draw unless another is asked for. */
  readonly current: boolean
}

/** One spot as the editor draws and changes it. */
export interface EditorSpot {
  readonly id: string
  readonly planId: string
  readonly name: string
  readonly kind: string
  readonly place: SpotPlace
  /** Its own seats; null when it takes its kind's. */
  readonly seats: number | null
  /** The Table orders at this spot go onto, by our own id (rule 3); null when none. */
  readonly tableId: string | null
  /** Bookings from today on that still hold this spot: what removing it would leave without one. */
  readonly bookings: number
}

/** One of the venue's own spot kinds. */
export interface EditorKind {
  readonly key: string
  readonly label: string
  readonly symbol: SpotSymbol
  readonly defaultSeats: number | null
  readonly sortKey: string
  /** Spots on the floor of this kind: a kind in use cannot be removed (`spot_kind_in_use`). */
  readonly spots: number
}

/** One of the venue's Tables, for linking a spot to it. */
export interface EditorTable {
  readonly id: string
  /** Our name for it, else the till's number. */
  readonly label: string
  /** The label is a number, so a screen says "Table 7" rather than a bare 7. */
  readonly numbered: boolean
}

/** Everything the editor needs. */
export interface PlanEditorRead {
  readonly plans: readonly EditorPlan[]
  readonly spots: readonly EditorSpot[]
  readonly kinds: readonly EditorKind[]
  readonly tables: readonly EditorTable[]
  /** Spots the shape folder refused: drawn nowhere, counted so they are not simply missing. */
  readonly unreadable: number
}

/** Names the way staff count them: "2" before "10", "Bar 3" before "Bar 12". */
const BY_NAME = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** The editor's read of one venue. `today` is the venue's current service day (`YYYY-MM-DD`). */
export async function readPlanEditor(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  today: string,
): Promise<PlanEditorRead> {
  return withTenant(pool, tenantId, async (tx) => {
    const planRows = await tx
      .select({ id: floorPlans.id, name: floorPlans.name, current: floorPlans.isCurrent })
      .from(floorPlans)
      .where(and(eq(floorPlans.venueId, venueId), isNull(floorPlans.removedAt)))
      .orderBy(asc(floorPlans.createdAt), asc(floorPlans.id))
    // The current plan first, then the others in the order they were made.
    const plans = [...planRows.filter((p) => p.current), ...planRows.filter((p) => !p.current)]

    const kindRows = await tx
      .select({
        key: venueSpotKinds.key,
        label: venueSpotKinds.label,
        symbol: venueSpotKinds.symbol,
        defaultSeats: venueSpotKinds.defaultSeats,
        sortKey: venueSpotKinds.sortKey,
      })
      .from(venueSpotKinds)
      .where(and(eq(venueSpotKinds.venueId, venueId), isNull(venueSpotKinds.removedAt)))

    const spotRows = await tx
      .select({
        id: spots.id,
        planId: spots.planId,
        name: spots.name,
        kind: spots.kind,
        shape: spots.shape,
        x: spots.x,
        y: spots.y,
        width: spots.width,
        height: spots.height,
        rotation: spots.rotation,
        seats: spots.seats,
        tableId: spots.tableId,
      })
      .from(spots)
      .innerJoin(floorPlans, eq(floorPlans.id, spots.planId))
      .where(and(eq(spots.venueId, venueId), isNull(spots.removedAt), isNull(floorPlans.removedAt)))

    const ids = spotRows.map((row) => row.id)
    const held =
      ids.length === 0
        ? []
        : await tx
            .select({ spotId: reservationSpots.spotId, n: count() })
            .from(reservationSpots)
            .innerJoin(reservations, eq(reservations.id, reservationSpots.reservationId))
            .where(
              and(
                inArray(reservationSpots.spotId, ids),
                isNull(reservationSpots.releasedAt),
                isNull(reservations.deletedAt),
                ne(reservations.kind, 'block'),
                inArray(reservations.status, [...HOLDING_STATUSES]),
                gte(reservations.serviceDate, today),
              ),
            )
            .groupBy(reservationSpots.spotId)
    const bookings = new Map(held.map((row) => [row.spotId, Number(row.n)]))

    const tableRows = await tx
      .select({ id: venueTables.id, name: venueTables.name, number: venueTables.number })
      .from(venueTables)
      .innerJoin(areas, eq(areas.id, venueTables.areaId))
      .where(
        and(
          eq(venueTables.venueId, venueId),
          isNull(venueTables.archivedAt),
          isNull(areas.archivedAt),
          eq(venueTables.isPaymentTable, false),
        ),
      )

    let unreadable = 0
    const drawn: EditorSpot[] = []
    for (const row of spotRows) {
      const checked = checkSpotPlace({
        shape: row.shape,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        rotation: row.rotation,
      })
      if (!checked.ok) {
        unreadable += 1
        continue
      }
      drawn.push({
        id: row.id,
        planId: row.planId,
        name: row.name,
        kind: row.kind,
        place: checked.place,
        seats: row.seats,
        tableId: row.tableId,
        bookings: bookings.get(row.id) ?? 0,
      })
    }
    drawn.sort((a, b) => BY_NAME.compare(a.name, b.name) || a.id.localeCompare(b.id))

    const inUse = new Map<string, number>()
    for (const spot of drawn) inUse.set(spot.kind, (inUse.get(spot.kind) ?? 0) + 1)
    const kinds = kindRows
      .map(
        (row): EditorKind => ({
          key: row.key,
          label: row.label,
          symbol: spotSymbolOf(row.symbol),
          defaultSeats: row.defaultSeats,
          sortKey: row.sortKey,
          spots: inUse.get(row.key) ?? 0,
        }),
      )
      .sort(
        (a, b) =>
          (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0) ||
          BY_NAME.compare(a.label, b.label),
      )

    const tables = tableRows
      .flatMap((row): EditorTable[] => {
        const label = row.name ?? row.number
        if (label === null) return []
        return [{ id: row.id, label, numbered: row.name === null }]
      })
      .sort((a, b) => BY_NAME.compare(a.label, b.label) || a.id.localeCompare(b.id))

    return { plans, spots: drawn, kinds, tables, unreadable }
  })
}
