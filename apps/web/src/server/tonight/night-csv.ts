// The rows of the end-of-night CSV (#86; plan `2026-10-27-tonight-end-of-night-plan.md` §6): one
// row per item of the page, section by section, in the page's order (To fix, Sent orders, Totals).
// Part 2 adds its sections' rows with the same columns. Worded in the admin's language by the
// translator the route passes; amounts stay minor units until core's `nightCsv` writes them
// through the money module (rule 8). Our ids only (rule 3): the reference is the sent order's
// short code; no POS id, no guest data.
import type { CsvRow } from '@restro/core/service'

import type { NightView, SentRowView, WhoView } from './night-view'

/** The translator of the `tonight` messages. */
export type Say = (key: string, values?: Record<string, string | number>) => string

/** A table as the file words it: "Table 7" for a number, our own name as it is. */
export function tableText(say: Say, table: string, numbered: boolean): string {
  return numbered ? say('tb', { n: table }) : table
}

/** Who did a step: a name, Restro or a guest, with " · via Telegram" where it applies. */
export function whoText(say: Say, by: WhoView): string {
  const name =
    by.who.kind === 'person'
      ? by.who.name
      : by.who.kind === 'guest'
        ? say('lg_guest')
        : say('lg_restro')
  return by.telegram ? say('lg_via_tg', { who: name }) : name
}

/** One sent order as a row of the CSV; `time` is the clock time unless the caller puts a day in front. */
export function sentCsvRow(
  row: SentRowView,
  input: { readonly say: Say; readonly source: string; readonly time?: string },
): CsvRow {
  const { say, source } = input
  return {
    section: say('nt_sent'),
    time: input.time ?? row.time,
    table: tableText(say, row.table, row.numbered),
    reference: row.reference,
    what: say('cs_sent_order'),
    state: row.state === 'approval' ? say('st_approval', { source }) : say(`st_${row.state}`),
    reason: row.reason === null ? '' : say(`rs_${row.reason}`, { source }),
    ...(row.answer === null
      ? {}
      : {
          answer: say(row.answer.answer === 'found' ? 's_ok' : 's_no'),
          who: whoText(say, row.answer.by),
        }),
    amountMinor: row.totalMinor,
    detail: say('so_items', { n: row.itemCount }),
  }
}

/** The rows of one night. `sent` is every sent order of the day (the page shows the not added first). */
export function nightCsvRows(
  night: NightView,
  sent: readonly SentRowView[],
  input: { readonly say: Say; readonly source: string; readonly timezone: string },
): CsvRow[] {
  const { say, source } = input
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: input.timezone,
  })
  const what = say('cs_sent_order')
  const fix = say('nt_fix')
  const rows: CsvRow[] = []

  for (const row of night.fix) {
    rows.push({
      section: fix,
      time: clock.format(new Date(row.at)),
      table: tableText(say, row.table, row.numbered),
      reference: row.check?.reference ?? '',
      what,
      state: say('st_check'),
      detail: (row.check?.items ?? [])
        .map(
          (item) =>
            `${item.qty} × ${item.name}${item.options.length === 0 ? '' : ` (${item.options.join(', ')})`}`,
        )
        .join('; '),
    })
  }
  for (const row of night.answered) {
    rows.push({
      section: fix,
      table: tableText(say, row.table, row.numbered),
      reference: row.reference,
      what,
      state: say(row.answer === 'found' ? 'st_added' : 'st_notsent'),
      answer: say(row.answer === 'found' ? 's_ok' : 's_no'),
      who: whoText(say, row.by),
    })
  }

  for (const row of sent) rows.push(sentCsvRow(row, { say, source }))

  const totals = night.totals
  const section = say('nt_totals')
  const count = (label: string, value: number): CsvRow => ({
    section,
    what: label,
    detail: String(value),
  })
  rows.push(
    count(say('nt_t_tables'), totals.sittings),
    count(say('nt_t_sent'), totals.sentOrders),
    count(say('nt_t_added'), totals.sentOrdersAdded),
    { section, what: say('nt_t_added_amt'), amountMinor: totals.addedMinor },
    count(say('nt_t_notsent'), totals.sentOrdersNotSent),
    count(say('nt_t_unconf'), totals.sentOrdersUnconfirmed),
    count(say('nt_t_calls'), totals.waiterCalls),
    count(say('nt_t_pauses'), totals.pauses),
    count(say('nt_t_alerts'), totals.alerts),
  )
  return rows
}
