// The booking page's server side (#577; spec #322 Implementation Decisions 1, stories 1–9, 32, 33):
//
// - `readBookingFile` — what the worker publishes as `b/<venue id>.json`: the venue's name, whether
//   its page takes requests, its clock, each weekday's opening and closing, and its closed dates
//   from today on. Public fields only; the publisher walks it for forbidden values (rule 3).
// - `readBookingNight` — the one narrow answer the page asks the server for: can this night be
//   booked, and if not, why (past, outside the hours, too far, a closed date, the page off). Nothing
//   else: no count, no spot, no reservation (story 32).
// - `requestBooking` — a guest's request, behind Turnstile (D127 §5.1, story 33), written as the
//   guest command `reservation.request` through `applyService` (rule 1). A failed check is refused
//   before the database is asked; a siteverify that is down lets the request through and is
//   counted, as at Send and Pay.
// - `readGuestBooking` — what the guest's own link opens (#579): that one booking's night, hour,
//   party, spots and state, and whether it can still be called off. No phone, no note, no id.
// - `cancelGuestBooking` — the link's Cancel, behind Turnstile, written as the guest command
//   `reservation.guest_cancel` with the token's hash.
//
// Read-only reads run on `withTenant`; the guest's write is the service write path's.

import { randomUUID } from 'node:crypto'

