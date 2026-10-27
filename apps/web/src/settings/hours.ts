// Pure helpers of the Hours and Ordering screens (#87): the weekdays Monday first, how a day's hours
// read, which message a `serviceHoursProblem` becomes, and the choices the Selects offer. No I/O.
import {
  LAST_ORDERS_BEFORE_DAY_END_MINUTES,
  type ServiceHours,
  type ServiceHoursOfDay,
  serviceHoursProblem,
  WEEKDAYS,
  type Weekday,
} from '@restro/core'

export { WEEKDAYS, type Weekday }

/** `HH:MM` as minutes since midnight. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  return hours * 60 + minutes
}

/** True when `time` is past midnight of a night that opens at `opens` ("(next morning)"). */
export function isNextMorning(time: string, opens: string): boolean {
  return minutesOf(time) < minutesOf(opens)
}

/** The field a problem belongs under, and the key of its sentence (`ownerSettings.st_err_*`). */
export type HoursProblem = {
  readonly field: 'lastOrders' | 'closes'
  readonly key: 'st_err_last' | 'st_err_close' | 'st_err_dayend' | 'st_err_15'
}

/** The owner's words for what `serviceHoursProblem` says about a day (`null`: it fits). */
export function hoursProblemOf(hours: ServiceHoursOfDay, dayEndsAt: string): HoursProblem | null {
  const problem = serviceHoursProblem(hours, dayEndsAt)
  if (problem === null) return null
  if (problem.startsWith('last orders must come after')) {
    return { field: 'lastOrders', key: 'st_err_last' }
  }
  if (problem.startsWith('closing must not come before')) {
    return { field: 'closes', key: 'st_err_close' }
  }
  if (problem.startsWith('closing must be before')) return { field: 'closes', key: 'st_err_dayend' }
  return { field: 'lastOrders', key: 'st_err_15' }
}

/** The 15-minute rule's number, for the sentence that names it. */
export const LAST_ORDERS_MARGIN = LAST_ORDERS_BEFORE_DAY_END_MINUTES

/** `HH:MM` of the service day's end for a sentence ("07:00"). */
export function dayEndText(dayEndsAt: string): string {
  return dayEndsAt.slice(0, 5)
}

/** True when no weekday is open: phones can't order. */
export function noNightOpen(hours: ServiceHours): boolean {
  return WEEKDAYS.every((day) => hours[day] === null)
}

/**
 * The hours a closed day starts from when it is switched on: the nearest open day's, looking
 * back through the week first and then forward; none when no day is open.
 */
export function nearestOpenDay(hours: ServiceHours, day: Weekday): ServiceHoursOfDay | null {
  const at = WEEKDAYS.indexOf(day)
  for (let step = 1; step < WEEKDAYS.length; step += 1) {
    const before = hours[WEEKDAYS[(at - step + 7) % 7] as Weekday]
    if (before !== null) return before
  }
  return null
}

/** Minutes as "45 min", "2 h" or "1 h 30 min" through the caller's unit words. */
export function durationParts(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 }
}

/** The choices of the Selects (plan §4), in minutes unless named. */
export const CHOICES = {
  radiusMetres: [100, 150, 200, 300, 500],
  passMinutes: [30, 60, 120, 180, 240, 360],
  pace: [3, 4, 5, 6, 8, 10, 12, 15, 20],
  callLapseMinutes: [5, 10, 15, 20, 30, 45, 60],
  preOpeningStart: [30, 60, 90, 120, 180, 240, 360],
  preOpeningEvery: [5, 10, 15, 20, 30, 60],
  preOpeningAlert: [10, 15, 20, 30, 45, 60, 90, 120],
} as const

/** A reading is too rough for a spot above this circle of doubt, in metres (plan §6). */
export const SPOT_ACCURACY_LIMIT_METRES = 100
