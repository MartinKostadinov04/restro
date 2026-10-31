'use client'

// The payment parts of the end of the night (#115; plan `2026-10-27-tonight-end-of-night-plan.md` §3
// and the paying plan): the money rows of "To fix", section 3 (payments), 4 (money alerts and their
// answers), 5 (refunds and stornos), 6 (disputes) and the money totals. Each is a node
// `night-slots-part2.tsx` hands the page, drawn inside its run provider so the answers on the rows
// are the same as on Tonight (money-rows.tsx). Staff see section 3 without tips; sections 4–6 and
// the totals are for managers and owners only.
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { WRAPS } from '@/lib/wrapping'
import type { Frame, NightView } from '@/server/tonight/night-view'
import { nightPaymentsAction } from '@/server/tonight/payment-actions'
import type {
  MoneyAlertView,
  MoneySectionsView,
  PaymentRowView,
  PaymentsView,
} from '@/server/tonight/payment-view'

import { ActionRowItem } from './action-rows'
import { useDateText } from './day-picker'
import { useMoney } from './money'
import { variantTitleKey } from './money-rows'
import { PAGE } from './pages'
import { PaymentSheet } from './payment-sheet'
import { PAYMENT_ANSWER_WORDS, PAYMENT_STATE_WORDS, releaseReasonWord } from './payment-state-words'
import { FailedBlock } from './tab-parts'
import { useTableName } from './table-name'
import { useWho } from './who'

function clockAt(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(iso))
}

/**
 * The segments of a `a · b · c` template whose values are all there: "{table} · paid at {payTable} ·
 * {bar} · receipt {rcpt}" for a payment with no bar and no receipt number yet reads
 * "Table 7 · paid at Pay 1".
 */
export function joinedMeta(raw: string, values: Readonly<Record<string, string | null>>): string {
  return raw
    .split(' · ')
    .flatMap((segment) => {
      const names = [...segment.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '')
      if (names.some((name) => (values[name] ?? '') === '')) return []
      return [segment.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')]
    })
    .join(' · ')
}

/** The rows of "To fix" that come from payments: the money rows, and two plain lines. */
export function NightPayFixRows({
  payments,
  frame,
  today,
}: {
  payments: PaymentsView
  frame: Frame
  /** The night is still running: a row shows no clock time, as the sent orders' rows. */
  today: boolean
}) {
  const t = useTranslations('tonight')
  const tableName = useTableName()
  return (
    <>
      {payments.fix.map((row) => (
        <ActionRowItem
          key={row.id}
          row={row}
          view={frame}
          primary={false}
          ago={today ? '' : clockAt(row.at, frame.timezone)}
        />
      ))}
      {payments.noReceipt.map((entry) => (
        <li
          key={entry.paymentId}
          className="rounded-lg border bg-card p-4 text-sm"
          data-testid="night-fix-norcpt"
        >
          {t('nt_fix_pay', {
            table: tableName(entry.table, entry.numbered),
            // The payment number joins the line so it reads as the same payment as its "receipt not
            // brought" line, in words that already exist.
            what: `${t('nt_fix_norcpt')} · ${t('py_number', { ref: entry.paymentNumber })}`,
          })}
        </li>
      ))}
      {payments.notBrought.map((entry) => (
        <li
          key={entry.paymentId}
          className="rounded-lg border bg-card p-4 text-sm"
          data-testid="night-fix-notbrought"
        >
          {t('nt_fix_pay', {
            table: tableName(entry.table, entry.numbered),
            what: t('nt_fix_notbrought', { n: entry.paymentNumber }),
          })}
        </li>
      ))}
      {payments.stornoFix.map((entry) => (
        <li
          key={entry.refundId}
          className="rounded-lg border bg-card p-4 text-sm"
          data-testid="night-fix-storno"
        >
          {t('nt_fix_pay', {
            table: tableName(entry.table, entry.numbered),
            what: `${t('nt_fix_storno')} · ${t('py_number', { ref: entry.paymentNumber })}`,
          })}
        </li>
      ))}
      {payments.paying === null ? null : (
        <li
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 text-sm"
          data-testid="night-fix-paying"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{t('nt_fix_paused')}</span>
          {payments.paying !== 'paused' && frame.canConnect ? (
            <Button asChild variant="outline" className={WRAPS}>
              <Link href={`/venues/${frame.venueId}?tab=settings&section=paying`}>
                {t('pb_reconnect')}
              </Link>
            </Button>
          ) : null}
        </li>
      )}
    </>
  )
}

function PaymentLine({ row, onOpen }: { row: PaymentRowView; onOpen: (id: string) => void }) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const tableName = useTableName()
  const name = tableName(row.table, row.numbered)
  const stateKey = PAYMENT_STATE_WORDS[row.state]
  const reason = releaseReasonWord((key, values) => t(key, values), row.reason)
  const state = stateKey === undefined ? '' : t(stateKey)
  const head =
    row.amountMinor === null || stateKey === undefined
      ? t('lg_pay_plain', { table: name })
      : t('lg_pay_state', {
          table: name,
          amount: money(row.amountMinor, row.currency),
          state: reason === null || row.state !== 'released' ? state : `${state} (${reason})`,
        })
  const meta = joinedMeta(t.raw('nt_pay_meta'), {
    table: name,
    payTable: row.payTable,
    bar: row.bar,
    rcpt: row.receiptNumber,
  })
  const tip =
    row.tipMinor === null || row.tipMinor === 0
      ? null
      : t('nt_pay_tip', { tip: money(row.tipMinor, row.currency) })
  return (
    <li>
      <button
        type="button"
        className="flex min-h-14 w-full flex-col items-start gap-0.5 p-3 text-left text-sm hover:bg-muted/50"
        data-testid="night-pay-row"
        data-state={row.state}
        onClick={() => onOpen(row.id)}
      >
        <span className="[overflow-wrap:anywhere]">{head}</span>
        <span className="text-muted-foreground [overflow-wrap:anywhere]">
          {tip === null ? meta : `${meta} · ${tip}`}
        </span>
      </button>
    </li>
  )
}

