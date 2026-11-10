// The read side of the hostess's night (ticket #326; D135, D138, D140, D141): one night's
// reservations in arrival order with their counts, the nights that hold something, and one
// reservation with everything about it and its history from the Log.
//
// Read-only on `withTenant`: nothing here writes, no POS is called, and the actor's own grants
// decide what is read at all — a screen a role may not open is refused `permission_denied`, never
// emptied. Our own ids and public fields only (rule 3).
//
// Three things the night's list is **not**:
// - It is not the plan. Blocks (`kind = 'block'`) are nobody at a table — no name, no party size,
//   no arrival — so they belong to the plan screen (ticket #327) and are left out of the arrival
//   list and of its counts.
// - It is not the booking book's history. A line taken out of the book (`deleted_at`) is gone from
//   every list (D135); the Log still names what was there.
// - It writes nothing. Whether a night may be written is read here and said on the screen
//   (`writable`), and every command checks it again through `nightWritable` (rule 1).

import {
  type DbPool,
  guests,
  logEntries,
  type ReadTx,
  reservationNights,
  reservationSettings,
  reservationSpots,
  reservations,
  spots,
  staffMembers,
  venues,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { PayRule } from '../../pay-first-settings'
import { readPayFirstSettings } from '../../pay-first-settings'
import { open, type Reader, type ReadInput, type Who, whoOf } from '../night-read'
import type { Permission } from '../permissions'
import type { TonightRefusal } from '../read'
import { type PayRuleBeaten, payRuleBeatenAt, storedPayRule } from './pay-rule'
import { LATE_AFTER_MINUTES } from './plan-state'
import { nightWritable, type ReservationRefusal } from './rows'
import {
  RESERVATION_STATUSES,
  type ReservationKind,
  type ReservationStatus,
  UNDONE_ARRIVAL_REASON,
} from './status'
import { reservationVersion } from './version'

/** Why one of these reads was refused. */
export type ReservationReadRefusal = TonightRefusal

/**
 * How long after its hour a party nobody marked present reads as late. One value for the list and
 * for the plan, so the two never disagree: it lives in `plan-state.ts`, which is pure.
 */
export { LATE_AFTER_MINUTES } from './plan-state'

/** How many deleted lines of one night the bin shows at most. */
export const MAX_BIN_ROWS = 100

/** How many nights of one venue one read returns at most. */
export const MAX_NIGHT_ROWS = 500

/** How many nights the picker is told hold something, in each direction. */
export const LISTED_NIGHTS = 120

/** What the hostess's screens need of the actor, without reading a night. */
export interface ReservationAccess {
  readonly venue: Reader['venue']
  readonly permissions: readonly Permission[]
  /** A shared device's own account: a person's PIN names who writes (D141). */
  readonly device: boolean
  /** The venue's current service day (D45). */
  readonly today: string
  /** The venue switched on writing a night that has passed (D135); false with no settings yet. */
  readonly editPastNights: boolean
  /** A booking taken by hand needs a phone (D135, the settings switch); true until it is turned off. */
  readonly phoneRequired: boolean
}

/** One reservation as the night's list reads it. */
export interface ReservationRow {
  readonly id: string
  readonly kind: ReservationKind
  readonly status: ReservationStatus
  /** The hour the party is expected, or the hour a walk-in was written down. */
  readonly startsAt: Date
  /** The end hour staff set themselves; null leaves the end to the turn time. */
  readonly endsAt: Date | null
  readonly partySize: number | null
  /** What to call the party: the guest record's name, or the name written on the book. */
  readonly name: string | null
  /** The guest's number, for the call link; null where the booking carries none. */
  readonly phone: string | null
  readonly guestId: string | null
  readonly note: string | null
  readonly reason: string | null
  /** The spots the party holds, by name, in the plan's own order. */
  readonly spots: readonly string[]
  readonly seatedAt: Date | null
  readonly endedAt: Date | null
  /** Past its hour and nobody present yet (`LATE_AFTER_MINUTES`); nothing is freed by it. */
  readonly late: boolean
  /**
   * Cancelled by the venue's own undo of a mis-tapped walk-in (`UNDONE_ARRIVAL_REASON`, #329), not
   * by a guest who called off: the list says which, so a hostess never reads one as the other.
   */
  readonly cancelledByVenue: boolean
  /** When the row last changed, so a sheet can tell that somebody else has moved on. */
  readonly updatedAt: Date
}

/** The counts the filters carry: every status with a row, plus the whole night and the late ones. */
export interface ReservationCounts {
  readonly all: number
  readonly late: number
  readonly byStatus: Readonly<Record<ReservationStatus, number>>
}

/** One night of reservations, as the list draws it. */
export interface ReservationNightRead {
  /** The service day read (`YYYY-MM-DD`). */
  readonly day: string
  readonly today: string
  /** The night's service day has ended, so it is a night that has **passed** (D135). */
  readonly passed: boolean
  /** Somebody closed the night (D138): a record now, whatever the past-nights switch says. */
  readonly closed: boolean
  /** Null when the night may be written; the refusal code when it may not. */
  readonly writable: ReservationRefusal | null
  /** The venue has no reservation settings yet, so it has no turn time (D135). */
  readonly settingsMissing: boolean
  /** The night's parties in arrival order (the earliest hour first), blocks left out. */
  readonly rows: readonly ReservationRow[]
  /** The night's lines taken out of the book, for whoever may bring one back (D135). */
  readonly deleted: readonly ReservationRow[]
  readonly counts: ReservationCounts
  /** More parties than were returned: a night of over `MAX_NIGHT_ROWS` lines. */
  readonly hasMore: boolean
  /** The nights around today that hold a reservation, for the day picker (the others are greyed). */
  readonly days: readonly string[]
}

/** One line of a reservation's history, from the one Log (D141). */
export interface ReservationHistoryLine {
  readonly seq: number
  readonly at: Date
  readonly kind: string
  readonly fromState: string | null
  readonly toState: string | null
  readonly reason: string | null
  readonly who: Who
  readonly via: string | null
}

/** One reservation and everything about it, for its sheet. */
export interface ReservationDetail {
  readonly row: ReservationRow
  readonly serviceDate: string
  /** Who wrote it down; null for a line nobody's hand made (a sweep, or the website in part 2). */
  readonly madeBy: Who | null
  /** The guest's email, where the venue's record holds one (D140). */
  readonly email: string | null
  /** The spots it holds, as ids in the same order as `row.spots`: what an edit form starts from. */
  readonly spotIds: readonly string[]
  /** The version an edit form is opened on (`version.ts`); a save over another one is refused. */
  readonly version: string
  /** The actor took this booking themselves, so may take it out without managing bookings. */
  readonly mine: boolean
  /** The pay rule this party carries, and the spots a table's own setting beats it on (#334). */
  readonly payRule: ReservationPayRuleRead
  /** Its own history, oldest first, from the Log: never a guest's contact details (D140). */
  readonly history: readonly ReservationHistoryLine[]
}

/** What the sheet's Pay rule section reads (#334; D135, D122 §5). */
export interface ReservationPayRuleRead {
  /** The rule the party carries; null is the club's own rule, which is the absence of one. */
  readonly rule: PayRule | null
  /**
   * The party's spots whose **table** carries a pay-first setting of its own, which wins over the
   * party's rule. The sheet says so in one line instead of drawing the party's rule as if it were
   * in force, and says it whether or not a rule is set.
   */
  readonly beaten: readonly PayRuleBeaten[]
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The night asked for, or today. Unlike the Log's own `dayOf`, a night **ahead** is kept: a
 * reservation list has to reach the nights still to come, and D135 puts no limit on how far
 * (the screen opens on today all the same, every time it is entered).
 */
export function reservationDayOf(asked: string | undefined, today: string): string {
  return asked !== undefined && DAY.test(asked) ? asked : today
}

/** True when a party is past its hour and nobody has marked it present yet (D135). */
export function isLate(
  row: Pick<ReservationRow, 'status' | 'startsAt'>,
  now: Date,
  afterMinutes: number = LATE_AFTER_MINUTES,
): boolean {
  if (row.status !== 'reserved') return false
  return row.startsAt.getTime() + afterMinutes * 60_000 <= now.getTime()
}

/** Opens the night's screens: the actor must hold "working tonight's reservations" (D141). */
export async function openReservations(
  tx: ReadTx,
  input: ReadInput,
): Promise<
  | {
      readonly ok: true
      readonly reader: Reader
      readonly editPastNights: boolean
      readonly phoneRequired: boolean
    }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  const opened = await open(tx, input)
  if (!opened.ok) return opened
  if (!opened.reader.held.has('reservations.tonight')) {
    return { ok: false, code: 'permission_denied' }
  }
  const [settings] = await tx
    .select({
      editPastNights: reservationSettings.editPastNights,
      phoneRequired: reservationSettings.phoneRequired,
    })
    .from(reservationSettings)
    .where(eq(reservationSettings.venueId, opened.reader.venue.id))
  return {
    ok: true,
    reader: opened.reader,
    editPastNights: settings?.editPastNights ?? false,
    phoneRequired: settings?.phoneRequired ?? true,
  }
}

/** The actor's access, as both night reads and the plan read (#327) hand it to a screen. */
export const accessOf = (
  reader: Reader,
  editPastNights: boolean,
  phoneRequired = true,
): ReservationAccess => ({
  venue: reader.venue,
  permissions: [...reader.held],
  device: reader.device,
  today: reader.today,
  editPastNights,
  phoneRequired,
})

/** What the actor holds here, for the tab bar and the venue page. */
export async function readReservationAccess(
  pool: DbPool,
  input: ReadInput,
): Promise<
  | { readonly ok: true; readonly access: ReservationAccess }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    return opened.ok
      ? ({
          ok: true,
          access: accessOf(opened.reader, opened.editPastNights, opened.phoneRequired),
        } as const)
      : opened
  })
}

