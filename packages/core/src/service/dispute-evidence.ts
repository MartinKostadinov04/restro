// The "Dispute evidence" text of a payment (#222; D122 §8, decision log 5.12, 5.13). One pure
// function builds it, so "Copy as text", "Copy in English" and "Print" all show the same fields in
// the same order. It holds what D122 §8 lists and nothing more: the lines and prices the guest
// confirmed, each step with its time, the real table, the payment table and the bar, the money
// alerts' answers (who, what, when), the 3-D Secure result, the provider's payment id and
// authorisation code, the receipt and fiscal memory numbers; plus the refunds and their stornos and
// where a dispute stands. No link (banks do not review outside content), no card digits and no
// phone, device or IP identifier: none is ever kept (D111).
//
// The words live here, in both languages, because "Copy in English" is English whatever the
// screen's language. Times are the venue's, `YYYY-MM-DD HH:mm`; amounts are decimals with a dot in
// the currency's own scale, made by the money module (rule 8).
//
// Pure: no I/O.

import { CURRENCY_SCALE, type Currency, minorToDecimal } from '../money'
import { wallClock } from '../service-day'
import type { AlertLocale } from './alert-text'

/** Who did something, as the evidence names them. */
export type EvidenceWho =
  | { readonly kind: 'person'; readonly name: string }
  | { readonly kind: 'restro' }
  | { readonly kind: 'guest' }

/** Everything the text is made of; the caller reads it, the function words it. */
export interface DisputeEvidenceInput {
  /** The number the guest shows the waiter (`paymentNumberOf`). */
  readonly paymentNumber: string
  /** The payment's service day, `YYYY-MM-DD`. */
  readonly serviceDate: string
  /** The venue's time zone. */
  readonly timeZone: string
  readonly currency: Currency
  readonly amountMinor: number | null
  readonly tipMinor: number
  readonly capturedMinor: number | null
  /** The real table, the payment table it was paid at, and the bar, as the venue names them. */
  readonly table: string
  /** The table has a number and no name: the text words it "Table 7". */
  readonly tableNumbered: boolean
  readonly payTable: string | null
  readonly payTableNumbered: boolean
  readonly bar: string | null
  /** The lines and prices the guest confirmed. */
  readonly lines: readonly {
    readonly name: string
    readonly quantity: string
    readonly amountMinor: number
  }[]
  /** Each step with its time, and the staff's answers, in the order they happened. */
  readonly steps: readonly {
    readonly at: Date
    readonly kind: 'payment.state' | 'payment.answered'
    readonly toState: string | null
    readonly reason: string | null
    readonly who: EvidenceWho
  }[]
  readonly threeDs: string | null
  /** *Backend*: the provider's id of the payment, which the provider's dispute shows. */
  readonly providerPaymentRef: string | null
  readonly authorisationCode: string | null
  readonly receiptNumber: string | null
  readonly fiscalMemoryNumber: string | null
  readonly dispute: {
    readonly state: 'open' | 'won' | 'lost'
    readonly openedAt: Date | null
    readonly dueAt: Date | null
    readonly closedAt: Date | null
  } | null
  readonly refunds: readonly {
    readonly amountMinor: number
    readonly seenAt: Date
    readonly failed: boolean
    readonly storno: { readonly who: EvidenceWho; readonly at: Date } | null
  }[]
}

interface Words {
  readonly title: string
  readonly payment: string
  readonly night: string
  readonly total: string
  readonly tip: string
  readonly captured: string
  readonly realTable: string
  /** `Table 7` for a table known by its number. */
  readonly numbered: (number: string) => string
  readonly payTable: string
  readonly bar: string
  readonly items: string
  readonly steps: string
  readonly answers: string
  readonly threeDs: string
  readonly providerId: string
  readonly authorisation: string
  readonly receipt: string
  readonly fiscalMemory: string
  readonly dispute: string
  readonly answerBy: string
  readonly opened: string
  readonly closed: string
  readonly refunds: string
  readonly storno: string
  readonly stornoOpen: string
  readonly refundFailed: string
  readonly restro: string
  readonly guest: string
  readonly none: string
  readonly states: Readonly<Record<string, string>>
  readonly answerWords: Readonly<Record<string, string>>
  readonly threeDsWords: Readonly<Record<string, string>>
  readonly disputeWords: Readonly<Record<string, string>>
}

