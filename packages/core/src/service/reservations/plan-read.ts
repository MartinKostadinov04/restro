// The read side of the floor plan (ticket #327; D134, D137, D141): one plan's spots with the state
// each of them reads as on the night asked about, the venue's own spot kinds for the legend and the
// filter, and what every spot holds, so a tap on one can say who is sitting in it and who booked it.
//
// Read-only on `withTenant`, as the night's list is: nothing here writes, no POS is called (a
// reservation is Restro's own data, D134), and the actor's own grants decide whether the screen
// opens at all — a role without "working tonight's reservations" is refused `permission_denied`,
// never handed an empty plan.
//
// Four things worth knowing before reading on:
//
// - **The geometry is checked here, not trusted.** Every row goes through the shape folder
//   (`checkSpotPlace`); a row the folder refuses is left off the plan and counted in `unreadable`,
//   so a screen is never handed numbers nobody checked, and nothing a venue stores can reach a
//   staff screen as anything but a name out of our own list and whole numbers.
// - **A spot's state is derived** (`plan-state.ts`), never stored, and never from a bill (D134,
//   log 1.44).
// - **A night that has passed reads its released rows too.** Finishing a party frees its spots, so
//   a past night asked with `released_at is null` would draw a floor nobody had used; the plan of a
//   past night is what its spots were booked and used for then (D141, 9.21), one month back.
// - **A block with no end crosses nights.** D137 keeps such a block on until somebody lifts it, and
//   a night's own query is by service day, so a second query reads the open blocks of the nights
//   before this one by their time instead.

