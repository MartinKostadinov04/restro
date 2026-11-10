// The booking book (ticket #323, #328; D135, D137, D140): create, edit, cancel, take out, restore
// and copy a reservation, and the spot claim every one of them goes through.
//
// A reservation belongs to a **service day**, not a calendar date (D45): a booking taken for 01:00
// belongs to the night that began the evening before, and the caller names that night. Nothing
// here creates the Requested status: a booking a hostess takes by phone is Reserved, and Requested
// is part 2's (D136).
//
// A reservation never touches the POS (D134, rule 7): no connector is imported here, and no bill,
// sitting or sent order is read or written. A POS bill closing changes nothing on a reservation —
// a party whose bill closed stays Seated and keeps its spots until the night's end, unless its own
// end time says otherwise or staff free them (`holdsSpotAt` in `overlap.ts`).
//
// **Warnings are not here.** More guests than seats, the same contact twice that night, an hour
// outside the venue's hours: each is advice the screen shows (`booking-checks.ts`) and none of
// them is a refusal, so no command in this file can be stopped by one (D134, D135, D137). What a
// command refuses is a named code: a night that cannot be written, a spot somebody holds, a phone
// the venue requires, an edit over somebody else's change.

import { guests, reservationSpots, reservations } from '@restro/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { type Id, newId } from '../../ids'
import type { ServiceTx } from '../definition'
import { accepted, refused, type ServiceResult } from '../results'
import { phoneKeyOf } from './guests'
import { heldStretch, isSpotConflict, type SpotClaim, type Stretch, spotConflict } from './overlap'
import {
  heldSpotsOfNight,
  lockGuest,
  lockGuestByPhone,
  lockReservation,
  nextQueueKey,
  type OpenNight,
  openNight,
  type Reservation,
  readSpots,
  refuse,
  spotsOfReservation,
  staffMemberOf,
  versionOf,
} from './rows'
import { isEndStatus, moveStatus, type ReservationStatus } from './status'

/** What a reservation wants to hold, as the caller names it. */
export interface SpotWish {
  readonly reservationId: string
  readonly spotIds: readonly string[]
  readonly serviceDate: string
  readonly startsAt: Date
  readonly endsAt: Date | null
  readonly turnMinutes: number | null
}

/** The stretch a wish was granted, or the refusal that stopped it. */
export type SpotGrant =
  | { readonly ok: true; readonly stretch: Stretch }
  | {
      readonly ok: false
      readonly code: string
      readonly details: Readonly<Record<string, string | number | boolean | null>>
    }

/**
 * The one check that keeps the overlap rule: the spots must be the venue's own and still on the
 * plan, and no other reservation of that night may hold one of them for an overlapping stretch.
 * The refusal names the spot and the reservation in the way, so the screen can say which booking
 * it is rather than "taken".
 *
 * Every path that gives a reservation a spot goes through here — create, edit, restore, copy, hold
 * — so the rule is written once and cannot drift between them. A block with no end counts as
 * holding the spot for ever (D137), whichever night it was made on.
 */
export async function claimSpots(
  stx: ServiceTx,
  wish: SpotWish,
  venueTurnMinutes: number,
): Promise<SpotGrant> {
  const found = await readSpots(stx, wish.spotIds)
  for (const spotId of wish.spotIds) {
    if (!found.has(spotId)) {
      return { ok: false, code: 'spot_missing', details: { spotId } }
    }
  }
  const claim: SpotClaim = {
    reservationId: wish.reservationId as Id<'rv'>,
    spotIds: wish.spotIds as readonly Id<'sp'>[],
    startsAt: wish.startsAt,
    endsAt: wish.endsAt,
    turnMinutes: wish.turnMinutes,
  }
  const stretch = heldStretch(claim, venueTurnMinutes)
  if (!stretch.ok) return { ok: false, code: stretch.code, details: {} }
  if (wish.spotIds.length === 0) return { ok: true, stretch: stretch.stretch }
  const held = await heldSpotsOfNight(stx, wish.serviceDate, venueTurnMinutes)
  const clash = spotConflict(claim, held, venueTurnMinutes)
  if (isSpotConflict(clash)) {
    return {
      ok: false,
      code: 'spot_taken',
      details: { spotId: clash.spotId, reservationId: clash.reservationId },
    }
  }
  if (clash !== null) return { ok: false, code: clash.code, details: {} }
  return { ok: true, stretch: stretch.stretch }
}

