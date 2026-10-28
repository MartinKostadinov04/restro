// The table's bill and paying from it (#45, #114, D127), as the hidden reference face draws it: the
// minimum a guest and the Playwright specs need, not a designed screen (the template agent designs
// the guest's look later, D105, D122). Everything drawn comes from the host's state (D72):
//
// - The bill (`state.tableBill`): the POS's own lines and amounts, a line in a payment that isn't
//   final greyed "Being paid" with no tick, "Left to pay", and Pay (or "Ask your waiter to pay."
//   where paying is off at the venue). Without a location pass there is no bill: why, "Allow
//   location" and Call a waiter.
// - Choosing: nothing ticked, "The whole bill", a tick per line, the tip row only where the POS
//   records a tip (`ordering.tips`; 5, 10, 15 % and "Other amount", none selected, "Tip: goes to
//   the venue"), the totals, the law lines and the Pay button with the live total, greyed with
//   its reason (`payBlock`). The ticks are kept while a payment runs and after it ends.
// - Paying (`state.payment`, this phone's): "Preparing your bill…", the lines, tip and total with
//   the card form in the form slot the page fills, "Processing your payment…", "Paid" with the
//   payment number, "The venue is checking the payment", or what ended with nothing charged.
//
// The face adds up nothing but the screen's preview (`choosePay`, from the shell); the hold is
// priced by the server from the POS's own amounts, and "Paid" is only a `captured` payment.

import {
  choosePay,
  fallbackChain,
  freeLines,
  type Locale,
  NO_TIP,
  offersPay,
  type PayFormSlot,
  type PayingStrings,
  type PaymentView,
  type PayScreen,
  type Picks,
  parseMinor,
  payBlock,
  payFormLocale,
  payMoney,
  payScreen,
  payStartCommand,
  pickText,
  pickWhole,
  reconcilePicks,
  refusalText,
  type ServiceBinding,
  type ServiceStrings,
  sameAmountAgo,
  type TableBillLineView,
  type TableBillView,
  TIP_PERCENTS,
  type TipChoice,
  togglePick,
} from '@restro/shell'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import type { CommandDraft } from './table-order'

/** What the bill panel needs from the face. */
export interface PayPanelProps {
  readonly services: ServiceBinding | undefined
  readonly locale: Locale
  readonly words: PayingStrings
  readonly serviceWords: ServiceStrings
  /** The table as the shell words it ("Table 12"), or null. */
  readonly tableText: string | null
  /** The venue takes waiter calls (`view.features.callWaiter`). */
  readonly callWaiter: boolean
  readonly send: (
    command: CommandDraft,
  ) => Promise<{ readonly status: string; readonly code?: string | null } | null>
}

/** The line's name: our item's, else "Other item". */
function lineName(line: TableBillLineView, locale: Locale, other: string): string {
  const picked = line.name === null ? null : pickText(line.name, fallbackChain(locale, locale, []))
  return picked?.text ?? other
}

/** "×2" for a line of more than one. */
function quantityMark(quantity: string): string {
  return quantity === '1' ? '' : ` ×${quantity}`
}

/** Puts the page's card form into the slot the face provides; the face loads no provider library. */
function FormSlot({
  slot,
  label,
  locale,
  failedText,
}: {
  readonly slot: PayFormSlot
  readonly label: string
  readonly locale: Locale
  readonly failedText: string
}) {
  const holder = useRef<HTMLDivElement>(null)
  const handle = useRef<ReturnType<PayFormSlot['mount']> | null>(null)
  const props = { label, buttonClass: 'rq-pay', locale: payFormLocale(locale), failedText }
  const latest = useRef(props)
  latest.current = props
  useEffect(() => {
    const element = holder.current
    if (element === null) return
    handle.current = slot.mount(element, latest.current)
    return () => {
      handle.current?.unmount()
      handle.current = null
    }
  }, [slot])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the form takes the new label and words
  useEffect(() => {
    handle.current?.update(latest.current)
  }, [label, failedText])
  return <div ref={holder} data-slot="pay.form" />
}

