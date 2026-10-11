// The bar at the bottom of the page: the waiter button, and the bag button once the bag has
// something in it. The waiter button is the `menu.call_waiter` slot and the bag's place the
// `menu.bag` slot; each exists only while the view model has its feature on (R15, fail-closed).
// The bag's place is there with an empty bag too (the quick-add buttons are how a bag starts); it
// holds the button once there is something to look at. The bar hides while a sheet is open.

import { HandIcon } from '../icons'
import { useServices } from './provider'

export function ServiceBar() {
  const o = useServices()
  if (o === null || o.sheet !== null) return null
  const { features, words, resolved } = o
  if (features.callWaiter === null && !features.ordering) return null
  const filled = resolved.lines.length > 0
  return (
    <div className="ro-bagbar" data-bag={filled ? 'true' : 'false'}>
      {features.callWaiter === null ? null : (
        <button
          type="button"
          className="ro-waiter"
          data-slot="menu.call_waiter"
          aria-label={words.callServer}
          onClick={(event) => o.openSheet('call', event.currentTarget)}
        >
          <HandIcon />
          <span>{words.bell}</span>
        </button>
      )}
      {features.ordering ? (
        <div className="ro-bagslot" data-slot="menu.bag">
          {filled ? (
            <button
              type="button"
              className="ro-bagbtn"
              onClick={(event) => o.openSheet('bag', event.currentTarget)}
            >
              <span className="ro-count" key={resolved.count}>
                {resolved.count}
              </span>
              <span>{words.viewBag}</span>
              <b>
                {words.approx} {resolved.total.text}
              </b>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
