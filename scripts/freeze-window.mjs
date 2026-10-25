// Production deploy freeze (docs/agents/lead.md; docs/architecture/stack.md, step 6).
//
// No production deploys on the busy nights: Thursday, Friday, Saturday and Sunday from 18:00
// until 08:00 the next morning, Europe/Sofia time. Equivalent rule: frozen on Thu, Fri, Sat
// and Sun at or after 18:00, and on Fri, Sat, Sun and Mon before 08:00. A pull request
// carrying the label `freeze-override` (added by Martin for an approved fix) is let through.
//
// CLI (used by .github/workflows/freeze-check.yml), no dependencies, no install step needed:
//   PR_LABELS='["freeze-override"]' node scripts/freeze-window.mjs
// Environment:
//   PR_LABELS   JSON array of label names on the pull request (default: none)
//   FREEZE_NOW  ISO timestamp to use instead of the current time (manual checks only)
// Exit code 0 = deploy allowed, 1 = blocked.

import { pathToFileURL } from 'node:url'

export const TIME_ZONE = 'Europe/Sofia'
export const OVERRIDE_LABEL = 'freeze-override'

const EVENING_START_MINUTE = 18 * 60 // frozen from 18:00 ...
const MORNING_END_MINUTE = 8 * 60 // ... until 08:00 (exclusive)

// 0 = Sunday ... 6 = Saturday, as in Date#getDay.
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const EVENING_FREEZE_DAYS = new Set([4, 5, 6, 0]) // Thu Fri Sat Sun
const MORNING_FREEZE_DAYS = new Set([5, 6, 0, 1]) // Fri Sat Sun Mon

const sofiaClock = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * The wall-clock weekday and time in Europe/Sofia at the given instant. Uses the time zone
 * database through Intl, so summer and winter time are handled without fixed offsets.
 * @param {Date} date
 * @returns {{ weekday: number, hour: number, minute: number }}
 */
export function sofiaTime(date) {
  /** @type {Record<string, string>} */
  const parts = {}
  for (const part of sofiaClock.formatToParts(date)) {
    parts[part.type] = part.value
  }
  const weekday = WEEKDAYS[/** @type {keyof typeof WEEKDAYS} */ (parts.weekday)]
  if (weekday === undefined) {
    throw new Error(`Unexpected weekday from Intl: ${parts.weekday}`)
  }
  return { weekday, hour: Number(parts.hour), minute: Number(parts.minute) }
}

/**
 * Is this instant inside a freeze window (ignoring any override label)?
 * @param {Date} date
 * @returns {boolean}
 */
export function isFrozen(date) {
  const { weekday, hour, minute } = sofiaTime(date)
  const minuteOfDay = hour * 60 + minute
  const evening = EVENING_FREEZE_DAYS.has(weekday) && minuteOfDay >= EVENING_START_MINUTE
  const morning = MORNING_FREEZE_DAYS.has(weekday) && minuteOfDay < MORNING_END_MINUTE
  return evening || morning
}

/**
 * @param {{ now: Date, labels: readonly string[] }} input
 * @returns {{ allowed: boolean, message: string }}
 */
export function decide({ now, labels }) {
  const { weekday, hour, minute } = sofiaTime(now)
  const day = Object.keys(WEEKDAYS)[weekday]
  const local = `${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${TIME_ZONE}`

  if (!isFrozen(now)) {
    return { allowed: true, message: `Not in a freeze window (${local}). Deploy allowed.` }
  }
  if (labels.includes(OVERRIDE_LABEL)) {
    return {
      allowed: true,
      message: `In a freeze window (${local}) but the pull request has the "${OVERRIDE_LABEL}" label. Deploy allowed.`,
    }
  }
  return {
    allowed: false,
    message: `Deploy freeze (${local}): no production deploys Thu-Sun 18:00 to 08:00. Add the "${OVERRIDE_LABEL}" label for an approved fix, or wait.`,
  }
}

/** @param {string | undefined} raw */
function parseLabels(raw) {
  if (!raw) return []
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.some((label) => typeof label !== 'string')) {
    throw new Error('PR_LABELS must be a JSON array of strings')
  }
  return parsed
}

function main() {
  const now = process.env.FREEZE_NOW ? new Date(process.env.FREEZE_NOW) : new Date()
  if (Number.isNaN(now.getTime())) {
    throw new Error(`FREEZE_NOW is not a valid timestamp: ${process.env.FREEZE_NOW}`)
  }
  const { allowed, message } = decide({ now, labels: parseLabels(process.env.PR_LABELS) })
  if (allowed) {
    console.log(message)
  } else {
    console.log(`::error title=Deploy freeze::${message}`)
    console.error(message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
