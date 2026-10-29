// The pay sheet (`#pay`), D127 "The guest's bill screen and paying from it" (#45, #114). The amounts
// are the host's: the bill's lines (`state.tableBill`) are the POS's own, the guest ticks lines (or
// "The whole bill"), may add a tip (5, 10, 15 % or an amount, none selected, only where the POS
// records one), and Pay sends `pay.start` with each ticked line as the phone saw it. The sheet adds
// up only the preview of the choice (`choosePay`, from the shell); the hold is priced by the server.
//
// What follows is this phone's payment (`state.payment`), worded by the shell's `payScreen`:
// "Preparing your bill…", the lines, tip and total with the card form in the slot the page fills
// (`binding.payForm`; the face never loads a provider library, D72), "Processing your payment…",
// "Paid" with the payment number, "The venue is checking the payment", or what ended with nothing
// charged. "Paid" is only a `captured` payment: a refusal, an error or a timeout never says it.
// The look is the template agent's, later (D122); this is the functional screen.

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
  type PayFormSlot,
  type PaymentView,
  type PayScreen,
  type Picks,
  type PreparedConfirmation,
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
  sameAmountAgo,
  saveConfirmation,
  type TableBillLineView,
  type TableBillView,
  TIP_PERCENTS,
  type TipChoice,
  togglePick,
} from '@restro/shell'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { newActionId } from './command'
import { StatePanel } from './parts'
import { useServicesRequired } from './provider'

/** Puts the page's card form into the slot; the face loads no provider library. */
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
  const props = {
    label,
    buttonClass: 'ro-primary is-wide',
    locale: payFormLocale(locale),
    failedText,
  }
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
  return <div data-slot="pay.form" ref={holder} />
}

/** The Payment confirmation's id: the button that opens it names it in `aria-controls`. */
const CONFIRMATION_ID = 'ro-pay-confirmation'

/** "×2" for a line of more than one. */
const mark = (quantity: string) => (quantity === '1' ? '' : ` ×${quantity}`)

/**
 * The lines paid in the app in this sitting (D127 1.2): greyed under "Paid in the app", on every
 * phone at the table, with no payer named. They stay until the sitting ends.
 */
export function PaidInApp({
  lines,
  money,
}: {
  readonly lines: TableBillView['paidLines']
  readonly money: (minor: number) => string
}) {
  const { words, locale } = useServicesRequired()
  if (lines.length === 0) return null
  return (
    <section data-slot="bill.paid">
      <h4 className="ro-h">{words.paying.paidInApp}</h4>
      <ul className="ro-lines">
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a paid line has no id of its own (rule 3)
          <li key={index} data-paid-in-app="">
            {lineNameText(line.name, locale, words.otherItem)}
            {mark(line.quantity)} · {money(line.amountMinor)}
          </li>
        ))}
      </ul>
    </section>
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
    heading.current?.focus({ preventScroll: false })
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
    <article className="ro-confirm" id={id} data-slot="pay.confirmation">
      <button
        type="button"
        className="ro-ghost"
        data-slot="pay.confirmation.close"
        onClick={onClose}
      >
        {closeLabel}
      </button>
      <h3 className="ro-h" tabIndex={-1} ref={heading}>
        {view.title}
      </h3>
      {view.venue === null ? null : <p data-slot="pay.confirmation.venue">{view.venue}</p>}
      {view.when === null ? null : <p data-slot="pay.confirmation.when">{view.when}</p>}
      <ul className="ro-lines">
        {view.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a payment's lines have no id of their own
          <li key={index}>
            {line.text} · {line.amount}
          </li>
        ))}
      </ul>
      {view.tip === null ? null : (
        <div className="ro-sum">
          <span>{view.tip.label}</span>
          <b>{view.tip.amount}</b>
        </div>
      )}
      <div className="ro-sum is-big">
        <span>{view.total.label}</span>
        <b>{view.total.amount}</b>
      </div>
      <p>{view.paidBy}</p>
      <p>
        {view.number.label}: <b className="ro-pay-number">{view.number.value}</b>
      </p>
      <p className="ro-confirm-note" data-slot="pay.confirmation.note">
        {view.note}
      </p>
      <button
        type="button"
        className="ro-primary is-wide"
        data-slot="pay.confirmation.save"
        disabled={saving}
        onClick={() => void save()}
      >
        <span>{view.saveLabel}</span>
      </button>
      {failed ? (
        <p className="ro-notice is-bad" role="alert" data-slot="pay.confirmation.failed">
          {failedText}
        </p>
      ) : null}
    </article>
  )
}