const BG: Words = {
  title: 'Доказателства по спор за плащане с карта',
  payment: 'Плащане',
  night: 'Вечер',
  total: 'Общо',
  tip: 'Бакшиш',
  captured: 'Таксувано',
  realTable: 'Маса на госта',
  numbered: (number) => `Маса ${number}`,
  payTable: 'Маса за плащане',
  bar: 'Бар',
  items: 'Артикули, потвърдени от госта',
  steps: 'Стъпки',
  answers: 'Отговори на персонала',
  threeDs: '3-D Secure',
  providerId: 'Номер на плащането при доставчика',
  authorisation: 'Код за одобрение',
  receipt: 'Номер на бележка',
  fiscalMemory: 'Номер на фискална памет',
  dispute: 'Спор',
  answerBy: 'Отговор до',
  opened: 'Открит',
  closed: 'Приключен',
  refunds: 'Връщания',
  storno: 'сторно направено',
  stornoOpen: 'сторното още не е направено',
  refundFailed: 'връщането не е минало',
  restro: 'Restro',
  guest: 'гост',
  none: '-',
  states: {
    requested: 'започнато',
    priced: 'изчислено',
    awaiting_guest: 'чака госта',
    held: 'сумата е задържана',
    queued: 'чака маса за плащане',
    isolated: 'преместено на маса за плащане',
    entered: 'въведено в касата',
    checked: 'проверено',
    closed: 'сметката е приключена',
    cancelling: 'отказва се',
    captured: 'таксувано',
    released: 'освободено',
    unconfirmed: 'без потвърждение',
    stranded: 'артикулите останаха на маса за плащане',
    capture_failed: 'картата не е таксувана',
  },
  answerWords: {
    receipt_printed: 'бележката е отпечатана',
    no_receipt: 'няма бележка',
    on_till: 'в касата е',
    not_on_till: 'не е в касата',
  },
  threeDsWords: {
    authenticated: 'удостоверено от банката',
    attempted: 'опитано',
    exempted: 'освободено от проверка',
    not_supported: 'не се поддържа от картата',
    failed: 'неуспешно',
    error: 'грешка',
  },
  disputeWords: { open: 'отворен', won: 'спечелен', lost: 'загубен' },
}

const EN: Words = {
  title: 'Evidence for a card payment dispute',
  payment: 'Payment',
  night: 'Night',
  total: 'Total',
  tip: 'Tip',
  captured: 'Charged',
  realTable: "Guest's table",
  numbered: (number) => `Table ${number}`,
  payTable: 'Payment table',
  bar: 'Bar',
  items: 'Items the guest confirmed',
  steps: 'Steps',
  answers: "Staff's answers",
  threeDs: '3-D Secure',
  providerId: "Provider's payment id",
  authorisation: 'Authorisation code',
  receipt: 'Receipt number',
  fiscalMemory: 'Fiscal memory number',
  dispute: 'Dispute',
  answerBy: 'Answer by',
  opened: 'Opened',
  closed: 'Closed',
  refunds: 'Refunds',
  storno: 'storno done',
  stornoOpen: 'storno not done yet',
  refundFailed: "the refund didn't go through",
  restro: 'Restro',
  guest: 'guest',
  none: '-',
  states: {
    requested: 'started',
    priced: 'priced',
    awaiting_guest: 'waiting for the guest',
    held: 'amount held',
    queued: 'waiting for a payment table',
    isolated: 'moved to a payment table',
    entered: 'entered on the till',
    checked: 'checked',
    closed: 'bill closed',
    cancelling: 'being cancelled',
    captured: 'charged',
    released: 'released',
    unconfirmed: 'not confirmed',
    stranded: 'items stuck on a payment table',
    capture_failed: 'card not charged',
  },
  answerWords: {
    receipt_printed: 'receipt printed',
    no_receipt: 'no receipt',
    on_till: 'on the till',
    not_on_till: 'not on the till',
  },
  threeDsWords: {
    authenticated: 'authenticated by the bank',
    attempted: 'attempted',
    exempted: 'exempted',
    not_supported: 'not supported by the card',
    failed: 'failed',
    error: 'error',
  },
  disputeWords: { open: 'open', won: 'won', lost: 'lost' },
}

const TABLES: Readonly<Record<AlertLocale, Words>> = { bg: BG, en: EN }

const pad = (value: number) => String(value).padStart(2, '0')

