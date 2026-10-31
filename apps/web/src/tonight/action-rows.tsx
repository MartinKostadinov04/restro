'use client'

// "Needs you" (plan §3, §4, §12 A): a list row per thing that needs a person, ordered by what costs
// most to leave, each with its icon, title, meta line and its answer under it. Only the top row's
// answer is filled; every other button is outline. A role that may not act is sent to the higher
// PIN on a shared device, and on a personal session sees no button at all, never a disabled one.
// Part 2's money rows slot in by `ROW_RANK` (#115) and share this row.
import {
  BellRingIcon,
  CirclePauseIcon,
  HourglassIcon,
  PackageXIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
  SearchCheckIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { unstable_rethrow } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  handleWaiterCallAction,
  receiptBroughtAction,
  receiptUnbroughtAction,
  refundFailedSeenAction,
  refundFailedUnseenAction,
  resumeTableAction,
  stornoDoneAction,
  stornoUndoAction,
  undoWaiterCallAction,
} from '@/server/tonight/actions'
import { paymentEvidenceAction } from '@/server/tonight/payment-actions'
import type { PaymentDetailView } from '@/server/tonight/payment-view'
import type { TonightResult } from '@/server/tonight/tables'
import type { ActionRow, RowKind } from '@/server/tonight/view'

import { callKindsText } from './call-kinds'
import { useDateText } from './day-picker'
import { useMoney } from './money'
import { MONEY_ICONS, type MoneyFrame, useMoneyRowParts } from './money-rows'
import { PaymentSheet } from './payment-sheet'
import { PinSheet } from './pin-sheet'
import { useTonightRun, wroteSomething } from './run'
import { SentOrderAnswers } from './sent-order-answers'
import { useTableName } from './table-name'

const ICONS = {
  check: SearchCheckIcon,
  approval: HourglassIcon,
  paused: CirclePauseIcon,
  call: BellRingIcon,
  receipt: ReceiptTextIcon,
  storno: RotateCcwIcon,
  dispute: ShieldAlertIcon,
  refund_failed: TriangleAlertIcon,
  pay: MONEY_ICONS.pay.Icon,
  failed: MONEY_ICONS.failed.Icon,
  stuck: MONEY_ICONS.stuck.Icon,
  stopped: MONEY_ICONS.stopped.Icon,
} as const satisfies Record<RowKind, unknown>

/** The most items a row or notice lists before "+k more" (plan §12 A). */
const MAX_LISTED = 8

/** "N min ago", or "just now" under a minute. */
export function useAgo(now: string) {
  const t = useTranslations('tonight')
  return (at: string) => {
    const minutes = Math.floor((new Date(now).getTime() - new Date(at).getTime()) / 60_000)
    return minutes < 1 ? t('now0') : t('ago', { m: minutes })
  }
}

/** What a row of "Needs you" needs of the screen: the same on the end-of-night page (#86). */
export type ActionRowView = MoneyFrame

