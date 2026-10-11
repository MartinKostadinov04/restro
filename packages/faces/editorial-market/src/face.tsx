// The Editorial Market face: a photo-led guest menu for a phone. It draws a view model and nothing
// else (the shell has already decided what is shown, in what order and in what state). Top to
// bottom: the venue bar, the menu title, a sticky category rail, the sections (the first one as a
// photo-led strip) with the layout switch under the next section's title, and the allergen
// information footer. A tap on an item opens its dish page, a tap on its allergen codes opens the
// allergen sheet, and the filter button opens the filter sheet.
//
// Ported from the designer's delivery of 2026-10-11 (docs/design/faces/editorial-market): the same
// design, classes and CSS, rewritten as readable, strict TypeScript. Browsing only; the ordering
// screens of the delivery are not part of this face yet.

import type { FaceHostProps, ViewItem } from '@restro/shell'
import { stringsFor } from '@restro/shell'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AllergenSheet } from './allergen-sheet'
import { CategoryRail } from './category-rail'
import { EDITORIAL_CSS } from './css'
import { DishPage } from './detail'
import { type FilterKind, FilterSheet } from './filters'
import { Header } from './header'
import { LayoutSwitch } from './layout-switch'
import {
  allItems,
  bcp47,
  countVisible,
  type Filters,
  hasVisibleItems,
  isFiltering,
  langOf,
  matchesFilters,
  NO_FILTERS,
  readOptions,
  themeVariables,
  toggled,
} from './model'
import type { PageContext } from './parts'
import { SectionBlock } from './section'
import { useDishRoute } from './use-dish-route'
import { useLayout } from './use-layout'

/** What the host gives the face besides the view model: the same props for every face. */
export type EditorialMarketFaceProps = FaceHostProps

/** The allergen sheet that is open: for which item, and whether it was opened from the dish page. */
interface AllergenState {
  readonly itemId: string
  readonly fromDish: boolean
}

