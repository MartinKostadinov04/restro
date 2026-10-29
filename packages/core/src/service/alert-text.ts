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
  /** The payment provider's name for `{provider}` (#222), or null where it is not known. */
  readonly provider?: string | null
}

/** The alert as the words read it. */
export interface AlertWords {
  readonly kind: string
  readonly details: Readonly<Record<string, unknown>>
}

/** What the group's message ends with when the day's close cleared the alert (#162). */
export function clearedLine(locale: AlertLocale = 'en'): string {
  return TABLES[locale].clearedAtNightEnd
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
  readonly outOfStock: (source: string, item: string | null) => string
  readonly paymentUnconfirmed: (table: string) => string
  readonly paymentUnconfirmedBody: (source: string) => string
  /** A pay-first round whose entry is not known: is it on its payment table? (#113, #115) */
  readonly paymentUnconfirmedTillBody: (source: string) => string
  readonly paymentLinesNotBack: (table: string) => string
  readonly paymentLinesNotBackBody: (source: string) => string
  readonly paymentCheckFailed: (table: string) => string
  readonly paymentCheckFailedBody: string
  readonly paymentStranded: (table: string) => string
  readonly paymentStrandedBody: (source: string) => string
  readonly paymentCaptureFailed: (venue: string, table: string) => string
  readonly paymentCaptureFailedBody: (source: string) => string
  readonly paymentReleaseRefused: (venue: string, table: string) => string
  readonly paymentReleaseRefusedBody: string
  readonly paymentReleaseRefusedCapturedBody: string
  readonly paymentHoldExpired: (venue: string, table: string) => string
  readonly paymentHoldExpiredBody: (source: string) => string
  readonly payingPaused: (venue: string) => string
  readonly payingStillPaused: (venue: string) => string
  readonly payingBack: (venue: string) => string
  readonly payingPausedBody: (source: string) => string
  readonly payingUnstable: (venue: string) => string
  readonly paymentStuck: (venue: string, table: string) => string
  readonly paymentAccountLost: (venue: string) => string
  readonly paymentAccountLostBody: (reason: 'access_removed' | 'account_restricted') => string
  /** A refund made in the provider's dashboard (#222): the group is told, with no amount. */
  readonly paymentRefunded: (table: string, provider: string, source: string) => string
  /** A card dispute (#222): the table and the payment's day, with no amount. */
  readonly paymentDisputed: (table: string, date: string) => string
  /** `{provider}` where the provider's name is not known. */
  readonly providerNone: string
  /** A calendar day (`YYYY-MM-DD`) as the language writes it. */
  readonly day: (date: string) => string
  readonly reminder: (title: string) => string
  readonly digest: (count: number, venue: string) => string
  readonly done: (who: string, time: string) => string
  readonly clearedAtNightEnd: string
  readonly doneButton: string
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
  outOfStock: (source, item) =>
    `Out of stock in ${source}: ${item ?? 'an item'}. Greyed out on the menu.`,
  paymentUnconfirmed: (table) => `${table}: a card payment is unconfirmed`,
  paymentUnconfirmedBody: (source) =>
    `Check in ${source} whether its receipt printed, then answer in Restro.`,
  paymentUnconfirmedTillBody: (source) =>
    `Check in ${source} whether the order is on its payment table, then answer in Restro.`,
  paymentLinesNotBack: (table) => `${table}: a card payment’s items are not back on the table`,
  paymentLinesNotBackBody: (source) =>
    `The bill may have closed after all. Check again in ${source} whether its receipt printed, then answer in Restro.`,
  paymentCheckFailed: (table) => `${table}: a card payment was stopped before closing`,
  paymentCheckFailedBody:
    "The bill or the card's hold changed before it closed. The card was not charged.",
  paymentStranded: (table) => `${table}: items are stuck on a payment table`,
  paymentStrandedBody: (source) => `Move them back to the table in ${source}.`,
  paymentCaptureFailed: (venue, table) =>
    `${venue}: a closed bill’s card payment couldn’t be taken (${table})`,
  paymentCaptureFailedBody: (source) =>
    `The bill is closed in ${source}, but the card was not charged.`,
  paymentReleaseRefused: (venue, table) =>
    `${venue}: a cancelled card payment’s hold couldn’t be released (${table})`,
  paymentReleaseRefusedBody:
    'The card was not charged. Restro keeps checking until the bank drops the hold.',
  paymentReleaseRefusedCapturedBody:
    'The card was charged. Refund the guest with the payment provider if needed.',
  paymentHoldExpired: (venue, table) =>
    `${venue}: a card payment’s hold ran out before anyone answered (${table})`,
  paymentHoldExpiredBody: (source) =>
    `Nothing was charged. The bill may be closed in ${source}: if so, collect the payment. If not, move its items back from the payment table.`,
  payingPaused: (venue) => `Card payments in the app are paused at ${venue}`,
  payingStillPaused: (venue) => `Card payments in the app are still paused at ${venue}`,
  payingBack: (venue) => `Card payments in the app are back at ${venue}`,
  payingPausedBody: (source) =>
    `The payment provider is not answering. Ordering goes on; take payments in ${source}.`,
  payingUnstable: (venue) => `${venue}: card payments in the app are unstable`,
  paymentStuck: (venue, table) => `${venue}: a card payment is not moving on (${table})`,
  paymentAccountLost: (venue) => `${venue}: card payments are paused`,
  paymentAccountLostBody: (reason) =>
    reason === 'access_removed'
      ? 'Restro lost access to the venue’s payment account. Open Settings, Paying, and choose Reconnect.'
      : 'The payment account can’t take card payments now. Open Settings, Paying, to see what is missing and choose Reconnect.',
  paymentRefunded: (table, provider, source) =>
    `${table}: a refund was made in ${provider}. Make the storno in ${source}.`,
  paymentDisputed: (table, date) =>
    `${table}: card dispute on a payment of ${date}. A manager sees the evidence in Restro.`,
  providerNone: 'the payment provider',
  day: (date) => dayWords(date, 'en-GB'),
  reminder: (title) => `Reminder: ${title}`,
  digest: (count, venue) => `${count} alerts at ${venue}`,
  done: (who, time) => `Done by ${who}, ${time}`,
  clearedAtNightEnd: 'Cleared at the end of the night',
  doneButton: 'Done',
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
  outOfStock: (source, item) => `Изчерпано в ${source}: ${item ?? 'артикул'}. Посивено в менюто.`,
  paymentUnconfirmed: (table) => `${table}: плащане с карта без потвърждение`,
  paymentUnconfirmedBody: (source) =>
    `Проверете в ${source} дали бележката е отпечатана и отговорете в Restro.`,
  paymentUnconfirmedTillBody: (source) =>
    `Проверете в ${source} дали поръчката е на масата ѝ за плащане и отговорете в Restro.`,
  paymentLinesNotBack: (table) => `${table}: артикулите на плащане с карта не са върнати на масата`,
  paymentLinesNotBackBody: (source) =>
    `Сметката може все пак да е приключена. Проверете отново в ${source} дали бележката е отпечатана и отговорете в Restro.`,
  paymentCheckFailed: (table) => `${table}: плащане с карта е спряно преди приключване`,
  paymentCheckFailedBody:
    'Сметката или блокираната сума по картата се промени преди приключване. Картата не е таксувана.',
  paymentStranded: (table) => `${table}: артикули останаха на маса за плащане`,
  paymentStrandedBody: (source) => `Върнете ги на масата в ${source}.`,
  paymentCaptureFailed: (venue, table) =>
    `${venue}: плащане с карта по приключена сметка не можа да бъде взето (${table})`,
  paymentCaptureFailedBody: (source) =>
    `Сметката е приключена в ${source}, но картата не е таксувана.`,
  paymentReleaseRefused: (venue, table) =>
    `${venue}: блокираната сума на отказано плащане с карта не можа да бъде освободена (${table})`,
  paymentReleaseRefusedBody:
    'Картата не е таксувана. Restro проверява, докато банката не освободи сумата.',
  paymentReleaseRefusedCapturedBody:
    'Картата е таксувана. Ако е нужно, върнете сумата на госта през доставчика на плащания.',
  paymentHoldExpired: (venue, table) =>
    `${venue}: блокираната сума на плащане с карта изтече преди някой да отговори (${table})`,
  paymentHoldExpiredBody: (source) =>
    `Нищо не е таксувано. Сметката може да е приключена в ${source}: ако е така, вземете плащането. Ако не, върнете артикулите от масата за плащане.`,
  payingPaused: (venue) => `Плащането с карта в приложението е спряно в ${venue}`,
  payingStillPaused: (venue) => `Плащането с карта в приложението все още е спряно в ${venue}`,
  payingBack: (venue) => `Плащането с карта в приложението е пуснато отново в ${venue}`,
  payingPausedBody: (source) =>
    `Доставчикът на плащания не отговаря. Поръчките продължават; приемайте плащания в ${source}.`,
  payingUnstable: (venue) => `${venue}: плащането с карта в приложението е нестабилно`,
  paymentStuck: (venue, table) => `${venue}: плащане с карта не продължава (${table})`,
  paymentAccountLost: (venue) => `${venue}: плащанията с карта са спрени`,
  paymentAccountLostBody: (reason) =>
    reason === 'access_removed'
      ? 'Restro загуби достъп до платежната сметка на обекта. Отворете Настройки, Плащане, и изберете Свържи отново.'
      : 'Платежната сметка не може да приема плащания с карта. Отворете Настройки, Плащане, за да видите какво липсва, и изберете Свържи отново.',
  paymentRefunded: (table, provider, source) =>
    `${table}: направено е връщане в ${provider}. Направете сторно в ${source}.`,
  paymentDisputed: (table, date) =>
    `${table}: спор по картово плащане от ${date}. Мениджър вижда доказателствата в Restro.`,
  providerNone: 'доставчика на плащания',
  day: (date) => dayWords(date, 'bg-BG'),
  reminder: (title) => `Напомняне: ${title}`,
  digest: (count, venue) => `${count} сигнала в ${venue}`,
  done: (who, time) => `Готово от ${who}, ${time}`,
  clearedAtNightEnd: 'Изчистено в края на вечерта',
  doneButton: 'Готово',
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

/** A calendar day (`YYYY-MM-DD`) in the words of a language; the text itself if it is not one. */
function dayWords(date: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (match === null) return date
  // Bulgarian dates are written numerically, `28.10.2026`; its short month name carries a "г." of
  // its own that would double the sentence's full stop.
  if (locale === 'bg-BG') return `${match[3]}.${match[2]}.${match[1]}`
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at)
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
    case 'item_out_of_stock':
      return { title: words.outOfStock(source, asText(alert.details.name)), body: '' }
    case 'payment_unconfirmed':
      return {
        title: words.paymentUnconfirmed(table),
        // A pay-first round before any close asks whether it is on the till, not about a receipt.
        body:
          alert.details.question === 'till'
            ? words.paymentUnconfirmedTillBody(source)
            : words.paymentUnconfirmedBody(source),
      }
    case 'payment_lines_not_back':
      return {
        title: words.paymentLinesNotBack(table),
        body: words.paymentLinesNotBackBody(source),
      }
    case 'payment_check_failed':
      return { title: words.paymentCheckFailed(table), body: words.paymentCheckFailedBody }
    case 'payment_stranded':
      return { title: words.paymentStranded(table), body: words.paymentStrandedBody(source) }
    case 'payment_capture_failed':
      return {
        title: words.paymentCaptureFailed(venueName, table),
        body: words.paymentCaptureFailedBody(source),
      }
    case 'payment_release_refused':
      return {
        title: words.paymentReleaseRefused(venueName, table),
        // The provider's refusal says what happened to the card: captured is charged.
        body:
          alert.details.code === 'already_captured'
            ? words.paymentReleaseRefusedCapturedBody
            : words.paymentReleaseRefusedBody,
      }
    case 'payment_hold_expired':
      return {
        title: words.paymentHoldExpired(venueName, table),
        body: words.paymentHoldExpiredBody(source),
      }
    case 'paying_paused': {
      if (step === 'back') return { title: words.payingBack(venueName), body: '' }
      const still = step === 'reminder' || step === 'still_paused'
      return {
        title: still ? words.payingStillPaused(venueName) : words.payingPaused(venueName),
        body: words.payingPausedBody(source),
      }
    }
    case 'payment_stuck':
      return { title: words.paymentStuck(venueName, table), body: '' }
    case 'paying_unstable':
      return { title: words.payingUnstable(venueName), body: '' }
    case 'payment_refunded':
      return {
        title: words.paymentRefunded(table, context.provider ?? words.providerNone, source),
        body: '',
      }
    case 'payment_disputed':
      return {
        title: words.paymentDisputed(table, words.day(asText(alert.details.paymentDate) ?? '')),
        body: '',
      }
    case 'payment_account_lost':
      return {
        title: words.paymentAccountLost(venueName),
        body: words.paymentAccountLostBody(
          alert.details.reason === 'account_restricted' ? 'account_restricted' : 'access_removed',
        ),
      }
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

/** The text on the Done button under an alert in the venue's Telegram group. */
export function doneButtonText(locale: AlertLocale): string {
  return TABLES[locale].doneButton
}