import {
  areas,
  type DbPool,
  reservationSettings,
  reservationSpots,
  reservations,
  spots,
  venues,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'

import { type BookingNightVerdict, bookingNightHours, bookingNightVerdict } from '../booking-nights'
import { type GuestBookingState, guestBookingStateOf } from '../guest-booking'
import {
  BOOKING_FILE_AREAS_MAX,
  BOOKING_FILE_CLOSED_DATES_MAX,
  BOOKING_FILE_PLANS_MAX,
  BOOKING_FILE_SPOTS_MAX,
  type BookingFile,
} from '../guest-files'
import type { VenueId } from '../ids'
import { serviceDate, wallClock } from '../service-day'
import { applyService } from './apply-service'
import {
  guestLinkExpired,
  guestLinkHashesEqual,
  guestLinkTokenFits,
  guestLinkTokenHash,
} from './booking-link'
import type { ServiceOptions } from './engine'
import type { HumanCheck } from './guest'
import {
  type BookingSpotState,
  bookingPlanOf,
  bookingSpotStates,
} from './reservations/booking-plan'
import { guestCanCancel } from './reservations/guest-link'
import { bookingCalendarOf, bookingPageOn } from './reservations/online'
import { readOnlineSettings } from './reservations/online-settings'
import { refused, type ServiceResult } from './results'

/**
 * The venue and its reservation settings, as the reads need them; null for no live venue. The
 * plans and Areas are read only where `withOffer` (the night's verdict needs none of them, so the
 * night endpoint reads them once, for the spots).
 */
async function bookingVenue(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  { withOffer = true }: { readonly withOffer?: boolean } = {},
) {
  return withTenant(pool, tenantId, async (tx) => {
    const [venue] = await tx
      .select({
        id: venues.id,
        name: venues.name,
        timezone: venues.timezone,
        serviceDayEndsAt: venues.serviceDayEndsAt,
        settings: venues.settings,
      })
      .from(venues)
      .where(and(eq(venues.id, venueId), isNull(venues.archivedAt)))
    if (venue === undefined) return null
    const [settings] = await tx
      .select({
        online: reservationSettings.online,
        closedDates: reservationSettings.closedDates,
        turnMinutes: reservationSettings.turnMinutes,
      })
      .from(reservationSettings)
      .where(eq(reservationSettings.venueId, venueId))
    // What the page offers beyond the night (#580), read only when the page is on and offers it.
    const guestMay = bookingPageOn(settings ?? null)
      ? readOnlineSettings(settings?.online).guestMay
      : 'night'
    const offer =
      guestMay === 'night' || !withOffer
        ? { areas: [], plans: [] }
        : await bookingPlanOf(tx, venueId)
    return { venue, settings: settings ?? null, guestMay, offer }
  })
}

/** The content of `b/<venue id>.json` at `now`, or null when the tenant has no such live venue. */
export async function readBookingFile(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  now: Date,
): Promise<BookingFile | null> {
  const found = await bookingVenue(pool, tenantId, venueId)
  if (found === null) return null
  const calendar = bookingCalendarOf(found.venue, found.settings?.closedDates ?? [])
  const today = serviceDate(now, calendar.timeZone, calendar.dayEndsAt)
  return {
    venue_id: found.venue.id as VenueId,
    name: found.venue.name,
    on: bookingPageOn(found.settings),
    time_zone: calendar.timeZone,
    day_ends_at: calendar.dayEndsAt,
    hours: calendar.hours,
    closed_dates: calendar.closedDates
      .filter((day) => day >= today)
      .slice(0, BOOKING_FILE_CLOSED_DATES_MAX),
    guest_may: found.guestMay,
    // The Areas name the spots' own Areas too, so both choices carry them; the plans only "pick
    // their own spot" draws. Nothing else of a plan: no Table, no kind's label (rule 3).
    areas: found.offer.areas.slice(0, BOOKING_FILE_AREAS_MAX).map((area) => ({
      id: area.id as BookingFile['areas'][number]['id'],
      name: area.name,
    })),
    plans:
      found.guestMay !== 'spot'
        ? []
        : found.offer.plans.slice(0, BOOKING_FILE_PLANS_MAX).map((plan) => ({
            id: plan.id as BookingFile['plans'][number]['id'],
            name: plan.name,
            spots: plan.spots.slice(0, BOOKING_FILE_SPOTS_MAX).map((spot) => ({
              id: spot.id as BookingFile['plans'][number]['spots'][number]['id'],
              name: spot.name,
              symbol: spot.symbol,
              seats: spot.seats,
              area: spot.area as BookingFile['plans'][number]['spots'][number]['area'],
              ...spot.place,
            })),
          })),
  }
}

/**
 * The backend values of a venue the booking file must never hold (rule 3; #580): the tenant id,
 * every Table's id, code and code hash, and every Area's POS key. The Table is only how a spot
 * reaches its Area; the file names the Area and never the Table. A POS key the file also shows as
 * one of its own names (an Area keyed "1" beside a spot named "1") is dropped: it says nothing.
 */
export async function bookingBackendValues(
  pool: DbPool,
  file: BookingFile,
  scope: { readonly tenantId: string; readonly venueId: string },
): Promise<Set<string>> {
  const backend = new Set<string>([scope.tenantId])
  const tables = await withTenant(pool, scope.tenantId, (tx) =>
    tx
      .select({
        id: venueTables.id,
        qrToken: venueTables.qrToken,
        qrCodeHash: venueTables.qrCodeHash,
      })
      .from(venueTables)
      .where(eq(venueTables.venueId, scope.venueId)),
  )
  for (const table of tables) {
    backend.add(table.id)
    if (table.qrToken !== null) backend.add(table.qrToken)
    if (table.qrCodeHash !== null) backend.add(table.qrCodeHash)
  }
  const keys = await withTenant(pool, scope.tenantId, (tx) =>
    tx.select({ sourceKey: areas.sourceKey }).from(areas).where(eq(areas.venueId, scope.venueId)),
  )
  const shown = new Set<string>([
    file.name,
    ...file.areas.map((area) => area.name),
    ...file.plans.flatMap((plan) => [plan.name, ...plan.spots.map((spot) => spot.name)]),
  ])
  for (const key of keys) {
    if (key.sourceKey !== null && !shown.has(key.sourceKey)) backend.add(key.sourceKey)
  }
  return backend
}

/** Whether a night can be booked: `open`, or why not (`booking_off` when the page is off). */
export type BookingNightAnswer = BookingNightVerdict | 'booking_off'

/**
 * Whether `night` can be booked on the venue's page at `now`, or null when the tenant has no such
 * live venue. The page's own reading of its published file says the same up to 30 seconds earlier;
 * this is the answer the write itself will give.
 */
export async function readBookingNight(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  night: string,
  now: Date,
): Promise<BookingNightAnswer | null> {
  const found = await bookingVenue(pool, tenantId, venueId, { withOffer: false })
  if (found === null) return null
  if (!bookingPageOn(found.settings)) return 'booking_off'
  const calendar = bookingCalendarOf(found.venue, found.settings?.closedDates ?? [])
  return bookingNightVerdict(night, now, calendar)
}

/**
 * Free or taken, per spot of the venue's plans, on `night` (#580; story 32): only where the page is
 * on, offers "pick their own spot" and the night can be booked; null otherwise. Nothing else: no
 * names, no hours, no party. A blocked spot, or one another request waits on, reads taken; the
 * write still has the last word (`spot_taken`).
 */
export async function readBookingSpots(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  night: string,
  now: Date,
): Promise<Record<string, BookingSpotState> | null> {
  const found = await bookingVenue(pool, tenantId, venueId)
  if (found === null || found.settings === null || found.guestMay !== 'spot') return null
  const calendar = bookingCalendarOf(found.venue, found.settings.closedDates)
  if (bookingNightVerdict(night, now, calendar) !== 'open') return null
  const hours = bookingNightHours(night, calendar)
  if (hours === null) return null
  const spotIds = found.offer.plans.flatMap((plan) => plan.spots.map((spot) => spot.id))
  const turnMinutes = found.settings.turnMinutes
  return withTenant(pool, tenantId, (tx) =>
    bookingSpotStates(
      tx,
      found.venue,
      { serviceDate: night, opensAt: hours.opensAt, turnMinutes },
      spotIds,
    ),
  )
}

/** What a guest's request carries, as the booking API parsed it. */
export interface BookingRequestInput {
  readonly tenantId: string
  readonly venueId: string
  readonly actionId: string
  readonly serviceDate: string
  readonly partySize: number
  readonly guestName: string
  readonly phone: string
  readonly email: string
  readonly note: string | null
  /** The Area asked for, where the venue offers Areas (#580). */
  readonly areaId?: string | null
  /** The spots the guest picked himself, where the venue offers spots (#580). */
  readonly spotIds?: readonly string[]
  /** Turnstile's token; without it the request is refused `human_check`. */
  readonly humanToken?: string
  /** Turnstile's siteverify; without it every request fails the check (fail closed). */
  readonly humanCheck?: HumanCheck
  /** Counts a check that failed, or that let a request through while siteverify was down. */
  readonly onGuard?: (kind: 'human_check_failed' | 'human_check_open') => void
  readonly now?: Date
  readonly jobId?: string
  /** The guest-link key (`GUEST_LINK_KEY`, #579); without it the request is taken with no link. */
  readonly guestLinkKey?: string
  /**
   * Queues what the request owes in its own transaction (#592): the "We got your request" email
   * (#579, in the answer's details), or the confirmed email of a booking that confirmed itself
   * (#580, owed through `stx.oweGuestEmail`).
   */
  readonly queueJobs?: ServiceOptions['queueJobs']
}

/**
 * A guest's request for a night: Turnstile first, then `reservation.request` as a guest command
 * with no table. The answer is the command's: accepted with the reservation's id, or a named code.
 */
export async function requestBooking(
  pool: DbPool,
  input: BookingRequestInput,
): Promise<ServiceResult> {
  const token = input.humanToken
  const verdict =
    token === undefined || input.humanCheck === undefined
      ? 'failed'
      : await input.humanCheck(token, input.actionId, 'booking')
  if (verdict === 'failed') {
    input.onGuard?.('human_check_failed')
    return refused(input.actionId, 'human_check')
  }
  if (verdict === 'unavailable') input.onGuard?.('human_check_open')
  const { result } = await applyService(
    pool,
    {
      type: 'reservation.request',
      actionId: input.actionId,
      serviceDate: input.serviceDate,
      partySize: input.partySize,
      guestName: input.guestName,
      phone: input.phone,
      email: input.email,
      note: input.note,
      ...(input.areaId == null ? {} : { areaId: input.areaId }),
      ...(input.spotIds === undefined || input.spotIds.length === 0
        ? {}
        : { spotIds: [...input.spotIds] }),
    },
    {
      tenantId: input.tenantId,
      venueId: input.venueId,
      origin: 'guest',
      actor: { kind: 'guest' },
      jobId: input.jobId ?? `guest-booking-${randomUUID()}`,
      via: 'guest_page',
      ...(input.now === undefined ? {} : { now: input.now }),
    },
    {
      ...(input.guestLinkKey === undefined ? {} : { guestLinkKey: input.guestLinkKey }),
      ...(input.queueJobs === undefined ? {} : { queueJobs: input.queueJobs }),
    },
  )
  return result
}

/** How a guest's booking reads through his own link (#579): nothing about anyone else. */
export interface GuestLinkBooking {
  readonly venueName: string
  /** The night, as the venue's service day. */
  readonly night: string
  /** The hour the booking starts, on the venue's clock (`HH:MM`). */
  readonly time: string
  readonly partySize: number | null
  /** The spots it holds now, by the plan's names; none before the club gives it any. */
  readonly spots: readonly string[]
  readonly state: GuestBookingState
  /** True while its night is still to come and it is asked for or booked. */
  readonly canCancel: boolean
  /** True once its night has started: a change is a call to the club. */
  readonly nightStarted: boolean
}

/**
 * The booking a guest's link opens, or null for every token that opens none: unknown, malformed,
 * taken out of the book, past its days, of another venue, or made under another key. The token is
 * hashed whatever it is, the hash looked up, the stored hash compared in constant time and the
 * token checked against the current key, so each of those takes the same path. The token is never
 * logged.
 */
export async function readGuestBooking(
  pool: DbPool,
  input: {
    readonly tenantId: string
    readonly venueId: string
    readonly token: string
    /** GUEST_LINK_KEY; without it no link opens. */
    readonly guestLinkKey: string | undefined
    readonly now: Date
  },
): Promise<GuestLinkBooking | null> {
  const hash = guestLinkTokenHash(input.token)
  return withTenant(pool, input.tenantId, async (tx) => {
    const [venue] = await tx
      .select({
        name: venues.name,
        timezone: venues.timezone,
        serviceDayEndsAt: venues.serviceDayEndsAt,
      })
      .from(venues)
      .where(and(eq(venues.id, input.venueId), isNull(venues.archivedAt)))
    const [found] = await tx
      .select({
        id: reservations.id,
        status: reservations.status,
        serviceDate: reservations.serviceDate,
        startsAt: reservations.startsAt,
        partySize: reservations.partySize,
        guestTokenHash: reservations.guestTokenHash,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.venueId, input.venueId),
          eq(reservations.guestTokenHash, hash),
          eq(reservations.kind, 'booking'),
          isNull(reservations.deletedAt),
        ),
      )
      .limit(1)
    const same = guestLinkHashesEqual(found?.guestTokenHash ?? null, hash)
    // The stored hash alone opens nothing: the token must also be the current key's for this
    // booking, so a changed key revokes every link already sent.
    const fits = guestLinkTokenFits(input.guestLinkKey, found?.id ?? '', input.token)
    if (venue === undefined || found === undefined || !same || !fits) return null
    const today = serviceDate(input.now, venue.timezone, venue.serviceDayEndsAt.slice(0, 5))
    if (guestLinkExpired(found.serviceDate, today)) return null
    const held = await tx
      .select({ name: spots.name })
      .from(reservationSpots)
      .innerJoin(spots, eq(spots.id, reservationSpots.spotId))
      .where(and(eq(reservationSpots.reservationId, found.id), isNull(reservationSpots.releasedAt)))
    const clock = wallClock(found.startsAt, venue.timezone)
    return {
      venueName: venue.name,
      night: found.serviceDate,
      time: `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`,
      partySize: found.partySize,
      // "Bar 2" before "Bar 10": the names in the order a person counts them.
      spots: [...new Set(held.map((spot) => spot.name))].sort((a, b) =>
        a.localeCompare(b, 'bg', { numeric: true }),
      ),
      state: guestBookingStateOf(found.status),
      canCancel: guestCanCancel(found, today),
      nightStarted: found.serviceDate <= today,
    }
  })
}