/** Section 3: the night's payments, the ones that did not end charged first. */
export function NightPaymentsList({ initial, frame }: { initial: PaymentsView; frame: Frame }) {
  const t = useTranslations('tonight')
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState<{
    limit: number
    view: PaymentsView | null
    failed: boolean
  } | null>(null)
  const limit = all?.limit
  const day = initial.day
  useEffect(() => {
    if (limit === undefined) return
    let live = true
    void nightPaymentsAction({ venueId: frame.venueId, day, all: limit }).then((result) => {
      if (!live) return
      setAll((before) =>
        before === null
          ? before
          : result.ok
            ? { ...before, view: result.payments, failed: false }
            : { ...before, failed: true },
      )
    })
    return () => {
      live = false
    }
  }, [limit, day, frame.venueId])

  const { counts } = initial
  const rows = all?.view?.rows ?? initial.rows
  return (
    <div className="space-y-3">
      {counts.all === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="night-pay-none">
          {t('nt_pay_none')}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="night-pay-summary">
          {t('nt_pay_sum', {
            n: counts.all,
            c: counts.captured,
            r: counts.released,
            u: counts.unconfirmed,
          })}
        </p>
      )}
      {all?.failed ? <FailedBlock text={t('so_fail')} /> : null}
      {rows.length === 0 ? null : (
        <ul className="divide-y rounded-lg border" data-testid="night-pay-list">
          {rows.map((row) => (
            <PaymentLine key={row.id} row={row} onOpen={setOpen} />
          ))}
        </ul>
      )}
      {all === null && counts.all > initial.rows.length ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          data-testid="night-pay-show-all"
          onClick={() => setAll({ limit: PAGE, view: null, failed: false })}
        >
          {t('nt_show_all', { n: counts.all })}
        </Button>
      ) : null}
      {all?.view?.hasMore ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => setAll({ ...all, limit: all.limit + PAGE })}
        >
          {t('so_earlier')}
        </Button>
      ) : null}
      {open === null ? null : (
        <PaymentSheet frame={frame} paymentId={open} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}

/** The word of the answer to a money alert: a payment answer, "Seen" for an acknowledgement. */
function useAnswerWord() {
  const t = useTranslations('tonight')
  return (alert: MoneyAlertView, code: string) => {
    const key = PAYMENT_ANSWER_WORDS[code]
    if (key !== undefined) return t(key)
    return t(alert.variant === 'stuck' ? 'ms_ok' : alert.variant === 'stopped' ? 'mc_ok' : 'mf_ok')
  }
}

/** Section 4: who answered what, and when. */
export function NightMoneyAlerts({ alerts }: { alerts: readonly MoneyAlertView[] }) {
  const t = useTranslations('tonight')
  const who = useWho()
  const tableName = useTableName()
  const answerWord = useAnswerWord()
  return (
    <ul className="divide-y rounded-lg border" data-testid="night-malerts-list">
      {alerts.map((alert) => {
        const title = t(variantTitleKey(alert.variant, alert.linesNotBack))
        return (
          <li key={alert.alertId} className="space-y-0.5 p-3 text-sm">
            <span className="block [overflow-wrap:anywhere]">
              {alert.answer === null
                ? `${title} · ${t('nt_ma_open')}`
                : t('nt_ma_row', {
                    alert: title,
                    answer: answerWord(alert, alert.answer.code),
                    who: who(alert.answer.by),
                    time: alert.answer.time,
                  })}
            </span>
            <span className="block text-muted-foreground">
              {t('py_title', { table: tableName(alert.table, alert.numbered) })}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Section 5: the refunds the venue made at its provider, as `payment.observe` read them back, with
 * who made the storno and when; then every refund of an earlier night still waiting for one
 * (#222). Each row opens the payment's sheet.
 */
export function NightRefunds({
  refunds,
  frame,
  provider,
}: {
  refunds: MoneySectionsView['refunds']
  frame: Frame
  provider: string | null
}) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const tableName = useTableName()
  const who = useWho()
  const [open, setOpen] = useState<string | null>(null)
  if (refunds.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('nt_rf_none')}</p>
  }
  return (
    <>
      <ul className="divide-y rounded-lg border" data-testid="night-refunds-list">
        {refunds.map((refund) => {
          const failedText = t('py_refund_failed', { provider: provider ?? t('pb_provider_none') })
          // A failed refund a manager saw says so, and who (#234), as "Storno done" does.
          const state = refund.failed
            ? refund.seen === null
              ? failedText
              : `${failedText} · ${t('lg_pay_refund_seen')} · ${who(refund.seen.by)}, ${refund.seen.time}`
            : refund.storno === null
              ? t('nt_fix_storno')
              : t('py_storno', { who: who(refund.storno.by), time: refund.storno.time })
          return (
            <li key={refund.refundId} className="p-3 text-sm">
              <button
                type="button"
                className="min-h-11 w-full text-left [overflow-wrap:anywhere]"
                data-testid="night-refund"
                onClick={() => setOpen(refund.paymentId)}
              >
                {joinedMeta(t.raw('nt_rf_row'), {
                  table: tableName(refund.table, refund.numbered),
                  rcpt: refund.receiptNumber,
                  amt: money(refund.amountMinor, refund.currency),
                  storno: state,
                })}
              </button>
            </li>
          )
        })}
      </ul>
      {open === null ? null : (
        <PaymentSheet frame={frame} paymentId={open} onClose={() => setOpen(null)} />
      )}
    </>
  )
}

/**
 * Section 6: the disputes opened on the night's payments, each with its answer-by date, and how
 * many are still open (#222). Each row opens the payment's sheet and its evidence.
 */
export function NightDisputes({
  day,
  openCount,
  disputes,
  frame,
  provider,
}: {
  day: string
  openCount: number
  disputes: MoneySectionsView['disputes']
  frame: Frame
  provider: string | null
}) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const tableName = useTableName()
  const dateText = useDateText()
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border" data-testid="night-disputes-list">
        {disputes.map((dispute) => (
          <li key={dispute.paymentId} className="p-3 text-sm">
            <button
              type="button"
              className="min-h-11 w-full space-y-0.5 text-left"
              data-testid="night-dispute"
              onClick={() => setOpen(dispute.paymentId)}
            >
              <span className="block font-medium">{t('d_t')}</span>
              <span className="block text-muted-foreground [overflow-wrap:anywhere]">
                {t('d_d', {
                  amt: money(dispute.amountMinor ?? 0, dispute.currency),
                  table: tableName(dispute.table, dispute.numbered),
                  date: dateText(dispute.serviceDate || day),
                })}
              </span>
              {dispute.state === 'open' && dispute.due !== null ? (
                <span className="block [overflow-wrap:anywhere]">
                  {t('d_due', {
                    provider: provider ?? t('pb_provider_none'),
                    date: dateText(dispute.due.date),
                  })}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {openCount === 0 ? null : (
        <p className="text-sm text-muted-foreground" data-testid="night-disputes-open">
          {t('nt_d_open', { n: openCount })}
        </p>
      )}
      {open === null ? null : (
        <PaymentSheet frame={frame} paymentId={open} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}

/** The money rows of "Totals": `money.follow_up` only. */
export function NightMoneyTotals({
  money: totals,
  currency,
}: {
  money: NonNullable<NightView['money']>
  currency: string
}) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const rows: [string, string][] = [
    [t('nt_t_payments'), String(totals.payments)],
    [t('nt_t_captured'), money(totals.capturedMinor, currency)],
    [t('nt_t_tips'), money(totals.tipMinor, currency)],
    [t('nt_t_unconf_pay'), String(totals.paymentsUnconfirmed)],
    [t('nt_t_unconf_amt'), money(totals.unconfirmedMinor, currency)],
  ]
  return (
    <>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 p-3 text-sm">
          <dt className="min-w-0 [overflow-wrap:anywhere]">{label}</dt>
          <dd className="shrink-0 font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </>
  )
}
