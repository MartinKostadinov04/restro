// The QR phone face: draws a view model and nothing else (the shell has already decided what is
// shown, in what order and in what state). Top to bottom: menu title and intro, the table banner,
// the language switch, a sticky bar to jump between sections, filter chips, the sections with
// their item cards, and the allergen information footer. A tap on an allergen code opens a sheet
// that names every allergen.
//
// Ported from the Platform's view engine (`Pages/Passport/Render.jsx` 152-341): sections in
// order, content in definition order, empty things skipped. What changed: no per-field type
// switch (the shell formats every field before it gets here), no hard-coded colours (theme tokens
// only), and the order and the empty-slot rules come from the shell instead of being redone here.

import { type FaceHostProps, stringsFor, type ViewItem, type ViewSection } from '@restro/shell'
import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AllergenSheet, type SheetState } from './allergen-sheet'
import { FACE_CSS } from './css'
import { type CardContext, ItemCard, Photo, Text } from './item-card'
import {
  assetUrl,
  bcp47,
  type Filters,
  filterSections,
  isFiltering,
  type Locale,
  languageLabel,
  NO_FILTERS,
  sectionDomId,
  themeVariables,
} from './model'
import { OrderPanel, useOrderCommands } from './table-order'

/**
 * What the host gives the face besides the view model: the same props for every face. This face
 * has no presentation options of its own and ignores `options`.
 */
export type QrPhoneFaceProps = FaceHostProps

/** The distance from the top of the screen at which a section counts as the one being read. */
const READING_LINE = 96

