// Where the PIN falls (D141; ticket #324): which reservation actions a shared device lets through
// on one tap, and which ask the person for four digits first. D141's rule, Opus's judgement that
// Martin took as the default: *if the tap only says where people are sitting tonight, it is a tap;
// if it writes the booking book, touches money, touches a guest's details or ends the night, it is
// four digits.* Because a venue may move a line, what a PIN in the Log proves can differ between
// clubs, which Martin called the club's own choice.
//
// Only a shared device asks this question. On a person's own phone or laptop the sign-in already
// names them, and a settings-class permission (the reservation settings, the guest records) can
// never be reached by a PIN at all, so it is not on this list.
//
// The list is an **action**, not a command type, because one command covers two different taps:
// `reservation.edit` changes the guest count at the door (a tap) and edits a booking's details (a
// PIN), and `reservation.create` seats a walk-in (a tap) and writes a booking (a PIN). The action
// is read off the payload, so the venue's choice lands on what the person is actually doing.
//
// Pure data and one read; no I/O beyond the select.

import { type DbPool, reservationSettings, withTenant } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

/** The read side of a transaction: this never writes. */
type ReadOnly = Pick<WriteTx, 'select'>

/**
 * The reservation actions a venue can place (D141's own words in the comments). Grouped the way
 * the door works, not one per command: undoing an arrival is the same action as making one, and
 * freeing a party's tables is the same action as giving them.
 */
export const PIN_FALL_ACTIONS = [
  /** Arrived, seated, finished, a no-show, and undoing one. */
  'status',
  /** Change the guest count of a party that is already there. */
  'guest_count',
  /** Seat a walk-in. */
  'walk_in',
  /** Add to the waiting list, and its order. */
  'waiting',
  /** Give a waiting party a table, change a party's tables, swap two parties, free the tables. */
  'spots',
  /** Create a booking. */
  'create',
  /** Edit a booking's details. */
  'edit',
  /** Cancel. */
  'cancel',
  /** Delete. */
  'delete',
  /** Restore. */
  'restore',
  /** Put back a reservation the night's end closed. */
  'put_back',
  /** Copy to another night. */
  'copy',
  /** Block or unblock a table. */
  'block',
  /** End the night, with its preview. */
  'end_night',
] as const

/** One action a venue can place on one tap or behind a PIN. */
export type PinFallAction = (typeof PIN_FALL_ACTIONS)[number]

/** Where an action falls: straight through on a shared device, or four digits first. */
export type PinFall = 'tap' | 'pin'

/**
 * D141's default, which Martin took in advance: tonight's floor is self-correcting and everyone is
 * looking at the same plan, so a wrong tap is caught in seconds; a wrong line in the booking book
 * is invisible for days and the club needs to know whose hand did it.
 */
export const DEFAULT_PIN_FALL: Readonly<Record<PinFallAction, PinFall>> = {
  status: 'tap',
  guest_count: 'tap',
  walk_in: 'tap',
  waiting: 'tap',
  spots: 'tap',
  create: 'pin',
  edit: 'pin',
  cancel: 'pin',
  delete: 'pin',
  restore: 'pin',
  put_back: 'pin',
  copy: 'pin',
  block: 'pin',
  end_night: 'pin',
}

const PinFallSchema = z.enum(['tap', 'pin'])

/**
 * What a venue stores in `reservation_settings.pin_actions`: the actions it has moved. An action
 * left out falls where `DEFAULT_PIN_FALL` puts it, so a venue that never opened the screen follows
 * D141 and an action added later reaches every venue at once.
 */
export const PinActionsSchema = z.strictObject(
  Object.fromEntries(PIN_FALL_ACTIONS.map((action) => [action, PinFallSchema.optional()])) as {
    [A in PinFallAction]: z.ZodOptional<typeof PinFallSchema>
  },
)

/** A venue's choices: the actions it has moved, each one 'tap' or 'pin'. */
export type PinActions = z.infer<typeof PinActionsSchema>

/**
 * The choices in a stored value, the code's list deciding: an action the code no longer knows and
 * a value that is neither 'tap' nor 'pin' are ignored rather than taken as a refusal, exactly as a
 * role's stored permissions are read (`grantedPermissions`). A row written before this ticket
 * holds `{}` and so follows the default.
 */
