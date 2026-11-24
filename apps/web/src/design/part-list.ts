// The Design panel's list of parts (D159), apart from React: which rows each level lists, where an
// address's `?part=` opens, which part a level switch keeps, which options a part page holds, and
// the one-line summary of every row. Pure, so the rules are tested without a screen.
//
// Simple lists the Style, Colours and logo, Fonts and Layout. Advanced lists the first three, then
// "Parts of the menu": one row per page of the contract file (`DESIGN_PAGES`), in its order, so a
// page added there is a row here with no code of ours. General in Advanced holds only the options
// that are not rows of their own (D159): the Style, the colours and the fonts sit above it.
import {
  canonicalJson,
  DESIGN_PAGES,
  type DesignChoiceOption,
  type DesignOption,
  type DesignPage,
  type DesignValues,
  designLayoutOf,
  designValuesOfStyle,
  type SnapshotMenuLayout,
  type StyleValues,
} from '@restro/core'

import { type PanelMode, valueIn } from './advanced-model'
import { type DesignDraft, valuesOfStyle } from './design-draft'

/** The parts that are the panel's own rows, not pages of the contract. */
export const OWN_PARTS = ['style', 'colours', 'fonts', 'layout'] as const

export type OwnPartId = (typeof OWN_PARTS)[number]

/** A row of the list: one of the panel's own parts, or a page of the contract by its id. */
export type PartId = string

/** The panel's own rows of a level, in the order they are listed. */
const OWN_ROWS: Readonly<Record<PanelMode, readonly OwnPartId[]>> = {
  simple: ['style', 'colours', 'fonts', 'layout'],
  // Layout's two options sit on the Items page in Advanced, where the contract puts them.
  advanced: ['style', 'colours', 'fonts'],
}

/** What a level lists: its own rows, then (in Advanced) the contract's pages. */
export interface PartList {
  readonly own: readonly OwnPartId[]
  readonly pages: readonly DesignPage[]
}

export function partListOf(mode: PanelMode, pages: readonly DesignPage[] = DESIGN_PAGES): PartList {
  return { own: OWN_ROWS[mode], pages: mode === 'advanced' ? pages : [] }
}

export function isOwnPart(id: string): id is OwnPartId {
  return (OWN_PARTS as readonly string[]).includes(id)
}

/** The page of the contract a part is, or null for one of the panel's own parts. */
export function pageOfPart(
  id: string,
  pages: readonly DesignPage[] = DESIGN_PAGES,
): DesignPage | null {
  if (isOwnPart(id)) return null
  return pages.find((page) => page.id === id) ?? null
}

/** True when the level lists the part. */
export function listsPart(
  mode: PanelMode,
  id: string,
  pages: readonly DesignPage[] = DESIGN_PAGES,
): boolean {
  const list = partListOf(mode, pages)
  return (list.own as readonly string[]).includes(id) || list.pages.some((page) => page.id === id)
}

/**
 * Where the panel opens for an address's `?part=`: the level that lists it and the part. A part
 * both levels list opens in `fallback`; one no level lists opens the list in `fallback`.
 */
export function openingOf(
  param: string | null,
  fallback: PanelMode,
  pages: readonly DesignPage[] = DESIGN_PAGES,
): { readonly mode: PanelMode; readonly part: PartId | null } {
  if (param === null) return { mode: fallback, part: null }
  if (listsPart(fallback, param, pages)) return { mode: fallback, part: param }
  const other: PanelMode = fallback === 'simple' ? 'advanced' : 'simple'
  if (listsPart(other, param, pages)) return { mode: other, part: param }
  return { mode: fallback, part: null }
}

/**
 * The part that stays open when the level switches: the same row where the other level has it,
 * Simple's Layout for Advanced's Items and back; otherwise none (the list).
 */
export function partAcross(
  id: PartId | null,
  to: PanelMode,
  pages: readonly DesignPage[] = DESIGN_PAGES,
): PartId | null {
  if (id === null) return null
  if (listsPart(to, id, pages)) return id
  if (to === 'advanced' && id === 'layout') return listsPart(to, 'items', pages) ? 'items' : null
  if (to === 'simple' && id === 'items') return 'layout'
  return null
}

/** General's options that are rows of their own in Advanced, so General does not repeat them. */
const OWN_ROW_OPTIONS: ReadonlySet<string> = new Set([
  'style',
  'colours',
  'body_font',
  'heading_font',
])

/** The options a part page shows: every option of the page, but General's own rows (D159). */
export function optionsOfPage(page: DesignPage): readonly DesignOption[] {
  if (page.id !== 'general') return page.options
  return page.options.filter((option) => !OWN_ROW_OPTIONS.has(option.id))
}