/** Writes the held rows of a granted claim. A row already there for that start is left alone. */
export async function writeHeldSpots(
  stx: ServiceTx,
  reservationId: string,
  spotIds: readonly string[],
  stretch: Stretch,
  ownEnd: boolean,
): Promise<void> {
  if (spotIds.length === 0) return
  await stx.tx
    .insert(reservationSpots)
    .values(
      spotIds.map((spotId) => ({
        tenantId: stx.tenantId,
        reservationId,
        spotId,
        heldFrom: stretch.from,
        // Only an end the reservation itself carries is written onto the row: a stretch that came
        // from the turn time stays computed, so changing the venue's turn time moves it (D135).
        heldTo: ownEnd ? stretch.to : null,
        ...stx.provenance,
      })),
    )
    .onConflictDoUpdate({
      target: [
        reservationSpots.tenantId,
        reservationSpots.reservationId,
        reservationSpots.spotId,
        reservationSpots.heldFrom,
      ],
      set: {
        heldTo: ownEnd ? stretch.to : null,
        releasedAt: null,
        ...stx.provenance,
        updatedAt: sql`now()`,
      },
    })
}

/**
 * Frees the spots a reservation holds — all of them, or the ones named. A release is `released_at`,
 * never a delete (CLAUDE.md's never-list): where a party sat stays readable.
 */
export async function releaseHeldSpots(
  stx: ServiceTx,
  reservationId: string,
  spotIds?: readonly string[],
): Promise<string[]> {
  const held = await spotsOfReservation(stx, reservationId)
  const wanted = spotIds === undefined ? held : held.filter((row) => spotIds.includes(row.spotId))
  if (wanted.length === 0) return []
  await stx.tx
    .update(reservationSpots)
    .set({ releasedAt: sql`now()`, ...stx.provenance, updatedAt: sql`now()` })
    .where(
      and(
        eq(reservationSpots.reservationId, reservationId),
        inArray(
          reservationSpots.spotId,
          wanted.map((row) => row.spotId),
        ),
        isNull(reservationSpots.releasedAt),
      ),
    )
  return wanted.map((row) => row.spotId)
}

/** How the caller names the party: the venue's own record, a number, or a name on the book. */
export interface PartyInput {
  readonly guestId?: string
  /** A phone number: its record is found by it, or made (D140 — the number lives only there). */
  readonly phone?: string
  /** The name the hostess typed: it fills a record that has none, and is otherwise kept as is. */
  readonly guestName?: string
  /** The name on a booking with no number ("Ivan"); never a phone or an email. */
  readonly partyLabel?: string
}

/** The party as it will be stored: a guest record, a label, or both. */
type Party =
  | { readonly ok: true; readonly guestId: string | null; readonly partyLabel: string | null }
  | { readonly ok: false; readonly code: string }

/**
 * The name written on the booking where it is not the record's own: a guest the venue knows as
 * "Maria Ivanova" can be booked as "Maria", and the booking says what the hostess typed. Where the
 * two are the same (or none was typed) the record's is the name, so the one place a guest's name
 * lives stays the record, and erasing it leaves nobody readable on the night (D140).
 */
function labelFor(recordName: string | null, typed: string | undefined): string | null {
  if (typed === undefined) return null
  const same = recordName !== null && recordName.trim().toLowerCase() === typed.trim().toLowerCase()
  return same ? null : typed
}

/**
 * Finds or makes the guest record a booking points at. A number the venue has seen is the record
 * it already has (one person, one row); a new number makes one.
 *
 * Taking a booking is PIN-level work (D141, "create a booking"), and a booking with a number has
 * to put that number in the one place contact details live (D140), so this path may make a record
 * under the booking's own permission. The **managed list** — browsing it, editing a record, erasing
 * somebody — stays settings-class and so behind a person's own sign-in.
 */
