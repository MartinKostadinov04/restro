// The words of an alert on a phone or in Telegram (D120 "Alerts reach everyone"; ticket #83), and
// the bot's short answers to a press of Done. Plain text, no notes and no guest data: an alert's
// details already hold none, and only the fields named here are ever read from them.
//
// The words follow the venue's default language: Bulgarian for `bg_BG`, English for any other.
// Like the shell's `strings.ts`, the two tables live here, pure, with no next-intl. The Bulgarian
// terms are the ones Martin approved for Tonight (docs/deliverables/2026-10-21-tonight-screen-1-plan.md
// §9, §11: «изпратена поръчка», «гостуване», «чака вас», «отворена за телефони») and GLOSSARY.md;
// the rest are listed in the pull request for Martin to confirm.
//
// Pure: the worker gives it the venue's name, the table's label and the POS's name (`{source}`, D82).

import { wallClock } from '../service-day'
import type { Step } from './alert-delivery'

/** The two pilot languages. */
export type AlertLocale = 'bg' | 'en'

/** The language a venue's alerts are worded in: Bulgarian for `bg_BG`, English for any other. */
export function alertLocale(defaultLocale: string | null | undefined): AlertLocale {
  return defaultLocale === 'bg_BG' ? 'bg' : 'en'
}

/** A message: a short title, and the details under it (possibly empty). */
export interface AlertMessage {
  readonly title: string
  readonly body: string
}

/** What the words need to know beyond the alert itself. */
export interface MessageContext {
  readonly locale: AlertLocale
  readonly venueName: string
  /** The alert's table as {@link tableLabel} words it, or null. */
  readonly tableLabel: string | null
  /** The POS's name for staff (D82). */
  readonly source: string
}

/** The alert as the words read it. */
export interface AlertWords {
  readonly kind: string
  readonly details: Readonly<Record<string, unknown>>
}

/** What the bot says back to a person who pressed Done. */
export type TelegramAnswer =
  | 'not_an_alert'
  | 'no_venue'
  | 'not_linked'
  | 'denied'
  | 'cannot'
  | 'already'
  | 'done'
  | 'failed'

/** The words of one language. */
interface Strings {
  readonly table: (label: string | null) => string
  readonly unconfirmedTitle: (table: string) => string
  readonly unconfirmedBody: (items: string, reference: string | null, source: string) => string
  readonly paused: (where: string) => string
  readonly stillPaused: (where: string) => string
  readonly back: (where: string) => string
  readonly preOpening: (venue: string, source: string) => string
  readonly pace: (venue: string, table: string) => string
  readonly rate: (venue: string, table: string) => string
  readonly unstable: (venue: string, source: string) => string
  readonly codeBlock: (venue: string) => string
  readonly reminder: (title: string) => string
  readonly digest: (count: number, venue: string) => string
  readonly done: (who: string, time: string) => string
  readonly answers: Readonly<Record<TelegramAnswer, string>>
}

const joinedParts = (parts: readonly string[]) => parts.filter((part) => part !== '').join(', ')

const EN: Strings = {
  table: (label) => (label === null ? 'A table' : `Table ${label}`),
  unconfirmedTitle: (table) => `${table}: an order couldn’t be confirmed`,
  unconfirmedBody: (items, reference, source) =>
    `${joinedParts([items, reference === null ? '' : `ref ${reference}`])}. Check the bill in ${source}.`,
  paused: (where) => `Ordering is paused at ${where}`,
  stillPaused: (where) => `Ordering is still paused at ${where}`,
  back: (where) => `Ordering is back at ${where}`,
  preOpening: (venue, source) => `${venue} can’t open: Restro can’t work with ${source}`,
  pace: (venue, table) => `${venue}: ${table} hit the order pace limit`,
  rate: (venue, table) => `${venue}: ${table} changed its order too fast`,
  unstable: (venue, source) => `${venue}: the connection to ${source} is unstable`,
  codeBlock: (venue) => `${venue}: a network was blocked after too many wrong table codes`,
  reminder: (title) => `Reminder: ${title}`,
  digest: (count, venue) => `${count} alerts at ${venue}`,
  done: (who, time) => `Done by ${who}, ${time}`,
  answers: {
    not_an_alert: 'That button is not for an alert.',
    no_venue: 'This group is not linked to a venue in Restro.',
    not_linked: 'Your Telegram is not linked to a Restro account.',
    denied: 'Your role cannot answer alerts here.',
    cannot: 'This alert cannot be marked Done.',
    already: 'Already done.',
    done: 'Done.',
    failed: 'Something went wrong. Try again in Restro.',
  },
}

