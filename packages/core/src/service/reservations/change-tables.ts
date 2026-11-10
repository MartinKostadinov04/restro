// Change tables (ticket #331; D137, D110, D122 §4, §9): the hostess taps a party's spots on and
// off and saves, and the party's spots are what she saw. One command for every case the MVP had a
// screen for — add a spot, take one back, move the party, swap two parties — because each is the
// same thing said about a set of spots: "this party now sits *here*".
//
// **The codes follow the spots, through the door's own paths** (#329). A party that is sitting has
// its tables open for phones; after the change, the tables it left are closed with
// `closePartyTables` and the tables it came to are opened with `openPartyTables`, the two helpers
// the arrival and "Free" already use, which in turn call `openTableFor`, `newGuests` and
// `endSitting` in `sittings.ts`. There is no third way to open or close a table here. A party that
// is still expected has no table open, so its spots change and no code moves.
//
// **A reservation move is not a bill move** (D137, log 4.22). Closing the old table ends Restro's
// sitting there; whatever the POS holds on that table stays on it, and only staff at the till can
// move it (D110). So no POS is called (nothing in this folder can, rule 7) and nothing pretends to
// move a bill: the answer says which tables were left with a bill (`billLeft`), the screen says
// "the bill stays on that spot, move it at the till", and the Log keeps that the party changed
// tables while a bill was open (`toState: 'moved_bill'`).
//
// **The swap is one write.** Two parties trading spots on a full floor cannot do it in two saves,
// because the first would need a free spot in between. Here both parties' spots are released
// first and claimed after, inside one transaction, so neither is ever in the other's way; the
// claims are still judged by the usual rules against everybody else, by the seat rule for a party
// that is sitting and by the booking rule for one still expected (`claimSpots`).
//
// **The lock order is the door's** (`arrive.ts`'s header): peek both parties, then all of the
// table work, then lock the parties and check that what was peeked still holds. Closing and opening
// in one command touches several tables' pauses, so every row of the table work — the sittings,
// the order rows, the bill readings and the pauses — is claimed for **all** the tables at once,
// before any table is closed; each later claim is then one the ledger already holds. Where the
// lock disagrees with the peek, the command refuses `spots_changed` and the savepoint takes the
// table work back: the party is never half-moved.
//
// **The pay rule stays coherent by construction** (#334, `pay-rule.ts`): a rule is in force at a
// table while the party holds a spot of it written at or after the sitting opened. The spots a
// party keeps are not touched, so their tables keep the rule; the spots it gains are written in
// this transaction, after their tables were opened in it, so the rule follows the party to its new
// table; and the tables it left are closed, so the rule ends there with their sitting.

import { pauses, reservationSpots, reservations, spots } from '@restro/db'
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'

import type { ServiceTx } from '../definition'
import { accepted, type ResultDetails, refused, type ServiceResult } from '../results'
import { tablesAtTheDoor } from '../sittings'
import {
  closePartyTables,
  openPartyTables,
  peekHeldSpots,
  peekNight,
  peekReservation,
  preClaimTableWork,
  type SameGuests,
  sameSpots,
  type TableWork,
  tablesOfSpots,
  workDetails,
} from './arrive'
import { openTables } from './arrive-checks'
import { claimSpots, releaseHeldSpots, writeHeldSpots } from './book'
import { lockReservation, openNight, type Reservation, refuse } from './rows'
import { isEndStatus, type ReservationStatus } from './status'

/** One party's side of the change: the spots the screen saw, and the spots it is to end on. */
export interface PartyChange {
  readonly reservationId: string
  /** What the screen read the party as holding; anything else held now is somebody's newer work. */
  readonly from: readonly string[]
  /** The spots the party is to hold after the save. Empty takes every spot back. */
  readonly spotIds: readonly string[]
}

/** `reservation.change_tables`: the party's spots, and in a swap the other party's too. */
export interface ChangeTablesCommand extends PartyChange {
  /** The other party of a swap, with the spots it is to end on. */
  readonly swap?: PartyChange | undefined
  /** The answer to "are these the same guests?" for a table being added that is already open. */
  readonly sameGuests?: SameGuests
}

