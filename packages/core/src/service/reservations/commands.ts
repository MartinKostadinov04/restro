// Every reservation command, as the service engine sees it (ticket #323; D122 §9, design §2.1).
// `RESERVATION_COMMANDS` is spread into `SERVICE_COMMANDS`, so **every** write to the reservation
// tables goes through `applyService`, with its origins, permission, provenance, row locks,
// idempotency and Log entry (rule 1). Nothing else writes them; the write-target guard
// (`write-targets.test.ts`) fails the build if anything tries.
//
// The permissions are D141's eight, no more:
// - `reservations.tonight` — the hostess's taps: arrivals, the waiting list, the plan's spots;
// - `reservations.manage` — the booking book: create, edit, cancel, take out, restore, copy;
// - `reservations.block` — blocking and unblocking spots;
// - `reservations.end_night` — ending the night (D138);
// - `reservations.edit_past` — not a command's own key: the handler reads it when the night it is
//   asked to write has already passed (`nightWritable`), so the same command serves both cases;
// - `reservations.pay_rule` — part 2's (ticket #334), on this list but on no command here;
// - `settings.reservations`, `settings.guests` — the plan, the spots, the settings and the guest
//   records; settings-class, so a PIN on a shared device never reaches them (`isSettingsPermission`).
//
// **Where the PIN falls is D141's own rule:** "if the tap only says where people are sitting
// tonight, it is a tap; if it writes the booking book, touches money, touches a guest's details or
// ends the night, it is four digits." So `quickOnSharedDevice` is set on the six taps — the status
// moves and their Undo, the spots held and freed, the waiting list and its order — and on nothing
// else: the booking book, the blocks and the night's end ask for the PIN on a shared device, and
// the settings-class two for the person's own sign-in. Which commands are quick is pinned in
// `commands.test.ts`.
//
// **No guest event is recorded by any command here.** T84's event model (D142) is the guest
// phone's: its nine kinds are the menu, the bag, Send, paying, a waiter call and the language, each
// one a tap on the guest page. A reservation is staff work, and what it leaves behind is a Log
// entry (D141) — so there is no kind here to emit, and inventing one would be the second answer to
// a question D142 settles. A later ticket that wants reservations in the night's numbers adds its
// kinds to T84's model first.
//
// Nothing here calls a POS (D134, rule 7): no connector is imported by any module in this folder,
// and `connectors-only-from-worker` in `.dependency-cruiser.cjs` already forbids it from `core`.

import { z } from 'zod'

import { idSchema } from '../../ids'
import { SPOT_PLACE_FIELDS, SPOT_SYMBOLS, spotPlaceIssues } from '../../spot-shapes'
import { type CommandDefinition, defineCommand } from '../definition'
import {
  cancelReservation,
  copyReservation,
  createReservation,
  deleteReservation,
  editReservation,
  restoreReservation,
} from './book'
import { addClosedDate, ClosedDateSchema, removeClosedDate } from './closed-dates'
import { eraseGuest, saveGuest, setGuestPrivateNote } from './guests'
import { closeReservationNight, sweepReservationNight } from './night'
import { TurnMinutesSchema } from './overlap'
import { PinActionsSchema } from './pin-fall'
import {
  removePlan,
  removeSpot,
  removeSpotKind,
  savePlan,
  saveSpot,
  saveSpotKind,
  setSpotSeats,
} from './plan'
import { setReservationSettings } from './settings'
import {
  addToWaitingList,
  holdReservationSpots,
  putBackReservation,
  releaseReservationSpots,
  removeBlock,
  reorderWaitingList,
  saveBlock,
  setReservationStatus,
  undoReservationArrival,
} from './tonight'

const reservationId = idSchema('rv')
const spotId = idSchema('sp')
const planId = idSchema('fp')
const guestId = idSchema('gu')

/** A venue's service day, as the caller names the night (D45: never a calendar date). */
const serviceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** An hour on the clock, as an instant: the caller's time zone work is already done. */
const instant = z.iso.datetime()

/** A short code, never free text: a reason, a spot kind, a status. */
const code = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

/** A name staff type. Trimmed length is checked by the column itself. */
const name = z.string().trim().min(1).max(60)

/** The spots a command names, in the order the person tapped them (the refusal names the first). */
const spotIds = z.array(spotId).max(40)

/** A note staff type: never a phone number or an email (those live on the guest record, D140). */
const note = z.string().max(500).nullable()

