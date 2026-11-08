// The row locks and the reads every reservation command shares (ticket #323; D122 §9, design §2.3).
// Each one claims its rows through `stx.rows.claim`, which checks the fixed order of
// `lock-order.ts`: the reservation ranks after the payment, so a handler that seats a party locks
// the table's sitting and its order first and the reservation after them (tickets #329, #332).
//
// Everything here locks, reads and refuses; nothing writes. The writes are in the command modules,
// after their handler has decided in memory.

import {
  floorPlans,
  guests,
  reservationNights,
  reservationSettings,
  reservationSpots,
  reservations,
  spots,
  venueSpotKinds,
} from '@restro/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { Id } from '../../ids'
import { sortKeyBetween } from '../../sort-keys'
import type { ServiceTx } from '../definition'
import { refused, type ServiceResult } from '../results'
import type { SpotHold, Stretch } from './overlap'
import type { ReservationStatus } from './status'

/** A reservation row. */
export type Reservation = typeof reservations.$inferSelect
/** A floor plan row. */
export type FloorPlan = typeof floorPlans.$inferSelect
/** A spot row. */
export type Spot = typeof spots.$inferSelect
/** A guest record. */
export type Guest = typeof guests.$inferSelect
/** A venue's reservation settings. */
export type ReservationSettings = typeof reservationSettings.$inferSelect
/** The record of one night. */
export type ReservationNight = typeof reservationNights.$inferSelect
/** One spot a reservation holds. */
export type ReservationSpot = typeof reservationSpots.$inferSelect

/**
 * Why a reservation command was refused, beside the machinery's codes (`results.ts`) and the two
 * rule modules' own (`RESERVATION_STATUS_REFUSALS`, `SPOT_CLAIM_REFUSALS`). Every one of them is a
 * named code the screen words: a refused command is never a silent no-op (ticket #323).
 */
export const RESERVATION_REFUSALS = [
  /** This venue has no such reservation, or it was taken out of the book. */
  'reservation_missing',
  /** This venue has no such floor plan. */
  'plan_missing',
  /** This venue has no such spot, or it was taken off its plan. */
  'spot_missing',
  /** Another spot of this venue already goes by that name. */
  'spot_name_taken',
  /** The spot's kind is not one the venue has defined. */
  'spot_kind_missing',
  /** Spots on the plan are still of this kind, so the kind stays until they are not. */
  'spot_kind_in_use',
  /** This venue has no such guest record, or he has been erased. */
  'guest_missing',
  /** A guest record with that number is already in the venue's list. */
  'guest_exists',
  /** The venue has no reservation settings yet, so it has no turn time (D135). */
  'settings_missing',
  /** The night has passed and the venue has not switched writing the past on (D135). */
  'night_passed',
  /** The night has passed and the actor may not write one that has (D141). */
  'past_night_denied',
  /** The night has been closed (D138): it is a record now. */
  'night_closed',
  /** The reservation is not out of the book, so there is nothing to restore. */
  'reservation_not_deleted',
  /** A party of this kind cannot do this (a block is never seated, a booking never queues). */
  'kind_not_allowed',
  /** The venue keeps no private guest notes (D140): an owner switches them on first. */
  'private_notes_off',
  /** Only a person of the venue's own staff keeps a private note: it is his, by name (D140). */
  'not_a_staff_member',
] as const

/** One reservation refusal code. */
export type ReservationRefusal = (typeof RESERVATION_REFUSALS)[number]

/** A staff command's refusal: no action id, because a staff command carries none. */
export function refuse(code: ReservationRefusal | (string & {})): ServiceResult {
  return refused(null, code)
}

/** Locks one reservation of this venue, or null when the venue has no such line. */
export async function lockReservation(
  stx: ServiceTx,
  reservationId: string,
): Promise<Reservation | null> {
  stx.rows.claim('reservation', [reservationId])
  const [row] = await stx.tx
    .select()
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.venueId, stx.venueId)))
    .for('update')
  return row ?? null
}

/** Locks every reservation of a night that is still in the book, in id order. */
export async function lockNightReservations(
  stx: ServiceTx,
  serviceDate: string,
): Promise<Reservation[]> {
  const ids = await stx.tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.venueId, stx.venueId),
        eq(reservations.serviceDate, serviceDate),
        isNull(reservations.deletedAt),
      ),
    )
  if (ids.length === 0) return []
  const fresh = stx.rows.claim(
    'reservation',
    ids.map((row) => row.id),
  )
  if (fresh.length === 0) return []
  return await stx.tx
    .select()
    .from(reservations)
    .where(and(inArray(reservations.id, fresh), eq(reservations.venueId, stx.venueId)))
    .orderBy(reservations.id)
    .for('update')
}

