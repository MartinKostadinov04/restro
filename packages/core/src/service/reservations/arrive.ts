// The door (ticket #329; D122 §4, §7, §9, D134, D135, D137, D141): marking a party present,
// seating a walk-in straight off the plan, more guests joining a party already sitting, undoing an
// arrival, and freeing the spots when the party leaves.
//
// **Marking the guests present on their spot is what opens that table for phones** (D137, log
// 12.12). There is no "open the table" tap on the hostess's plan, and there is no second opener
// here: `openTableFor` and `newGuests` in `sittings.ts` are the ones ordering already uses, so a
// table opened at the door is a table opened by a waiter in every respect — the same sitting, the
// same order row, the same `sitting.opened` entry in the one Log, the same version bump the phones
// at the table read at their next poll.
//
// Three rules decide what happens to the table (#329):
// - **Yes keeps, no starts over.** Seating a party onto a table that is already open asks whether
//   these are the same guests. Yes keeps the sitting, its order and its phones' location passes;
//   no sends "New guests", which ends that sitting and empties the order. Neither is ever done by
//   itself: with no answer the command is refused `same_guests_unanswered`, because the two do
//   different things to the bill and a default would answer a question only the hostess can.
// - **More people joining a party already seated is not "New guests"**: `setGuestCount` changes
//   the number and touches no sitting, no order and no code.
// - **Nothing here reads a bill to decide.** The open-bill warning is a read the screen shows
//   first (`arrive-checks.ts`), never a refusal: D134 keeps reservations apart from the bill, and a
//   hostess who has seen the warning and tapped again has decided. What *is* refused is a payment
//   on the way (`payment_in_flight`), because ending that sitting would kill a card form or lose
//   the route of a held payment — the same check the closing hour makes (`sittingsWithOpenPayment`).
//
// **Seating asks `holdsSpotNow`, never the booking overlap rule** (`seatConflict`). The two
// disagree on purpose (#336): a party still at its table an hour past the turn time holds its
// spots, while a *booking* for that hour is allowed, because the turn time is a planning
// assumption and not a clock that clears tables.
//
// **The lock order is why every handler here is written as a peek, then the table work, then the
// lock.** `LOCK_RANKS` puts a reservation at the very end, after the sitting, the order row, the
// bill reading and the pauses — exactly so that seating a party can open its table first. A
// handler that locked the reservation first and then ended a sitting would throw `LockOrderError`.
// So each one peeks the party unlocked, decides everything, does the table work, and only then
// locks the party and checks that what it peeked still holds; where it does not, it refuses
// `spots_changed` and the engine's savepoint takes the table work back with it. The party is
// therefore either seated with its codes open or left exactly as it was — never half-seated.

import { logEntries, reservationNights, reservationSpots, reservations, spots } from '@restro/db'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { Id } from '../../ids'
import { STAFF_UNDO_WINDOW_MS } from '../../table-order'
import type { ServiceTx } from '../definition'
import { accepted, type ResultDetails, refused, type ServiceResult } from '../results'
import {
  endSitting,
  newGuests,
  openTableFor,
  sittingsWithOpenPayment,
  tablesAtTheDoor,
} from '../sittings'
import {
  claimSpots,
  createReservation,
  openReservation,
  peekSeatTaken,
  releaseHeldSpots,
  writeHeldSpots,
} from './book'
import {
  nextQueueKey,
  nightWritable,
  type Reservation,
  type ReservationSettings,
  readSettings,
  refuse,
} from './rows'
import {
  isEndStatus,
  moveStatus,
  type ReservationKind,
  type ReservationStatus,
  UNDONE_ARRIVAL_REASON,
  undoArrival,
} from './status'

/** The answer the hostess gave to "are these the same guests?", where there was one to give. */
export type SameGuests = boolean | undefined

/**
 * The claim of a walk-in that has no row yet: it is nobody, so every hold on the spot is somebody
 * else's. The reservation the tap creates afterwards claims the spots itself, under the locks.
 */
const NO_PARTY_YET = 'rv_nobody' as Id<'rv'>

/** What a peek found before anything of the party was locked. */
interface Peek {
  readonly reservation: Reservation
  readonly settings: ReservationSettings
  /**
   * The spots the party will be seated on: the ones asked for, else the ones it holds. Empty where
   * the party has no spot at all — a booking taken without a table, marked present from the list.
   */
  readonly spotIds: readonly string[]
  /** The spots it holds right now, so the lock can tell whether somebody moved it meanwhile. */
  readonly held: readonly string[]
  /** The tables of those spots, our own ids, in id order. A spot that is no table has none. */
  readonly tableIds: readonly string[]
}