/** How the caller names the party: the venue's record, a number, or a name on the book. */
const party = {
  guestId: guestId.optional(),
  phone: z.string().min(6).max(40).optional(),
  guestName: z.string().trim().min(1).max(80).optional(),
  partyLabel: z.string().trim().min(1).max(80).optional(),
}

/** A party size; a block carries none. */
const partySize = z.number().int().min(1).max(500)

/**
 * The status a command may move a reservation to: every one of the eight **except** Requested,
 * which exists in the data and in the machine for part 2 and which nothing in part 1 creates
 * (D136). Listed rather than filtered, so the type a handler gets is the union itself.
 */
const StatusSchema = z.enum([
  'reserved',
  'waiting',
  'seated',
  'finished',
  'no_show',
  'cancelled',
  'not_seated',
])

/** The reservation commands, by type. */
export const RESERVATION_COMMANDS = {
  // --- The plan, its spots and the venue's spot kinds (settings work) ------------------------
  'plan.save': defineCommand({
    schema: z.strictObject({
      type: z.literal('plan.save'),
      planId: planId.optional(),
      name,
      makeCurrent: z.boolean().optional(),
    }),
    origins: ['staff'],
    permission: 'settings.reservations',
    idempotency: 'by_nature',
    handle: savePlan,
  }),
  'plan.remove': defineCommand({
    schema: z.strictObject({ type: z.literal('plan.remove'), planId }),
    origins: ['staff'],
    permission: 'settings.reservations',
    idempotency: 'by_nature',
    handle: removePlan,
  }),
  'spot.save': defineCommand({
    // The shape folder's own check (#327): a shape it does not hold, a spot off the plan's grid, a
    // circle that is not round or a rotation on one it would not turn is refused here, by its own
    // code, instead of reaching the column constraints.
    schema: z
      .strictObject({
        type: z.literal('spot.save'),
        spotId: spotId.optional(),
        planId,
        name: z.string().trim().min(1).max(40),
        kind: code,
        ...SPOT_PLACE_FIELDS,
        seats: z.number().int().min(1).max(100).nullable().optional(),
        tableId: idSchema('tb').nullable().optional(),
      })
      .superRefine(spotPlaceIssues),
    origins: ['staff'],
    permission: 'settings.reservations',
    idempotency: 'by_nature',
    handle: saveSpot,
  }),
  'spot.remove': defineCommand({
    schema: z.strictObject({ type: z.literal('spot.remove'), spotId }),
    origins: ['staff'],
    permission: 'settings.reservations',
    idempotency: 'by_nature',
    handle: removeSpot,
  }),
  // A spot's seats alone (#325): the one thing the venue's own settings change on a spot, since
  // part 1 ships no plan editor. Empty seats put the spot back on its kind's default.
  'spot.set_seats': defineCommand({
    schema: z.strictObject({
      type: z.literal('spot.set_seats'),
      spotId,
      seats: z.number().int().min(1).max(100).nullable(),
    }),
    origins: ['staff'],
    permission: 'settings.reservations',
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: setSpotSeats,
  }),
  // The venue's one-off closed dates (#325; D136): the venue's own service hours are not copied
  // here, only the nights it is shut on top of them. The list is one value of the settings row, so
  // two changes queue on the venue's row instead of overwriting each other.
  'reservation_closed_date.add': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation_closed_date.add'),
      date: ClosedDateSchema,
    }),
    origins: ['staff'],
    permission: 'settings.reservations',
    freshSignIn: true,
    venueLock: 'update',
    idempotency: 'by_nature',
    handle: addClosedDate,
  }),
  'reservation_closed_date.remove': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation_closed_date.remove'),
      date: ClosedDateSchema,
    }),
    origins: ['staff'],
    permission: 'settings.reservations',
    freshSignIn: true,
    venueLock: 'update',
    idempotency: 'by_nature',
    handle: removeClosedDate,
  }),
  'spot_kind.save': defineCommand({
    schema: z.strictObject({
      type: z.literal('spot_kind.save'),
      key: code,
      label: z.string().trim().min(1).max(40),
      /** Its legend symbol (#327): a name out of the folder's list, never a picture of its own. */
      symbol: z.enum(SPOT_SYMBOLS).optional(),
      /** Whether the plan offers this kind as a filter (D134). */
      filters: z.boolean().optional(),
      defaultSeats: z.number().int().min(1).max(100).nullable().optional(),
      sortKey: z
        .string()
        .regex(/^[A-Za-z][0-9A-Za-z]*$/)
        .max(40)
        .optional(),
    }),
    origins: ['staff'],
    permission: 'settings.reservations',
    idempotency: 'by_nature',
    handle: saveSpotKind,
  }),
  'spot_kind.remove': defineCommand({
    schema: z.strictObject({ type: z.literal('spot_kind.remove'), key: code }),
    origins: ['staff'],
    permission: 'settings.reservations',
    idempotency: 'by_nature',
    handle: removeSpotKind,
  }),
  // --- The venue's reservation settings --------------------------------------------------------
  // The turn time is one value (D135). `pin_actions` is where the PIN falls (#324, below);
  // `online` (#325) gets its defaults when the row is made and is not written again from here.
  'reservation_settings.set': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation_settings.set'),
      turnMinutes: TurnMinutesSchema.max(1440).optional(),
      editPastNights: z.boolean().optional(),
      privateNotesOn: z.boolean().optional(),
      phoneRequired: z.boolean().optional(),
      // Where the PIN falls (D141, #324): the actions this call moves. An action left out keeps
      // what the venue had, and one it never chose follows D141's default.
      pinActions: PinActionsSchema.optional(),
    }),
    origins: ['staff'],
    permission: 'settings.reservations',
    // A settings-class change: the password is asked again after a stale sign-in (D122 §7, #325).
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: setReservationSettings,
  }),
  // --- The guest records (D140) ----------------------------------------------------------------
  'guest.save': defineCommand({
    schema: z.strictObject({
      type: z.literal('guest.save'),
      guestId: guestId.optional(),
      phone: z.string().min(6).max(40).optional(),
      name: z.string().trim().min(1).max(80).nullable().optional(),
      email: z.string().max(200).nullable().optional(),
      note: note.optional(),
      isRegular: z.boolean().optional(),
      archived: z.boolean().optional(),
    }),
    origins: ['staff'],
    permission: 'settings.guests',
    idempotency: 'by_nature',
    handle: saveGuest,
  }),
  // A manager's own private note, which other staff never read (D140): the privacy is the read's,
  // because the row is keyed by the staff member whose note it is.
  'guest.private_note': defineCommand({
    schema: z.strictObject({
      type: z.literal('guest.private_note'),
      guestId,
      note,
    }),
    origins: ['staff'],
    permission: 'settings.guests',
    idempotency: 'by_nature',
    handle: setGuestPrivateNote,
  }),
  // Erasing somebody cannot be taken back, so it asks for the password again on top of the
  // person's own sign-in (D122 §7's `freshSignIn`, which `settings.guests` already implies for the
  // sign-in itself).
  'guest.erase': defineCommand({
    schema: z.strictObject({ type: z.literal('guest.erase'), guestId }),
    origins: ['staff'],
    permission: 'settings.guests',
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: eraseGuest,
  }),
  // --- The booking book ------------------------------------------------------------------------
  'reservation.create': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation.create'),
      serviceDate,
      startsAt: instant,
      endsAt: instant.nullable().optional(),
      turnMinutes: TurnMinutesSchema.max(1440).nullable().optional(),
      kind: z.enum(['booking', 'walk_in']),
      status: z.enum(['reserved', 'waiting', 'seated']),
      partySize,
      note: note.optional(),
      spotIds: spotIds.optional(),
      ...party,
    }),
    origins: ['staff'],
    permission: 'reservations.manage',
    idempotency: 'by_nature',
    handle: createReservation,
  }),
  'reservation.edit': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation.edit'),
      reservationId,
      startsAt: instant.optional(),
      endsAt: instant.nullable().optional(),
      turnMinutes: TurnMinutesSchema.max(1440).nullable().optional(),
      partySize: partySize.optional(),
      note: note.optional(),
      partyLabel: z.string().trim().min(1).max(80).nullable().optional(),
    }),
    origins: ['staff'],
    permission: 'reservations.manage',
    idempotency: 'by_nature',
    handle: editReservation,
  }),
  'reservation.cancel': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation.cancel'),
      reservationId,
      reason: code.nullable().optional(),
    }),
    origins: ['staff'],
    permission: 'reservations.manage',
    idempotency: 'by_nature',
    handle: cancelReservation,
  }),
  // D135's "delete": the line leaves the night's list without becoming a cancellation nobody made.
  // The row stays (app code deletes nothing), so Restore can put it back and the Log still names it.
  'reservation.delete': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation.delete'),
      reservationId,
      reason: code.nullable().optional(),
    }),
    origins: ['staff'],
    permission: 'reservations.manage',
    idempotency: 'by_nature',
    handle: deleteReservation,
  }),
  'reservation.restore': defineCommand({
    schema: z.strictObject({ type: z.literal('reservation.restore'), reservationId }),
    origins: ['staff'],
    permission: 'reservations.manage',
    idempotency: 'by_nature',
    handle: restoreReservation,
  }),
  'reservation.copy': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation.copy'),
      reservationId,
      serviceDate,
      startsAt: instant,
    }),
    origins: ['staff'],
    permission: 'reservations.manage',
    idempotency: 'by_nature',
    handle: copyReservation,
  }),
  // --- Tonight's floor -------------------------------------------------------------------------
  'reservation.set_status': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation.set_status'),
      reservationId,
      status: StatusSchema,
      reason: code.nullable().optional(),
    }),
    origins: ['staff'],
    permission: 'reservations.tonight',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    undoable: { kinds: ['reservation.status'] },
    handle: setReservationStatus,
  }),
  'reservation.put_back': defineCommand({
    schema: z.strictObject({ type: z.literal('reservation.put_back'), reservationId }),
    origins: ['staff'],
    permission: 'reservations.tonight',
    idempotency: 'by_nature',
    handle: putBackReservation,
  }),
  // The Undo of an arrival (D135): where the party came from is read from the Log, never from a
  // second copy on the row (D141).
  'reservation.undo_arrival': defineCommand({
    schema: z.strictObject({ type: z.literal('reservation.undo_arrival'), reservationId }),
    origins: ['staff'],
    permission: 'reservations.tonight',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: undoReservationArrival,
  }),
  'reservation.hold_spots': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation.hold_spots'),
      reservationId,
      spotIds: spotIds.min(1),
    }),
    origins: ['staff'],
    permission: 'reservations.tonight',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: holdReservationSpots,
  }),
  // How a party whose bill closed is let go of early: nothing about the bill does it (D134).
  'reservation.release_spots': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation.release_spots'),
      reservationId,
      spotIds: spotIds.optional(),
    }),
    origins: ['staff'],
    permission: 'reservations.tonight',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: releaseReservationSpots,
  }),
  // The waiting list is a queue on `reservations`, not a table (D137): a walk-in with the Waiting
  // status and a fractional queue key.
  'waiting.add': defineCommand({
    schema: z.strictObject({
      type: z.literal('waiting.add'),
      serviceDate,
      partySize,
      note: note.optional(),
      ...party,
    }),
    origins: ['staff'],
    permission: 'reservations.tonight',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: addToWaitingList,
  }),
  'waiting.reorder': defineCommand({
    schema: z.strictObject({
      type: z.literal('waiting.reorder'),
      reservationId,
      afterId: reservationId.nullable().optional(),
      beforeId: reservationId.nullable().optional(),
    }),
    origins: ['staff'],
    permission: 'reservations.tonight',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: reorderWaitingList,
  }),
  // --- Blocks (D137: a block is a reservation of its own kind) ---------------------------------
  'block.save': defineCommand({
    schema: z.strictObject({
      type: z.literal('block.save'),
      reservationId: reservationId.optional(),
      serviceDate,
      startsAt: instant,
      endsAt: instant.nullable().optional(),
      spotIds: spotIds.min(1),
      reason: code.nullable().optional(),
      note: note.optional(),
    }),
    origins: ['staff'],
    permission: 'reservations.block',
    idempotency: 'by_nature',
    handle: saveBlock,
  }),
  'block.remove': defineCommand({
    schema: z.strictObject({
      type: z.literal('block.remove'),
      reservationId,
      reason: code.nullable().optional(),
    }),
    origins: ['staff'],
    permission: 'reservations.block',
    idempotency: 'by_nature',
    handle: removeBlock,
  }),
  // --- The night's record (D138) ---------------------------------------------------------------
  // The count of bills still open at an early end is the caller's: the bills are the ordering
  // side's, and no reservation module reads one (D134).
  'reservation_night.close': defineCommand({
    schema: z.strictObject({
      type: z.literal('reservation_night.close'),
      serviceDate,
      early: z.boolean().optional(),
      openBills: z.number().int().min(0).nullable().optional(),
    }),
    origins: ['staff'],
    permission: 'reservations.end_night',
    idempotency: 'by_nature',
    handle: closeReservationNight,
  }),
  // The one reservation command the worker runs: Not seated is reachable no other way (D138). A
  // worker actor holds no permission, so this command needs none — and holds none, which is why it
  // can do nothing but mark the parties the night left waiting.
  'reservation_night.sweep': defineCommand({
    schema: z.strictObject({ type: z.literal('reservation_night.sweep'), serviceDate }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: sweepReservationNight,
  }),
} as const satisfies Record<string, CommandDefinition>