import {
  type DbPool,
  floorPlans,
  guests,
  logEntries,
  type ReadTx,
  reservationSettings,
  reservationSpots,
  reservations,
  spots,
  venueSpotKinds,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

import { localInstant } from '../../service-day'
import {
  checkSpotPlace,
  planExtent,
  type SpotPlace,
  type SpotSymbol,
  spotSymbolOf,
} from '../../spot-shapes'
import { type ReadInput, type Who, whoOf } from '../night-read'
import {
  holdCoversAt,
  leadingHold,
  type SpotHoldFact,
  type SpotState,
  spotStateAt,
  spotStateOfNight,
} from './plan-state'
import {
  accessOf,
  openReservations,
  type ReservationAccess,
  type ReservationReadRefusal,
} from './read'
import type { ReservationKind, ReservationStatus } from './status'

/** How far back a plan is readable (D141, 9.21: a month of plans; older nights are Log only). */
export const PLAN_MONTH_DAYS = 31

/** One of the venue's plans, for the picker: a venue may have more than one (D134, log 1.28). */
export interface PlanChoice {
  readonly id: string
  readonly name: string
  /** The plan tonight's screens draw unless another is asked for. */
  readonly current: boolean
}

/** One of the venue's own spot kinds (D134): its words, its legend symbol, its default seats. */
export interface SpotKindRead {
  readonly key: string
  readonly label: string
  readonly symbol: SpotSymbol
  /** The plan offers it as a filter. */
  readonly filters: boolean
  readonly defaultSeats: number | null
}

/** What a spot holds, as its sheet says it. */
export interface SpotHoldRead {
  readonly reservationId: string
  readonly kind: ReservationKind
  readonly status: ReservationStatus
  /** The hour the party is expected, or the hour the block begins. */
  readonly startsAt: Date
  /** When the hold ends; null for a block that stays on until somebody lifts it (D137). */
  readonly until: Date | null
  /** When the party was marked present. */
  readonly seatedAt: Date | null
  readonly name: string | null
  readonly partySize: number | null
  /** A block's reason, as its code; the screen words it. */
  readonly reason: string | null
  /** It covers the moment asked about: who is on the spot **now**, not later tonight. */
  readonly now: boolean
}

/** The Table orders at a spot go onto, by our own id (rule 3). */
export interface SpotTableRead {
  readonly id: string
  readonly label: string
  /** The label is the till's number, so a screen can say "Table 7" rather than a bare 7. */
  readonly numbered: boolean
  /** The table has a phone code. The code itself never leaves the backend (rule 3). */
  readonly hasCode: boolean
}

/** One spot on the plan. */
export interface SpotRead {
  readonly id: string
  readonly name: string
  readonly kind: string
  /** Its place out of the shape folder: a checked name and checked whole numbers. */
  readonly place: SpotPlace
  /** Its own seats, else its kind's default; null where neither says. */
  readonly seats: number | null
  /**
   * Null for a spot that is not a table — a stool, a standing place — which is why the screen
   * never offers one a phone code (D134, log 1.68).
   */
  readonly table: SpotTableRead | null
  readonly state: SpotState
  /** What holds it on this night, the earliest hour first. */
  readonly holds: readonly SpotHoldRead[]
  /** The hold that explains the state: the party on it, or the block. Null on a night past. */
  readonly leading: SpotHoldRead | null
}

/** The box the spots take up, as the screen's own view box. */
export interface PlanExtent {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One plan as the screen draws it. */
export interface FloorPlanRead {
  /** The service day read (`YYYY-MM-DD`). */
  readonly day: string
  readonly today: string
  readonly passed: boolean
  /** Older than the month of plans: that night is a Log record only (D141, 9.21). */
  readonly tooOld: boolean
  /** The venue has no reservation settings yet, so it has no turn time (D135). */
  readonly settingsMissing: boolean
  /** The venue's plans, so a club with more than one can pick (D134, log 1.28). */
  readonly plans: readonly PlanChoice[]
  /** The plan shown; null when the venue has none drawn yet (the screen says who to ask). */
  readonly planId: string | null
  readonly planName: string | null
  readonly kinds: readonly SpotKindRead[]
  readonly spots: readonly SpotRead[]
  readonly extent: PlanExtent
  /** Spots the shape folder refused: drawn nowhere, counted so they are not simply missing. */
  readonly unreadable: number
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The day asked for, or today. A night ahead is kept, as the night's list keeps it (D135). */
export function planDayOf(asked: string | undefined, today: string): string {
  return asked !== undefined && DAY.test(asked) ? asked : today
}

/** Whole days from one service day to another (`YYYY-MM-DD`), counted on the calendar. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** The calendar date after a service day. */
function nextDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + 1)
  return at.toISOString().slice(0, 10)
}

/** When a service day begins and ends, in the venue's own zone (D45). */
export function nightBounds(
  day: string,
  timezone: string,
  dayEndsAt: string,
): { readonly from: Date; readonly to: Date } {
  return {
    from: localInstant(day, dayEndsAt, timezone, dayEndsAt),
    to: localInstant(nextDay(day), dayEndsAt, timezone, dayEndsAt),
  }
}

/**
 * The stretch one held row covers — the write side's own rule (`heldRowStretch`), with one case
 * more: a venue with no turn time yet (D135 leaves it unset until the owner sets one) has no length
 * to give a hold, so the hold runs to the end of the night rather than to a length invented here.
 * The cautious reading keeps a spot held instead of drawing it free while somebody is at it.
 */
export function planRowStretch(
  row: {
    readonly endsAt: Date | null
    readonly turnMinutes: number | null
    readonly heldFrom: Date
    readonly heldTo: Date | null
  },
  turnMinutes: number | null,
  nightEnd: Date,
): { readonly from: Date; readonly to: Date } {
  const from = row.heldFrom
  if (row.heldTo !== null) return { from, to: row.heldTo }
  if (row.endsAt !== null) return { from, to: row.endsAt }
  const minutes = row.turnMinutes ?? turnMinutes
  return minutes === null
    ? { from, to: nightEnd }
    : { from, to: new Date(from.getTime() + minutes * 60_000) }
}

/** The venue's plans: the current one first, then by name. */
async function plansOf(tx: ReadTx, venueId: string): Promise<PlanChoice[]> {
  const rows = await tx
    .select({ id: floorPlans.id, name: floorPlans.name, current: floorPlans.isCurrent })
    .from(floorPlans)
    .where(and(eq(floorPlans.venueId, venueId), isNull(floorPlans.removedAt)))
    .orderBy(desc(floorPlans.isCurrent), asc(floorPlans.name))
  return rows.map((row) => ({ id: row.id, name: row.name, current: row.current }))
}

/** The venue's own spot kinds, in their own order. */
async function kindsOf(tx: ReadTx, venueId: string): Promise<SpotKindRead[]> {
  const rows = await tx
    .select({
      key: venueSpotKinds.key,
      label: venueSpotKinds.label,
      symbol: venueSpotKinds.symbol,
      filters: venueSpotKinds.filters,
      defaultSeats: venueSpotKinds.defaultSeats,
    })
    .from(venueSpotKinds)
    .where(and(eq(venueSpotKinds.venueId, venueId), isNull(venueSpotKinds.removedAt)))
    .orderBy(asc(venueSpotKinds.sortKey), asc(venueSpotKinds.key))
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    symbol: spotSymbolOf(row.symbol),
    filters: row.filters,
    defaultSeats: row.defaultSeats,
  }))
}

