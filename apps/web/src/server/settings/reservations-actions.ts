'use server'

// The Reservations section's server actions (#325): thin wrappers over the reservation commands,
// one reversible change each. Each is a person's settings change: `settings.reservations` and a
// sign-in of the last 15 minutes, which the service write path checks (a PIN never reaches it) and
// the screen words. Nothing here is saved as a whole form. A change the booking page shows (the
// online booking switch, a closed date, what guests may choose) queues the venue's booking file
// with it (#577, #580).
import { idSchema } from '@restro/core'
import { GUEST_MAY_VALUES } from '@restro/core/service'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { queueBookingFile } from './booking-file'
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

/** The online booking switch (#577): whether the venue's booking page takes requests. */
const OnlineBooking = z.strictObject({ venueId, bookingPage: z.boolean() })

/** What guests may choose on the booking page, and whether a picked spot confirms itself (#580). */
const OnlineGuests = z.strictObject({
  venueId,
  guestMay: z.enum(GUEST_MAY_VALUES).optional(),
  autoConfirm: z.boolean().optional(),
})

/**
 * Runs one command at the venue and refreshes the page on success; `booking` queues the venue's
 * booking file in the same transaction.
 */
async function runAt(
  venue: string,
  command: Record<string, unknown>,
  booking = false,
): Promise<SettingsResult> {
  return inSettingsScope(venue, async (scope) => {
    const result = await runSettingsCommand(
      scope,
      command,
      booking ? { service: queueBookingFile(scope) } : {},
    )
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
  return runAt(
    parsed.data.venueId,
    {
      type: 'reservation_closed_date.add',
      date: parsed.data.date,
    },
    true,
  )
}

/** Opens a closed night again. */
export async function removeClosedDateAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnDate.safeParse(input)
  if (!parsed.success) return INVALID
  return runAt(
    parsed.data.venueId,
    {
      type: 'reservation_closed_date.remove',
      date: parsed.data.date,
    },
    true,
  )
}

/**
 * Switches the venue's booking page on or off (#577). Undo is the screen sending the previous
 * value again.
 */
export async function saveOnlineBookingAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnlineBooking.safeParse(input)
  if (!parsed.success) return INVALID
  return runAt(
    parsed.data.venueId,
    { type: 'reservation_online.set', bookingPage: parsed.data.bookingPage },
    true,
  )
}

/**
 * Sets what guests may choose on the booking page (a night, an Area, their own spot) or whether a
 * booking with a spot the guest picked confirms itself (#580). The booking file is queued with it:
 * the page offers the new choice once it is published. Undo is the screen sending the previous
 * value again.
 */
export async function saveOnlineGuestsAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnlineGuests.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...change } = parsed.data
  if (change.guestMay === undefined && change.autoConfirm === undefined) return INVALID
  return runAt(venue, { type: 'reservation_online_guests.set', ...change }, true)
}
