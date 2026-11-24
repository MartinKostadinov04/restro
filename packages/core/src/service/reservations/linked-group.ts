// A table's linked group (D160 §1, D139; ticket #319): the party sitting at the table, booked or
// walk-in, and every table its spots hold in this sitting. There is no group row to make or keep
// in step: seating a party on several tables makes the group, and "Change tables" edits it,
// because both write the party's spots (`reservation_spots`) and open or close the tables' codes.
// No migration and no POS call: the group is ours, and the POS keeps seeing separate tables
// (D110, rule 7).
//
// **A party holds a table in this sitting** exactly as the pay rule and Tonight's seated parties
// say it (`payRulesAtTables`, `seatedPartiesAtTables`): the party is `seated`, is not a block and
// is not deleted, holds an unreleased spot of the table, and took that spot at or after the
// table's open sitting began (`reservation_spots.updated_at >= sittings.opened_at`, both the
// database's own clock). A table with no open sitting holds nobody: its code is closed, and its
// bill is no sitting's (D122 §4).
//
// **A group is two tables or more.** A party on one table, or a table nobody is seated at, is no
// group, and its bill reads as today.
//
// **A table two parties hold is in no group** (the cautious reading of D139, open question on
// #319). It can only happen where the hostess answered "same guests" over a table two bookings
// are seated at (`pay-rule.ts`). Each party's consent to share its bill is the hostess's act of
// grouping *that* party (D139 12.28); joining two parties through a shared table would show one
// party's other tables to the other. So the shared table reads alone, and each party's group is
// its other tables, which only ever shows a phone less than the POS holds (rule 5's direction).
//
// **A member table that did not read** (rule 6, decision log 1.8): `linkedGroupReadings` says, per
// member, whether its bill was read well in this sitting. A failed reading concludes nothing: the
// group shows that table's last lines marked as updating, and its total is not final. Paying is
// unchanged by this ticket (each table pays its own); the payment tickets read the same state.
//
// Read-only. Who may read a group is the caller's: the guest API asks for its own table only.

import type { ReadTx } from '@restro/db'
import { billReadings, reservationSpots, reservations, sittings, spots } from '@restro/db'
import { and, eq, gte, inArray, isNull, ne } from 'drizzle-orm'

/** The read side of a transaction: the reads here never write. */
type Readable = Pick<ReadTx, 'select'>

/** One party holding one table in that table's open sitting. */
export interface PartyHold {
  readonly tableId: string
  readonly sittingId: string
  readonly reservationId: string
}

/** One member table of a linked group: the table and its open sitting. */
export interface LinkedTable {
  readonly tableId: string
  readonly sittingId: string
}

/** A party sitting on two tables or more, in this sitting of each. */
export interface LinkedGroup {
  /** The party: a reservation, walk-ins included (D160 §1). Backend; never sent to a phone. */
  readonly reservationId: string
  /** Its tables, two or more, by table id (callers order them for people). */
  readonly tables: readonly LinkedTable[]
}

/** Orders two ids by their code units, the same on every machine (no collation). */
export const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The linked groups the holds make, by member table id. Pure. A table two parties hold is in no
 * group, and drops out of each party's; a party left with one table, or none, is no group.
 */
export function linkedGroupsOf(holds: readonly PartyHold[]): Map<string, LinkedGroup> {
  const partiesAt = new Map<string, Set<string>>()
  const tablesOf = new Map<string, Map<string, string>>()
  for (const hold of holds) {
    const parties = partiesAt.get(hold.tableId) ?? new Set<string>()
    parties.add(hold.reservationId)
    partiesAt.set(hold.tableId, parties)
    const tables = tablesOf.get(hold.reservationId) ?? new Map<string, string>()
    tables.set(hold.tableId, hold.sittingId)
    tablesOf.set(hold.reservationId, tables)
  }
  const groups = new Map<string, LinkedGroup>()
  for (const [reservationId, tables] of tablesOf) {
    const members = [...tables]
      .filter(([tableId]) => partiesAt.get(tableId)?.size === 1)
      .sort(([a], [b]) => byCodeUnits(a, b))
      .map(([tableId, sittingId]) => ({ tableId, sittingId }))
    if (members.length < 2) continue
    const group: LinkedGroup = { reservationId, tables: members }
    for (const member of members) groups.set(member.tableId, group)
  }
  return groups
}

/**
 * The parties holding the given tables, or every table of the venue, in each table's open
 * sitting (the boundary in this module's header). A party on two spots of one table holds it once.
 */
