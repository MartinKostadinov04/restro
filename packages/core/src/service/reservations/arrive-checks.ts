// What the door is told before anybody taps it (ticket #329; D134, D135, D137): the advice the
// hostess reads on the plan and on the night's list, and the one warning a waiter gets on Tonight.
//
// Read-only, and **nothing here refuses**. A warning never blocks a tap (#329, D134): something
// already on the table's bill is a thing to look at, not a thing to forbid, because only the
// hostess knows whether the people at the table are the ones who ordered it. The two things that
// do block — somebody on the spot, and a table that cannot be opened — are decided again by the
// write path inside its own transaction, which is the authority; they are given here only so the
// screen can say so while she is still choosing.
//
// It also does **not** decide whether a table can be opened. There is one such decision, in
// `sittings.ts`, and the arrival carries its reason back in the refusal's details; a second copy
// here could disagree with it (#329: one way to open a table).
//
// No personal data leaves this module beyond what the night's list already shows: the name of the
// party in the way and the hour they hold the spot. Never a phone number (D140).

import {
  type DbPool,
  type ReadTx,
  reservationSettings,
  reservationSpots,
  reservations,
  sentOrders,
  sittings,
  spots,
  tableOrders,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { PayRule } from '../../pay-first-settings'
import { open, type ReadInput } from '../night-read'
import { holdsSpotNow } from './overlap'
import { storedPayRule } from './pay-rule'
import { holdsOfNight, nightBounds, planDayOf } from './plan-read'
import { openReservations, type ReservationReadRefusal } from './read'
import { nightWritable, type ReservationRefusal } from './rows'
import type { ReservationKind } from './status'

/** What the door asks about: the spots being tapped, and the party being seated on them. */
export interface ArrivalChecksInput extends ReadInput {
  /** The night (a service day); left out, tonight. */
  readonly day?: string
  /**
   * The spots being tapped. Left out (or empty) with a `reservationId`, the party's own spots are
   * read instead — the same thing the arrival itself does with no spots given, so the night's list
   * can ask for the advice of a row it only knows by its reservation.
   */
  readonly spotIds?: readonly string[]
  /** The party arriving: it is never in its own way. Left out for a walk-in nobody booked. */
  readonly reservationId?: string
}

/** One table of the spots being tapped, as the door sees it. */
export interface DoorTable {
  readonly tableId: string
  readonly tableName: string
  /** Its codes are already open: the same-guests question has to be asked (#329). */
  readonly open: boolean
  /**
   * Something is already on that table — lines in its round, or a round already sent. The hostess
   * is told so before she seats anybody, and decides; nothing here forbids it (D134).
   */
  readonly bill: boolean
}

/** Somebody on a spot at this moment: what the seat rule would refuse (`holdsSpotNow`). */
export interface OnTheSpot {
  readonly spotId: string
  readonly spotName: string
  readonly reservationId: string
  readonly kind: ReservationKind
  /** The party on it; null for a block (its reason is on the plan). */
  readonly name: string | null
  readonly from: Date
}

/** A booking that holds one of these spots later tonight: what early seating has to end before. */
export interface HeldLater {
  readonly spotId: string
  readonly reservationId: string
  readonly kind: ReservationKind
  readonly name: string | null
  /** The hour they hold it from — the hour "Seat until {time}" offers. */
  readonly from: Date
}

/** The door's advice. */
export interface ArrivalChecks {
  /** Why the night cannot be written at all; null when it can. */
  readonly night: ReservationRefusal | null
  /**
   * The spots this advice is about: the ones tapped, else the party's own. The screen keeps them,
   * because the Undo of "Free" is the same party claiming the same spots again (#329).
   */
  readonly spotIds: readonly string[]
  readonly tables: readonly DoorTable[]
  /** Somebody is on one of the spots right now; the arrival would be refused. */
  readonly onTheSpot: OnTheSpot | null
  /** The nearest booking holding one of the spots later tonight. */
  readonly heldLater: HeldLater | null
  /**
   * The hour to offer as "Seat until {time}", or null to offer nothing.
   *
   * It is `heldLater`'s hour, offered only when a whole turn time still fits before it. D135 gives
   * a venue **one** turn time and no switch for early seating, so that one value is read for both
   * things it can mean here: the shortest sitting worth offering, and — by being long — a way to
   * stop the door offering early seating at all. Nothing is invented: a venue that does not want
   * early seating sets a turn time long enough to swallow the gap.
   */
  readonly until: Date | null
  /**
   * The pay rule this party carries, or null where it carries none (#334, D135). Read so the
   * same-guests question can say what happens to it: "yes" keeps the sitting and the rule follows
   * them, "no" opens a new sitting and the table is back on the club's rule. Nothing is decided
   * here — which level wins at the table is `payFirstRuleAt`'s, and whether the rule is in force on
   * a sitting is `payRuleInForce`'s.
   */
  readonly payRule: PayRule | null
}

/** The tables of these spots, by spot id, with the names the screen shows. */
async function tablesOfSpots(
  tx: ReadTx,
  venueId: string,
  spotIds: readonly string[],
): Promise<Map<string, { readonly tableId: string; readonly tableName: string }>> {
  const bySpot = new Map<string, { tableId: string; tableName: string }>()
  if (spotIds.length === 0) return bySpot
  const rows = await tx
    .select({ spotId: spots.id, tableId: spots.tableId, tableName: venueTables.name })
    .from(spots)
    .leftJoin(venueTables, eq(venueTables.id, spots.tableId))
    .where(
      and(inArray(spots.id, [...spotIds]), eq(spots.venueId, venueId), isNull(spots.removedAt)),
    )
  for (const row of rows) {
    if (row.tableId !== null) {
      bySpot.set(row.spotId, { tableId: row.tableId, tableName: row.tableName ?? '' })
    }
  }
  return bySpot
}

/**
 * Which of these tables are open for phones, and which already have something on them: the lines
 * of the open round, and whether a round was already sent in that sitting. `hadBillLines` carries
 * a reading the POS gave that sitting, so a bill opened at the POS counts too (#329).
 */
export async function openTables(
  tx: ReadTx,
  venueId: string,
  tableIds: readonly string[],
): Promise<Map<string, { readonly open: boolean; readonly bill: boolean }>> {
  const byTable = new Map<string, { open: boolean; bill: boolean }>()
  if (tableIds.length === 0) return byTable
  const open = await tx
    .select({ id: sittings.id, tableId: sittings.tableId, hadBillLines: sittings.hadBillLines })
    .from(sittings)
    .where(
      and(
        eq(sittings.venueId, venueId),
        inArray(sittings.tableId, [...tableIds]),
        isNull(sittings.endedAt),
      ),
    )
  if (open.length === 0) return byTable
  const orders = await tx
    .select({
      tableId: tableOrders.tableId,
      lines: sql<number>`jsonb_array_length(${tableOrders.lines})`,
    })
    .from(tableOrders)
    .where(
      and(
        eq(tableOrders.venueId, venueId),
        inArray(
          tableOrders.tableId,
          open.map((row) => row.tableId),
        ),
      ),
    )
  const lines = new Map(orders.map((row) => [row.tableId, Number(row.lines)]))
  const sent = new Set(
    (
      await tx
        .select({ sittingId: sentOrders.sittingId })
        .from(sentOrders)
        .where(
          inArray(
            sentOrders.sittingId,
            open.map((row) => row.id),
          ),
        )
    ).map((row) => row.sittingId),
  )
  for (const row of open) {
    byTable.set(row.tableId, {
      open: true,
      bill: row.hadBillLines || sent.has(row.id) || (lines.get(row.tableId) ?? 0) > 0,
    })
  }
  return byTable
}

/**
 * The advice for an arrival, a walk-in or a change of spots. Needs `reservations.tonight`, as the
 * night's list does; the write itself asks for its own permission.
 */
export async function readArrivalChecks(
  pool: DbPool,
  input: ArrivalChecksInput,
): Promise<
  | { readonly ok: true; readonly checks: ArrivalChecks }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    const now = input.now ?? new Date()
    const day = planDayOf(input.day, reader.today)
    const [settings] = await tx
      .select()
      .from(reservationSettings)
      .where(eq(reservationSettings.venueId, reader.venue.id))
    const night =
      settings === undefined
        ? ('settings_missing' as const)
        : nightWritable(
            { serviceDate: reader.today, permissions: reader.held },
            day,
            settings,
            null,
          )

    // The spots this advice is about: the ones tapped, else the party's own.
    const asked = input.spotIds ?? []
    const spotIds =
      asked.length > 0 || input.reservationId === undefined
        ? asked
        : (
            await tx
              .select({ spotId: reservationSpots.spotId })
              .from(reservationSpots)
              .where(
                and(
                  eq(reservationSpots.reservationId, input.reservationId),
                  isNull(reservationSpots.releasedAt),
                ),
              )
              .orderBy(asc(reservationSpots.spotId))
          ).map((row) => row.spotId)

    // The rule the party being seated carries, for the same-guests question's own words (#334).
    const payRule =
      input.reservationId === undefined
        ? null
        : storedPayRule(
            (
              await tx
                .select({ payRule: reservations.payRule })
                .from(reservations)
                .where(eq(reservations.id, input.reservationId))
            )[0]?.payRule ?? null,
          )

    const bySpot = await tablesOfSpots(tx, reader.venue.id, spotIds)
    const wanted = [...new Set([...bySpot.values()].map((one) => one.tableId))].sort()
    const state = await openTables(tx, reader.venue.id, wanted)
    const tables: DoorTable[] = wanted.map((tableId) => ({
      tableId,
      tableName: [...bySpot.values()].find((one) => one.tableId === tableId)?.tableName ?? '',
      open: state.get(tableId)?.open ?? false,
      bill: state.get(tableId)?.bill ?? false,
    }))

    const bounds = nightBounds(day, reader.venue.timezone, reader.venue.dayEndsAt)
    const facts = await holdsOfNight(tx, reader.venue.id, spotIds, {
      day,
      from: bounds.from,
      to: bounds.to,
      passed: false,
      turnMinutes: settings?.turnMinutes ?? null,
    })
    const names = new Map(
      (spotIds.length === 0
        ? []
        : await tx
            .select({ id: spots.id, name: spots.name })
            .from(spots)
            .where(inArray(spots.id, [...spotIds]))
      ).map((row) => [row.id, row.name]),
    )
    let onTheSpot: OnTheSpot | null = null
    let heldLater: HeldLater | null = null
    for (const spotId of spotIds) {
      for (const fact of facts.get(spotId) ?? []) {
        if (fact.reservationId === input.reservationId) continue
        if (onTheSpot === null && holdsSpotNow(fact, now)) {
          onTheSpot = {
            spotId,
            spotName: names.get(spotId) ?? '',
            reservationId: fact.reservationId,
            kind: fact.kind,
            name: fact.kind === 'block' ? null : fact.name,
            from: fact.stretch.from,
          }
        }
        // The nearest hold that has not begun: what early seating has to be over before.
        const starts = fact.stretch.from.getTime()
        if (starts > now.getTime() && (heldLater === null || starts < heldLater.from.getTime())) {
          heldLater = {
            spotId,
            reservationId: fact.reservationId,
            kind: fact.kind,
            name: fact.kind === 'block' ? null : fact.name,
            from: fact.stretch.from,
          }
        }
      }
    }
    const turnMinutes = settings?.turnMinutes ?? null
    const fits =
      heldLater !== null &&
      turnMinutes !== null &&
      heldLater.from.getTime() - now.getTime() >= turnMinutes * 60_000
    return {
      ok: true,
      checks: {
        night,
        spotIds,
        tables,
        onTheSpot,
        heldLater,
        until: fits && heldLater !== null ? heldLater.from : null,
        payRule,
      },
    } as const
  })
}

