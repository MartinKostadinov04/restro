'use client'

// One payment, everything about it (#115; Patterns: "Everything about one thing"): a side sheet on
// the tablet, a bottom drawer on a phone, opened from the Log or from the end of the night. Its
// table and number, the total (and the tip, for those who see tips), the items and the steps it went
// through with who gave each answer. It reads; the answer to a payment question is on its row
// (money-rows.tsx), never here. Closes with Close or Esc; nothing is lost by closing.
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { notServedAction } from '@/server/tonight/actions'
import type { Frame } from '@/server/tonight/night-view'
import { paymentDetailAction } from '@/server/tonight/payment-actions'
import type { PaymentDetailView } from '@/server/tonight/payment-view'

import { useDateText } from './day-picker'
import { DisputeEvidence } from './dispute-evidence'
import { useMoney } from './money'
import { PAYMENT_ANSWER_WORDS, PAYMENT_STATE_WORDS, releaseReasonWord } from './payment-state-words'
import { READ_FAILED, readAttempt } from './read-attempt'
import { useOptionalTonightRun } from './run'
import { ReadFailed } from './tab-parts'
import { useTableName } from './table-name'
import { useWho } from './who'

/**
 * What the sheet needs of the screen: `can` and `device` decide whether "Not served" is offered and
 * whether the person's PIN is asked (a shared device); a caller that gives neither shows none.
 */
type SheetFrame = Pick<Frame, 'venueId' | 'currency'> & Partial<Pick<Frame, 'can' | 'device'>>

/**
 * "Not served" on a paid line (the 11-18 refund decision, 148): the line's refund is asked once and
 * its state is told in the words of what is true: "being sent" until the provider's list shows it,
 * then "refunded" (D72: no local success). A person on their own phone confirms in the sheet; a
 * shared device asks the person's own PIN, which is the confirmation.
 */
function NotServed({
  detail,
  line,
  frame,
  onChanged,
}: {
  detail: PaymentDetailView
  line: PaymentDetailView['lines'][number]
  frame: SheetFrame
  onChanged: () => void
}) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const runner = useOptionalTonightRun()
  const [confirming, setConfirming] = useState(false)
  const { refund, position, closedMinor } = line
  if (refund?.state === 'sending')
    return <span className="text-muted-foreground">{t('py_refund_sending')}</span>
  if (refund?.state === 'refunded') {
    return (
      <span className="text-muted-foreground">
        {t('py_refund_done', { amt: money(refund.amountMinor, frame.currency) })}
      </span>
    )
  }
  const failed = refund?.state === 'failed'
  const offered =
    runner !== null &&
    frame.can?.answer === true &&
    detail.row.state === 'captured' &&
    detail.refundRouteOff !== true &&
    position !== undefined &&
    closedMinor !== undefined &&
    closedMinor !== null
  if (!offered) {
    return failed ? <span className="text-destructive">{t('py_refund_none')}</span> : null
  }
  const amt = money(closedMinor, frame.currency)
  const ask = () => {
    runner.run({
      id: `refund:${detail.row.id}:${position}`,
      ...(frame.device === true
        ? {
            pin: {
              level: 'own' as const,
              title: t('py_not_served_title'),
              body: t('py_not_served_body', { qty: Number(line.quantity), name: line.name, amt }),
              // Money goes back on this tap: the sheet confirms it, a remembered person or not.
              confirm: true,
            },
          }
        : {}),
      act: async (pin) => {
        const result = await notServedAction({
          venueId: frame.venueId,
          paymentId: detail.row.id,
          position,
          pin,
        })
        onChanged()
        return result
      },
      done: t('py_refund_sending'),
    })
    setConfirming(false)
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {failed ? <span className="text-destructive">{t('py_refund_none')}</span> : null}
      {confirming && frame.device !== true ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={ask}
            data-testid="not-served-yes"
          >
            {t('py_not_served_yes', { amt })}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)}>
            {t('py_not_served_no')}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={frame.device === true ? ask : () => setConfirming(true)}
          data-testid="not-served"
        >
          {t('py_not_served')}
        </Button>
      )}
    </span>
  )
}

