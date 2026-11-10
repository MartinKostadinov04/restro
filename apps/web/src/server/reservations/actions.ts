'use server'

// The actions of Venue › Reservations that the browser calls: the night's list, which keeps itself
// current while the night is on, one reservation's sheet, the floor plan with one spot's history
// (#327), the two writes the plan offers — block a spot and lift a block — and the booking's own
// (#328): the form's advice, and taking, changing, calling off, taking out, bringing back and
// copying a booking, and marking a no-show. Each one checks its
// input with Zod, finds who is asking (`requireTenant`: the tenant is the person's organisation,
// never the request's) and that the venue is theirs, then reads or writes as that signed-in account
// (or, on a shared device, as the person a PIN names). The service side checks the permission again:
// `reservations.tonight` to read, `reservations.block` to write. A failure is a plain `{ ok: false }`
// with the detail in the log, never on the screen.
import { addDaysToDay, idSchema, localInstant, serviceDate } from '@restro/core'
import type { Venue } from '@restro/db'
import { z } from 'zod'

import { BLOCK_REASONS } from '@/reservations/block-reasons'
import { BOOKING_REASONS } from '@/reservations/booking-reasons'

import { logError } from '../log'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import {
  loadBookingChecks,
  loadFloorPlan,
  loadGuestCard,
  loadGuestList,
  loadGuestSuggestions,
  loadReservationDetail,
  loadReservationNight,
  loadSpotHistory,
  type RvScope,
} from './load'
import type {
  RvChecksView,
  RvDetailView,
  RvFrame,
  RvGuestCardView,
  RvGuestListView,
  RvNightView,
  RvPlanView,
  RvSpotHistoryList,
} from './view'
import { invalidWrite, performReservationWrite, type RvWriteResult } from './write'

const venueId = idSchema('vn')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const Night = z.strictObject({ venueId, day: day.optional() })
const One = z.strictObject({ venueId, reservationId: idSchema('rv') })

/** What a read answers: the data and the frame, or that it could not be read. */
export type RvAnswer<T> =
  | ({ readonly ok: true; readonly frame: RvFrame } & T)
  | { readonly ok: false }

const FAILED = { ok: false } as const

/** The scope of the signed-in account for one of its venues, or null. */
async function scopeOf(id: string): Promise<(RvScope & { readonly venue: Venue }) | null> {
  const { organization, user, sessionId } = await requireTenant()
  const venue = await getVenue(organization.id, id)
  if (!venue) return null
  return {
    tenantId: organization.id,
    venue,
    actor: { kind: 'user', userId: user.id, sessionId },
  }
}

async function answer<T>(
  event: string,
  run: () => Promise<RvAnswer<T> | { readonly ok: false; readonly code: string }>,
): Promise<RvAnswer<T>> {
  try {
    const result = await run()
    return result.ok ? result : FAILED
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError(event, error)
    return FAILED
  }
}

/** One night's list of reservations. */
export async function reservationNightAction(
  input: unknown,
): Promise<RvAnswer<{ night: RvNightView }>> {
  const parsed = Night.safeParse(input)
  if (!parsed.success) return FAILED
  const { venueId: id, day: asked } = parsed.data
  return answer('reservations_night_failed', async () => {
    const scope = await scopeOf(id)
    if (scope === null) return FAILED
    return loadReservationNight(scope, asked === undefined ? {} : { day: asked })
  })
}

/** One reservation's sheet. */
export async function reservationDetailAction(
  input: unknown,
): Promise<RvAnswer<{ detail: RvDetailView | null }>> {
  const parsed = One.safeParse(input)
  if (!parsed.success) return FAILED
  return answer('reservation_detail_failed', async () => {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    return loadReservationDetail(scope, parsed.data.reservationId)
  })
}

// ───────────────────────────────── the floor plan (#327) ─────────────────────────────────

const Plan = z.strictObject({ venueId, day: day.optional(), planId: idSchema('fp').optional() })
const SpotHistory = z.strictObject({ venueId, spotId: idSchema('sp') })

/** One plan on one night: the spots, their states, and what holds them. */
export async function floorPlanAction(input: unknown): Promise<RvAnswer<{ plan: RvPlanView }>> {
  const parsed = Plan.safeParse(input)
  if (!parsed.success) return FAILED
  const { venueId: id, ...query } = parsed.data
  return answer('reservations_plan_failed', async () => {
    const scope = await scopeOf(id)
    if (scope === null) return FAILED
    return loadFloorPlan(scope, query)
  })
}

/** One spot's history, from the one Log (D141). */
export async function spotHistoryAction(
  input: unknown,
): Promise<RvAnswer<{ history: RvSpotHistoryList }>> {
  const parsed = SpotHistory.safeParse(input)
  if (!parsed.success) return FAILED
  return answer('spot_history_failed', async () => {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    return loadSpotHistory(scope, parsed.data.spotId)
  })
}

