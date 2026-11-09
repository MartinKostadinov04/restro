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
// own values) is given its defaults when the row is made and is never changed here: no part-1
// screen has a control for it (ticket #325), and part 2 adds its own command.
//
// The defaults of D135 and D140 live here, once: a phone is required, a past night is read-only, and
// the manager keeps a private guest list.

import { reservationSettings } from '@restro/db'
import { sql } from 'drizzle-orm'

import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { DEFAULT_ONLINE_SETTINGS } from './online-settings'
import { actionsBehindPin, type PinActions, storedPinActions } from './pin-fall'
import { readSettings, refuse } from './rows'

/** What the settings are set with; a value left out keeps what the venue had. */
export interface ReservationSettingsCommand {
  readonly turnMinutes?: number
  readonly editPastNights?: boolean
  readonly privateNotesOn?: boolean
  readonly phoneRequired?: boolean
  readonly pinActions?: PinActions
}

/**
 * What the Log names when one thing changed (`lg_rv_set_*` in the Log's sentences): the setting's
 * own code, so a line says *which* rule moved. A call that moved several, or only where the PIN
 * falls, is plain "changed".
 */
function changedSetting(
  existing: NonNullable<Awaited<ReturnType<typeof readSettings>>>,
  next: {
    readonly turnMinutes: number
    readonly editPastNights: boolean
    readonly privateNotesOn: boolean
    readonly phoneRequired: boolean
  },
): string {
  const moved = [
    next.turnMinutes !== existing.turnMinutes ? 'turn_time' : null,
    next.phoneRequired !== existing.phoneRequired ? 'phone_required' : null,
    next.editPastNights !== existing.editPastNights ? 'edit_past' : null,
    next.privateNotesOn !== existing.privateNotesOn ? 'private_list' : null,
  ].filter((one): one is string => one !== null)
  return moved.length === 1 && moved[0] !== undefined ? moved[0] : 'changed'
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
  const privateNotesOn = command.privateNotesOn ?? existing?.privateNotesOn ?? true
  const phoneRequired = command.phoneRequired ?? existing?.phoneRequired ?? true
  // The PIN falls where the venue last left it, with this call's actions over the top: a screen
  // that moves one line sends that one line, and the rest of the venue's choices stay.
  const pinActions: PinActions = {
    ...storedPinActions(existing?.pinActions),
    ...command.pinActions,
  }
  const values = { turnMinutes, editPastNights, privateNotesOn, phoneRequired, pinActions }
  // What the Log and the answer carry: the settings themselves, and where the PIN falls as one
  // line of action names (the Log takes plain values, and the list is the point, not its shape).
  const details = {
    turnMinutes,
    editPastNights,
    privateNotesOn,
    phoneRequired,
    pinFall: actionsBehindPin(pinActions).join(','),
  }
  await stx.tx
    .insert(reservationSettings)
    .values({
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      ...values,
      // Part 2's values start at their defaults and are never touched again from here.
      online: { ...DEFAULT_ONLINE_SETTINGS },
      ...stx.provenance,
    })
    .onConflictDoUpdate({
      target: [reservationSettings.tenantId, reservationSettings.venueId],
      set: { ...values, ...stx.provenance, updatedAt: sql`now()` },
    })
  await stx.log({
    kind: 'reservation_settings.changed',
    toState: existing === null ? 'created' : changedSetting(existing, values),
    details: { ...details, wasTurnMinutes: existing?.turnMinutes ?? null },
  })
  return accepted(null, { details })
}
