// When a venue's barsy syncs are due (brief S3-04). The worker has one tick every minute; this
// decides, for one venue, whether that tick queues a change check (incremental run) or a full
// pull. Pure: the instant, the venue's time zone, the settings and the sync state are inputs.
//
// Rules:
//   - A change check is due when it is on and at least `incremental_minutes` whole minutes have
//     passed since the last one (the later of the last successful run and the last time a tick
//     queued one). Counting whole minutes is what keeps "every 5 minutes" at 5 and not 6: the
//     tick fires a moment after the minute starts, so the exact times of two ticks differ by a
//     few milliseconds either way.
//   - A full pull is due when it is on, today's `full_pull_time` (the venue's local clock) has
//     passed and no full pull ran or was queued since that moment. "Today" is the venue's local
//     calendar date, so a daylight-saving day (23 or 25 hours) still has exactly one slot:
//       . a time that does not exist that day (the hour skipped in spring) is the same clock
//         reading shifted forward by the jump: 03:30 becomes 04:30 on the day the clocks jump
//         from 03:00 to 04:00;
//       . a time that happens twice (the hour repeated in autumn) is the first of the two.
//     The queued slot is remembered (`last_full_pull_slot`), so a pull that fails or is not
//     complete is not asked for again every minute: the next try is the next day's slot.
//   - Nothing here reads a clock or the database.

import { wallClock } from './service-day'
import type { ScheduleSettings } from './sync-settings'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** What the due-check reads of `config.sync.<bid>` (ISO 8601 instants, as stored). */
export interface SyncScheduleState {
  /** Start of the last successful change check. */
  readonly last_incremental_at?: string | undefined
  /** When a tick last queued a change check (succeeded or not). */
  readonly last_incremental_queued_at?: string | undefined
  /** Start of the last complete full pull. */
  readonly last_full_pull_at?: string | undefined
  /** The slot (an instant) a tick last queued a full pull for. */
  readonly last_full_pull_slot?: string | undefined
}

export interface DueSyncs {
  readonly incremental: boolean
  readonly fullPull: boolean
  /** The slot the full pull is due for: record it as `last_full_pull_slot` when queuing the pull. */
  readonly fullPullSlot: Date | null
}

export interface NextSyncRuns {
  /** About when the next change check starts; null when they are off. */
  readonly incremental: Date | null
  /** When the next full pull starts; null when it is off. */
  readonly fullPull: Date | null
}

function instantOf(text: string | undefined): number | null {
  if (text === undefined) return null
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? null : ms
}

/** The later of the instants that are readable, or null. */
function latest(...texts: (string | undefined)[]): number | null {
  const times = texts.map(instantOf).filter((time): time is number => time !== null)
  return times.length === 0 ? null : Math.max(...times)
}

const wholeMinutes = (ms: number) => Math.floor(ms / MINUTE_MS)

/** Milliseconds east of UTC that `timeZone` is at the instant `ms`. */
function offsetMs(ms: number, timeZone: string): number {
  return wallClock(new Date(ms), timeZone).offsetMinutes * MINUTE_MS
}

/**
 * The instant at which the clocks of `timeZone` first read `hour:minute` on a calendar date (see
 * the header for a time that does not exist or happens twice).
 */
function wallTimeToInstant(
  date: { readonly year: number; readonly month: number; readonly day: number },
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // The reading as if it were UTC; the zone's offset is then taken off. A change of offset
  // within a day of it (daylight saving) means there are two offsets to try.
  const reading = Date.UTC(date.year, date.month - 1, date.day, hour, minute)
  const before = offsetMs(reading - DAY_MS, timeZone)
  const after = offsetMs(reading + DAY_MS, timeZone)
  const fits = [...new Set([before, after])]
    .map((offset) => reading - offset)
    .filter((instant) => offsetMs(instant, timeZone) === reading - instant)
  if (fits.length > 0) return new Date(Math.min(...fits))
  // The reading falls in the hour the clocks skip: the offset from before the jump puts it past.
  return new Date(reading - before)
}

