// The booking page's two writes (#577; spec #322 Implementation Decisions 1 and 2; D136): the owner's
// switch that puts the page on or off, and the guest's request for a night that the page sends.
//
// **The switch** (`reservation_online.set`) is a settings-class command behind
// `settings.reservations` and the person's own sign-in, like the rest of Settings › Reservations. It
// writes `online.bookingPage` and nothing else of `online`, and its Undo is the screen sending the
// value back. It needs the settings row, which needs the turn time first (D135, `settings_missing`).
//
// **The request** (`reservation.request`) is the one command a guest without a table sends: it
// arrives as Requested (D136), with no spot and no time of the guest's choosing, and a hostess
// answers it where part 1's list already takes over (`reservation.confirm` / `.decline`, #578).
// The guest names the night, how many, who he is and how to reach him; the command decides the
// rest. Refused, in this order: the page is off (`booking_off`), the night is past, outside the
// venue's hours, too far ahead or one of its closed dates (`bookingNightVerdict`, the same rule the
// page and the night endpoint read), the number is no phone number.
//
// The guest record (D140): his number finds the record the venue already has, or makes one, as a
// booking taken by phone does. What the guest typed only ever **fills** a record — a name or an
// address where it has none — and never replaces one already there: a stranger who knows a
// regular's number must not be able to rename him or send his emails elsewhere. The phone is
// therefore always asked online: an address lives only on a guest record, and a record is keyed by
// its number (`guests_key_present`).
//
// Asking twice is answered once (`by_nature`): the same guest asking again for a night he already
// has a request or a booking on gets that reservation back, and nothing new is written. Asking
// again with another choice (another Area, other spots, or one where the first had none) is
// refused `already_requested`: the page says he already asked and the club will write to him, so
// the new pick is never dropped without a word (#580 review).
//
// **An Area or a spot** (#580): where the venue offers it, the guest also names the Area he asks
// for (stored, and the hostess places the party) or picks his own spots (claimed by the booking
// rule, refused `spot_taken` when somebody holds one). With a spot picked and the venue's
// automatic confirmation on, the booking confirms itself in the same command (`online-choice.ts`).

import { guests, reservationSettings, reservations } from '@restro/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import {
  type BookingCalendar,
  type BookingDayHours,
  bookingNightHours,
  bookingNightVerdict,
} from '../../booking-nights'
import { newId } from '../../ids'
import { readOrderingSettings, WEEKDAYS, type Weekday } from '../../ordering-settings'
import { guestLinkToken, guestLinkTokenHash } from '../booking-link'
import type { ServiceTx } from '../definition'
import { accepted, refused, type ServiceResult } from '../results'
import { claimSpots, writeHeldSpots } from './book'
import { closedDatesOf } from './closed-dates'
import { guestEmailOwed } from './guest-email'
import { venuePhoneKey } from './guests'
import { confirmOwnPick, confirmsItself, guestPickOf } from './online-choice'
import { readOnlineSettings } from './online-settings'
import {
  lockGuestByPhone,
  lockSettings,
  openNight,
  type ReservationSettings,
  readSettings,
  refuse,
  spotsOfReservation,
} from './rows'

/** The venue's booking calendar: its clock, its weekly hours and its closed dates. */
export function bookingCalendarOf(
  venue: {
    readonly timezone: string
    readonly serviceDayEndsAt: string
    readonly settings: unknown
  },
  closedDates: unknown,
): BookingCalendar {
  const settings =
    typeof venue.settings === 'object' && venue.settings !== null
      ? (venue.settings as Record<string, unknown>)
      : {}
  const ordering = readOrderingSettings(settings)
  const hours = Object.fromEntries(
    WEEKDAYS.map((day) => {
      const of = ordering.serviceHours[day]
      return [day, of === null ? null : { opens: of.opens, closes: of.closes }]
    }),
  ) as Record<Weekday, BookingDayHours | null>
  return {
    timeZone: venue.timezone,
    dayEndsAt: venue.serviceDayEndsAt.slice(0, 5),
    hours,
    closedDates: closedDatesOf(closedDates),
  }
}