/** An empty count of every status, so a filter's number is never undefined. */
function emptyByStatus(): Record<ReservationStatus, number> {
  return Object.fromEntries(RESERVATION_STATUSES.map((status) => [status, 0])) as Record<
    ReservationStatus,
    number
  >
}

/** The spots each of these reservations holds, by name, in the plan's own order. */
async function spotsOf(
  tx: ReadTx,
  reservationIds: readonly string[],
): Promise<Map<string, string[]>> {
  const held = new Map<string, string[]>()
  if (reservationIds.length === 0) return held
  const rows = await tx
    .select({ reservationId: reservationSpots.reservationId, name: spots.name })
    .from(reservationSpots)
    .innerJoin(spots, eq(spots.id, reservationSpots.spotId))
    .where(
      and(
        inArray(reservationSpots.reservationId, [...reservationIds]),
        isNull(reservationSpots.releasedAt),
      ),
    )
    .orderBy(asc(spots.name))
  for (const row of rows) {
    const names = held.get(row.reservationId)
    if (names === undefined) held.set(row.reservationId, [row.name])
    else names.push(row.name)
  }
  return held
}

/** The columns the night's list reads of every reservation. */
const nightColumns = {
  id: reservations.id,
  kind: reservations.kind,
  status: reservations.status,
  startsAt: reservations.startsAt,
  endsAt: reservations.endsAt,
  partySize: reservations.partySize,
  partyLabel: reservations.partyLabel,
  guestId: reservations.guestId,
  guestName: guests.name,
  guestPhone: guests.phone,
  note: reservations.note,
  reason: reservations.reason,
  seatedAt: reservations.seatedAt,
  endedAt: reservations.endedAt,
  updatedAt: reservations.updatedAt,
} as const

