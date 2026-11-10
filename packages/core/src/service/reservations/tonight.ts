// Tonight's floor (ticket #323; D134, D135, D137, D138, D140, D141): the status moves, the spots a
// party holds, the waiting list and the blocks. `reservations.tonight` for the hostess's taps,
// `reservations.block` for a block — a tap, never a settings change, so a PIN on a shared device
// reaches them (D141).
//
// **The bill is still not here** (D134, log 1.44): nothing in this module reads a bill, a payment
// or a sent order, and a POS bill closing changes nothing. A party whose bill closed stays Seated
// and keeps its spots held until the night ends, unless its own end time says otherwise or staff
// free them — which is why `holdsSpotNow` and not a sitting is what the floor plan reads.
//
// What the module does now touch, through `arrive.ts` and nothing else, is the table **code**: a
// party marked finished, a no-show or called off while it sits has its tables closed, because the
// phones at a table whose party has gone must not keep ordering onto its bill (#329). The door
// itself — Arrived, a walk-in, more guests, the undo, holding and freeing spots — lives in
// `arrive.ts`, which is where the open path ordering already uses is reached from.

import { reservations } from '@restro/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { sortKeyBetween } from '../../sort-keys'
import type { ServiceTx } from '../definition'
import { accepted, refused, type ServiceResult } from '../results'
import { closeTablesForEnding, tableWorkDetails } from './arrive'
import {
  cancelReservation,
  claimSpots,
  createReservation,
  openReservation,
  releaseHeldSpots,
  writeHeldSpots,
} from './book'
import { lockReservation, nextQueueKey, refuse, spotsOfReservation } from './rows'
import { isEndStatus, moveStatus, putBack, type ReservationStatus } from './status'

/**
 * Moves a reservation to another status (D135's machine). The move itself is the rule module's
 * (`moveStatus`), so a move the machine does not allow is refused `status_move_not_allowed` and
 * never written halfway.
 *
 * **Seating is not one of its moves**: marking a party present opens its table's codes, so it is
 * `reservation.arrive`'s own command (`arrive.ts`) and asking for Seated here is refused. An end
 * status frees the party's spots, closes the codes of the tables it was at, and stamps the end;
 * leaving the waiting list drops the queue key.
 */
