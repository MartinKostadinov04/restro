// What the services add to the venue bar: the bill (`menu.bill`, with the table's total once there
// is a bill) and the pay entry (`menu.pay`). Each exists only while the view model has its feature
// on (R15, fail-closed). The total is the host's: `state.bill.total`, never a sum of the face's.

import { CardIcon, ReceiptIcon } from '../icons'
import { useServices } from './provider'

export function HeaderTools() {
  const o = useServices()
  if (o === null) return null
  const { features, words, state } = o
  const total = state.bill !== null && state.bill.rounds.length > 0 ? state.bill.total.text : null
  return (
    <>
      {features.bill ? (
        <button
          type="button"
          className="ro-pill"
          data-slot="menu.bill"
          aria-label={words.tab}
          onClick={(event) => o.openSheet('tab', event.currentTarget)}
        >
          <ReceiptIcon />
          <span>
            <span className="ro-billword">
              {words.bill}
              {total === null ? '' : ' · '}
            </span>
            {total}
          </span>
        </button>
      ) : null}
      {features.pay ? (
        <button
          type="button"
          className="rm-icon ro-payentry"
          data-slot="menu.pay"
          aria-label={words.payTitle}
          onClick={(event) => o.openSheet('pay', event.currentTarget)}
        >
          <CardIcon />
        </button>
      ) : null}
    </>
  )
}