/** `2026-10-29 21:05` on the venue's clocks. */
function stamp(at: Date, timeZone: string): string {
  const clock = wallClock(at, timeZone)
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)} ${pad(clock.hour)}:${pad(clock.minute)}`
}

/**
 * The evidence of one payment as plain text for the language: lines of `label: value`, a blank
 * line between the sections. The same text for the copy buttons and the print layout.
 */
export function disputeEvidenceText(input: DisputeEvidenceInput, locale: AlertLocale): string {
  const w = TABLES[locale]
  const scale = CURRENCY_SCALE[input.currency]
  const money = (minor: number) => `${minorToDecimal(minor, scale)} ${input.currency}`
  const at = (date: Date) => stamp(date, input.timeZone)
  const who = (by: EvidenceWho) =>
    by.kind === 'person' ? by.name : by.kind === 'guest' ? w.guest : w.restro
  const orNone = (value: string | null) => (value === null || value === '' ? w.none : value)
  const sections: string[][] = []

  const head = [w.title, `${w.payment}: ${input.paymentNumber}`, `${w.night}: ${input.serviceDate}`]
  if (input.amountMinor !== null) head.push(`${w.total}: ${money(input.amountMinor)}`)
  if (input.tipMinor > 0) head.push(`${w.tip}: ${money(input.tipMinor)}`)
  if (input.capturedMinor !== null) head.push(`${w.captured}: ${money(input.capturedMinor)}`)
  sections.push(head)

  sections.push([
    `${w.realTable}: ${input.tableNumbered ? w.numbered(input.table) : input.table}`,
    `${w.payTable}: ${
      input.payTable !== null && input.payTableNumbered
        ? w.numbered(input.payTable)
        : orNone(input.payTable)
    }`,
    `${w.bar}: ${orNone(input.bar)}`,
  ])

  if (input.lines.length > 0) {
    sections.push([
      `${w.items}:`,
      ...input.lines.map(
        (line) => `- ${Number(line.quantity)} × ${line.name}: ${money(line.amountMinor)}`,
      ),
    ])
  }

  const states = input.steps.filter((step) => step.kind === 'payment.state')
  if (states.length > 0) {
    sections.push([
      `${w.steps}:`,
      ...states.map((step) => {
        const word = step.toState === null ? undefined : w.states[step.toState]
        return `- ${at(step.at)} ${word ?? w.none}`
      }),
    ])
  }

  const answers = input.steps.filter((step) => step.kind === 'payment.answered')
  if (answers.length > 0) {
    sections.push([
      `${w.answers}:`,
      ...answers.map((step) => {
        const word = step.reason === null ? undefined : w.answerWords[step.reason]
        return `- ${at(step.at)} ${word ?? w.none} (${who(step.who)})`
      }),
    ])
  }

  sections.push([
    `${w.threeDs}: ${input.threeDs === null ? w.none : (w.threeDsWords[input.threeDs] ?? w.none)}`,
    `${w.providerId}: ${orNone(input.providerPaymentRef)}`,
    `${w.authorisation}: ${orNone(input.authorisationCode)}`,
    `${w.receipt}: ${orNone(input.receiptNumber)}`,
    `${w.fiscalMemory}: ${orNone(input.fiscalMemoryNumber)}`,
  ])

  if (input.refunds.length > 0) {
    sections.push([
      `${w.refunds}:`,
      ...input.refunds.map((refund) => {
        const state = refund.failed
          ? w.refundFailed
          : refund.storno === null
            ? w.stornoOpen
            : `${w.storno}, ${who(refund.storno.who)}, ${at(refund.storno.at)}`
        return `- ${at(refund.seenAt)} ${money(refund.amountMinor)}: ${state}`
      }),
    ])
  }

  if (input.dispute !== null) {
    const { dispute } = input
    const lines = [`${w.dispute}: ${w.disputeWords[dispute.state] ?? w.none}`]
    if (dispute.openedAt !== null) lines.push(`${w.opened}: ${at(dispute.openedAt)}`)
    if (dispute.dueAt !== null) lines.push(`${w.answerBy}: ${at(dispute.dueAt)}`)
    if (dispute.closedAt !== null) lines.push(`${w.closed}: ${at(dispute.closedAt)}`)
    sections.push(lines)
  }

  return sections.map((lines) => lines.join('\n')).join('\n\n')
}