export async function setReservationStatus(
  stx: ServiceTx,
  command: {
    readonly reservationId: string
    readonly status: ReservationStatus
    readonly reason?: string | null
  },
): Promise<ServiceResult> {
  // Seating has a command of its own because it opens a table; there is no second seat path here.
  if (command.status === 'seated') return refuse('invalid_command')
  // The codes close before the party is locked: a sitting's rank comes long before a
  // reservation's, so the other way round would throw `LockOrderError` (`lock-order.ts`).
  const closing = await closeTablesForEnding(stx, command.reservationId, command.status)
  if (!closing.ok) return refused(null, closing.code, closing.details)
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  const from = reservation.status as ReservationStatus
  // Somebody moved the party between the peek and the lock, so what was closed is not what this
  // move would be ending. Nothing is written and the savepoint takes the closing back with it.
  if (closing.close.wasSeated && from !== 'seated') return refuse('spots_changed')
  if (from === command.status) {
    return accepted(null, {
      details: { reservationId: reservation.id, status: from, changed: false },
    })
  }
  const move = moveStatus(from, command.status)
  if (!move.ok) return refuse(move.code)
  const to = move.status
  // Calling a booking off is "managing bookings" whichever door it comes through (D141, #328): the
  // Cancel button and this status move are one act. A walk-in leaving the queue is not a booking
  // and stays a tap of the floor.
  if (
    to === 'cancelled' &&
    reservation.kind === 'booking' &&
    !stx.permissions.has('reservations.manage')
  ) {
    return refuse('permission_denied')
  }
  const freed = isEndStatus(to) ? await releaseHeldSpots(stx, reservation.id) : []
  await stx.tx
    .update(reservations)
    .set({
      status: to,
      queueKey: to === 'waiting' ? reservation.queueKey : null,
      endedAt: isEndStatus(to) ? sql`now()` : null,
      reason: command.reason ?? reservation.reason,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  await stx.log({
    kind: 'reservation.status',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    fromState: from,
    toState: to,
    reason: command.reason ?? undefined,
    details: { freed: freed.join(','), ...tableWorkDetails(closing.close.work) },
  })
  return accepted(null, {
    details: {
      reservationId: reservation.id,
      status: to,
      changed: true,
      ...tableWorkDetails(closing.close.work),
    },
  })
}

/**
 * Puts a party back where he was (D135): a no-show back to Reserved, a party nobody seated back
 * onto the waiting list. A party going back to the queue joins its end, because the place he had
 * is gone — the hostess moves him up if she means to.
 */
export async function putBackReservation(
  stx: ServiceTx,
  command: { readonly reservationId: string },
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  const move = putBack(reservation.status as ReservationStatus)
  if (!move.ok) return refuse(move.code)
  const to = move.status
  await stx.tx
    .update(reservations)
    .set({
      status: to,
      endedAt: null,
      queueKey: to === 'waiting' ? await nextQueueKey(stx, reservation.serviceDate) : null,
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
    reason: 'put_back',
  })
  return accepted(null, {
    details: { reservationId: reservation.id, status: to },
  })
}

/**
 * Puts a walk-in on the waiting list (D137: the list is a queue, not a table of its own). The party
 * is a reservation of the walk-in kind with the Waiting status and a fractional queue key, so a
 * reorder touches one row and the statuses and the overlap rule are the same ones as everywhere.
 */
export async function addToWaitingList(
  stx: ServiceTx,
  command: {
    readonly serviceDate: string
    readonly partySize: number
    readonly partyLabel?: string
    readonly phone?: string
    readonly guestName?: string
    readonly guestId?: string
    readonly note?: string | null
    readonly reason?: string | null
  },
): Promise<ServiceResult> {
  return await createReservation(stx, {
    serviceDate: command.serviceDate,
    // A walk-in waits from the moment he is written down, so his hour is now.
    startsAt: stx.now.toISOString(),
    kind: 'walk_in',
    status: 'waiting',
    partySize: command.partySize,
    partyLabel: command.partyLabel,
    phone: command.phone,
    guestName: command.guestName,
    guestId: command.guestId,
    note: command.note ?? null,
    // The occasion, where the booking form it came from asked for one (#330): a party put on the
    // list instead of onto a spot keeps what she typed.
    reason: command.reason ?? null,
    queueKey: await nextQueueKey(stx, command.serviceDate),
  })
}

/**
 * Moves a waiting party in the queue, between the two it is dropped between. One row changes: the
 * fractional key is what the queue is ordered by, in the same byte order the database sorts it in.
 */
export async function reorderWaitingList(
  stx: ServiceTx,
  command: {
    readonly reservationId: string
    readonly afterId?: string | null
    readonly beforeId?: string | null
  },
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  if (reservation.status !== 'waiting') return refuse('status_move_not_allowed')
  const after = await neighbourKey(stx, command.afterId ?? null)
  const before = await neighbourKey(stx, command.beforeId ?? null)
  if (after === 'missing' || before === 'missing') return refuse('reservation_missing')
  // The two neighbours as the queue has them: a pair named the wrong way round is a mistake on the
  // caller's side, not a key to invent, so it is refused rather than squeezed in somewhere.
  if (after !== null && before !== null && !(after < before)) return refuse('invalid_command')
  const queueKey = sortKeyBetween(after, before)
  await stx.tx
    .update(reservations)
    .set({ queueKey, ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(reservations.id, reservation.id))
  await stx.log({
    kind: 'reservation.changed',
    reservationId: reservation.id,
    toState: 'waiting',
    reason: 'reordered',
    details: { queueKey },
  })
  return accepted(null, {
    details: { reservationId: reservation.id, queueKey },
  })
}

/** The queue key of a neighbour the reorder names, null for the list's edge, 'missing' for a typo. */
async function neighbourKey(
  stx: ServiceTx,
  reservationId: string | null,
): Promise<string | null | 'missing'> {
  if (reservationId === null) return null
  const [row] = await stx.tx
    .select({ queueKey: reservations.queueKey })
    .from(reservations)
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.venueId, stx.venueId),
        eq(reservations.status, 'waiting'),
        isNull(reservations.deletedAt),
      ),
    )
  if (row === undefined) return 'missing'
  return row.queueKey
}

