// The rows of the Log's two exports (#87; plan `2026-10-27-settings-alerts-export-plan.md` §B): the
// sent orders and the Log of a range of service days, each a CSV in the end-of-night CSV's format
// (core's `nightCsv`: the same columns, UTF-8 with a byte-order mark, amounts through the money
// module). Oldest first, one row per sent order or Log line, the day in front of the time. Our ids
// only (rule 3): the reference is the sent order's short code; no POS id, no guest data. The words
// are the screens' own (`logSentence`), in the admin's language.
import { formatMoney, type Locale } from '@restro/core'
import type { CsvRow } from '@restro/core/service'

import { logSentence } from '@/tonight/log-sentence'
import { PAYMENT_STATE_WORDS } from '@/tonight/payment-state-words'

import { sentCsvRow, tableText, whoText } from './night-csv'
import type { LogLineView, SentRowView } from './night-view'

/** The translator of the `tonight` messages. */
type Say = Parameters<typeof tableText>[0]

/** `2026-10-27 23:14`: the service day in front of the clock time. */
const stamp = (day: string, time: string): string => `${day} ${time}`

/** The sent orders of several days, oldest first (a day's list comes newest first). */
export function sentExportRows(
  days: readonly { readonly day: string; readonly rows: readonly SentRowView[] }[],
  input: { readonly say: Say; readonly source: string },
): CsvRow[] {
  return days.flatMap(({ day, rows }) =>
    [...rows].reverse().map((row) => sentCsvRow(row, { ...input, time: stamp(day, row.time) })),
  )
}

/** The Log of several days, oldest first; the one kind that never shows has no row. */
export function logExportRows(
  days: readonly { readonly day: string; readonly rows: readonly LogLineView[] }[],
  input: {
    readonly say: Say
    readonly source: string
    readonly currency: Parameters<typeof formatMoney>[1]
    readonly locale: Locale
  },
): CsvRow[] {
  const { say } = input
  const rows: CsvRow[] = []
  for (const { day, rows: lines } of days) {
    for (const line of [...lines].reverse()) {
      const sentence = logSentence(line, {
        say,
        table: (l) => (l.table === null ? say('lg_no_table') : tableText(say, l.table, l.numbered)),
        who: (by) => whoText(say, by),
        money: (minor) => formatMoney(minor, input.currency, input.locale),
        source: input.source,
        paymentStates: PAYMENT_STATE_WORDS,
      })
      if (sentence === null) continue
      rows.push({
        section: say('tab_log'),
        time: stamp(day, line.time),
        table: line.table === null ? '' : tableText(say, line.table, line.numbered),
        reference: line.reference ?? '',
        what: sentence,
        who: whoText(say, line.by),
        ...(line.amountMinor === null ? {} : { amountMinor: line.amountMinor }),
      })
    }
  }
  return rows
}