/** A staff member's 4-digit PIN, entered on a shared device (D141). */
const pin = z
  .string()
  .regex(/^\d{4}$/)
  .optional()

const Block = z.strictObject({
  venueId,
  spotId: idSchema('sp'),
  /** Required (D137), and one of the reasons the screen offers. */
  reason: z.enum(BLOCK_REASONS),
  /** The first night of the block; left out, it starts now. */
  from: day.optional(),
  /** The last night of the block; left out, it stays on until somebody lifts it. */
  until: day.optional(),
  pin,
})
const Unblock = z.strictObject({ venueId, reservationId: idSchema('rv'), pin })

/**
 * Takes one spot out of use (D137): a reservation of the block kind on that spot, with its reason.
 * With no dates it begins now and stays on until somebody lifts it; with dates it covers whole
 * nights of the venue's own clock (D45), the last one included. The service write path refuses it
 * where a party is already booked and names them, which the screen's toast reads.
 */
export async function blockSpotAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Block.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, spotId, reason, from, until, pin: typed } = parsed.data
  return performReservationWrite(
    { venueId: id, ...(typed === undefined ? {} : { pin: typed }) },
    (venue) => {
      const now = new Date()
      const today = serviceDate(now, venue.timezone, venue.serviceDayEndsAt)
      const night = from ?? today
      return {
        type: 'block.save',
        serviceDate: night,
        startsAt: (from === undefined
          ? now
          : localInstant(night, venue.serviceDayEndsAt, venue.timezone, venue.serviceDayEndsAt)
        ).toISOString(),
        // The night a block's last day belongs to ends the morning after it (D45).
        endsAt:
          until === undefined
            ? null
            : localInstant(
                addDaysToDay(until, 1),
                venue.serviceDayEndsAt,
                venue.timezone,
                venue.serviceDayEndsAt,
              ).toISOString(),
        spotIds: [spotId],
        reason,
      }
    },
  )
}

/** Puts a blocked spot back: one tap for the same permission (#327). */
export async function unblockSpotAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Unblock.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, reservationId: block, pin: typed } = parsed.data
  return performReservationWrite(
    { venueId: id, ...(typed === undefined ? {} : { pin: typed }) },
    { type: 'block.remove', reservationId: block, reason: 'block_lifted' },
  )
}

// ───────────────────────────── taking and changing a booking (#328) ─────────────────────────────

/** An hour on the venue's clock, `HH:mm`: the night it belongs to is the form's own. */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const spotList = z.array(idSchema('sp')).max(40)
const partyCount = z.number().int().min(1).max(500)

const Checks = z.strictObject({
  venueId,
  day,
  time: hhmm,
  until: hhmm.nullable().optional(),
  partySize: partyCount.nullable().optional(),
  name: z.string().max(80).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  spotIds: spotList,
  reservationId: idSchema('rv').optional(),
})

/**
 * What the booking form is told while it is typed: the warnings that never block a save (more
 * guests than seats, the same name or phone twice that night, an hour outside the venue's hours),
 * and the two things the write would refuse — a spot somebody holds, a night that cannot be
 * written — so she sees them before Save rather than after.
 */
export async function bookingChecksAction(
  input: unknown,
): Promise<{ readonly ok: true; readonly checks: RvChecksView } | { readonly ok: false }> {
  const parsed = Checks.safeParse(input)
  if (!parsed.success) return FAILED
  const {
    venueId: id,
    day: night,
    time,
    until,
    partySize,
    name,
    phone,
    spotIds,
    reservationId,
  } = parsed.data
  try {
    const scope = await scopeOf(id)
    if (scope === null) return FAILED
    const clock = (at: string) =>
      localInstant(night, at, scope.venue.timezone, scope.venue.serviceDayEndsAt)
    const result = await loadBookingChecks(scope, {
      day: night,
      startsAt: clock(time),
      endsAt: until == null ? null : clock(until),
      partySize: partySize ?? null,
      name: name ?? null,
      phone: phone ?? null,
      spotIds,
      ...(reservationId === undefined ? {} : { reservationId }),
    })
    return result.ok ? result : FAILED
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    logError('reservation_checks_failed', error)
    return FAILED
  }
}

