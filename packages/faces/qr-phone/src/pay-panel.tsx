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
  type ConfirmationView,
  choosePay,
  confirmationOf,
  endText,
  freeLines,
  type Locale,
  lineNameText,
  NO_TIP,
  offersPay,
  offersReceiptEmail,
  type PayFormSlot,
  type PayingStrings,
  type PaymentView,
  type PayScreen,
  type Picks,
  type PreparedConfirmation,
  paidReceiptText,
  parseMinor,
  payBlock,
  payFormLocale,
  payMoney,
  payScreen,
  payStartCommand,
  pickWhole,
  prepareConfirmation,
  reconcilePicks,
  refusalText,
  type ServiceBinding,
  type ServiceStrings,
  sameAmountAgo,
  saveConfirmation,
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
  return lineNameText(line.name, locale, other)
}

/** "×2" for a line of more than one. */
function quantityMark(quantity: string): string {
  return quantity === '1' ? '' : ` ×${quantity}`
}

/**
 * The lines paid in the app in this sitting (D127 1.2): greyed under "Paid in the app", on every
 * phone at the table, with no payer named. They stay until the sitting ends.
 */
function PaidInApp({
  lines,
  words,
  locale,
  otherItem,
  money,
}: {
  readonly lines: TableBillView['paidLines']
  readonly words: PayingStrings
  readonly locale: Locale
  readonly otherItem: string
  readonly money: (minor: number) => string
}) {
  if (lines.length === 0) return null
  return (
    <div data-slot="bill.paid">
      <h3>{words.paidInApp}</h3>
      <ul className="rq-order-lines">
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a paid line has no id of its own (rule 3)
          <li key={index} data-paid-in-app="">
            {lineNameText(line.name, locale, otherItem)}
            {quantityMark(line.quantity)} · {money(line.amountMinor)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The Payment confirmation (D127 1.4): Restro's own page with the venue, the time, the lines, the
 * tip, the total, "Paid by card" and the payment number, and Save. It saves an image on the phone
 * and leaves no link; it is not a receipt and does not look like one.
 */
function Confirmation({
  view,
  id,
  closeLabel,
  failedText,
  onClose,
}: {
  readonly view: ConfirmationView
  readonly id: string
  /** "Back" (the guide's `same_no`), pending Martin's word for closing the page. */
  readonly closeLabel: string
  readonly failedText: string
  readonly onClose: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  // The image is drawn as the page opens, so the Save tap has it ready (a share sheet needs the tap).
  const [prepared] = useState<PreparedConfirmation>(() => prepareConfirmation(view))
  const heading = useRef<HTMLHeadingElement>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    heading.current?.focus()
    return () => {
      alive.current = false
    }
  }, [])
  async function save() {
    setSaving(true)
    setFailed(false)
    try {
      await saveConfirmation(prepared)
    } catch {
      // No success is shown for a save that failed: one line, and the guest taps Save again.
      if (alive.current) setFailed(true)
    }
    if (alive.current) setSaving(false)
  }
  return (
    <article className="rq-confirm" id={id} data-slot="pay.confirmation">
      <button type="button" data-slot="pay.confirmation.close" onClick={onClose}>
        {closeLabel}
      </button>
      <h3 tabIndex={-1} ref={heading}>
        {view.title}
      </h3>
      {view.venue === null ? null : <p data-slot="pay.confirmation.venue">{view.venue}</p>}
      {view.when === null ? null : <p data-slot="pay.confirmation.when">{view.when}</p>}
      <ul className="rq-order-lines">
        {view.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a payment's lines have no id of their own
          <li key={index}>
            {line.text} · {line.amount}
          </li>
        ))}
      </ul>
      {view.tip === null ? null : (
        <p>
          {view.tip.label}: {view.tip.amount}
        </p>
      )}
      <p>
        <b>
          {view.total.label}: {view.total.amount}
        </b>
      </p>
      <p>{view.paidBy}</p>
      <p>
        {view.number.label}: <b className="rq-pay-number">{view.number.value}</b>
      </p>
      <p className="rq-order-hint" data-slot="pay.confirmation.note">
        {view.note}
      </p>
      <button
        type="button"
        data-slot="pay.confirmation.save"
        disabled={saving}
        onClick={() => void save()}
      >
        {view.saveLabel}
      </button>
      {failed ? (
        <p className="rq-note" role="alert" data-slot="pay.confirmation.failed">
          {failedText}
        </p>
      ) : null}
    </article>
  )
}

