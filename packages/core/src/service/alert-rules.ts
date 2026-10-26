// Who is told about an alert, how soon and how often (D120 "Alerts reach everyone"; D122 §7; spec
// #64 Implementation Decisions 13; ticket #83). Pure data and arithmetic: the delivery planner
// (`alert-delivery.ts`) reads these rules, and the worker sends what it plans.
//
// Receivers: the venue's ticked accounts by Web Push (`push`), the venue's Telegram group
// (`venueTelegram`) and the Restro team's Telegram chat (`team`). The numbers are starting values
// from engineering practice (Alertmanager's grouping and repeat settings, PagerDuty's one incident
// per problem); Martin asked that they may be tuned without a new decision.

import { type OrderingSettings, WEEKDAYS } from '../ordering-settings'
import { localInstant, serviceDate } from '../service-day'

/** The kinds other tickets raise (a test pins that they are the same text as there). */
export const ORDER_UNCONFIRMED_KIND = 'order_unconfirmed'
export const ORDER_RATE_KIND = 'order_rate'
export const ORDER_PACE_KIND = 'order_pace'
export const CONNECTION_UNSTABLE_KIND = 'connection_unstable'
/** An active venue-level pause (#83 raises it; it closes by itself when the pause lifts). */
export const PAUSED_KIND = 'ordering_paused'
/** The pre-opening check could not work with the POS (D120; a later ticket raises it). */
export const PRE_OPENING_KIND = 'pre_opening_check'
/** A network was blocked after 50 wrong table codes (#70; D122 §3). */
export const TABLE_CODE_BLOCK_KIND = 'table_code_block'
/** An item the POS says ran out (#80): a notice for Tonight, never pushed. */
export const OUT_OF_STOCK_KIND = 'item_out_of_stock'

const MINUTE = 60_000

/** How one receiver is told about one kind. */
export interface ReceiverRule {
  /** Wait this long after the alert was raised before the first message (so a burst groups). */
  readonly firstDelayMs: number
  /** At most one message per this long to this receiver for this kind at the venue. */
  readonly minGapMs: number
  /** Reminders while nobody has acted; null for none. */
  readonly reminder: {
    readonly afterMs: number
    readonly max: number
    /** Push only: the reminder goes to the venue's owners, not to every ticked account. */
    readonly ownersOnly: boolean
  } | null
}

/** The rules of one kind. */
export interface KindRule {
  readonly push: ReceiverRule | null
  readonly venueTelegram: ReceiverRule | null
  readonly team: ReceiverRule | null
  /** Everyone who was told is told again when it ends ("Ordering is back"). */
  readonly back: boolean
  /**
   * "Back" waits this long after the alert ends, so a pause that returns within the time stays the
   * same one (D120: keyed per pause, a pause that returns within 10 minutes is the same pause).
   */
  readonly backAfterMs: number
  /** It ends by itself (a pause lifting), so nobody presses Done on it. */
  readonly closesItself: boolean
  /** Told even outside service hours (D120: the pre-opening check only). */
  readonly outsideServiceHours: boolean
}

const staffPush = (reminder: ReceiverRule['reminder'] = null): ReceiverRule => ({
  firstDelayMs: 0,
  minGapMs: MINUTE,
  reminder,
})
const venueGroup: ReceiverRule = { firstDelayMs: 0, minGapMs: 0, reminder: null }
const teamDigest = (): ReceiverRule => ({ firstDelayMs: 0, minGapMs: 10 * MINUTE, reminder: null })

const NOBODY: KindRule = {
  push: null,
  venueTelegram: null,
  team: null,
  back: false,
  backAfterMs: 0,
  closesItself: false,
  outsideServiceHours: false,
}

/** The rule of every kind this ticket knows; {@link ruleOf} falls back by audience. */
export const ALERT_RULES: Readonly<Record<string, KindRule>> = {
  // Unconfirmed orders reach the ticked accounts grouped: the first after 10 s, then one push a
  // minute at most, with one reminder after 10 minutes if no one acted (D120).
  [ORDER_UNCONFIRMED_KIND]: {
    ...NOBODY,
    push: {
      firstDelayMs: 10_000,
      minGapMs: MINUTE,
      reminder: { afterMs: 10 * MINUTE, max: 1, ownersOnly: false },
    },
    venueTelegram: { ...venueGroup, firstDelayMs: 10_000 },
    team: teamDigest(),
  },
  // One alert when a venue pause starts and one when it ends; no reminder for staff, one after 60
  // minutes for owners, the Restro team hourly and 3 at most (D120).
  [PAUSED_KIND]: {
    ...NOBODY,
    push: staffPush({ afterMs: 60 * MINUTE, max: 1, ownersOnly: true }),
    venueTelegram: venueGroup,
    team: {
      firstDelayMs: 0,
      minGapMs: 0,
      reminder: { afterMs: 60 * MINUTE, max: 3, ownersOnly: false },
    },
    back: true,
    backAfterMs: 10 * MINUTE,
    closesItself: true,
  },
  [PRE_OPENING_KIND]: {
    ...NOBODY,
    push: staffPush(),
    venueTelegram: venueGroup,
    team: { firstDelayMs: 0, minGapMs: 0, reminder: null },
    outsideServiceHours: true,
  },
  // The Restro team only (D118's trips, the breaker's unstable connection, the code block).
  [ORDER_RATE_KIND]: { ...NOBODY, team: teamDigest() },
  [ORDER_PACE_KIND]: { ...NOBODY, team: teamDigest() },
  [CONNECTION_UNSTABLE_KIND]: { ...NOBODY, team: teamDigest() },
  [TABLE_CODE_BLOCK_KIND]: { ...NOBODY, team: teamDigest() },
  // Tonight is told about stock (#80); a phone is not.
  [OUT_OF_STOCK_KIND]: NOBODY,
}

/** The rule of a kind; one this ticket does not know follows its audience (venue, or Restro's team). */
export function ruleOf(kind: string, audience: 'venue' | 'restro'): KindRule {
  const known = Object.hasOwn(ALERT_RULES, kind) ? ALERT_RULES[kind] : undefined
  if (known !== undefined) return known
  return audience === 'restro'
    ? { ...NOBODY, team: teamDigest() }
    : { ...NOBODY, push: staffPush(), venueTelegram: venueGroup, team: teamDigest() }
}

/** The venue's service hours on the service day of an instant. */
export interface ServiceHoursWindow {
  /** The service day (`YYYY-MM-DD`). */
  readonly date: string
  /** When the day's service opens and closes, or null on a day the venue is closed. */
  readonly opensAt: Date | null
  readonly closesAt: Date | null
  /** True from opening up to closing. */
  readonly inService: boolean
}

/**
 * The service hours of the service day `now` falls on (D45: a night belongs to the evening it
 * started), in the venue's time zone and against the end of its service day.
 */
export function serviceHoursWindow(
  settings: OrderingSettings,
  timeZone: string,
  dayEndsAt: string,
  now: Date,
): ServiceHoursWindow {
  const date = serviceDate(now, timeZone, dayEndsAt)
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const weekday = WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7]
  const hours = settings.serviceHours[weekday as (typeof WEEKDAYS)[number]]
  if (hours === null) return { date, opensAt: null, closesAt: null, inService: false }
  const opensAt = localInstant(date, hours.opens, timeZone, dayEndsAt)
  const closesAt = localInstant(date, hours.closes, timeZone, dayEndsAt)
  return {
    date,
    opensAt,
    closesAt,
    inService: opensAt.getTime() <= now.getTime() && now.getTime() < closesAt.getTime(),
  }
}