/** The columns both hold queries select, so the two read one shape. */
const holdColumns = {
  spotId: reservationSpots.spotId,
  heldFrom: reservationSpots.heldFrom,
  heldTo: reservationSpots.heldTo,
  reservationId: reservations.id,
  kind: reservations.kind,
  status: reservations.status,
  startsAt: reservations.startsAt,
  endsAt: reservations.endsAt,
  turnMinutes: reservations.turnMinutes,
  seatedAt: reservations.seatedAt,
  partySize: reservations.partySize,
  partyLabel: reservations.partyLabel,
  guestName: guests.name,
  reason: reservations.reason,
} as const

/** The join both hold queries run: the held row, its reservation, and the guest's name. */
function holdsFrom(tx: ReadTx) {
  return tx
    .select(holdColumns)
    .from(reservationSpots)
    .innerJoin(
      reservations,
      and(
        eq(reservations.tenantId, reservationSpots.tenantId),
        eq(reservations.id, reservationSpots.reservationId),
      ),
    )
    .leftJoin(guests, eq(guests.id, reservations.guestId))
}

/**
 * What holds each of these spots on one night, by spot id.
 *
 * Two queries, because a hold reaches the plan two ways. The night's own holds are the rows of that
 * service day; a block with no end is kept on by D137 until somebody lifts it, and it carries the
 * service day it was made on, so the still-open blocks of earlier nights are read by their time
 * instead. Nothing else crosses a night: a party's hold ends with the turn time, with its own end
 * time, or with the night's sweep.
 */
