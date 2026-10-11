// The pay sheet (`#pay`). The amounts are the host's: the guest picks how much of the table to pay
// (the whole table, an equal share, only their own), a tip and a promo code, each change sends
// `pay.quote`, and the sheet draws `state.quote` (subtotal, tip, VAT, total, and the only methods
// allowed). It computes nothing itself.
//
// Paying sends `pay.start` with the quote's id. The sheet says "Paid" only after the host accepted
// the payment AND its state holds a receipt that was not there before. A rejection, an error or a
// timeout never says paid: a rejection says the payment did not go through, and no answer says
// the outcome is unknown and offers the same attempt again (same `actionId`, so it cannot charge
// twice). Every await is in a try/catch, so the "processing" screen always clears.

import {
  PAY_METHODS,
  PAY_SCOPES,
  type PayMethod,
  type PayScope,
  parseMinor,
  SERVICE_LIMITS,
  type ViewText,
} from '@restro/shell'
import { useEffect, useRef, useState } from 'react'

import { Text } from '../parts'
import { type Choice, ChoiceGroup } from './choice'
import { newActionId, type Outcome } from './command'
import { StatePanel, Stepper } from './parts'
import { useServicesRequired } from './provider'

/** The guest's tip choice: the host's own default until they pick one. */
type Tip =
  | { readonly kind: 'host' }
  | { readonly kind: 'none' }
  | { readonly kind: 'percent'; readonly percent: number }
  | { readonly kind: 'custom' }

/** A tip button: none, a percentage the host offers (`p10`) or the custom amount. */
type TipKey = 'none' | 'custom' | `p${number}`

/** Where paying stands. */
type Step =
  | { readonly name: 'choose' }
  | { readonly name: 'processing'; readonly method: PayMethod }
  /** The host accepted the payment. It is paid once the host's state has the receipt. */
  | { readonly name: 'accepted'; readonly method: PayMethod }
  /** The host has the payment and has not decided. */
  | { readonly name: 'received'; readonly method: PayMethod }
  /** The host said no. */
  | { readonly name: 'failed'; readonly method: PayMethod; readonly message: ViewText | null }
  /** No usable answer (an error or a timeout): the payment may or may not have gone through. */
  | { readonly name: 'unknown'; readonly method: PayMethod }