/** What a waiter is told about a table he is about to open, where there is anything to tell. */
export interface TableTonight {
  readonly tableId: string
  /** The nearest party holding one of its spots later tonight, or a block over it. */
  readonly reservationId: string
  readonly kind: ReservationKind
  readonly name: string | null
  readonly from: Date
}

/**
 * The warning Tonight shows when a waiter opens a table nobody was seated at (#329): only where
 * that table is **reserved later tonight or blocked**. Every other table is opened in silence —
 * a warning on a table nobody booked is noise, and the ticket says so.
 *
 * Nobody is stopped: the waiter opens the table and the hostess sees it In use on her plan.
 *
 * This one read answers whoever **may open a table** as well as whoever works tonight's
 * reservations, and it is the only reservation read that does. The person being warned is the
 * waiter at the tile, who does not keep the booking book: asking for `reservations.tonight` here
 * would mean the warning never reached the one person it is written for. What it gives out is
 * exactly what the warning says — the party's name, their hour, and nothing else (D140: never a
 * phone number) — about a table that person is about to open anyway.
 */
export async function readTablesTonight(
  pool: DbPool,
  input: ReadInput & { readonly tableIds: readonly string[] },
): Promise<
  | { readonly ok: true; readonly tables: readonly TableTonight[] }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    if (!reader.held.has('reservations.tonight') && !reader.held.has('tables.open_close')) {
      return { ok: false, code: 'permission_denied' } as const
    }
    const now = input.now ?? new Date()
    if (input.tableIds.length === 0) return { ok: true, tables: [] } as const
    const onTables = await tx
      .select({ spotId: spots.id, tableId: spots.tableId })
      .from(spots)
      .where(
        and(
          inArray(spots.tableId, [...input.tableIds]),
          eq(spots.venueId, reader.venue.id),
          isNull(spots.removedAt),
        ),
      )
    const spotIds = onTables.map((row) => row.spotId)
    const [settings] = await tx
      .select({ turnMinutes: reservationSettings.turnMinutes })
      .from(reservationSettings)
      .where(eq(reservationSettings.venueId, reader.venue.id))
    const bounds = nightBounds(reader.today, reader.venue.timezone, reader.venue.dayEndsAt)
    const facts = await holdsOfNight(tx, reader.venue.id, spotIds, {
      day: reader.today,
      from: bounds.from,
      to: bounds.to,
      passed: false,
      turnMinutes: settings?.turnMinutes ?? null,
    })
    const byTable = new Map<string, TableTonight>()
    for (const row of onTables) {
      if (row.tableId === null) continue
      for (const fact of facts.get(row.spotId) ?? []) {
        // A party already sitting there is not a warning: the hostess put them there.
        if (fact.status === 'seated') continue
        const starts = fact.stretch.from.getTime()
        if (starts < now.getTime() && fact.kind !== 'block') continue
        const had = byTable.get(row.tableId)
        if (had !== undefined && had.from.getTime() <= starts) continue
        byTable.set(row.tableId, {
          tableId: row.tableId,
          reservationId: fact.reservationId,
          kind: fact.kind,
          name: fact.kind === 'block' ? null : fact.name,
          from: fact.stretch.from,
        })
      }
    }
    return { ok: true, tables: [...byTable.values()] } as const
  })
}