/** What the Cancel of a guest's link carries, as the API parsed it. */
export interface GuestCancelInput {
  readonly tenantId: string
  readonly venueId: string
  /** The link's token, from the page's path. Hashed here; never logged, never in a command. */
  readonly token: string
  /** GUEST_LINK_KEY; without it no link opens, so every cancel is refused `link_unknown`. */
  readonly guestLinkKey: string | undefined
  readonly actionId: string
  /** Turnstile's token; without it the cancel is refused `human_check`. */
  readonly humanToken?: string
  /** Turnstile's siteverify; without it every cancel fails the check (fail closed). */
  readonly humanCheck?: HumanCheck
  /** Counts a check that failed, or that let a cancel through while siteverify was down. */
  readonly onGuard?: (kind: 'human_check_failed' | 'human_check_open') => void
  /** Queues the cancellation's email in the command's own transaction (#592). */
  readonly queueJobs?: ServiceOptions['queueJobs']
  readonly now?: Date
  readonly jobId?: string
}

/**
 * The guest calls his booking off from his link: Turnstile first, then the link must open (the
 * token is the current key's for that booking), then `reservation.guest_cancel` as a guest command
 * with the token's hash. The answer is the command's.
 */
export async function cancelGuestBooking(
  pool: DbPool,
  input: GuestCancelInput,
): Promise<ServiceResult> {
  const token = input.humanToken
  const verdict =
    token === undefined || input.humanCheck === undefined
      ? 'failed'
      : await input.humanCheck(token, input.actionId, 'booking_cancel')
  if (verdict === 'failed') {
    input.onGuard?.('human_check_failed')
    return refused(input.actionId, 'human_check')
  }
  if (verdict === 'unavailable') input.onGuard?.('human_check_open')
  // The link must open first: a token made under another key (the key changed since) is refused
  // as an unknown one, with the same code, before the command is issued.
  const opens = await readGuestBooking(pool, {
    tenantId: input.tenantId,
    venueId: input.venueId,
    token: input.token,
    guestLinkKey: input.guestLinkKey,
    now: input.now ?? new Date(),
  })
  if (opens === null) return refused(input.actionId, 'link_unknown')
  const { result } = await applyService(
    pool,
    {
      type: 'reservation.guest_cancel',
      actionId: input.actionId,
      tokenHash: guestLinkTokenHash(input.token),
    },
    {
      tenantId: input.tenantId,
      venueId: input.venueId,
      origin: 'guest',
      actor: { kind: 'guest' },
      jobId: input.jobId ?? `guest-booking-${randomUUID()}`,
      via: 'guest_page',
      ...(input.now === undefined ? {} : { now: input.now }),
    },
    input.queueJobs === undefined ? {} : { queueJobs: input.queueJobs },
  )
  return result
}
