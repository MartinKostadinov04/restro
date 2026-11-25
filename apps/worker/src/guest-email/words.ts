// What a guest email about his reservation says (#576; D136, D101), in his one language: the
// venue's name, what happened, the night, the hour and the party. Plain and short: no image, no
// link that tracks, nothing but these words; and never the word "receipt" (that email is the
// POS's, `../email/sender.ts`). Every kind of news is one entry of `NEWS`, in both languages
// (copy-rules.md). A new kind is its words here, its Log kind in core (`GUEST_EMAIL_LOG_KINDS`)
// and the state it leaves (`STILL_TRUE` in the job); the job and the sender keep their shape.
//
// Pure: no I/O.

import { type GuestEmailKind, wallClock } from '@restro/core'

import { type EmailWords, senderName } from '../email/sender'

/** The languages a guest email is written in: Bulgarian and English (copy-rules.md, rule 9). */
export const GUEST_EMAIL_LANGUAGES = ['bg', 'en'] as const

/** One of them. */
export type GuestEmailLanguage = (typeof GUEST_EMAIL_LANGUAGES)[number]

/** What the email names about the reservation; never the guest's name, phone or address. */
export interface ReservationFacts {
  readonly venueName: string
  /** The venue's service day the reservation belongs to (D45), `YYYY-MM-DD`. */
  readonly serviceDate: string
  /** When the party is expected. */
  readonly startsAt: Date
  /** The venue's time zone, which the hour is read in. */
  readonly timeZone: string
  /** How many are coming; null for nobody (a block, which is never emailed). */
  readonly partySize: number | null
}

/** The words of each piece of news, per language: the subject, and the line that says it. */
const NEWS: Readonly<
  Record<
    GuestEmailKind,
    Readonly<Record<GuestEmailLanguage, { subject: string; headline: (venue: string) => string }>>
  >
> = {
  reservation_cancelled: {
    bg: {
      subject: 'Резервацията ви е отказана',
      headline: (venue) => `Резервацията ви в ${venue} е отказана.`,
    },
    en: {
      subject: 'Your reservation is cancelled',
      headline: (venue) => `Your reservation at ${venue} is cancelled.`,
    },
  },
}

/** The labels of the reservation's lines. */
const LABELS: Readonly<Record<GuestEmailLanguage, { night: string; hour: string; party: string }>> =
  {
    bg: { night: 'Вечер', hour: 'Час', party: 'Гости' },
    en: { night: 'Night', hour: 'Time', party: 'Guests' },
  }

const WEEKDAYS: Readonly<Record<GuestEmailLanguage, readonly string[]>> = {
  // Sunday first, as `getUTCDay` counts.
  bg: ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

const MONTHS: Readonly<Record<GuestEmailLanguage, readonly string[]>> = {
  bg: [
    'януари',
    'февруари',
    'март',
    'април',
    'май',
    'юни',
    'юли',
    'август',
    'септември',
    'октомври',
    'ноември',
    'декември',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
}

/**
 * The night as a guest reads it: "събота, 28 ноември" / "Saturday 28 November". It is the service
 * day's own date (D45), so a party at 01:00 is on the night that began the evening before, as the
 * club counts it.
 */
export function nightWords(serviceDate: string, language: GuestEmailLanguage): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate)
  if (match === null) throw new RangeError('expected a service day as YYYY-MM-DD')
  const [, year, month, day] = match.map(Number) as [number, number, number, number]
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const weekdayName = WEEKDAYS[language][weekday]
  const monthName = MONTHS[language][month - 1]
  if (weekdayName === undefined || monthName === undefined) {
    throw new RangeError('expected a real date')
  }
  return language === 'bg'
    ? `${weekdayName}, ${day} ${monthName}`
    : `${weekdayName} ${day} ${monthName}`
}

/** The hour on the venue's clock, 24-hour, in both languages: "22:00". */
export function hourWords(at: Date, timeZone: string): string {
  const { hour, minute } = wallClock(at, timeZone)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** The subject and the plain text of one piece of news about a reservation, in one language. */
export function guestEmailWords(
  kind: GuestEmailKind,
  language: GuestEmailLanguage,
  facts: ReservationFacts,
): EmailWords {
  const news = NEWS[kind][language]
  const labels = LABELS[language]
  const venue = senderName(facts.venueName)
  const lines = [
    news.headline(venue),
    '',
    `${labels.night}: ${nightWords(facts.serviceDate, language)}`,
    `${labels.hour}: ${hourWords(facts.startsAt, facts.timeZone)}`,
    ...(facts.partySize === null ? [] : [`${labels.party}: ${facts.partySize}`]),
  ]
  return { subject: news.subject, text: lines.join('\n') }
}
