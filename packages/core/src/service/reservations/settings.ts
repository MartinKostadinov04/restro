// The venue's reservation settings (ticket #323; D135, D138, D140, D141). One row per venue,
// written by this one command. `settings.reservations`, so it needs the person's own sign-in.
//
// The turn time is **the** turn time (D135): how long a spot is held, and so the shortest gap
// before the next booking. There is no second setting beside it, and no default is invented
// anywhere: a venue with no row here has no turn time, and a booking that needs one is refused
// `settings_missing` until an owner sets it.
//
// `pin_actions` is where the PIN falls (D141, #324): the actions a shared device lets through on
// one tap. It is written here as a patch — an action the call leaves out keeps what the venue had,
// and one the venue never chose follows D141's default (`pin-fall.ts`). `online` (D136, part 2's
// own values) is not written here: ticket #325 owns it, and this command leaves it as it is.

import { reservationSettings } from '@restro/db'
import { sql } from 'drizzle-orm'

import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { actionsBehindPin, type PinActions, storedPinActions } from './pin-fall'
import { readSettings, refuse } from './rows'

/** What the settings are set with; a value left out keeps what the venue had. */
export interface ReservationSettingsCommand {
  readonly turnMinutes?: number
  readonly editPastNights?: boolean
  readonly privateNotesOn?: boolean
  readonly pinActions?: PinActions
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
  // The PIN falls where the venue last left it, with this call's actions over the top: a screen
  // that moves one line sends that one line, and the rest of the venue's choices stay.
  const pinActions: PinActions = {
    ...storedPinActions(existing?.pinActions),
    ...command.pinActions,
  }
  const values = { turnMinutes, editPastNights, privateNotesOn, pinActions }
  // What the Log and the answer carry: the settings themselves, and where the PIN falls as one
  // line of action names (the Log takes plain values, and the list is the point, not its shape).
  const details = {
    turnMinutes,
    editPastNights,
    privateNotesOn,
    pinFall: actionsBehindPin(pinActions).join(','),
  }
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
    details: { ...details, wasTurnMinutes: existing?.turnMinutes ?? null },
  })
  return accepted(null, { details })
}
