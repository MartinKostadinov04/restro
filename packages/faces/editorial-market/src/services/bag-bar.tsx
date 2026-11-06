// The bar at the bottom of the page: the waiter button, and the bag button once the table's order
// has something to look at. The waiter button is the `menu.call_waiter` slot and the bag's place the
// `menu.bag` slot; each exists only while the view model has its feature on (R15, fail-closed).
// The bag's place is there with an empty order too (the quick-add buttons are how an order starts);
// it holds the button once there is something to open: lines, a removed line's Undo, the earlier
// order, a sent order, a lost Send, or the reason the order is hidden (no location pass). The bar
// is hidden while a sheet is open. The last refusal of an order command shows over the bar when no
// sheet is open (inside the bag sheet it shows there).

import { callIsSingleStep, paymentIsFinal } from '@restro/shell'

import { HandIcon } from '../icons'
import { orderBusy, useServices } from './provider'

/**
 * The slim line at the top of the menu while this phone has a payment that has not settled and its
 * sheet is closed (#293, DA-24; Martin 11-06): a closed browser or a redirect return brings the
 * guest back to the menu with the payment still going, and nothing on the page said so. A tap opens
 * the screen the payment is on, which is the bag for a pay-first round and the pay sheet for the
 * bill's lines. It states no outcome of its own (D72): the payment's own screen does that.
 */
export function PaymentProgress() {
  const o = useServices()
  if (o === null) return null
  const payment = o.state.payment ?? null
  if (payment === null || paymentIsFinal(payment) || o.sheet !== null) return null
  const sheet = payment.mode === 'pay_first' ? 'bag' : 'pay'
  if (!(sheet === 'bag' ? o.features.ordering : o.features.pay)) return null
  return (
    <button
      type="button"
      className="ro-payline"
      data-slot="menu.pay_progress"
      onClick={(event) => o.openSheet(sheet, event.currentTarget)}
    >
      {o.words.paying.inProgress}
    </button>
  )
}

export function ServiceBar() {
  const o = useServices()
  if (o === null) return null
  const { features, words, order } = o
  if (features.callWaiter === null && !features.ordering) return null
  const filled = orderBusy(o)
  // While a sheet is open the bar is hidden, not removed: the button that opened the sheet gets the
  // focus back when it closes.
  return (
    <>
      {o.notice !== null && o.sheet === null ? (
        <div role="alert" data-order-notice="">
          <button type="button" className="ro-barnote" onClick={o.dismissNotice}>
            {o.notice}
          </button>
        </div>
      ) : null}
      <div className="ro-bagbar" data-bag={filled ? 'true' : 'false'} hidden={o.sheet !== null}>
        {features.callWaiter === null ? null : (
          <button
            type="button"
            className="ro-waiter"
            data-slot="menu.call_waiter"
            aria-label={words.callServer}
            onClick={(event) => {
              // With only `waiter` ticked the tap calls at once (D127): the sheet sends it as it opens.
              if (callIsSingleStep(features.callWaiter)) o.armCall()
              o.openSheet('call', event.currentTarget)
            }}
          >
            <HandIcon />
            <span>{words.bell}</span>
          </button>
        )}
        {features.ordering ? (
          <div className="ro-bagslot" data-slot="menu.bag" data-design-part="order.bar">
            {filled ? (
              <button
                type="button"
                className="ro-bagbtn"
                onClick={(event) => o.openSheet('bag', event.currentTarget)}
              >
                {order.count > 0 ? (
                  <span className="ro-count" key={order.count}>
                    {order.count}
                  </span>
                ) : (
                  <span aria-hidden="true" />
                )}
                <span>{words.viewBag}</span>
                {order.count > 0 ? (
                  <b>
                    {words.approx} {order.resolved.total.text}
                  </b>
                ) : null}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )
}