/** The lines, tip and total of a payment, as the server priced them. */
function Priced({
  payment,
  words,
  money,
}: {
  readonly payment: PaymentView
  readonly words: PayingStrings
  readonly money: (minor: number) => string
}) {
  return (
    <>
      <ul className="rq-order-lines" data-slot="pay.lines">
        {payment.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a payment's lines have no id of their own
          <li key={index}>
            {line.name}
            {quantityMark(line.quantity)} · {money(line.amountMinor)}
          </li>
        ))}
      </ul>
      <p data-slot="pay.tip">
        {words.tip}: {money(payment.tipMinor)}
      </p>
      {payment.amountMinor === null ? null : (
        <p data-slot="pay.total">
          <b>
            {words.total}: {money(payment.amountMinor)}
          </b>
        </p>
      )}
    </>
  )
}

/** This phone's payment, from "Preparing your bill…" to its end. */
function PaymentScreen({
  payment,
  props,
  money,
}: {
  readonly payment: PaymentView
  readonly props: PayPanelProps
  readonly money: (minor: number) => string
}) {
  const { services, words, serviceWords, send, callWaiter } = props
  const [refusal, setRefusal] = useState<string | null>(null)
  const screen: PayScreen = payScreen(payment)
  const dismiss = () => services?.payControls?.dismiss()
  const callButton = callWaiter ? (
    <button
      type="button"
      data-slot="pay.call"
      onClick={() => void send({ kind: 'service.request', request: 'waiter', note: '' })}
    >
      {words.callWaiter}
    </button>
  ) : null
  switch (screen.kind) {
    case 'preparing':
    case 'card':
      return (
        <section className="rq-order" data-pay-screen={screen.kind} aria-live="polite">
          {screen.kind === 'preparing' ? (
            <p role="status">{words.preparing}</p>
          ) : (
            <>
              <Priced payment={payment} words={words} money={money} />
              <p className="rq-order-hint">{words.legalPrices}</p>
              {services?.payForm === undefined || payment.amountMinor === null ? null : (
                <FormSlot
                  slot={services.payForm}
                  label={words.payX(money(payment.amountMinor))}
                  locale={props.locale}
                  failedText={words.cardFormFailed}
                />
              )}
            </>
          )}
          <button
            type="button"
            data-slot="pay.later"
            onClick={async () => {
              setRefusal(null)
              const result = await send({ kind: 'pay.cancel' })
              if (result?.status === 'accepted') dismiss()
              // After the hold there is no cancel (`too_late`): the screen follows the payment.
              else if (result !== null) {
                setRefusal(refusalText(serviceWords, result.code, { command: 'pay.cancel' }))
              }
            }}
          >
            {words.payLater}
          </button>{' '}
          {callButton}
          {refusal === null ? null : (
            <p className="rq-note" role="alert">
              {refusal}
            </p>
          )}
        </section>
      )
    case 'waiting':
      return (
        <section className="rq-order" data-pay-screen="waiting" aria-live="polite">
          <p role="status">{words.waiting}</p>
        </section>
      )
    case 'paid':
      return (
        <section className="rq-order" data-pay-screen="paid" aria-live="polite">
          <h2>{words.paid}</h2>
          <p>{words.paidNumber}</p>
          <p className="rq-pay-number" data-slot="pay.number">
            {payment.number}
          </p>
          {props.tableText === null ? null : <p data-slot="pay.table">{props.tableText}</p>}
          <Priced payment={payment} words={words} money={money} />
          <p>{words.paidReceipt}</p>
          <button type="button" data-slot="pay.back" onClick={dismiss}>
            {words.backToBill}
          </button>
        </section>
      )
    case 'checking':
      return (
        <section className="rq-order" data-pay-screen="checking" aria-live="polite">
          <h2>{words.checkingTitle}</h2>
          <p>{words.checkingBody}</p>
          {callButton}{' '}
          <button type="button" data-slot="pay.back" onClick={dismiss}>
            {words.backToBill}
          </button>
        </section>
      )
    case 'ended':
      return (
        <section className="rq-order" data-pay-screen="ended" data-pay-end={screen.end}>
          <p role="status">{words.ended[screen.end]}</p>
          {/* "Pay again" goes back to choosing with the ticks kept: Pay then takes the guarded path. */}
          {screen.again ? (
            <>
              <button type="button" data-slot="pay.again" onClick={dismiss}>
                {words.payAgain}
              </button>{' '}
            </>
          ) : null}
          {callButton}{' '}
          <button type="button" data-slot="pay.back" onClick={dismiss}>
            {words.backToBill}
          </button>
        </section>
      )
  }
}

