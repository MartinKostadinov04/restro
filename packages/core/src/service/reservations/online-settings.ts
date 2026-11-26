// Part 2's reservation settings (ticket #325; spec #321, Implementation Decisions 9; D136), stored in
// `reservation_settings.online` with their defaults. A venue is not asked for these twice: part 2
// builds the screens and the booking page that read them. The first one read is `bookingPage`
// (#577): whether the venue's booking page takes requests, switched by `reservation_online.set`.
//
// What D136 names, and nothing more:
// - whether the booking page takes requests at all (`bookingPage`, #577);
// - what a guest may do on the booking page: ask for a night only, choose an Area, or pick
//   their own spot (`guestMay`; the spec's "zone" is an Area, Martin 11-25);
// - whether a booking confirms itself (`autoConfirm`) — D136 applies it only where the guest picked
//   his own spot, which is a rule of part 2's reader, not of this value;
// - the prepayment: on or off, and its amount in integer minor units of the venue's own currency
//   (rule 8: a whole number, never a float; the venue's currency stays the venue's, so none is
//   stored beside it);
// - the club's prepayment wording and refund wording, which the page shows before a guest pays. One
//   text per language, because a club's page speaks every language the venue has.

import { z } from 'zod'

/** What a guest may do on the booking page (D136, 12.7, 2.32). */
export const GUEST_MAY_VALUES = ['night', 'area', 'spot'] as const

/** One thing a guest may do on the booking page. */
export type GuestMay = (typeof GUEST_MAY_VALUES)[number]

/** The most a club's wording may hold, per language. */
export const ONLINE_WORDING_MAX = 2000

/** The largest prepayment, in minor units: ten thousand in the venue's currency. */
export const PREPAYMENT_MAX_MINOR = 1_000_000

/** A wording per language, keyed by the language's two-letter code. */
const Wording = z.record(z.string().regex(/^[a-z]{2}$/), z.string().max(ONLINE_WORDING_MAX))

/**
 * The part-2 values of one venue. Every key has a default, so what the column holds can never be
 * short of a value, and one read says what part 2 would see.
 */
export const OnlineSettingsSchema = z.strictObject({
  /**
   * Whether the venue takes bookings on its booking page at all (#577; spec #322 story 26). Off by
   * default: a venue's page says it takes no online bookings until an owner switches this on.
   */
  bookingPage: z.boolean().default(false),
  /** What guests may do on the booking page. Cautious by default: only ask for a night. */
  guestMay: z.enum(GUEST_MAY_VALUES).default('night'),
  /** Whether a booking confirms itself. Off: a hostess answers every online booking. */
  autoConfirm: z.boolean().default(false),
  /** Whether a booking asks for a prepayment. */
  prepayment: z.boolean().default(false),
  /** The prepayment's amount in minor units of the venue's currency; empty until one is chosen. */
  prepaymentMinor: z.number().int().min(1).max(PREPAYMENT_MAX_MINOR).nullable().default(null),
  /** The club's own prepayment wording, per language (D136: a lawyer's text goes here). */
  prepaymentWording: Wording.default({}),
  /** The club's own refund wording, per language. */
  refundWording: Wording.default({}),
})

/** The part-2 values of a venue. */
export type OnlineSettings = z.output<typeof OnlineSettingsSchema>

/** The values a venue starts with: the schema's own defaults, so there is one source of them. */
export const DEFAULT_ONLINE_SETTINGS: OnlineSettings = OnlineSettingsSchema.parse({})

/**
 * What a stored object means: its own values over the defaults. A stored object this schema no
 * longer accepts (a later part 2 renamed a key) reads as the defaults rather than throwing, because
 * a settings screen must never fail to open over a value nobody can see.
 */
export function readOnlineSettings(stored: unknown): OnlineSettings {
  const parsed = OnlineSettingsSchema.safeParse(stored)
  return parsed.success ? parsed.data : DEFAULT_ONLINE_SETTINGS
}