/** The id of the section being read, and a way to set it when a jump link is tapped. */
function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(ids[0] ?? null)
  const key = ids.join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ids`
  useEffect(() => {
    if (ids.length === 0) return
    let frame = 0
    const update = () => {
      frame = 0
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      let current = ids[0] ?? null
      for (const id of ids) {
        const element = document.getElementById(sectionDomId(id))
        if (element !== null && element.getBoundingClientRect().top <= READING_LINE) current = id
      }
      setActive(atBottom && window.scrollY > 0 ? (ids[ids.length - 1] ?? current) : current)
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [key])
  return [active, setActive] as const
}

function JumpBar({
  sections,
  locale,
  label,
}: {
  readonly sections: readonly ViewSection[]
  readonly locale: Locale
  readonly label: string
}) {
  const ids = useMemo(() => sections.map((section) => section.id), [sections])
  const [active, setActive] = useActiveSection(ids)
  const list = useRef<HTMLUListElement>(null)

  // Keep the highlighted link in view inside the bar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again when the highlighted link changes (it looks the link up in the DOM)
  useEffect(() => {
    const bar = list.current
    const link = bar?.querySelector<HTMLElement>('a[aria-current="true"]')
    if (bar === null || bar === undefined || link === null || link === undefined) return
    const target = link.offsetLeft - (bar.clientWidth - link.offsetWidth) / 2
    bar.scrollTo?.({ left: Math.max(0, target) })
  }, [active])

  return (
    <nav className="rq-jump" aria-label={label}>
      <ul ref={list}>
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${sectionDomId(section.id)}`}
              aria-current={section.id === active ? 'true' : undefined}
              lang={section.title.lang === locale ? undefined : bcp47(section.title.lang)}
              onClick={(event) => {
                event.preventDefault()
                setActive(section.id)
                document
                  .getElementById(sectionDomId(section.id))
                  ?.scrollIntoView?.({ block: 'start' })
              }}
            >
              {section.title.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function ChipGroup<
  T extends { readonly key: string; readonly text: string; readonly lang?: string },
>({
  label,
  allLabel,
  chips,
  selected,
  onToggle,
  onClear,
}: {
  readonly label: string
  readonly allLabel: string
  readonly chips: readonly T[]
  readonly selected: ReadonlySet<string>
  readonly onToggle: (key: string) => void
  readonly onClear: () => void
}) {
  return (
    <fieldset className="rq-filter-group" aria-label={label}>
      <ul className="rq-chips">
        <li>
          <button
            type="button"
            className="rq-chip"
            aria-pressed={selected.size === 0}
            onClick={onClear}
          >
            {allLabel}
          </button>
        </li>
        {chips.map((chip) => (
          <li key={chip.key}>
            <button
              type="button"
              className="rq-chip"
              lang={chip.lang}
              aria-pressed={selected.has(chip.key)}
              onClick={() => onToggle(chip.key)}
            >
              {chip.text}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}

function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function SectionBlock({
  section,
  depth,
  ctx,
  hintStyle,
}: {
  readonly section: ViewSection
  readonly depth: number
  readonly ctx: CardContext
  readonly hintStyle: (color: string | null) => CSSProperties | undefined
}) {
  const titleId = useId()
  const Heading = depth === 0 ? 'h2' : 'h3'
  const color = section.hints.color
  return (
    <section
      id={sectionDomId(section.id)}
      className={depth === 0 ? 'rq-section' : 'rq-subsection'}
      data-section={section.id}
      data-hint={color === null ? undefined : 'true'}
      aria-labelledby={titleId}
      style={hintStyle(color)}
    >
      <header className="rq-section-head">
        <Text
          text={section.title}
          locale={ctx.locale}
          as={Heading}
          id={titleId}
          className={depth === 0 ? 'rq-section-title' : 'rq-subsection-title'}
        />
        {section.description !== null ? (
          <Text text={section.description} locale={ctx.locale} as="p" className="rq-section-text" />
        ) : null}
      </header>
      {section.image !== null ? (
        <Photo
          image={section.image}
          assetBase={ctx.assetBase}
          locale={ctx.locale}
          sizes="(min-width: 640px) 608px, calc(100vw - 32px)"
          className="rq-section-image"
        />
      ) : null}
      {section.items.length > 0 ? (
        <ul className="rq-items">
          {section.items.map((item) => (
            <ItemCard key={item.id} item={item} ctx={ctx} level={depth === 0 ? 3 : 4} />
          ))}
        </ul>
      ) : null}
      {section.sections.map((child) => (
        <SectionBlock
          key={child.id}
          section={child}
          depth={depth + 1}
          ctx={ctx}
          hintStyle={hintStyle}
        />
      ))}
    </section>
  )
}

/** The phone menu. */
export function QrPhoneFace(props: QrPhoneFaceProps) {
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
  const serviceStrings = stringsFor(locale).services
  // The table's shared order (#75): only where the shell turned ordering on (R15).
  const orderingOn = view.features.ordering
  const { send, notice } = useOrderCommands(services, serviceStrings, view)
  const ordering = useMemo(
    () => (orderingOn ? { strings: serviceStrings, send } : null),
    [orderingOn, serviceStrings, send],
  )

  // The chips are drawn only when the shell turned the filter control on (R15: the venue offers
  // filters and the menu has chips). The chip check is the shell's too; it is repeated here so a
  // view model with its chips taken out never draws an empty filter bar.
  const hasFilters =
    view.features.filters && (view.filters.tags.length > 0 || view.filters.dietary.length > 0)

  const [chosen, setChosen] = useState<Filters>(NO_FILTERS)
  // A chip that left the menu (a language or a refresh changed the lists) cannot stay switched on,
  // and neither can any chip once the chips are gone: the guest could not switch it off again.
  const filters = useMemo<Filters>(() => {
    if (!hasFilters) return NO_FILTERS
    const tags = new Set(view.filters.tags.map((tag) => tag.id as string))
    const dietary = new Set(view.filters.dietary.map((label) => label.code as string))
    return {
      tags: new Set([...chosen.tags].filter((id) => tags.has(id))),
      dietary: new Set([...chosen.dietary].filter((code) => dietary.has(code))),
    }
  }, [chosen, hasFilters, view.filters])
  const sections = useMemo(() => filterSections(view.sections, filters), [view.sections, filters])

  const [sheet, setSheet] = useState<SheetState | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const openAllergens = useCallback((item: ViewItem, element: HTMLElement) => {
    trigger.current = element
    setSheet({ itemName: item.name, codes: item.allergens.map((allergen) => allergen.code) })
  }, [])
  const closeSheet = useCallback(() => {
    setSheet(null)
    trigger.current?.focus?.()
  }, [])

  const ctx = useMemo<CardContext>(
    () => ({ locale, strings, assetBase, openAllergens, ordering }),
    [locale, strings, assetBase, openAllergens, ordering],
  )
  const hintStyle = useCallback(
    (color: string | null) =>
      color === null ? undefined : ({ '--rq-hint': color } as CSSProperties),
    [],
  )

  const { logo } = view.theme
  const title = view.menu.title
  const empty = sections.length === 0

  return (
    <div
      className="rq-root"
      data-face="qr-phone"
      data-scheme={scheme === 'auto' ? undefined : scheme}
      lang={bcp47(locale)}
      style={themeVariables(view.theme, fontStacks) as CSSProperties}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant stylesheet from css.ts, no user input; React would escape `>` and quotes in it */}
      <style dangerouslySetInnerHTML={{ __html: FACE_CSS }} />
      <div className="rq-page">
        <header className="rq-header">
          {logo !== null ? (
            // biome-ignore lint/performance/noImgElement: the face is framework-free; the logo is a fixed-size webp variant
            <img
              className="rq-logo"
              src={assetUrl(assetBase, logo.src)}
              width={logo.width > 0 ? logo.width : undefined}
              height={
                logo.width > 0
                  ? Math.round((logo.width * logo.sourceHeight) / logo.sourceWidth)
                  : undefined
              }
              alt={logo.alt === null ? '' : logo.alt.text}
              lang={
                logo.alt === null
                  ? undefined
                  : logo.alt.lang === locale
                    ? undefined
                    : bcp47(logo.alt.lang)
              }
            />
          ) : null}
          <div className="rq-titlerow">
            {title !== null ? (
              <Text text={title} locale={locale} as="h1" className="rq-title" slot="menu.title" />
            ) : (
              // A page needs a heading; a menu without a title gets one for screen readers only.
              <h1 className="rq-sr-only" lang={bcp47(locale)}>
                {strings.menu}
              </h1>
            )}
            {languages.length > 1 ? (
              <fieldset className="rq-lang" data-slot="menu.language" aria-label={strings.language}>
                {languages.map((code) => (
                  <button
                    key={code}
                    type="button"
                    lang={bcp47(code)}
                    aria-pressed={code === locale}
                    onClick={() => onLanguageChange?.(code)}
                  >
                    {languageLabel(code)}
                  </button>
                ))}
              </fieldset>
            ) : null}
          </div>
          {view.menu.intro !== null ? (
            <Text
              text={view.menu.intro}
              locale={locale}
              as="p"
              className="rq-intro"
              slot="menu.intro"
            />
          ) : null}
          {tableLabel !== null && tableLabel.trim() !== '' ? (
            <p className="rq-banner" role="status" data-slot="menu.table">
              {strings.table(tableLabel)}
            </p>
          ) : null}
          {view.menu.schedule !== null ? (
            <p
              className="rq-menu-schedule"
              lang={
                view.menu.schedule.text.lang === locale
                  ? undefined
                  : bcp47(view.menu.schedule.text.lang)
              }
            >
              {strings.menuSchedule(view.menu.schedule.text.text)}
            </p>
          ) : null}
        </header>

        {sections.length > 1 ? (
          <JumpBar sections={sections} locale={locale} label={strings.sections} />
        ) : null}

        {hasFilters ? (
          <div className="rq-filters" data-slot="menu.filters">
            {view.filters.dietary.length > 0 ? (
              <ChipGroup
                label={strings.filterDiet}
                allLabel={strings.filterAll}
                chips={view.filters.dietary.map((label) => ({
                  key: label.code,
                  text: label.label.text,
                  ...(label.label.lang === locale ? {} : { lang: bcp47(label.label.lang) }),
                }))}
                selected={filters.dietary}
                onToggle={(key) =>
                  setChosen({ ...filters, dietary: toggled(filters.dietary, key) })
                }
                onClear={() => setChosen({ ...filters, dietary: new Set() })}
              />
            ) : null}
            {view.filters.tags.length > 0 ? (
              <ChipGroup
                label={strings.filterTags}
                allLabel={strings.filterAll}
                chips={view.filters.tags.map((tag) => ({
                  key: tag.id,
                  text: tag.label.text,
                  ...(tag.label.lang === locale ? {} : { lang: bcp47(tag.label.lang) }),
                }))}
                selected={filters.tags}
                onToggle={(key) => setChosen({ ...filters, tags: toggled(filters.tags, key) })}
                onClear={() => setChosen({ ...filters, tags: new Set() })}
              />
            ) : null}
          </div>
        ) : null}

        <main>
          {sections.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              depth={0}
              ctx={ctx}
              hintStyle={hintStyle}
            />
          ))}
          {empty && isFiltering(filters) ? (
            <div className="rq-empty" role="status">
              <p>{strings.noMatches}</p>
              <button type="button" className="rq-clear" onClick={() => setChosen(NO_FILTERS)}>
                {strings.clearFilters}
              </button>
            </div>
          ) : null}
        </main>

        {orderingOn ? (
          <OrderPanel
            view={view}
            services={services}
            strings={serviceStrings}
            send={send}
            notice={notice}
          />
        ) : null}

        <footer className="rq-footer">
          <h2>{strings.footerTitle}</h2>
          <p>{strings.footerText}</p>
          {view.allergenLegend.length > 0 ? (
            <ul className="rq-legend" data-slot="menu.allergen_legend">
              {view.allergenLegend.map((allergen) => (
                <li
                  key={allergen.code}
                  lang={allergen.label.lang === locale ? undefined : bcp47(allergen.label.lang)}
                >
                  <span className="rq-allergen-code" aria-hidden="true">
                    {allergen.number}
                  </span>
                  {allergen.label.text}
                </li>
              ))}
            </ul>
          ) : null}
        </footer>
      </div>

      {sheet !== null ? (
        <AllergenSheet
          state={sheet}
          legend={view.allergenLegend}
          locale={locale}
          strings={strings}
          onClose={closeSheet}
        />
      ) : null}
    </div>
  )
}