async function resolveParty(stx: ServiceTx, input: PartyInput): Promise<Party> {
  if (input.guestId !== undefined) {
    const guest = await lockGuest(stx, input.guestId)
    if (guest === null) return { ok: false, code: 'guest_missing' }
    return {
      ok: true,
      guestId: guest.id,
      partyLabel: input.partyLabel ?? labelFor(guest.name, input.guestName),
    }
  }
  if (input.phone !== undefined) {
    const phoneKey = phoneKeyOf(input.phone)
    if (phoneKey === null) return { ok: false, code: 'invalid_phone' }
    const found = await lockGuestByPhone(stx, phoneKey)
    if (found !== null) {
      // A name given with the booking fills a record that had none; one already there is kept,
      // because the list is the venue's, not this booking's.
      let recordName = found.name
      if (found.name === null && input.guestName !== undefined) {
        recordName = input.guestName
        await stx.tx
          .update(guests)
          .set({ name: input.guestName, ...stx.provenance, updatedAt: sql`now()` })
          .where(eq(guests.id, found.id))
        await stx.log({ kind: 'guest.changed', guestId: found.id, reason: 'from_booking' })
      }
      return {
        ok: true,
        guestId: found.id,
        partyLabel: input.partyLabel ?? labelFor(recordName, input.guestName),
      }
    }
    const guestId = newId('gu')
    await stx.tx.insert(guests).values({
      id: guestId,
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      phoneKey,
      phone: input.phone,
      name: input.guestName ?? null,
      ...stx.provenance,
    })
    await stx.log({ kind: 'guest.changed', guestId, toState: 'listed', reason: 'from_booking' })
    return { ok: true, guestId, partyLabel: input.partyLabel ?? null }
  }
  return { ok: true, guestId: null, partyLabel: input.partyLabel ?? input.guestName ?? null }
}

/** What a reservation is created with. */
export interface ReservationCreateCommand extends PartyInput {
  readonly serviceDate: string
  readonly startsAt: string
  readonly endsAt?: string | null
  readonly turnMinutes?: number | null
  readonly kind: 'booking' | 'walk_in' | 'block'
  /** Never `requested`: part 1 creates none (D136 owns it). */
  readonly status: 'reserved' | 'waiting' | 'seated'
  readonly partySize?: number | null
  readonly note?: string | null
  readonly reason?: string | null
  readonly spotIds?: readonly string[]
  /** The queue key, for a walk-in put straight on the waiting list. */
  readonly queueKey?: string | null
}

/**
 * Creates a reservation: a booking, a walk-in, a waiting party or a block, in one path with one
 * `kind` (D137). The night has to be writable (`openNight`), the party has to be resolvable, and
 * the spots have to be free (`claimSpots`); any of the three refuses with its own named code and
 * the handler's savepoint takes the rest back with it.
 *
 * A booking taken by hand needs a phone unless the venue switched that off (D135): a guest the
 * venue cannot call is a booking nobody can confirm. A walk-in, a waiting party and a block are
 * not bookings and never need one.
 */
