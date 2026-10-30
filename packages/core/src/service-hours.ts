// A venue's night (spec #64 Implementation Decisions 11; D122 §4; ticket #82): where `now` stands in
// the service hours of `venues.settings.ordering.serviceHours`, and when the pre-opening check runs.
// Pure: the instant is an input, so tests choose any night, midnight and clock changes included.
//
// Hours are wall-clock times of the venue's zone on a service day (D45), the day that opens on the
// weekday they are set for; times past midnight belong to the same service day. `localInstant`
// places a time by the wall clocks, so a night that crosses a clock change keeps its wall-clock
// hours and only its real length changes; a time lost to the jump forward lands an hour later.

import {
  type OrderingSettings,
  type PreOpeningRule,
  type ServiceHours,
  type ServiceHoursOfDay,
  WEEKDAYS,
  type Weekday,
} from './ordering-settings'
import { localInstant, serviceDate } from './service-day'

/** Phones are told "Last orders at …" this long before last orders (D122 §4). */
export const LAST_ORDERS_NOTICE_MINUTES = 10

/** What the clock of the night says about ordering from phones. */
export type NightPhase =
  /** The weekday is closed: no night at all. */
  | 'closed_night'
  /** The night is not open yet. */
  | 'before_opening'
  | 'open'
  /** Open, and last orders are within the notice. */
  | 'last_orders_soon'
  /** Last orders have passed (until the service day ends): ordering from phones is closed. */
  | 'ordering_closed'

/** The venue's clock: its zone, when its service day ends, and its hours. */
export interface ServiceClock {
  readonly timeZone: string
  /** `HH:MM` or `HH:MM:SS`. */
  readonly dayEndsAt: string
  readonly hours: ServiceHours
}

/** A venue's night at an instant. */
export interface ServiceNight {
  /** The service day `now` belongs to, `YYYY-MM-DD`. */
  readonly serviceDate: string
  /** The weekday that service day opened on. */
  readonly weekday: Weekday
  /** That weekday's hours, or null when it is closed. */
  readonly hours: ServiceHoursOfDay | null
  readonly opensAt: Date | null
  readonly lastOrdersAt: Date | null
  readonly closesAt: Date | null
  readonly phase: NightPhase
  /** True from the closing time on: every table is closed for phones. */
  readonly tablesClosed: boolean
  /** The next moment the phase or the closing changes, or null when none is coming. */
  readonly nextChangeAt: Date | null
}

const MINUTE_MS = 60_000

function minutesBefore(at: Date, minutes: number): Date {
  return new Date(at.getTime() - minutes * MINUTE_MS)
}

/** The weekday of a service date (`YYYY-MM-DD`), Monday first. */
function weekdayOf(date: string): Weekday {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return WEEKDAYS[(sundayFirst + 6) % 7] as Weekday
}

function addDaysTo(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return moved.toISOString().slice(0, 10)
}

function timesOf(date: string, hours: ServiceHoursOfDay, clock: ServiceClock) {
  const at = (time: string) => localInstant(date, time, clock.timeZone, clock.dayEndsAt)
  return {
    opensAt: at(hours.opens),
    lastOrdersAt: at(hours.lastOrders),
    closesAt: at(hours.closes),
  }
}

/** True once the venue has opened any weekday: before that the hours gate nothing. */
export function hoursConfigured(hours: OrderingSettings['serviceHours']): boolean {
  return WEEKDAYS.some((day) => hours[day] !== null)
}

/** The next opening after `now`, up to a week and a day ahead, or null when no weekday is open. */
export function nextOpening(
  now: Date,
  clock: ServiceClock,
): { readonly serviceDate: string; readonly opensAt: Date } | null {
  const today = serviceDate(now, clock.timeZone, clock.dayEndsAt)
  for (let ahead = 0; ahead <= WEEKDAYS.length; ahead++) {
    const date = addDaysTo(today, ahead)
    const hours = clock.hours[weekdayOf(date)]
    if (hours === null) continue
    const { opensAt } = timesOf(date, hours, clock)
    if (opensAt.getTime() > now.getTime()) return { serviceDate: date, opensAt }
  }
  return null
}