/** Locks the night's record, creating nothing: null when the night has none yet. */
export async function lockNight(
  stx: ServiceTx,
  serviceDate: string,
): Promise<ReservationNight | null> {
  stx.rows.claim('reservation_night', [`${stx.venueId}:${serviceDate}`])
  const [row] = await stx.tx
    .select()
    .from(reservationNights)
    .where(
      and(
        eq(reservationNights.venueId, stx.venueId),
        eq(reservationNights.serviceDate, serviceDate),
      ),
    )
    .for('update')
  return row ?? null
}

/** Locks one guest record of this venue, or null. An erased record is no longer one. */
export async function lockGuest(stx: ServiceTx, guestId: string): Promise<Guest | null> {
  stx.rows.claim('guest', [guestId])
  const [row] = await stx.tx
    .select()
    .from(guests)
    .where(and(eq(guests.id, guestId), eq(guests.venueId, stx.venueId)))
    .for('update')
  return row === undefined || row.erasedAt !== null ? null : row
}

/** Locks the guest record of a normalised number, or null when the venue has none. */
export async function lockGuestByPhone(stx: ServiceTx, phoneKey: string): Promise<Guest | null> {
  const [peek] = await stx.tx
    .select({ id: guests.id })
    .from(guests)
    .where(
      and(eq(guests.venueId, stx.venueId), eq(guests.phoneKey, phoneKey), isNull(guests.erasedAt)),
    )
  return peek === undefined ? null : await lockGuest(stx, peek.id)
}

/** The venue's reservation settings, or null when nobody has set them (D135: no invented default). */
export async function readSettings(stx: ServiceTx): Promise<ReservationSettings | null> {
  const [row] = await stx.tx
    .select()
    .from(reservationSettings)
    .where(eq(reservationSettings.venueId, stx.venueId))
  return row ?? null
}

/** One floor plan of this venue that is still there, or null. */
export async function readPlan(stx: ServiceTx, planId: string): Promise<FloorPlan | null> {
  const [row] = await stx.tx
    .select()
    .from(floorPlans)
    .where(
      and(
        eq(floorPlans.id, planId),
        eq(floorPlans.venueId, stx.venueId),
        isNull(floorPlans.removedAt),
      ),
    )
  return row ?? null
}

/** One spot of this venue that is still on its plan, or null. */
export async function readSpot(stx: ServiceTx, spotId: string): Promise<Spot | null> {
  const [row] = await stx.tx
    .select()
    .from(spots)
    .where(and(eq(spots.id, spotId), eq(spots.venueId, stx.venueId), isNull(spots.removedAt)))
  return row ?? null
}

/** The spots of this venue, among the ids asked for, that are still on their plan, by id. */
export async function readSpots(
  stx: ServiceTx,
  spotIds: readonly string[],
): Promise<Map<string, Spot>> {
  if (spotIds.length === 0) return new Map()
  const rows = await stx.tx
    .select()
    .from(spots)
    .where(
      and(inArray(spots.id, [...spotIds]), eq(spots.venueId, stx.venueId), isNull(spots.removedAt)),
    )
  return new Map(rows.map((row) => [row.id, row]))
}

/** True when the venue has defined this spot kind. */
export async function hasSpotKind(stx: ServiceTx, key: string): Promise<boolean> {
  const [row] = await stx.tx
    .select({ key: venueSpotKinds.key })
    .from(venueSpotKinds)
    .where(
      and(
        eq(venueSpotKinds.venueId, stx.venueId),
        eq(venueSpotKinds.key, key),
        isNull(venueSpotKinds.removedAt),
      ),
    )
  return row !== undefined
}

/**
 * The spots held on one night, as the overlap rule reads them: a row per spot of every reservation
 * that is not released and not out of the book. Whether a hold is in the way at all is the rule's
 * own business (`holdsSpots`, `holdsSpotAt`), not this read's, so a caller sees cancellations and
 * no-shows too and lets the rule discard them.
 */
