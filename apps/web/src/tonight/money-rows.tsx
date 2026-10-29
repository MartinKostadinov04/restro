'use client'

// The money rows of "Needs you" (#115; paying plan `docs/deliverables/2026-10-29-tonight-paying-plan.md`):
// a payment question (two answers at equal weight, both outline), the alerts that only need
// acknowledging (one outline button), and who sees and answers what. A shared device asks a
// manager's PIN for money and the person's own for items stuck and stopped payments; a personal
// phone taps once with the right and sees no button without it, only the line "A manager or owner
// answers this." for a payment question (never a disabled button). The PIN sheet names the
// consequence and is the confirmation: no Undo for an answer that moves money.
import { CreditCardIcon, PackageSearchIcon, TriangleAlertIcon, WalletCardsIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { answerPaymentAction, doneAlertAction } from '@/server/tonight/actions'
import type { ActionRow, MoneyRow, RowKind, TonightView } from '@/server/tonight/view'

import { useDateText } from './day-picker'
import { useMoney } from './money'
import { useTonightRun } from './run'

/** What a money row needs of the screen: the same on the end-of-night page. */
export type MoneyFrame = Pick<TonightView, 'venueId' | 'source' | 'currency' | 'device' | 'can'> & {
  readonly provider?: string | null
}

/** The icon and chip colour of each money row kind: red only for money held on a guest's card. */
export const MONEY_ICONS = {
  pay: { Icon: CreditCardIcon, red: true },
  failed: { Icon: WalletCardsIcon, red: false },
  stuck: { Icon: PackageSearchIcon, red: false },
  stopped: { Icon: TriangleAlertIcon, red: false },
} as const satisfies Partial<Record<RowKind, unknown>>

/** The title a money row announces and shows (`m_t`, `ms_t`, …). */
export function moneyTitleKey(money: MoneyRow): string {
  return variantTitleKey(money.variant, money.question === 'lines_not_back')
}

/** The title of a kind of money row; the second question (items not back) has its own. */
export function variantTitleKey(variant: MoneyRow['variant'], linesNotBack: boolean): string {
  switch (variant) {
    case 'question':
      return linesNotBack ? 'm_lnb_t' : 'm_t'
    case 'stuck':
      return 'ms_t'
    case 'stopped':
      return 'mc_t'
    case 'capture_failed':
      return 'mf_t'
    case 'hold_expired':
      return 'mh_t'
    case 'release_refused':
      return 'mr_t'
  }
}

const BUTTON = 'h-12 min-w-32 whitespace-normal'

/** The answer words of a payment question, by what it asks: the receipt's or the till's. */
const QUESTION_WORDS = {
  close: {
    ok: 'receipt_printed',
    no: 'no_receipt',
    okLabel: 'm_ok',
    noLabel: 'm_no',
    okBody: 'm_ok_b',
    noBody: 'm_no_b',
    okToast: 'm_ok_toast',
    noToast: 'm_no_toast',
  },
  lines_not_back: {
    ok: 'receipt_printed',
    no: 'no_receipt',
    okLabel: 'm_ok',
    noLabel: 'm_no',
    okBody: 'm_ok_b',
    noBody: 'm_lnb_no_b',
    okToast: 'm_ok_toast',
    noToast: 'm_no_toast',
  },
  till: {
    ok: 'on_till',
    no: 'not_on_till',
    okLabel: 'm_till_ok',
    noLabel: 'm_till_no',
    okBody: 'm_till_ok_b',
    noBody: 'm_till_no_b',
    okToast: 'm_till_ok_toast',
    noToast: 'm_no_toast',
  },
} as const

/** The acknowledgement each single-button money row has. */
const ACK = {
  stuck: { label: 'ms_ok', toast: 'ms_toast', pin: 'own' },
  stopped: { label: 'mc_ok', toast: 'mc_toast', pin: 'own' },
  capture_failed: { label: 'mf_ok', toast: 'mf_toast', pin: 'manager' },
  hold_expired: { label: 'mf_ok', toast: 'mf_toast', pin: 'manager' },
  release_refused: { label: 'mf_ok', toast: 'mf_toast', pin: 'manager' },
} as const

/** What a money row draws beside the shared row frame: its title, its body and its answer. */
export function useMoneyRowParts(
  row: ActionRow,
  view: MoneyFrame,
  name: string,
): { title: string; body: ReactNode; answer: ReactNode } | null {
  const t = useTranslations('tonight')
  const money = useMoney()
  const dateText = useDateText()
  const router = useRouter()
  const { run, busy } = useTonightRun()
  const m = row.money
  if (m === undefined) return null

  const amt = money(m.amountMinor ?? 0, view.currency)
  // The confirmation tells who confirms what the card really bears, tip included (Martin 10-29);
  // the row itself keeps the staff amount.
  const charge = m.chargeMinor === null ? amt : money(m.chargeMinor, view.currency)
  const title = t(moneyTitleKey(m))
  const earlier = m.earlier === null ? null : t('m_earlier', { date: dateText(m.earlier) })

  if (m.variant === 'question') {
    const words = QUESTION_WORDS[m.question ?? 'close']
    // The table first: a manager must know which one the question is about.
    const meta = [
      name,
      m.question === 'till' && m.reference !== null ? t('m_pf_meta', { ref: m.reference }) : null,
      t('m_tag', { amt }),
      m.holdUntil === null
        ? null
        : t('m_hold_until', { date: dateText(m.holdUntil.date), time: m.holdUntil.time }),
      earlier,
    ].filter((part): part is string => part !== null)
    const asking =
      m.question === 'till'
        ? t('m_q_till', { source: view.source })
        : m.question === 'lines_not_back'
          ? t('m_lnb_q')
          : t('m_q')
    const body = (
      <div className="space-y-1 text-sm">
        <p className="text-muted-foreground">{meta.join(' · ')}</p>
        <p className="font-medium">{asking}</p>
      </div>
    )
    // Only a manager or owner answers: with the right on a personal phone, one tap; on the shared
    // tablet behind a manager's PIN; a waiter's own phone sees the question and who answers it.
    if (!view.can.followUp && !view.device) {
      return {
        title,
        body: (
          <>
            {body}
            <p className="text-sm text-muted-foreground" data-testid="money-who">
              {t('m_who')}
            </p>
          </>
        ),
        answer: null,
      }
    }
    const answering = m.question === 'lines_not_back' ? 'lines_not_back' : 'close'
    const choose = (choice: 'ok' | 'no') => {
      const key = choice === 'ok' ? words.ok : words.no
      run({
        id: `pay:${m.paymentId}`,
        ...(view.device
          ? {
              pin: {
                level: 'manager' as const,
                title: t(choice === 'ok' ? words.okLabel : words.noLabel),
                body: t(choice === 'ok' ? words.okBody : words.noBody, {
                  amt: charge,
                  table: name,
                  source: view.source,
                }),
              },
            }
          : {}),
        act: async (pin) => {
          const result = await answerPaymentAction({
            venueId: view.venueId,
            paymentId: m.paymentId,
            answering,
            answer: key,
            pin,
          })
          // The row leaves when its alert closes; a refusal (someone answered first) refreshes too.
          router.refresh()
          return result
        },
        done: t(choice === 'ok' ? words.okToast : words.noToast, { amt: charge }),
      })
    }
    return {
      title,
      body,
      answer: (
        <>
          <Button
            type="button"
            variant="outline"
            className={BUTTON}
            disabled={busy}
            onClick={() => choose('ok')}
          >
            {t(words.okLabel)}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={BUTTON}
            disabled={busy}
            onClick={() => choose('no')}
          >
            {t(words.noLabel)}
          </Button>
        </>
      ),
    }
  }

  const ack = ACK[m.variant]
  const description =
    m.variant === 'stuck'
      ? t('ms_d', { table: name, source: view.source })
      : m.variant === 'stopped'
        ? t('mc_d', { table: name })
        : m.variant === 'capture_failed'
          ? t('mf_d', { table: name, amt, source: view.source })
          : m.variant === 'hold_expired'
            ? t('mh_d', { table: name, amt, source: view.source })
            : m.charged
              ? t('mr_d_charged', {
                  table: name,
                  amt,
                  provider: view.provider ?? t('pb_provider_none'),
                })
              : t('mr_d', { table: name })
  const body = (
    <div className="space-y-1 text-sm">
      <p className="text-muted-foreground [overflow-wrap:anywhere]">{description}</p>
      {m.variant === 'capture_failed' ? (
        <>
          <p className="[overflow-wrap:anywhere]">{t('mf_storno')}</p>
          <p className="text-muted-foreground [overflow-wrap:anywhere]">{t('mf_gone')}</p>
        </>
      ) : null}
      {earlier === null ? null : <p className="text-muted-foreground">{earlier}</p>}
    </div>
  )
  const mayAck =
    m.alertId !== '' &&
    (ack.pin === 'own' ? view.can.answer || view.device : view.can.followUp || view.device)
  return {
    title,
    body,
    answer: mayAck ? (
      <Button
        type="button"
        variant="outline"
        className={BUTTON}
        disabled={busy}
        onClick={() =>
          run({
            id: `ack:${m.alertId}`,
            ...(view.device
              ? {
                  pin: {
                    level: ack.pin,
                    title: t(ack.label),
                    body: description,
                  },
                }
              : {}),
            act: async (pin) => {
              const result = await doneAlertAction({
                venueId: view.venueId,
                alertId: m.alertId,
                pin,
              })
              router.refresh()
              return result
            },
            done: t(ack.toast),
          })
        }
      >
        {t(ack.label)}
      </Button>
    ) : null,
  }
}