export async function createReservation(
  stx: ServiceTx,
  command: ReservationCreateCommand,
): Promise<ServiceResult> {
  const night = await openNight(stx, command.serviceDate)
  if (!night.ok) return refuse(night.code)
  const block = command.kind === 'block'
  if (block && command.status !== 'reserved') return refuse('kind_not_allowed')
  if (command.status === 'waiting' && command.kind !== 'walk_in') return refuse('kind_not_allowed')
  if (block === (command.partySize != null)) return refuse('invalid_command')
  if (
    command.kind === 'booking' &&
    night.settings.phoneRequired &&
    command.guestId === undefined &&
    command.phone === undefined
  ) {
    return refuse('phone_required')
  }
  const party = block
    ? ({ ok: true, guestId: null, partyLabel: null } as const)
    : await resolveParty(stx, command)
  if (!party.ok) return refuse(party.code)
  if (command.kind === 'booking' && party.guestId === null && party.partyLabel === null) {
    return refuse('invalid_command')
  }
  const reservationId = newId('rv')
  const startsAt = new Date(command.startsAt)
  const endsAt = command.endsAt == null ? null : new Date(command.endsAt)
  const spotIds = command.spotIds ?? []
  const grant = await claimSpots(
    stx,
    {
      reservationId,
      spotIds,
      serviceDate: command.serviceDate,
      startsAt: command.status === 'seated' ? stx.now : startsAt,
      endsAt,
      turnMinutes: command.turnMinutes ?? null,
    },
    night.settings.turnMinutes,
  )
  if (!grant.ok) return spotRefusal(grant)
  await stx.tx.insert(reservations).values({
    id: reservationId,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: command.serviceDate,
    startsAt,
    endsAt,
    turnMinutes: command.turnMinutes ?? null,
    kind: command.kind,
    status: command.status,
    partySize: command.partySize ?? null,
    queueKey: command.status === 'waiting' ? (command.queueKey ?? 'a0') : null,
    guestId: party.guestId,
    partyLabel: party.partyLabel,
    note: command.note ?? null,
    reason: command.reason ?? null,
    madeBy: await staffMemberOf(stx),
    seatedAt: command.status === 'seated' ? stx.now : null,
    ...stx.provenance,
  })
  await writeHeldSpots(stx, reservationId, spotIds, grant.stretch, endsAt !== null)
  await stx.log({
    kind: 'reservation.created',
    reservationId,
    guestId: party.guestId ?? undefined,
    toState: command.status,
    reason: command.reason ?? undefined,
    details: {
      reservationKind: command.kind,
      partySize: command.partySize ?? null,
      spots: spotIds.join(','),
      startsAt: startsAt.toISOString(),
    },
  })
  return accepted(null, {
    details: { reservationId, spots: spotIds.join(',') },
  })
}

/** A claim's refusal as the command's answer, with the spot and the booking in the way. */
function spotRefusal(grant: Extract<SpotGrant, { ok: false }>): ServiceResult {
  return refused(null, grant.code, grant.details)
}

/** What an edit may change; a value left out stays as it was. */
export interface ReservationEditCommand {
  readonly reservationId: string
  /**
   * The version the person's form was opened on (`version.ts`). When it is no longer the
   * reservation's, somebody changed it meanwhile and the edit is refused `reservation_stale`
   * instead of written over their work. Left out, no check is made (a caller that never showed
   * the booking to anyone first).
   */
  readonly expectedVersion?: string
  readonly startsAt?: string
  readonly endsAt?: string | null
  readonly turnMinutes?: number | null
  readonly partySize?: number
  readonly note?: string | null
  readonly partyLabel?: string | null
  /** The name the hostess typed; see `labelFor`. */
  readonly name?: string
  /** A number moves the booking to that guest's record; null takes the number off it. */
  readonly phone?: string | null
  readonly reason?: string | null
  /** The spots the reservation should hold from now on; left out, it keeps the ones it has. */
  readonly spotIds?: readonly string[]
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((one) => b.includes(one))

/**
 * Edits a reservation that has not ended. When the stretch or the spots move — a new hour, a new
 * end, a new turn time, other tables — the spots it will hold are claimed again against that
 * night, so an edit can never slide a party onto a spot somebody else has; the held rows follow.
 *
 * Whoever has `reservations.manage` works any booking, whoever took it (D135: nothing ties a
 * booking to the person who entered it) — so the check that matters here is not whose it is but
 * whether it is still the one the form was opened on.
 */
export async function editReservation(
  stx: ServiceTx,
  command: ReservationEditCommand,
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation, night } = open
  if (reservation.kind === 'block') return refuse('kind_not_allowed')
  if (isEndStatus(reservation.status as ReservationStatus)) return refuse('status_move_not_allowed')
  if (
    command.expectedVersion !== undefined &&
    command.expectedVersion !== (await versionOf(stx, reservation))
  ) {
    return refuse('reservation_stale')
  }
  const startsAt =
    command.startsAt === undefined ? reservation.startsAt : new Date(command.startsAt)
  const endsAt =
    command.endsAt === undefined
      ? reservation.endsAt
      : command.endsAt === null
        ? null
        : new Date(command.endsAt)
  const turnMinutes =
    command.turnMinutes === undefined ? reservation.turnMinutes : command.turnMinutes

