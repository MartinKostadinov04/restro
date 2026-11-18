// Who is sitting at an open table, for the one screen that draws every table (Tonight; walk P20,
// #419; D122 §7, D141). The waiter reading a table's sheet sees whose party it is, as the hostess
// does on the plan: the two screens are about the same table on the same night.
//
// **Read-only, and only what the sheet says.** A party is a name and a number of guests — what the
// night's list already shows, never a phone number or a guest's record (D140). A party nobody
// named is a walk-in with no name: it comes back with `name: null`, and the screen words that.
//
// **The sitting is the boundary, exactly as the pay rule's is** (`payRulesAtTables`, #334): a party
// counts at a table only when it took its spot at or after the table's sitting opened
// (`reservationSpots.updatedAt >= sittings.openedAt`, both the database's own clock), so guests who
// left a sitting that "New guests" ended are not named at the next one.
//
// **Who may read it is the caller's** — this module answers for the whole floor and checks no
// permission. Tonight asks for it only where the actor holds `reservations.tonight`, the key that
// "works tonight's reservations" (permissions.ts): a role without it sees no name, only the table.

import type { ReadTx } from '@restro/db'
import { guests, reservationSpots, reservations, sittings, spots } from '@restro/db'
import { and, asc, eq, gte, isNull, ne } from 'drizzle-orm'

/** One party seated at a table. */
export interface SeatedParty {
  readonly reservationId: string
  /** The name on the book, or the guest's; null for a walk-in nobody named. */
  readonly name: string | null
  readonly partySize: number | null
}

/**
 * The parties seated at each open table of a venue, by table id, earliest seated first. A table
 * with nobody seated — closed, or opened for guests who walked up and were never put on the book —
 * is simply absent from the map. A party on two spots of one table is listed once.
 */
export async function seatedPartiesAtTables(
  tx: Pick<ReadTx, 'select'>,
  input: { readonly venueId: string },
): Promise<Map<string, SeatedParty[]>> {
  const rows = await tx
    .select({
      tableId: sittings.tableId,
      reservationId: reservations.id,
      partyLabel: reservations.partyLabel,
      guestName: guests.name,
      partySize: reservations.partySize,
    })
    .from(sittings)
    .innerJoin(spots, and(eq(spots.venueId, input.venueId), eq(spots.tableId, sittings.tableId)))
    .innerJoin(
      reservationSpots,
      and(
        eq(reservationSpots.tenantId, spots.tenantId),
        eq(reservationSpots.spotId, spots.id),
        isNull(reservationSpots.releasedAt),
        // The sitting boundary, exactly as `payRuleInForce` states it.
        gte(reservationSpots.updatedAt, sittings.openedAt),
      ),
    )
    .innerJoin(
      reservations,
      and(
        eq(reservations.tenantId, reservationSpots.tenantId),
        eq(reservations.id, reservationSpots.reservationId),
        eq(reservations.status, 'seated'),
        // A block is a reservation too (D137), but nobody sits in it.
        ne(reservations.kind, 'block'),
        isNull(reservations.deletedAt),
      ),
    )
    .leftJoin(guests, eq(guests.id, reservations.guestId))
    .where(and(eq(sittings.venueId, input.venueId), isNull(sittings.endedAt)))
    .orderBy(asc(reservations.seatedAt), asc(reservations.id))
  const byTable = new Map<string, SeatedParty[]>()
  for (const row of rows) {
    const list = byTable.get(row.tableId) ?? []
    if (list.some((party) => party.reservationId === row.reservationId)) continue
    list.push({
      reservationId: row.reservationId,
      name: row.partyLabel ?? row.guestName,
      partySize: row.partySize,
    })
    byTable.set(row.tableId, list)
  }
  return byTable
}