function Body({
  detail,
  frame,
  onChanged,
}: {
  detail: PaymentDetailView
  frame: SheetFrame
  onChanged: () => void
}) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const who = useWho()
  const dateText = useDateText()
  const { row } = detail
  const provider = detail.provider ?? t('pb_provider_none')
  // What the venue refunded at the provider, not counting a refund that did not go through.
  const refundedMinor = detail.refunds.reduce(
    (total, refund) => (refund.failed ? total : total + refund.amountMinor),
    0,
  )
  const say = (key: string, values?: Record<string, string | number>) => t(key, values)
  const stateKey = PAYMENT_STATE_WORDS[row.state]
  const reason = releaseReasonWord(say, row.reason)

  return (
    <div className="space-y-4 overflow-y-auto px-4 text-sm" data-testid="payment-sheet-body">
      <p className="text-base font-medium [overflow-wrap:anywhere]">
        {stateKey === undefined ? null : t(stateKey)}
        {reason === null ? null : (
          <span className="font-normal text-muted-foreground">
            {' · '}
            {reason}
          </span>
        )}
      </p>
      {detail.lines.length === 0 ? null : (
        <section className="space-y-1">
          <h3 className="font-medium">{t('py_lines')}</h3>
          <ul className="space-y-1" data-testid="payment-lines">
            {detail.lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a fixed list
              <li key={index} className="space-y-1 [overflow-wrap:anywhere]">
                <div className="flex justify-between gap-3">
                  <span>
                    {Number(line.quantity)} × {line.name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {money(line.amountMinor, frame.currency)}
                  </span>
                </div>
                <div className="flex justify-end text-xs" data-testid="payment-line-refund">
                  <NotServed detail={detail} line={line} frame={frame} onChanged={onChanged} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {row.tipMinor === null || row.tipMinor === 0 ? null : (
        <p className="flex justify-between gap-3 tabular-nums">
          <span>{t('py_tip')}</span>
          <span>{money(row.tipMinor, row.currency)}</span>
        </p>
      )}
      {row.amountMinor === null ? null : (
        <p className="flex justify-between gap-3 font-medium tabular-nums">
          <span>{t('py_total')}</span>
          <span>{money(row.amountMinor, row.currency)}</span>
        </p>
      )}
      {detail.refunds.length === 0 ? null : (
        <section className="space-y-1" data-testid="payment-refunds">
          {refundedMinor === 0 ? null : (
            <p className="font-medium">
              {row.amountMinor !== null && refundedMinor < row.amountMinor
                ? t('py_refunded_part', {
                    amt: money(refundedMinor, row.currency),
                    total: money(row.amountMinor, row.currency),
                  })
                : t('py_refunded', { amt: money(refundedMinor, row.currency) })}
            </p>
          )}
          <ul className="space-y-1 text-muted-foreground">
            {detail.refunds.map((refund, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the refunds of a fixed list
              <li key={index} className="[overflow-wrap:anywhere]">
                <span className="tabular-nums">{refund.time}</span>
                {' · '}
                {money(refund.amountMinor, row.currency)}
                {' · '}
                {refund.failed
                  ? t('py_refund_failed', { provider })
                  : refund.sending
                    ? t('py_refund_sending')
                    : refund.storno === null
                      ? t('nt_fix_storno')
                      : t('py_storno', { who: who(refund.storno.by), time: refund.storno.time })}
                {refund.requestedBy === null || refund.requestedBy === undefined
                  ? null
                  : ` · ${t('py_not_served')}: ${who(refund.requestedBy)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {detail.dispute === null ? null : (
        <section className="space-y-1" data-testid="payment-dispute">
          <p className="font-medium">
            {detail.dispute.state === 'won'
              ? t('d_won')
              : detail.dispute.state === 'lost'
                ? t('d_lost')
                : t('py_disputed')}
          </p>
          {detail.dispute.state === 'open' && detail.dispute.due !== null ? (
            <p className="text-muted-foreground">
              {t('d_due', { provider, date: dateText(detail.dispute.due.date) })}
            </p>
          ) : null}
        </section>
      )}
      {detail.evidence === null ? null : (
        <DisputeEvidence evidence={detail.evidence} provider={detail.provider} />
      )}
      {detail.steps.length === 0 ? null : (
        <section className="space-y-1">
          <h3 className="font-medium">{t('py_steps')}</h3>
          <ul className="space-y-1 text-muted-foreground" data-testid="payment-steps">
            {detail.steps.map((step, index) => {
              const answerKey = step.reason === null ? undefined : PAYMENT_ANSWER_WORDS[step.reason]
              const stateWord = step.state === null ? undefined : PAYMENT_STATE_WORDS[step.state]
              const reasonWord = releaseReasonWord(say, step.reason)
              const words =
                step.kind === 'payment.answered'
                  ? answerKey === undefined
                    ? null
                    : t(answerKey)
                  : stateWord === undefined
                    ? null
                    : `${t(stateWord)}${reasonWord === null ? '' : ` (${reasonWord})`}`
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: the steps of a fixed list
                <li key={index} className="[overflow-wrap:anywhere]">
                  <span className="tabular-nums">{step.time}</span>
                  {' · '}
                  {words === null ? null : `${words} · `}
                  {who(step.by)}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

export function PaymentSheet({
  frame,
  paymentId,
  loaded,
  onClose,
}: {
  frame: SheetFrame
  paymentId: string
  /** The payment as already read, with a manager's PIN on a shared device (RR-58). */
  loaded?: PaymentDetailView
  onClose: () => void
}) {
  const t = useTranslations('tonight')
  const isMobile = useIsMobile()
  const tableName = useTableName()
  // undefined while loading; null when the payment is not this venue's.
  const [detail, setDetail] = useState<PaymentDetailView | null | undefined>(loaded)

  // The read never got an answer (no connection): a retry line, not a sheet that loads for ever.
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    void readAttempt(() => paymentDetailAction({ venueId: frame.venueId, paymentId })).then(
      (result) => {
        if (result === READ_FAILED) setFailed(true)
        else setDetail(result.ok ? result.detail : null)
      },
    )
  }, [frame.venueId, paymentId])
  useEffect(() => {
    if (loaded === undefined) load()
  }, [load, loaded])

  const title = detail
    ? t('py_title', { table: tableName(detail.row.table, detail.row.numbered) })
    : failed
      ? t('sh_fail_t')
      : t('loading')
  const sub = detail ? t('py_number', { ref: detail.number }) : ''
  const body = detail ? (
    <Body detail={detail} frame={frame} onChanged={load} />
  ) : failed ? (
    <ReadFailed onRetry={load} />
  ) : null
  const close = (
    <Button type="button" variant="outline" className="h-12" onClick={onClose}>
      {t('close')}
    </Button>
  )

  return isMobile ? (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent data-testid="payment-sheet" aria-busy={detail === undefined}>
        <DrawerHeader>
          <DrawerTitle className="[overflow-wrap:anywhere]">{title}</DrawerTitle>
          <DrawerDescription>{sub}</DrawerDescription>
        </DrawerHeader>
        {body}
        <DrawerFooter>{close}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  ) : (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent data-testid="payment-sheet" aria-busy={detail === undefined}>
        <SheetHeader>
          <SheetTitle className="[overflow-wrap:anywhere]">{title}</SheetTitle>
          <SheetDescription>{sub}</SheetDescription>
        </SheetHeader>
        {body}
        <SheetFooter>{close}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
