// The bag sheet (`#bag`): the table's shared order (D117, D121). Every phone at the table sees and
// edits the same lines, so the sheet draws `state.order` and marks no line as "mine"; the face
// keeps no draft of its own and shows what the host's state says (D72). Names and prices are looked
// up in the current view model whenever it is drawn, so a price change or a sold-out dish shows at
// once. The total is an estimate, labelled so; the bill that follows is the host's.
//
// From top to bottom: the weak-connection line or D120's lost-Send line, why the order is hidden
// (no location pass), the host's words when ordering is paused, the table closed, last orders or
// the venue closed for tonight, the last refusal, the lines (each with its steppers and Remove, a
// removed line's Undo, the earlier order's Restore), Send (or the duplicate check) and the table's
// sent orders with their states and the "Show this to your waiter" card.
//
// Send says how many items go and waits for the host. A line the live overlay shows sold out, or
// that the POS refused as out of stock, stays on the order marked, and the button then says "Send
// the other N". There is no cancel after Send (D116). An error, a timeout or a lost answer keeps
// the order and says D120's line (call a waiter, with the reference where there is one): the order
// may already be in the POS, so there is no "Try again" and no re-send for a few minutes. While the
// phone is offline Send is greyed with the weak-connection line (D121).

import { orderingClosedText, sentWords } from '@restro/shell'
import { useState } from 'react'

import { Text } from '../parts'
import { StopLocationCheck } from './location-sheet'
import { Stepper } from './parts'
import { type Services, useServicesRequired } from './provider'

/** Whether the bill is drawn: the host has the table's bill or this phone's payment. */
function billShown(o: Services): boolean {
  return o.state.tableBill != null || o.state.payment != null
}

/** A line's name when only its item id is at hand: the menu's, or the hidden item's (D131). */
function lineName(o: Services, itemId: string): string {
  return (
    o.items.get(itemId)?.name.text ?? o.view.hiddenItems[itemId]?.name.text ?? o.words.otherItem
  )
}

/** The notices of the host about ordering itself: paused, closed, and the venue's night (#79, #82). */
function OrderingNotes({ o }: { readonly o: Services }) {
  const { words, state } = o
  const ordering = state.ordering?.state ?? 'on'
  const night = state.ordering?.night
  return (
    <>
      {ordering === 'paused' ? (
        <p className="ro-notice" data-slot="ordering.paused">
          {words.orderingPaused}
        </p>
      ) : null}
      {ordering === 'closed' ? (
        <p className="ro-notice" data-slot="ordering.closed">
          {orderingClosedText(state.ordering, words)}
        </p>
      ) : null}
      {night?.state === 'last_orders' && night.at !== null ? (
        <p className="ro-notice" data-last-orders="">
          {words.lastOrdersAt(night.at)}
        </p>
      ) : null}
      {night?.state === 'closed' ? (
        <p className="ro-notice" data-ordering-closed-tonight="">
          {words.orderingClosedTonight}
        </p>
      ) : null}
      {night?.state === 'opens_later' && night.at !== null ? (
        <p className="ro-notice" data-ordering-opens-later="">
          {words.orderingOpensAt(night.at)}
        </p>
      ) : null}
    </>
  )
}

/**
 * While the phone has no location pass the host has no order and no bill: why, and the guest's own
 * "Allow location" (it brings the consent sheet back after "Not now" or "Stop location check").
 * With a pass and no bill drawn, the stop control sits here; with a bill it sits on the bill.
 */
function LocationNotes({ o }: { readonly o: Services }) {
  const { words, state, binding } = o
  const location = state.location ?? null
  if (location === null || binding.location === undefined || location.prompt !== 'none') return null
  if (location.state === 'held') {
    return billShown(o) ? null : (
      <div data-location-prompt="none">
        <StopLocationCheck />
      </div>
    )
  }
  if (location.state !== 'needed') return null
  return (
    <div className="ro-notice" data-location-prompt="none">
      <span>{words.locationNeeded}</span>
      <button type="button" className="ro-ghost" onClick={() => binding.location?.reopen()}>
        {words.locationAllowAgain}
      </button>
    </div>
  )
}

