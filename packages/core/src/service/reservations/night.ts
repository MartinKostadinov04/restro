// The night's reservations at its end (ticket #332; D138). Three moments are kept apart, and this
// module serves two of them without mixing them (D138, log 13.9):
//
// - **The night's end** is the venue's closing hour, or an admin's early end before it
//   (`night-end.ts`, which owns the moment and its record). There the parties are swept: the seated
//   become Finished, a booking nobody came for No-show, a party still waiting Not seated, a block
//   untouched (`nightEndStatus`).
// - **A night has passed** when its service day ended (D45). The worker then runs the same sweep
//   once more (`sweepPassedNight`), for whatever the night's end left: a party seated after the
//   hour, a booking made after it, a night whose end never ran.
// - **Putting one reservation back** lives between the two and is not here: it is one admin's
//   action on one reservation (`tonight.ts`). There is no bulk undo.
//
// The sweep is idempotent by state: a party it has moved is over, so a second run — by either
// moment — finds nothing to move and writes nothing, no Log entry included.

import { reservationNights, reservations } from '@restro/db'
import { eq, sql } from 'drizzle-orm'

import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { releaseHeldSpots } from './book'
import { lockNight, lockNightReservations, type Reservation } from './rows'
import {
  isEndStatus,
  moveStatus,
  NIGHT_END_REASON,
  nightEndStatus,
  type ReservationKind,
  type ReservationStatus,
} from './status'

/** What one sweep moved, by the status it gave. */
export interface NightSweep {
  readonly finished: number
  readonly noShow: number
  readonly notSeated: number
}

/** The sweep's counts as a result's or a Log entry's details. */
export function sweepDetails(sweep: NightSweep): Record<string, number> {
  return { finished: sweep.finished, noShow: sweep.noShow, notSeated: sweep.notSeated }
}

/** True when the sweep moved nobody. */
export function sweptNobody(sweep: NightSweep): boolean {
  return sweep.finished + sweep.noShow + sweep.notSeated === 0
}

/** One move the sweep makes: a party, and the status the night's end gives it. */
export interface SweepMove {
  readonly id: string
  readonly from: ReservationStatus
  readonly to: ReservationStatus
}

/**
 * The sweep as a plan, before anything is written: each line the night's end has a status for,
 * where the status machine allows the move (D138). Pure, so its two promises are checked by a
 * property test: a plan applied leaves nothing for a second plan, and no line moves twice.
 */
export function planSweep(
  lines: readonly {
    readonly id: string
    readonly status: string
    readonly kind: string
  }[],
): SweepMove[] {
  return lines.flatMap((line) => {
    const from = line.status as ReservationStatus
    const to = nightEndStatus(from, line.kind as ReservationKind)
    return to !== null && moveStatus(from, to).ok ? [{ id: line.id, from, to }] : []
  })
}

/** What a plan moves, counted by the status it gives. */
export function countSweep(moves: readonly SweepMove[]): NightSweep {
  return {
    finished: moves.filter((move) => move.to === 'finished').length,
    noShow: moves.filter((move) => move.to === 'no_show').length,
    notSeated: moves.filter((move) => move.to === 'not_seated').length,
  }
}

/**
 * Sweeps a night's parties (D138): each line the night's end has a status for is moved to it
 * through the status machine, its spots freed and its end stamped, with one Log line per party
 * (reason `night_ended`). The night's lines are locked by the caller, before the night's record
 * (`LOCK_RANKS`).
 *
 * **Nothing about a table is touched here.** A finished party's codes are closed by the night's
 * end itself, which keeps a table whose card is still held (`closeOpenTables` with `keepPaying`);
 * closing them from here would cancel a guest's card in the middle of a payment.
 */
export async function sweepNightLines(
  stx: ServiceTx,
  lines: readonly Reservation[],
): Promise<NightSweep> {
  const moves = planSweep(lines)
  const byId = new Map(lines.map((line) => [line.id, line]))
  for (const { id, from, to } of moves) {
    const line = byId.get(id) as Reservation
    const freed = isEndStatus(to) ? await releaseHeldSpots(stx, id) : []
    await stx.tx
      .update(reservations)
      .set({
        status: to,
        queueKey: null,
        endedAt: sql`now()`,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(reservations.id, id))
    await stx.log({
      kind: 'reservation.status',
      reservationId: id,
      guestId: line.guestId ?? undefined,
      fromState: from,
      toState: to,
      reason: NIGHT_END_REASON,
      details: { freed: freed.join(',') },
    })
  }
  return countSweep(moves)
}

/**
 * `reservation_night.sweep`, the worker's run once a night **has passed** (its service day ended):
 * the same sweep as the night's end, for whatever that left. It changes nothing and writes nothing
 * where nothing is left, so a repeated job — or one after the night's end already swept everyone —
 * leaves no second Log entry. A night with something to sweep keeps when it was swept on its
 * record, and the Log says how many were moved.
 */
export async function sweepPassedNight(
  stx: ServiceTx,
  command: { readonly serviceDate: string },
): Promise<ServiceResult> {
  // A night still going is the night's end's, never this sweep's: it would finish parties sitting
  // at their tables before the venue's closing hour.
  if (command.serviceDate >= stx.serviceDate) {
    return accepted(null, { details: { serviceDate: command.serviceDate, changed: false } })
  }
  const lines = await lockNightReservations(stx, command.serviceDate)
  const night = await lockNight(stx, command.serviceDate)
  const sweep = await sweepNightLines(stx, lines)
  if (sweptNobody(sweep)) {
    return accepted(null, { details: { serviceDate: command.serviceDate, changed: false } })
  }
  await writeNightRecord(stx, command.serviceDate, night !== null, { sweptAt: sql`now()` })
  await stx.log({
    kind: 'night.swept',
    toState: 'swept',
    details: { serviceDate: command.serviceDate, ...sweepDetails(sweep) },
  })
  return accepted(null, {
    details: { serviceDate: command.serviceDate, changed: true, ...sweepDetails(sweep) },
  })
}

/** Writes the night's record: a new row, or the one already there. */
export async function writeNightRecord(
  stx: ServiceTx,
  serviceDate: string,
  exists: boolean,
  values: Record<string, unknown>,
): Promise<void> {
  if (exists) {
    await stx.tx
      .update(reservationNights)
      .set({ ...values, ...stx.provenance, updatedAt: sql`now()` })
      .where(
        sql`${reservationNights.venueId} = ${stx.venueId} and ${reservationNights.serviceDate} = ${serviceDate}`,
      )
    return
  }
  await stx.tx.insert(reservationNights).values({
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate,
    ...values,
    ...stx.provenance,
  })
}