export function PaySheet() {
  const o = useServicesRequired()
  const { words, state, locale, run, binding } = o
  const w = words.paying
  const bill = state.tableBill ?? null
  const paying = state.paying ?? null
  const payment = state.payment ?? null
  const tipsOffered = state.ordering?.tips === true
  const money = useMemo(
    () => (minor: number) => payMoney(minor, bill?.currency ?? 'EUR', locale),
    [bill?.currency, locale],
  )

  const [picks, setPicks] = useState<Picks>(new Map())
  const [tip, setTip] = useState<TipChoice>(NO_TIP)
  const [other, setOther] = useState('')
  const [asking, setAsking] = useState<number | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  // A fresh bill clears only the ticks of lines that changed or went; a friend's round clears none.
  // Not while this phone has a payment: the server marks that payment's own lines `beingPaid`,
  // which would empty the ticks "Pay again" goes back to (D127 2.1).
  useEffect(() => {
    if (bill !== null && payment === null) setPicks((current) => reconcilePicks(current, bill))
  }, [bill, payment])

  const nameOf = (line: TableBillLineView) => lineNameText(line.name, locale, words.otherItem)

  /** Sends a pay command; a refusal is worded by code, a lost answer is not a success. */
  async function send(command: Parameters<typeof run>[0]) {
    setRefusal(null)
    const outcome = await run(command)
    if (!alive.current) return null
    if (!outcome.ok) {
      setRefusal(words.refusedOther)
      return null
    }
    const { result } = outcome
    if (result.status === 'rejected') {
      setRefusal(
        refusalText(words, result.code, {
          command: command.kind,
          minCard: paying === null ? null : money(paying.minCardMinor),
        }),
      )
    }
    return result
  }

  async function start() {
    if (bill === null) return
    setBusy(true)
    setAsking(null)
    try {
      await send(payStartCommand(newActionId(), picks, tip, tipsOffered))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  if (payment !== null) return <PaymentScreen payment={payment} money={money} />
  // Without a location pass there is no bill and no order: why, and the way to allow it.
  if (state.location?.state === 'needed') {
    return (
      <div className="ro-sheet" data-slot="bill.hidden">
        <h3 className="ro-h">{w.locationTitle}</h3>
        <p>{w.locationBody}</p>
        {binding.location === undefined ? null : (
          <button
            type="button"
            className="ro-primary is-wide"
            onClick={() => binding.location?.reopen()}
          >
            <span>{w.allowLocation}</span>
          </button>
        )}
        <CallWaiter />
      </div>
    )
  }
  if (bill === null || paying === null) return <p className="ro-empty">{words.nothingToPay}</p>

  const totals = choosePay(picks, tip, tipsOffered)
  const block = payBlock(paying, bill, picks, tip, tipsOffered)
  const blockWords =
    block === 'cards_paused'
      ? w.cardsPaused
      : block === 'not_up_to_date'
        ? w.notUpToDate
        : block === 'nothing_picked'
          ? w.nothingPicked
          : block === 'below_minimum'
            ? w.belowMinimum(money(paying.minCardMinor))
            : block === 'tip_too_big'
              ? w.tipTooBig
              : null
  const free = freeLines(bill)
  // Everything is paid: nothing is free to pay and the sitting has paid lines, so the choosing, the
  // totals and Pay go, and the bill shows what was paid (D127 1.2).
  const settled = free.length === 0 && bill.paidLines.length > 0
  const hasLines = bill.parts.some((part) => part.lines.length > 0)
  const everything = free.length > 0 && free.every((line) => picks.has(line.id))
  const pickTip = (next: TipChoice) =>
    setTip((current) =>
      current.kind === next.kind &&
      (next.kind !== 'percent' || (current.kind === 'percent' && current.percent === next.percent))
        ? NO_TIP
        : next,
    )

  return (
    <div className="ro-sheet" data-slot="pay.choose">
      {settled ? null : <h3 className="ro-h">{w.pickTitle}</h3>}
      {paying.state === 'off' && !settled ? <p className="ro-notice">{w.askWaiterToPay}</p> : null}
      {offersPay(state) && !settled ? (
        <button
          type="button"
          className="ro-ghost"
          data-slot="pay.whole"
          aria-pressed={everything}
          onClick={() => setPicks(pickWhole(picks, bill))}
        >
          {w.wholeBill}
        </button>
      ) : null}
      {hasLines ? (
        <ul className="ro-lines">
          {bill.parts.flatMap((part) =>
            part.lines.map((line) => {
              const greyed = part.beingPaid || line.beingPaid
              const label = `${nameOf(line)}${mark(line.quantity)} · ${money(line.amountMinor)}`
              return (
                <li key={line.id} data-being-paid={greyed ? '' : undefined}>
                  {paying.state === 'off' || greyed ? (
                    <span>
                      {label}
                      {greyed ? ` · ${w.beingPaid}` : ''}
                    </span>
                  ) : (
                    <label>
                      <input
                        type="checkbox"
                        checked={picks.has(line.id)}
                        onChange={() => setPicks(togglePick(picks, bill, line.id))}
                      />{' '}
                      {label}
                    </label>
                  )}
                </li>
              )
            }),
          )}
        </ul>
      ) : null}
      {settled ? null : (
        <p className="ro-sum">
          <span>{w.leftToPay}</span>
          <b>{money(bill.owedMinor)}</b>
        </p>
      )}

      {paying.state === 'off' || settled ? null : (
        <>
          {tipsOffered ? (
            <fieldset className="ro-tips" data-slot="pay.tip.row">
              <legend>{w.tipLabel}</legend>
              {TIP_PERCENTS.map((percent) => (
                <button
                  key={percent}
                  type="button"
                  className="ro-ghost"
                  data-slot="pay.tip.preset"
                  aria-pressed={tip.kind === 'percent' && tip.percent === percent}
                  onClick={() => pickTip({ kind: 'percent', percent })}
                >
                  {percent} %
                </button>
              ))}
              <label className="ro-input">
                <span>{w.tipOther}</span>
                <input
                  inputMode="decimal"
                  value={other}
                  data-slot="pay.tip.other"
                  aria-invalid={other.trim() !== '' && parseMinor(other) === null}
                  onChange={(event) => {
                    setOther(event.target.value)
                    const minor = parseMinor(event.target.value)
                    setTip(minor === null ? NO_TIP : { kind: 'other', minor })
                  }}
                />
              </label>
            </fieldset>
          ) : null}
          <div className="ro-sum">
            <span>{w.yourItems}</span>
            <b>{money(totals.itemsMinor)}</b>
          </div>
          {tipsOffered ? (
            <div className="ro-sum">
              <span>{w.tip}</span>
              <b>{money(totals.tipMinor)}</b>
            </div>
          ) : null}
          <div className="ro-sum is-big">
            <span>{w.total}</span>
            <b>{money(totals.totalMinor)}</b>
          </div>
          <p className="ro-allergy">{w.legalPrices}</p>
          {paying.processor === null ? null : (
            <p className="ro-allergy">{w.legalProcessor(paying.processor, paying.venueName)}</p>
          )}
          {asking === null ? (
            <button
              type="button"
              className="ro-primary is-wide"
              data-slot="pay.start"
              disabled={block !== null || busy}
              onClick={() => {
                const ago = sameAmountAgo(paying.recent, totals.totalMinor)
                if (ago !== null) setAsking(ago)
                else void start()
              }}
            >
              <span>{w.payX(money(totals.totalMinor))}</span>
            </button>
          ) : (
            <div className="ro-notice" role="alertdialog" data-slot="pay.same">
              <span>{w.sameQuestion(asking)}</span>
              <button type="button" className="ro-primary" onClick={() => void start()}>
                {w.sameYes}
              </button>
              <button type="button" className="ro-ghost" onClick={() => setAsking(null)}>
                {w.sameNo}
              </button>
            </div>
          )}
          {blockWords === null ? null : (
            <p className="ro-notice" role="status" data-slot="pay.blocked">
              {blockWords}
            </p>
          )}
        </>
      )}
      <PaidInApp lines={bill.paidLines} money={money} />
      {refusal === null ? null : (
        <p className="ro-notice is-bad" role="alert">
          {refusal}
        </p>
      )}
    </div>
  )
}

/**
 * One screen of a payment. The screen changes under the guest's finger (the button they pressed is
 * gone), so each new screen takes the focus itself, which keeps it inside the sheet and lets a
 * screen reader read what the screen says.
 */
function Screen({
  kind,
  end,
  children,
}: {
  readonly kind: string
  readonly end?: string
  readonly children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the screen is a new one when its kind or end changes
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
  }, [kind, end])
  return (
    <div
      className="ro-sheet"
      ref={root}
      tabIndex={-1}
      data-pay-screen={kind}
      {...(end === undefined ? {} : { 'data-pay-end': end })}
    >
      {children}
    </div>
  )
}

/** Call a waiter: the way on from every failure screen of paying (D127), where the venue takes calls. */
function CallWaiter() {
  const o = useServicesRequired()
  if (o.features.callWaiter === null) return null
  return (
    <button
      type="button"
      className="ro-ghost"
      data-slot="pay.call"
      onClick={() =>
        void o.run({
          kind: 'service.request',
          actionId: newActionId(),
          request: 'waiter',
          note: '',
        })
      }
    >
      {o.words.paying.callWaiter}
    </button>
  )
}

/** This phone's payment, from "Preparing your bill…" to its end. */
function PaymentScreen({
  payment,
  money,
}: {
  readonly payment: PaymentView
  readonly money: (minor: number) => string
}) {
  const o = useServicesRequired()
  const { words, run, binding } = o
  const w = words.paying
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
  const dismiss = () => binding.payControls?.dismiss()
  const confirmation = confirmationOf({
    payment,
    venueName: o.state.paying?.venueName ?? null,
    locale: o.locale,
    words: w,
    otherItem: words.otherItem,
  })
  const call = <CallWaiter />
  const back = (
    <button type="button" className="ro-ghost" data-slot="pay.back" onClick={dismiss}>
      {w.backToBill}
    </button>
  )
  const priced = (
    <>
      <ul className="ro-lines" data-slot="pay.lines">
        {payment.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a payment's lines have no id of their own
          <li key={index}>
            {lineNameText(line.name, o.locale, words.otherItem)}
            {mark(line.quantity)} · {money(line.amountMinor)}
          </li>
        ))}
      </ul>
      <div className="ro-sum">
        <span>{w.tip}</span>
        <b>{money(payment.tipMinor)}</b>
      </div>
      {payment.amountMinor === null ? null : (
        <div className="ro-sum is-big">
          <span>{w.total}</span>
          <b>{money(payment.amountMinor)}</b>
        </div>
      )}
    </>
  )
  switch (screen.kind) {
    case 'preparing':
    case 'card':
      return (
        <Screen kind={screen.kind}>
          {screen.kind === 'preparing' ? (
            <StatePanel tone="wait" title={w.preparing} />
          ) : (
            <>
              {priced}
              <p className="ro-allergy">{w.legalPrices}</p>
              {binding.payForm === undefined || payment.amountMinor === null ? null : (
                <FormSlot
                  slot={binding.payForm}
                  label={w.payX(money(payment.amountMinor))}
                  locale={o.locale}
                  failedText={w.cardFormFailed}
                />
              )}
            </>
          )}
          <button
            type="button"
            className="ro-ghost"
            data-slot="pay.later"
            onClick={async () => {
              setRefusal(null)
              const outcome = await run({ kind: 'pay.cancel', actionId: newActionId() })
              if (!outcome.ok) setRefusal(words.refusedOther)
              else if (outcome.result.status === 'accepted') dismiss()
              else {
                // After the hold there is no cancel (`too_late`): the screen follows the payment.
                setRefusal(refusalText(words, outcome.result.code, { command: 'pay.cancel' }))
              }
            }}
          >
            {w.payLater}
          </button>
          {call}
          {refusal === null ? null : (
            <p className="ro-notice is-bad" role="alert">
              {refusal}
            </p>
          )}
        </Screen>
      )
    case 'waiting':
      return (
        <Screen kind="waiting">
          <StatePanel tone="wait" title={w.waiting} />
        </Screen>
      )
    case 'paid':
      return (
        <Screen kind="paid">
          <StatePanel tone="ok" title={w.paid}>
            {confirming && confirmation !== null ? (
              <Confirmation
                view={confirmation}
                id={CONFIRMATION_ID}
                closeLabel={w.sameNo}
                failedText={w.confirmSaveFailed}
                onClose={() => setConfirming(false)}
              />
            ) : (
              <>
                <p>{w.paidNumber}</p>
                <p className="ro-pay-number" data-slot="pay.number">
                  {payment.number}
                </p>
                {o.tableLabel === null || o.tableLabel.trim() === '' ? null : (
                  <p data-slot="pay.table">{o.guest.table(o.tableLabel)}</p>
                )}
                {priced}
                <p>{w.paidReceipt}</p>
              </>
            )}
            {confirmation === null || confirming ? null : (
              <button
                type="button"
                className="ro-ghost"
                data-slot="pay.confirmation.toggle"
                ref={toggle}
                aria-expanded={false}
                aria-controls={CONFIRMATION_ID}
                onClick={() => setConfirming(true)}
              >
                {w.confirmTitle}
              </button>
            )}
            {back}
          </StatePanel>
        </Screen>
      )
    case 'checking':
      return (
        <Screen kind="checking">
          <StatePanel tone="plain" title={w.checkingTitle} hint={w.checkingBody}>
            {call}
            {back}
          </StatePanel>
        </Screen>
      )
    case 'ended':
      return (
        <Screen kind="ended" end={screen.end}>
          <StatePanel
            tone="bad"
            title={endText(
              w,
              screen.end,
              o.state.paying == null ? null : money(o.state.paying.minCardMinor),
            )}
          >
            {screen.again ? (
              <button
                type="button"
                className="ro-primary is-wide"
                data-slot="pay.again"
                onClick={dismiss}
              >
                <span>{w.payAgain}</span>
              </button>
            ) : null}
            {call}
            {back}
          </StatePanel>
        </Screen>
      )
  }
}
