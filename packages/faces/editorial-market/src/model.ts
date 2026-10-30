// The small pure helpers of the Editorial Market face: language tags, asset addresses, image
// attributes, the guest's filters, the layouts (the menu's and a section's strip) and the theme
// as CSS variables. No React and nothing from outside @restro/shell.

import type {
  DesignValues,
  Locale,
  ViewBadge,
  ViewImage,
  ViewItem,
  ViewSection,
  ViewText,
  ViewTheme,
} from '@restro/shell'

/** `bg_BG` to the BCP 47 tag the `lang` attribute wants (`bg-BG`). */
export function bcp47(locale: Locale): string {
  return locale.replace('_', '-')
}

/**
 * The `lang` attribute for a text, only when it is not in the page's language (R3): a fallback
 * text says what it really is, and everything else inherits the page's `lang`.
 */
export function langOf(text: ViewText, page: Locale): string | undefined {
  return text.lang === page ? undefined : bcp47(text.lang)
}

/** Like `langOf`, for a language that may be unknown (the value of a custom field). */
export function localeLang(locale: Locale | null, page: Locale): string | undefined {
  return locale === null || locale === page ? undefined : bcp47(locale)
}

/** The address of a published file: the view model holds `/a/…` paths, the host says where they live. */
export function assetUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

/** The attributes of an `<img>` for an image: the shell's pick as `src`, every file as `srcset`. */
export function imageAttributes(image: ViewImage, base: string, sizes: string) {
  const files = image.variants.filter((file) => file.width > 0)
  return {
    src: assetUrl(base, image.src),
    srcSet: files.map((file) => `${assetUrl(base, file.src)} ${file.width}w`).join(', '),
    sizes,
    // The original's proportions reserve the space; the stylesheet sets the crop.
    width: image.sourceWidth > 0 ? image.sourceWidth : undefined,
    height: image.sourceHeight > 0 ? image.sourceHeight : undefined,
    objectPosition: image.objectPosition,
  }
}

/** The label on a language button: "BG", "EN", else the two letters of the language. */
export function languageLabel(locale: Locale): string {
  return (locale.split('_')[0] ?? locale).toUpperCase()
}

/** The anchor of a section on the page. */
export function sectionDomId(sectionId: string): string {
  return `rm-${sectionId}`
}

/** True when the guest asked their device for less motion. Reads the window: call it from effects and handlers only. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** A stable React key for a badge (a badge has no id of its own). */
export function badgeKey(badge: ViewBadge): string {
  switch (badge.kind) {
    case 'new':
      return 'new'
    case 'dietary':
      return `dietary:${badge.code}`
    case 'tag':
      return `tag:${badge.id}`
  }
}

/** Every item placement of a list of sections, in reading order (own items first, then sub-sections). */
export function allItems(sections: readonly ViewSection[]): ViewItem[] {
  return sections.flatMap((section) => [...section.items, ...allItems(section.sections)])
}

/* ---------------------------------------------------------------------------------------------
 * Layout
 * ------------------------------------------------------------------------------------------- */

/** How the items of a section are laid out: a list, one column of big cards, two columns. */
export const LAYOUTS = ['list', 'one', 'two'] as const

/** One layout. */
export type Layout = (typeof LAYOUTS)[number]

/** Where the guest's choice is remembered for the visit (`sessionStorage`). */
export const LAYOUT_STORAGE_KEY = 'rm-layout'

/** True for the name of a layout. */
export function isLayout(value: unknown): value is Layout {
  return LAYOUTS.some((layout) => layout === value)
}

/**
 * The `sizes` of an item photo: how wide the picture is drawn, so a phone takes the smallest file
 * that is sharp enough (the photo sits on a stage panel, so it is narrower than its card). A
 * photo of the strip is a card of 84 % of the screen (at most 390 px); in the sections it is the
 * column (one), half of it (two) or a 96 px square (list). The column is 820 px at most, with
 * margins of 20 px (34 px from 641 px up). The figures run a little over, never under.
 */
export function photoSizes(layout: Layout, strip: boolean): string {
  if (strip) {
    return '(min-width: 821px) 350px, (min-width: 641px) calc(46vw - 59px), calc(min(84vw, 390px) - 28px)'
  }
  switch (layout) {
    case 'list':
      return '96px'
    case 'one':
      return '(min-width: 821px) 684px, calc(100vw - 68px)'
    case 'two':
      return '(min-width: 821px) 354px, (min-width: 641px) calc(50vw - 56px), calc(50vw - 42px)'
  }
}

