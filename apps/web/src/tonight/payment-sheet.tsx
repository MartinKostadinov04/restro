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
import type { Frame } from '@/server/tonight/night-view'
import { paymentDetailAction } from '@/server/tonight/payment-actions'
import type { PaymentDetailView } from '@/server/tonight/payment-view'

import { useMoney } from './money'
import { PAYMENT_ANSWER_WORDS, PAYMENT_STATE_WORDS, releaseReasonWord } from './payment-state-words'
import { useTableName } from './table-name'
import { useWho } from './who'

function Body({ detail, frame }: { detail: PaymentDetailView; frame: Frame }) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const who = useWho()
  const { row } = detail
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
              <li key={index} className="flex justify-between gap-3 [overflow-wrap:anywhere]">
                <span>
                  {Number(line.quantity)} × {line.name}
                </span>
                <span className="shrink-0 tabular-nums">
                  {money(line.amountMinor, frame.currency)}
                </span>
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
  onClose,
}: {
  frame: Frame
  paymentId: string
  onClose: () => void
}) {
  const t = useTranslations('tonight')
  const isMobile = useIsMobile()
  const tableName = useTableName()
  // undefined while loading; null when the payment is not this venue's.
  const [detail, setDetail] = useState<PaymentDetailView | null | undefined>(undefined)

  const load = useCallback(() => {
    void paymentDetailAction({ venueId: frame.venueId, paymentId }).then((result) =>
      setDetail(result.ok ? result.detail : null),
    )
  }, [frame.venueId, paymentId])
  useEffect(() => load(), [load])

  const title = detail
    ? t('py_title', { table: tableName(detail.row.table, detail.row.numbered) })
    : t('loading')
  const sub = detail ? t('py_number', { ref: paymentId.slice(-6).toUpperCase() }) : ''
  const body = detail ? <Body detail={detail} frame={frame} /> : null
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
