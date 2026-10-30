// The "+" on a dish card. It is drawn only when the venue switched ordering on (R15), the host
// bound its services, and this item has ordering controls (R11). A dish with a required choice
// opens its page instead of adding, where the POS's ticket takes choices (#78); where it does not,
// the card says "Order this from your waiter" in its place. A plain dish goes onto the table's
// order, and the button then turns into a counter that edits that line.

import { needsChoices, type ViewItem } from '@restro/shell'

import { PlusIcon } from '../icons'
import { Stepper } from './parts'
import { useServices } from './provider'

export function QuickAdd({ item }: { readonly item: ViewItem }) {
  const o = useServices()
  if (o === null || !o.canOrder(item)) return null
  const { words, order } = o

  // Where the ticket takes no options, an item that needs a choice is ordered from the waiter.
  if (!o.notesAndOptions && needsChoices(item)) {
    return (
      <div className="ro-quick">
        <p className="ro-quick-note" data-slot="item.order_from_waiter">
          {words.orderFromWaiter}
        </p>
      </div>
    )
  }

  const mine = order.lines.filter((line) => line.itemId === item.id)
  const total = mine.reduce((sum, line) => sum + line.qty, 0)
  const plain = mine.find(
    (line) => line.optionIds.length === 0 && line.note === '' && line.mode === 'on_bill',
  )
  if (plain !== undefined && !needsChoices(item) && !plain.held) {
    return (
      <div className="ro-quick">
        <Stepper
          size="sm"
          value={plain.qty}
          label={item.name.text}
          words={words}
          onChange={(qty) => void o.change(plain.id, qty - plain.qty)}
        />
      </div>
    )
  }
  return (
    <div className="ro-quick">
      <button
        type="button"
        className="ro-plus"
        data-slot="item.add"
        aria-label={words.addNamed(item.name.text)}
        onClick={(event) => {
          if (needsChoices(item)) o.openDish(item.id, event.currentTarget)
          else void o.add(item)
        }}
      >
        <PlusIcon />
        {total > 0 ? <span className="ro-plus-count">{total}</span> : null}
      </button>
    </div>
  )
}