/** One row of "Needs you". `primary` is true only for the first. */
export function ActionRowItem({
  row,
  view,
  primary,
  ago,
}: {
  row: ActionRow
  view: ActionRowView
  primary: boolean
  ago: string
}) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const dateText = useDateText()
  const { run, busy } = useTonightRun()
  const tableName = useTableName()
  const [evidence, setEvidence] = useState(false)
  const [askingPin, setAskingPin] = useState(false)
  const [loadedEvidence, setLoadedEvidence] = useState<PaymentDetailView | null>(null)
  const name = tableName(row.table, row.numbered)
  const provider = view.provider ?? t('pb_provider_none')
  const Icon = ICONS[row.kind]
  const moneyParts = useMoneyRowParts(row, view, name)
  const variant = primary ? 'default' : 'outline'
  const button = 'h-12 min-w-32 whitespace-normal'

  let title: string
  let body: ReactNode = null
  let answer: ReactNode = null

  if (moneyParts !== null) {
    title = moneyParts.title
    body = moneyParts.body
    answer = moneyParts.answer
  } else if (row.kind === 'call') {
    title = t('c_t', { table: name, kinds: callKindsText(t, row.callKinds ?? ['waiter']) })
    // "Handled": no PIN even on a shared device; the Log names the device's account (Martin 10-26).
    if (view.can.answer) {
      answer = (
        <Button
          type="button"
          variant={variant}
          className={button}
          disabled={busy}
          onClick={() =>
            run({
              id: `call:${row.id}`,
              act: () =>
                handleWaiterCallAction({ venueId: view.venueId, waiterCallId: row.waiterCallId }),
              done: t('c_toast', { table: name }),
              undo: (_, undo) =>
                undoWaiterCallAction({
                  venueId: view.venueId,
                  waiterCallId: row.waiterCallId,
                  undo,
                }),
              undoWhen: wroteSomething,
            })
          }
        >
          {t('c_ok')}
        </Button>
      )
    }
  } else if (row.kind === 'receipt' && row.receipt !== undefined) {
    const { receipt } = row
    title = t('r_t')
    body = (
      <div className="space-y-0.5 text-sm text-muted-foreground">
        <p className="[overflow-wrap:anywhere]">
          {t('r_d', {
            table: name,
            ref: receipt.paymentNumber,
            amt: money(receipt.amountMinor, view.currency),
          })}
        </p>
        {receipt.receiptNumber === null ? null : (
          <p className="[overflow-wrap:anywhere]">{t('r_rcpt', { rcpt: receipt.receiptNumber })}</p>
        )}
      </div>
    )
    // "Brought": one tap, no PIN even on a shared device; the Log names the device's account
    // (D122 §7, Martin 10-26). The Undo toast is offered only when this tap changed something: a
    // repeat finds it marked already and must not undo someone else's mark.
    if (view.can.answer) {
      answer = (
        <Button
          type="button"
          variant={variant}
          className={button}
          disabled={busy}
          onClick={() =>
            run({
              id: `receipt:${receipt.paymentId}`,
              act: () =>
                receiptBroughtAction({ venueId: view.venueId, paymentId: receipt.paymentId }),
              done: t('r_toast', { table: name }),
              undo: (_, undo) =>
                receiptUnbroughtAction({
                  venueId: view.venueId,
                  paymentId: receipt.paymentId,
                  undo,
                }),
              undoWhen: (done) => done.details.changed === true && wroteSomething(done),
            })
          }
        >
          {t('r_ok')}
        </Button>
      )
    }
  } else if (row.kind === 'storno' && row.storno !== undefined) {
    const { storno } = row
    // What the storno at the till asks for (decision log 5.6). A number the POS gave none of is a dash.
    const dash = '–'
    title = t('st_t', { source: view.source })
    body = (
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {t('st_d', {
          amt: money(storno.amountMinor, view.currency),
          table: name,
          date: dateText(storno.serviceDate),
          rcpt: storno.receiptNumber ?? dash,
          rcptTime: storno.receiptTime ?? dash,
          fm: storno.fiscalMemoryNumber ?? dash,
        })}
      </p>
    )
    // "Storno done": a manager's PIN on the shared tablet (its sheet says what is recorded), one
    // tap on a manager's own session; nothing on a staff member's own phone. The Undo gets the
    // same PIN, so the same person takes it back.
    if (view.can.followUp || view.device) {
      answer = (
        <Button
          type="button"
          variant={variant}
          className={button}
          disabled={busy}
          onClick={() =>
            run({
              id: `storno:${storno.refundId}`,
              ...(view.device
                ? {
                    pin: {
                      level: 'manager' as const,
                      title: t('st_ok'),
                      // The manager confirming is told the true amount, tip included, which the
                      // row itself leaves out for a reader who sees no tips (Martin 10-29).
                      body: `${t('st_d', {
                        amt: money(storno.chargeMinor, view.currency),
                        table: name,
                        date: dateText(storno.serviceDate),
                        rcpt: storno.receiptNumber ?? dash,
                        rcptTime: storno.receiptTime ?? dash,
                        fm: storno.fiscalMemoryNumber ?? dash,
                      })} ${t('st_b', { source: view.source })}`,
                    },
                  }
                : {}),
              act: (pin) =>
                stornoDoneAction({ venueId: view.venueId, refundId: storno.refundId, pin }),
              done: t('st_toast'),
              undo: (_, undo, pin) =>
                stornoUndoAction({ venueId: view.venueId, refundId: storno.refundId, undo, pin }),
              // Only a write that logged an entry has a token to undo with.
              undoWhen: wroteSomething,
            })
          }
        >
          {t('st_ok')}
        </Button>
      )
    }
  } else if (row.kind === 'dispute' && row.dispute !== undefined) {
    const { dispute } = row
    title = t('d_t')
    body = (
      <div className="space-y-0.5 text-sm text-muted-foreground">
        <p className="[overflow-wrap:anywhere]">
          {t('d_d', {
            amt: money(dispute.amountMinor ?? 0, view.currency),
            table: name,
            date: dateText(dispute.serviceDate),
          })}
        </p>
        {dispute.due === null ? null : (
          <p className="font-medium text-foreground [overflow-wrap:anywhere]">
            {t('d_due', { provider, date: dateText(dispute.due.date) })}
          </p>
        )}
      </div>
    )
    // The evidence is on the payment's page, for managers and owners: on the shared tablet, whose
    // own account holds no such right, a manager's PIN opens it (RR-58). The row leaves by itself
    // when the provider says won or lost.
    if (view.can.followUp || view.device) {
      answer = (
        <>
          <Button
            type="button"
            variant={variant}
            className={button}
            onClick={() => (view.can.followUp ? setEvidence(true) : setAskingPin(true))}
          >
            {t('d_ok')}
          </Button>
          {askingPin ? (
            <PinSheet
              title={t('d_ok')}
              body={t('d_d', {
                amt: money(dispute.amountMinor ?? 0, view.currency),
                table: name,
                date: dateText(dispute.serviceDate),
              })}
              level="manager"
              onLeave={() => setAskingPin(false)}
              onSubmit={async (pin) => {
                const read = await paymentEvidenceAction({
                  venueId: view.venueId,
                  paymentId: dispute.paymentId,
                  pin,
                }).catch((error: unknown): TonightResult => {
                  unstable_rethrow(error)
                  return { ok: false, error: 'failed' }
                })
                if (!read.ok) return read
                setAskingPin(false)
                if ('detail' in read) {
                  setLoadedEvidence(read.detail)
                  setEvidence(true)
                }
                return { ok: true, details: {} }
              }}
            />
          ) : null}
        </>
      )
    }
  } else if (row.kind === 'refund_failed' && row.refundFailed !== undefined) {
    // The storno was made, then the refund did not go through: ask the accountant. "Got it" clears
    // the row early (#234; it leaves by itself after three days): a manager's PIN on the shared
    // tablet, one tap on a manager's own session; the Undo gets the same PIN.
    const { refundFailed } = row
    title = t('rf_fail_t', {
      amt: money(refundFailed.amountMinor, view.currency),
      provider,
    })
    if (view.can.followUp || view.device) {
      answer = (
        <Button
          type="button"
          variant="outline"
          className={button}
          disabled={busy}
          onClick={() =>
            run({
              id: `refund_failed:${refundFailed.refundId}`,
              ...(view.device
                ? { pin: { level: 'manager' as const, title: t('rf_ok'), body: title } }
                : {}),
              act: (pin) =>
                refundFailedSeenAction({
                  venueId: view.venueId,
                  refundId: refundFailed.refundId,
                  pin,
                }),
              done: t('rf_toast'),
              undo: (_, undo, pin) =>
                refundFailedUnseenAction({
                  venueId: view.venueId,
                  refundId: refundFailed.refundId,
                  undo,
                  pin,
                }),
              // Only a write that logged an entry has a token to undo with.
              undoWhen: wroteSomething,
            })
          }
        >
          {t('rf_ok')}
        </Button>
      )
    }
  } else if (row.kind === 'paused') {
    title = t('g_t', { table: name })
    body = <p className="text-sm text-muted-foreground">{t('g_d')}</p>
    // Resuming names a person: their own PIN on a shared device.
    if (view.can.resume || view.device) {
      answer = (
        <Button
          type="button"
          variant={variant}
          className={button}
          disabled={busy}
          onClick={() =>
            run({
              id: `resume:${row.tableId}`,
              ...(view.device
                ? {
                    pin: {
                      level: 'own' as const,
                      title: t('g_ok'),
                      body: t('g_b', { table: name }),
                    },
                  }
                : {}),
              act: (pin) => resumeTableAction({ venueId: view.venueId, tableId: row.tableId, pin }),
              done: t('g_toast', { table: name }),
            })
          }
        >
          {t('g_ok')}
        </Button>
      )
    }
  } else if (row.kind === 'approval') {
    // Approval lives in the POS (D116): the row is read-only, no Approve or Decline (plan §10 Q4).
    title = t('a_t')
    body = <p className="text-sm text-muted-foreground">{t('a_d', { source: view.source })}</p>
  } else {
    const check = row.check
    title = t('s_t')
    body = (
      <div className="space-y-1 text-sm">
        {check === undefined ? null : (
          <>
            <p className="text-muted-foreground">
              {check.sentAt === null
                ? t('s_ref', { ref: check.reference })
                : t('s_meta', { ref: check.reference, time: check.sentAt })}
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-foreground">
              {check.items.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the items of a fixed list
                <li key={index} className="[overflow-wrap:anywhere]">
                  {item.qty} × {item.name}
                  {item.options.length === 0 ? '' : ` (${item.options.join(', ')})`}
                </li>
              ))}
            </ul>
            {check.billBeforeMinor === null ? null : (
              <p className="text-muted-foreground">
                {t('s_before', { amt: money(check.billBeforeMinor, view.currency) })}
              </p>
            )}
          </>
        )}
        {check?.landedAt == null ? null : (
          <p className="text-muted-foreground" data-testid="landed-late">
            {t('so_found', { time: check.landedAt })}
          </p>
        )}
        <p className="font-medium">{t('s_q')}</p>
      </div>
    )
    // Two answers at equal weight, both outline: neither is a default (plan §4, Q9). A shared
    // device asks the person's own PIN, which is also the confirmation of what it will record.
    if (check !== undefined && (view.can.answer || view.device)) {
      answer = <SentOrderAnswers frame={view} sentOrderId={check.sentOrderId} table={name} />
    }
  }

  return (
    <li
      className="rounded-lg border bg-card p-4 text-card-foreground"
      data-testid="action-row"
      data-kind={row.kind}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md ${
            row.kind === 'pay' ? 'bg-destructive/10 text-destructive' : 'bg-info/10 text-info'
          }`}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{title}</h3>
            <span className="text-sm text-muted-foreground">{ago}</span>
          </div>
          {body}
          {answer === null ? null : <div className="flex flex-wrap gap-2 pt-1">{answer}</div>}
        </div>
      </div>
      {evidence && row.dispute !== undefined ? (
        <PaymentSheet
          frame={view}
          paymentId={row.dispute.paymentId}
          {...(loadedEvidence === null ? {} : { loaded: loadedEvidence })}
          onClose={() => {
            setEvidence(false)
            setLoadedEvidence(null)
          }}
        />
      ) : null}
    </li>
  )
}

/** The out-of-stock notice (plan §12 A): one row, no answer, not counted, no sound. */
export function OutOfStockNotice({ names, source }: { names: readonly string[]; source: string }) {
  const t = useTranslations('tonight')
  const [all, setAll] = useState(false)
  const isMobile = useIsMobile()
  const shown = names.slice(0, MAX_LISTED)
  const more = names.length - shown.length
  const list = shown.join(', ')
  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground" data-testid="stock-notice">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <PackageXIcon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-base font-semibold [overflow-wrap:anywhere]">
            {t('oos_t', { source })}
          </h3>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {t('oos_d', { items: list })}
          </p>
          {more > 0 ? (
            <Button
              type="button"
              variant="link"
              className="h-11 px-0"
              data-testid="stock-more"
              onClick={() => setAll(true)}
            >
              {t('oos_more', { k: more })}
            </Button>
          ) : null}
        </div>
      </div>
      {/* Everything about the notice: a side sheet, a bottom drawer on a phone (Patterns). */}
      {isMobile ? (
        <Drawer open={all} onOpenChange={setAll}>
          <DrawerContent data-testid="stock-sheet">
            <DrawerHeader>
              <DrawerTitle>{t('oos_t', { source })}</DrawerTitle>
              <DrawerDescription>{t('oos_d', { items: names.join(', ') })}</DrawerDescription>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open={all} onOpenChange={setAll}>
          <SheetContent data-testid="stock-sheet">
            <SheetHeader>
              <SheetTitle>{t('oos_t', { source })}</SheetTitle>
              <SheetDescription>{t('oos_d', { items: names.join(', ') })}</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      )}
    </li>
  )
}