/** The Editorial Market menu. */
export function EditorialMarketFace(props: EditorialMarketFaceProps) {
  const {
    view,
    assetBase = '/cdn',
    languages = [],
    onLanguageChange,
    tableLabel = null,
    fontStacks,
    scheme = 'auto',
  } = props
  const options = readOptions(props.options)
  const locale = view.locale
  const strings = stringsFor(locale).guest

  // The guest's filters. A chip that left the menu (a language or a refresh changed the lists)
  // cannot stay switched on.
  const [chosen, setChosen] = useState<Filters>(NO_FILTERS)
  const filters = useMemo<Filters>(() => {
    const dietary = new Set<string>(view.filters.dietary.map((label) => label.code))
    const tags = new Set<string>(view.filters.tags.map((tag) => tag.id))
    return {
      dietary: new Set([...chosen.dietary].filter((code) => dietary.has(code))),
      tags: new Set([...chosen.tags].filter((id) => tags.has(id))),
    }
  }, [chosen, view.filters])

  const [layout, chooseLayout] = useLayout(options.layout, options.layoutSwitch)
  const dish = useDishRoute()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [allergens, setAllergens] = useState<AllergenState | null>(null)
  const filterOpener = useRef<HTMLElement | null>(null)
  const allergenOpener = useRef<HTMLElement | null>(null)

  const items = useMemo(() => allItems(view.sections), [view.sections])
  const dishItem = items.find((item) => item.id === dish.shownId)
  const allergenItem =
    allergens === null ? undefined : items.find((item) => item.id === allergens.itemId)

  // Updates are functions of the previous choice, so two quick taps never undo each other.
  const toggleFilter = useCallback((kind: FilterKind, key: string) => {
    setChosen((current) => ({ ...current, [kind]: toggled(current[kind], key) }))
  }, [])
  const clearFilters = useCallback(() => setChosen(NO_FILTERS), [])
  const openFilters = useCallback((opener: HTMLElement) => {
    filterOpener.current = opener
    setFiltersOpen(true)
  }, [])
  const closeFilters = useCallback(() => {
    setFiltersOpen(false)
    filterOpener.current?.focus({ preventScroll: true })
  }, [])
  const openAllergens = useCallback((itemId: string, opener: HTMLElement) => {
    allergenOpener.current = opener
    setAllergens({ itemId, fromDish: opener.closest('.rm-overlay') !== null })
  }, [])
  const closeAllergens = useCallback(() => {
    setAllergens(null)
    allergenOpener.current?.focus({ preventScroll: true })
  }, [])

  // The allergen sheet of a dish page goes with the page (the phone's back button closes both).
  useEffect(() => {
    if (allergens?.fromDish === true && !dish.isOpen) setAllergens(null)
  }, [allergens, dish.isOpen])

  // Escape closes the topmost dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (allergens !== null) closeAllergens()
      else if (dish.isOpen) dish.close()
      else if (filtersOpen) closeFilters()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allergens, dish.isOpen, dish.close, filtersOpen, closeAllergens, closeFilters])

  const ctx = useMemo<PageContext>(
    () => ({
      locale,
      strings,
      assetBase,
      isVisible: (item: ViewItem) => matchesFilters(item, filters),
      openDish: dish.open,
      openAllergens,
    }),
    [locale, strings, assetBase, filters, dish.open, openAllergens],
  )

  // The first section is the photo-led strip, unless the venue turned that off. The layout switch
  // sits under the title of the first section after it that still has something to show.
  const featureIndex = options.featureFirstSection ? 0 : -1
  const switchIndex = options.layoutSwitch
    ? view.sections.findIndex(
        (section, index) =>
          index !== featureIndex && (!isFiltering(filters) || hasVisibleItems(section, filters)),
      )
    : -1
  const nothingMatches = isFiltering(filters) && countVisible(view.sections, filters) === 0

  return (
    <div
      className="rm"
      data-face="editorial-market"
      data-layout={layout}
      data-scheme={scheme}
      lang={bcp47(locale)}
      style={themeVariables(view.theme, fontStacks) as CSSProperties}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant stylesheet from css.ts, no user input; React would escape `>` and quotes in it */}
      <style dangerouslySetInnerHTML={{ __html: EDITORIAL_CSS }} />
      <Header
        view={view}
        ctx={ctx}
        tableLabel={tableLabel}
        languages={languages}
        onLanguageChange={onLanguageChange}
        hasFilters={view.filters.dietary.length > 0 || view.filters.tags.length > 0}
        onOpenFilters={openFilters}
      />
      {view.sections.length > 1 ? (
        <CategoryRail
          sections={view.sections}
          filters={filters}
          label={strings.sections}
          page={locale}
        />
      ) : null}
      <main>
        {view.sections.map((section, index) => (
          <SectionBlock
            key={section.id}
            section={section}
            ctx={ctx}
            filters={filters}
            feature={index === featureIndex}
            tools={
              index === switchIndex ? (
                <LayoutSwitch layout={layout} onChange={chooseLayout} strings={strings} />
              ) : undefined
            }
          />
        ))}
        {nothingMatches ? (
          <div className="rm-empty" role="status">
            <p>{strings.noMatches}</p>
            <button type="button" className="rm-clear" onClick={clearFilters}>
              {strings.clearFilters}
            </button>
          </div>
        ) : null}
      </main>
      {view.allergenLegend.length > 0 ? (
        <footer className="rm-footer">
          <h2>{strings.footerTitle}</h2>
          <p>{strings.footerText}</p>
          <div className="rm-legend" data-slot="menu.allergen_legend">
            {view.allergenLegend.map((allergen) => (
              <span key={allergen.code} lang={langOf(allergen.label, locale)}>
                <b>{allergen.number}</b>
                {allergen.label.text}
              </span>
            ))}
          </div>
        </footer>
      ) : null}
      {filtersOpen ? (
        <FilterSheet
          dietary={view.filters.dietary.map((label) => ({ key: label.code, label: label.label }))}
          tags={view.filters.tags.map((tag) => ({ key: tag.id, label: tag.label }))}
          filters={filters}
          onToggle={toggleFilter}
          onClear={clearFilters}
          onClose={closeFilters}
          strings={strings}
          page={locale}
        />
      ) : null}
      {dishItem !== undefined ? (
        <DishPage item={dishItem} ctx={ctx} leaving={dish.leaving} onClose={dish.close} />
      ) : null}
      {allergenItem !== undefined ? (
        <AllergenSheet
          item={allergenItem}
          legend={view.allergenLegend}
          strings={strings}
          page={locale}
          onClose={closeAllergens}
        />
      ) : null}
    </div>
  )
}