/** True when the venue's booking page takes requests: a settings row with the switch on. */
export function bookingPageOn(settings: Pick<ReservationSettings, 'online'> | null): boolean {
  return settings !== null && readOnlineSettings(settings.online).bookingPage
}

/** What the switch is set with. */
export interface OnlineBookingCommand {
  readonly bookingPage: boolean
}

/**
 * Puts the venue's booking page on or off. Setting what is already set is accepted and writes
 * nothing, so a double tap and an Undo settle on the same value.
 */
export async function setOnlineBooking(
  stx: ServiceTx,
  command: OnlineBookingCommand,
): Promise<ServiceResult> {
  // Locked: `online` is written back whole, so two changes at once must queue (C7).
  const existing = await lockSettings(stx)
  if (existing === null) return refuse('settings_missing')
  const online = readOnlineSettings(existing.online)
  const details = { bookingPage: command.bookingPage }
  if (online.bookingPage === command.bookingPage) return accepted(null, { details })
  await stx.tx
    .update(reservationSettings)
    .set({
      online: { ...online, bookingPage: command.bookingPage },
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(reservationSettings.venueId, stx.venueId))
  await stx.log({
    kind: 'reservation_settings.changed',
    toState: command.bookingPage ? 'booking_page_on' : 'booking_page_off',
    details,
  })
  return accepted(null, { details })
}

/** What a guest's request names: never a status or a time (the command decides). */
export interface ReservationRequestCommand {
  readonly serviceDate: string
  readonly partySize: number
  readonly guestName: string
  readonly phone: string
  readonly email: string
  readonly note?: string | null
  /** The Area the guest asks for, when the venue offers Areas (#580). */
  readonly areaId?: string | null
  /** The spots the guest picked himself, when the venue offers spots (#580). */
  readonly spotIds?: readonly string[]
}

/** The statuses that mean the guest already has this night: asking again changes nothing. */
const ALREADY_ASKED = ['requested', 'reserved'] as const

/**
 * Writes a guest's request for a night from the booking page: a Requested booking with no spot,
 * starting at the night's opening, on the guest record his number finds or makes.
 */
export async function requestReservation(
  stx: ServiceTx,
  command: ReservationRequestCommand,
): Promise<ServiceResult> {
  const settings = await readSettings(stx)
  if (!bookingPageOn(settings) || settings === null) return refuse('booking_off')
  const calendar = bookingCalendarOf(stx.venue, settings.closedDates)
  const verdict = bookingNightVerdict(command.serviceDate, stx.now, calendar)
  if (verdict === 'past') return refuse('night_passed')
  if (verdict === 'closed_date') return refuse('closed_night')
  if (verdict !== 'open') return refuse(verdict)
  const hours = bookingNightHours(command.serviceDate, calendar)
  if (hours === null) return refuse('outside_hours')
  const night = await openNight(stx, command.serviceDate)
  if (!night.ok) return refuse(night.code)
  // What the guest picked beyond the night (#580): checked against what the venue offers today.
  const online = readOnlineSettings(settings.online)
  const pick = await guestPickOf(stx, online, command)
  if (!pick.ok) return refuse(pick.code)

  const phoneKey = venuePhoneKey(stx, command.phone)
  if (phoneKey === null) return refuse('invalid_phone')
  const guestId = await guestOfRequest(stx, phoneKey, command)

  const [already] = await stx.tx
    .select({
      id: reservations.id,
      status: reservations.status,
      requestedAreaId: reservations.requestedAreaId,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.venueId, stx.venueId),
        eq(reservations.serviceDate, command.serviceDate),
        eq(reservations.guestId, guestId),
        eq(reservations.kind, 'booking'),
        inArray(reservations.status, [...ALREADY_ASKED]),
        isNull(reservations.deletedAt),
      ),
    )
    .limit(1)
  if (already !== undefined) {
    const held = (await spotsOfReservation(stx, already.id)).map((row) => row.spotId)
    const samePick =
      already.requestedAreaId === pick.areaId &&
      held.length === pick.spotIds.length &&
      pick.spotIds.every((spotId) => held.includes(spotId))
    if (!samePick) return refuse('already_requested')
    return accepted(null, {
      details: { reservationId: already.id, repeated: true, status: already.status },
    })
  }

  const reservationId = newId('rv')
  // The spots the guest picked are claimed by the booking rule staff go through, under the night's
  // lock (`openNight`): of two guests racing for one spot, one is written and one is refused.
  const grant = await claimSpots(
    stx,
    {
      reservationId,
      spotIds: pick.spotIds,
      serviceDate: command.serviceDate,
      startsAt: hours.opensAt,
      endsAt: null,
      turnMinutes: null,
    },
    night.settings.turnMinutes,
  )
  if (!grant.ok) return refused(null, grant.code, grant.details)
  await stx.tx.insert(reservations).values({
    id: reservationId,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: command.serviceDate,
    startsAt: hours.opensAt,
    endsAt: null,
    turnMinutes: null,
    kind: 'booking',
    status: 'requested',
    partySize: command.partySize,
    queueKey: null,
    guestId,
    partyLabel: null,
    note: command.note ?? null,
    reason: null,
    madeBy: null,
    seatedAt: null,
    requestedAreaId: pick.areaId,
    // The guest's own link (#579): only its token's hash is kept, never the token.
    guestTokenHash:
      stx.guestLinkKey === null
        ? null
        : guestLinkTokenHash(guestLinkToken(stx.guestLinkKey, reservationId)),
    ...stx.provenance,
  })
  await writeHeldSpots(stx, reservationId, pick.spotIds, grant.stretch, false)
  stx.touchNight(command.serviceDate)
  await stx.log({
    kind: 'reservation.created',
    reservationId,
    guestId,
    toState: 'requested',
    reason: 'online',
    details: {
      reservationKind: 'booking',
      partySize: command.partySize,
      spots: pick.spotIds.join(','),
      startsAt: hours.opensAt.toISOString(),
      opened: '',
    },
  })
  // With the switch on and his own spot picked, the booking confirms itself (D136, #580): it owes
  // the confirmed email in place of "We got your request" (#579). Either email carries the guest's
  // link (the worker makes it from the hash stored above).
  if (confirmsItself(online, pick.spotIds)) {
    await confirmOwnPick(stx, {
      reservationId,
      serviceDate: command.serviceDate,
      guestId,
      spotIds: pick.spotIds,
    })
    return accepted(null, { details: { reservationId, repeated: false, status: 'reserved' } })
  }
  // "We got your request" (#579), with the guest's link, to the address on his record.
  const email = await guestEmailOwed(stx, { kind: 'booking', guestId }, 'reservation_requested')
  return accepted(null, {
    details: { reservationId, repeated: false, status: 'requested', ...email },
  })
}

/**
 * The guest record a request lands on: the venue's record of this number, with the name and the
 * address filled where it had none, or a new record. Never overwrites what a record holds.
 */
async function guestOfRequest(
  stx: ServiceTx,
  phoneKey: string,
  command: ReservationRequestCommand,
): Promise<string> {
  const found = await lockGuestByPhone(stx, phoneKey)
  if (found === null) {
    const guestId = newId('gu')
    await stx.tx.insert(guests).values({
      id: guestId,
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      phoneKey,
      phone: command.phone,
      name: command.guestName,
      email: command.email,
      ...stx.provenance,
    })
    await stx.log({ kind: 'guest.changed', guestId, toState: 'listed', reason: 'from_booking' })
    return guestId
  }
  const fill = {
    ...(found.name === null ? { name: command.guestName } : {}),
    ...(found.email === null || found.email.trim() === '' ? { email: command.email } : {}),
  }
  if (Object.keys(fill).length > 0) {
    await stx.tx
      .update(guests)
      .set({ ...fill, ...stx.provenance, updatedAt: sql`now()` })
      .where(eq(guests.id, found.id))
    await stx.log({ kind: 'guest.changed', guestId: found.id, reason: 'from_booking' })
  }
  return found.id
}
