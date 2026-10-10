// The allergen sheet: a tap on an allergen code opens it, with the full names of that item's
// allergens highlighted and the whole legend of the menu below (R6: allergens are reachable).
// A plain accessible dialog: it takes the focus, closes on Escape or a tap outside, keeps the
// page from scrolling behind it, and hands the focus back (the caller does that on close).

import type { GuestStrings, ViewAllergen, ViewText } from '@restro/shell'
import { useEffect, useId, useRef } from 'react'

import { Text } from './item-card'
import { bcp47, type Locale } from './model'

/** What the sheet shows: the item it was opened for and that item's allergens. */
export interface SheetState {
  readonly itemName: ViewText
  readonly codes: readonly ViewAllergen['code'][]
}

export function AllergenSheet({
  state,
  legend,
  locale,
  strings,
  onClose,
}: {
  readonly state: SheetState
  readonly legend: readonly ViewAllergen[]
  readonly locale: Locale
  readonly strings: GuestStrings
  readonly onClose: () => void
}) {
  const titleId = useId()
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    close.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Tab') {
        // The close button is the only control: keep the focus on it.
        event.preventDefault()
        close.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  // The item's own allergens first, in legend order; the legend only has what is on the menu.
  const own = new Set<string>(state.codes)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape is handled on the document; this click only closes on a tap outside the sheet
    <div
      className="rq-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="rq-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-slot="menu.allergen_sheet"
      >
        <div className="rq-sheet-head">
          <div>
            <h2 id={titleId}>{strings.allergensTitle}</h2>
            <Text text={state.itemName} locale={locale} as="p" className="rq-sheet-sub" />
          </div>
          <button ref={close} type="button" className="rq-close" onClick={onClose}>
            {strings.close}
          </button>
        </div>
        <p className="rq-sheet-hint">{strings.allergensHint}</p>
        <ul className="rq-sheet-list">
          {legend.map((allergen) => (
            <li
              key={allergen.code}
              data-on={own.has(allergen.code) ? 'true' : 'false'}
              lang={allergen.label.lang === locale ? undefined : bcp47(allergen.label.lang)}
            >
              <span className="rq-allergen-code" aria-hidden="true">
                {allergen.number}
              </span>
              <span>{allergen.label.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
