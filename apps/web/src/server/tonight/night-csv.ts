// The rows of the end-of-night CSV (#86; plan `2026-10-27-tonight-end-of-night-plan.md` §6): one
// row per item of the page, section by section, in the page's order (To fix, Sent orders, Totals).
// Part 2 adds its sections' rows with the same columns. Worded in the admin's language by the
// translator the route passes; amounts stay minor units until core's `nightCsv` writes them
// through the money module (rule 8). Our ids only (rule 3): the reference is the sent order's
// short code; no POS id, no guest data.
import type { CsvRow } from '@restro/core/service'

import { PAYMENT_STATE_WORDS, releaseReasonWord } from '@/tonight/payment-state-words'

import type { NightView, SentRowView, WhoView } from './night-view'
import type { MoneySectionsView, PaymentRowView } from './payment-view'

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

/** One payment as a row of the CSV (#115): our `py_` id as its reference, never a provider's. */
export function paymentCsvRow(row: PaymentRowView, say: Say): CsvRow {
  const stateKey = PAYMENT_STATE_WORDS[row.state]
  const reason = releaseReasonWord(say, row.reason)
  return {
    section: say('nt_pay'),
    time: row.time,
    table: tableText(say, row.table, row.numbered),
    reference: row.id,
    what: say('py_title', { table: tableText(say, row.table, row.numbered) }),
    state: stateKey === undefined ? '' : say(stateKey),
    reason: reason ?? '',
    ...(row.amountMinor === null ? {} : { amountMinor: row.amountMinor }),
    ...(row.tipMinor === null ? {} : { tipMinor: row.tipMinor }),
    detail: row.receiptNumber ?? '',
  }
}

/**
 * The rows of sections 5 and 6 (#222; decision log 5.17): `what` is `refund` or `dispute`. The
 * reference is our payment id (rule 3), never the provider's.
 */
export function moneyCsvRows(
  money: MoneySectionsView,
  input: { readonly say: Say; readonly provider: string | null },
): CsvRow[] {
  const { say } = input
  const provider = input.provider ?? say('pb_provider_none')
  const refunds = money.refunds.map(
    (refund): CsvRow => ({
      section: say('nt_refunds'),
      time: refund.seen?.time ?? refund.storno?.time ?? '',
      table: tableText(say, refund.table, refund.numbered),
      reference: refund.paymentId,
      what: 'refund',
      state: refund.failed
        ? refund.seen === null
          ? say('py_refund_failed', { provider })
          : `${say('py_refund_failed', { provider })} · ${say('lg_pay_refund_seen')}`
        : refund.storno === null
          ? say('nt_fix_storno')
          : say('st_ok'),
      ...(refund.seen !== null
        ? { who: whoText(say, refund.seen.by) }
        : refund.storno === null
          ? {}
          : { who: whoText(say, refund.storno.by) }),
      amountMinor: refund.amountMinor,
      detail: refund.receiptNumber ?? '',
    }),
  )
  const disputes = money.disputes.map(
    (dispute): CsvRow => ({
      section: say('nt_disputes'),
      table: tableText(say, dispute.table, dispute.numbered),
      reference: dispute.paymentId,
      what: 'dispute',
      state:
        dispute.state === 'won'
          ? say('d_won')
          : dispute.state === 'lost'
            ? say('d_lost')
            : say('py_disputed'),
      reason:
        dispute.state === 'open' && dispute.due !== null
          ? say('d_due', { provider, date: `${dispute.due.date} ${dispute.due.time}` })
          : '',
      ...(dispute.amountMinor === null ? {} : { amountMinor: dispute.amountMinor }),
    }),
  )
  return [...refunds, ...disputes]
}

/**
 * The rows of one night. `sent` is every sent order of the day (the page shows the not added first)
 * and `payments` every payment of it (#115), after the sent orders as on the page.
 */
export function nightCsvRows(
  night: NightView,
  sent: readonly SentRowView[],
  input: {
    readonly say: Say
    readonly source: string
    readonly timezone: string
    readonly payments?: readonly PaymentRowView[]
    /** Sections 5 and 6, for managers and owners (#222). */
    readonly money?: { readonly sections: MoneySectionsView; readonly provider: string | null }
  },
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
  for (const row of input.payments ?? []) rows.push(paymentCsvRow(row, say))
  if (input.money !== undefined) {
    rows.push(...moneyCsvRows(input.money.sections, { say, provider: input.money.provider }))
  }

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
  const money = night.money
  if (money !== null) {
    rows.push(
      count(say('nt_t_payments'), money.payments),
      { section, what: say('nt_t_captured'), amountMinor: money.capturedMinor },
      { section, what: say('nt_t_tips'), amountMinor: money.tipMinor },
      count(say('nt_t_unconf_pay'), money.paymentsUnconfirmed),
      { section, what: say('nt_t_unconf_amt'), amountMinor: money.unconfirmedMinor },
    )
  }
  return rows
}