export async function heldSpotsOfNight(
  stx: ServiceTx,
  serviceDate: string,
  turnMinutes: number,
): Promise<SpotHold[]> {
  const rows = await stx.tx
    .select({
      reservationId: reservations.id,
      spotId: reservationSpots.spotId,
      status: reservations.status,
      endsAt: reservations.endsAt,
      turnMinutes: reservations.turnMinutes,
      heldFrom: reservationSpots.heldFrom,
      heldTo: reservationSpots.heldTo,
    })
    .from(reservationSpots)
    .innerJoin(
      reservations,
      and(
        eq(reservations.tenantId, reservationSpots.tenantId),
        eq(reservations.id, reservationSpots.reservationId),
      ),
    )
    .where(
      and(
        eq(reservations.venueId, stx.venueId),
        eq(reservations.serviceDate, serviceDate),
        isNull(reservationSpots.releasedAt),
        isNull(reservations.deletedAt),
      ),
    )
  return rows.map((row) => ({
    reservationId: row.reservationId as Id<'rv'>,
    spotId: row.spotId as Id<'sp'>,
    status: row.status as ReservationStatus,
    stretch: heldRowStretch(row, turnMinutes),
  }))
}

/**
 * The stretch one held row covers: from when the spot was taken, to its own end, else the end time
 * staff set on the reservation, else the turn time in force (the reservation's own, else the
 * venue's — never a second setting, D135).
 */
export function heldRowStretch(
  row: {
    readonly endsAt: Date | null
    readonly turnMinutes: number | null
    readonly heldFrom: Date
    readonly heldTo: Date | null
  },
  turnMinutes: number,
): Stretch {
  const from = row.heldFrom
  if (row.heldTo !== null) return { from, to: row.heldTo }
  if (row.endsAt !== null) return { from, to: row.endsAt }
  return { from, to: new Date(from.getTime() + (row.turnMinutes ?? turnMinutes) * 60_000) }
}

/** The spots one reservation still holds, in spot order. */
export async function spotsOfReservation(
  stx: ServiceTx,
  reservationId: string,
): Promise<ReservationSpot[]> {
  return await stx.tx
    .select()
    .from(reservationSpots)
    .where(
      and(eq(reservationSpots.reservationId, reservationId), isNull(reservationSpots.releasedAt)),
    )
    .orderBy(reservationSpots.spotId)
}

/**
 * Whether a night may be written at all (D135, D138, D141). A night still to come or going on now
 * is open. A night that has passed needs the venue's "editing the past" switch **and** the actor's
 * own right to write one (two different things: the venue allows it, the person is trusted with
 * it). A night somebody has closed is a record: `night_closed` whatever that switch says, because
 * closing it is what makes it one (D138).
 */
export function nightWritable(
  stx: ServiceTx,
  serviceDate: string,
  settings: Pick<ReservationSettings, 'editPastNights'>,
  night: Pick<ReservationNight, 'closedAt'> | null,
): ReservationRefusal | null {
  if (night?.closedAt != null) return 'night_closed'
  if (serviceDate >= stx.serviceDate) return null
  if (!settings.editPastNights) return 'night_passed'
  return stx.permissions.has('reservations.edit_past') ? null : 'past_night_denied'
}

/** The settings and the night's record, with the night's own writability decided. */
export type OpenNight =
  | {
      readonly ok: true
      readonly settings: ReservationSettings
      readonly night: ReservationNight | null
    }
  | { readonly ok: false; readonly code: ReservationRefusal }

/**
 * The settings, the night's record and the check that the night may be written, in one step: what
 * every command touching a reservation needs before it decides anything. The settings come first
 * because a venue with none has no turn time at all (D135), and the night's record is locked, so
 * a close and a write of the same night queue instead of crossing.
 */
export async function openNight(stx: ServiceTx, serviceDate: string): Promise<OpenNight> {
  const settings = await readSettings(stx)
  if (settings === null) return { ok: false, code: 'settings_missing' }
  const night = await lockNight(stx, serviceDate)
  const refusal = nightWritable(stx, serviceDate, settings, night)
  return refusal === null ? { ok: true, settings, night } : { ok: false, code: refusal }
}

/** The next fractional queue key of a night's waiting list: after everyone already waiting. */
export async function nextQueueKey(stx: ServiceTx, serviceDate: string): Promise<string> {
  const [row] = await stx.tx
    .select({ last: sql<string | null>`max(${reservations.queueKey})` })
    .from(reservations)
    .where(
      and(
        eq(reservations.venueId, stx.venueId),
        eq(reservations.serviceDate, serviceDate),
        eq(reservations.status, 'waiting'),
        isNull(reservations.deletedAt),
      ),
    )
  return sortKeyBetween(row?.last ?? null, null)
}