async function holdsOfNight(
  tx: ReadTx,
  venueId: string,
  spotIds: readonly string[],
  night: {
    readonly day: string
    readonly from: Date
    readonly to: Date
    readonly passed: boolean
    readonly turnMinutes: number | null
  },
): Promise<Map<string, SpotHoldFact[]>> {
  const bySpot = new Map<string, SpotHoldFact[]>()
  if (spotIds.length === 0) return bySpot
  const onTheseSpots = inArray(reservationSpots.spotId, [...spotIds])
  const ofThisNight = and(
    eq(reservations.venueId, venueId),
    eq(reservations.serviceDate, night.day),
    isNull(reservations.deletedAt),
    onTheseSpots,
    // A night in progress reads what is held now; a night that has passed reads what was held,
    // released rows and all — by the morning, a party that came and left has released its spots.
    night.passed ? undefined : isNull(reservationSpots.releasedAt),
  )
  // The open blocks of the nights before this one (D137): still reserved, still holding, with no
  // end of any kind, and begun by the time this night ended. A block somebody has lifted since is
  // not among them: the Log says it was there, and a past night's plan does not re-draw it.
  const openBlocks = and(
    eq(reservations.venueId, venueId),
    lt(reservations.serviceDate, night.day),
    isNull(reservations.deletedAt),
    onTheseSpots,
    eq(reservations.kind, 'block'),
    eq(reservations.status, 'reserved'),
    isNull(reservations.endsAt),
    isNull(reservationSpots.heldTo),
    isNull(reservationSpots.releasedAt),
    lte(reservationSpots.heldFrom, night.to),
  )
  const rows = [
    ...(await holdsFrom(tx).where(ofThisNight)),
    ...(await holdsFrom(tx).where(openBlocks)),
  ]
  for (const row of rows) {
    const kind = row.kind as ReservationKind
    const fact: SpotHoldFact = {
      reservationId: row.reservationId,
      kind,
      status: row.status as ReservationStatus,
      stretch: planRowStretch(row, night.turnMinutes, night.to),
      ownEnd: row.endsAt !== null || row.heldTo !== null,
      startsAt: row.startsAt,
      seatedAt: row.seatedAt,
      name: row.guestName ?? row.partyLabel,
      partySize: row.partySize,
      reason: row.reason,
      // A block with no end of any kind is the one hold the turn time must not lift (D137).
      openEnded: kind === 'block' && row.endsAt === null && row.heldTo === null,
    }
    const own = bySpot.get(row.spotId)
    if (own === undefined) bySpot.set(row.spotId, [fact])
    else own.push(fact)
  }
  for (const own of bySpot.values()) {
    own.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  }
  return bySpot
}

/** One hold as a sheet reads it. `now` says whether it covers the moment asked about. */
function holdRead(hold: SpotHoldFact, now: boolean): SpotHoldRead {
  return {
    reservationId: hold.reservationId,
    kind: hold.kind,
    status: hold.status,
    startsAt: hold.startsAt,
    until: hold.openEnded ? null : hold.stretch.to,
    seatedAt: hold.seatedAt,
    name: hold.name,
    partySize: hold.partySize,
    reason: hold.reason,
    now,
  }
}

/**
 * One plan of a venue on one night. `planId` picks another of the venue's plans; left out, the
 * current one is drawn. `day` reads a night that has passed, a month back (D141).
 */
