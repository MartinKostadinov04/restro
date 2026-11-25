// Answering an online request (#578; spec #322, Implementation Decision 2; D136): Confirm makes it
// Reserved and gives it its spots in the same command, Decline makes it Declined and frees what it
// held. Both are status moves through the one table (`status.ts`), both write one Log entry, and
// both tell a guest with an address by email (the caller queues it from the answer, #576).
//
// A request that nobody answers is declined by the night's end instead (`nightEndStatus`), with the
// same email; that path is the sweep's (`night.ts`), not this file's.
//
// Neither command touches money or the POS (D134, rule 7).

import { reservations } from '@restro/db'
import { eq, sql } from 'drizzle-orm'

import type { ServiceTx } from '../definition'
import { accepted, refused, type ServiceResult } from '../results'
import { claimSpots, openReservation, releaseHeldSpots, writeHeldSpots } from './book'
import { guestEmailOwed } from './guest-email'
import { refuse, spotsOfReservation } from './rows'
import { moveStatus, type ReservationStatus } from './status'

/** `reservation.confirm`: the request, and the spots it is given (left out, the ones it holds). */
export interface ReservationConfirmCommand {
  readonly reservationId: string
  readonly spotIds?: readonly string[]
}

/** `reservation.decline`: the request, and a reason code if the venue keeps one. */
export interface ReservationDeclineCommand {
  readonly reservationId: string
  readonly reason?: string | null
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((one) => b.includes(one))

/**
 * Confirms a request: Requested becomes Reserved, holding the spots the hostess chose. The spots
 * are claimed by the booking rule, the same claim the booking form makes (`claimSpots`), so a spot
 * somebody took while the request waited is refused `spot_taken`, naming that spot and the party
 * that holds it, and nothing is written. Spots left out keep what the request already holds (a
 * guest who picked his own spot on the booking page).
 */
export async function confirmReservation(
  stx: ServiceTx,
  command: ReservationConfirmCommand,
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation, night } = open
  if (reservation.kind !== 'booking') return refuse('kind_not_allowed')
  const move = moveStatus(reservation.status as ReservationStatus, 'reserved')
  // Only Requested moves to Reserved, so a second Confirm (or one after the night's end declined
  // the request) is refused by name.
  if (!move.ok) return refuse(move.code)

  const held = (await spotsOfReservation(stx, reservation.id)).map((row) => row.spotId)
  const wanted = command.spotIds ?? held
  const spotsChanged = !sameSet(wanted, held)
  if (spotsChanged) {
    if (wanted.length > 0) {
      const grant = await claimSpots(
        stx,
        {
          reservationId: reservation.id,
          spotIds: wanted,
          serviceDate: reservation.serviceDate,
          startsAt: reservation.startsAt,
          endsAt: reservation.endsAt,
          turnMinutes: reservation.turnMinutes,
        },
        night.settings.turnMinutes,
      )
      if (!grant.ok) return refused(null, grant.code, grant.details)
      await releaseHeldSpots(stx, reservation.id)
      await writeHeldSpots(stx, reservation.id, wanted, grant.stretch, reservation.endsAt !== null)
    } else {
      await releaseHeldSpots(stx, reservation.id)
    }
  }
  await stx.tx
    .update(reservations)
    .set({ status: 'reserved', ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(reservations.id, reservation.id))
  stx.touchNight(reservation.serviceDate)
  await stx.log({
    kind: 'reservation.status',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    fromState: reservation.status,
    toState: 'reserved',
    details: { spots: wanted.join(','), spotsChanged },
  })
  // A guest with an address is told, with the night, the hour, the party and the spots (#578).
  const email = await guestEmailOwed(stx, reservation, 'reservation_confirmed')
  return accepted(null, { details: { reservationId: reservation.id, ...email } })
}

/**
 * Declines a request: Requested becomes Declined, an end state (`END_STATUSES`), its spots freed
 * and its end stamped. Only a request is declined; a booking is cancelled, which is a different
 * word and a different email.
 */
export async function declineReservation(
  stx: ServiceTx,
  command: ReservationDeclineCommand,
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  if (reservation.kind !== 'booking') return refuse('kind_not_allowed')
  const move = moveStatus(reservation.status as ReservationStatus, 'declined')
  if (!move.ok) return refuse(move.code)
  const freed = await releaseHeldSpots(stx, reservation.id)
  await stx.tx
    .update(reservations)
    .set({
      status: 'declined',
      queueKey: null,
      endedAt: sql`now()`,
      reason: command.reason ?? reservation.reason,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  stx.touchNight(reservation.serviceDate)
  await stx.log({
    kind: 'reservation.status',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    fromState: reservation.status,
    toState: 'declined',
    reason: command.reason ?? undefined,
    details: { freed: freed.join(',') },
  })
  const email = await guestEmailOwed(stx, reservation, 'reservation_declined')
  return accepted(null, { details: { reservationId: reservation.id, ...email } })
}
