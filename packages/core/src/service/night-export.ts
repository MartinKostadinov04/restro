// The end of the night outside the screen (#86; plan
// `docs/deliverables/2026-10-27-tonight-end-of-night-plan.md` §6, §7): the CSV of one service day
// and the message the venue's Telegram group gets when the day closes. Both are pure: the caller
// words the rows (the admin's language for the CSV, the venue's for the message) and passes them
// in.
//
// - The CSV is UTF-8 with a byte-order mark so Excel opens Cyrillic, comma-separated, one header
//   row. Amounts are decimals with a dot in the currency's own scale, made by the money module
//   (rule 8), never from a float. Our ids only (rule 3): no POS id, no guest data.
// - The Telegram message holds counts and the problems, **no money amounts and no tips**
//   (Martin 10-27): the group may hold staff, and staff don't see tips.

import { CURRENCY_SCALE, type Currency, minorToDecimal } from '../money'
import type { AlertLocale } from './alert-text'

/** The columns of the CSV, in order (plan §6). */
export const CSV_COLUMNS = [
  'section',
  'time',
  'table',
  'reference',
  'what',
  'state',
  'reason',
  'answer',
  'who',
  'amount',
  'tip',
  'detail',
] as const

/** One column of the CSV. */
export type CsvColumn = (typeof CSV_COLUMNS)[number]

/** One row of the page, worded; amounts are minor units and positive. */
export interface CsvRow {
  readonly section: string
  readonly time?: string
  readonly table?: string
  readonly reference?: string
  readonly what?: string
  readonly state?: string
  readonly reason?: string
  readonly answer?: string
  readonly who?: string
  readonly amountMinor?: number
  /** Filled on payment rows only (part 2). */
  readonly tipMinor?: number
  readonly detail?: string
}

/** The byte-order mark Excel needs to read the file as UTF-8. */
export const CSV_BOM = '﻿'

/**
 * One text cell: quoted when it holds a comma, quote or line break; a cell that starts like a
 * formula (`=`, `+`, `-`, `@`, tab, return) gets a leading apostrophe so a spreadsheet never runs
 * it.
 */
function cell(value: string | undefined): string {
  let text = value ?? ''
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** The CSV text of one service day: BOM, header, one line per row, CRLF line ends. */
export function nightCsv(rows: readonly CsvRow[], currency: Currency): string {
  const scale = CURRENCY_SCALE[currency]
  const amount = (minor: number | undefined) =>
    minor === undefined ? '' : minorToDecimal(minor, scale)
  const lines = [CSV_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(
      [
        cell(row.section),
        cell(row.time),
        cell(row.table),
        cell(row.reference),
        cell(row.what),
        cell(row.state),
        cell(row.reason),
        cell(row.answer),
        cell(row.who),
        amount(row.amountMinor),
        amount(row.tipMinor),
        cell(row.detail),
      ].join(','),
    )
  }
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`
}

/** The file's name for a venue and day: `restro-{venue}-{YYYY-MM-DD}.csv`. */
export function nightCsvName(venueSlug: string, day: string): string {
  return `restro-${venueSlug.replace(/[^A-Za-z0-9_-]/g, '-')}-${day}.csv`
}

/** The facts of the message. */
export interface NightMessageInput {
  readonly venueName: string
  /** The service day, `YYYY-MM-DD`. */
  readonly day: string
  readonly sentOrders: number
  readonly added: number
  readonly notSent: number
  readonly unconfirmed: number
  /** Sent orders still Unconfirmed: the reference and the table as the venue words it. */
  readonly fix: readonly { readonly reference: string; readonly table: string | null }[]
}

interface Words {
  readonly head: (venue: string, date: string) => string
  readonly sent: (n: number, a: number, ns: number, u: number) => string
  readonly fix: (k: number) => string
  readonly none: string
  readonly line: (ref: string, table: string | null) => string
}

const WORDS: Readonly<Record<AlertLocale, Words>> = {
  bg: {
    head: (venue, date) => `${venue} · вечерта на ${date}`,
    sent: (n, a, ns, u) => `Поръчки: ${n} (добавени ${a}, неизпратени ${ns}, непотвърдени ${u})`,
    fix: (k) => `За оправяне (${k}):`,
    none: 'Няма нищо за оправяне.',
    line: (ref, table) => `· Поръчка ${ref}${table === null ? '' : `, ${table}`}: още непотвърдена`,
  },
  en: {
    head: (venue, date) => `${venue} · night of ${date}`,
    sent: (n, a, ns, u) => `Sent orders: ${n} (added ${a}, not sent ${ns}, unconfirmed ${u})`,
    fix: (k) => `To fix (${k}):`,
    none: 'Nothing to fix.',
    line: (ref, table) =>
      `· Sent order ${ref}${table === null ? '' : `, ${table}`}: still unconfirmed`,
  },
}

/** "26 October" / «26 октомври» for a service day. */
export function nightDateText(locale: AlertLocale, day: string): string {
  return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))
}

/**
 * The message for the venue's Telegram group when a service day closes (plan §7): the totals and
 * the problems, counts only. Part 2's lines ("Payments: n taken, k to fix", the table and what is
 * wrong) join here once #115 reports them.
 */
export function nightMessage(locale: AlertLocale, input: NightMessageInput): string {
  const words = WORDS[locale]
  const lines = [
    words.head(input.venueName, nightDateText(locale, input.day)),
    words.sent(input.sentOrders, input.added, input.notSent, input.unconfirmed),
  ]
  if (input.fix.length === 0) lines.push(words.none)
  else {
    lines.push(words.fix(input.fix.length))
    for (const problem of input.fix) lines.push(words.line(problem.reference, problem.table))
  }
  return lines.join('\n')
}