/** One party as the peek found it, and what the change does to it. */
interface Side {
  readonly change: PartyChange
  readonly reservation: Reservation
  readonly seated: boolean
  readonly added: readonly string[]
  readonly removed: readonly string[]
  /** Tables whose codes close: the tables of the spots it leaves, less the ones it stays at. */
  readonly closing: readonly string[]
  /** Tables whose codes open: the tables of the spots it ends on, less the ones it was at. */
  readonly opening: readonly string[]
}

/** A peeked side, or the refusal that stopped the change before anything was written. */
type SideResult =
  | { readonly ok: true; readonly side: Side }
  | { readonly ok: false; readonly code: string; readonly details: ResultDetails }

const unique = (ids: readonly string[]): string[] => [...new Set(ids)].sort()
const minus = (a: readonly string[], b: readonly string[]): string[] =>
  a.filter((id) => !b.includes(id))

/** Peeks one party: unlocked, as every door handler starts (`arrive.ts`). */
async function peekSide(stx: ServiceTx, change: PartyChange): Promise<SideResult> {
  const reservation = await peekReservation(stx, change.reservationId)
  if (reservation === null) return { ok: false, code: 'reservation_missing', details: {} }
  // A block is the club's own hold on a spot, unblocked on its own screen; it never changes tables.
  if (reservation.kind === 'block') return { ok: false, code: 'kind_not_allowed', details: {} }
  const status = reservation.status as ReservationStatus
  if (isEndStatus(status)) return { ok: false, code: 'status_move_not_allowed', details: {} }
  const held = await peekHeldSpots(stx, reservation.id)
  const target = unique(change.spotIds)
  // The screen was drawn over spots that are no longer the party's: somebody else worked it.
  if (!sameSpots(held, unique(change.from))) {
    return { ok: false, code: 'spots_changed', details: { reservationId: reservation.id } }
  }
  const added = minus(target, held)
  const removed = minus(held, target)
  const seated = status === 'seated'
  if (!seated) {
    return {
      ok: true,
      side: { change, reservation, seated, added, removed, closing: [], opening: [] },
    }
  }
  const before = await tablesOfSpots(stx, held)
  const after = await tablesOfSpots(stx, target)
  // A spot nobody can find would read as "no table" and leave the party sitting with its codes
  // shut, so it is said out loud, as the arrival says it.
  if (!after.allFound) return { ok: false, code: 'spot_missing', details: {} }
  return {
    ok: true,
    side: {
      change,
      reservation,
      seated,
      added,
      removed,
      closing: minus(before.tableIds, after.tableIds),
      opening: minus(after.tableIds, before.tableIds),
    },
  }
}

/**
 * The tables among these that another party still sits at, through a spot it keeps: their codes
 * stay open, because closing them would end that party's sitting too.
 */
async function tablesOthersSitAt(
  stx: ServiceTx,
  tableIds: readonly string[],
  parties: readonly string[],
): Promise<Set<string>> {
  if (tableIds.length === 0) return new Set()
  const rows = await stx.tx
    .select({ tableId: spots.tableId })
    .from(reservationSpots)
    .innerJoin(spots, eq(spots.id, reservationSpots.spotId))
    .innerJoin(reservations, eq(reservations.id, reservationSpots.reservationId))
    .where(
      and(
        eq(spots.venueId, stx.venueId),
        inArray(spots.tableId, [...tableIds]),
        isNull(reservationSpots.releasedAt),
        isNull(reservations.deletedAt),
        eq(reservations.status, 'seated'),
        notInArray(reservations.id, [...parties]),
      ),
    )
  return new Set(rows.flatMap((row) => (row.tableId === null ? [] : [row.tableId])))
}

/**
 * Locks every pause of these tables, in key order, before any of them is closed. Ending a sitting
 * lifts its table's pauses (`liftTablePauses`), and a change that closes one table and renews
 * another would otherwise claim a later table's pauses before an earlier one's.
 */