/** The table's sent orders, each with its state, and the card to show a waiter (D116, D120, D122 §5). */
function SentOrders({ o }: { readonly o: Services }) {
  const { words, sentOrders, items } = o
  const [shown, setShown] = useState<string | null>(null)
  if (sentOrders.length === 0) return null
  const nameOf = (itemId: string) => items.get(itemId)?.name.text ?? words.otherItem
  const open = sentOrders.find((sent) => sent.id === shown) ?? null
  if (open !== null) {
    return (
      <div
        className="ro-waiter-card"
        role="dialog"
        aria-label={words.showWaiter}
        data-show-waiter=""
      >
        <p className="ro-waiter-ref">{open.ref}</p>
        <p>{open.sentClock}</p>
        <ul>
          {open.lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a sent order's lines never change or reorder
            <li key={`${line.itemId}-${index}`}>
              {line.qty} × {nameOf(line.itemId)}
            </li>
          ))}
        </ul>
        <button type="button" className="ro-ghost" onClick={() => setShown(null)}>
          {words.showWaiterClose}
        </button>
      </div>
    )
  }
  return (
    <section className="ro-sent" data-sent-orders="">
      <ul className="ro-lines">
        {sentOrders.map((sent) => (
          <li key={sent.id} data-sent-order={sent.id} data-sent-state={sent.state}>
            <div className="ro-line-main">
              <small>
                {sent.lines.map((line) => `${line.qty} × ${nameOf(line.itemId)}`).join(', ')}
              </small>
              <strong role="status" className={sent.state === 'unconfirmed' ? 'is-bad' : undefined}>
                {sentWords(sent, words)}
              </strong>
              <div className="ro-line-actions">
                <button type="button" onClick={() => setShown(sent.id)}>
                  {words.showWaiter}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function BagSheet() {
  const o = useServicesRequired()
  const { words, order, locale, state, sendLost, asked } = o
  const offline = state.offline === true
  const ordering = state.ordering?.state ?? 'on'
  const night = state.ordering?.night
  const phonesMayOrder =
    night === undefined || night.state === 'open' || night.state === 'last_orders'
  const hasLines = order.lines.length > 0

  return (
    <div
      className="ro-sheet"
      aria-busy={o.sending}
      data-slot="order.sheet"
      data-design-part="order"
    >
      {sendLost !== null ? (
        <div className="ro-notice is-bad" role="alert" data-slot="send.lost" data-send-lost="">
          <span>{words.sendLost}</span>
          {sendLost.ref === null ? null : <small>{words.reference(sendLost.ref)}</small>}
        </div>
      ) : offline ? (
        <p className="ro-notice" role="status" data-slot="send.offline">
          {words.offline}
        </p>
      ) : null}
      <LocationNotes o={o} />
      <OrderingNotes o={o} />
      {o.notice === null ? null : (
        <p className="ro-notice is-bad" role="alert" data-order-notice="">
          {o.notice}
        </p>
      )}

      {order.known && !hasLines ? <p className="ro-empty">{words.emptyOrder}</p> : null}
      {hasLines ? (
        <ul className="ro-lines">
          {order.resolved.lines.map((entry) => {
            const line = order.lines.find((candidate) => candidate.id === entry.line.key)
            if (line === undefined) return null
            const soldOut = order.soldOut(line.itemId)
            const name = entry.item?.name.text ?? entry.hidden?.name.text ?? words.otherItem
            return (
              <li
                key={line.id}
                data-order-line={line.id}
                data-item-id={line.itemId}
                data-qty={line.qty}
                data-pending={line.pending ? '' : undefined}
                data-sold-out={soldOut ? '' : undefined}
                data-available={entry.available && !soldOut ? 'true' : 'false'}
              >
                <div className="ro-line-main">
                  <strong>
                    {entry.item === null ? name : <Text value={entry.item.name} page={locale} />}
                  </strong>
                  {entry.options.length > 0 ? (
                    <small>
                      {entry.options.map((option, index) => (
                        <span key={option.id}>
                          {index > 0 ? ' · ' : ''}
                          <Text value={option.name} page={locale} />
                        </span>
                      ))}
                    </small>
                  ) : null}
                  {line.note === '' ? null : <small>“{line.note}”</small>}
                  {soldOut ? (
                    <small className="ro-flag">{words.lineSoldOut}</small>
                  ) : !entry.available ? (
                    <small className="ro-flag">{words.unavailableLine}</small>
                  ) : null}
                  {line.pending ? <small>{words.saving}</small> : null}
                  {line.mode === 'pay_first' ? <small>{words.orderFromWaiter}</small> : null}
                  {line.held ? <small>{words.heldLine}</small> : null}
                  {line.held ? null : (
                    <div className="ro-line-actions">
                      <button
                        type="button"
                        aria-label={`${words.remove}: ${name}`}
                        onClick={() => void o.remove(line.id)}
                      >
                        {words.remove}
                      </button>
                    </div>
                  )}
                </div>
                <div className="ro-line-side">
                  {entry.total === null ? null : <b>{entry.total.text}</b>}
                  {line.held ? null : (
                    <Stepper
                      size="sm"
                      value={line.qty}
                      label={name}
                      words={words}
                      onChange={(qty) => void o.change(line.id, qty - line.qty)}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {order.removed.map((line) => (
        <p key={line.id} className="ro-notice" data-removed-line={line.id}>
          <span>{words.removedNamed(lineName(o, line.itemId))}</span>
          <button type="button" className="ro-ghost" onClick={() => void o.undo(line.id)}>
            {words.undo}
          </button>
        </p>
      ))}
      {order.earlier === null ? null : (
        <section className="ro-notice" data-earlier-order="">
          <strong>{words.earlierOrder}</strong>
          <ul>
            {order.earlier.lines.map((line) => (
              <li key={line.id}>
                {lineName(o, line.itemId)} × {line.qty}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="ro-ghost"
            onClick={() => order.earlier !== null && void o.restore(order.earlier.setAsideAt)}
          >
            {words.restore}
          </button>
        </section>
      )}

      {hasLines ? (
        <div className="ro-sum">
          <span>{words.estimateTotal}</span>
          <b>{order.resolved.total.text}</b>
        </div>
      ) : null}
      {!o.notesAndOptions && hasLines ? (
        <p className="ro-allergy" data-notes-at-staff="">
          {words.notesAtStaff}
        </p>
      ) : null}

      {asked !== null ? (
        <div className="ro-notice" role="alertdialog" aria-modal="false" data-duplicate-check="">
          <span>
            {asked.minutes === null
              ? words.refusals.duplicate_order
              : words.duplicateAsk(asked.minutes)}
          </span>
          <button
            type="button"
            className="ro-primary"
            data-design-part="button"
            onClick={() => void o.sendOrder(asked.of)}
          >
            {words.sendAnother}
          </button>
          <button type="button" className="ro-ghost" onClick={o.cancelAsk}>
            {words.duplicateCancel}
          </button>
        </div>
      ) : order.sendCount > 0 && ordering === 'on' && phonesMayOrder && sendLost === null ? (
        <button
          type="button"
          className="ro-primary is-wide"
          data-design-part="button"
          data-send=""
          disabled={o.sending || offline}
          onClick={() => void o.sendOrder()}
        >
          {o.sending ? (
            <span>{words.sendingNow}</span>
          ) : (
            <span>
              {order.keptBack
                ? words.sendOthers(order.sendCount)
                : words.sendItems(order.sendCount)}
            </span>
          )}
        </button>
      ) : null}

      <SentOrders o={o} />
    </div>
  )
}
