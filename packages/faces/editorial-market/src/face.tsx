// The Editorial Market face: a photo-led guest menu for a phone. It draws a view model and nothing
// else (the shell has already decided what is shown, in what order and in what state). Top to
// bottom: the venue bar, the menu title, a sticky category rail, the sections (each one the
// composer marks horizontal as a photo-led strip, D92) with the layout switch under the title of
// the first other section when the menu lets guests switch, and the allergen information footer. A tap on an item opens its dish page, a tap on its allergen codes opens the
// allergen sheet, and the filter button opens the filter sheet.
//
// Ported from the designer's delivery of 2026-10-11 (docs/design/faces/editorial-market): the same
// design, classes and CSS, rewritten as readable, strict TypeScript.
//
// The service screens (the bag, the table bill, calling a waiter, paying, the receipt) are in
// services/. They are drawn only when the host binds `services` and the view model has the service
// on (R15); the face then holds the guest's bag and shows what the host's state says, and nothing
// else (D72). Without `services` the page is the browsing page, with no service control, no
// stylesheet for them and no empty band under the menu.

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
  isStrip,
  langOf,
  matchesFilters,
  NO_FILTERS,
  themeVariables,
  toggled,
} from './model'
import type { PageContext } from './parts'
import { SectionBlock } from './section'
import { ServiceBar } from './services/bag-bar'
import { HeaderTools } from './services/header-tools'
import { ServicesProvider, serviceBarShown, servicesShown } from './services/provider'
import { SERVICES_CSS } from './services/services-css'
import { ServiceSheets } from './services/sheets'
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
    services,
  } = props
  const locale = view.locale
  const strings = stringsFor(locale).guest

  // The filter control is drawn only when the shell turned it on (R15: the venue offers filters
  // and the menu has chips). The chip check is the shell's too; it is repeated here so a view
  // model with its chips taken out never shows a button that opens an empty sheet.
  const filterControl =
    view.features.filters && (view.filters.dietary.length > 0 || view.filters.tags.length > 0)
  // The guest's filters. A chip that left the menu (a language or a refresh changed the lists)
  // cannot stay switched on, and neither can any chip once the filter control is gone: the guest
  // could not switch it off again.
  const [chosen, setChosen] = useState<Filters>(NO_FILTERS)
  const filters = useMemo<Filters>(() => {
    if (!filterControl) return NO_FILTERS
    const dietary = new Set<string>(view.filters.dietary.map((label) => label.code))
    const tags = new Set<string>(view.filters.tags.map((tag) => tag.id))
    return {
      dietary: new Set([...chosen.dietary].filter((code) => dietary.has(code))),
      tags: new Set([...chosen.tags].filter((id) => tags.has(id))),
    }
  }, [chosen, filterControl, view.filters])

  // The menu's layout and guest switch (D92), published with the menu; no face option any more.
  const [layout, chooseLayout] = useLayout(view.layout.default, view.layout.guestSwitch)
  const dish = useDishRoute()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [allergens, setAllergens] = useState<AllergenState | null>(null)
  const filterOpener = useRef<HTMLElement | null>(null)
  const allergenOpener = useRef<HTMLElement | null>(null)

  // The sheet and the guest's choices go with the control: neither waits to come back when it does.
  useEffect(() => {
    if (!filterControl) {
      setFiltersOpen(false)
      setChosen(NO_FILTERS)
    }
  }, [filterControl])

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
      layout,
      isVisible: (item: ViewItem) => matchesFilters(item, filters),
      openDish: dish.open,
      openAllergens,
    }),
    [locale, strings, assetBase, layout, filters, dish.open, openAllergens],
  )

  // A section the composer marks horizontal is a photo-led strip (D92). The layout switch, when
  // the menu lets guests switch, sits under the title of the first other section that still has
  // something to show.
  const switchIndex = view.layout.guestSwitch
    ? view.sections.findIndex(
        (section) =>
          !isStrip(section) && (!isFiltering(filters) || hasVisibleItems(section, filters)),
      )
    : -1
  const nothingMatches = isFiltering(filters) && countVisible(view.sections, filters) === 0

  // The stylesheet of the services comes only with a service to draw, and the room under the menu
  // for the bar at the bottom only with that bar.
  const css = servicesShown(view, services) ? EDITORIAL_CSS + SERVICES_CSS : EDITORIAL_CSS

  return (
    <div
      className="rm"
      data-face="editorial-market"
      data-layout={layout}
      data-scheme={scheme}
      data-services={serviceBarShown(view, services) ? 'bar' : undefined}
      lang={bcp47(locale)}
      style={themeVariables(view.theme, fontStacks) as CSSProperties}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant stylesheets from css.ts and services/services-css.ts, no user input; React would escape `>` and quotes in them */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <ServicesProvider
        view={view}
        services={services}
        tableLabel={tableLabel}
        openDish={dish.open}
      >
        <Header
          view={view}
          ctx={ctx}
          tableLabel={tableLabel}
          languages={languages}
          onLanguageChange={onLanguageChange}
          hasFilters={filterControl}
          onOpenFilters={openFilters}
          tools={<HeaderTools />}
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
              first={index === 0}
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
        {filtersOpen && filterControl ? (
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
        <ServiceBar />
        <ServiceSheets />
      </ServicesProvider>
    </div>
  )
}