/** A peek that found nothing it could work with. */
type PeekResult =
  | { readonly ok: true; readonly peek: Peek }
  | { readonly ok: false; readonly code: string }

/** One reservation of this venue, read without locking it: the start of every handler here. */
async function peekReservation(stx: ServiceTx, reservationId: string): Promise<Reservation | null> {
  const [row] = await stx.tx
    .select()
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.venueId, stx.venueId)))
  return row === undefined || row.deletedAt !== null ? null : row
}

/** The spots a reservation holds, read without locking anything. */
async function peekHeldSpots(stx: ServiceTx, reservationId: string): Promise<string[]> {
  const rows = await stx.tx
    .select({ spotId: reservationSpots.spotId })
    .from(reservationSpots)
    .where(
      and(eq(reservationSpots.reservationId, reservationId), isNull(reservationSpots.releasedAt)),
    )
    .orderBy(reservationSpots.spotId)
  return rows.map((row) => row.spotId)
}

/**
 * Whether the night may be written at all, peeked: the settings and the night's record, read
 * without locking the record (its rank comes after the reservation's, so the lock cannot be taken
 * yet). `openReservation` makes the same check under its locks afterwards and is the authority;
 * this one keeps a handler from opening tables for a night it may not write.
 */
async function peekNight(
  stx: ServiceTx,
  serviceDate: string,
): Promise<
  | { readonly ok: true; readonly settings: ReservationSettings }
  | { readonly ok: false; readonly code: string }
> {
  const settings = await readSettings(stx)
  if (settings === null) return { ok: false, code: 'settings_missing' }
  const [night] = await stx.tx
    .select({ closedAt: reservationNights.closedAt })
    .from(reservationNights)
    .where(
      and(
        eq(reservationNights.venueId, stx.venueId),
        eq(reservationNights.serviceDate, serviceDate),
      ),
    )
  const refusal = nightWritable(stx, serviceDate, settings, night ?? null)
  return refusal === null ? { ok: true, settings } : { ok: false, code: refusal }
}

/**
 * The tables of these spots, in id order; a spot that is not a table (a stool) has none.
 *
 * `allFound` is false when one of the spots asked for is not on this venue's floor at all. The
 * difference matters: a party being *seated* on a spot nobody can find must be refused, because
 * an empty table list reads as "this party has no table" and would seat it with the codes shut
 * and nothing on the screen to say so. Closing is the other way round — a spot taken off the
 * floor has no table left to close — so those paths read `tableIds` on its own.
 */
async function tablesOfSpots(
  stx: ServiceTx,
  spotIds: readonly string[],
): Promise<{ readonly tableIds: string[]; readonly allFound: boolean }> {
  if (spotIds.length === 0) return { tableIds: [], allFound: true }
  const rows = await stx.tx
    .select({ id: spots.id, tableId: spots.tableId })
    .from(spots)
    .where(and(eq(spots.venueId, stx.venueId), isNull(spots.removedAt)))
  const wanted = new Set(spotIds)
  const found = rows.filter((row) => wanted.has(row.id))
  return {
    tableIds: [
      ...new Set(found.flatMap((row) => (row.tableId === null ? [] : [row.tableId]))),
    ].sort(),
    allFound: found.length === wanted.size,
  }
}

/** Peeks everything a seating handler needs: the party, its night, its spots and their tables. */
async function peekParty(
  stx: ServiceTx,
  reservationId: string,
  asked: readonly string[] | undefined,
): Promise<PeekResult> {
  const reservation = await peekReservation(stx, reservationId)
  if (reservation === null) return { ok: false, code: 'reservation_missing' }
  if (reservation.kind === 'block') return { ok: false, code: 'kind_not_allowed' }
  const night = await peekNight(stx, reservation.serviceDate)
  if (!night.ok) return night
  const held = await peekHeldSpots(stx, reservation.id)
  // A party nobody gave a table is marked present all the same: the list's row has the tap too,
  // and with no spot there is no table to open and nothing to claim.
  const spotIds = asked === undefined || asked.length === 0 ? held : asked
  // A spot that is not on this venue's floor is said out loud. Answering "this party has no
  // table" instead would seat the party with its codes shut and nothing on the screen to say so.
  const tables = await tablesOfSpots(stx, spotIds)
  if (!tables.allFound) return { ok: false, code: 'spot_missing' }
  return {
    ok: true,
    peek: {
      reservation,
      settings: night.settings,
      spotIds,
      held,
      tableIds: tables.tableIds,
    },
  }
}

