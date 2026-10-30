// The venue's service day (D45) and local timestamps, without a date library: `Intl` gives the
// wall-clock time in the venue's time zone, and the service day is a calendar date, so no duration
// arithmetic is involved. A clock change is `instantOfWall`'s alone: a time the clocks skip, or
// read twice, still comes to one instant, and later wall times never come to earlier instants.
// Pure: the instant is an input.

/** `HH:MM` or `HH:MM:SS` (Postgres returns `time` columns with seconds). */
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

/** The wall-clock reading of an instant in a time zone. */
export interface WallClock {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  /** Minutes east of UTC at that instant in that zone. */
  readonly offsetMinutes: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** What the clocks on the wall of `timeZone` read at the instant `at`, with the zone's UTC offset then. */
export function wallClock(at: Date, timeZone: string): WallClock {
  if (!Number.isFinite(at.getTime())) throw new RangeError('expected a valid date')
  const parts = new Map(
    formatterFor(timeZone)
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.get(type))
  // `GMT+03:00`, `GMT-05:30`, or plain `GMT` at UTC.
  const offset = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(parts.get('timeZoneName') ?? '')
  if (offset === null) throw new RangeError(`cannot read the UTC offset of ${timeZone}`)
  const [, sign, hours = '0', minutes = '0'] = offset
  const offsetMinutes = (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes))
  return {
    year: number('year'),
    month: number('month'),
    day: number('day'),
    hour: number('hour'),
    minute: number('minute'),
    second: number('second'),
    offsetMinutes,
  }
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

const DAY_MS = 24 * 60 * 60_000
/** No zone moves its clocks by more than this in one change. */
const MOST_A_CLOCK_MOVES_SECONDS = 2 * 3600

/** A wall-clock reading written as if it were UTC: comparable with another, never an instant. */
function wallMs(local: WallClock): number {
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
}

/**
 * The instant at which the clocks of `timeZone` read `wall` (see `wallMs`), so that a later wall
 * time is never an earlier instant, across either clock change:
 * - a time they read twice (autumn) is the later of the two, when the night has run its full length;
 * - a time they skip (spring) is the instant they jump, the first one that is past it.
 */
function instantOfWall(wall: number, timeZone: string): number {
  // Any zone's offset is under a day, so these two are the offsets on either side of a change.
  const before = wallClock(new Date(wall - DAY_MS), timeZone).offsetMinutes
  const after = wallClock(new Date(wall + DAY_MS), timeZone).offsetMinutes
  const underBefore = wall - before * 60_000
  if (before === after) return underBefore
  const underAfter = wall - after * 60_000
  const earlier = Math.min(underBefore, underAfter)
  const later = Math.max(underBefore, underAfter)
  const reads = (instant: number) => wallMs(wallClock(new Date(instant), timeZone))
  if (reads(later) === wall) return later
  if (reads(earlier) === wall) return earlier
  // Skipped: the offset changes somewhere between the two, to the second.
  let low = earlier
  let high = later
  while (high - low > 1_000) {
    const middle = low + Math.floor((high - low) / 2)
    if (wallClock(new Date(middle), timeZone).offsetMinutes === before) low = middle
    else high = middle
  }
  return Math.floor(high / 1_000) * 1_000
}

function isoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/**
 * The service day `at` belongs to, as `YYYY-MM-DD`: the venue's local calendar date, or the day
 * before until that date's `dayEndsAt` has passed (D45: a night that runs to 07:00 belongs to the
 * evening it started). The day moves on once, at `instantOfWall`'s instant of `dayEndsAt`, so a
 * `dayEndsAt` the clocks read twice never takes it back. Throws `RangeError` for an unknown time
 * zone or a malformed `dayEndsAt`.
 */
export function serviceDate(at: Date, timeZone: string, dayEndsAt: string): string {
  const end = CLOCK_PATTERN.exec(dayEndsAt)
  if (end === null) throw new RangeError('dayEndsAt must be HH:MM or HH:MM:SS')
  const local = wallClock(at, timeZone)
  const localSeconds = local.hour * 3600 + local.minute * 60 + local.second
  const endSeconds = Number(end[1]) * 3600 + Number(end[2]) * 60 + Number(end[3] ?? 0)
  // Away from `dayEndsAt` a clock change cannot alter the answer, and this runs on every read.
  const passedEnd =
    Math.abs(localSeconds - endSeconds) > MOST_A_CLOCK_MOVES_SECONDS
      ? localSeconds >= endSeconds
      : at.getTime() >=
        instantOfWall(
          Date.UTC(local.year, local.month - 1, local.day) + endSeconds * 1_000,
          timeZone,
        )
  if (passedEnd) return isoDate(local.year, local.month, local.day)
  // The calendar day before (UTC arithmetic on a date only: no time zone involved).
  const previous = new Date(Date.UTC(local.year, local.month - 1, local.day - 1))
  return isoDate(previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate())
}

const SERVICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * The edition id of a service day (`service:2026-10-09`): what the resolver's `edition` list and a
 * snapshot's header name it. Throws `RangeError` for anything that is not `YYYY-MM-DD`.
 */
export function serviceEditionId(day: string): `service:${string}` {
  if (!SERVICE_DATE_PATTERN.test(day)) throw new RangeError('a service day is YYYY-MM-DD')
  return `service:${day}`
}

/**
 * The layer a service day's sold-out marks are stored in (`edition:service:2026-10-09`, D46).
 * Marks are written there with `for_sale = false`, in the master scope, and nowhere else: the
 * layer only counts while its day is the venue's current service day, so a mark lapses on its own
 * when the day ends (no job removes it, no publish is needed).
 */
export function serviceEditionLayer(day: string): `edition:service:${string}` {
  return `edition:${serviceEditionId(day)}`
}

/**
 * The editions a snapshot is resolved with: the venue's own, never a service day's (D46). The
 * resolver's `edition` list is the whole story: a row in `edition:service:<day>` is out of
 * context unless the list names `service:<day>`.
 */
export function snapshotEditions(venueId: string): string[] {
  return [`venue:${venueId}`]
}

/**
 * The editions the live menu is resolved with on service day `day`: the snapshot's, plus that
 * day's. The live overlay is built from this resolution, and so is what a manager sees in the
 * composer: both show tonight's sold-out marks and none of an earlier day's.
 */
export function liveEditions(venueId: string, day: string): string[] {
  return [...snapshotEditions(venueId), serviceEditionId(day)]
}

/**
 * `at` as ISO 8601 in the venue's local time with its UTC offset, to the second:
 * `2026-10-08T21:04:12+03:00`. Throws `RangeError` for an unknown time zone.
 */
export function isoInTimeZone(at: Date, timeZone: string): string {
  const local = wallClock(at, timeZone)
  const sign = local.offsetMinutes < 0 ? '-' : '+'
  const offset = Math.abs(local.offsetMinutes)
  return (
    `${isoDate(local.year, local.month, local.day)}T${pad(local.hour)}:${pad(local.minute)}:` +
    `${pad(local.second)}${sign}${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`
  )
}

/**
 * The instant the service day of `at` began (to the second): the end of the day before. What a
 * connector compares a bill's opening with, so a bill left open from last night is never joined
 * (#77). Found by halving the 26 hours before `at`, so a daylight-saving change needs no rule.
 */
export function serviceDayStartsAt(at: Date, timeZone: string, dayEndsAt: string): Date {
  const today = serviceDate(at, timeZone, dayEndsAt)
  let low = at.getTime() - 26 * 3_600_000
  let high = at.getTime()
  // `low` is always in an earlier day, `high` in today's.
  while (high - low > 1_000) {
    const middle = Math.floor((low + high) / 2)
    if (serviceDate(new Date(middle), timeZone, dayEndsAt) === today) high = middle
    else low = middle
  }
  return new Date(Math.floor(high / 1_000) * 1_000)
}

/**
 * The instant at which the wall clocks of `timeZone` read `time` (`HH:MM`) on service day `day`: a
 * time before `dayEndsAt` belongs to the next calendar date (a night that runs past midnight). A
 * time lost to a daylight-saving jump is the instant of the jump, so it stays before any later time
 * of that night (`instantOfWall`).
 */
export function localInstant(day: string, time: string, timeZone: string, dayEndsAt: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const clock = CLOCK_PATTERN.exec(time)
  const end = CLOCK_PATTERN.exec(dayEndsAt)
  if (clock === null || end === null) throw new RangeError('times must be HH:MM or HH:MM:SS')
  const minutes = Number(clock[1]) * 60 + Number(clock[2])
  const endMinutes = Number(end[1]) * 60 + Number(end[2])
  const nextDay = minutes < endMinutes ? 1 : 0
  return new Date(instantOfWall(Date.UTC(year, month - 1, date + nextDay, 0, minutes), timeZone))
}
