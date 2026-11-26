// The booking page's contract (#577; spec #322 Implementation Decisions 1, stories 1–9, 32, 33): what
// the host gives a face that draws the page `/book/<organisation>/<venue>`, the wire shapes of the
// two booking endpoints, and the words. Pure: no I/O, no React; the clock is an input.
//
// The page shows only what the published files say (rule 4): the venue's booking file
// `b/<venue id>.json` (its name, the switch, its hours and closed dates) and the menu's snapshot
// (the venue's Style). The one thing it asks the server is "can this night be booked"
// (`GET /api/booking/night`); the request itself goes to `POST /api/booking`, behind Turnstile.
// A guest never names a status or a time: the command decides them. Where the venue offers it
// (#580), the guest also chooses an Area, or picks his own spots on the plan the file publishes,
// and the night's answer then says free or taken per spot (and nothing else, story 32).
//
// The screen is optional in a face (`BookingHostProps` is its own component, apart from the
// menu's `FaceHostProps`); a face without it gets the host's "online booking is not available".

import {
  BOOKING_SPOTS_PICKED_MAX,
  type BookingCalendar,
  type BookingFile,
  type BookingGuestMay,
  idSchema,
  isServiceDay,
  type Locale,
  localeToBcp47,
  offeredBookingNights,
  planExtent,
  type SpotPlace,
  type SpotSymbol,
} from '@restro/core'
import { z } from 'zod'

/** The most spots one request picks (the file's own cap), for a face to stop the picker at. */
export { BOOKING_SPOTS_PICKED_MAX }

import { type BookingStrings, stringsFor } from './strings'
import type { ViewModel } from './view-model'

/** The longest a field of the form may be, as the command takes it. */
export const BOOKING_LIMITS = {
  partySize: 50,
  name: 80,
  phoneMin: 6,
  phone: 40,
  email: 200,
  note: 500,
} as const

/** The longest Turnstile token (Cloudflare's siteverify: 2048 characters). */
const HUMAN_TOKEN_MAX = 2_048

/** The largest request body the booking endpoint reads, in bytes. */
export const BOOKING_API_MAX_BYTES = 4 * 1024

const DaySchema = z.string().refine(isServiceDay, 'a service day (YYYY-MM-DD)')

/** What the narrow endpoint answers about a night: bookable, or why not. */
export const BOOKING_NIGHT_ANSWERS = [
  'open',
  'closed_date',
  'outside_hours',
  'past',
  'too_far',
  'booking_off',
] as const

export type BookingNightAnswer = (typeof BOOKING_NIGHT_ANSWERS)[number]

/** `GET /api/booking/night?organization=<tn_>&venue=<vn_>&night=<YYYY-MM-DD>`. */
export const BookingNightQuerySchema = z.strictObject({
  organization: idSchema('tn'),
  venue: idSchema('vn'),
  night: DaySchema,
})

/** Whether one spot can be booked on the night (#580): free or taken, nothing more. */
export const BOOKING_SPOT_STATES = ['free', 'taken'] as const

export type BookingSpotState = (typeof BOOKING_SPOT_STATES)[number]

/**
 * Its answer: the night and what it is, and (only where the page offers "pick their own spot"
 * and the night is open) free or taken per spot id (#580). Nothing else: no count, no name, no
 * hour, no party (story 32).
 */
export const BookingNightReplySchema = z.strictObject({
  night: DaySchema,
  answer: z.enum(BOOKING_NIGHT_ANSWERS),
  spots: z.record(idSchema('sp'), z.enum(BOOKING_SPOT_STATES)).optional(),
})

export type BookingNightReply = z.output<typeof BookingNightReplySchema>

/** What the guest fills in. The email is always asked (the club answers by email). */
export const BookingFormSchema = z.strictObject({
  night: DaySchema,
  partySize: z.int().min(1).max(BOOKING_LIMITS.partySize),
  name: z.string().trim().min(1).max(BOOKING_LIMITS.name),
  phone: z.string().trim().min(BOOKING_LIMITS.phoneMin).max(BOOKING_LIMITS.phone),
  email: z.email().max(BOOKING_LIMITS.email),
  note: z.string().trim().max(BOOKING_LIMITS.note).nullable(),
  /** The Area asked for, where the page offers Areas (#580); null for none. */
  areaId: idSchema('ar').nullable(),
  /** The spots the guest picked, where the page offers spots (#580); empty for none. */
  spotIds: z.array(idSchema('sp')).max(BOOKING_SPOTS_PICKED_MAX),
})