/** Two sets of spot ids, as the verify step compares them: order never matters. */
function sameSpots(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((one) => b.includes(one))
}

/**
 * Pre-claims the rows the table work writes, for **every** table at once and in the fixed order:
 * the order rows, then the bill readings. Ending one sitting claims its pauses last of all
 * (`liftTablePauses`), so without this a second table's order row would be asked for after the
 * first table's pauses and `LockLedger` would throw. The loops that follow therefore walk the
 * tables in id order and claim nothing fresh below the pauses.
 */
async function preClaimTableWork(stx: ServiceTx, tableIds: readonly string[]): Promise<void> {
  if (tableIds.length === 0) return
  const sorted = [...tableIds].sort()
  await stx.rows.tableOrders(sorted)
  stx.rows.claim('bill_reading', sorted)
}

/** What the table work did, as the answer and the Log entry say it. */
interface TableWork {
  /** Tables whose codes this command opened. */
  readonly opened: readonly string[]
  /** Tables whose sitting it ended and opened again ("New guests"). */
  readonly renewed: readonly string[]
  /** Tables that were already open and kept their sitting ("the same guests"). */
  readonly kept: readonly string[]
  /** Tables it closed. */
  readonly closed: readonly string[]
  /** It left the codes alone because the actor may not open or close a table. */
  readonly notAllowed: boolean
}

const noWork: TableWork = { opened: [], renewed: [], kept: [], closed: [], notAllowed: false }

/** The table work's facts as an answer's details, so every path words them the same way. */
function workDetails(work: TableWork): ResultDetails {
  return {
    opened: work.opened.join(','),
    renewed: work.renewed.join(','),
    kept: work.kept.join(','),
    closed: work.closed.join(','),
    tableClosed: work.notAllowed,
  }
}

/** The table work, or the refusal that stopped it before anything was written. */
type TableWorkResult =
  | { readonly ok: true; readonly work: TableWork }
  | { readonly ok: false; readonly code: string; readonly details: ResultDetails }

/**
 * Opens the codes of every table a party is being seated at, which is the whole of what seating
 * does to the floor (D137, log 12.12).
 *
 * A table that is already open is the interesting case, and the answer is the hostess's: `true`
 * keeps its sitting and everything in it, `false` sends ordering's own "New guests", and
 * `undefined` is refused. A table that cannot be opened at all refuses the arrival rather than
 * seating a party whose first order would have nowhere to land.
 *
 * A role without `tables.open_close` seats the party all the same and leaves the codes shut
 * (`notAllowed`), which the screen says in one line (#329): the hostess's work is saying where
 * people sit, and the table is somebody else's tap. Such a role cannot answer "new guests" with a
 * write it may not make, so that answer is refused.
 */
async function openPartyTables(
  stx: ServiceTx,
  tableIds: readonly string[],
  sameGuests: SameGuests,
): Promise<TableWorkResult> {
  if (tableIds.length === 0) return { ok: true, work: noWork }
  const door = await tablesAtTheDoor(stx, tableIds)
  const sorted = [...door.keys()].sort()
  const alreadyOpen = sorted.filter((tableId) => door.get(tableId)?.open != null)
  const toOpen = sorted.filter((tableId) => door.get(tableId)?.open == null)
  // A table nothing can open: the party stays as it was and the screen says to open it from
  // Tonight. Named one at a time, because that is what the hostess has to go and do.
  for (const tableId of toOpen) {
    // `refusal` is null for a table there is nothing wrong with, so the entry is read first: a
    // `??` here would read that null as "no answer" and refuse every table in the house.
    const entry = door.get(tableId)
    const refusal = entry === undefined ? 'table_missing' : entry.refusal
    if (refusal !== null) {
      return { ok: false, code: 'table_not_openable', details: { tableId, reason: refusal } }
    }
  }
  // The question nobody answers for her.
  if (alreadyOpen.length > 0 && sameGuests === undefined) {
    return {
      ok: false,
      code: 'same_guests_unanswered',
      details: { tables: alreadyOpen.join(','), tableId: alreadyOpen[0] ?? null },
    }
  }
  if (!stx.permissions.has('tables.open_close')) {
    if (sameGuests === false) return { ok: false, code: 'permission_denied', details: {} }
    return { ok: true, work: { ...noWork, kept: alreadyOpen, notAllowed: true } }
  }
  await preClaimTableWork(stx, sorted)
  const renewed: string[] = []
  if (sameGuests === false) {
    for (const tableId of alreadyOpen) {
      const result = await newGuests(stx, { tableId })
      if (result.status === 'refused') {
        return { ok: false, code: result.code, details: { ...result.details, tableId } }
      }
      renewed.push(tableId)
    }
  }
  const opened: string[] = []
  for (const tableId of toOpen) {
    const opening = await openTableFor(stx, tableId)
    if (!opening.ok) {
      return { ok: false, code: 'table_not_openable', details: { tableId, reason: opening.code } }
    }
    opened.push(tableId)
  }
  return {
    ok: true,
    work: {
      opened,
      renewed,
      kept: sameGuests === false ? [] : alreadyOpen,
      closed: [],
      notAllowed: false,
    },
  }
}

