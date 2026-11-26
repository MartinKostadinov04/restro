// What guests may do on the booking page, and the booking that confirms itself (#580; spec #322
// stories 4, 5, 26 and 27; D136; Martin 11-25: the spec's "zone" is an Area).
//
// **The owner's two values** (`reservation_online_guests.set`), settings-class like the rest of
// Settings › Reservations: what guests may do (ask for a night, choose an Area, pick their own
// spot) and whether a booking confirms itself. Three rules hold at the write, so no screen can
// store what the page could not honour:
// - an Area or a spot is offered only once a plan is drawn (`plan_missing`), and an Area only once
//   an offered Area holds a spot (`areas_missing`: a spot reaches its Area through its Table);
// - a booking confirms itself only where the guest picks his own spot (D136), so the switch is on
//   only while the choice is "pick their spot" (`auto_confirm_needs_spot`), and moving the choice
//   off "pick their spot" turns it off in the same write — Undo sends both values back;
// - setting what is already set writes nothing.
//
// **The guest's pick** (`guestPickOf`), read by `requestReservation`: an Area only when Areas are
// offered and it is one of them, spots only when spots are offered and each is on a drawn plan;
// anything else is `choice_not_offered` or `area_missing` / `spot_missing`. The spots themselves
// are claimed by the booking rule the staff's own form goes through (`claimSpots`), under the
// night's lock (`openNight`), so of two guests racing for one spot exactly one is written and the
// other is refused `spot_taken`.
//
// **Confirming itself** (`confirmOwnPick`): with the switch on and a spot picked, the request is
// written Requested and moved to Reserved in the same command, with its own Log entry, so the
// worker's check for the confirmed email (the latest `reservation.status` entry) reads the same as
// after a hostess's Confirm (#578). The email is owed through `stx.oweGuestEmail`, so the caller's
// `queueJobs` queues it in the same transaction (#592). Without a spot it stays Requested, whatever
// the switch says.

import { reservationSettings, reservations } from '@restro/db'
import { eq, sql } from 'drizzle-orm'

import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { bookingPlanOf } from './booking-plan'
import { guestEmailOwed } from './guest-email'
import { type GuestMay, type OnlineSettings, readOnlineSettings } from './online-settings'
import { lockSettings, refuse } from './rows'

/** What the owner's command sets: either value, or both. */
export interface OnlineGuestsCommand {
  readonly guestMay?: GuestMay
  readonly autoConfirm?: boolean
}

/** The Log's word for each choice. */
const GUEST_MAY_STATES: Readonly<Record<GuestMay, string>> = {
  night: 'guests_may_night',
  area: 'guests_may_area',
  spot: 'guests_may_spot',
}

/** Sets what guests may do on the booking page, and whether a booking confirms itself. */
export async function setOnlineGuests(
  stx: ServiceTx,
  command: OnlineGuestsCommand,
): Promise<ServiceResult> {
  // Locked: `online` is written back whole, so two changes at once must queue (C7).
  const existing = await lockSettings(stx)
  if (existing === null) return refuse('settings_missing')
  const online = readOnlineSettings(existing.online)
  const guestMay = command.guestMay ?? online.guestMay
  // Leaving "pick their spot" leaves nothing the switch could apply to (D136).
  const autoConfirm = guestMay === 'spot' ? (command.autoConfirm ?? online.autoConfirm) : false
  if (command.autoConfirm === true && guestMay !== 'spot') return refuse('auto_confirm_needs_spot')
  const details = { guestMay, autoConfirm }
  if (guestMay === online.guestMay && autoConfirm === online.autoConfirm) {
    return accepted(null, { details })
  }
  if (guestMay !== online.guestMay && guestMay !== 'night') {
    const offer = await bookingPlanOf(stx.tx, stx.venueId)
    if (!offer.plans.some((plan) => plan.spots.length > 0)) return refuse('plan_missing')
    if (guestMay === 'area' && offer.areas.length === 0) return refuse('areas_missing')
  }
  await stx.tx
    .update(reservationSettings)
    .set({
      online: { ...online, guestMay, autoConfirm },
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservationSettings.venueId, stx.venueId))
  if (guestMay !== online.guestMay) {
    await stx.log({
      kind: 'reservation_settings.changed',
      toState: GUEST_MAY_STATES[guestMay],
      details,
    })
  }
  if (autoConfirm !== online.autoConfirm) {
    await stx.log({
      kind: 'reservation_settings.changed',
      toState: autoConfirm ? 'auto_confirm_on' : 'auto_confirm_off',
      details,
    })
  }
  return accepted(null, { details })
}

/** What a guest's request may name beyond the night. */
export interface GuestPickInput {
  readonly areaId?: string | null
  readonly spotIds?: readonly string[]
}

/** The pick a request goes on with, or why it cannot. */
export type GuestPick =
  | { readonly ok: true; readonly areaId: string | null; readonly spotIds: readonly string[] }
  | { readonly ok: false; readonly code: string }

/** Checks what the guest picked against what the venue offers today. */
export async function guestPickOf(
  stx: ServiceTx,
  online: OnlineSettings,
  input: GuestPickInput,
): Promise<GuestPick> {
  const areaId = input.areaId ?? null
  const spotIds = [...new Set(input.spotIds ?? [])]
  if (areaId === null && spotIds.length === 0) return { ok: true, areaId: null, spotIds: [] }
  if (areaId !== null && online.guestMay !== 'area')
    return { ok: false, code: 'choice_not_offered' }
  if (spotIds.length > 0 && online.guestMay !== 'spot') {
    return { ok: false, code: 'choice_not_offered' }
  }
  const offer = await bookingPlanOf(stx.tx, stx.venueId)
  if (areaId !== null && !offer.areas.some((area) => area.id === areaId)) {
    return { ok: false, code: 'area_missing' }
  }
  const drawn = new Set(offer.plans.flatMap((plan) => plan.spots.map((spot) => spot.id)))
  if (spotIds.some((spotId) => !drawn.has(spotId))) return { ok: false, code: 'spot_missing' }
  return { ok: true, areaId, spotIds }
}

/** True when the request confirms itself: the switch on, "pick their spot", and a spot picked. */
export function confirmsItself(online: OnlineSettings, spotIds: readonly string[]): boolean {
  return online.autoConfirm && online.guestMay === 'spot' && spotIds.length > 0
}

/**
 * Moves the request just written from Requested to Reserved, logs the move, and owes the guest his
 * confirmed email (#578) in the same transaction. Call it right after the request's own entry.
 */
export async function confirmOwnPick(
  stx: ServiceTx,
  request: {
    readonly reservationId: string
    readonly serviceDate: string
    readonly guestId: string
    readonly spotIds: readonly string[]
  },
): Promise<void> {
  await stx.tx
    .update(reservations)
    .set({ status: 'reserved', ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(reservations.id, request.reservationId))
  stx.touchNight(request.serviceDate)
  await stx.log({
    kind: 'reservation.status',
    reservationId: request.reservationId,
    guestId: request.guestId,
    fromState: 'requested',
    toState: 'reserved',
    reason: 'auto_confirm',
    details: { spots: request.spotIds.join(','), spotsChanged: false },
  })
  const owed = await guestEmailOwed(
    stx,
    { kind: 'booking', guestId: request.guestId },
    'reservation_confirmed',
  )
  if (typeof owed.guestEmailEntry !== 'number') return
  stx.oweGuestEmail({
    reservationId: request.reservationId,
    kind: 'reservation_confirmed',
    entry: owed.guestEmailEntry,
  })
}
