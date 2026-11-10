// What Venue › Reservations draws (#326), made from core's reservation reads by pure functions, so
// the order, the words and the counts can be tested without a database. Plain data, safe to send to
// the browser: our prefixed ids and public fields only (rule 3), times as text in the venue's zone.
//
// The guest's phone is on the detail only, never on a row: the list of a busy night would otherwise
// carry every guest's number into the browser, and only the sheet's Call button needs one.
import type { SpotPlace, SpotSymbol } from '@restro/core'
import type {
  BookingChecks,
  FloorPlanRead,
  PlanExtent,
  ReservationAccess,
  ReservationDetail,
  ReservationKind,
  ReservationNightRead,
  ReservationRefusal,
  ReservationRow,
  ReservationStatus,
  SpotHistoryLine,
  SpotHoldRead,
  SpotState,
} from '@restro/core/service'

import type { RV_SPOT_STATES } from '@/reservations/spot-states'
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

/**
 * The same hold for the plan's five spot states (`src/reservations/spot-states.ts`): a state core
 * derives and the browser has no word for would make this type `never`, and the plan's views below
 * stop compiling rather than a tile drawing a state nobody can read.
 */
type EverySpotState<T extends readonly SpotState[]> = [Exclude<SpotState, T[number]>] extends [
  never,
]
  ? T
  : never

/** One spot state, named as the browser's list names it. */
export type RvSpotState = EverySpotState<typeof RV_SPOT_STATES>[number]

