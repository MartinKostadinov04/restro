// What the payment parts of the end of the night and the payment sheet draw (#115; paying plan
// `docs/deliverables/2026-10-29-tonight-paying-plan.md`), made from core's `readNightPayments` and
// `readPaymentDetail` by pure functions so the rows, the words and the roles can be tested without a
// database. Plain data, safe to send to the browser: our ids and public fields only (rule 3), times
// as text in the venue's zone, money as minor units.
import type {
  NightPayFix,
  NightPaymentRow,
  NightPayments,
  PaymentDetail,
} from '@restro/core/service'

import { clockIn, type WhoView, whoView } from './night-view'
import { type ActionRow, holdOf, MONEY_VARIANT, type MoneyVariant } from './view'

/** One payment of the night as section 3 draws it. */
export interface PaymentRowView {
  readonly id: string
  readonly table: string
  readonly numbered: boolean
  readonly bar: string | null
  readonly payTable: string | null
  readonly state: string
  /** The reason code (the screen words it; a code with no word is never drawn raw). */
  readonly reason: string | null
  readonly amountMinor: number | null
  /** Null for a role that never sees tips. */
  readonly tipMinor: number | null
  readonly receiptNumber: string | null
  readonly currency: string
  readonly time: string
}

export function paymentRowView(
  row: NightPaymentRow,
  clock: ReturnType<typeof clockIn>,
): PaymentRowView {
  return {
    id: row.id,
    table: row.table,
    numbered: row.numbered,
    bar: row.bar,
    payTable: row.payTable,
    state: row.state,
    reason: row.reason,
    amountMinor: row.amountMinor,
    tipMinor: row.tipMinor,
    receiptNumber: row.receiptNumber,
    currency: row.currency,
    time: clock(row.at) ?? '',
  }
}

/** One money alert and its answer (section 4). */
export interface MoneyAlertView {
  readonly alertId: string
  readonly variant: MoneyVariant
  /** The second question (items not back) has its own title. */
  readonly linesNotBack: boolean
  readonly table: string
  readonly numbered: boolean
  readonly answer: {
    readonly code: string
    readonly by: WhoView
    readonly time: string
  } | null
}

/** The money sections of the night (4–6), for managers and owners. */
export interface MoneySectionsView {
  readonly alerts: readonly MoneyAlertView[]
  readonly refunds: readonly {
    readonly paymentId: string
    readonly table: string
    readonly numbered: boolean
    readonly refundedMinor: number
    readonly currency: string
  }[]
  readonly disputes: readonly {
    readonly paymentId: string
    readonly table: string
    readonly numbered: boolean
    readonly amountMinor: number | null
    readonly currency: string
  }[]
  readonly openDisputes: number
}

/** The payments of one night as the page draws them. */
export interface PaymentsView {
  readonly day: string
  readonly full: boolean
  readonly counts: NightPayments['counts']
  /** Section 1's rows for payments: the same row and answer as Tonight's. */
  readonly fix: readonly ActionRow[]
  /** A payment charged with no receipt number: a line, no answer. */
  readonly noReceipt: readonly {
    readonly paymentId: string
    readonly table: string
    readonly numbered: boolean
  }[]
  /** Paper receipts never marked Brought (#200): a line with the payment number, no answer. */
  readonly notBrought: readonly {
    readonly paymentId: string
    readonly paymentNumber: string
    readonly table: string
    readonly numbered: boolean
  }[]
  readonly rows: readonly PaymentRowView[]
  readonly hasMore: boolean
  readonly paying: NightPayments['paying']
  readonly money: MoneySectionsView | null
}

const FIX_VARIANT = {
  unconfirmed: 'question',
  capture_failed: 'capture_failed',
  stranded: 'stuck',
  expired: 'hold_expired',
} as const

const FIX_KIND = {
  question: 'pay',
  capture_failed: 'failed',
  stuck: 'stuck',
  hold_expired: 'failed',
} as const