export async function readFloorPlan(
  pool: DbPool,
  input: ReadInput & { readonly day?: string; readonly planId?: string },
): Promise<
  | { readonly ok: true; readonly access: ReservationAccess; readonly plan: FloorPlanRead }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const { reader, editPastNights } = opened
    const access = accessOf(reader, editPastNights)
    const now = input.now ?? new Date()
    const day = planDayOf(input.day, reader.today)
    const passed = day < reader.today
    const tooOld = daysBetween(day, reader.today) > PLAN_MONTH_DAYS
    const [settings] = await tx
      .select({ turnMinutes: reservationSettings.turnMinutes })
      .from(reservationSettings)
      .where(eq(reservationSettings.venueId, reader.venue.id))
    const plans = await plansOf(tx, reader.venue.id)
    const chosen =
      plans.find((plan) => plan.id === input.planId) ??
      plans.find((plan) => plan.current) ??
      plans[0]
    const bare: FloorPlanRead = {
      day,
      today: reader.today,
      passed,
      tooOld,
      settingsMissing: settings === undefined,
      plans,
      planId: chosen?.id ?? null,
      planName: chosen?.name ?? null,
      kinds: [],
      spots: [],
      extent: planExtent([]),
      unreadable: 0,
    }
    // A night older than the month of plans is a record in the Log, not a plan (D141, 9.21): the
    // screen says so, and nothing of that night is read.
    if (chosen === undefined || tooOld) return { ok: true, access, plan: bare } as const

    const night = nightBounds(day, reader.venue.timezone, reader.venue.dayEndsAt)
    const kinds = await kindsOf(tx, reader.venue.id)
    const defaultSeats = new Map(kinds.map((kind) => [kind.key, kind.defaultSeats]))

    const found = await tx
      .select({
        id: spots.id,
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
        tableName: venueTables.name,
        tableNumber: venueTables.number,
        tableCode: venueTables.qrToken,
      })
      .from(spots)
      .leftJoin(venueTables, eq(venueTables.id, spots.tableId))
      .where(
        and(
          eq(spots.venueId, reader.venue.id),
          eq(spots.planId, chosen.id),
          // On a night that has passed, a spot taken off the plan since was still part of it.
          passed
            ? or(isNull(spots.removedAt), gt(spots.removedAt, night.from))
            : isNull(spots.removedAt),
        ),
      )
      .orderBy(asc(spots.name))
    if (found.length === 0) return { ok: true, access, plan: { ...bare, kinds } } as const

    const holds = await holdsOfNight(
      tx,
      reader.venue.id,
      found.map((row) => row.id),
      { day, from: night.from, to: night.to, passed, turnMinutes: settings?.turnMinutes ?? null },
    )

    let unreadable = 0
    const drawn: SpotRead[] = []
    for (const row of found) {
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
      const own = holds.get(row.id) ?? []
      // A night that has passed has no "now" to ask about: its state is what the spot was used
      // for, and nothing on it covers a moment.
      const state = passed ? spotStateOfNight(own) : spotStateAt(own, now)
      const lead = passed ? null : leadingHold(own, state, now)
      drawn.push({
        id: row.id,
        name: row.name,
        kind: row.kind,
        place: checked.place,
        seats: row.seats ?? defaultSeats.get(row.kind) ?? null,
        table:
          row.tableId === null
            ? null
            : {
                id: row.tableId,
                label: row.tableName ?? row.tableNumber ?? row.name,
                numbered: row.tableName === null && row.tableNumber !== null,
                hasCode: row.tableCode !== null,
              },
        state,
        holds: own.map((hold) => holdRead(hold, !passed && holdCoversAt(hold, now))),
        leading: lead === null ? null : holdRead(lead, true),
      })
    }
    return {
      ok: true,
      access,
      plan: {
        ...bare,
        kinds,
        spots: drawn,
        extent: planExtent(drawn.map((spot) => spot.place)),
        unreadable,
      },
    } as const
  })
}

/** One line of a spot's history, from the one Log (D141, rule 1). */
export interface SpotHistoryLine {
  readonly seq: number
  readonly at: Date
  readonly serviceDate: string
  readonly kind: string
  readonly fromState: string | null
  readonly toState: string | null
  readonly reason: string | null
  readonly who: Who
  readonly via: string | null
  /** The reservation the line is about, so a tap on it opens that line's sheet. */
  readonly reservationId: string | null
  /** What to call the party, where the reservation is still in the book. */
  readonly name: string | null
}

/** The Log kinds a spot's history is made of: what happened on it, and to it. */
const SPOT_HISTORY_KINDS = [
  'reservation.created',
  'reservation.changed',
  'reservation.status',
  'reservation.spots',
  'reservation.restored',
  'spot.changed',
] as const

/** How many lines of a spot's history one read returns. */
export const MAX_SPOT_HISTORY = 100

/**
 * One spot's history, newest first (the plan's two-tap story: the spot, then History). The Log has
 * no column for a spot — an entry names the spots it touched in its own details — so the lines are
 * found three ways: `spotId` for a change to the spot itself, the comma-joined `spots` of a
 * reservation's own entries, and the reservations that held the spot, whose later entries (marked
 * present, cancelled) name only the reservation. One month back, as the plans are (D141, 9.21).
 *
 * `spot` is null when the venue has no such spot, so the sheet says so rather than loading for ever.
 */