/** True for a section drawn as the photo-led strip: one the composer marks horizontal (D92). */
export function isStrip(section: ViewSection): boolean {
  return section.hints.layout === 'horizontal'
}

/* ---------------------------------------------------------------------------------------------
 * Filters
 * ------------------------------------------------------------------------------------------- */

/** What the guest has switched on in the filter sheet. */
export interface Filters {
  readonly dietary: ReadonlySet<string>
  readonly tags: ReadonlySet<string>
}

/** No filter at all. */
export const NO_FILTERS: Filters = { dietary: new Set(), tags: new Set() }

/** True when any filter is on. */
export function isFiltering(filters: Filters): boolean {
  return filters.dietary.size > 0 || filters.tags.size > 0
}

/**
 * Whether an item passes the filters. Dietary labels are requirements (a vegan and gluten-free
 * choice needs both); tags are alternatives (an item with any chosen tag passes).
 */
export function matchesFilters(item: ViewItem, filters: Filters): boolean {
  for (const code of filters.dietary) {
    if (!item.dietary.some((label) => label.code === code)) return false
  }
  if (filters.tags.size > 0 && !item.tags.some((tag) => filters.tags.has(tag.id))) return false
  return true
}

/** True when the section, or a sub-section of it, still has an item that passes the filters. */
export function hasVisibleItems(section: ViewSection, filters: Filters): boolean {
  return (
    section.items.some((item) => matchesFilters(item, filters)) ||
    section.sections.some((child) => hasVisibleItems(child, filters))
  )
}

/** How many item placements pass the filters. */
export function countVisible(sections: readonly ViewSection[], filters: Filters): number {
  return allItems(sections).filter((item) => matchesFilters(item, filters)).length
}

/** A set with the key switched on or off. */
export function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/* ---------------------------------------------------------------------------------------------
 * Theme
 * ------------------------------------------------------------------------------------------- */

/** Used after the venue's font when the host did not map it to a self-hosted stack. */
const SYSTEM_FONTS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'

/** The shadow levels the theme may ask for. */
const MAX_SHADOW = 5

/**
 * The theme tokens (R13) as CSS custom properties for the root element: the colours for a light
 * and for a dark screen (`--rm-l-*`, `--rm-d-*`), the font, the corner radius and the shadow
 * level. The stylesheet only ever reads these variables and picks the light or the dark set.
 */
export function themeVariables(
  theme: ViewTheme,
  fontStacks: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const colours = (prefix: 'l' | 'd', set: ViewTheme['colors']) => ({
    [`--rm-${prefix}-background`]: set.background,
    [`--rm-${prefix}-surface`]: set.surface,
    [`--rm-${prefix}-accent`]: set.accent,
    [`--rm-${prefix}-onAccent`]: set.onAccent,
    [`--rm-${prefix}-text`]: set.text,
    [`--rm-${prefix}-muted`]: set.muted,
    [`--rm-${prefix}-accentText`]: set.accentText,
    [`--rm-${prefix}-border`]: set.border,
  })
  const shadow = Number.isFinite(theme.shadow) ? Math.min(Math.max(theme.shadow, 0), MAX_SHADOW) : 0
  return {
    ...colours('l', theme.colors),
    ...colours('d', theme.colorsDark),
    '--rm-font': fontStacks[theme.font] ?? `"${theme.font}", ${SYSTEM_FONTS}`,
    '--rm-radius': `${theme.radius}px`,
    '--rm-shadow': String(shadow),
  }
}

/**
 * The General page as data attributes on the face's root (D130): `corners` to `data-corners`,
 * `heading_font` to `data-heading-font`. Every General option comes through this one loop, so an
 * option added to the contract is on the root the day it exists. `style` names the premade the
 * venue started from and `colours` is the colour page's: neither is a look of its own.
 */
export function generalAttributes(design: DesignValues): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {}
  for (const [option, value] of Object.entries(design.general ?? {})) {
    if (option === 'style' || option === 'colours') continue
    attributes[`data-${option.replace(/_/g, '-')}`] = value
  }
  return attributes
}