function payFixRow(fix: NightPayFix, timezone: string): ActionRow | null {
  if (fix.problem === 'no_receipt') return null
  const variant = FIX_VARIANT[fix.problem]
  const { payment } = fix
  return {
    id: fix.alert?.id ?? payment.id,
    kind: FIX_KIND[variant],
    tableId: payment.tableId,
    table: payment.table,
    numbered: payment.numbered,
    at: (fix.alert?.raisedAt ?? payment.at).toISOString(),
    money: {
      variant,
      alertId: fix.alert?.id ?? '',
      paymentId: payment.id,
      question: fix.question,
      amountMinor: payment.amountMinor,
      reference: payment.reference,
      holdUntil: variant === 'question' ? holdOf(payment.captureBefore, timezone) : null,
      holdAt: variant === 'question' ? (payment.captureBefore?.getTime() ?? null) : null,
      earlier: null,
      charged: false,
    },
  }
}

export function paymentsView(read: NightPayments, timezone: string): PaymentsView {
  const clock = clockIn(timezone)
  return {
    day: read.day,
    full: read.full,
    counts: read.counts,
    fix: read.fix.flatMap((fix) => {
      const row = payFixRow(fix, timezone)
      return row === null ? [] : [row]
    }),
    noReceipt: read.fix
      .filter((fix) => fix.problem === 'no_receipt')
      .map((fix) => ({
        paymentId: fix.payment.id,
        table: fix.payment.table,
        numbered: fix.payment.numbered,
      })),
    notBrought: read.notBrought.map((entry) => ({
      paymentId: entry.paymentId,
      paymentNumber: entry.paymentNumber,
      table: entry.name ?? entry.number ?? '',
      numbered: entry.name === null && entry.number !== null,
    })),
    rows: read.rows.map((row) => paymentRowView(row, clock)),
    hasMore: read.hasMore,
    paying: read.paying,
    money:
      read.money === null
        ? null
        : {
            alerts: read.money.alerts.flatMap((alert): MoneyAlertView[] => {
              const variant = MONEY_VARIANT[alert.kind]
              if (variant === undefined) return []
              return [
                {
                  alertId: alert.alertId,
                  variant,
                  linesNotBack: alert.kind === 'payment_lines_not_back',
                  table: alert.table,
                  numbered: alert.numbered,
                  answer:
                    alert.answer === null
                      ? null
                      : {
                          code: alert.answer.code,
                          by: whoView(alert.answer.who, alert.answer.via),
                          time: clock(alert.answer.at) ?? '',
                        },
                },
              ]
            }),
            refunds: read.money.refunds,
            disputes: read.money.disputes.rows,
            openDisputes: read.money.disputes.openCount,
          },
  }
}

/** The release reasons on a page that have no word: reported by the loader, never shown raw. */
export function reasonsWithoutWord(
  rows: readonly { readonly state: string; readonly reason: string | null }[],
  words: Readonly<Record<string, string>>,
): string[] {
  return [
    ...new Set(
      rows.flatMap((row) =>
        row.state === 'released' && row.reason !== null && words[row.reason] === undefined
          ? [row.reason]
          : [],
      ),
    ),
  ]
}

/** One payment for its sheet (the Log's and the end of the night's). */
export interface PaymentDetailView {
  readonly row: PaymentRowView
  /** The number the guest shows the waiter on the Paid screen. */
  readonly number: string
  readonly lines: readonly {
    readonly name: string
    readonly quantity: string
    readonly amountMinor: number
  }[]
  readonly steps: readonly {
    readonly time: string
    readonly kind: 'payment.state' | 'payment.answered'
    readonly state: string | null
    readonly reason: string | null
    readonly by: WhoView
  }[]
}

export function paymentDetailView(detail: PaymentDetail, timezone: string): PaymentDetailView {
  const clock = clockIn(timezone)
  return {
    row: paymentRowView(detail.payment, clock),
    number: detail.number,
    lines: detail.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      amountMinor: line.amountMinor,
    })),
    steps: detail.steps.map((step) => ({
      time: clock(step.at) ?? '',
      kind: step.kind,
      state: step.toState,
      reason: step.reason,
      by: whoView(step.who, step.via),
    })),
  }
}