/** One night of a venue, with the nights around it that hold something. */
export async function readReservationNight(
  pool: DbPool,
  input: ReadInput & { readonly day?: string },
): Promise<
  | {
      readonly ok: true
      readonly access: ReservationAccess
      readonly night: ReservationNightRead
    }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const { reader, editPastNights, phoneRequired } = opened
    const now = input.now ?? new Date()
    const day = reservationDayOf(input.day, reader.today)
    const nightOf = and(
      eq(reservations.venueId, reader.venue.id),
      eq(reservations.serviceDate, day),
      isNull(reservations.deletedAt),
      // A block is nobody coming: the plan screen owns it (#327), the arrival list does not.
      sql`${reservations.kind} <> 'block'`,
    )
    const found = await tx
      .select(nightColumns)
      .from(reservations)
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .where(nightOf)
      // Arrival order, not the order the bookings were taken in (D135, the lead's call).
      .orderBy(asc(reservations.startsAt), asc(reservations.id))
      .limit(MAX_NIGHT_ROWS + 1)
    const page = found.slice(0, MAX_NIGHT_ROWS)
    const held = await spotsOf(
      tx,
      page.map((row) => row.id),
    )
    const toRow = (
      row: (typeof page)[number],
      spotsHeld: Map<string, string[]> = held,
    ): ReservationRow => {
      const status = row.status as ReservationStatus
      const party = {
        id: row.id,
        kind: row.kind as ReservationKind,
        status,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        partySize: row.partySize,
        name: row.partyLabel ?? row.guestName,
        phone: row.guestPhone,
        guestId: row.guestId,
        note: row.note,
        reason: row.reason,
        spots: spotsHeld.get(row.id) ?? [],
        seatedAt: row.seatedAt,
        endedAt: row.endedAt,
        cancelledByVenue: status === 'cancelled' && row.reason === UNDONE_ARRIVAL_REASON,
        updatedAt: row.updatedAt,
      }
      return { ...party, late: isLate(party, now) }
    }
    const rows: ReservationRow[] = page.map((row) => toRow(row))

    // The bin (D135: Delete is a real button, and a manager brings a line back): the night's lines
    // that were taken out of the book, for whoever can bring one back. A shared device is offered
    // them too — the PIN names the person, and the write decides.
    const binned =
      reader.held.has('reservations.manage') || reader.device
        ? await tx
            .select(nightColumns)
            .from(reservations)
            .leftJoin(guests, eq(guests.id, reservations.guestId))
            .where(
              and(
                eq(reservations.venueId, reader.venue.id),
                eq(reservations.serviceDate, day),
                isNotNull(reservations.deletedAt),
                sql`${reservations.kind} <> 'block'`,
              ),
            )
            .orderBy(asc(reservations.startsAt), asc(reservations.id))
            .limit(MAX_BIN_ROWS)
        : []
    const binnedSpots = await spotsOf(
      tx,
      binned.map((row) => row.id),
    )

    const byStatus = emptyByStatus()
    let late = 0
    for (const row of rows) {
      byStatus[row.status] += 1
      if (row.late) late += 1
    }

    const [night] = await tx
      .select({ closedAt: reservationNights.closedAt })
      .from(reservationNights)
      .where(
        and(eq(reservationNights.venueId, reader.venue.id), eq(reservationNights.serviceDate, day)),
      )
    const [settings] = await tx
      .select({ editPastNights: reservationSettings.editPastNights })
      .from(reservationSettings)
      .where(eq(reservationSettings.venueId, reader.venue.id))
    const writable =
      settings === undefined
        ? 'settings_missing'
        : nightWritable(
            { serviceDate: reader.today, permissions: reader.held },
            day,
            settings,
            night ?? null,
          )

    const days = await tx
      .selectDistinct({ day: reservations.serviceDate })
      .from(reservations)
      .where(and(eq(reservations.venueId, reader.venue.id), isNull(reservations.deletedAt)))
      .orderBy(desc(reservations.serviceDate))
      .limit(LISTED_NIGHTS * 2)

    return {
      ok: true,
      access: accessOf(reader, editPastNights, phoneRequired),
      night: {
        day,
        today: reader.today,
        passed: day < reader.today,
        closed: night?.closedAt != null,
        writable,
        settingsMissing: settings === undefined,
        rows,
        deleted: binned.map((row) => toRow(row, binnedSpots)),
        counts: { all: rows.length, late, byStatus },
        hasMore: found.length > page.length,
        days: days.map((row) => row.day),
      },
    } as const
  })
}

