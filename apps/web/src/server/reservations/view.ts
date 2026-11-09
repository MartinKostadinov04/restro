// What Venue › Reservations draws (#326), made from core's reservation reads by pure functions, so
// the order, the words and the counts can be tested without a database. Plain data, safe to send to
// the browser: our prefixed ids and public fields only (rule 3), times as text in the venue's zone.
//
// The guest's phone is on the detail only, never on a row: the list of a busy night would otherwise
// carry every guest's number into the browser, and only the sheet's Call button needs one.
import type {
  ReservationAccess,
  ReservationDetail,
  ReservationKind,
  ReservationNightRead,
  ReservationRefusal,
  ReservationRow,
  ReservationStatus,
} from '@restro/core/service'

import type { RV_STATUSES } from '@/reservations/statuses'

import { clockIn, type WhoView, whoView } from '../tonight/night-view'

/**
 * The browser's list of states (`src/reservations/statuses.ts`) and core's are one list: a state
 * core adds and that file forgets makes this type `never`, and the views below stop compiling
 * rather than the screen quietly dropping a row's own filter.
 */
type EveryStatus<T extends readonly ReservationStatus[]> = [
  Exclude<ReservationStatus, T[number]>,
] extends [never]
  ? T
  : never

/** One state, named as the browser's list names it. */
export type RvStatus = EveryStatus<typeof RV_STATUSES>[number]

/** What the screens know about the actor: a control the server would refuse is not drawn. */
export interface RvCan {
  /** `reservations.manage`: take, change, move and cancel a reservation. */
  readonly manage: boolean
  /** `reservations.block`: keep a spot back from booking (#327). */
  readonly block: boolean
  /** `reservations.edit_past`: change a night that has passed, where the owner allows it. */
  readonly editPast: boolean
  /** `reservations.end_night`: close the night's book. */
  readonly endNight: boolean
}

/** What the screen needs beside the data: the venue, its clock, and what the actor holds. */
export interface RvFrame {
  readonly venueId: string
  readonly timezone: string
  /** The venue's current service day (`YYYY-MM-DD`). */
  readonly today: string
  /** The hour the service day ends (`HH:mm`). */
  readonly dayEndsAt: string
  /** A shared device, so an action asks for a PIN (D141). */
  readonly device: boolean
  /** The owner's switch: a night that has passed may be corrected. */
  readonly editPastNights: boolean
  readonly can: RvCan
}

export function rvFrameOf(access: ReservationAccess, venueId: string): RvFrame {
  const held = new Set<string>(access.permissions)
  return {
    venueId,
    timezone: access.venue.timezone,
    today: access.today,
    dayEndsAt: access.venue.dayEndsAt,
    device: access.device,
    editPastNights: access.editPastNights,
    can: {
      manage: held.has('reservations.manage'),
      block: held.has('reservations.block'),
      editPast: held.has('reservations.edit_past'),
      endNight: held.has('reservations.end_night'),
    },
  }
}

/** One reservation on a row: everything the row shows, read without opening anything. */
export interface RvRowView {
  readonly id: string
  readonly kind: ReservationKind
  readonly status: ReservationStatus
  /** `HH:mm` in the venue's zone: the hour the party is expected, or came. */
  readonly time: string
  /** When the spot is held until, where the turn time gives one. */
  readonly until: string | null
  /** The guest's name, or null for a walk-in nobody named. */
  readonly name: string | null
  readonly partySize: number | null
  /** The spots held, by name, in the plan's order. */
  readonly spots: readonly string[]
  readonly note: string | null
  readonly reason: string | null
  /** Past its hour with nobody there yet (nothing is freed by itself). */
  readonly late: boolean
  /** The venue called it off, not the guest. */
  readonly byVenue: boolean
  readonly seatedAt: string | null
  readonly endedAt: string | null
}

/** Counts for the filter chips: a status with no row gets no chip. */
export interface RvCountsView {
  readonly all: number
  readonly late: number
  readonly byStatus: Readonly<Record<ReservationStatus, number>>
}

/** One night's list. */
export interface RvNightView {
  readonly day: string
  /** The night shown is the venue's current service day. */
  readonly today: boolean
  /** It has passed: read-only unless the owner allows corrections and the actor may make them. */
  readonly passed: boolean
  /** The night's book was closed: a record now, whatever the owner's switch says. */
  readonly closed: boolean
  /** null when this night may be written; otherwise why it may not. */
  readonly refusal: ReservationRefusal | null
  /** The venue has no turn time yet, so nothing can be booked (D135). */
  readonly settingsMissing: boolean
  readonly rows: readonly RvRowView[]
  readonly counts: RvCountsView
  /** More rows than one screenful holds: the night is longer than the list shows. */
  readonly hasMore: boolean
  /** Nights that hold something, newest first, for the night picker. */
  readonly days: readonly string[]
}

/** One line of a reservation's history, from the one Log (D141, rule 1). */
export interface RvHistoryView {
  readonly seq: number
  readonly time: string
  readonly kind: string
  readonly fromState: string | null
  readonly toState: string | null
  readonly reason: string | null
  readonly by: WhoView
}

/** Everything about one reservation, for its sheet. */
export interface RvDetailView {
  readonly row: RvRowView
  readonly day: string
  /** `Fri, 14 November` is the screen's job; the sheet gets the day and the hours. */
  readonly made: WhoView | null
  /** Only for calling and writing: the sheet's own two buttons, nowhere else. */
  readonly phone: string | null
  readonly email: string | null
  readonly history: readonly RvHistoryView[]
}

export function rvRowView(row: ReservationRow, timezone: string): RvRowView {
  const clock = clockIn(timezone)
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    time: clock(row.startsAt) ?? '',
    until: clock(row.endsAt),
    name: row.name,
    partySize: row.partySize,
    spots: row.spots,
    note: row.note,
    reason: row.reason,
    late: row.late,
    byVenue: row.cancelledByVenue,
    seatedAt: clock(row.seatedAt),
    endedAt: clock(row.endedAt),
  }
}

export function rvNightView(night: ReservationNightRead, timezone: string): RvNightView {
  return {
    day: night.day,
    today: night.day === night.today,
    passed: night.passed,
    closed: night.closed,
    refusal: night.writable,
    settingsMissing: night.settingsMissing,
    rows: night.rows.map((row) => rvRowView(row, timezone)),
    counts: night.counts,
    hasMore: night.hasMore,
    days: night.days,
  }
}

export function rvDetailView(detail: ReservationDetail, timezone: string): RvDetailView {
  const clock = clockIn(timezone)
  return {
    row: rvRowView(detail.row, timezone),
    day: detail.serviceDate,
    made: detail.madeBy === null ? null : whoView(detail.madeBy, null),
    phone: detail.row.phone,
    email: detail.email,
    history: detail.history.map((line) => ({
      seq: line.seq,
      time: clock(line.at) ?? '',
      kind: line.kind,
      fromState: line.fromState,
      toState: line.toState,
      reason: line.reason,
      by: whoView(line.who, line.via),
    })),
  }
}
