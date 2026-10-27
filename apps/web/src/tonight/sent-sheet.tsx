'use client'

// One sent order, everything about it (sent-orders plan O4; Patterns: "Everything about one
// thing"): a side sheet on the tablet, a bottom drawer on a phone. Its items with options and
// notes, the total, the times, the reason it was not sent, who answered it, its steps from the
// Log and, for an Unconfirmed one, the same two answers as screen 1 (the PIN rule is the same).
// Closes with Close or Esc; nothing is lost by closing.
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
import { sentOrderDetailAction } from '@/server/tonight/night-actions'
import type { Frame, SentDetailView } from '@/server/tonight/night-view'

import { useMoney } from './money'
import { SentOrderAnswers } from './sent-order-answers'
import { useReasonWord, useStateWord } from './sent-row'
import { useTableName } from './table-name'
import { useWho } from './who'

function Body({
  detail,
  frame,
  onAnswered,
}: {
  detail: SentDetailView
  frame: Frame
  onAnswered: () => void
}) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const tableName = useTableName()
  const word = useStateWord()
  const reason = useReasonWord()
  const who = useWho()
  const { row } = detail
  const name = tableName(row.table, row.numbered)

  return (
    <div className="space-y-4 overflow-y-auto px-4 text-sm" data-testid="sent-sheet-body">
      <p className="text-base font-medium [overflow-wrap:anywhere]">
        {word(row.state, frame.source)}
        {row.reason === null ? null : (
          <span className="font-normal text-muted-foreground">
            {' · '}
            {reason(row.reason, frame.source)}
          </span>
        )}
      </p>
      {row.answer === null ? null : (
        <p className="text-muted-foreground">
          {t('so_answered', {
            answer: t(row.answer.answer === 'found' ? 's_ok' : 's_no'),
            who: who(row.answer.by),
          })}
        </p>
      )}
      {row.landedAt === null ? null : (
        <p className="text-muted-foreground">{t('so_found', { time: row.landedAt })}</p>
      )}
      <ul className="space-y-2">
        {detail.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a fixed list
          <li key={index} className="[overflow-wrap:anywhere]">
            <span className="font-medium">
              {line.qty} × {line.name}
            </span>
            {line.options.length === 0 ? null : (
              <span className="text-muted-foreground"> ({line.options.join(', ')})</span>
            )}
            {line.note === null ? null : (
              <span className="block text-muted-foreground">
                {t('sh_note', { note: line.note })}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="font-medium tabular-nums">
        {t('sh_total', { amt: money(row.totalMinor, frame.currency) })}
      </p>
      {detail.bill === null ? null : (
        <p className="text-muted-foreground [overflow-wrap:anywhere]">
          {t('sh_bill', { bill: detail.bill, source: frame.source })}
        </p>
      )}
      {detail.steps.length === 0 ? null : (
        <section className="space-y-1">
          <h3 className="font-medium">{t('sh_steps')}</h3>
          <ul className="space-y-1 text-muted-foreground" data-testid="sent-steps">
            {detail.steps.map((step, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the steps of a fixed list
              <li key={index} className="[overflow-wrap:anywhere]">
                <span className="tabular-nums">{step.time}</span>
                {' · '}
                {step.landedLate
                  ? t('so_found', { time: step.time })
                  : step.answer !== null
                    ? t('so_answered', {
                        answer: t(step.answer === 'found' ? 's_ok' : 's_no'),
                        who: who(step.by),
                      })
                    : `${step.state === null ? '' : word(step.state, frame.source)}${
                        step.reason === null ? '' : ` (${reason(step.reason, frame.source)})`
                      } · ${who(step.by)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {row.state === 'check' && row.answer === null ? (
        <section className="space-y-2" data-testid="sent-sheet-answers">
          <p className="font-medium">{t('s_q')}</p>
          <div className="flex flex-wrap gap-2">
            <SentOrderAnswers frame={frame} sentOrderId={row.id} table={name} onDone={onAnswered} />
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function SentOrderSheet({
  frame,
  sentOrderId,
  onClose,
  onChanged,
}: {
  frame: Frame
  sentOrderId: string
  onClose: () => void
  /** An answer was saved: the list behind the sheet reads again. */
  onChanged: () => void
}) {
  const t = useTranslations('tonight')
  const isMobile = useIsMobile()
  const tableName = useTableName()
  // undefined while loading; null when the order is not this venue's.
  const [detail, setDetail] = useState<SentDetailView | null | undefined>(undefined)

  const load = useCallback(() => {
    void sentOrderDetailAction({ venueId: frame.venueId, sentOrderId }).then((result) =>
      setDetail(result.ok ? result.detail : null),
    )
  }, [frame.venueId, sentOrderId])
  useEffect(() => load(), [load])

  const onAnswered = () => {
    load()
    onChanged()
  }
  const title = detail ? t('sh_ref', { ref: detail.row.reference }) : t('loading')
  const sub = detail
    ? t('sh_table', {
        table: tableName(detail.row.table, detail.row.numbered),
        time: detail.row.time,
      })
    : ''
  const body = detail ? <Body detail={detail} frame={frame} onAnswered={onAnswered} /> : null
  const close = (
    <Button type="button" variant="outline" className="h-12" onClick={onClose}>
      {t('close')}
    </Button>
  )

  return isMobile ? (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent data-testid="sent-sheet" aria-busy={detail === undefined}>
        <DrawerHeader>
          <DrawerTitle className="font-mono [overflow-wrap:anywhere]">{title}</DrawerTitle>
          <DrawerDescription>{sub}</DrawerDescription>
        </DrawerHeader>
        {body}
        <DrawerFooter>{close}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  ) : (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent data-testid="sent-sheet" aria-busy={detail === undefined}>
        <SheetHeader>
          <SheetTitle className="font-mono [overflow-wrap:anywhere]">{title}</SheetTitle>
          <SheetDescription>{sub}</SheetDescription>
        </SheetHeader>
        {body}
        <SheetFooter>{close}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
