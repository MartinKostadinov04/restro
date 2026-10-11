// The receipt page (`#receipt`). It draws the host's `state.receipt` and nothing else: the lines it
// covers, the VAT it states, the tip, the total, the method and its references. The PDF, email and
// print buttons appear only for the actions the receipt says it supports, and each sends
// `receipt.action`; what the page says afterwards is the host's answer.

import type { ReceiptAction, ViewText } from '@restro/shell'
import { useEffect, useRef, useState } from 'react'

import { Text } from '../parts'
import { newActionId, type Outcome } from './command'
import { useServicesRequired } from './provider'

/** The receipt actions, in the order of their buttons. */
const ACTIONS: readonly ReceiptAction[] = ['pdf', 'email', 'print']

/** What the page says about the last try of one action. */
type Feedback =
  | { readonly phase: 'sending' }
  | { readonly phase: 'done'; readonly message: ViewText | null }
  | { readonly phase: 'failed'; readonly message: ViewText | null }

export function ReceiptPage() {
  const o = useServicesRequired()
  const { words, state, locale } = o
  const receipt = state.receipt
  const [feedback, setFeedback] = useState<Partial<Record<ReceiptAction, Feedback>>>({})
  const ids = useRef(new Map<ReceiptAction, string>())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  if (receipt === null) {
    return (
      <div className="ro-page">
        <h2>{words.receipt}</h2>
        <p className="ro-empty">{words.noReceipt}</p>
      </div>
    )
  }

  const labels: { readonly [A in ReceiptAction]: string } = {
    pdf: words.downloadPdf,
    email: words.email,
    print: words.print,
  }

  async function act(action: ReceiptAction, receiptId: string) {
    if (feedback[action]?.phase === 'sending') return
    // A retry after no answer is the same action; once the host has answered, the next tap is a new one.
    const actionId = ids.current.get(action) ?? newActionId()
    ids.current.set(action, actionId)
    setFeedback((now) => ({ ...now, [action]: { phase: 'sending' } }))
    let outcome: Outcome = { ok: false }
    try {
      outcome = await o.run({ kind: 'receipt.action', actionId, receiptId, action })
    } catch {
      outcome = { ok: false }
    }
    if (!alive.current) return
    if (outcome.ok) ids.current.delete(action)
    const next: Feedback = !outcome.ok
      ? { phase: 'failed', message: null }
      : outcome.result.status === 'rejected'
        ? { phase: 'failed', message: outcome.result.message }
        : { phase: 'done', message: outcome.result.message }
    setFeedback((now) => ({ ...now, [action]: next }))
  }

  const shown = ACTIONS.filter((action) => receipt.actions[action])
  const last = ACTIONS.map((action) => feedback[action]).find(
    (entry) => entry !== undefined && entry.phase !== 'sending',
  )

  return (
    <div className="ro-page">
      <h2>{words.receipt}</h2>
      <div className="ro-sheet">
        <article className="ro-receipt" aria-label={words.receipt}>
          <header>
            <strong>{receipt.venueName}</strong>
            {receipt.tableLabel === null ? null : (
              <span>
                {words.table} {receipt.tableLabel}
              </span>
            )}
            <span>
              {words.date}: {receipt.issuedAt}
            </span>
          </header>
          <ul>
            {receipt.lines.map((line) => (
              <li key={line.id}>
                <span>
                  {line.qty}× <Text value={line.name} page={locale} />
                </span>
                <b>{line.total.text}</b>
              </li>
            ))}
          </ul>
          <dl>
            {receipt.vat.map((line) => (
              <div key={line.rate}>
                <dt>{words.vatIncluded(line.rate)}</dt>
                <dd>{line.amount.text}</dd>
              </div>
            ))}
            <div>
              <dt>{words.tip}</dt>
              <dd>{receipt.tip.text}</dd>
            </div>
            <div className="is-total">
              <dt>{words.total}</dt>
              <dd>{receipt.total.text}</dd>
            </div>
            <div>
              <dt>{words.method}</dt>
              <dd>{words.methods[receipt.method]}</dd>
            </div>
            {receipt.fiscalReference === null ? null : (
              <div>
                <dt>{words.fiscal}</dt>
                <dd>{receipt.fiscalReference}</dd>
              </div>
            )}
          </dl>
          <p className="ro-ref">{words.reference(receipt.reference)}</p>
        </article>
        {shown.length === 0 ? null : (
          <div className="ro-methods">
            {shown.map((action) => (
              <button
                type="button"
                key={action}
                className="ro-ghost"
                disabled={feedback[action]?.phase === 'sending'}
                onClick={() => act(action, receipt.id)}
              >
                {labels[action]}
              </button>
            ))}
          </div>
        )}
        {last === undefined ? null : (
          <p className="ro-toast" role={last.phase === 'failed' ? 'alert' : 'status'}>
            {last.message !== null ? (
              <Text value={last.message} page={locale} />
            ) : last.phase === 'failed' ? (
              words.receiptActionFailed
            ) : (
              words.receiptActionDone
            )}
          </p>
        )}
      </div>
    </div>
  )
}