  // Who the booking is for. A name alone renames the booking (against its guest's record, if it
  // has one); a number moves it to that guest's record; no number takes it off the record.
  let guestId = reservation.guestId
  let partyLabel = command.partyLabel === undefined ? reservation.partyLabel : command.partyLabel
  if (command.phone === null && reservation.guestId !== null) {
    if (night.settings.phoneRequired) return refuse('phone_required')
    // The booking keeps the name it was shown under when its number is taken off.
    const known = await lockGuest(stx, reservation.guestId)
    const label = command.name ?? partyLabel ?? known?.name ?? null
    if (label === null) return refuse('invalid_command')
    guestId = null
    partyLabel = label
  } else if (command.phone !== undefined && command.phone !== null) {
    const party = await resolveParty(stx, {
      phone: command.phone,
      ...(command.name === undefined ? {} : { guestName: command.name }),
    })
    if (!party.ok) return refuse(party.code)
    guestId = party.guestId
    partyLabel = party.partyLabel
  } else if (command.name !== undefined) {
    const party = await resolveParty(
      stx,
      reservation.guestId === null
        ? { partyLabel: command.name }
        : { guestId: reservation.guestId, guestName: command.name },
    )
    if (!party.ok) return refuse(party.code)
    guestId = party.guestId
    partyLabel = party.partyLabel
  }
  if (reservation.kind === 'booking' && guestId === null && partyLabel === null) {
    return refuse('invalid_command')
  }