export type BookingForm = z.output<typeof BookingFormSchema>

/** `POST /api/booking`: the form, the venue, the page's action id and Turnstile's token. */
export const BookingRequestSchema = BookingFormSchema.extend({
  // A page published before #580 sends neither.
  areaId: idSchema('ar').nullable().default(null),
  spotIds: z.array(idSchema('sp')).max(BOOKING_SPOTS_PICKED_MAX).default([]),
  organization: idSchema('tn'),
  venue: idSchema('vn'),
  /** Made once per form by the page: a retry of the same request is the same request. */
  actionId: z.uuid(),
  humanToken: z.string().min(1).max(HUMAN_TOKEN_MAX).optional(),
})

export type BookingRequest = z.output<typeof BookingRequestSchema>

/** Why a request was not taken, as the page words it. */
export const BOOKING_REFUSALS = [
  'booking_off',
  'closed_night',
  'outside_hours',
  'too_far',
  'night_passed',
  'invalid_phone',
  'human_check',
  'rate_limited',
  'invalid_request',
  'unavailable',
  'spot_taken',
  'already_requested',
] as const

export type BookingRefusal = (typeof BOOKING_REFUSALS)[number]

/**
 * `POST /api/booking`'s answer: the request is with the club, or why not. No id goes back.
 * `confirmed`: the booking confirmed itself, the guest having picked his own spot (#580, D136).
 */
export const BookingReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), confirmed: z.boolean().optional() }),
  z.strictObject({ ok: z.literal(false), refusal: z.enum(BOOKING_REFUSALS) }),
])

export type BookingReply = z.output<typeof BookingReplySchema>

/** A refusal code from the command, as the page's words know it; anything else is `unavailable`. */
export function bookingRefusalOf(code: string): BookingRefusal {
  // A spot gone from the plan since the page read it is, to the guest, a spot he cannot have: the
  // page reads the night again and shows the plan as it is (#580).
  if (code === 'spot_missing') return 'spot_taken'
  return (BOOKING_REFUSALS as readonly string[]).includes(code)
    ? (code as BookingRefusal)
    : 'unavailable'
}

/** One night the page offers: its day, its label in the guest's language, and whether it is open. */
export interface BookingNight {
  readonly date: string
  readonly label: string
  /** False for a night the club closed: offered, marked closed, refused if chosen. */
  readonly open: boolean
}

/** An Area the guest may ask for (#580). */
export interface BookingAreaView {
  readonly id: string
  readonly name: string
}

/** A spot as the plan draws it (#580), its place in per cent of its plan's box. */
export interface BookingSpotView {
  readonly id: string
  readonly name: string
  readonly symbol: SpotSymbol
  readonly seats: number | null
  /** The name of the Area its Table belongs to; null for none. */
  readonly area: string | null
  readonly shape: SpotPlace['shape']
  readonly rotation: number
  /** Left, top, width and height, in per cent of the plan's box. */
  readonly box: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  }
}

/** One floor plan as the page draws it (#580): its name, its proportions and its spots. */
export interface BookingPlanView {
  readonly id: string
  readonly name: string
  /** The plan box's height over its width, so the page keeps the drawing's proportions. */
  readonly aspect: number
  readonly spots: readonly BookingSpotView[]
}

/** What the booking page shows, from the venue's booking file. */
export interface BookingView {
  readonly locale: Locale
  readonly venueName: string
  /** False: the club takes no online bookings; the page says so and links nowhere. */
  readonly on: boolean
  readonly nights: readonly BookingNight[]
  /** What the guest may do beyond the night (#580). */
  readonly guestMay: BookingGuestMay
  /** The Areas a guest may ask for, where offered. */
  readonly areas: readonly BookingAreaView[]
  /** The plans a guest picks his spot on, where offered; the current one first. */
  readonly plans: readonly BookingPlanView[]
}

/** The calendar of a published booking file. */
export function bookingCalendarOfFile(file: BookingFile): BookingCalendar {
  return {
    timeZone: file.time_zone,
    dayEndsAt: file.day_ends_at,
    hours: file.hours,
    closedDates: file.closed_dates,
  }
}

/** A night's label, "Fri, 28 Nov" in the guest's language; the day itself, never the clock's. */
export function bookingNightLabel(date: string, locale: Locale): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}