function clockOf(time: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (match === null) throw new RangeError('a time of day is HH:mm')
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

/** The instant of `full_pull_time` on the venue's local date that `now` falls on. */
export function fullPullSlotToday(now: Date, timeZone: string, time: string): Date {
  const { hour, minute } = clockOf(time)
  return wallTimeToInstant(wallClock(now, timeZone), hour, minute, timeZone)
}

/** The instant of `full_pull_time` on the day after the venue's local date that `now` falls on. */
function fullPullSlotTomorrow(now: Date, timeZone: string, time: string): Date {
  const { hour, minute } = clockOf(time)
  const today = wallClock(now, timeZone)
  const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1))
  return wallTimeToInstant(
    { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
    hour,
    minute,
    timeZone,
  )
}

/** When the last change check ran or was queued; null for none. */
function incrementalReference(state: SyncScheduleState): number | null {
  return latest(state.last_incremental_at, state.last_incremental_queued_at)
}

/** When a full pull last ran or was queued; null for none. */
function fullPullReference(state: SyncScheduleState): number | null {
  return latest(state.last_full_pull_at, state.last_full_pull_slot)
}

/** Minutes since the last change check; null when there is none, or its time is not believable. */
function minutesSinceIncremental(now: Date, state: SyncScheduleState, interval: number) {
  const reference = incrementalReference(state)
  if (reference === null) return null
  const elapsed = wholeMinutes(now.getTime()) - wholeMinutes(reference)
  // A last run further in the future than one interval means the clock was moved: do not wait for it.
  return elapsed < -interval ? null : elapsed
}

/**
 * Which syncs this minute's tick queues for a venue. Throws `RangeError` for an unknown time zone
 * or a malformed `full_pull_time` (the settings parser never returns one).
 */
export function dueSyncs(
  now: Date,
  timeZone: string,
  schedule: ScheduleSettings,
  state: SyncScheduleState,
): DueSyncs {
  let incremental = false
  if (schedule.incremental_enabled) {
    const elapsed = minutesSinceIncremental(now, state, schedule.incremental_minutes)
    incremental = elapsed === null || elapsed >= schedule.incremental_minutes
  }

  let fullPull = false
  let fullPullSlot: Date | null = null
  if (schedule.full_pull_enabled) {
    const slot = fullPullSlotToday(now, timeZone, schedule.full_pull_time)
    const reference = fullPullReference(state)
    if (now.getTime() >= slot.getTime() && (reference === null || reference < slot.getTime())) {
      fullPull = true
      fullPullSlot = slot
    }
  }
  return { incremental, fullPull, fullPullSlot }
}

/**
 * About when the next syncs start, for the Integration tab ("next change check ~02:35, next full
 * pull 12:00"). A sync that is due now is shown at the start of the next minute, when the next
 * tick runs.
 */
export function nextSyncRuns(
  now: Date,
  timeZone: string,
  schedule: ScheduleSettings,
  state: SyncScheduleState,
): NextSyncRuns {
  const nextTick = new Date((wholeMinutes(now.getTime()) + 1) * MINUTE_MS)

  let incremental: Date | null = null
  if (schedule.incremental_enabled) {
    const elapsed = minutesSinceIncremental(now, state, schedule.incremental_minutes)
    const reference = incrementalReference(state)
    if (elapsed === null || reference === null || elapsed >= schedule.incremental_minutes) {
      incremental = nextTick
    } else {
      const due = new Date((wholeMinutes(reference) + schedule.incremental_minutes) * MINUTE_MS)
      incremental = due.getTime() > nextTick.getTime() ? due : nextTick
    }
  }

  let fullPull: Date | null = null
  if (schedule.full_pull_enabled) {
    const slot = fullPullSlotToday(now, timeZone, schedule.full_pull_time)
    const reference = fullPullReference(state)
    if (now.getTime() < slot.getTime()) fullPull = slot
    else if (reference === null || reference < slot.getTime()) fullPull = nextTick
    else fullPull = fullPullSlotTomorrow(now, timeZone, schedule.full_pull_time)
  }
  return { incremental, fullPull }
}