async function preClaimPauses(stx: ServiceTx, tableIds: readonly string[]): Promise<void> {
  if (tableIds.length === 0) return
  const found = await stx.tx
    .select({ targetId: pauses.targetId, cause: pauses.cause })
    .from(pauses)
    .where(
      and(
        eq(pauses.scope, 'table'),
        inArray(pauses.targetId, [...tableIds]),
        isNull(pauses.liftedAt),
      ),
    )
  if (found.length === 0) return
  const fresh = stx.rows.claim(
    'pause',
    found.map((row) => `table:${row.targetId}:${row.cause}`),
  )
  if (fresh.length === 0) return
  await stx.tx
    .select({ id: pauses.id })
    .from(pauses)
    .where(
      and(
        eq(pauses.scope, 'table'),
        inArray(pauses.targetId, [...tableIds]),
        isNull(pauses.liftedAt),
      ),
    )
    .orderBy(pauses.targetId, pauses.cause)
    .for('update')
}

/** Two table works as one, for the answer when both parties of a swap had codes to move. */
function bothWorks(a: TableWork, b: TableWork): TableWork {
  return {
    opened: unique([...a.opened, ...b.opened]),
    renewed: unique([...a.renewed, ...b.renewed]),
    kept: unique([...a.kept, ...b.kept]),
    closed: unique([...a.closed, ...b.closed]),
    notAllowed: a.notAllowed || b.notAllowed,
  }
}

