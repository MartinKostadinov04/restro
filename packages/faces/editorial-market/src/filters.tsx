// The filter sheet: the dietary labels and tags that occur on this menu, as buttons that switch on
// and off. Dietary labels combine with AND (a dish must carry every chosen one), tags with OR (any
// chosen tag will do). Filtering only hides items; it never reorders them (R2).

import type { GuestStrings, Locale, ViewText } from '@restro/shell'

import { type Filters, langOf } from './model'
import { Overlay } from './overlay'

/** The two kinds of filter. */
export type FilterKind = keyof Filters

/** One button of the sheet. */
export interface Choice {
  readonly key: string
  readonly label: ViewText
}

function FilterGroup({
  title,
  choices,
  selected,
  onToggle,
  page,
}: {
  readonly title: string
  readonly choices: readonly Choice[]
  readonly selected: ReadonlySet<string>
  readonly onToggle: (key: string) => void
  readonly page: Locale
}) {
  return (
    <fieldset className="rm-filter-group">
      <legend>{title}</legend>
      {choices.map((choice) => (
        <button
          key={choice.key}
          type="button"
          lang={langOf(choice.label, page)}
          aria-pressed={selected.has(choice.key)}
          onClick={() => onToggle(choice.key)}
        >
          {choice.label.text}
        </button>
      ))}
    </fieldset>
  )
}

export function FilterSheet({
  dietary,
  tags,
  filters,
  onToggle,
  onClear,
  onClose,
  strings,
  page,
}: {
  readonly dietary: readonly Choice[]
  readonly tags: readonly Choice[]
  readonly filters: Filters
  readonly onToggle: (kind: FilterKind, key: string) => void
  readonly onClear: () => void
  readonly onClose: () => void
  readonly strings: GuestStrings
  readonly page: Locale
}) {
  return (
    <Overlay title={strings.filters} closeLabel={strings.close} onClose={onClose}>
      <p className="rm-overlay-intro">{strings.filterIntro}</p>
      {dietary.length > 0 ? (
        <FilterGroup
          title={strings.filterDiet}
          choices={dietary}
          selected={filters.dietary}
          onToggle={(key) => onToggle('dietary', key)}
          page={page}
        />
      ) : null}
      {tags.length > 0 ? (
        <FilterGroup
          title={strings.filterTags}
          choices={tags}
          selected={filters.tags}
          onToggle={(key) => onToggle('tags', key)}
          page={page}
        />
      ) : null}
      <button type="button" className="rm-clear" onClick={onClear}>
        {strings.clearFilters}
      </button>
    </Overlay>
  )
}
