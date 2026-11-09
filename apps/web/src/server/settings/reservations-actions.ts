'use server'

// The Reservations section's server actions (#325): thin wrappers over the reservation commands,
// one reversible change each. Each is a person's settings change: `settings.reservations` and a
// sign-in of the last 15 minutes, which the service write path checks (a PIN never reaches it) and
// the screen words. Nothing here is saved as a whole form.
import { idSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { INVALID, inSettingsScope, runSettingsCommand, type SettingsResult } from './scope'

const venueId = idSchema('vn')
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** The rules the venue switches or sets: only the keys it changes (the service path checks each). */
const Rules = z.strictObject({
  venueId,
  /** How long a spot is held, in minutes (D135). */
  turnMinutes: z.number().int().positive().max(1440).optional(),
  phoneRequired: z.boolean().optional(),
  editPastNights: z.boolean().optional(),
  privateNotesOn: z.boolean().optional(),
})

const OnDate = z.strictObject({ venueId, date })
const Seats = z.strictObject({
  venueId,
  spotId: idSchema('sp'),
  /** The spot's own seats, or null for its kind's default. */
  seats: z.number().int().min(1).max(100).nullable(),
})

/** Runs one command at the venue and refreshes the page on success. */
async function runAt(venue: string, command: Record<string, unknown>): Promise<SettingsResult> {
  return inSettingsScope(venue, async (scope) => {
    const result = await runSettingsCommand(scope, command)
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}

/** Sets one or more of the venue's reservation rules. */
export async function saveReservationRulesAction(input: unknown): Promise<SettingsResult> {
  const parsed = Rules.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...rules } = parsed.data
  return runAt(venue, { type: 'reservation_settings.set', ...rules })
}

/** Closes a night. */
export async function addClosedDateAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnDate.safeParse(input)
  if (!parsed.success) return INVALID
  return runAt(parsed.data.venueId, {
    type: 'reservation_closed_date.add',
    date: parsed.data.date,
  })
}

/** Opens a closed night again. */
export async function removeClosedDateAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnDate.safeParse(input)
  if (!parsed.success) return INVALID
  return runAt(parsed.data.venueId, {
    type: 'reservation_closed_date.remove',
    date: parsed.data.date,
  })
}

/** Sets a spot's seats. */
export async function setSpotSeatsAction(input: unknown): Promise<SettingsResult> {
  const parsed = Seats.safeParse(input)
  if (!parsed.success) return INVALID
  return runAt(parsed.data.venueId, {
    type: 'spot.set_seats',
    spotId: parsed.data.spotId,
    seats: parsed.data.seats,
  })
}
