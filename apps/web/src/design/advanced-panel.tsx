'use client'

// One part page of the Design panel in Advanced (D129, D130, D159): the options of General or of one
// of the thirteen component pages, opened from the list of parts (`part-rows.tsx`). Everything on it
// is drawn from the contract file (`DESIGN_PAGES`): its options, their labels and their values. A
// choice option is a row of tiles (`option-tiles.tsx`). General holds only its own seven options:
// the Style, the colours and the fonts are rows of the list (`optionsOfPage`).
import type { DesignChoiceOption, DesignPage, DesignValues, VenueTheme } from '@restro/core'

import { optionsOfPage, rowStateOf } from './advanced-model'
import { OptionTiles } from './option-tiles'
import type { Draft } from './preview-draft'

export function AdvancedPanel({
  venueId,
  locale,
  page,
  values,
  theme,
  draft,
  scheme,
  canEdit,
  onPick,
}: {
  venueId: string
  locale: 'bg' | 'en'
  /** The contract's page to show; a test hands in a page with an option more. */
  page: DesignPage
  values: DesignValues
  theme: VenueTheme
  draft: Draft
  scheme: 'light' | 'dark'
  canEdit: boolean
  onPick: (pageId: string, optionId: string, value: string) => void
}) {
  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
      data-testid="design-advanced-panel"
      data-page={page.id}
    >
      {optionsOfPage(page).map((option) => {
        if (option.kind !== 'choice') return null
        return (
          <OptionTiles
            key={option.id}
            venueId={venueId}
            locale={locale}
            page={page}
            option={option as DesignChoiceOption}
            values={values}
            theme={theme}
            draft={draft}
            scheme={scheme}
            state={rowStateOf(values, page.id, option.id)}
            canEdit={canEdit}
            onPick={(value) => onPick(page.id, option.id, value)}
          />
        )
      })}
    </div>
  )
}