const Save = z.strictObject({
  venueId,
  /** Present when an existing booking is being changed. */
  reservationId: idSchema('rv').optional(),
  /** The version the form was opened on, for an existing booking. */
  version: z.iso.datetime().optional(),
  day,
  time: hhmm,
  until: hhmm.nullable().optional(),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(40).nullable().optional(),
  partySize: partyCount,
  spotIds: spotList,
  note: z.string().trim().max(500).nullable().optional(),
  reason: z.enum(BOOKING_REASONS).nullable().optional(),
  /** On an edit: which of name and phone the person actually changed. Left alone, they stay. */
  changed: z.strictObject({ name: z.boolean(), phone: z.boolean() }).optional(),
  /** A new booking's "Save to the regulars" tick (#333); it needs a phone, the record's key. */
  saveAsRegular: z.boolean().optional(),
  pin,
})

const Booked = z.strictObject({ venueId, reservationId: idSchema('rv'), pin })

const Copy = z.strictObject({
  venueId,
  reservationId: idSchema('rv'),
  day,
  time: hhmm,
  until: hhmm.nullable().optional(),
  spotIds: spotList,
  pin,
})

/** The hours of a night as instants, on the venue's own clock and service day (D45). */
function instantsOf(
  venue: { readonly timezone: string; readonly serviceDayEndsAt: string },
  night: string,
  time: string,
  until: string | null | undefined,
) {
  const at = (hour: string) =>
    localInstant(night, hour, venue.timezone, venue.serviceDayEndsAt).toISOString()
  return { startsAt: at(time), endsAt: until == null ? null : at(until) }
}

const withPin = (typed: string | undefined) => (typed === undefined ? {} : { pin: typed })

/**
 * Takes a booking, or changes one the form was opened on. The phone and the name are the guest's
 * when there is a number (the record holds them, D140) and the booking's own when there is none;
 * the service path decides which, and refuses a missing phone where the venue requires one. Taking
 * a booking is `reservations.tonight`; changing one is `reservations.manage` — both checked
 * inside the transaction, never here.
 */
export async function saveBookingAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Save.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const body = parsed.data
  const phone =
    body.phone === undefined || body.phone === null || body.phone === '' ? null : body.phone
  if (body.reservationId === undefined) {
    return performReservationWrite({ venueId: body.venueId, ...withPin(body.pin) }, (venue) => ({
      type: 'reservation.create',
      serviceDate: body.day,
      ...instantsOf(venue, body.day, body.time, body.until),
      kind: 'booking',
      status: 'reserved',
      partySize: body.partySize,
      note: body.note ?? null,
      reason: body.reason ?? null,
      spotIds: body.spotIds,
      ...(phone === null ? { partyLabel: body.name } : { phone, guestName: body.name }),
      ...(body.saveAsRegular === true && phone !== null ? { saveAsRegular: true } : {}),
    }))
  }
  const reservationId = body.reservationId
  const changed = body.changed ?? { name: true, phone: true }
  return performReservationWrite({ venueId: body.venueId, ...withPin(body.pin) }, (venue) => ({
    type: 'reservation.edit',
    reservationId,
    ...(body.version === undefined ? {} : { expectedVersion: body.version }),
    ...instantsOf(venue, body.day, body.time, body.until),
    partySize: body.partySize,
    note: body.note ?? null,
    // Left out, the reason stays as it was (a stored code the form does not offer is not wiped).
    ...(body.reason === undefined ? {} : { reason: body.reason }),
    spotIds: body.spotIds,
    ...(changed.name ? { name: body.name } : {}),
    ...(changed.phone ? { phone } : {}),
  }))
}

/** Calls a booking off: the guest's doing, so it stays on the night as Cancelled (D135). */
export async function cancelBookingAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Booked.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, reservationId, pin: typed } = parsed.data
  return performReservationWrite(
    { venueId: id, ...withPin(typed) },
    { type: 'reservation.cancel', reservationId },
  )
}

/** Takes a booking out of the book: one that should never have existed. The Log keeps who. */
export async function deleteBookingAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Booked.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, reservationId, pin: typed } = parsed.data
  return performReservationWrite(
    { venueId: id, ...withPin(typed) },
    { type: 'reservation.delete', reservationId },
  )
}

/** Brings a deleted booking back; it comes back without a spot somebody took meanwhile. */
export async function restoreBookingAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Booked.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, reservationId, pin: typed } = parsed.data
  return performReservationWrite(
    { venueId: id, ...withPin(typed) },
    { type: 'reservation.restore', reservationId },
  )
}

/** Copies a booking to another night, with the spots chosen for that night. */
export async function copyBookingAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Copy.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, reservationId, day: night, time, until, spotIds, pin: typed } = parsed.data
  return performReservationWrite({ venueId: id, ...withPin(typed) }, (venue) => ({
    type: 'reservation.copy',
    reservationId,
    serviceDate: night,
    ...instantsOf(venue, night, time, until),
    spotIds,
  }))
}

