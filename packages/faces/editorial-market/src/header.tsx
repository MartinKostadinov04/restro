// The top of the page: the venue bar (the logo when the venue has one, the table, the language
// switch, the filter button) and the title block (the menu title, its intro and, while the whole
// menu is outside its schedule, when it opens). Without a logo the bar shows nothing on the left:
// the title carries the identity.

import type { Locale, ViewModel } from '@restro/shell'
import type { ReactNode } from 'react'

import { FilterIcon } from './icons'
import { bcp47, langOf, languageLabel } from './model'
import { type PageContext, Photo, Text } from './parts'

export function Header({
  view,
  ctx,
  tableLabel,
  languages,
  onLanguageChange,
  hasFilters,
  onOpenFilters,
  tools = null,
}: {
  readonly view: ViewModel
  readonly ctx: PageContext
  readonly tableLabel: string | null
  readonly languages: readonly Locale[]
  readonly onLanguageChange: ((locale: Locale) => void) | undefined
  /** R15: the venue offers filters and the menu has dietary labels or tags to filter by. */
  readonly hasFilters: boolean
  readonly onOpenFilters: (opener: HTMLElement) => void
  /** More controls for the bar, before the filter button (the bill and the pay entry). */
  readonly tools?: ReactNode
}) {
  const { locale, strings, assetBase } = ctx
  const { logo } = view.theme
  const { title, intro, schedule } = view.menu
  return (
    <header className="rm-header" data-design-part="header">
      <div className="rm-brandline">
        {logo !== null ? (
          <Photo
            image={logo}
            assetBase={assetBase}
            page={locale}
            sizes={view.design.header?.logo_size === 'l' ? '144px' : '80px'}
            className="rm-logo"
            loading="eager"
            part="header.logo"
          />
        ) : null}
        <div className="rm-headtools">
          {tableLabel !== null && tableLabel.trim() !== '' ? (
            <span className="rm-table">{strings.table(tableLabel)}</span>
          ) : null}
          {languages.length > 1 ? (
            <fieldset
              className="rm-language"
              data-slot="menu.language"
              aria-label={strings.language}
            >
              {languages.map((code) => (
                <button
                  key={code}
                  type="button"
                  lang={bcp47(code)}
                  aria-pressed={view.locale === code}
                  onClick={() => onLanguageChange?.(code)}
                >
                  {languageLabel(code)}
                </button>
              ))}
            </fieldset>
          ) : null}
          {tools}
          {hasFilters ? (
            <button
              type="button"
              className="rm-icon"
              data-slot="menu.filters"
              aria-label={strings.filters}
              onClick={(event) => onOpenFilters(event.currentTarget)}
            >
              <FilterIcon />
            </button>
          ) : null}
        </div>
      </div>
      <div className="rm-titleblock" data-design-part="header.title">
        {title !== null ? (
          <Text as="h1" value={title} page={locale} />
        ) : (
          // A page needs a heading; a menu without a title is called "Menu".
          <h1>{strings.menu}</h1>
        )}
        {intro !== null ? <Text as="p" value={intro} page={locale} /> : null}
        {schedule !== null ? (
          <p className="rm-schedule" lang={langOf(schedule.text, locale)}>
            {strings.menuSchedule(schedule.text.text)}
          </p>
        ) : null}
      </div>
    </header>
  )
}
