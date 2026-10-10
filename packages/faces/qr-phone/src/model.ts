// The small pure helpers of the face: language tags, asset addresses, the guest's filters and the
// theme tokens as CSS variables. No React and nothing from outside @restro/shell.

import type { ViewItem, ViewModel, ViewSection, ViewText, ViewTheme } from '@restro/shell'

/** A language of the interface, as the shell names it (`bg_BG`). */
export type Locale = ViewModel['locale']

/** `bg_BG` to the BCP 47 tag the `lang` attribute wants (`bg-BG`). */
export function bcp47(locale: Locale): string {
  return locale.replace('_', '-')
}

/**
 * The `lang` attribute for a text, only when it is not in the page's language (R3): a fallback
 * text says what it really is, and everything else inherits the page's `lang`.
 */
export function langOf(text: ViewText, pageLocale: Locale): string | undefined {
  return text.lang === pageLocale ? undefined : bcp47(text.lang)
}

/** The address of a published file: the view model holds `/a/…` paths, the host says where they live. */
export function assetUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

/** The label on a language button: "БГ", "EN", else the two letters of the language. */
export function languageLabel(locale: Locale): string {
  const code = locale.split('_')[0] ?? locale
  return code === 'bg' ? 'БГ' : code.toUpperCase()
}

/** What the guest has switched on among the filter chips. */
export interface Filters {
  readonly tags: ReadonlySet<string>
  readonly dietary: ReadonlySet<string>
}

/** No filter at all. */
export const NO_FILTERS: Filters = { tags: new Set(), dietary: new Set() }

/** True when any chip is on. */
export function isFiltering(filters: Filters): boolean {
  return filters.tags.size > 0 || filters.dietary.size > 0
}

/**
 * Whether an item passes the filters. Tags are alternatives (an item with any chosen tag passes);
 * dietary labels are requirements (a vegan and gluten-free choice needs both).
 */
export function matchesFilters(item: ViewItem, filters: Filters): boolean {
  if (filters.tags.size > 0 && !item.tags.some((tag) => filters.tags.has(tag.id))) return false
  for (const code of filters.dietary) {
    if (!item.dietary.some((label) => label.code === code)) return false
  }
  return true
}

/**
 * The sections with only the items that pass; a section left with nothing (and no sub-section
 * with something) goes. Order is never changed (R2). Returns the same list when nothing filters.
 */
export function filterSections(
  sections: readonly ViewSection[],
  filters: Filters,
): readonly ViewSection[] {
  if (!isFiltering(filters)) return sections
  const out: ViewSection[] = []
  for (const section of sections) {
    const items = section.items.filter((item) => matchesFilters(item, filters))
    const children = filterSections(section.sections, filters)
    if (items.length > 0 || children.length > 0) out.push({ ...section, items, sections: children })
  }
  return out
}

/** How many item placements a list of sections holds. */
export function countItems(sections: readonly ViewSection[]): number {
  return sections.reduce(
    (total, section) => total + section.items.length + countItems(section.sections),
    0,
  )
}

/** The anchor of a section on the page. */
export function sectionDomId(sectionId: string): string {
  return `s-${sectionId}`
}

/** `box-shadow` per theme level 0 to 5, made from the text colour so it needs no colour of its own. */
const SHADOWS = [
  'none',
  '0 1px 2px 0 color-mix(in srgb, var(--rq-text) 10%, transparent)',
  '0 2px 6px 0 color-mix(in srgb, var(--rq-text) 12%, transparent)',
  '0 4px 12px 0 color-mix(in srgb, var(--rq-text) 14%, transparent)',
  '0 8px 20px 0 color-mix(in srgb, var(--rq-text) 16%, transparent)',
  '0 12px 28px 0 color-mix(in srgb, var(--rq-text) 18%, transparent)',
] as const

/** Used after the venue's font when the host did not map it to a self-hosted stack. */
const SYSTEM_FONTS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'

/**
 * The theme tokens (R13) as CSS custom properties for the root element: the colours for a light
 * and for a dark screen, the font, the corner radius and the shadow. The stylesheet only ever
 * reads these variables.
 */
export function themeVariables(
  theme: ViewTheme,
  fontStacks: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const colours = (prefix: string, set: ViewTheme['colors']) => ({
    [`--rq-${prefix}bg`]: set.background,
    [`--rq-${prefix}surface`]: set.surface,
    [`--rq-${prefix}accent`]: set.accent,
    [`--rq-${prefix}on-accent`]: set.onAccent,
    [`--rq-${prefix}text`]: set.text,
    [`--rq-${prefix}muted`]: set.muted,
    [`--rq-${prefix}accent-text`]: set.accentText,
    [`--rq-${prefix}border`]: set.border,
  })
  const shadow = SHADOWS[Math.min(Math.max(Math.trunc(theme.shadow), 0), SHADOWS.length - 1)]
  return {
    ...colours('l-', theme.colors),
    ...colours('d-', theme.colorsDark),
    '--rq-font': fontStacks[theme.font] ?? `"${theme.font}", ${SYSTEM_FONTS}`,
    '--rq-radius': `${theme.radius}px`,
    '--rq-shadow': shadow ?? 'none',
  }
}
