// The allergen sheet: a tap on an item's allergen codes (or on the info button of its dish page)
// opens it. It names every allergen of the menu by its number and sets the ones this item lists
// apart (R6: allergens are always reachable, with their meaning).

import type { GuestStrings, Locale, ViewAllergen, ViewItem } from '@restro/shell'

import { langOf } from './model'
import { Overlay } from './overlay'

export function AllergenSheet({
  item,
  legend,
  strings,
  page,
  onClose,
}: {
  readonly item: ViewItem
  readonly legend: readonly ViewAllergen[]
  readonly strings: GuestStrings
  readonly page: Locale
  readonly onClose: () => void
}) {
  const own = new Set<string>(item.allergens.map((allergen) => allergen.code))
  return (
    <Overlay title={strings.allergensTitle} closeLabel={strings.close} onClose={onClose}>
      <p className="rm-overlay-intro">{strings.allergensHint}</p>
      <div className="rm-allergen-sheet">
        {legend.map((allergen) => (
          <span
            key={allergen.code}
            className={own.has(allergen.code) ? 'is-present' : undefined}
            lang={langOf(allergen.label, page)}
          >
            <b>{allergen.number}</b>
            {allergen.label.text}
          </span>
        ))}
      </div>
    </Overlay>
  )
}
