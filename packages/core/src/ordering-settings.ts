// A venue's ordering settings (spec #64 Implementation Decisions 3; D118, D122 §4, §7; ticket #66):
// `venues.settings.ordering`, Zod-checked, written only by `setOrderingSettings` (core/apply). No
// table of its own. Every key has a default, so a venue that never saved them orders under the
// cautious defaults: the guards on, the cap €150, the pace 6 per 15 minutes, and every weekday
// closed until the owner sets service hours.
//
// Pure data and pure functions: no I/O, safe in the browser.

import { z } from 'zod'

const HH_MM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

/** A wall-clock time of the venue's zone, `HH:MM`. */
const WallTimeSchema = z.string().regex(HH_MM, 'a time is HH:MM')

/** One weekday's hours; times past midnight belong to the same service day (D122 §4). */
export const ServiceHoursOfDaySchema = z.strictObject({
  opens: WallTimeSchema,
  /** After it, phones can no longer order; shown as "Last orders at …" 10 minutes before. */
  lastOrders: WallTimeSchema,
  /** Closes every table. Must sit before the POS's own day close. */
  closes: WallTimeSchema,
})

/** One weekday's hours. */
export type ServiceHoursOfDay = z.infer<typeof ServiceHoursOfDaySchema>

/** The weekdays, Monday first, as the venue's service day names them (the day it opens). */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/** One weekday. */
export type Weekday = (typeof WEEKDAYS)[number]

/** Each weekday's hours, or null when the venue is closed that day. */
export const ServiceHoursSchema = z.strictObject(
  Object.fromEntries(WEEKDAYS.map((day) => [day, ServiceHoursOfDaySchema.nullable()])) as {
    [D in Weekday]: z.ZodNullable<typeof ServiceHoursOfDaySchema>
  },
)

/** Each weekday's hours. */
export type ServiceHours = z.infer<typeof ServiceHoursSchema>

/** The default pre-opening check (D120, D122 §4): from 2 hours before, every 10 minutes, an alert at 30. */
export const DEFAULT_PRE_OPENING_RULE = { startMinutes: 120, everyMinutes: 10, alertMinutes: 30 }

/** When the check of everything Restro needs from the POS runs before opening (D120, D122 §4). */
export const PreOpeningRuleSchema = z
  .strictObject({
    /** The check starts this long before opening. */
    startMinutes: z.number().int().min(30).max(360),
    /** It runs this often. */
    everyMinutes: z.number().int().min(5).max(60),
    /** From this long before opening a failed check alerts. */
    alertMinutes: z.number().int().min(10).max(120),
  })
  .refine((rule) => rule.alertMinutes <= rule.startMinutes, {
    message: 'the alert cannot come before the check starts',
  })

/** The pre-opening check's timing. */
export type PreOpeningRule = z.infer<typeof PreOpeningRuleSchema>

/** A spot on the map: the venue's point for the location check (D118). */
export const VenueSpotSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

/** The largest cap a venue may set: €10,000 in minor units. */
export const ORDERING_CAP_MAX_MINOR = 1_000_000

/** A Telegram chat id: digits, negative for a group. */
const TELEGRAM_CHAT_ID = /^-?[0-9]{1,20}$/

/**
 * The times a closed day had when it was switched off, so switching it on brings them back (plan
 * `2026-10-27-settings-hours-ordering-plan.md`). Only Settings reads them: a closed day stays closed
 * by `serviceHours`.
 */
export const ClosedDayHoursSchema = ServiceHoursSchema.partial()