  const held = await spotsOfReservation(stx, reservation.id)
  const heldIds = held.map((row) => row.spotId)
  const wanted = command.spotIds ?? heldIds
  const spotsChanged = command.spotIds !== undefined && !sameSet(wanted, heldIds)
  const moved =
    startsAt.getTime() !== reservation.startsAt.getTime() ||
    (endsAt?.getTime() ?? null) !== (reservation.endsAt?.getTime() ?? null) ||
    turnMinutes !== reservation.turnMinutes
  if ((moved || spotsChanged) && wanted.length > 0) {
    const grant = await claimSpots(
      stx,
      {
        reservationId: reservation.id,
        spotIds: wanted,
        serviceDate: reservation.serviceDate,
        startsAt: reservation.seatedAt ?? startsAt,
        endsAt,
        turnMinutes,
      },
      night.settings.turnMinutes,
    )
    if (!grant.ok) return spotRefusal(grant)
    // The old rows end where the new ones begin: a changed hour is a new `held_from`, and the
    // rows the party no longer holds are released, never deleted.
    await releaseHeldSpots(stx, reservation.id)
    await writeHeldSpots(stx, reservation.id, wanted, grant.stretch, endsAt !== null)
  } else if (spotsChanged) {
    await releaseHeldSpots(stx, reservation.id)
  }
  await stx.tx
    .update(reservations)
    .set({
      startsAt,
      endsAt,
      turnMinutes,
      guestId,
      partyLabel,
      partySize: command.partySize ?? reservation.partySize,
      note: command.note === undefined ? reservation.note : command.note,
      reason: command.reason === undefined ? reservation.reason : command.reason,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  // What the entry says is which things moved, never what the guest's name or number became (D140,
  // D142): the booking names its guest by id, and the record is where the details live.
  await stx.log({
    kind: 'reservation.changed',
    reservationId: reservation.id,
    guestId: guestId ?? undefined,
    toState: reservation.status,
    reason: command.reason ?? undefined,
    details: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt === null ? null : endsAt.toISOString(),
      partySize: command.partySize ?? reservation.partySize,
      moved,
      spots: wanted.join(','),
      spotsChanged,
      guestChanged: guestId !== reservation.guestId,
    },
  })
  return accepted(null, { details: { reservationId: reservation.id, moved } })
}

/** One reservation with its night opened, or the refusal that stopped it. */
export type OpenReservation =
  | {
      readonly ok: true
      readonly reservation: Reservation
      readonly night: Extract<OpenNight, { ok: true }>
    }
  | { readonly ok: false; readonly code: string }

/**
 * Locks one reservation and opens its night: the start of every command that changes an existing
 * line. The reservation comes first, then its night's record, which is the order `LOCK_RANKS`
 * fixes (`reservation` before `reservation_night`).
 */
export async function openReservation(
  stx: ServiceTx,
  reservationId: string,
  options: { readonly deleted?: boolean } = {},
): Promise<OpenReservation> {
  const reservation = await lockReservation(stx, reservationId)
  if (reservation === null) return { ok: false, code: 'reservation_missing' }
  const wantDeleted = options.deleted ?? false
  if (wantDeleted !== (reservation.deletedAt !== null)) {
    return { ok: false, code: wantDeleted ? 'reservation_not_deleted' : 'reservation_missing' }
  }
  const night = await openNight(stx, reservation.serviceDate)
  if (!night.ok) return { ok: false, code: night.code }
  return { ok: true, reservation, night }
}

/**
 * Cancels a reservation: a status move like any other (`moveStatus`), with its spots freed and its
 * reason kept as a code. A block is cancelled by its own command, which says so (`block`): the
 * booking command refuses one, so a block is never "cancelled by the guest".
 */
export async function cancelReservation(
  stx: ServiceTx,
  command: { readonly reservationId: string; readonly reason?: string | null },
  options: { readonly block?: boolean } = {},
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  if (reservation.kind === 'block' && options.block !== true) return refuse('kind_not_allowed')
  const move = moveStatus(reservation.status as ReservationStatus, 'cancelled')
  if (!move.ok) return refuse(move.code)
  const freed = await releaseHeldSpots(stx, reservation.id)
  await stx.tx
    .update(reservations)
    .set({
      status: 'cancelled',
      queueKey: null,
      endedAt: sql`now()`,
      reason: command.reason ?? reservation.reason,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  await stx.log({
    kind: 'reservation.status',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    fromState: reservation.status,
    toState: 'cancelled',
    reason: command.reason ?? undefined,
    details: { freed: freed.join(',') },
  })
  return accepted(null, { details: { reservationId: reservation.id } })
}

/**
 * Takes a reservation out of the book (D135's "delete", which Restore undoes). A line somebody
 * entered by mistake should not sit in the night's list as a cancellation nobody made, so it is
 * hidden rather than cancelled — and the row itself stays, because app code deletes nothing and
 * the Log must still name what was there.
 *
 * Deleting is a different right from working the booking: whoever holds `reservations.tonight`
 * may take out a line **they made themselves** (the mistake they just typed), and deleting
 * someone else's stays with `reservations.manage` (D135: "stays the manager's"). The permission
 * is checked here, inside the transaction, because it depends on the row.
 */
export async function deleteReservation(
  stx: ServiceTx,
  command: { readonly reservationId: string; readonly reason?: string | null },
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId)
  if (!open.ok) return refuse(open.code)
  const { reservation } = open
  if (reservation.kind === 'block') return refuse('kind_not_allowed')
  if (!stx.permissions.has('reservations.manage')) {
    const me = await staffMemberOf(stx)
    if (me === null || reservation.madeBy !== me) return refuse('permission_denied')
  }
  const freed = await releaseHeldSpots(stx, reservation.id)
  await stx.tx
    .update(reservations)
    .set({
      deletedAt: sql`now()`,
      queueKey: null,
      reason: command.reason ?? reservation.reason,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  await stx.log({
    kind: 'reservation.changed',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    fromState: reservation.status,
    toState: 'deleted',
    reason: command.reason ?? undefined,
    details: { freed: freed.join(',') },
  })
  return accepted(null, { details: { reservationId: reservation.id } })
}

/**
 * Puts a reservation back into the book. Its spots are claimed again, because the night moved on
 * while it was out: a party whose table was given away comes back without it rather than on top of
 * somebody, and the answer says which spots it came back with.
 */
export async function restoreReservation(
  stx: ServiceTx,
  command: { readonly reservationId: string },
): Promise<ServiceResult> {
  const open = await openReservation(stx, command.reservationId, { deleted: true })
  if (!open.ok) return refuse(open.code)
  const { reservation, night } = open
  if (reservation.kind === 'block') return refuse('kind_not_allowed')
  const held = await stx.tx
    .select({ spotId: reservationSpots.spotId })
    .from(reservationSpots)
    .where(eq(reservationSpots.reservationId, reservation.id))
  const spotIds = [...new Set(held.map((row) => row.spotId))]
  let back: string[] = []
  if (spotIds.length > 0) {
    const grant = await claimSpots(
      stx,
      {
        reservationId: reservation.id,
        spotIds,
        serviceDate: reservation.serviceDate,
        startsAt: reservation.seatedAt ?? reservation.startsAt,
        endsAt: reservation.endsAt,
        turnMinutes: reservation.turnMinutes,
      },
      night.settings.turnMinutes,
    )
    if (grant.ok) {
      await writeHeldSpots(stx, reservation.id, spotIds, grant.stretch, reservation.endsAt !== null)
      back = spotIds
    }
  }
  await stx.tx
    .update(reservations)
    .set({
      deletedAt: null,
      queueKey:
        reservation.status === 'waiting' ? await nextQueueKey(stx, reservation.serviceDate) : null,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservations.id, reservation.id))
  await stx.log({
    kind: 'reservation.restored',
    reservationId: reservation.id,
    guestId: reservation.guestId ?? undefined,
    toState: reservation.status,
    details: { spots: back.join(','), spotsLost: back.length !== spotIds.length },
  })
  return accepted(null, {
    details: {
      reservationId: reservation.id,
      spots: back.join(','),
      spotsLost: back.length !== spotIds.length,
    },
  })
}

/** What a copy to another night is asked with. */
export interface ReservationCopyCommand {
  readonly reservationId: string
  readonly serviceDate: string
  readonly startsAt: string
  /** Its end hour on the new night; left out, the source's length is kept. */
  readonly endsAt?: string | null
  /** The spots on the new night; left out, none — the hostess places the party herself. */
  readonly spotIds?: readonly string[]
}

/**
 * Copies a reservation to another night (D137): the same guest, size, note and reason, Reserved,
 * with nothing that happened — no arrival, no end, no queue place, no pay state. The spots are the
 * new night's own to choose: a table free last Friday says nothing about this one, so the copy
 * holds the spots it is asked for, and the ones taken on that night come back as `spot_taken`
 * naming who holds them, for the hostess to pick others.
 *
 * A walk-in cannot be copied, having no details to keep (D137), and neither can a block.
 */
export async function copyReservation(
  stx: ServiceTx,
  command: ReservationCopyCommand,
): Promise<ServiceResult> {
  const source = await lockReservation(stx, command.reservationId)
  if (source === null || source.deletedAt !== null) return refuse('reservation_missing')
  if (source.kind !== 'booking') return refuse('kind_not_allowed')
  const night = await openNight(stx, command.serviceDate)
  if (!night.ok) return refuse(night.code)
  if (source.guestId !== null && (await lockGuest(stx, source.guestId)) === null) {
    return refuse('guest_missing')
  }
  const reservationId = newId('rv')
  const startsAt = new Date(command.startsAt)
  const endsAt =
    command.endsAt !== undefined
      ? command.endsAt === null
        ? null
        : new Date(command.endsAt)
      : source.endsAt === null
        ? null
        : new Date(startsAt.getTime() + (source.endsAt.getTime() - source.startsAt.getTime()))
  const spotIds = command.spotIds ?? []
  const grant = await claimSpots(
    stx,
    {
      reservationId,
      spotIds,
      serviceDate: command.serviceDate,
      startsAt,
      endsAt,
      turnMinutes: source.turnMinutes,
    },
    night.settings.turnMinutes,
  )
  if (!grant.ok) return spotRefusal(grant)
  await stx.tx.insert(reservations).values({
    id: reservationId,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: command.serviceDate,
    startsAt,
    endsAt,
    turnMinutes: source.turnMinutes,
    kind: 'booking',
    status: 'reserved',
    partySize: source.partySize,
    guestId: source.guestId,
    partyLabel: source.partyLabel,
    note: source.note,
    reason: source.reason,
    madeBy: await staffMemberOf(stx),
    ...stx.provenance,
  })
  await writeHeldSpots(stx, reservationId, spotIds, grant.stretch, endsAt !== null)
  await stx.log({
    kind: 'reservation.created',
    reservationId,
    guestId: source.guestId ?? undefined,
    toState: 'reserved',
    reason: 'copied',
    details: {
      reservationKind: 'booking',
      copiedFrom: source.id,
      partySize: source.partySize,
      spots: spotIds.join(','),
      startsAt: startsAt.toISOString(),
    },
  })
  return accepted(null, {
    details: { reservationId, copiedFrom: source.id, spots: spotIds.join(',') },
  })
}
