// The short list of fonts a venue can choose (D70, brief SH-01 §7). Six families with Cyrillic
// letters, served by us (SH-04 self-hosts them; guests' phones never call Google). The `family`
// is what the snapshot's `theme.font` carries and must pass its font-name pattern.
//
// Checked on 10-11 against Next's Google font data
// (`next/dist/compiled/@next/font/dist/google/font-data.json`): each family below lists the
// `cyrillic` subset (Inter, Manrope, Montserrat, Lora and Unbounded also `cyrillic-ext`), so the
// brief's list stands as it was.

/** What kind of face a font is. */
export const FONT_KINDS = ['sans', 'serif', 'display'] as const

/** One font kind. */
export type FontKind = (typeof FONT_KINDS)[number]

/** One font of the list. */
export interface ThemeFont {
  /** The stored id: kebab-case. */
  readonly id: string
  /** The family name, as the snapshot carries it. */
  readonly family: string
  readonly kind: FontKind
}

/** The fonts a venue can choose, the default first. */
export const THEME_FONTS = [
  { id: 'inter', family: 'Inter', kind: 'sans' },
  { id: 'manrope', family: 'Manrope', kind: 'sans' },
  { id: 'montserrat', family: 'Montserrat', kind: 'sans' },
  { id: 'playfair-display', family: 'Playfair Display', kind: 'serif' },
  { id: 'lora', family: 'Lora', kind: 'serif' },
  { id: 'unbounded', family: 'Unbounded', kind: 'display' },
] as const satisfies readonly ThemeFont[]

/** One font id. */
export type ThemeFontId = (typeof THEME_FONTS)[number]['id']

/** Every font id, in list order. */
export const THEME_FONT_IDS = THEME_FONTS.map((font) => font.id) as [ThemeFontId, ...ThemeFontId[]]

/** The font a venue gets until it chooses one (the family `DEFAULT_THEME` publishes). */
export const DEFAULT_FONT_ID: ThemeFontId = 'inter'

/** The family of a font id; the default family for an id not on the list. */
export function fontFamilyOf(id: string | undefined): string {
  const font = THEME_FONTS.find((entry) => entry.id === id) ?? THEME_FONTS[0]
  return font.family
}