/**
 * The booking page's view at `now`: the nights inside the venue's hours from today to the horizon,
 * the closed ones marked; none when the page is off.
 */
export function bookingViewOf(file: BookingFile, locale: Locale, now: Date): BookingView {
  const nights = file.on
    ? offeredBookingNights(now, bookingCalendarOfFile(file)).map((night) => ({
        date: night.date,
        label: bookingNightLabel(night.date, locale),
        open: night.verdict === 'open',
      }))
    : []
  const offered = file.on ? file.guest_may : 'night'
  return {
    locale,
    venueName: file.name,
    on: file.on,
    nights,
    guestMay: offered,
    areas: offered === 'area' ? file.areas.map(({ id, name }) => ({ id, name })) : [],
    plans: offered === 'spot' ? file.plans.map((plan) => bookingPlanViewOf(plan, file)) : [],
  }
}

/** Rounds a per-cent figure to two places, so the markup carries short numbers. */
const percent = (part: number, whole: number) => Math.round((part / whole) * 10_000) / 100

/**
 * One plan of the file as the page draws it: each spot placed in per cent of the plan's own box
 * (`planExtent`, the box the staff plan draws in), so it scales to any width and keeps its shape.
 */
export function bookingPlanViewOf(
  plan: BookingFile['plans'][number],
  file: Pick<BookingFile, 'areas'>,
): BookingPlanView {
  const extent = planExtent(plan.spots)
  const areaNames = new Map<string, string>(file.areas.map((area) => [area.id, area.name]))
  return {
    id: plan.id,
    name: plan.name,
    aspect: extent.height / extent.width,
    spots: plan.spots.map((spot) => ({
      id: spot.id,
      name: spot.name,
      symbol: spot.symbol,
      seats: spot.seats,
      area: spot.area === null ? null : (areaNames.get(spot.area) ?? null),
      shape: spot.shape,
      rotation: spot.rotation,
      box: {
        left: percent(spot.x - extent.x, extent.width),
        top: percent(spot.y - extent.y, extent.height),
        width: percent(spot.width, extent.width),
        height: percent(spot.height, extent.height),
      },
    })),
  }
}

/**
 * Where the request stands: being filled in, on its way, with the club (the server said so), or
 * confirmed: a booking that confirmed itself, the guest having picked his own spot (#580).
 */
export type BookingStage = 'form' | 'sending' | 'sent' | 'confirmed'

/** What the host binds: its state to draw and the two things the page can ask (D72). */
export interface BookingBinding {
  readonly stage: BookingStage
  /** The last request's refusal, or null. */
  readonly refusal: BookingRefusal | null
  /**
   * The server's answer for the night last checked, or null before one; with free or taken per
   * spot where the page offers spots. Read again after a `spot_taken` refusal.
   */
  readonly night: BookingNightReply | null
  /** Asks the server whether a night can be booked (on choosing it). */
  readonly checkNight: (night: string) => void
  /** Sends the request. The page shows the answer screen only once the server took it. */
  readonly send: (form: BookingForm) => void
}

/** What a face's booking screen receives from its host. */
export interface BookingHostProps {
  /** The venue's menu, for its Style (theme and design): the page looks like the menu. */
  readonly view: ViewModel
  readonly booking: BookingView
  /** Unbound (an admin's preview): the form is drawn and cannot be sent. */
  readonly binding?: BookingBinding
  /** Where `/a/…` image paths live. */
  readonly assetBase?: string
  /** Font family name → self-hosted font stack. */
  readonly fontStacks?: Readonly<Record<string, string>>
  /** Forced colour scheme; `auto` follows the guest's screen. */
  readonly scheme?: 'auto' | 'light' | 'dark'
}

/** The words of the booking page for a locale. */
export function bookingStringsFor(locale: Locale): BookingStrings {
  return stringsFor(locale).booking
}

/** Why a night cannot be booked, in words that name another way; null for an open night. */
export function bookingNightText(answer: BookingNightAnswer, words: BookingStrings): string | null {
  switch (answer) {
    case 'open':
      return null
    case 'closed_date':
      return words.refusals.closed_night
    case 'past':
      return words.refusals.night_passed
    case 'outside_hours':
      return words.refusals.outside_hours
    case 'too_far':
      return words.refusals.too_far
    case 'booking_off':
      return words.refusals.booking_off
  }
}