export function PaySheet() {
  const o = useServicesRequired()
  const { words, state, locale, run } = o
  const quote = state.quote
  const owes = state.bill !== null && state.bill.total.minor > 0

  const [scope, setScope] = useState<PayScope>('full')
  const [people, setPeople] = useState<number>(SERVICE_LIMITS.peopleMin)
  const [tip, setTip] = useState<Tip>({ kind: 'host' })
  const [custom, setCustom] = useState('')
  const [promoText, setPromoText] = useState('')
  const [promo, setPromo] = useState<string | null>(null)
  const [quoting, setQuoting] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [requote, setRequote] = useState(0)
  const [step, setStep] = useState<Step>({ name: 'choose' })
  const attempt = useRef<{ readonly key: string; readonly actionId: string } | null>(null)
  const quoteIds = useRef(new Map<string, string>())
  const receiptBefore = useRef<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // What the quote is asked for. A tip the guest typed that is not an amount asks for the host's own.
  const params = {
    scope,
    people: scope === 'split' ? people : null,
    tipPercent: tip.kind === 'percent' ? tip.percent : tip.kind === 'none' ? 0 : null,
    tipMinor: tip.kind === 'custom' ? parseMinor(custom) : null,
    promo,
  }
  const paramsKey = JSON.stringify(params)
  const latest = useRef(params)
  latest.current = params
  const customTip = tip.kind === 'custom'

  // Ask the host for a quote on arrival and whenever the guest changes the scope, the people, the
  // tip or the promo code. The same question keeps its `actionId`, so a repeat is not a new one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `paramsKey` stands for the params the effect reads through `latest`; `requote` only re-runs it
  useEffect(() => {
    if (!owes) return
    let current = true
    const ask = async () => {
      const actionId = quoteIds.current.get(paramsKey) ?? newActionId()
      quoteIds.current.set(paramsKey, actionId)
      setQuoting('loading')
      let outcome: Outcome = { ok: false }
      try {
        outcome = await run({ kind: 'pay.quote', actionId, ...latest.current })
      } catch {
        outcome = { ok: false }
      }
      if (current)
        setQuoting(outcome.ok && outcome.result.status !== 'rejected' ? 'idle' : 'failed')
    }
    // A tip being typed waits for a pause; everything else is a tap.
    if (!customTip) {
      void ask()
      return () => {
        current = false
      }
    }
    const timer = window.setTimeout(ask, 500)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [paramsKey, owes, requote, customTip, run])

  async function pay(method: PayMethod) {
    if (quote === null || step.name === 'processing') return
    const key = `${quote.id}|${method}`
    // The same quote and method again (a retry) is the same payment; anything else is a new one.
    const retry = attempt.current?.key === key
    const actionId = retry && attempt.current !== null ? attempt.current.actionId : newActionId()
    attempt.current = { key, actionId }
    // The receipt that counts is one the host issues after this payment began: a retry of the same
    // payment keeps the point it began at.
    if (!retry) receiptBefore.current = state.receipt?.id ?? null
    setStep({ name: 'processing', method })
    let outcome: Outcome = { ok: false }
    try {
      outcome = await run({ kind: 'pay.start', actionId, quoteId: quote.id, method })
    } catch {
      outcome = { ok: false }
    }
    if (!alive.current) return
    if (!outcome.ok) {
      setStep({ name: 'unknown', method })
    } else if (outcome.result.status === 'accepted') {
      setStep({ name: 'accepted', method })
    } else if (outcome.result.status === 'rejected') {
      attempt.current = null // a definite no: the next try is a new payment
      setStep({ name: 'failed', method, message: outcome.result.message })
    } else {
      setStep({ name: 'received', method })
    }
  }

  // The receipt the host issued for this payment: one that was not in its state before.
  const receipt =
    state.receipt !== null && state.receipt.id !== receiptBefore.current ? state.receipt : null

  if (step.name === 'processing') {
    return (
      <StatePanel tone="wait" title={words.processing}>
        {quote === null ? null : <b>{quote.total.text}</b>}
      </StatePanel>
    )
  }
  if (step.name === 'accepted' && receipt !== null) {
    return (
      <StatePanel tone="ok" title={words.success} hint={words.successHint}>
        <button
          type="button"
          className="ro-primary is-wide"
          onClick={(event) => o.openSheet('receipt', event.currentTarget)}
        >
          <span>{words.viewReceipt}</span>
        </button>
        <button type="button" className="ro-ghost" onClick={o.closeSheet}>
          {words.done}
        </button>
      </StatePanel>
    )
  }
  if (step.name === 'accepted' || step.name === 'received') {
    const method = step.method
    return (
      <StatePanel tone="wait" title={words.processing} hint={words.payReceived}>
        {step.name === 'received' ? (
          <button type="button" className="ro-ghost" onClick={() => pay(method)}>
            {words.retry}
          </button>
        ) : null}
      </StatePanel>
    )
  }
  if (step.name === 'failed') {
    const method = step.method
    return (
      <StatePanel
        tone="bad"
        title={words.failure}
        hint={
          step.message === null ? words.failureHint : <Text value={step.message} page={locale} />
        }
      >
        <button type="button" className="ro-primary is-wide" onClick={() => pay(method)}>
          <span>{words.retry}</span>
        </button>
        <button type="button" className="ro-ghost" onClick={() => setStep({ name: 'choose' })}>
          {words.payWith}
        </button>
      </StatePanel>
    )
  }
  if (step.name === 'unknown') {
    const method = step.method
    return (
      <StatePanel tone="bad" title={words.payUnknown} hint={words.payUnknownHint}>
        <button type="button" className="ro-primary is-wide" onClick={() => pay(method)}>
          <span>{words.retry}</span>
        </button>
        <button type="button" className="ro-ghost" onClick={() => setStep({ name: 'choose' })}>
          {words.payWith}
        </button>
      </StatePanel>
    )
  }

  if (!owes) return <p className="ro-empty">{words.nothingToPay}</p>

  // The quote answers what the guest asked for; if the host answered something else, nothing is payable.
  const matches =
    quote !== null && quote.scope === scope && (scope !== 'split' || quote.people === people)
  const canPay = quote !== null && matches && quoting === 'idle'
  const tips = (quote?.tipOptions ?? []).filter(
    (option) =>
      Number.isInteger(option.percent) &&
      option.percent > 0 &&
      option.percent <= SERVICE_LIMITS.tipPercentMax,
  )
  // The tip buttons: none, the host's percentages, a custom amount.
  const tipChoices: Choice<TipKey>[] = [
    { key: 'none', label: words.noTip },
    ...tips.map((option) => ({ key: `p${option.percent}` as const, label: `${option.percent}%` })),
    { key: 'custom', label: words.custom },
  ]
  // Which one is on: the guest's pick, else the one whose amount is the host's own default.
  const hostTip = (): TipKey | null => {
    if (quote === null) return null
    if (quote.tip.minor === 0) return 'none'
    const same = tips.find((option) => option.amount.minor === quote.tip.minor)
    return same === undefined ? null : `p${same.percent}`
  }
  const tipChoice: TipKey | null =
    tip.kind === 'host'
      ? hostTip()
      : tip.kind === 'percent'
        ? `p${tip.percent}`
        : tip.kind === 'none'
          ? 'none'
          : 'custom'
  const chooseTip = (key: TipKey) => {
    if (key === 'none') setTip({ kind: 'none' })
    else if (key === 'custom') setTip({ kind: 'custom' })
    else setTip({ kind: 'percent', percent: Number(key.slice(1)) })
  }
  const methods = (quote?.methods ?? []).filter((method) => PAY_METHODS.includes(method))
  // The host takes promo codes when its quote has a promo slot, whether or not a code was tried.
  const promoSlot = quote === null ? null : quote.promo

  return (
    <div className="ro-sheet" aria-busy={quoting === 'loading'}>
      <h3 className="ro-h">{words.whatToPay}</h3>
      <ChoiceGroup
        label={words.whatToPay}
        className="ro-scope"
        value={scope}
        onChoose={setScope}
        choices={PAY_SCOPES.map((option) => ({
          key: option,
          label: <span>{words.scopes[option]}</span>,
        }))}
      />
      {scope === 'split' ? (
        <div className="ro-row">
          <span>{words.people}</span>
          <Stepper
            value={people}
            min={SERVICE_LIMITS.peopleMin}
            max={SERVICE_LIMITS.peopleMax}
            onChange={setPeople}
            label={words.people}
            words={words}
          />
        </div>
      ) : null}

      {tips.length > 0 ? (
        <>
          <h3 className="ro-h">{words.tip}</h3>
          <ChoiceGroup
            label={words.tip}
            className="ro-tips"
            value={tipChoice}
            onChoose={chooseTip}
            choices={tipChoices}
          />
          {tip.kind === 'custom' ? (
            <label className="ro-input">
              <span className="rm-sr">{words.customTip}</span>
              <input
                inputMode="decimal"
                value={custom}
                placeholder="0,00"
                aria-invalid={custom.trim() !== '' && parseMinor(custom) === null}
                onChange={(event) => setCustom(event.target.value)}
              />
            </label>
          ) : null}
        </>
      ) : null}

      {promoSlot === null ? null : (
        <details className="ro-acc" open={promoSlot.code !== '' ? true : undefined}>
          <summary>{words.promo}</summary>
          <div className="ro-promo">
            <input
              value={promoText}
              maxLength={SERVICE_LIMITS.promo}
              aria-label={words.promo}
              onChange={(event) => setPromoText(event.target.value)}
            />
            <button
              type="button"
              className="ro-ghost"
              onClick={() => setPromo(promoText.trim() === '' ? null : promoText.trim())}
            >
              {words.apply}
            </button>
          </div>
          {promoSlot.code === '' ? null : (
            <p className="ro-notice" role="status" data-accepted={promoSlot.accepted}>
              {promoSlot.accepted ? words.promoAccepted : words.promoRejected}
              {promoSlot.message === null ? null : (
                <>
                  {' '}
                  <Text value={promoSlot.message} page={locale} />
                </>
              )}
            </p>
          )}
        </details>
      )}

      <p className="ro-allergy">{words.allergyNote}</p>

      {quote === null ? (
        quoting === 'failed' ? (
          <div className="ro-notice is-bad" role="alert">
            <span>{words.quoteFailed}</span>
            <button type="button" className="ro-ghost" onClick={() => setRequote((n) => n + 1)}>
              {words.retry}
            </button>
          </div>
        ) : (
          <p className="ro-notice" role="status">
            {words.updatingQuote}
          </p>
        )
      ) : (
        <>
          <div className="ro-sum">
            <span>{words.subtotal}</span>
            <b>{quote.subtotal.text}</b>
          </div>
          {tips.length > 0 ? (
            <div className="ro-sum">
              <span>{words.tip}</span>
              <b>{quote.tip.text}</b>
            </div>
          ) : null}
          {quote.vat.map((line) => (
            <div className="ro-sum is-small" key={line.rate}>
              <span>{words.vatIncluded(line.rate)}</span>
              <b>{line.amount.text}</b>
            </div>
          ))}
          <div className="ro-sum is-big">
            <span>
              {words.total}
              {scope === 'split' ? ` (${words.perPerson})` : ''}
            </span>
            <b key={quote.total.minor}>{quote.total.text}</b>
          </div>
          {quoting === 'failed' ? (
            <div className="ro-notice is-bad" role="alert">
              <span>{words.quoteFailed}</span>
              <button type="button" className="ro-ghost" onClick={() => setRequote((n) => n + 1)}>
                {words.retry}
              </button>
            </div>
          ) : quoting === 'loading' ? (
            <p className="ro-notice" role="status">
              {words.updatingQuote}
            </p>
          ) : !matches ? (
            // The host has answered but its state still shows another quote: nothing is payable yet.
            <div className="ro-notice" role="status">
              <span>{words.updatingQuote}</span>
              <button type="button" className="ro-ghost" onClick={() => setRequote((n) => n + 1)}>
                {words.retry}
              </button>
            </div>
          ) : null}
          <div className="ro-methods">
            <h3 className="rm-sr">{words.payWith}</h3>
            {methods.map((method) => (
              <button
                type="button"
                key={method}
                className={
                  method === 'apple'
                    ? 'ro-pay is-apple'
                    : method === 'waiter'
                      ? 'ro-ghost'
                      : 'ro-pay'
                }
                disabled={!canPay}
                onClick={() => pay(method)}
              >
                {words.methods[method]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
