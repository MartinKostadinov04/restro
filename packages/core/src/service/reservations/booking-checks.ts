// What a booking form is told before it is saved (ticket #328; D134, D135, D137): the advice a
// hostess reads under the field it belongs to. Read-only: nothing here writes, and nothing here
// refuses — a **warning never blocks a save** (more guests than seats, the same contact twice that
// night, an hour outside the venue's hours), and the one thing that does block, a spot somebody
// else holds, is given here only so the screen can say so while she is still choosing; the write
// path (`claimSpots`) decides it again, inside its own transaction, and is the authority.
//
// The hours are the venue's own service hours (`venues.settings.ordering.serviceHours`) and its
// one-off closed dates: there is no second copy of the working hours for reservations (#325).
//
// No personal data leaves this module beyond what the screen already shows on the night's list:
// the name of the party in the way and the hour they hold the spot from. Never a phone number.

import {
  type DbPool,
  guests,
  type ReadTx,
  reservationNights,
  reservationSettings,
  reservations,
  spots,
  venueSpotKinds,
  venues,
  withTenant,
} from '@restro/db'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'

import { readOrderingSettings } from '../../ordering-settings'
import { serviceHoursOn } from '../../service-hours'
import type { ReadInput } from '../night-read'
import { closedDatesOf } from './closed-dates'
import { phoneKeyOf, regionOfLocale } from './guests'
import { coveredBy, heldStretch, overlaps } from './overlap'
import { holdsOfNight } from './plan-read'
import { openReservations, type ReservationReadRefusal } from './read'
import { nightWritable, type ReservationRefusal } from './rows'
import { holdsSpots, type ReservationStatus } from './status'

/** What the form asks about: the booking as it stands in the form right now. */
export interface BookingChecksInput extends ReadInput {
  /** The night (a service day). */
  readonly day: string
  readonly startsAt: Date
  readonly endsAt: Date | null
  readonly partySize: number | null
  readonly name: string | null
  readonly phone: string | null
  readonly spotIds: readonly string[]
  /** The reservation being edited: it is never "in the way" of itself, nor a duplicate of itself. */
  readonly reservationId?: string
}

/** More guests than the chosen spots seat. Advice, never a refusal (D134). */
export interface SeatsCheck {
  readonly guests: number
  readonly seats: number
}

/** Another booking that night for the same name or phone (D135: warns, never refuses). */
export interface SameContactCheck {
  readonly name: string | null
  readonly startsAt: Date
}

/** The spot another party holds for an overlapping stretch: what the write path would refuse. */
export interface TakenCheck {
  readonly spotId: string
  readonly spotName: string
  readonly reservationId: string
  readonly kind: 'booking' | 'walk_in' | 'block'
  /** The party in the way; null for a block (its reason is on the plan). */
  readonly name: string | null
  /** The hour they hold the spot from. */
  readonly from: Date
}

/** The booking form's advice. */
export interface BookingChecks {
  /** Why the night cannot be written at all; null when it can. */
  readonly night: ReservationRefusal | null
  readonly seats: SeatsCheck | null
  readonly sameContact: SameContactCheck | null
  /**
   * A new booking's phone already belongs to a guest on the venue's list (#333): the booking
   * will be his, and the form names him. Never for a changed booking, nor an erased guest.
   */
  readonly listed: { readonly guestId: string; readonly name: string | null } | null
  /** The venue is shut that night: its weekday is closed, or the date is a one-off closed one. */
  readonly closedNight: boolean
  /** The hour is before the venue opens that night; the hours it keeps, as instants. */
  readonly beforeOpening: { readonly opensAt: Date; readonly closesAt: Date } | null
  /**
   * The night's end has already come for that night (D138): its closing hour, or an admin's early
   * end. The booking is still taken; the form says it is for a closed night.
   */
  readonly nightEnded: boolean
  /** The hour is at or after the closing hour: the night's end will mark it no-show (D138). */
  readonly afterClosing: boolean
  readonly taken: TakenCheck | null
}

/** The effective seats of these spots, or null when any of them has no number to add up. */
async function seatsOf(
  tx: ReadTx,
  venueId: string,
  spotIds: readonly string[],
): Promise<number | null> {
  if (spotIds.length === 0) return null
  const rows = await tx
    .select({ seats: spots.seats, kind: spots.kind })
    .from(spots)
    .where(
      and(inArray(spots.id, [...spotIds]), eq(spots.venueId, venueId), isNull(spots.removedAt)),
    )
  if (rows.length === 0) return null
  const kinds = await tx
    .select({ key: venueSpotKinds.key, defaultSeats: venueSpotKinds.defaultSeats })
    .from(venueSpotKinds)
    .where(eq(venueSpotKinds.venueId, venueId))
  const defaults = new Map(kinds.map((kind) => [kind.key, kind.defaultSeats]))
  let total = 0
  for (const row of rows) {
    const known = row.seats ?? defaults.get(row.kind) ?? null
    // A spot with no number says nothing about how many it seats, so nobody is told "too many".
    if (known === null) return null
    total += known
  }
  return total
}

/**
 * The advice for a booking as it is typed. Needs `reservations.tonight`, as the night's list does;
 * the write itself asks for its own permission.
 */