/** What a block is saved with (D137: a block is a reservation of its own kind). */
export interface BlockSaveCommand {
  readonly reservationId?: string
  readonly serviceDate: string
  readonly startsAt: string
  readonly endsAt?: string | null
  readonly spotIds: readonly string[]
  readonly reason?: string | null
  readonly note?: string | null
}

/**
 * Blocks spots for a stretch of a night, or changes a block already there: a reservation of the
 * block kind, with nobody coming, which the overlap rule keeps everything else off. A block is
 * never seated and never counted as a no-show (its status check in the schema says so).
 */
export async function saveBlock(stx: ServiceTx, command: BlockSaveCommand): Promise<ServiceResult> {
  if (command.reservationId === undefined) {
    return await createReservation(stx, {
      serviceDate: command.serviceDate,
      startsAt: command.startsAt,
      endsAt: command.endsAt ?? null,
      kind: 'block',
      status: 'reserved',
      spotIds: command.spotIds,
      reason: command.reason ?? null,
      note: command.note ?? null,
    })
  }
  const existing = await lockReservation(stx, command.reservationId)
  if (existing === null || existing.deletedAt !== null) return refuse('reservation_missing')
  if (existing.kind !== 'block') return refuse('kind_not_allowed')
  const open = await openReservation(stx, existing.id)
  if (!open.ok) return refuse(open.code)
  const { reservation, night } = open
  const startsAt = new Date(command.startsAt)
  const endsAt = command.endsAt == null ? null : new Date(command.endsAt)
  const kept = new Set(command.spotIds)
  const dropped = (await spotsOfReservation(stx, reservation.id))
    .map((row) => row.spotId)
    .filter((spotId) => !kept.has(spotId))
  if (dropped.length > 0) await releaseHeldSpots(stx, reservation.id, dropped)
  const grant = await claimSpots(
    stx,
    {
      reservationId: reservation.id,
      spotIds: command.spotIds,
      serviceDate: reservation.serviceDate,
      startsAt,
      endsAt,
      turnMinutes: reservation.turnMinutes,
    },
    night.settings.turnMinutes,
  )
  if (!grant.ok) return refused(null, grant.code, { ...grant.details })
  await writeHeldSpots(stx, reservation.id, command.spotIds, grant.stretch, endsAt !== null)
  await stx.tx
    .update(reservations)
    .set({
      startsAt,
      endsAt,
      reason: command.reason ?? reservation.reason,
      note: command.note === undefined ? reservation.note : command.note,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  await stx.log({
    kind: 'reservation.changed',
    reservationId: reservation.id,
    toState: 'reserved',
    reason: 'block_changed',
    details: { spots: command.spotIds.join(','), dropped: dropped.join(',') },
  })
  return accepted(null, { details: { reservationId: reservation.id } })
}

/** Lifts a block: the spots are free again, and the line ends as a cancellation of the block. */
export async function removeBlock(
  stx: ServiceTx,
  command: { readonly reservationId: string; readonly reason?: string | null },
): Promise<ServiceResult> {
  const existing = await lockReservation(stx, command.reservationId)
  if (existing === null || existing.deletedAt !== null) return refuse('reservation_missing')
  if (existing.kind !== 'block') return refuse('kind_not_allowed')
  return await cancelReservation(
    stx,
    { reservationId: existing.id, reason: command.reason ?? 'block_lifted' },
    { block: true },
  )
}