/** The Payment confirmation's id: the button that opens it names it in `aria-controls`. */
const CONFIRMATION_ID = 'rq-pay-confirmation'

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
  locale,
  otherItem,
  money,
}: {
  readonly payment: PaymentView
  readonly words: PayingStrings
  readonly locale: Locale
  readonly otherItem: string
  readonly money: (minor: number) => string
}) {
  return (
    <>
      <ul className="rq-order-lines" data-slot="pay.lines">
        {payment.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a payment's lines have no id of their own
          <li key={index}>
            {lineNameText(line.name, locale, otherItem)}
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
  const [confirming, setConfirming] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  // Closing the confirmation brings the focus back to the button that opened it.
  useEffect(() => {
    if (!confirming && wasOpen.current) toggle.current?.focus()
    wasOpen.current = confirming
  }, [confirming])
  const screen: PayScreen = payScreen(payment)
  const dismiss = () => services?.payControls?.dismiss()
  const confirmation = confirmationOf({
    payment,
    venueName: services?.state.paying?.venueName ?? null,
    locale: props.locale,
    words,
    otherItem: serviceWords.otherItem,
  })
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
              <Priced
                payment={payment}
                words={words}
                locale={props.locale}
                otherItem={serviceWords.otherItem}
                money={money}
              />
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
          {confirming && confirmation !== null ? (
            <Confirmation
              view={confirmation}
              id={CONFIRMATION_ID}
              closeLabel={words.sameNo}
              failedText={words.confirmSaveFailed}
              onClose={() => setConfirming(false)}
            />
          ) : (
            <>
              <p>{words.paidNumber}</p>
              <p className="rq-pay-number" data-slot="pay.number">
                {payment.number}
              </p>
              {props.tableText === null ? null : <p data-slot="pay.table">{props.tableText}</p>}
              <Priced
                payment={payment}
                words={words}
                locale={props.locale}
                otherItem={serviceWords.otherItem}
                money={money}
              />
              <p data-slot="pay.receipt.line">{paidReceiptText(payment, words)}</p>
            </>
          )}
          {confirmation === null || confirming ? null : (
            <>
              <button
                type="button"
                data-slot="pay.confirmation.toggle"
                ref={toggle}
                aria-expanded={false}
                aria-controls={CONFIRMATION_ID}
                onClick={() => setConfirming(true)}
              >
                {words.confirmTitle}
              </button>{' '}
            </>
          )}
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
          <p role="status">
            {endText(
              words,
              screen.end,
              services?.state.paying == null ? null : money(services.state.paying.minCardMinor),
            )}
          </p>
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
  const receiptEmailOffered = offersReceiptEmail(paying)
  const money = useMemo(
    () => (minor: number) => payMoney(minor, bill?.currency ?? 'EUR', locale),
    [bill?.currency, locale],
  )

  const [picks, setPicks] = useState<Picks>(new Map())
  const [tip, setTip] = useState<TipChoice>(NO_TIP)
  const [other, setOther] = useState('')
  const [receiptEmail, setReceiptEmail] = useState('')
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
      const { actionId: _unused, ...draft } = payStartCommand(
        '',
        picks,
        tip,
        tipsOffered,
        receiptEmail,
        receiptEmailOffered,
      )
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
  const block = payBlock(paying, bill, picks, tip, tipsOffered, receiptEmail)
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
              : block === 'bad_email'
                ? words.emailInvalid
                : null
  const all = free.length > 0 && free.every((line) => picks.has(line.id))
  // Everything is paid: nothing is free to pay and the sitting has paid lines, so "Nothing on your
  // bill yet", the choosing, the totals and Pay go, and the bill shows what was paid (D127 1.2).
  const settled = free.length === 0 && bill.paidLines.length > 0
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
        settled ? null : (
          <p>{words.emptyBill}</p>
        )
      ) : (
        <>
          {offersPay(services.state) && paying.state !== 'off' && !settled ? (
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

      {settled ? null : paying.state === 'off' ? (
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
          {receiptEmailOffered ? (
            <p>
              <label>
                {words.receiptEmail}{' '}
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={receiptEmail}
                  maxLength={254}
                  data-slot="pay.receipt.email"
                  aria-invalid={block === 'bad_email' ? 'true' : undefined}
                  aria-describedby={block === 'bad_email' ? 'rq-receipt-email-help' : undefined}
                  onChange={(event) => setReceiptEmail(event.target.value)}
                />
              </label>
            </p>
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
            <p className="rq-note" id="rq-receipt-email-help" data-slot="pay.blocked" role="status">
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
      <PaidInApp
        lines={bill.paidLines}
        words={words}
        locale={locale}
        otherItem={serviceWords.otherItem}
        money={money}
      />
    </section>
  )
}