/**
 * Closes the codes of the tables a party was at: what freeing its spots does to the floor, and
 * what an end status on a party at a table does (#329).
 *
 * A sitting with a payment on the way is **waited for**, not ended: `payment_in_flight`, the same
 * check the closing hour makes (`sittingsWithOpenPayment`, D122), because ending it would kill a
 * card form or lose the route of a held payment. A role without `tables.open_close` frees the
 * spots and leaves the codes open, which the screen says in the same line as the arrival's.
 */
async function closePartyTables(
  stx: ServiceTx,
  tableIds: readonly string[],
): Promise<TableWorkResult> {
  if (tableIds.length === 0) return { ok: true, work: noWork }
  const door = await tablesAtTheDoor(stx, tableIds)
  const sorted = [...door.keys()].sort()
  const open = sorted.flatMap((tableId) => {
    const sitting = door.get(tableId)?.open ?? null
    return sitting === null ? [] : [[tableId, sitting] as const]
  })
  if (open.length === 0) return { ok: true, work: noWork }
  const paying = await sittingsWithOpenPayment(
    stx,
    open.map(([, sitting]) => sitting.id),
  )
  const waiting = open.find(([, sitting]) => paying.has(sitting.id))
  if (waiting !== undefined) {
    return {
      ok: false,
      code: 'payment_in_flight',
      details: { tableId: waiting[0], sittingId: waiting[1].id },
    }
  }
  if (!stx.permissions.has('tables.open_close')) {
    return {
      ok: true,
      work: { ...noWork, kept: open.map(([tableId]) => tableId), notAllowed: true },
    }
  }
  await preClaimTableWork(
    stx,
    open.map(([tableId]) => tableId),
  )
  const closed: string[] = []
  for (const [tableId, sitting] of open) {
    await endSitting(stx, sitting, 'staff_closed')
    closed.push(tableId)
  }
  return { ok: true, work: { ...noWork, closed } }
}

/** What a status move's closing did, and whether the party was at a table when it was peeked. */
export interface EndingClose {
  readonly work: TableWork
  readonly wasSeated: boolean
}

/** A closing done before the party was locked, or the refusal that stopped the move. */
export type EndingCloseResult =
  | { readonly ok: true; readonly close: EndingClose }
  | { readonly ok: false; readonly code: string; readonly details: ResultDetails }

/**
 * Closes the tables of a party that is being marked finished, a no-show or cancelled while it is
 * sitting (`tonight.ts`'s status move). There is one closing path and one payment check, and it
 * runs **before** the party is locked, because the sitting's rank comes long before the
 * reservation's; `wasSeated` lets the move refuse `spots_changed` where the lock then disagrees
 * with what was peeked.
 */
export async function closeTablesForEnding(
  stx: ServiceTx,
  reservationId: string,
  to: ReservationStatus,
): Promise<EndingCloseResult> {
  const quiet = { ok: true, close: { work: noWork, wasSeated: false } } as const
  if (!isEndStatus(to)) return quiet
  const reservation = await peekReservation(stx, reservationId)
  if (reservation === null || (reservation.status as ReservationStatus) !== 'seated') return quiet
  const held = await peekHeldSpots(stx, reservation.id)
  const work = await closePartyTables(stx, (await tablesOfSpots(stx, held)).tableIds)
  if (!work.ok) return work
  return { ok: true, close: { work: work.work, wasSeated: true } }
}

/** The facts of a closing as a status move's details, worded the way every path here words them. */
export function tableWorkDetails(work: TableWork): ResultDetails {
  return workDetails(work)
}

