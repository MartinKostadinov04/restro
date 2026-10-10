// R1 Visibility, the schedule half: is a weekly `availability` open at the instant `now`, and if
// not, when does it open next ("from 18:00")? Windows that run past midnight count for the day
// they start on (`{days: [5], from: "22:00", to: "04:00"}` is open on Saturday at 02:00). The
// instant is an input; the venue's wall clock comes from `Intl`, so no daylight-saving trap and no
// reading of the clock. An availability with no rules is no restriction.

import { type FieldValueOf, isoInTimeZone } from '@restro/core'

import type { Strings } from './strings'
import type { ViewText } from './text'

/** The canonical `availability` value. */
export type Availability = FieldValueOf<'availability'>

/** When a closed schedule next opens. */
export interface NextOpening {
  /** 0 = later today, 1 = tomorrow … 7. */
  readonly dayOffset: number
  /** ISO weekday of the opening: 1 = Monday … 7 = Sunday. */
  readonly weekday: number
  /** `HH:MM`. */
  readonly from: string
  /** Minutes from the start of today to the opening; compares two openings. */
  readonly order: number
}

/** Open now, or closed until `next`. */
export type ScheduleStatus =
  | { readonly open: true }
  | { readonly open: false; readonly next: NextOpening }

/** A closed schedule as a face shows it ("from 18:00"). */
export interface ViewSchedule {
  /** `HH:MM`, 24 hours. */
  readonly opensAt: string
  /** ISO weekday it opens on, or null when it opens later today. */
  readonly weekday: number | null
  readonly text: ViewText
}

const DAY = 1440

function minutesOf(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
}

/** The venue's ISO weekday and minutes since midnight at `now` in `timeZone`. */
function localTime(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const local = isoInTimeZone(now, timeZone)
  const year = Number(local.slice(0, 4))
  const month = Number(local.slice(5, 7))
  const day = Number(local.slice(8, 10))
  const weekday = ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1
  return { weekday, minutes: Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)) }
}

/** Is the schedule open at `now`, and if not, when does it open next? */
export function scheduleStatus(availability: Availability | null, now: Date): ScheduleStatus {
  if (availability === null || availability.rules.length === 0) return { open: true }
  const { weekday, minutes } = localTime(now, availability.timezone)
  const previous = weekday === 1 ? 7 : weekday - 1

  for (const rule of availability.rules) {
    const from = minutesOf(rule.from)
    const to = minutesOf(rule.to)
    if (from < to) {
      if (rule.days.includes(weekday) && minutes >= from && minutes < to) return { open: true }
    } else {
      // Past midnight: the evening part belongs to today, the morning part to yesterday.
      if (rule.days.includes(weekday) && minutes >= from) return { open: true }
      if (rule.days.includes(previous) && minutes < to) return { open: true }
    }
  }

  let best: NextOpening | null = null
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const day = ((weekday - 1 + dayOffset) % 7) + 1
    for (const rule of availability.rules) {
      if (!rule.days.includes(day)) continue
      const from = minutesOf(rule.from)
      if (dayOffset === 0 && from <= minutes) continue
      const order = dayOffset * DAY + from
      if (best === null || order < best.order) {
        best = { dayOffset, weekday: day, from: rule.from, order }
      }
    }
    if (best !== null) break
  }
  // Every rule has at least one day and recurs weekly, so a next opening always exists.
  return best === null ? { open: true } : { open: false, next: best }
}

const dayNameFormatters = new Map<string, Intl.DateTimeFormat>()

/** The short weekday name (`Fri`, `пт`) of an ISO weekday in a BCP 47 language. */
export function weekdayName(weekday: number, bcp47: string): string {
  let formatter = dayNameFormatters.get(bcp47)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(bcp47, { weekday: 'short', timeZone: 'UTC' })
    dayNameFormatters.set(bcp47, formatter)
  }
  // 1 January 2024 was a Monday, so day-of-month = ISO weekday.
  return formatter.format(new Date(Date.UTC(2024, 0, weekday)))
}

/** The words for a closed schedule, in the interface language of the strings. */
export function describeOpening(next: NextOpening, strings: Strings): ViewSchedule {
  const bcp47 = strings.lang.replace('_', '-')
  let words: string
  if (next.dayOffset === 0) words = strings.scheduledFrom(next.from)
  else if (next.dayOffset === 1) words = strings.scheduledTomorrow(next.from)
  else words = strings.scheduledOnDay(weekdayName(next.weekday, bcp47), next.from)
  return {
    opensAt: next.from,
    weekday: next.dayOffset === 0 ? null : next.weekday,
    text: { text: words, lang: strings.lang },
  }
}
