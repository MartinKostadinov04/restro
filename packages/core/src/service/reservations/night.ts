// The night's record (ticket #323; D138). Closing a night is what makes it a record: afterwards
// every reservation command on it is refused `night_closed`, whatever the venue's "editing the
// past" switch says, because the switch is about a night nobody closed.
//
// The sweep is the one reservation command the **worker** runs: it marks the parties still on the
// waiting list when the night ended as Not seated (D138's own status), which no tap reaches, and
// is decided under the night's and the reservations' own locks, so a repeated job changes nothing.
//
// A night's record is its own table rather than a column on `service_days`, because a service day
// is closed only once it has really ended (`service-day-close.ts` refuses `day_not_ended` for
// today) and D138's early end is exactly a night an admin closes while it is still going.

import { reservationNights, reservations } from '@restro/db'
import { eq, sql } from 'drizzle-orm'

import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { lockNight, lockNightReservations, readSettings, refuse } from './rows'
import { moveStatus, type ReservationStatus } from './status'

/**
 * Ends a night (D138): the record is written, the parties nobody seated are marked Not seated, and
 * the night stops being writable. An admin may end it before its closing hour (`early`), and the
 * count of bills still open then is kept as the warning showed it — the count is the caller's,
 * because the bills are the ordering side's and this module never reads one (D134).
 *
 * A repeat finds the night closed and changes nothing, which is what a second tap means.
 */
export async function closeReservationNight(
  stx: ServiceTx,
  command: {
    readonly serviceDate: string
    readonly early?: boolean
    readonly openBills?: number | null
  },
): Promise<ServiceResult> {
  const settings = await readSettings(stx)
  if (settings === null) return refuse('settings_missing')
  const night = await lockNight(stx, command.serviceDate)
  if (night?.closedAt != null) {
    return accepted(null, {
      details: { serviceDate: command.serviceDate, closed: true, changed: false },
    })
  }
  const swept = await sweepWaiting(stx, command.serviceDate)
  const values = {
    closedAt: sql`now()`,
    closedBy: stx.provenance.actor,
    closedEarly: command.early ?? false,
    openBillsAtClose: command.openBills ?? null,
    sweptAt: sql`now()`,
  }
  await writeNight(stx, command.serviceDate, night !== null, values)
  await stx.log({
    kind: 'night.closed',
    toState: 'closed',
    reason: command.early === true ? 'ended_early' : undefined,
    details: {
      serviceDate: command.serviceDate,
      notSeated: swept.length,
      openBills: command.openBills ?? null,
    },
  })
  return accepted(null, {
    details: {
      serviceDate: command.serviceDate,
      closed: true,
      changed: true,
      notSeated: swept.length,
    },
  })
}

/**
 * The worker's sweep of one night: the parties still waiting when it ended become Not seated
 * (D138). Not seated is its own end state and is **not** counted as a no-show on a guest's card
 * (D140: the counts are a rough count for a hostess, and nobody failed to turn up here).
 *
 * The night's record keeps when it was swept, so a job that runs twice finds it done.
 */
export async function sweepReservationNight(
  stx: ServiceTx,
  command: { readonly serviceDate: string },
): Promise<ServiceResult> {
  const night = await lockNight(stx, command.serviceDate)
  if (night?.sweptAt != null) {
    return accepted(null, { details: { serviceDate: command.serviceDate, changed: false } })
  }
  const swept = await sweepWaiting(stx, command.serviceDate)
  await writeNight(stx, command.serviceDate, night !== null, { sweptAt: sql`now()` })
  await stx.log({
    kind: 'night.swept',
    toState: 'swept',
    details: { serviceDate: command.serviceDate, notSeated: swept.length },
  })
  return accepted(null, {
    details: { serviceDate: command.serviceDate, changed: true, notSeated: swept.length },
  })
}

/**
 * Marks every party still waiting on a night as Not seated, through the status machine, so the
 * move is the one `status.ts` allows and not a write around it. Returns the lines it moved.
 */
async function sweepWaiting(stx: ServiceTx, serviceDate: string): Promise<string[]> {
  const lines = await lockNightReservations(stx, serviceDate)
  const moved: string[] = []
  for (const line of lines) {
    if (line.status !== 'waiting') continue
    const move = moveStatus(line.status as ReservationStatus, 'not_seated')
    if (!move.ok) continue
    await stx.tx
      .update(reservations)
      .set({
        status: 'not_seated',
        queueKey: null,
        endedAt: sql`now()`,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(reservations.id, line.id))
    await stx.log({
      kind: 'reservation.status',
      reservationId: line.id,
      guestId: line.guestId ?? undefined,
      fromState: 'waiting',
      toState: 'not_seated',
      reason: 'night_ended',
    })
    moved.push(line.id)
  }
  return moved
}

/** Writes the night's record: a new row, or the one already there. */
async function writeNight(
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