/** `venues.settings.ordering` as stored. Every key is present after a save. */
export const OrderingSettingsSchema = z.strictObject({
  /** The cap per on-the-bill sent order in minor units, or null for off (D118: €150). */
  capMinor: z.number().int().positive().max(ORDERING_CAP_MAX_MINOR).nullable(),
  /** Most on-the-bill sent orders per table in 15 minutes, or null for off (D118: 6, 3–20). */
  pacePer15Minutes: z.number().int().min(3).max(20).nullable(),
  /** "Check guests are in the venue" (D118). */
  locationCheck: z.boolean(),
  /** The venue's spot, or null until the owner sets it (the check then fails closed). */
  spot: VenueSpotSchema.nullable(),
  /** "How far from the spot counts as inside", metres (D118: 150, 100–500). */
  radiusMetres: z.number().int().min(100).max(500),
  /** How long a location pass lasts, minutes (spec: 2 h, 30 min–6 h; never past the service day). */
  passMinutes: z.number().int().min(30).max(360),
  /** When ordering from phones runs, per weekday. */
  serviceHours: ServiceHoursSchema,
  /** A closed day's last times; settings saved before it existed keep none. */
  closedDayHours: ClosedDayHoursSchema.default({}),
  /** The check before opening; settings saved before it existed take the defaults. */
  preOpeningCheck: PreOpeningRuleSchema.default(DEFAULT_PRE_OPENING_RULE),
  /**
   * When an unanswered waiter call lapses, minutes (#50 decides; 15 until then). Whether guests
   * can call at all is the venue's guest feature `call_waiter` (D71), not a key here.
   */
  callLapseMinutes: z.number().int().min(5).max(60),
  /** Who gets the venue's alerts on their installed devices (D120): accounts, by user id. */
  alertRecipientUserIds: z.array(z.string().min(1).max(128)).max(50),
  /** The venue's Telegram group for alerts, or null for none (D120). */
  telegramChatId: z.string().regex(TELEGRAM_CHAT_ID).nullable(),
})

/** A venue's ordering settings. */
export type OrderingSettings = z.infer<typeof OrderingSettingsSchema>

/** What applies until a venue saves its own (D118's defaults; closed every day). */
export const DEFAULT_ORDERING_SETTINGS: OrderingSettings = {
  capMinor: 15_000,
  pacePer15Minutes: 6,
  locationCheck: true,
  spot: null,
  radiusMetres: 150,
  passMinutes: 120,
  serviceHours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
  closedDayHours: {},
  preOpeningCheck: DEFAULT_PRE_OPENING_RULE,
  callLapseMinutes: 15,
  alertRecipientUserIds: [],
  telegramChatId: null,
}

/** Last orders sit at least this long before the service day ends (spec #64, 11). */
export const LAST_ORDERS_BEFORE_DAY_END_MINUTES = 15

const MINUTES_PER_DAY = 24 * 60

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  return hours * 60 + minutes
}

/** Minutes from the start of the service day (which starts where the last one ends) to `time`. */
function sinceServiceDayStart(time: string, dayEndsAt: string): number {
  return (minutesOf(time) - minutesOf(dayEndsAt.slice(0, 5)) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

/**
 * Why a weekday's hours don't fit a service day ending at `dayEndsAt` (`HH:MM` or `HH:MM:SS`), or
 * null when they do: opening, last orders and closing in that order inside the service day, past
 * midnight allowed, and last orders at least 15 minutes before the day ends.
 */
export function serviceHoursProblem(hours: ServiceHoursOfDay, dayEndsAt: string): string | null {
  const opens = sinceServiceDayStart(hours.opens, dayEndsAt)
  const lastOrders = sinceServiceDayStart(hours.lastOrders, dayEndsAt)
  // Closing at the very moment the day ends is the day's end, not its start.
  const closes = sinceServiceDayStart(hours.closes, dayEndsAt) || MINUTES_PER_DAY
  if (!(opens < lastOrders)) return 'last orders must come after opening'
  if (!(lastOrders <= closes)) return 'closing must not come before last orders'
  if (closes >= MINUTES_PER_DAY) return 'closing must be before the service day ends'
  if (lastOrders > MINUTES_PER_DAY - LAST_ORDERS_BEFORE_DAY_END_MINUTES) {
    return `last orders must be at least ${LAST_ORDERS_BEFORE_DAY_END_MINUTES} minutes before the service day ends`
  }
  return null
}

/** The venue's ordering settings from `venues.settings`, the defaults where none are saved. */
export function readOrderingSettings(
  settings: Readonly<Record<string, unknown>>,
): OrderingSettings {
  const parsed = OrderingSettingsSchema.safeParse(withoutRetiredKeys(settings.ordering))
  return parsed.success ? parsed.data : DEFAULT_ORDERING_SETTINGS
}

/**
 * `onlyOpenTables` is gone (RR-35: nothing read it), but venues saved it. The schema is strict and a
 * stored value it refuses reads as the defaults, closed every day, so it is dropped first; the next
 * save leaves it out.
 */
function withoutRetiredKeys(stored: unknown): unknown {
  if (typeof stored !== 'object' || stored === null) return stored
  const { onlyOpenTables: _retired, ...kept } = stored as Record<string, unknown>
  return kept
}