/**
 * The staff member the reader is: a PIN on a shared device names one, a signed-in person is matched
 * to their own staff record. Null for the device's own account and for Restro's team — their PIN or
 * their permissions decide, not a booking being theirs (`staffMemberOf` is the write side's).
 */
async function staffMemberFor(tx: ReadTx, input: ReadInput): Promise<string | null> {
  if (input.actor.kind === 'staff') return input.actor.staffMemberId
  if (input.actor.kind !== 'user') return null
  const [member] = await tx
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(
      and(
        eq(staffMembers.tenantId, input.tenantId),
        eq(staffMembers.userId, input.actor.userId),
        isNull(staffMembers.archivedAt),
      ),
    )
  return member?.id ?? null
}

/** The Log kinds a reservation's own history is made of (#323). */
const HISTORY_KINDS = [
  'reservation.created',
  'reservation.changed',
  'reservation.status',
  'reservation.spots',
  'reservation.restored',
  'reservation.pay_rule',
] as const

/**
 * One reservation for its sheet, with its history from the one Log (D141). `detail` is null when
 * the venue has no such line, or it was taken out of the book: the sheet says so rather than
 * loading for ever.
 */
export async function readReservationDetail(
  pool: DbPool,
  input: ReadInput & { readonly reservationId: string },
): Promise<
  | {
      readonly ok: true
      readonly access: ReservationAccess
      readonly detail: ReservationDetail | null
    }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const { reader, editPastNights, phoneRequired } = opened
    const access = accessOf(reader, editPastNights, phoneRequired)
    const now = input.now ?? new Date()
    const [row] = await tx
      .select({
        id: reservations.id,
        serviceDate: reservations.serviceDate,
        kind: reservations.kind,
        status: reservations.status,
        startsAt: reservations.startsAt,
        endsAt: reservations.endsAt,
        partySize: reservations.partySize,
        partyLabel: reservations.partyLabel,
        guestId: reservations.guestId,
        guestName: guests.name,
        guestPhone: guests.phone,
        guestEmail: guests.email,
        note: reservations.note,
        reason: reservations.reason,
        madeBy: reservations.madeBy,
        seatedAt: reservations.seatedAt,
        endedAt: reservations.endedAt,
        updatedAt: reservations.updatedAt,
        payRule: reservations.payRule,
      })
      .from(reservations)
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .where(
        and(
          eq(reservations.id, input.reservationId),
          eq(reservations.venueId, reader.venue.id),
          isNull(reservations.deletedAt),
        ),
      )
    if (row === undefined) return { ok: true, access, detail: null } as const
    const held = await spotsOf(tx, [row.id])
    const heldRows = await tx
      .select({
        spotId: reservationSpots.spotId,
        updatedAt: reservationSpots.updatedAt,
        released: reservationSpots.releasedAt,
      })
      .from(reservationSpots)
      .innerJoin(spots, eq(spots.id, reservationSpots.spotId))
      .where(eq(reservationSpots.reservationId, row.id))
      .orderBy(asc(spots.name))
    const status = row.status as ReservationStatus
    const party = {
      id: row.id,
      kind: row.kind as ReservationKind,
      status,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      partySize: row.partySize,
      name: row.partyLabel ?? row.guestName,
      phone: row.guestPhone,
      guestId: row.guestId,
      note: row.note,
      reason: row.reason,
      spots: held.get(row.id) ?? [],
      seatedAt: row.seatedAt,
      endedAt: row.endedAt,
      cancelledByVenue: status === 'cancelled' && row.reason === UNDONE_ARRIVAL_REASON,
      updatedAt: row.updatedAt,
    }

    const entries = await tx
      .select({
        seq: logEntries.seq,
        at: logEntries.at,
        kind: logEntries.kind,
        fromState: logEntries.fromState,
        toState: logEntries.toState,
        reason: logEntries.reason,
        actor: logEntries.actor,
        via: logEntries.via,
      })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.venueId, reader.venue.id),
          eq(logEntries.reservationId, row.id),
          inArray(logEntries.kind, [...HISTORY_KINDS]),
        ),
      )
      .orderBy(asc(logEntries.seq))
    const named = await whoOf(tx, [
      ...entries.map((entry) => entry.actor),
      ...(row.madeBy === null ? [] : [`staff:${row.madeBy}`]),
    ])
    // Where a table's own pay-first setting beats the party's rule (#334). The venue's settings are
    // read here and nowhere else in this module: the resolution itself is `payFirstRuleAt`'s.
    const [venue] = await tx
      .select({ settings: venues.settings })
      .from(venues)
      .where(eq(venues.id, reader.venue.id))
    const beaten = await payRuleBeatenAt(tx, {
      reservationId: row.id,
      settings: readPayFirstSettings(venue?.settings ?? {}),
    })

    return {
      ok: true,
      access,
      detail: {
        row: { ...party, late: isLate(party, now) },
        serviceDate: row.serviceDate,
        madeBy: row.madeBy === null ? null : (named.get(`staff:${row.madeBy}`) ?? null),
        email: row.guestEmail,
        spotIds: heldRows.filter((one) => one.released === null).map((one) => one.spotId),
        version: reservationVersion(
          row.updatedAt,
          heldRows.reduce<Date | null>(
            (newest, one) => (newest === null || one.updatedAt > newest ? one.updatedAt : newest),
            null,
          ),
        ),
        mine: row.madeBy !== null && row.madeBy === (await staffMemberFor(tx, input)),
        payRule: { rule: storedPayRule(row.payRule), beaten },
        history: entries.map((entry) => ({
          seq: entry.seq,
          at: entry.at,
          kind: entry.kind,
          fromState: entry.fromState,
          toState: entry.toState,
          reason: entry.reason,
          who: named.get(entry.actor) ?? { kind: 'restro' },
          via: entry.via,
        })),
      },
    } as const
  })
}
