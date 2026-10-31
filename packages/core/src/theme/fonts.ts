// The short list of fonts a venue can choose (D70, brief SH-01 §7). Six families with Cyrillic
// letters, served by us (SH-04 self-hosts them; guests' phones never call Google). The `family`
// is what the snapshot's `theme.font` carries and must pass its font-name pattern.
//
// The ids and their order are the design contract's Body font values (D130,
// ../design/contract.ts): this file only adds what the contract does not hold, each id's family
// and kind. `FONT_FACES` is typed by the contract's ids, so a font added to the contract fails the
// type check here until it has a family.
//
// Checked on 10-11 against Next's Google font data
// (`next/dist/compiled/@next/font/dist/google/font-data.json`): each family below lists the
// `cyrillic` subset (Inter, Manrope, Montserrat, Lora and Unbounded also `cyrillic-ext`), so the
// brief's list stands as it was.

import { DESIGN_PAGES, type DesignValues } from '../design/contract'

/** What kind of face a font is. */
export const FONT_KINDS = ['sans', 'serif', 'display'] as const

/** One font kind. */
export type FontKind = (typeof FONT_KINDS)[number]

/** One font id: a value of the contract's Body font option. */
export type ThemeFontId = DesignValues['general']['body_font']

/**
 * The family, kind and heaviest weight of each font id. The heaviest weight is the top of the
 * variable font's range in Next's Google font data (Lora stops at 700, Manrope at 800, the other
 * four reach 900); apps/web's `fonts.test.ts` holds this column equal to that data.
 */
const FONT_FACES = {
  inter: { family: 'Inter', kind: 'sans', heaviest: 900 },
  manrope: { family: 'Manrope', kind: 'sans', heaviest: 800 },
  montserrat: { family: 'Montserrat', kind: 'sans', heaviest: 900 },
  'playfair-display': { family: 'Playfair Display', kind: 'serif', heaviest: 900 },
  lora: { family: 'Lora', kind: 'serif', heaviest: 700 },
  unbounded: { family: 'Unbounded', kind: 'display', heaviest: 900 },
} as const satisfies {
  readonly [Id in ThemeFontId]: {
    readonly family: string
    readonly kind: FontKind
    readonly heaviest: number
  }
}

/** One font family, as the snapshot carries it. */
export type ThemeFontFamily = (typeof FONT_FACES)[ThemeFontId]['family']

/** One font of the list. */
export interface ThemeFont {
  /** The stored id: kebab-case, the contract's value. */
  readonly id: ThemeFontId
  /** The family name, as the snapshot carries it. */
  readonly family: ThemeFontFamily
  readonly kind: FontKind
  /** The heaviest weight the font serves: a heavier one asked for is drawn at this one. */
  readonly heaviest: number
}

/** The contract's Body font values, in its order (Basic's, the default, first). */
function themeFonts(): readonly [ThemeFont, ...ThemeFont[]] {
  const option = DESIGN_PAGES[0].options.find((entry) => entry.id === 'body_font')
  if (option === undefined || option.kind !== 'choice') {
    throw new Error('the design contract has no Body font option')
  }
  const font = (id: ThemeFontId): ThemeFont => ({ id, ...FONT_FACES[id] })
  const [first, ...rest] = option.values.map((value) => font(value.id as ThemeFontId))
  if (first === undefined) throw new Error('the design contract has no Body font value')
  return [first, ...rest]
}

/** The fonts a venue can choose, in the contract's order, the default first. */
export const THEME_FONTS = themeFonts()

/** The font a venue gets until it chooses one: Basic's Body font, the family `DEFAULT_THEME` publishes. */
export const DEFAULT_FONT_ID: ThemeFontId = 'inter'

/** The family of a font id; the default family for an id not on the list. */
export function fontFamilyOf(id: string | undefined): string {
  const font = THEME_FONTS.find((entry) => entry.id === id) ?? THEME_FONTS[0]
  return font.family
}
