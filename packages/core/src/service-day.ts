// The venue's service day (D45) and local timestamps, without a date library: `Intl` gives the
// wall-clock time in the venue's time zone, and the service day is a calendar date, so no
// duration arithmetic (and no daylight-saving trap) is involved. Pure: the instant is an input.

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

function isoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/**
 * The service day `at` belongs to, as `YYYY-MM-DD`: the venue's local calendar date, or the day
 * before while the local time is earlier than `dayEndsAt` (D45: a night that runs to 07:00
 * belongs to the evening it started). Throws `RangeError` for an unknown time zone or a
 * malformed `dayEndsAt`.
 */
export function serviceDate(at: Date, timeZone: string, dayEndsAt: string): string {
  const end = CLOCK_PATTERN.exec(dayEndsAt)
  if (end === null) throw new RangeError('dayEndsAt must be HH:MM or HH:MM:SS')
  const local = wallClock(at, timeZone)
  const localSeconds = local.hour * 3600 + local.minute * 60 + local.second
  const endSeconds = Number(end[1]) * 3600 + Number(end[2]) * 60 + Number(end[3] ?? 0)
  if (localSeconds >= endSeconds) return isoDate(local.year, local.month, local.day)
  // The calendar day before (UTC arithmetic on a date only: no time zone involved).
  const previous = new Date(Date.UTC(local.year, local.month - 1, local.day - 1))
  return isoDate(previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate())
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
