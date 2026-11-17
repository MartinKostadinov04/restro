/**
 * Typed text <-> the stored values of the shared time and date fields.
 * A time is stored `HH:mm` (24-hour), a date `yyyy-MM-dd`; the screens show `HH:mm` and `dd.MM.yyyy`.
 */

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/**
 * Reads a typed time: "22:00", "2:30", "0530", "530", "05.30". `final` (on blur) also accepts an
 * hour alone ("22" -> "22:00"). Returns `HH:mm`, or null when it is not a valid 24-hour time yet.
 */
export function parseTimeText(text: string, final: boolean): string | null {
  const raw = text.trim()
  let hours: number
  let minutes: number
  const split = /^(\d{1,2})[:.\s](\d{2})$/.exec(raw)
  const digits = /^(\d{3,4})$/.exec(raw)
  if (split) {
    hours = Number(split[1])
    minutes = Number(split[2])
  } else if (digits) {
    const all = digits[1] as string
    hours = Number(all.slice(0, -2))
    minutes = Number(all.slice(-2))
  } else if (final && /^\d{1,2}$/.test(raw)) {
    hours = Number(raw)
    minutes = 0
  } else {
    return null
  }
  if (hours > 23 || minutes > 59) return null
  return `${pad(hours)}:${pad(minutes)}`
}

/** Moves an `HH:mm` time by whole minutes, wrapping around midnight. */
export function stepTime(value: string, deltaMinutes: number): string {
  const [h, m] = (parseTimeText(value, true) ?? '00:00').split(':').map(Number) as [number, number]
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

function realDate(year: number, month: number, day: number): string | null {
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    year < 1000
  ) {
    return null
  }
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/**
 * Reads a typed date: "10.11.2026", "10/11/2026", "10112026" or the stored "2026-11-10".
 * Returns `yyyy-MM-dd`, or null when it is not a real calendar date.
 */
export function parseDateText(text: string): string | null {
  const raw = text.trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
  if (iso) return realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const dotted = /^(\d{1,2})[./\-\s](\d{1,2})[./\-\s](\d{4})$/.exec(raw)
  if (dotted) return realDate(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]))
  const digits = /^(\d{2})(\d{2})(\d{4})$/.exec(raw)
  if (digits) return realDate(Number(digits[3]), Number(digits[2]), Number(digits[1]))
  return null
}

/** `yyyy-MM-dd` -> "dd.MM.yyyy"; anything else is returned as it is. */
export function formatDateText(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}

/** Moves a `yyyy-MM-dd` date by whole days. */
export function stepDate(value: string, deltaDays: number): string {
  const [y, m, d] = (parseDateText(value) ?? '1970-01-01').split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const moved = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`
}