export async function readSpotHistory(
  pool: DbPool,
  input: ReadInput & { readonly spotId: string },
): Promise<
  | {
      readonly ok: true
      readonly access: ReservationAccess
      readonly spot: { readonly id: string; readonly name: string } | null
      readonly history: readonly SpotHistoryLine[]
    }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const { reader, editPastNights } = opened
    const access = accessOf(reader, editPastNights)
    const [spot] = await tx
      .select({ id: spots.id, name: spots.name })
      .from(spots)
      .where(and(eq(spots.id, input.spotId), eq(spots.venueId, reader.venue.id)))
    if (spot === undefined) {
      return { ok: true, access, spot: null, history: [] } as const
    }
    const from = new Date(`${reader.today}T00:00:00Z`)
    from.setUTCDate(from.getUTCDate() - PLAN_MONTH_DAYS)
    const since = from.toISOString().slice(0, 10)
    // The reservations that held this spot inside the month. Their own entries say what happened
    // to the party — marked present, cancelled — and those entries name the reservation, not the
    // spot (D141: every reservation entry names its reservation), so the spot is reached by them.
    const held = await tx
      .selectDistinct({ reservationId: reservationSpots.reservationId })
      .from(reservationSpots)
      .innerJoin(
        reservations,
        and(
          eq(reservations.tenantId, reservationSpots.tenantId),
          eq(reservations.id, reservationSpots.reservationId),
        ),
      )
      .where(
        and(
          eq(reservations.venueId, reader.venue.id),
          eq(reservationSpots.spotId, spot.id),
          gte(reservations.serviceDate, since),
        ),
      )
      .limit(MAX_SPOT_HISTORY)
    const heldBy = held.map((row) => row.reservationId)
    const entries = await tx
      .select({
        seq: logEntries.seq,
        at: logEntries.at,
        serviceDate: logEntries.serviceDate,
        kind: logEntries.kind,
        fromState: logEntries.fromState,
        toState: logEntries.toState,
        reason: logEntries.reason,
        actor: logEntries.actor,
        via: logEntries.via,
        reservationId: logEntries.reservationId,
      })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.venueId, reader.venue.id),
          inArray(logEntries.kind, [...SPOT_HISTORY_KINDS]),
          gte(logEntries.serviceDate, since),
          // The id is matched whole: `,sp_1,` never matches `sp_12`.
          or(
            sql`${logEntries.details} ->> 'spotId' = ${spot.id}`,
            sql`',' || coalesce(${logEntries.details} ->> 'spots', '') || ',' like ${`%,${spot.id},%`}`,
            ...(heldBy.length === 0 ? [] : [inArray(logEntries.reservationId, heldBy)]),
          ),
        ),
      )
      .orderBy(desc(logEntries.seq))
      .limit(MAX_SPOT_HISTORY)
    const named = await whoOf(
      tx,
      entries.map((entry) => entry.actor),
    )
    const reservationIds = [
      ...new Set(entries.map((entry) => entry.reservationId).filter((id) => id !== null)),
    ]
    const parties = new Map<string, string | null>()
    if (reservationIds.length > 0) {
      const rows = await tx
        .select({
          id: reservations.id,
          partyLabel: reservations.partyLabel,
          guestName: guests.name,
        })
        .from(reservations)
        .leftJoin(guests, eq(guests.id, reservations.guestId))
        .where(
          and(eq(reservations.venueId, reader.venue.id), inArray(reservations.id, reservationIds)),
        )
      for (const row of rows) parties.set(row.id, row.guestName ?? row.partyLabel)
    }
    return {
      ok: true,
      access,
      spot: { id: spot.id, name: spot.name },
      history: entries.map((entry) => ({
        seq: entry.seq,
        at: entry.at,
        serviceDate: entry.serviceDate,
        kind: entry.kind,
        fromState: entry.fromState,
        toState: entry.toState,
        reason: entry.reason,
        who: named.get(entry.actor) ?? { kind: 'restro' as const },
        via: entry.via,
        reservationId: entry.reservationId,
        name: entry.reservationId === null ? null : (parties.get(entry.reservationId) ?? null),
      })),
    } as const
  })
}