/** Where `now` stands in the venue's night. */
export function serviceNightAt(now: Date, clock: ServiceClock): ServiceNight {
  const date = serviceDate(now, clock.timeZone, clock.dayEndsAt)
  const weekday = weekdayOf(date)
  const hours = clock.hours[weekday]
  if (hours === null) {
    return {
      serviceDate: date,
      weekday,
      hours,
      opensAt: null,
      lastOrdersAt: null,
      closesAt: null,
      phase: 'closed_night',
      tablesClosed: false,
      nextChangeAt: nextOpening(now, clock)?.opensAt ?? null,
    }
  }
  const { opensAt, lastOrdersAt, closesAt } = timesOf(date, hours, clock)
  const notice = minutesBefore(lastOrdersAt, LAST_ORDERS_NOTICE_MINUTES)
  const t = now.getTime()
  const phase: NightPhase =
    t < opensAt.getTime()
      ? 'before_opening'
      : t >= lastOrdersAt.getTime()
        ? 'ordering_closed'
        : t >= notice.getTime()
          ? 'last_orders_soon'
          : 'open'
  const next = [opensAt, notice, lastOrdersAt, closesAt].find((at) => at.getTime() > t)
  return {
    serviceDate: date,
    weekday,
    hours,
    opensAt,
    lastOrdersAt,
    closesAt,
    phase,
    tablesClosed: t >= closesAt.getTime(),
    nextChangeAt: next ?? nextOpening(now, clock)?.opensAt ?? null,
  }
}

/** True when that service day (`YYYY-MM-DD`) had a closing time and it has passed. */
export function closingHourPassed(date: string, now: Date, clock: ServiceClock): boolean {
  const hours = clock.hours[weekdayOf(date)]
  return hours !== null && timesOf(date, hours, clock).closesAt.getTime() <= now.getTime()
}

/** A pre-opening check that is due. */
export interface PreOpeningCheck {
  /** The service day about to open. */
  readonly serviceDate: string
  readonly opensAt: Date
  /** Which run of the window this is, counted from its start: one number per cadence slot. */
  readonly slot: number
  /** True once the alert window has begun: a failed check now alerts the owner and the team. */
  readonly alert: boolean
}

/**
 * The check due at `now`, or null: from `startMinutes` before the next opening until it opens, one
 * `slot` per cadence step, with `alert` from `alertMinutes` before. A closed night has no opening,
 * so no check and no alert.
 */
export function preOpeningCheckAt(
  now: Date,
  clock: ServiceClock,
  rule: PreOpeningRule,
): PreOpeningCheck | null {
  const next = nextOpening(now, clock)
  if (next === null) return null
  const start = minutesBefore(next.opensAt, rule.startMinutes)
  if (now.getTime() < start.getTime()) return null
  const slot = Math.floor((now.getTime() - start.getTime()) / (rule.everyMinutes * 60_000))
  return {
    serviceDate: next.serviceDate,
    opensAt: next.opensAt,
    slot,
    alert: now.getTime() >= minutesBefore(next.opensAt, rule.alertMinutes).getTime(),
  }
}

/**
 * What a phone is told of the night (D122 §4): `last_orders` from 10 minutes before last orders,
 * `closed` after them (or all night when the weekday is closed), `opens_later` before opening.
 * `at` is the wall-clock time the words name: last orders for `last_orders`, opening for
 * `opens_later`. A venue that has opened no weekday yet is never gated: `open`.
 */
export interface GuestNight {
  readonly state: 'open' | 'last_orders' | 'opens_later' | 'closed'
  readonly at: string | null
}

/** The night as a phone is told it. */
export function guestNight(
  settings: Pick<OrderingSettings, 'serviceHours'>,
  timeZone: string,
  dayEndsAt: string,
  now: Date,
): GuestNight {
  if (!hoursConfigured(settings.serviceHours)) return { state: 'open', at: null }
  const night = serviceNightAt(now, {
    timeZone,
    dayEndsAt,
    hours: settings.serviceHours,
  })
  switch (night.phase) {
    case 'closed_night':
    case 'ordering_closed':
      return { state: 'closed', at: null }
    case 'before_opening':
      return { state: 'opens_later', at: night.hours?.opens ?? null }
    case 'last_orders_soon':
      return { state: 'last_orders', at: night.hours?.lastOrders ?? null }
    case 'open':
      return { state: 'open', at: null }
  }
}

/** True when phones may send an order now: not before opening, not after last orders. */
export function phonesMaySend(night: GuestNight): boolean {
  return night.state === 'open' || night.state === 'last_orders'
}