export async function readBookingChecks(
  pool: DbPool,
  input: BookingChecksInput,
): Promise<
  | { readonly ok: true; readonly checks: BookingChecks }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    const [venue] = await tx.select().from(venues).where(eq(venues.id, reader.venue.id))
    const [settings] = await tx
      .select()
      .from(reservationSettings)
      .where(eq(reservationSettings.venueId, reader.venue.id))
    if (venue === undefined) return { ok: false, code: 'venue_missing' } as const

    const night =
      settings === undefined
        ? ('settings_missing' as const)
        : nightWritable(
            { serviceDate: reader.today, permissions: reader.held },
            input.day,
            settings,
          )
    // The night's end has come for that night (D138): a booking added now is for a closed night.
    // A warning, never a refusal — the night stays writable until it has passed.
    const [record] = await tx
      .select({ closedAt: reservationNights.closedAt })
      .from(reservationNights)
      .where(
        and(
          eq(reservationNights.venueId, reader.venue.id),
          eq(reservationNights.serviceDate, input.day),
        ),
      )
    const nightEnded = record?.closedAt != null

    // The guests against the seats.
    const seats = await seatsOf(tx, reader.venue.id, input.spotIds)
    const seatsCheck =
      seats !== null && input.partySize !== null && input.partySize > seats
        ? { guests: input.partySize, seats }
        : null

    // The same contact twice that night: by the phone's digits, or by the name as typed.
    const phoneKey =
      input.phone === null ? null : phoneKeyOf(input.phone, regionOfLocale(venue.defaultLocale))
    const typed = input.name?.trim().toLowerCase() ?? ''
    let sameContact: SameContactCheck | null = null
    if (phoneKey !== null || typed !== '') {
      const others = await tx
        .select({
          startsAt: reservations.startsAt,
          status: reservations.status,
          label: reservations.partyLabel,
          guestName: guests.name,
          phoneKey: guests.phoneKey,
        })
        .from(reservations)
        .leftJoin(guests, eq(guests.id, reservations.guestId))
        .where(
          and(
            eq(reservations.venueId, reader.venue.id),
            eq(reservations.serviceDate, input.day),
            isNull(reservations.deletedAt),
            ne(reservations.kind, 'block'),
            input.reservationId === undefined
              ? undefined
              : ne(reservations.id, input.reservationId),
            // A party that was called off, or never came, is not "already booked tonight".
            sql`${reservations.status} not in ('cancelled', 'no_show', 'not_seated', 'finished')`,
          ),
        )
        .orderBy(reservations.startsAt)
      const hit = others.find((other) => {
        const name = (other.label ?? other.guestName ?? '').trim().toLowerCase()
        return (
          (phoneKey !== null && other.phoneKey === phoneKey) || (typed !== '' && name === typed)
        )
      })
      if (hit !== undefined) {
        sameContact = { name: hit.label ?? hit.guestName, startsAt: hit.startsAt }
      }
    }

    // A phone already on the venue's list: the booking will join that guest's record.
    let listed: BookingChecks['listed'] = null
    if (phoneKey !== null && input.reservationId === undefined) {
      const [known] = await tx
        .select({ id: guests.id, name: guests.name })
        .from(guests)
        .where(
          and(
            eq(guests.venueId, reader.venue.id),
            eq(guests.phoneKey, phoneKey),
            isNull(guests.erasedAt),
          ),
        )
        .limit(1)
      if (known !== undefined) listed = { guestId: known.id, name: known.name }
    }

    // The hours: the venue's own, and its one-off closed dates.
    const ordering = readOrderingSettings(venue.settings)
    const clock = {
      timeZone: venue.timezone,
      dayEndsAt: String(venue.serviceDayEndsAt).slice(0, 5),
      hours: ordering.serviceHours,
    }
    const configured = Object.values(ordering.serviceHours).some((day) => day !== null)
    const onDate = serviceHoursOn(input.day, clock)
    const oneOff = closedDatesOf(settings?.closedDates).includes(input.day)
    const closedNight = oneOff || (configured && onDate === null)
    const beforeOpening =
      !closedNight && onDate !== null && input.startsAt.getTime() < onDate.opensAt.getTime()
        ? { opensAt: onDate.opensAt, closesAt: onDate.closesAt }
        : null
    const afterClosing =
      !closedNight && onDate !== null && input.startsAt.getTime() >= onDate.closesAt.getTime()

    // A spot somebody else holds for these hours: what the write path would refuse.
    let taken: TakenCheck | null = null
    if (input.spotIds.length > 0 && settings !== undefined) {
      const stretch = heldStretch(
        {
          reservationId: (input.reservationId ?? 'rv_new') as never,
          spotIds: input.spotIds as never,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          turnMinutes: null,
        },
        settings.turnMinutes,
      )
      if (stretch.ok) {
        const facts = await holdsOfNight(tx, reader.venue.id, input.spotIds, {
          day: input.day,
          from: input.startsAt,
          to: stretch.stretch.to,
          passed: false,
          turnMinutes: settings.turnMinutes,
        })
        const names = await tx
          .select({ id: spots.id, name: spots.name })
          .from(spots)
          .where(inArray(spots.id, [...input.spotIds]))
        for (const spotId of input.spotIds) {
          const hit = (facts.get(spotId) ?? []).find(
            (fact) =>
              fact.reservationId !== input.reservationId &&
              holdsSpots(fact.status as ReservationStatus) &&
              overlaps(
                stretch.stretch,
                coveredBy({
                  reservationId: fact.reservationId as never,
                  spotId: spotId as never,
                  status: fact.status,
                  stretch: fact.stretch,
                  openEnded: fact.openEnded,
                }),
              ),
          )
          if (hit !== undefined) {
            taken = {
              spotId,
              spotName: names.find((one) => one.id === spotId)?.name ?? '',
              reservationId: hit.reservationId,
              kind: hit.kind,
              name: hit.kind === 'block' ? null : hit.name,
              from: hit.startsAt,
            }
            break
          }
        }
      }
    }

    return {
      ok: true,
      checks: {
        night,
        seats: seatsCheck,
        sameContact,
        listed,
        closedNight,
        nightEnded,
        beforeOpening,
        afterClosing,
        taken,
      },
    } as const
  })
}
