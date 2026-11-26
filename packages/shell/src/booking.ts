// The booking page's contract (#577; spec #322 Implementation Decisions 1, stories 1–9, 32, 33): what
// the host gives a face that draws the page `/book/<organisation>/<venue>`, the wire shapes of the
// two booking endpoints, and the words. Pure: no I/O, no React; the clock is an input.
//
// The page shows only what the published files say (rule 4): the venue's booking file
// `b/<venue id>.json` (its name, the switch, its hours and closed dates) and the menu's snapshot
// (the venue's Style). The one thing it asks the server is "can this night be booked"
// (`GET /api/booking/night`); the request itself goes to `POST /api/booking`, behind Turnstile.
// A guest never names a status, a spot or an id: the command decides them.
//
// The screen is optional in a face (`BookingHostProps` is its own component, apart from the
// menu's `FaceHostProps`); a face without it gets the host's "online booking is not available".

import {
  type BookingCalendar,
  type BookingFile,
  GUEST_BOOKING_STATES,
  idSchema,
  isServiceDay,
  type Locale,
  localeToBcp47,
  offeredBookingNights,
} from '@restro/core'
import { z } from 'zod'

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

/** Its answer: the night and what it is. Nothing else (no count, no spot, story 32). */
export const BookingNightReplySchema = z.strictObject({
  night: DaySchema,
  answer: z.enum(BOOKING_NIGHT_ANSWERS),
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
})

export type BookingForm = z.output<typeof BookingFormSchema>

/** `POST /api/booking`: the form, the venue, the page's action id and Turnstile's token. */
export const BookingRequestSchema = BookingFormSchema.extend({
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
] as const

export type BookingRefusal = (typeof BOOKING_REFUSALS)[number]

/** `POST /api/booking`'s answer: the request is with the club, or why not. No id goes back. */
export const BookingReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), refusal: z.enum(BOOKING_REFUSALS) }),
])

export type BookingReply = z.output<typeof BookingReplySchema>

/** A refusal code from the command, as the page's words know it; anything else is `unavailable`. */
export function bookingRefusalOf(code: string): BookingRefusal {
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

/** What the booking page shows, from the venue's booking file. */
export interface BookingView {
  readonly locale: Locale
  readonly venueName: string
  /** False: the club takes no online bookings; the page says so and links nowhere. */
  readonly on: boolean
  readonly nights: readonly BookingNight[]
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
  return { locale, venueName: file.name, on: file.on, nights }
}

/** Where the request stands: being filled in, on its way, or with the club (the server said so). */
export type BookingStage = 'form' | 'sending' | 'sent'

/** What the host binds: its state to draw and the two things the page can ask (D72). */
export interface BookingBinding {
  readonly stage: BookingStage
  /** The last request's refusal, or null. */
  readonly refusal: BookingRefusal | null
  /** The server's answer for the night last checked, or null before one. */
  readonly night: BookingNightReply | null
  /** Asks the server whether a night can be booked (on choosing it). */
  readonly checkNight: (night: string) => void
  /** Sends the request. The page shows the answer screen only once the server took it. */
  readonly send: (form: BookingForm) => void
}

// ─── The guest's own link (#579; spec #322 stories 8 and 34) ─────────────────────────────────────
// `/book/<organisation>/<venue>/<token>` opens one booking: the face's booking screen draws it
// instead of the form when the host binds `guestLink`. The page reads the booking through one
// narrow endpoint keyed by the token in its path (`GET /api/booking/link/<token>`), and its Cancel
// is `POST` to the same path, behind Turnstile. The token travels in the path only, never in a
// query string; the query names the organisation and the venue, as the night endpoint's does.
// An unknown, malformed or expired token is one answer (404, `link_unknown`): one plain page.

/** `GET /api/booking/link/<token>?organization=<tn_>&venue=<vn_>`: the venue the link is of. */
export const GuestLinkQuerySchema = z.strictObject({
  organization: idSchema('tn'),
  venue: idSchema('vn'),
})

/** What the link shows of its booking: nothing about anyone else, no phone, no note, no id. */
export const GuestLinkBookingSchema = z.strictObject({
  night: DaySchema,
  /** The hour it starts, on the venue's clock. */
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z
    .int()
    .min(1)
    .max(BOOKING_LIMITS.partySize * 10)
    .nullable(),
  /** The spots it holds, by the plan's names; none before the club gives it any. */
  spots: z.array(z.string().min(1).max(80)).max(50),
  state: z.enum(GUEST_BOOKING_STATES),
  /** True while its night is still to come and it is asked for or booked. */
  canCancel: z.boolean(),
  /** True once its night has started (the venue's service day): a change is a call to the club. */
  nightStarted: z.boolean(),
})

export type GuestLinkBooking = z.output<typeof GuestLinkBookingSchema>

/** `POST /api/booking/link/<token>`: the venue, the page's action id and Turnstile's token. */
export const GuestCancelRequestSchema = z.strictObject({
  organization: idSchema('tn'),
  venue: idSchema('vn'),
  actionId: z.uuid(),
  humanToken: z.string().min(1).max(HUMAN_TOKEN_MAX).optional(),
})

export type GuestCancelRequest = z.output<typeof GuestCancelRequestSchema>

/** Why the link could not do what was asked, as the page words it. */
export const GUEST_LINK_REFUSALS = [
  'night_started',
  'link_unknown',
  'human_check',
  'rate_limited',
  'invalid_request',
  'unavailable',
] as const

export type GuestLinkRefusal = (typeof GUEST_LINK_REFUSALS)[number]

/** The Cancel's answer: the booking as it stands now, or why not. */
export const GuestCancelReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), booking: GuestLinkBookingSchema }),
  z.strictObject({ ok: z.literal(false), refusal: z.enum(GUEST_LINK_REFUSALS) }),
])

export type GuestCancelReply = z.output<typeof GuestCancelReplySchema>

/** A refusal code from the command, as the link's words know it; anything else is `unavailable`. */
export function guestLinkRefusalOf(code: string): GuestLinkRefusal {
  return (GUEST_LINK_REFUSALS as readonly string[]).includes(code)
    ? (code as GuestLinkRefusal)
    : 'unavailable'
}

/**
 * Where the link's page stands: reading the booking, showing it, the one plain page for a link
 * that opens nothing, or a read that failed (the page offers to try again).
 */
export type GuestLinkStage = 'loading' | 'shown' | 'gone' | 'failed'

/** What the host binds for a guest's own link: the booking and the one thing it can ask (D72). */
export interface GuestLinkBinding {
  readonly stage: GuestLinkStage
  /** The booking as the server last said it; null unless `shown`. */
  readonly booking: GuestLinkBooking | null
  /** True while the Cancel is on its way. */
  readonly cancelling: boolean
  /** The last Cancel's refusal, or null. */
  readonly refusal: GuestLinkRefusal | null
  /** Calls the booking off. The page shows it cancelled only once the server says so. */
  readonly cancel: () => void
  /** Reads the booking again after a failed read. */
  readonly retry: () => void
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
  /** Set: the page is a guest's own link (#579), and draws that booking instead of the form. */
  readonly guestLink?: GuestLinkBinding
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