/** What "Arrived" carries: the spots she tapped, an end time, the count, and her answer. */
export interface ArriveCommand {
  readonly reservationId: string
  /**
   * The spots to seat the party on. Left out, the ones it already holds — so marking a booking
   * present on another table is **one** gesture on the plan (#329), not Change tables and then
   * Arrived.
   */
  readonly spotIds?: readonly string[]
  /**
   * The hour the party must be off the spot, for early seating: a spot somebody has booked later
   * tonight is given to the people at the door until that hour, and the spot frees itself for the
   * booking. Left out, the reservation keeps the end it had (usually none).
   */
  readonly endsAt?: string | null
  /** The count, when she chose to record it at the door. Left out, whatever the booking said. */
  readonly partySize?: number
  /** Her answer to "are these the same guests?", where a table of the party is already open. */
  readonly sameGuests?: boolean
}

/**
 * Marks a party present and opens its tables: one tap on the list's row or on the spot's sheet.
 *
 * The spots are claimed again at the moment of seating, by `seatConflict` and not by the booking
 * rule, so a party can never be put on a spot somebody is on — and a party may be seated on a spot
 * booked later tonight, with `endsAt` at the hour the booking holds it from.
 */
export async function arriveReservation(
  stx: ServiceTx,
  command: ArriveCommand,
): Promise<ServiceResult> {
  const peeked = await peekParty(stx, command.reservationId, command.spotIds)
  if (!peeked.ok) return refuse(peeked.code)
  const { peek } = peeked
  // A party already at a table: the tap is a repeat, and a repeat changes nothing (idempotency
  // `by_nature`). Nothing of the floor is touched, so a second Arrived never renews a sitting.
  if ((peek.reservation.status as ReservationStatus) === 'seated') {
    return accepted(null, {
      details: { reservationId: peek.reservation.id, status: 'seated', changed: false },
    })
  }
  const early = moveStatus(peek.reservation.status as ReservationStatus, 'seated')
  if (!early.ok) return refuse(early.code)

  const work = await openPartyTables(stx, peek.tableIds, command.sameGuests)
  if (!work.ok) return refused(null, work.code, work.details)

  const open = await openReservation(stx, peek.reservation.id)
  if (!open.ok) return refuse(open.code)
  const { reservation, night } = open
  const move = moveStatus(reservation.status as ReservationStatus, 'seated')
  if (!move.ok) return refuse(move.code)
  // Somebody worked the party between the peek and the lock: its spots are not the ones whose
  // tables were just opened, so nothing is written and the screen reads the night again.
  if (
    command.spotIds === undefined &&
    !sameSpots(peek.held, await peekHeldSpots(stx, reservation.id))
  ) {
    return refuse('spots_changed')
  }
  const endsAt = command.endsAt === undefined ? reservation.endsAt : parseEnd(command.endsAt)
  const grant = await claimSpots(
    stx,
    {
      reservationId: reservation.id,
      spotIds: peek.spotIds,
      serviceDate: reservation.serviceDate,
      startsAt: stx.now,
      endsAt,
      turnMinutes: reservation.turnMinutes,
    },
    night.settings.turnMinutes,
    { seatingAt: stx.now },
  )
  if (!grant.ok) return refused(null, grant.code, { ...grant.details })
  // The booking's own hold ran from the hour it was booked for; the seating's runs from now. The
  // old rows are released first, exactly as an edit does it, so the party holds each spot once —
  // otherwise a party seated early would hold its table to the end of a turn counted from the
  // booked hour as well as to the hour the hostess gave it.
  await releaseHeldSpots(stx, reservation.id)
  await writeHeldSpots(stx, reservation.id, peek.spotIds, grant.stretch, endsAt !== null)
  await stx.tx
    .update(reservations)
    .set({
      status: 'seated',
      queueKey: null,
      seatedAt: reservation.seatedAt ?? stx.now,
      endsAt,
      partySize: command.partySize ?? reservation.partySize,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  const details: ResultDetails = {
    reservationId: reservation.id,
    spots: peek.spotIds.join(','),
    ...workDetails(work.work),
    sameGuests: command.sameGuests ?? null,
  }
  await stx.log({
    kind: 'reservation.status',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    fromState: reservation.status,
    toState: 'seated',
    details,
  })
  return accepted(null, { details: { ...details, status: 'seated', changed: true } })
}

/** An end time a command carries: null stays null, a string is its instant. */
function parseEnd(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

/** What seating a walk-in carries: the spots, who they are if anybody asked, and her answer. */
export interface SeatWalkInCommand {
  readonly serviceDate: string
  readonly spotIds: readonly string[]
  readonly partySize: number
  readonly endsAt?: string | null
  readonly note?: string | null
  readonly sameGuests?: boolean
  readonly guestId?: string
  readonly phone?: string
  readonly guestName?: string
  readonly partyLabel?: string
}

/**
 * Seats people who walked in, straight off the plan: two taps (the free spot, "Seat a walk-in"),
 * no name needed, no date and no hour to fill in — a walk-in is here now.
 *
 * It is a reservation of the walk-in kind created already Seated, so the night's list, the plan,
 * the statuses and the overlap rule are the same ones as everywhere; `createReservation` claims the
 * spots by the seat rule because the status it is given is Seated.
 */
export async function seatWalkIn(
  stx: ServiceTx,
  command: SeatWalkInCommand,
): Promise<ServiceResult> {
  const night = await peekNight(stx, command.serviceDate)
  if (!night.ok) return refuse(night.code)
  if (command.spotIds.length === 0) return refuse('spot_missing')
  const tables = await tablesOfSpots(stx, command.spotIds)
  if (!tables.allFound) return refuse('spot_missing')
  // Who is sitting there comes before anything about the table. The spot of a party still at it
  // is a spot nobody else can be put on, so the hostess is told whose it is rather than asked
  // whether the people she is holding the door for are the same guests.
  const taken = await peekSeatTaken(
    stx,
    { reservationId: NO_PARTY_YET, spotIds: command.spotIds as readonly Id<'sp'>[] },
    command.serviceDate,
    night.settings.turnMinutes,
    stx.now,
  )
  if (taken !== null) {
    return refused(null, 'spot_taken', {
      spotId: taken.spotId,
      reservationId: taken.reservationId,
    })
  }
  const work = await openPartyTables(stx, tables.tableIds, command.sameGuests)
  if (!work.ok) return refused(null, work.code, work.details)
  const created = await createReservation(stx, {
    openedTables: work.work.opened,
    serviceDate: command.serviceDate,
    // A walk-in's hour is the moment it was seated: it was never expected at another one.
    startsAt: stx.now.toISOString(),
    endsAt: command.endsAt ?? null,
    kind: 'walk_in',
    status: 'seated',
    partySize: command.partySize,
    spotIds: command.spotIds,
    note: command.note ?? null,
    guestId: command.guestId,
    phone: command.phone,
    guestName: command.guestName,
    partyLabel: command.partyLabel,
  })
  if (created.status === 'refused') return created
  return accepted(null, {
    details: {
      ...created.details,
      ...workDetails(work.work),
      sameGuests: command.sameGuests ?? null,
      status: 'seated',
    },
  })
}

/**
 * Changes how many are in the party: the rest of a party arriving later, or more people than were
 * booked. **This is not "New guests"** (#329): the sitting stands, the order survives, no code is
 * touched, and the only thing that changes is the number — which is why it is a command of its own
 * and not an arrival with a count.
 *
 * More guests than the spots seat is a warning the screen shows (`booking-checks.ts`), never a
 * refusal (D134): nothing here counts seats.
 */
export async function setGuestCount(
  stx: ServiceTx,
  command: { readonly reservationId: string; readonly partySize: number },
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  // A block is nobody at a table, so it carries no count (the column's own check says so too).
  if (reservation.kind === 'block') return refuse('kind_not_allowed')
  if (isEndStatus(reservation.status as ReservationStatus)) return refuse('status_move_not_allowed')
  if (reservation.partySize === command.partySize) {
    return accepted(null, {
      details: { reservationId: reservation.id, partySize: command.partySize, changed: false },
    })
  }
  await stx.tx
    .update(reservations)
    .set({ partySize: command.partySize, ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(reservations.id, reservation.id))
  await stx.log({
    kind: 'reservation.changed',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    toState: reservation.status,
    reason: 'guests_changed',
    details: { partySize: command.partySize, wasPartySize: reservation.partySize },
  })
  return accepted(null, {
    details: { reservationId: reservation.id, partySize: command.partySize, changed: true },
  })
}

/** The arrival this party's codes were opened by: its Log entry, with what it opened. */
interface Arrival {
  readonly seq: number
  readonly at: Date
  readonly cameFrom: ReservationStatus | null
  /** The tables the arrival itself opened, as its own details recorded them. */
  readonly opened: readonly string[]
}

/**
 * The newest arrival of a reservation, out of the one Log (D141): the entry that moved it to
 * Seated. Where it came from is read here and nowhere else — there is no second copy on the row
 * that could disagree with it — and so is the list of tables that arrival opened, so the undo
 * closes exactly those and never a table a waiter had open before the party sat down.
 */
async function lastArrival(stx: ServiceTx, reservationId: string): Promise<Arrival | null> {
  const [entry] = await stx.tx
    .select({
      seq: logEntries.seq,
      at: logEntries.at,
      fromState: logEntries.fromState,
      details: logEntries.details,
    })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.venueId, stx.venueId),
        eq(logEntries.reservationId, reservationId),
        // A walk-in the seat tap made has no status move: it was *created* Seated, and that
        // entry is its arrival — the one the undo reads its hour and its tables from.
        inArray(logEntries.kind, ['reservation.status', 'reservation.created']),
        eq(logEntries.toState, 'seated'),
      ),
    )
    .orderBy(desc(logEntries.seq))
    .limit(1)
  if (entry === undefined) return null
  const opened = entry.details.opened
  return {
    seq: entry.seq,
    at: entry.at,
    cameFrom: (entry.fromState as ReservationStatus | null) ?? null,
    opened: typeof opened === 'string' && opened !== '' ? opened.split(',') : [],
  }
}

/**
 * Undoes an arrival: a party marked present by mistake goes back where it came from, and the codes
 * that arrival opened close again.
 *
 * The status is `undoArrival`'s decision and nothing else's (`status.ts`): a booking back to
 * Reserved, a walk-in taken off the queue back to Waiting, and a walk-in the seat tap itself
 * created to Cancelled with the reason `arrival_undone` — it was never on the waiting list, and the
 * row is not deleted. A pair that cannot have happened is refused rather than guessed at.
 *
 * The window is this command's own: Tonight offers the undo for thirty seconds
 * (`STAFF_UNDO_WINDOW_MS`), and an undo that arrives later is **refused** `undo_expired` rather
 * than quietly done — by then a phone at the table may have been scanning for half a minute.
 */
export async function undoReservationArrival(
  stx: ServiceTx,
  command: { readonly reservationId: string },
): Promise<ServiceResult> {
  const peeked = await peekParty(stx, command.reservationId, undefined)
  if (!peeked.ok) return refuse(peeked.code)
  const { peek } = peeked
  const arrival = await lastArrival(stx, peek.reservation.id)
  if (arrival === null) return refuse('undo_arrival_not_allowed')
  const now = await stx.dbNow()
  if (now.getTime() - arrival.at.getTime() > STAFF_UNDO_WINDOW_MS) return refuse('undo_expired')
  // Only the tables this arrival opened: one a waiter had open before the party sat down is his,
  // and the undo of a write never closes what that write did not open.
  const mine = peek.tableIds.filter((tableId) => arrival.opened.includes(tableId))
  const work = await closePartyTables(stx, mine)
  if (!work.ok) return refused(null, work.code, work.details)

  const open = await openReservation(stx, peek.reservation.id)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  const move = undoArrival(
    reservation.status as ReservationStatus,
    reservation.kind as ReservationKind,
    arrival.cameFrom,
  )
  if (!move.ok) return refuse(move.code)
  const to = move.status
  const freed = await releaseHeldSpots(stx, reservation.id)
  await stx.tx
    .update(reservations)
    .set({
      status: to,
      seatedAt: null,
      endedAt: isEndStatus(to) ? sql`now()` : null,
      queueKey: to === 'waiting' ? await nextQueueKey(stx, reservation.serviceDate) : null,
      reason: UNDONE_ARRIVAL_REASON,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  await stx.log({
    kind: 'reservation.status',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    fromState: reservation.status,
    toState: to,
    reason: UNDONE_ARRIVAL_REASON,
    details: { freed: freed.join(','), cameFrom: arrival.cameFrom, ...workDetails(work.work) },
  })
  return accepted(null, {
    details: { reservationId: reservation.id, status: to, ...workDetails(work.work) },
  })
}

/**
 * Gives a reservation spots to hold, beside the ones it already holds — and, where the party is
 * already at a table, opens the codes of the new one (#329: changing a party's spots runs the same
 * table work as arriving, so its next order cannot land on somebody else's bill).
 *
 * For a party still expected, nothing of the floor is touched: its table opens when it arrives.
 */
export async function holdReservationSpots(
  stx: ServiceTx,
  command: {
    readonly reservationId: string
    readonly spotIds: readonly string[]
    readonly sameGuests?: boolean
  },
): Promise<ServiceResult> {
  const peeked = await peekParty(stx, command.reservationId, command.spotIds)
  if (!peeked.ok) return refuse(peeked.code)
  const { peek } = peeked
  const was = peek.reservation.status as ReservationStatus
  if (isEndStatus(was)) return refuse('status_move_not_allowed')
  const seated = was === 'seated'
  const work = seated
    ? await openPartyTables(stx, peek.tableIds, command.sameGuests)
    : ({ ok: true, work: noWork } as const)
  if (!work.ok) return refused(null, work.code, work.details)

  const open = await openReservation(stx, peek.reservation.id)
  if (!open.ok) return refuse(open.code)
  const { reservation, night } = open
  if ((reservation.status as ReservationStatus) !== was) return refuse('spots_changed')
  const grant = await claimSpots(
    stx,
    {
      reservationId: reservation.id,
      spotIds: command.spotIds,
      serviceDate: reservation.serviceDate,
      startsAt: reservation.seatedAt ?? reservation.startsAt,
      endsAt: reservation.endsAt,
      turnMinutes: reservation.turnMinutes,
    },
    night.settings.turnMinutes,
    // A party at a table is being seated onto the new spot, so the seat rule decides it; one still
    // expected is being booked onto it, so the booking rule does.
    seated ? { seatingAt: stx.now } : {},
  )
  if (!grant.ok) return refused(null, grant.code, { ...grant.details })
  // Only the spots being claimed: this command adds a spot to a party, so the ones it already
  // holds elsewhere stay held. An older row for one of these is released, never doubled.
  await releaseHeldSpots(stx, reservation.id, command.spotIds)
  await writeHeldSpots(
    stx,
    reservation.id,
    command.spotIds,
    grant.stretch,
    reservation.endsAt !== null,
  )
  // The spots a booking holds are part of its version (#328), and the held rows carry that write;
  // the row itself is touched too, so a form open elsewhere cannot save over this.
  await stx.tx
    .update(reservations)
    .set({ ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(reservations.id, reservation.id))
  const details: ResultDetails = {
    reservationId: reservation.id,
    spots: command.spotIds.join(','),
    ...workDetails(work.work),
  }
  await stx.log({
    kind: 'reservation.spots',
    reservationId: reservation.id,
    toState: 'held',
    details,
  })
  return accepted(null, { details })
}

/**
 * `reservation.release_spots`, the door's **"Free"**: the party has gone, so the spots it holds go
 * back to the plan and the codes of their Tables close, because a phone at a freed table must not
 * put another round on that bill (#329). A table whose payment is on the way is refused
 * `payment_in_flight`, the same check the closing hour makes.
 *
 * **It does not end the party** (#327, D134, D136): the row keeps its status and its hours, and
 * what ends a night is the night's close or a status move of its own. So the inverse the toast
 * offers is `reservation.hold_spots` with the spots just freed, which claims them again and opens
 * the codes again — a new sitting, since the one the guests left was ended here.
 */
export async function releaseReservationSpots(
  stx: ServiceTx,
  command: { readonly reservationId: string; readonly spotIds?: readonly string[] },
): Promise<ServiceResult> {
  const reservation0 = await peekReservation(stx, command.reservationId)
  if (reservation0 === null) return refuse('reservation_missing')
  const held = await peekHeldSpots(stx, reservation0.id)
  const freeing =
    command.spotIds === undefined ? held : held.filter((id) => command.spotIds?.includes(id))
  // The codes close before the party is locked: a sitting's rank comes long before a
  // reservation's, so the other way round would throw `LockOrderError` (`lock-order.ts`).
  const work = await closePartyTables(stx, (await tablesOfSpots(stx, freeing)).tableIds)
  if (!work.ok) return refused(null, work.code, work.details)

  const open = await openReservation(stx, reservation0.id)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  // Somebody worked the party between the peek and the lock, so the tables just closed are not the
  // ones this would be freeing. Nothing is written and the savepoint takes the closing back.
  if (!sameSpots(held, await peekHeldSpots(stx, reservation.id))) return refuse('spots_changed')
  const freed = await releaseHeldSpots(stx, reservation.id, command.spotIds)
  // The spots a party holds are part of its version (#328), so the row is touched too: a form open
  // elsewhere cannot save over this.
  await stx.tx
    .update(reservations)
    .set({ ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(reservations.id, reservation.id))
  const details: ResultDetails = {
    reservationId: reservation.id,
    spots: freed.join(','),
    ...workDetails(work.work),
  }
  await stx.log({
    kind: 'reservation.spots',
    reservationId: reservation.id,
    toState: 'released',
    details,
  })
  return accepted(null, { details })
}
