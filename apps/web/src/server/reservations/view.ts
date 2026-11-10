// What Venue › Reservations draws (#326), made from core's reservation reads by pure functions, so
// the order, the words and the counts can be tested without a database. Plain data, safe to send to
// the browser: our prefixed ids and public fields only (rule 3), times as text in the venue's zone.
//
// The guest's phone is on the detail only, never on a row: the list of a busy night would otherwise
// carry every guest's number into the browser, and only the sheet's Call button needs one. The one
// exception is a waiting party (`RvWaitingView`, #330): ringing the next one is the whole of what a
// queue is for, and core keeps that read short whatever the night does.
import type { SpotPlace, SpotSymbol } from '@restro/core'
import type {
  ArrivalChecks,
  BookingChecks,
  FloorPlanRead,
  GuestCard,
  GuestListRead,
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
  WaitingPartyRead,
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
  /** `settings.guests`: the guest records, erasing a guest among them (#333; own sign-in only). */
  readonly guests: boolean
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
      guests: held.has('settings.guests'),
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

/**
 * One party on the night's waiting list (#330): its place in the queue is the order of the array it
 * comes in, never a number on the row. Its telephone number is here, unlike a row of the night's
 * list, because calling the next party is what a queue is for.
 */
export interface RvWaitingView {
  readonly reservationId: string
  readonly name: string | null
  readonly phone: string | null
  readonly partySize: number | null
  readonly note: string | null
  /** `HH:mm` in the venue's zone: when the party was written down. */
  readonly since: string
  /** Whole minutes waited when the night was read; the row words it. */
  readonly waitedMinutes: number
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
  /** The parties with no spot, oldest first: the "Waiting" filter's own order (#330). */
  readonly waiting: readonly RvWaitingView[]
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
  /** The guest record the booking is linked to, for the guest's card (#333); null without one. */
  readonly guestId: string | null
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

export function rvWaitingView(party: WaitingPartyRead, timezone: string): RvWaitingView {
  return {
    reservationId: party.reservationId,
    name: party.name,
    phone: party.phone,
    partySize: party.partySize,
    note: party.note,
    since: clockIn(timezone)(party.since) ?? '',
    waitedMinutes: party.waitedMinutes,
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
    waiting: night.waiting.map((party) => rvWaitingView(party, timezone)),
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
    guestId: detail.row.guestId,
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
  /** Its codes are open for phones right now: a party seated here is asked the same-guests
   * question (#329). */
  readonly open: boolean
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
  /** The night's waiting list, oldest first: what a free spot's sheet offers (#330). */
  readonly waiting: readonly RvWaitingView[]
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
    waiting: plan.waiting.map((party) => rvWaitingView(party, timezone)),
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
  /** The phone already belongs to a guest on the venue's list (#333). */
  readonly listed: { readonly guestId: string; readonly name: string | null } | null
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
    listed: checks.listed,
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

// ───────────────────────────────── the door's advice (#329) ─────────────────────────────────

/** One Table of the spots being seated: whether its codes are open, and whether it carries a bill. */
export interface RvDoorTableView {
  readonly tableId: string
  readonly tableName: string
  readonly open: boolean
  readonly bill: boolean
}

/** Somebody already on one of the spots: the arrival would be refused and names them. */
export interface RvOnTheSpotView {
  readonly spotId: string
  readonly spotName: string
  readonly reservationId: string
  readonly kind: ReservationKind
  readonly name: string | null
  /** `HH:mm` in the venue's zone. */
  readonly time: string
}

/** The nearest booking holding one of the spots later tonight. */
export interface RvHeldLaterView {
  readonly spotId: string
  readonly reservationId: string
  readonly kind: ReservationKind
  readonly name: string | null
  readonly time: string
}

/**
 * What the door is told before it seats anybody (#329): the night's own refusal, the Tables the
 * spots belong to with their codes and their bills, whoever is on a spot right now, the party
 * holding one later tonight, and the hour to offer as "Seat until {time}". Every entry but `night`
 * and `onTheSpot` is a warning that never blocks a seating; those two are what the write refuses.
 */
export interface RvArrivalChecksView {
  /** The spots the advice is about: what the Undo of "Free" holds again (#329). */
  readonly spotIds: readonly string[]
  readonly night: ReservationRefusal | null
  readonly tables: readonly RvDoorTableView[]
  readonly onTheSpot: RvOnTheSpotView | null
  readonly heldLater: RvHeldLaterView | null
  readonly until: string | null
}

export function rvArrivalChecksView(checks: ArrivalChecks, timezone: string): RvArrivalChecksView {
  const clock = clockIn(timezone)
  return {
    night: checks.night,
    spotIds: checks.spotIds,
    tables: checks.tables.map((table) => ({
      tableId: table.tableId,
      tableName: table.tableName,
      open: table.open,
      bill: table.bill,
    })),
    onTheSpot:
      checks.onTheSpot === null
        ? null
        : {
            spotId: checks.onTheSpot.spotId,
            spotName: checks.onTheSpot.spotName,
            reservationId: checks.onTheSpot.reservationId,
            kind: checks.onTheSpot.kind,
            name: checks.onTheSpot.name,
            time: clock(checks.onTheSpot.from) ?? '',
          },
    heldLater:
      checks.heldLater === null
        ? null
        : {
            spotId: checks.heldLater.spotId,
            reservationId: checks.heldLater.reservationId,
            kind: checks.heldLater.kind,
            name: checks.heldLater.name,
            time: clock(checks.heldLater.from) ?? '',
          },
    until: clock(checks.until),
  }
}

// ───────────────────────────────── guests and regulars (#333) ─────────────────────────────────

/**
 * One guest on the venue's list. The number is on the row here, unlike the night's list: this is
 * the venue's own list of whom to call, every hostess may read it (D140), and the search narrows by
 * it. The email stays on the card.
 */
export interface RvGuestRowView {
  readonly id: string
  readonly name: string | null
  readonly phone: string | null
  readonly regular: boolean
  readonly archived: boolean
  /** On the reader's own private list; false for anyone who keeps none. */
  readonly mine: boolean
}

/** The venue's list, as one person reads it. */
export interface RvGuestListView {
  readonly rows: readonly RvGuestRowView[]
  readonly hasMore: boolean
  /** The reader keeps a private list here: the screen offers "My own list". */
  readonly privateList: boolean
}

/** One booking on a guest's card. */
export interface RvGuestBookingView {
  readonly id: string
  readonly status: ReservationStatus
  /** The night (`YYYY-MM-DD`). */
  readonly day: string
  /** `HH:mm` in the venue's zone. */
  readonly time: string
  readonly partySize: number | null
  readonly spots: readonly string[]
}

/** One guest's card. */
export interface RvGuestCardView {
  readonly id: string
  readonly name: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly note: string | null
  readonly regular: boolean
  readonly archived: boolean
  readonly came: number
  readonly missed: number
  readonly bookings: readonly RvGuestBookingView[]
  /** The reader's own private list; null for anyone who keeps none here. */
  readonly mine: { readonly onList: boolean; readonly note: string | null } | null
}

export function rvGuestListView(list: GuestListRead): RvGuestListView {
  return {
    rows: list.rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      regular: row.isRegular,
      archived: row.archived,
      mine: row.onMyList,
    })),
    hasMore: list.hasMore,
    privateList: list.privateList,
  }
}

export function rvGuestCardView(card: GuestCard, timezone: string): RvGuestCardView {
  const clock = clockIn(timezone)
  return {
    id: card.id,
    name: card.name,
    phone: card.phone,
    email: card.email,
    note: card.note,
    regular: card.isRegular,
    archived: card.archived,
    came: card.came,
    missed: card.missed,
    bookings: card.bookings.map((one) => ({
      id: one.id,
      status: one.status,
      day: one.serviceDate,
      time: clock(one.startsAt) ?? '',
      partySize: one.partySize,
      spots: one.spots,
    })),
    mine: card.mine,
  }
}
