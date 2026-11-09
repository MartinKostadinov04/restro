// The venue's one-off closed dates (ticket #325; D136, log 12.19). Reservations use the venue's own
// service hours and add only these nights, so there is no second copy of the working hours here.
//
// They live in the venue's reservation settings row, as one list of service days, rather than in a
// table of their own: a season of closed dates is a few hundred short strings, adding and removing
// one is one update of the row that is already written by the one settings command, and no new
// table means no new row-security, purge or write-target entry to keep in step (rule 1 still holds:
// only these commands write it). A removed date is simply no longer in the list, which is an update,
// never a deletion of a row; Undo on the screen adds it back.
//
// Both commands need the settings row, which needs the turn time first (D135, `settings_missing`):
// the screen says so rather than inventing a turn time.

import { reservationSettings } from '@restro/db'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { readSettings, refuse } from './rows'

/** The most closed dates a venue keeps: a few seasons, far more than a club closes. */
export const CLOSED_DATES_MAX = 500

/** A service day as a real calendar day, `YYYY-MM-DD` (D45: a night, never a moment). */
export const ClosedDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number]
    const date = new Date(Date.UTC(year, month - 1, day))
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    )
  })

/** What a stored list means: only the days that are real, each once, oldest first. */
export function closedDatesOf(stored: unknown): string[] {
  const days = (Array.isArray(stored) ? stored : []).filter(
    (day): day is string => ClosedDateSchema.safeParse(day).success,
  )
  return [...new Set(days)].sort()
}

/** Writes the venue's list and the provenance that goes with it. */
async function writeDates(stx: ServiceTx, dates: readonly string[]): Promise<void> {
  await stx.tx
    .update(reservationSettings)
    .set({ closedDates: [...dates], ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(reservationSettings.venueId, stx.venueId))
}

/**
 * Closes a night. Adding a date the venue already closed is accepted and writes nothing (the same
 * answer as the first time), so Undo of a removal and a double tap both settle on the same list.
 */
export async function addClosedDate(
  stx: ServiceTx,
  command: { readonly date: string },
): Promise<ServiceResult> {
  const existing = await readSettings(stx)
  if (existing === null) return refuse('settings_missing')
  const dates = closedDatesOf(existing.closedDates)
  if (dates.includes(command.date)) return accepted(null, { details: { date: command.date } })
  if (dates.length >= CLOSED_DATES_MAX) return refuse('closed_dates_full')
  await writeDates(stx, [...dates, command.date].sort())
  await stx.log({
    kind: 'reservation_settings.changed',
    toState: 'closed_date_added',
    details: { closedDate: command.date },
  })
  return accepted(null, { details: { date: command.date } })
}

/**
 * Opens a night again. A date that is not in the list is accepted and writes nothing, for the same
 * reason as adding one twice.
 */
export async function removeClosedDate(
  stx: ServiceTx,
  command: { readonly date: string },
): Promise<ServiceResult> {
  const existing = await readSettings(stx)
  if (existing === null) return refuse('settings_missing')
  const dates = closedDatesOf(existing.closedDates)
  if (!dates.includes(command.date)) return accepted(null, { details: { date: command.date } })
  await writeDates(
    stx,
    dates.filter((date) => date !== command.date),
  )
  await stx.log({
    kind: 'reservation_settings.changed',
    toState: 'closed_date_removed',
    details: { closedDate: command.date },
  })
  return accepted(null, { details: { date: command.date } })
}