async function holdsAt(
  tx: Readable,
  where: { readonly venueId: string } | { readonly tableIds: readonly string[] },
): Promise<PartyHold[]> {
  if ('tableIds' in where && where.tableIds.length === 0) return []
  const rows = await tx
    .select({
      tableId: sittings.tableId,
      sittingId: sittings.id,
      reservationId: reservations.id,
    })
    .from(sittings)
    .innerJoin(
      spots,
      and(
        eq(spots.tenantId, sittings.tenantId),
        eq(spots.venueId, sittings.venueId),
        eq(spots.tableId, sittings.tableId),
      ),
    )
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
    .where(
      and(
        isNull(sittings.endedAt),
        'venueId' in where
          ? eq(sittings.venueId, where.venueId)
          : inArray(sittings.tableId, [...where.tableIds]),
      ),
    )
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.tableId}|${row.reservationId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The spots' tables a party holds now, whatever their sittings: where its group may reach. */
async function tablesHeldBy(tx: Readable, reservationId: string): Promise<string[]> {
  const rows = await tx
    .select({ tableId: spots.tableId })
    .from(reservationSpots)
    .innerJoin(
      spots,
      and(eq(spots.tenantId, reservationSpots.tenantId), eq(spots.id, reservationSpots.spotId)),
    )
    .where(
      and(eq(reservationSpots.reservationId, reservationId), isNull(reservationSpots.releasedAt)),
    )
  return [...new Set(rows.flatMap((row) => (row.tableId === null ? [] : [row.tableId])))]
}

/**
 * The linked group of every table of the venue that is in one, by table id: what Tonight draws
 * (one outline per group, D160 §1) and its table sheets name.
 */
export async function linkedGroupsAtTables(
  tx: Readable,
  input: { readonly venueId: string },
): Promise<Map<string, LinkedGroup>> {
  return linkedGroupsOf(await holdsAt(tx, { venueId: input.venueId }))
}

/**
 * The table's linked group, or null where it is in none: no party holds it in this sitting, the
 * party sits on this table alone, or two parties hold it. A few indexed reads: the guest API asks
 * it on every poll of a phone.
 */
export async function linkedGroupOfTable(
  tx: Readable,
  input: { readonly tableId: string },
): Promise<LinkedGroup | null> {
  const here = await holdsAt(tx, { tableIds: [input.tableId] })
  const [party, other] = here
  if (party === undefined || other !== undefined) return null
  const reach = await tablesHeldBy(tx, party.reservationId)
  if (reach.length < 2) return null
  // Every party at the tables this one reaches, so a table it shares with another party drops out.
  return linkedGroupsOf(await holdsAt(tx, { tableIds: reach })).get(input.tableId) ?? null
}

/**
 * How a member table's bill was last read in its sitting: `complete` when the latest reading was
 * whole, `failed` when it was not (the last good lines, if any, stay shown as updating), `none`
 * when nothing was read since the sitting opened.
 */
export type MemberReading = 'complete' | 'failed' | 'none'

/** A member table's reading state. */
export interface LinkedTableReading extends LinkedTable {
  readonly reading: MemberReading
  /** When its shown bill was read; null when nothing was read well in this sitting. */
  readonly readAt: Date | null
}

/**
 * Each member's reading state, in the group's order. A failed reading over no good one is
 * `failed` too: the table's bill is unknown, so the group's total cannot be final.
 */
export async function linkedGroupReadings(
  tx: Readable,
  group: LinkedGroup,
): Promise<LinkedTableReading[]> {
  const rows = await tx
    .select({
      tableId: sittings.tableId,
      openedAt: sittings.openedAt,
      readAt: billReadings.readAt,
      complete: billReadings.complete,
    })
    .from(sittings)
    .leftJoin(
      billReadings,
      and(eq(billReadings.tenantId, sittings.tenantId), eq(billReadings.tableId, sittings.tableId)),
    )
    .where(
      inArray(
        sittings.id,
        group.tables.map((table) => table.sittingId),
      ),
    )
  const byTable = new Map(rows.map((row) => [row.tableId, row]))
  return group.tables.map((table) => {
    const row = byTable.get(table.tableId)
    if (row === undefined || row.readAt === null || row.complete === null) {
      return { ...table, reading: 'none', readAt: null }
    }
    // A bill read before this sitting opened is another sitting's (D122 §4); a failed reading
    // with no good one before it carries the epoch (`readings.ts`), which is older still.
    const shownAt = row.readAt < row.openedAt ? null : row.readAt
    if (!row.complete) return { ...table, reading: 'failed', readAt: shownAt }
    return shownAt === null
      ? { ...table, reading: 'none', readAt: null }
      : { ...table, reading: 'complete', readAt: shownAt }
  })
}

/**
 * Whether the group has a table whose bill is not known well now (rule 6, decision log 1.8): its
 * latest reading failed, or nothing was read in its sitting. The group's total is then not final,
 * and paying "The whole bill" or that table's lines waits (D160 §1; the payment tickets).
 */
export function groupHasUnreadTable(readings: readonly LinkedTableReading[]): boolean {
  return readings.some((member) => member.reading !== 'complete')
}