const BG: Strings = {
  table: (label) => (label === null ? 'Маса' : `Маса ${label}`),
  unconfirmedTitle: (table) => `${table}: изпратена поръчка без потвърждение`,
  unconfirmedBody: (items, reference, source) =>
    `${joinedParts([items, reference === null ? '' : `номер ${reference}`])}. Проверете сметката в ${source}.`,
  paused: (where) => `Поръчките в ${where} са спрени`,
  stillPaused: (where) => `Поръчките в ${where} все още са спрени`,
  back: (where) => `Поръчките в ${where} са пуснати отново`,
  preOpening: (venue, source) => `${venue} не може да отвори: Restro не може да работи с ${source}`,
  pace: (venue, table) => `${venue}: ${table} достигна лимита за поръчки`,
  rate: (venue, table) => `${venue}: поръчката на ${table} се променя твърде бързо`,
  unstable: (venue, source) => `${venue}: връзката с ${source} е нестабилна`,
  codeBlock: (venue) => `${venue}: мрежа е блокирана след твърде много грешни кодове на маси`,
  reminder: (title) => `Напомняне: ${title}`,
  digest: (count, venue) => `${count} сигнала в ${venue}`,
  done: (who, time) => `Готово от ${who}, ${time}`,
  answers: {
    not_an_alert: 'Този бутон не е за сигнал.',
    no_venue: 'Тази група не е свързана с обект в Restro.',
    not_linked: 'Вашият Telegram не е свързан с акаунт в Restro.',
    denied: 'Ролята ви не може да отговаря на сигнали тук.',
    cannot: 'Този сигнал не може да се отбележи като готов.',
    already: 'Вече е готово.',
    done: 'Готово.',
    failed: 'Нещо се обърка. Опитайте отново в Restro.',
  },
}

const TABLES: Readonly<Record<AlertLocale, Strings>> = { bg: BG, en: EN }

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/** `Table 7` for a table: our name for it, else its number; null when it has neither. */
export function tableLabel(
  locale: AlertLocale,
  table: { readonly name: string | null; readonly number: string | null },
): string | null {
  if (table.name !== null) return table.name
  return table.number === null ? null : TABLES[locale].table(table.number)
}

/** `2 × Gin tonic (no mint)` for each line of an Unconfirmed order. */
function itemsOf(details: Readonly<Record<string, unknown>>): string {
  const items = Array.isArray(details.items) ? details.items : []
  return items
    .flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return []
      const { name, qty, options } = item as Record<string, unknown>
      const label = asText(name)
      if (label === null || typeof qty !== 'number') return []
      const extras = Array.isArray(options) ? options.filter((o) => typeof o === 'string') : []
      return [`${qty} × ${label}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`]
    })
    .join(', ')
}

/** The words of one alert at one step of its delivery. */
export function alertMessage(alert: AlertWords, context: MessageContext, step: Step): AlertMessage {
  const { venueName, source } = context
  const words = TABLES[context.locale]
  const table = context.tableLabel ?? words.table(null)
  switch (alert.kind) {
    case 'order_unconfirmed':
      return {
        title: words.unconfirmedTitle(table),
        body: words.unconfirmedBody(
          itemsOf(alert.details),
          asText(alert.details.reference),
          source,
        ),
      }
    case 'ordering_paused': {
      const barName = asText(alert.details.barName)
      const where =
        alert.details.scope === 'bar' && barName !== null ? `${barName}, ${venueName}` : venueName
      if (step === 'back') return { title: words.back(where), body: '' }
      const still = step === 'reminder' || step === 'still_paused'
      return { title: still ? words.stillPaused(where) : words.paused(where), body: '' }
    }
    case 'pre_opening_check':
      return { title: words.preOpening(venueName, source), body: '' }
    case 'order_pace':
      return { title: words.pace(venueName, table), body: '' }
    case 'order_rate':
      return { title: words.rate(venueName, table), body: '' }
    case 'connection_unstable':
      return { title: words.unstable(venueName, source), body: '' }
    case 'table_code_block':
      return { title: words.codeBlock(venueName), body: '' }
    default:
      return { title: `${venueName}: ${alert.kind}`, body: '' }
  }
}

/** A message marked as a reminder (a pause's own words already say "still"). */
export function reminderMessage(message: AlertMessage, locale: AlertLocale): AlertMessage {
  return { ...message, title: TABLES[locale].reminder(message.title) }
}

/** One message for several: one as it is, more as a list of their titles. */
export function digestMessage(
  messages: readonly AlertMessage[],
  venueName: string,
  locale: AlertLocale,
): AlertMessage {
  const [only] = messages
  if (messages.length === 1 && only !== undefined) return only
  return {
    title: TABLES[locale].digest(messages.length, venueName),
    body: messages.map((message) => message.title).join('\n'),
  }
}

/** A message as Telegram shows it: title, then body. */
export function linkedMessage(message: AlertMessage): string {
  return message.body === '' ? message.title : `${message.title}\n${message.body}`
}

/** `Done by Maria, 02:14`: who answered, at the time on the venue's clocks. */
export function doneLine(
  by: string,
  at: Date,
  timeZone: string,
  locale: AlertLocale = 'en',
): string {
  const { hour, minute } = wallClock(at, timeZone)
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return TABLES[locale].done(by, time)
}

/** What the bot says back to a person who pressed Done. */
export function telegramAnswer(locale: AlertLocale, answer: TelegramAnswer): string {
  return TABLES[locale].answers[answer]
}
