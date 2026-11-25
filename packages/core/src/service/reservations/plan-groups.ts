// A party's linked group, as the plan draws it (D160 §1, decision log 1.7; ticket #540): the spots
// the party sits on, so the screen can put one outline around them, and the same outline on a
// spot or cluster that stands apart. Pure: the group itself is `linkedGroupsAtTables`'s (#319, a
// party on two tables or more in each table's open sitting); this only says which drawn spots of
// the plan are the party's.
//
// **Only the plan's own spots.** A member table the plan does not draw (another plan of the venue,
// or a spot that is not a table) is simply not outlined. A party left with fewer than two spots on
// this plan has no outline: one spot alone would read as a mark on a table, not as a party.

import type { LinkedGroup } from './linked-group'

/** The least an outline's pad may be, in grid units: the margin the plan's box always kept. */
export const OUTLINE_PAD_MIN = 20

/** A pad is this share of the typical spot's shorter side: a breath, never a second tile. */
const PAD_SHARE = 0.12

/**
 * How far a group's outline stands off the spots it surrounds, in grid units, and so the margin
 * the plan's box keeps around its spots (an outline on the room's edge must not be cut off): a
 * share of the plan's typical (median) shorter spot side, so a plan of small tables and a plan of
 * big sofas both read the same, and never less than the plan's old margin. Pure.
 */
export function outlinePad(
  places: readonly { readonly width: number; readonly height: number }[],
): number {
  if (places.length === 0) return OUTLINE_PAD_MIN
  const sides = places.map((place) => Math.min(place.width, place.height)).sort((a, b) => a - b)
  const median = sides[Math.floor(sides.length / 2)] ?? 0
  return Math.max(OUTLINE_PAD_MIN, Math.round(median * PAD_SHARE))
}

/** The party of a linked group, with the spots of this plan it sits on. */
export interface PlanGroupRead {
  /** The party's reservation (a walk-in included): the key an outline is drawn for. */
  readonly reservationId: string
  /** What to call the party, as the plan's holds name it; null for a walk-in nobody named. */
  readonly name: string | null
  /** Its spots on this plan, in the order the plan lists them. */
  readonly spotIds: readonly string[]
}

/** What the derivation needs of a drawn spot. */
export interface GroupableSpot {
  readonly id: string
  /** The spot's table, where it is one. */
  readonly table: { readonly id: string } | null
  /** The reservations holding it tonight, with the name each carries. */
  readonly holds: readonly { readonly reservationId: string; readonly name: string | null }[]
}

/**
 * The linked groups to outline on a plan, in the order of their first spot. `groups` is
 * `linkedGroupsAtTables`'s answer, by member table id; each group appears once.
 */
export function planGroupsOf(
  groups: ReadonlyMap<string, LinkedGroup>,
  spots: readonly GroupableSpot[],
): PlanGroupRead[] {
  const unique = new Map<string, LinkedGroup>()
  for (const group of groups.values()) unique.set(group.reservationId, group)
  const out: PlanGroupRead[] = []
  for (const group of unique.values()) {
    const members = new Set(group.tables.map((table) => table.tableId))
    const own = spots.filter(
      (spot) =>
        spot.table !== null &&
        members.has(spot.table.id) &&
        spot.holds.some((hold) => hold.reservationId === group.reservationId),
    )
    if (own.length < 2) continue
    const named = own
      .flatMap((spot) => spot.holds)
      .find((hold) => hold.reservationId === group.reservationId)
    out.push({
      reservationId: group.reservationId,
      name: named?.name ?? null,
      spotIds: own.map((spot) => spot.id),
    })
  }
  // The plan's own order, so a re-read never reshuffles the outlines.
  const first = new Map<string, number>()
  for (const [index, spot] of spots.entries()) first.set(spot.id, index)
  out.sort(
    (a, b) =>
      (first.get(a.spotIds[0] ?? '') ?? 0) - (first.get(b.spotIds[0] ?? '') ?? 0) ||
      (a.reservationId < b.reservationId ? -1 : a.reservationId > b.reservationId ? 1 : 0),
  )
  return out
}
