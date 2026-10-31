// The bar at the bottom of the page: the waiter button, and the bag button once the table's order
// has something to look at. The waiter button is the `menu.call_waiter` slot and the bag's place the
// `menu.bag` slot; each exists only while the view model has its feature on (R15, fail-closed).
// The bag's place is there with an empty order too (the quick-add buttons are how an order starts);
// it holds the button once there is something to open: lines, a removed line's Undo, the earlier
// order, a sent order, a lost Send, or the reason the order is hidden (no location pass). The bar
// is hidden while a sheet is open. The last refusal of an order command shows over the bar when no
// sheet is open (inside the bag sheet it shows there).

import { callIsSingleStep } from '@restro/shell'

import { HandIcon } from '../icons'
import { orderBusy, useServices } from './provider'

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