/** `reservation.change_tables` (#331): one save of a party's spots, or of two parties' in a swap. */
export async function changeTables(
  stx: ServiceTx,
  command: ChangeTablesCommand,
): Promise<ServiceResult> {
  const swap = command.swap
  if (swap !== undefined) {
    // A party is no swap partner of itself; the screen never sends it.
    if (swap.reservationId === command.reservationId) return refuse('kind_not_allowed')
    // Two parties cannot end on the same spot: that is no swap, and the claims would refuse it
    // anyway, by the name of the party saving second.
    if (command.spotIds.some((id) => swap.spotIds.includes(id))) return refuse('spot_taken')
  }
  const first = await peekSide(stx, command)
  const second = swap === undefined ? null : await peekSide(stx, swap)
  // A repeat of a save that went through finds both parties already where it was to put them.
  if (!first.ok && first.code === 'spots_changed') {
    const settled = await alreadyDone(stx, command)
    if (settled) return accepted(null, { details: { changed: false } })
  }
  if (!first.ok) return refused(null, first.code, first.details)
  if (second !== null && !second.ok) {
    if (second.code === 'spots_changed' && (await alreadyDone(stx, command))) {
      return accepted(null, { details: { changed: false } })
    }
    return refused(null, second.code, second.details)
  }
  const sides = second === null ? [first.side] : [first.side, second.side]
  // Saved with nothing changed: there is nothing to write, and nothing for the Log to say.
  if (sides.every((side) => side.added.length === 0 && side.removed.length === 0)) {
    return accepted(null, { details: { changed: false } })
  }
  const parties = sides.map((side) => side.reservation.id)
  const night = await peekNight(stx, first.side.reservation.serviceDate)
  if (!night.ok) return refuse(night.code)
  if (sides.some((side) => side.reservation.serviceDate !== first.side.reservation.serviceDate)) {
    return refuse('spots_changed')
  }

  // The table work, before either party is locked (`lock-order.ts`).
  const closingAll = unique(sides.flatMap((side) => side.closing))
  const keptOpen = await tablesOthersSitAt(stx, closingAll, parties)
  const closing = closingAll.filter((tableId) => !keptOpen.has(tableId))
  const opening = unique(sides.flatMap((side) => side.opening))
  const touched = unique([...closing, ...opening])
  // Every row the closing and the opening write, claimed for every table at once and in order.
  await tablesAtTheDoor(stx, touched)
  await preClaimTableWork(stx, touched)
  await preClaimPauses(stx, touched)
  // Whether the tables being left have something on their bill, read before their sitting ends:
  // that bill stays at the POS, where only staff can move it.
  const bills = await openTables(stx.tx, stx.venueId, closing)
  const billLeft = closing.filter((tableId) => bills.get(tableId)?.bill === true)
  const closed = await closePartyTables(stx, closing)
  if (!closed.ok) return refused(null, closed.code, closed.details)
  let work: TableWork = closed.work
  for (const side of sides) {
    if (side.opening.length === 0) continue
    const opened = await openPartyTables(stx, side.opening, command.sameGuests)
    if (!opened.ok) return refused(null, opened.code, opened.details)
    work = bothWorks(work, opened.work)
  }

  // Now the parties, in id order, and the night after them.
  const locked = new Map<string, Reservation>()
  for (const id of unique(parties)) {
    const row = await lockReservation(stx, id)
    if (row === null || row.deletedAt !== null) return refuse('reservation_missing')
    locked.set(id, row)
  }
  const open = await openNight(stx, first.side.reservation.serviceDate)
  if (!open.ok) return refuse(open.code)
  for (const side of sides) {
    const row = locked.get(side.reservation.id)
    if (row === undefined || row.status !== side.reservation.status) return refuse('spots_changed')
    if (!sameSpots(await peekHeldSpots(stx, row.id), unique(side.change.from))) {
      return refuse('spots_changed')
    }
  }

  // Every spot that is leaving goes first, so the two parties of a swap are never in each other's
  // way; only then are the new ones claimed, against everybody else.
  for (const side of sides) {
    if (side.removed.length > 0) await releaseHeldSpots(stx, side.reservation.id, side.removed)
  }
  for (const side of sides) {
    if (side.added.length === 0) continue
    const row = locked.get(side.reservation.id) as Reservation
    const grant = await claimSpots(
      stx,
      {
        reservationId: row.id,
        spotIds: side.added,
        serviceDate: row.serviceDate,
        startsAt: row.seatedAt ?? row.startsAt,
        endsAt: row.endsAt,
        turnMinutes: row.turnMinutes,
      },
      open.settings.turnMinutes,
      side.seated ? { seatingAt: stx.now } : {},
    )
    if (!grant.ok) return refused(null, grant.code, { ...grant.details })
    // The spots it keeps are left alone: their rows are what holds the pay rule at their tables.
    await writeHeldSpots(stx, row.id, side.added, grant.stretch, row.endsAt !== null)
  }

  const billTables = billLeft.join(',')
  const details: ResultDetails = {
    reservationId: command.reservationId,
    changed: true,
    swapWith: swap?.reservationId ?? null,
    billLeft: billTables,
    ...workDetails(work),
  }
  for (const side of sides) {
    // The spots a party holds are part of its version (#328): a form open elsewhere cannot save
    // over this.
    await stx.tx
      .update(reservations)
      .set({ ...stx.provenance, updatedAt: sql`now()` })
      .where(eq(reservations.id, side.reservation.id))
    const left = side.seated
      ? (await tablesOfSpots(stx, side.removed)).tableIds.filter((id) => billLeft.includes(id))
      : []
    await stx.log({
      kind: 'reservation.spots',
      reservationId: side.reservation.id,
      toState: left.length > 0 ? 'moved_bill' : 'moved',
      details: {
        spots: unique(side.change.spotIds).join(','),
        added: side.added.join(','),
        removed: side.removed.join(','),
        swapWith: sides.find((other) => other !== side)?.reservation.id ?? null,
        billLeft: left.join(','),
        ...workDetails(work),
      },
    })
  }
  return accepted(null, { details })
}

/** True when every party of the change already holds exactly the spots it was to end on. */
async function alreadyDone(stx: ServiceTx, command: ChangeTablesCommand): Promise<boolean> {
  const changes = command.swap === undefined ? [command] : [command, command.swap]
  for (const change of changes) {
    const held = await peekHeldSpots(stx, change.reservationId)
    if (!sameSpots(held, unique(change.spotIds))) return false
  }
  return true
}