/** Marks a party that never came: one tap, a floor tap (D141), and the Undo is putting it back. */
export async function noShowAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Booked.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, reservationId, pin: typed } = parsed.data
  return performReservationWrite(
    { venueId: id, ...withPin(typed) },
    { type: 'reservation.set_status', reservationId, status: 'no_show' },
  )
}

/** The Undo of a no-show: the party goes back to Coming. */
export async function putBackAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Booked.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, reservationId, pin: typed } = parsed.data
  return performReservationWrite(
    { venueId: id, ...withPin(typed) },
    { type: 'reservation.put_back', reservationId },
  )
}

// ───────────────────────────── guests and regulars (#333) ─────────────────────────────

const guestId = idSchema('gu')
const OneGuest = z.strictObject({ venueId, guestId })
const Suggest = z.strictObject({ venueId, query: z.string().max(80) })

/** The venue's list of guests, as the person reads it (D140). */
export async function guestListAction(
  input: unknown,
): Promise<RvAnswer<{ guests: RvGuestListView }>> {
  const parsed = z.strictObject({ venueId }).safeParse(input)
  if (!parsed.success) return FAILED
  return answer('guest_list_failed', async () => {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    return loadGuestList(scope)
  })
}

/** One guest's card: his details, his counts, his recent bookings, and the reader's own note. */
export async function guestCardAction(
  input: unknown,
): Promise<RvAnswer<{ card: RvGuestCardView | null }>> {
  const parsed = OneGuest.safeParse(input)
  if (!parsed.success) return FAILED
  return answer('guest_card_failed', async () => {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    return loadGuestCard(scope, parsed.data.guestId)
  })
}

/** The regulars three typed letters suggest in the booking form (D140). */
export async function guestSuggestAction(input: unknown): Promise<
  | {
      readonly ok: true
      readonly suggestions: readonly {
        readonly id: string
        readonly name: string | null
        readonly phone: string | null
      }[]
    }
  | { readonly ok: false }
> {
  const parsed = Suggest.safeParse(input)
  if (!parsed.success) return FAILED
  try {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    const read = await loadGuestSuggestions(scope, parsed.data.query)
    return read.ok ? { ok: true, suggestions: read.suggestions } : FAILED
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    logError('guest_suggest_failed', error)
    return FAILED
  }
}

const SaveGuest = z.strictObject({
  venueId,
  /** Present when a guest already on the list is changed. */
  guestId: guestId.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().min(6).max(40).optional(),
  email: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  regular: z.boolean().optional(),
  archived: z.boolean().optional(),
  pin,
})

/**
 * Adds a regular, changes a guest, archives or restores one: `guest.save`, "working tonight's
 * reservations" (#333), with the PIN on a shared device because it touches a guest's details
 * (D141). A number another guest already has is refused `guest_exists` with that guest's id.
 */
export async function saveGuestAction(input: unknown): Promise<RvWriteResult> {
  const parsed = SaveGuest.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, pin: typed, regular, ...fields } = parsed.data
  return performReservationWrite(
    { venueId: id, ...withPin(typed) },
    {
      type: 'guest.save',
      ...fields,
      ...(regular === undefined ? {} : { isRegular: regular }),
    },
  )
}

const PrivateNote = z.strictObject({
  venueId,
  guestId,
  /** The note on the person's own list; null takes the guest off it. */
  note: z.string().trim().min(1).max(500).nullable(),
})

/**
 * Keeps a guest on the person's own private list with a note, or takes him off it (D140). Only
 * the person's own sign-in reaches it (`settings.guests`): no PIN is ever taken here.
 */
export async function privateNoteAction(input: unknown): Promise<RvWriteResult> {
  const parsed = PrivateNote.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, guestId: guest, note } = parsed.data
  return ownSignInOnly(
    await performReservationWrite(
      { venueId: id },
      { type: 'guest.private_note', guestId: guest, note },
    ),
  )
}

/**
 * A settings-class write is never answered with the PIN pad (D141): where a shared device would ask
 * for four digits, the answer is that it needs the person's own sign-in.
 */
function ownSignInOnly(result: RvWriteResult): RvWriteResult {
  return !result.ok && result.error === 'pin_required'
    ? { ok: false, error: 'own_sign_in_required' }
    : result
}

/**
 * Erases a guest's details (D140, D83): an update through the service write path, never a
 * deletion. Settings-class and a fresh sign-in (D141): no PIN is ever taken here, and a shared
 * device is answered `own_sign_in_required`.
 */
export async function eraseGuestAction(input: unknown): Promise<RvWriteResult> {
  const parsed = OneGuest.safeParse(input)
  if (!parsed.success) return invalidWrite()
  return ownSignInOnly(
    await performReservationWrite(
      { venueId: parsed.data.venueId },
      { type: 'guest.erase', guestId: parsed.data.guestId },
    ),
  )
}