// --- Summaries -----------------------------------------------------------------------------------

/** The word of an option's value in the draft, in the panel's language; null for a value it lacks. */
function wordOf(
  option: DesignChoiceOption,
  values: DesignValues,
  pageId: string,
  locale: 'bg' | 'en',
): string | null {
  const id = valueIn(values, pageId, option.id)
  const value = option.values.find((entry) => entry.id === id)
  return value === undefined ? null : value[locale]
}

/** A part page's summary: the value words of its first two options, joined by " · ". */
export function pageSummaryOf(page: DesignPage, values: DesignValues, locale: 'bg' | 'en'): string {
  return optionsOfPage(page)
    .filter((option): option is DesignChoiceOption => option.kind === 'choice')
    .slice(0, 2)
    .map((option) => wordOf(option, values, page.id, locale))
    .filter((word): word is string => word !== null)
    .join(' · ')
}

/** The Style a summary names: its name, and whether any option now differs from it. */
export interface StyleSummary {
  readonly name: string
  readonly changed: boolean
}

/** The organisation's own Styles a pick can name (My styles). */
export interface NamedStyles {
  readonly saved: readonly {
    readonly id: string
    readonly name: string
    readonly values: StyleValues
  }[]
  readonly venues: readonly {
    readonly venueId: string
    readonly venueName: string
    readonly values: StyleValues
  }[]
}

/** The name of a premade Style, from the contract's Style option. */
function premadeName(id: string, locale: 'bg' | 'en', pages: readonly DesignPage[]): string {
  const option = pages
    .find((page) => page.id === 'general')
    ?.options.find((entry) => entry.kind === 'style')
  const value = option?.kind === 'style' ? option.values.find((entry) => entry.id === id) : null
  return value?.[locale] ?? id
}

/**
 * The Style row's summary: the Style the draft was picked from (one of Restro's, or of My styles)
 * and whether any value differs from what picking it fills in (`valuesOfStyle`: the venue's body
 * font stays, so it is no change).
 */
export function styleSummaryOf(
  draft: Pick<DesignDraft, 'style' | 'values' | 'picked'>,
  styles: NamedStyles,
  locale: 'bg' | 'en',
  pages: readonly DesignPage[] = DESIGN_PAGES,
): StyleSummary {
  const { picked, values } = draft
  const bodyFont = values.general.body_font
  let named: { name: string; values: DesignValues | null } | null = null
  if (picked.kind === 'saved') {
    const saved = styles.saved.find((entry) => entry.id === picked.id)
    if (saved !== undefined) {
      named = { name: saved.name, values: designValuesOfStyle(saved.values, bodyFont) }
    }
  } else if (picked.kind === 'venue') {
    const venue = styles.venues.find((entry) => entry.venueId === picked.venueId)
    if (venue !== undefined) {
      named = { name: venue.venueName, values: designValuesOfStyle(venue.values, bodyFont) }
    }
  }
  named ??= {
    name: premadeName(draft.style, locale, pages),
    values: valuesOfStyle(draft.style, values),
  }
  return {
    name: named.name,
    changed: named.values !== null && canonicalJson(named.values) !== canonicalJson(values),
  }
}

/** The Fonts row's summary: the body font, and the heading font unless it is the body's. */
export interface FontSummary {
  readonly body: { readonly id: string; readonly name: string }
  readonly heading: { readonly id: string; readonly name: string } | null
}

export function fontSummaryOf(
  values: DesignValues,
  locale: 'bg' | 'en',
  pages: readonly DesignPage[] = DESIGN_PAGES,
): FontSummary {
  const general = pages.find((page) => page.id === 'general')
  const nameOf = (optionId: string, id: string) => {
    const option = general?.options.find((entry) => entry.id === optionId)
    const value = option?.kind === 'choice' ? option.values.find((v) => v.id === id) : undefined
    return { id, name: value?.[locale] ?? id }
  }
  const { body_font: body, heading_font: heading } = values.general
  return {
    body: nameOf('body_font', body),
    heading: heading === 'same' || heading === body ? null : nameOf('heading_font', heading),
  }
}

/** The Layout row's summary: the layout guests start in, and whether they may switch it. */
export function layoutSummaryOf(values: DesignValues): {
  readonly layout: SnapshotMenuLayout
  readonly guestSwitch: boolean
} {
  const layout = designLayoutOf(values)
  return { layout: layout.default, guestSwitch: layout.guest_switch }
}
