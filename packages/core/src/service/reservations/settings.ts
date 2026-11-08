// The venue's reservation settings (ticket #323; D135, D138, D140, D141). One row per venue,
// written by this one command. `settings.reservations`, so it needs the person's own sign-in.
//
// The turn time is **the** turn time (D135): how long a spot is held, and so the shortest gap
// before the next booking. There is no second setting beside it, and no default is invented
// anywhere: a venue with no row here has no turn time, and a booking that needs one is refused
// `settings_missing` until an owner sets it.
//
// `pin_actions` (D141, which taps ask for four digits) and `online` (D136, part 2's own values)
// are not written here: tickets #324 and #325 own them, and this command leaves them as they are.

import { reservationSettings } from '@restro/db'
import { sql } from 'drizzle-orm'

import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { readSettings, refuse } from './rows'

/** What the settings are set with; a value left out keeps what the venue had. */
export interface ReservationSettingsCommand {
  readonly turnMinutes?: number
  readonly editPastNights?: boolean
  readonly privateNotesOn?: boolean
}

/**
 * Sets the venue's reservation settings. The first call must carry the turn time, because there is
 * nothing to fall back on; a later call may change one value and leave the rest. Refused
 * `settings_missing` when the venue has no row yet and the call names no turn time, which says
 * exactly what is missing rather than quietly writing a number nobody chose.
 */
export async function setReservationSettings(
  stx: ServiceTx,
  command: ReservationSettingsCommand,
): Promise<ServiceResult> {
  const existing = await readSettings(stx)
  const turnMinutes = command.turnMinutes ?? existing?.turnMinutes
  if (turnMinutes === undefined) return refuse('settings_missing')
  const editPastNights = command.editPastNights ?? existing?.editPastNights ?? false
  const privateNotesOn = command.privateNotesOn ?? existing?.privateNotesOn ?? false
  const values = { turnMinutes, editPastNights, privateNotesOn }
  await stx.tx
    .insert(reservationSettings)
    .values({
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      ...values,
      ...stx.provenance,
    })
    .onConflictDoUpdate({
      target: [reservationSettings.tenantId, reservationSettings.venueId],
      set: { ...values, ...stx.provenance, updatedAt: sql`now()` },
    })
  await stx.log({
    kind: 'reservation_settings.changed',
    toState: existing === null ? 'created' : 'changed',
    details: {
      turnMinutes,
      editPastNights,
      privateNotesOn,
      wasTurnMinutes: existing?.turnMinutes ?? null,
    },
  })
  return accepted(null, { details: values })
}
