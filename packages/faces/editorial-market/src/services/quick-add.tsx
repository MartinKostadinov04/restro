// The "+" on a dish card. It is drawn only when the venue switched ordering on (R15), the host
// bound its services, and this item has ordering controls (R11). A dish with a required choice
// opens its page instead of adding; a plain dish goes in the bag, and the button then turns into a
// counter.

import { needsChoices, type ViewItem } from '@restro/shell'

import { PlusIcon } from '../icons'
import { Stepper } from './parts'
import { useServices } from './provider'

export function QuickAdd({ item }: { readonly item: ViewItem }) {
  const o = useServices()
  if (o === null || !o.canOrder(item)) return null
  const { words, bag } = o

  const total = bag.filter((line) => line.itemId === item.id).reduce((sum, l) => sum + l.qty, 0)
  const plain = bag.find(
    (line) => line.itemId === item.id && line.optionIds.length === 0 && line.note === '',
  )
  if (plain !== undefined && !needsChoices(item)) {
    return (
      <div className="ro-quick">
        <Stepper
          size="sm"
          value={plain.qty}
          label={item.name.text}
          words={words}
          onChange={(qty) => o.editBag({ type: 'qty', key: plain.key, delta: qty - plain.qty })}
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
          else
            o.editBag({ type: 'add', line: { itemId: item.id, qty: 1, optionIds: [], note: '' } })
        }}
      >
        <PlusIcon />
        {total > 0 ? <span className="ro-plus-count">{total}</span> : null}
      </button>
    </div>
  )
}
