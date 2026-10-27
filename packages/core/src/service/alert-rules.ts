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
/** A card payment's close could not be confirmed (#111): a manager or owner answers it. */
export const PAYMENT_UNCONFIRMED_KIND = 'payment_unconfirmed'
/**
 * After "No receipt", a card payment's items are not back on its table (#153): the bill may have
 * closed after all, and a manager or owner checks the till again.
 */
export const PAYMENT_LINES_NOT_BACK_KIND = 'payment_lines_not_back'
/** A card payment was stopped at its last check, before the close (#111). */
export const PAYMENT_CHECK_FAILED_KIND = 'payment_check_failed'
/** A payment's lines could not be moved back from its payment table (#111). */
export const PAYMENT_STRANDED_KIND = 'payment_stranded'
/** A closed bill's card payment could not be captured (#111): the owners are told. */
export const PAYMENT_CAPTURE_FAILED_KIND = 'payment_capture_failed'
/**
 * The provider refused to release the hold of a payment Restro cancelled (#112): the owners and
 * Restro's team are told; it closes when the provider drops the hold.
 */
export const PAYMENT_RELEASE_REFUSED_KIND = 'payment_release_refused'
/**
 * A card payment's hold ran out while its question waited for an answer (#112): the bill may be
 * closed in the till with nothing charged, or its items may still sit on the payment table. The
 * owners and Restro's team are told, as a failed capture is; staff press Done once it is sorted.
 */
export const PAYMENT_HOLD_EXPIRED_KIND = 'payment_hold_expired'
/**
 * Paying in the app is paused at a venue: no call to its payment provider succeeded for a minute
 * (#112, D127 3.8). It closes by itself when the breaker lifts; ordering goes on meanwhile.
 */
export const PAYING_PAUSED_KIND = 'paying_paused'
/**
 * Paying in the app paused at a venue for the third time in 30 minutes (#112, D120): Restro's team
 * is told the venue's paying is unstable. Audience `restro`, one open per venue.
 */
export const PAYING_UNSTABLE_KIND = 'paying_unstable'
/**
 * A payment stayed `requested`, `priced` or `cancelling` past the recovery's bound although it was
 * tried again (#112): Restro's team looks. Audience `restro`, so its rule is the team's digest.
 */
export const PAYMENT_STUCK_KIND = 'payment_stuck'

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
  /** Push only: every message of the kind goes to the venue's owners only (money, #111). */
  readonly ownersOnly?: boolean
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
  /**
   * Only a staff answer closes it, never the end of the night: a card hold still waits on the
   * answer (up to 7 days), so the day's close leaves it open (#162), and nobody presses Done on
   * it (#112).
   */
  readonly closesByAnswer: boolean
  /** Told even outside service hours (D120: the pre-opening check only). */
  readonly outsideServiceHours: boolean
  /**
   * Reminded again as the card's hold runs out (design §5.3): at half the time left and with 24
   * hours left, from the `captureBefore` in the alert's details (#112).
   */
  readonly holdExpiryReminders?: boolean
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
  closesByAnswer: false,
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
  [PAYING_UNSTABLE_KIND]: { ...NOBODY, team: teamDigest() },
  [TABLE_CODE_BLOCK_KIND]: { ...NOBODY, team: teamDigest() },
  // Tonight is told about stock (#80); a phone is not.
  [OUT_OF_STOCK_KIND]: NOBODY,
  // Money the staff must act on (#111): an unconfirmed close (asked again when the items are not
  // back, #153) and stuck lines are reminded once after 10 minutes, as an Unconfirmed order is
  // (D120); a stopped payment is told once.
  // Both questions are answered, never marked Done, and remind again as the hold runs out (#112).
  [PAYMENT_UNCONFIRMED_KIND]: {
    ...NOBODY,
    closesByAnswer: true,
    push: staffPush({ afterMs: 10 * MINUTE, max: 1, ownersOnly: false }),
    venueTelegram: venueGroup,
    team: teamDigest(),
    holdExpiryReminders: true,
  },
  [PAYMENT_LINES_NOT_BACK_KIND]: {
    ...NOBODY,
    closesByAnswer: true,
    push: staffPush({ afterMs: 10 * MINUTE, max: 1, ownersOnly: false }),
    venueTelegram: venueGroup,
    team: teamDigest(),
    holdExpiryReminders: true,
  },
  [PAYMENT_STRANDED_KIND]: {
    ...NOBODY,
    push: staffPush({ afterMs: 10 * MINUTE, max: 1, ownersOnly: false }),
    venueTelegram: venueGroup,
    team: teamDigest(),
  },
  [PAYMENT_CHECK_FAILED_KIND]: {
    ...NOBODY,
    push: staffPush(),
    venueTelegram: venueGroup,
    team: teamDigest(),
  },
  // A capture that failed is the owners' (the money of a closed bill): pushed to them at once,
  // reminded once after an hour, and the Restro team is told at once; not the venue's group.
  [PAYMENT_CAPTURE_FAILED_KIND]: {
    ...NOBODY,
    push: {
      firstDelayMs: 0,
      minGapMs: 0,
      reminder: { afterMs: 60 * MINUTE, max: 1, ownersOnly: true },
      ownersOnly: true,
    },
    team: { firstDelayMs: 0, minGapMs: 0, reminder: null },
  },
  // A hold that ran out unanswered is the owners' too (#112), told as a failed capture is.
  [PAYMENT_HOLD_EXPIRED_KIND]: {
    ...NOBODY,
    push: {
      firstDelayMs: 0,
      minGapMs: 0,
      reminder: { afterMs: 60 * MINUTE, max: 1, ownersOnly: true },
      ownersOnly: true,
    },
    team: { firstDelayMs: 0, minGapMs: 0, reminder: null },
  },
  // A hold the provider would not release is the owners' too (#112), told as a failed capture is.
  [PAYMENT_RELEASE_REFUSED_KIND]: {
    ...NOBODY,
    push: {
      firstDelayMs: 0,
      minGapMs: 0,
      reminder: { afterMs: 60 * MINUTE, max: 1, ownersOnly: true },
      ownersOnly: true,
    },
    team: { firstDelayMs: 0, minGapMs: 0, reminder: null },
  },
  // Paying paused (#112) is told as an ordering pause is, to the ticked accounts (owners and
  // managers, D127 3.8) and the team; not the venue's group, since ordering goes on.
  [PAYING_PAUSED_KIND]: {
    ...NOBODY,
    push: staffPush({ afterMs: 60 * MINUTE, max: 1, ownersOnly: true }),
    team: {
      firstDelayMs: 0,
      minGapMs: 0,
      reminder: { afterMs: 60 * MINUTE, max: 3, ownersOnly: false },
    },
    back: true,
    backAfterMs: 10 * MINUTE,
    closesItself: true,
  },
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