/** The other-amount tip: what the guest typed, as minor units, or none. */
function otherTip(text: string): TipChoice {
  const minor = parseMinor(text)
  return minor === null ? NO_TIP : { kind: 'other', minor }
}

/** The bill, choosing and paying (see the file's note). */
export function PayPanel(props: PayPanelProps): ReactNode {
  const { services, locale, words, serviceWords, send } = props
  const state = services?.state
  const bill: TableBillView | null = state?.tableBill ?? null
  const payment = state?.payment ?? null
  const paying = state?.paying ?? null
  const tipsOffered = state?.ordering?.tips === true
  const money = useMemo(
    () => (minor: number) => payMoney(minor, bill?.currency ?? 'EUR', locale),
    [bill?.currency, locale],
  )

  const [picks, setPicks] = useState<Picks>(new Map())
  const [tip, setTip] = useState<TipChoice>(NO_TIP)
  const [other, setOther] = useState('')
  const [askingSame, setAskingSame] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  // A fresh bill clears only the ticks of lines that changed or went; a friend's round clears none.
  // Not while this phone has a payment: the server marks that payment's own lines `beingPaid`, which
  // would empty the ticks "Pay again" goes back to (D127 2.1).
  useEffect(() => {
    if (bill !== null && payment === null) setPicks((current) => reconcilePicks(current, bill))
  }, [bill, payment])

  // Without a location pass there is no bill and no order: why, and the way to allow it.
  if (services !== undefined && state?.location?.state === 'needed' && payment === null) {
    return (
      <section className="rq-order" data-slot="menu.bill" data-bill-hidden="">
        <h2>{words.locationTitle}</h2>
        <p>{words.locationBody}</p>
        {/* "Allow location" is the location panel's own button, above: one control, not two. */}
        {props.callWaiter ? (
          <button
            type="button"
            onClick={() => void send({ kind: 'service.request', request: 'waiter', note: '' })}
          >
            {words.callWaiter}
          </button>
        ) : null}
      </section>
    )
  }

  if (services === undefined || (bill === null && payment === null)) return null

  const start = async () => {
    if (bill === null) return
    setBusy(true)
    setAskingSame(null)
    setRefusal(null)
    try {
      const { actionId: _unused, ...draft } = payStartCommand('', picks, tip, tipsOffered)
      const result = await send(draft)
      if (result !== null && result.status === 'rejected') {
        setRefusal(
          refusalText(serviceWords, result.code, {
            command: 'pay.start',
            minCard: paying === null ? null : money(paying.minCardMinor),
          }),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  if (payment !== null) return <PaymentScreen payment={payment} props={props} money={money} />
  if (bill === null || paying === null) return null

  const totals = choosePay(picks, tip, tipsOffered)
  const block = payBlock(paying, bill, picks, tip, tipsOffered)
  const free = freeLines(bill)
  const blockWords =
    block === 'cards_paused'
      ? words.cardsPaused
      : block === 'not_up_to_date'
        ? words.notUpToDate
        : block === 'nothing_picked'
          ? words.nothingPicked
          : block === 'below_minimum'
            ? words.belowMinimum(money(paying.minCardMinor))
            : block === 'tip_too_big'
              ? words.tipTooBig
              : null
  const all = free.length > 0 && free.every((line) => picks.has(line.id))
  const pickTip = (next: TipChoice) => {
    setTip((current) =>
      current.kind === next.kind &&
      (next.kind !== 'percent' || (current.kind === 'percent' && current.percent === next.percent))
        ? NO_TIP
        : next,
    )
  }

  return (
    <section className="rq-order" data-slot="menu.bill" aria-label={words.billTitle}>
      <h2>{words.billTitle}</h2>
      <p className="rq-order-hint">
        {bill.complete ? words.updated(bill.readAgoSeconds) : words.stale(bill.readAgoSeconds)}
      </p>
      {bill.parts.every((part) => part.lines.length === 0) ? (
        <p>{words.emptyBill}</p>
      ) : (
        <>
          {offersPay(services.state) && paying.state !== 'off' ? (
            <button
              type="button"
              data-slot="pay.whole"
              aria-pressed={all}
              onClick={() => setPicks(pickWhole(picks, bill))}
            >
              {words.wholeBill}
            </button>
          ) : null}
          <ul className="rq-order-lines">
            {bill.parts.flatMap((part) =>
              part.lines.map((line) => {
                const greyed = part.beingPaid || line.beingPaid
                const canTick = paying.state !== 'off' && !greyed
                return (
                  <li key={line.id} data-being-paid={greyed ? '' : undefined}>
                    {canTick ? (
                      <label>
                        <input
                          type="checkbox"
                          checked={picks.has(line.id)}
                          onChange={() => setPicks(togglePick(picks, bill, line.id))}
                        />{' '}
                        {lineName(line, locale, serviceWords.otherItem)}
                        {quantityMark(line.quantity)} · {money(line.amountMinor)}
                      </label>
                    ) : (
                      <span aria-disabled={greyed ? 'true' : undefined}>
                        {lineName(line, locale, serviceWords.otherItem)}
                        {quantityMark(line.quantity)} · {money(line.amountMinor)}
                        {greyed ? ` · ${words.beingPaid}` : ''}
                      </span>
                    )}
                  </li>
                )
              }),
            )}
          </ul>
          <p data-slot="bill.owed">
            <b>
              {words.leftToPay}: {money(bill.owedMinor)}
            </b>
          </p>
        </>
      )}

      {paying.state === 'off' ? (
        <p className="rq-note" data-slot="pay.off">
          {words.askWaiterToPay}
        </p>
      ) : (
        <div data-slot="pay.choose">
          <h3>{words.pickTitle}</h3>
          {tipsOffered ? (
            <fieldset data-slot="pay.tip.row">
              <legend>{words.tipLabel}</legend>
              {TIP_PERCENTS.map((percent) => (
                <button
                  key={percent}
                  type="button"
                  aria-pressed={tip.kind === 'percent' && tip.percent === percent}
                  data-slot="pay.tip.preset"
                  onClick={() => pickTip({ kind: 'percent', percent })}
                >
                  {percent} %
                </button>
              ))}{' '}
              <label>
                {words.tipOther}{' '}
                <input
                  inputMode="decimal"
                  value={other}
                  data-slot="pay.tip.other"
                  onChange={(event) => {
                    setOther(event.target.value)
                    setTip(otherTip(event.target.value))
                  }}
                />
              </label>
            </fieldset>
          ) : null}
          <p>
            {words.yourItems}: {money(totals.itemsMinor)}
          </p>
          {tipsOffered ? (
            <p>
              {words.tip}: {money(totals.tipMinor)}
            </p>
          ) : null}
          <p>
            <b>
              {words.total}: {money(totals.totalMinor)}
            </b>
          </p>
          <p className="rq-order-hint">{words.legalPrices}</p>
          {paying.processor === null ? null : (
            <p className="rq-order-hint">
              {words.legalProcessor(paying.processor, paying.venueName)}
            </p>
          )}
          {askingSame === null ? (
            <button
              type="button"
              className="rq-pay"
              data-slot="pay.start"
              disabled={block !== null || busy}
              onClick={() => {
                const ago = sameAmountAgo(paying.recent, totals.totalMinor)
                if (ago !== null) setAskingSame(ago)
                else void start()
              }}
            >
              {words.payX(money(totals.totalMinor))}
            </button>
          ) : (
            <div role="alertdialog" aria-live="polite" data-slot="pay.same">
              <p>{words.sameQuestion(askingSame)}</p>
              <button type="button" onClick={() => void start()}>
                {words.sameYes}
              </button>{' '}
              <button type="button" onClick={() => setAskingSame(null)}>
                {words.sameNo}
              </button>
            </div>
          )}
          {blockWords === null ? null : (
            <p className="rq-note" data-slot="pay.blocked" role="status">
              {blockWords}
            </p>
          )}
          {refusal === null ? null : (
            <p className="rq-note" data-slot="pay.refused" role="alert">
              {refusal}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
