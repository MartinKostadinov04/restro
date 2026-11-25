// The allergen footer under the menu: its title, the line that explains the codes, and the legend of
// the allergens the menu names. The face draws it under its sections; the specimen view (D159) draws
// it under one dish, so both draw this one component.
import type { GuestStrings, ViewModel } from '@restro/shell'

import { langOf } from './model'

export function AllergenFooter({
  view,
  strings,
  allergenNames,
}: {
  readonly view: ViewModel
  readonly strings: GuestStrings
  /** The allergens are written out by name (Labels › Allergens), not as numbered codes. */
  readonly allergenNames: boolean
}) {
  if (view.allergenLegend.length === 0) return null
  return (
    <footer className="rm-footer" data-design-part="footer">
      <h2>{strings.footerTitle}</h2>
      <p>{allergenNames ? strings.footerTextNames : strings.footerText}</p>
      <div className="rm-legend" data-slot="menu.allergen_legend">
        {view.allergenLegend.map((allergen) => (
          <span key={allergen.code} lang={langOf(allergen.label, view.locale)}>
            {allergenNames ? null : <b>{allergen.number}</b>}
            {allergen.label.text}
          </span>
        ))}
      </div>
    </footer>
  )
}
