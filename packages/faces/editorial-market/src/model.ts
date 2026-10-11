// The small pure helpers of the Editorial Market face: language tags, asset addresses, image
// attributes, the guest's filters, the face's presentation options and the theme as CSS
// variables. No React and nothing from outside @restro/shell.

import type {
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

/* ---------------------------------------------------------------------------------------------
 * Options
 * ------------------------------------------------------------------------------------------- */

/** The face's own presentation options, as the venue published them. */
export interface FaceOptions {
  /** The layout the menu starts in. */
  readonly layout: Layout
  /** Whether the guest gets the layout switch. */
  readonly layoutSwitch: boolean
  /** Whether the first section is drawn as the photo-led strip. */
  readonly featureFirstSection: boolean
}

/** What the face does when an option is missing, unknown or of the wrong type. */
export const DEFAULT_OPTIONS: FaceOptions = {
  layout: 'two',
  layoutSwitch: true,
  featureFirstSection: true,
}

/** The options from the host's (unvalidated) record; anything that is not right falls back to the default. */
export function readOptions(
  raw: Readonly<Record<string, string | boolean>> | undefined,
): FaceOptions {
  const layout = raw?.layout
  const layoutSwitch = raw?.layoutSwitch
  const featureFirstSection = raw?.featureFirstSection
  return {
    layout: isLayout(layout) ? layout : DEFAULT_OPTIONS.layout,
    layoutSwitch: typeof layoutSwitch === 'boolean' ? layoutSwitch : DEFAULT_OPTIONS.layoutSwitch,
    featureFirstSection:
      typeof featureFirstSection === 'boolean'
        ? featureFirstSection
        : DEFAULT_OPTIONS.featureFirstSection,
  }
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