export function storedPinActions(value: unknown): PinActions {
  if (typeof value !== 'object' || value === null) return {}
  const stored = value as Record<string, unknown>
  const chosen: Partial<Record<PinFallAction, PinFall>> = {}
  for (const action of PIN_FALL_ACTIONS) {
    const fall = stored[action]
    if (fall === 'tap' || fall === 'pin') chosen[action] = fall
  }
  return chosen
}

/** Where the venue has put an action: its own choice, else D141's default. */
export function fallOf(chosen: PinActions, action: PinFallAction): PinFall {
  return chosen[action] ?? DEFAULT_PIN_FALL[action]
}

/**
 * The actions that ask for four digits at this venue, in the list's order. The Log writes it as
 * one line, so a night's record says where the PIN fell while it was being kept (D141: because it
 * is configurable, what a PIN in the Log proves can differ between clubs).
 */
export function actionsBehindPin(chosen: PinActions): PinFallAction[] {
  return PIN_FALL_ACTIONS.filter((action) => fallOf(chosen, action) === 'pin')
}

/** True when `reservation.edit` only changes the guest count: the one tap at the door. */
function onlyTheGuestCount(payload: Record<string, unknown>): boolean {
  if (payload.partySize === undefined) return false
  return !['startsAt', 'endsAt', 'turnMinutes', 'note', 'partyLabel'].some(
    (field) => payload[field] !== undefined,
  )
}

/**
 * The action a command is, or null for a command this list does not cover: everything outside
 * reservations, the settings and guest-record commands (a PIN never reaches those), the worker's
 * sweep, and the plan and spots a venue lays out from its own screen.
 */
export function pinFallActionOf(type: string, payload: unknown): PinFallAction | null {
  const fields = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >
  switch (type) {
    case 'reservation.set_status':
    case 'reservation.undo_arrival':
      return 'status'
    case 'reservation.create':
      return fields.kind === 'walk_in' ? 'walk_in' : 'create'
    case 'reservation.edit':
      return onlyTheGuestCount(fields) ? 'guest_count' : 'edit'
    case 'waiting.add':
    case 'waiting.reorder':
      return 'waiting'
    case 'reservation.hold_spots':
    case 'reservation.release_spots':
      return 'spots'
    case 'reservation.cancel':
      return 'cancel'
    case 'reservation.delete':
      return 'delete'
    case 'reservation.restore':
      return 'restore'
    case 'reservation.put_back':
      return 'put_back'
    case 'reservation.copy':
      return 'copy'
    case 'block.save':
    case 'block.remove':
      return 'block'
    case 'reservation_night.close':
      return 'end_night'
    default:
      return null
  }
}

/**
 * The venue's choices, read in the command's own transaction. One primary-key lookup, and only
 * where it can change the answer: a shared device's own account (`actor.kind === 'user'`). A venue
 * with no settings row yet follows the default.
 */
export async function readPinActions(tx: ReadOnly, venueId: string): Promise<PinActions> {
  const [row] = await tx
    .select({ pinActions: reservationSettings.pinActions })
    .from(reservationSettings)
    .where(eq(reservationSettings.venueId, venueId))
  return storedPinActions(row?.pinActions)
}

/** What the venue's "Where the PIN falls" screen draws. */
export interface PinFallSettings {
  /** Where each action falls at this venue: its own choice where it made one, else the default. */
  readonly falls: Readonly<Record<PinFallAction, PinFall>>
  /**
   * True when the venue has reservation settings at all. Without them there is no row to write
   * (the turn time has no default and is set first, #323), so the screen shows the list as it
   * stands and says what is missing instead of inventing a row.
   */
  readonly settingsExist: boolean
}

/** The venue's list, read read-only for the screen. */
export async function readPinFallSettings(
  pool: DbPool,
  input: { readonly tenantId: string; readonly venueId: string },
): Promise<PinFallSettings> {
  const [row] = await withTenant(pool, input.tenantId, (tx) =>
    tx
      .select({ pinActions: reservationSettings.pinActions })
      .from(reservationSettings)
      .where(eq(reservationSettings.venueId, input.venueId)),
  )
  const chosen = storedPinActions(row?.pinActions)
  const falls = Object.fromEntries(
    PIN_FALL_ACTIONS.map((action) => [action, fallOf(chosen, action)]),
  ) as Record<PinFallAction, PinFall>
  return { falls, settingsExist: row !== undefined }
}