/** What the screens know about the actor: a control the server would refuse is not drawn. */
export interface RvCan {
  /** `reservations.tonight`: work the night, and take a booking (#328). */
  readonly tonight: boolean
  /** `reservations.manage`: change, cancel and bring back a booking, whoever took it. */
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
  /** A booking taken by hand needs a phone (the owner's switch, on until turned off). */
  readonly phoneRequired: boolean
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
    phoneRequired: access.phoneRequired,
    can: {
      tonight: held.has('reservations.tonight'),
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
  /** The night's lines taken out of the book: the bin a manager brings one back from (D135). */
  readonly deleted: readonly RvRowView[]
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
  /** The spots it holds, as ids in the order of `row.spots`: what the edit form starts from. */
  readonly spotIds: readonly string[]
  /** The version the edit form is opened on; a save over another one is refused (#328). */
  readonly version: string
  /** The person reading took this booking themselves: they may take it out (D135). */
  readonly mine: boolean
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
    deleted: night.deleted.map((row) => rvRowView(row, timezone)),
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
    spotIds: detail.spotIds,
    version: detail.version,
    mine: detail.mine,
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

// ───────────────────────────────── the floor plan (#327) ─────────────────────────────────

/**
 * One of the venue's own spot kinds, as the legend and the filter read it (D134). The symbol is a
 * name out of the shape folder's list, which the screen looks up in its own table of components:
 * nothing a venue stores is ever drawn as markup.
 */
export interface RvKindView {
  readonly key: string
  readonly label: string
  readonly symbol: SpotSymbol
  readonly filters: boolean
  readonly defaultSeats: number | null
}

/** One hold on a spot, as its sheet reads it. */
export interface RvHoldView {
  readonly reservationId: string
  readonly kind: ReservationKind
  readonly status: ReservationStatus
  /** `HH:mm` in the venue's zone: the hour the party is expected, or the block begins. */
  readonly time: string
  /** When it ends; null for a block nobody has put an end to (D137). */
  readonly until: string | null
  readonly seatedAt: string | null
  readonly name: string | null
  readonly partySize: number | null
  /** A block's reason, as its code; the screen words it. */
  readonly reason: string | null
  /** It covers the moment the plan was read: who is on the spot now, not later tonight. */
  readonly now: boolean
}

/** The Table a spot's orders go onto; null for a spot that is not a table (D134, log 1.68). */
export interface RvSpotTableView {
  readonly id: string
  readonly label: string
  readonly numbered: boolean
  /** It has a phone code. The code itself stays in the backend (rule 3). */
  readonly hasCode: boolean
}

/** One spot on the plan: its place out of the folder, its state, and what holds it. */
export interface RvSpotView {
  readonly id: string
  readonly name: string
  readonly kind: string
  /** The folder's checked name and whole numbers — never a path, a style or any other markup. */
  readonly place: SpotPlace
  readonly seats: number | null
  readonly state: RvSpotState
  readonly table: RvSpotTableView | null
  readonly holds: readonly RvHoldView[]
  readonly leading: RvHoldView | null
}

/** One plan, as the plan view draws it. */
export interface RvPlanView {
  readonly day: string
  /** The plan shown is the venue's current service day. */
  readonly today: boolean
  readonly passed: boolean
  /** Older than the month of plans (D141, 9.21): that night is a Log record only. */
  readonly tooOld: boolean
  readonly settingsMissing: boolean
  /** The venue's plans, for the picker where it has more than one. */
  readonly plans: readonly { readonly id: string; readonly name: string }[]
  /** null when the venue has no plan drawn yet: the screen says who to ask. */
  readonly planId: string | null
  readonly planName: string | null
  readonly kinds: readonly RvKindView[]
  readonly spots: readonly RvSpotView[]
  /** The box the spots take up, as the drawing's own view box. */
  readonly extent: PlanExtent
  /** Spots whose stored numbers the folder refused: drawn nowhere, counted here. */
  readonly unreadable: number
}

/** One line of a spot's history (D141: the one Log). */
export interface RvSpotHistoryView {
  readonly seq: number
  readonly day: string
  readonly time: string
  readonly kind: string
  readonly fromState: string | null
  readonly toState: string | null
  readonly reason: string | null
  readonly by: WhoView
  readonly reservationId: string | null
  readonly name: string | null
}

/** One spot's history, newest first, with the spot it is about. */
export interface RvSpotHistoryList {
  readonly spot: { readonly id: string; readonly name: string } | null
  readonly lines: readonly RvSpotHistoryView[]
}

function rvHoldView(hold: SpotHoldRead, timezone: string): RvHoldView {
  const clock = clockIn(timezone)
  return {
    reservationId: hold.reservationId,
    kind: hold.kind,
    status: hold.status,
    time: clock(hold.startsAt) ?? '',
    until: clock(hold.until),
    seatedAt: clock(hold.seatedAt),
    name: hold.name,
    partySize: hold.partySize,
    reason: hold.reason,
    now: hold.now,
  }
}

export function rvPlanView(plan: FloorPlanRead, timezone: string): RvPlanView {
  return {
    day: plan.day,
    today: plan.day === plan.today,
    passed: plan.passed,
    tooOld: plan.tooOld,
    settingsMissing: plan.settingsMissing,
    plans: plan.plans.map((one) => ({ id: one.id, name: one.name })),
    planId: plan.planId,
    planName: plan.planName,
    kinds: plan.kinds.map((kind) => ({
      key: kind.key,
      label: kind.label,
      symbol: kind.symbol,
      filters: kind.filters,
      defaultSeats: kind.defaultSeats,
    })),
    spots: plan.spots.map((spot) => ({
      id: spot.id,
      name: spot.name,
      kind: spot.kind,
      place: spot.place,
      seats: spot.seats,
      state: spot.state,
      table: spot.table,
      holds: spot.holds.map((hold) => rvHoldView(hold, timezone)),
      leading: spot.leading === null ? null : rvHoldView(spot.leading, timezone),
    })),
    extent: plan.extent,
    unreadable: plan.unreadable,
  }
}

export function rvSpotHistoryView(
  spot: { readonly id: string; readonly name: string } | null,
  history: readonly SpotHistoryLine[],
  timezone: string,
): RvSpotHistoryList {
  const clock = clockIn(timezone)
  return {
    spot,
    lines: history.map((line) => ({
      seq: line.seq,
      day: line.serviceDate,
      time: clock(line.at) ?? '',
      kind: line.kind,
      fromState: line.fromState,
      toState: line.toState,
      reason: line.reason,
      by: whoView(line.who, line.via),
      reservationId: line.reservationId,
      name: line.name,
    })),
  }
}

// ───────────────────────────── the booking form's advice (#328) ─────────────────────────────

/**
 * What the booking form is told while it is typed (D134, D135, D137). Every entry but `taken` and
 * `night` is a warning that never blocks a save; those two are what the write path will refuse,
 * shown early so nobody finds out on Save. Times as text in the venue's zone, never a phone number.
 */
export interface RvChecksView {
  /** Why this night cannot be written at all; null when it can. */
  readonly night: ReservationRefusal | null
  readonly seats: { readonly guests: number; readonly seats: number } | null
  readonly sameContact: { readonly name: string | null; readonly time: string } | null
  readonly closedNight: boolean
  readonly beforeOpening: { readonly opens: string; readonly closes: string } | null
  readonly afterClosing: boolean
  readonly taken: {
    readonly spotId: string
    readonly spotName: string
    readonly reservationId: string
    readonly kind: ReservationKind
    readonly name: string | null
    readonly time: string
  } | null
}

export function rvChecksView(checks: BookingChecks, timezone: string): RvChecksView {
  const clock = clockIn(timezone)
  return {
    night: checks.night,
    seats: checks.seats,
    sameContact:
      checks.sameContact === null
        ? null
        : { name: checks.sameContact.name, time: clock(checks.sameContact.startsAt) ?? '' },
    closedNight: checks.closedNight,
    beforeOpening:
      checks.beforeOpening === null
        ? null
        : {
            opens: clock(checks.beforeOpening.opensAt) ?? '',
            closes: clock(checks.beforeOpening.closesAt) ?? '',
          },
    afterClosing: checks.afterClosing,
    taken:
      checks.taken === null
        ? null
        : {
            spotId: checks.taken.spotId,
            spotName: checks.taken.spotName,
            reservationId: checks.taken.reservationId,
            kind: checks.taken.kind,
            name: checks.taken.name,
            time: clock(checks.taken.from) ?? '',
          },
  }
}
