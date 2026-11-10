// The six fonts a venue can choose (D70, `THEME_FONTS` in core), served by this app. `next/font`
// downloads the files when the app is built and serves them from our own origin, so a guest's phone
// never calls Google (or anyone else) for a font; the guest page and the admin read the same files.
//
// - Latin and Cyrillic subsets only (the menus are Bulgarian and English). The browser fetches a
//   file only when text on the page needs it, so a venue that chose Lora costs a guest Lora and
//   nothing else.
// - Only Inter is preloaded: it is the admin's font and the default of a venue that chose none.
//   Preloading all six would put twelve files in front of every page for the sake of five fonts
//   most pages never draw.
// - They are variable fonts, so any weight a face asks for (the Editorial Market uses 750 to 880)
//   is the font's own, never a synthesised bold.
//
// `next/font` reads the options of each call at build time, so every call below is written out in
// full; `LOADED` ties them to `THEME_FONTS`, so adding a font to core fails the type check until a
// loader is added here.

import { type FontKind, THEME_FONTS, type ThemeFontId } from '@restro/core'
import { Inter, Lora, Manrope, Montserrat, Playfair_Display, Unbounded } from 'next/font/google'

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-inter',
})
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-manrope',
  preload: false,
})
const montserrat = Montserrat({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-montserrat',
  preload: false,
})
const playfairDisplay = Playfair_Display({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-playfair-display',
  preload: false,
})
const lora = Lora({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-lora',
  preload: false,
})
const unbounded = Unbounded({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-unbounded',
  preload: false,
})

/** The loaded font of every id of `THEME_FONTS`. */
const LOADED = {
  inter,
  manrope,
  montserrat,
  'playfair-display': playfairDisplay,
  lora,
  unbounded,
} satisfies Record<ThemeFontId, { readonly variable: string }>

/**
 * The class names that define the six `--font-<id>` variables: apply them to `<html>` once
 * (`app/layout.tsx`), and every page, the guest's and the admin's preview alike, can use them.
 */
export const FONT_VARIABLES: string = THEME_FONTS.map((font) => LOADED[font.id].variable).join(' ')

/** What a font falls back to while it loads (and where it is missing), by kind. */
const FALLBACKS: Record<FontKind, string> = {
  sans: 'system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  display: 'system-ui, sans-serif',
}

/** The CSS variable a font's loader defines. */
const variableOf = (id: string) => `--font-${id}`

/**
 * A font's stack without a CSS variable, for a frame that cannot read the page's (a provider's card
 * form, D130): the installed family of that name, then a system font of the same kind.
 */
export function plainFontStack(family: string): string {
  const font = THEME_FONTS.find((entry) => entry.family === family)
  return `"${family}", ${FALLBACKS[font?.kind ?? 'sans']}`
}

/**
 * Family name (what the snapshot's `theme.font` carries) -> the font stack a face puts in its
 * `font-family`: our own file first, then the installed family of that name, then a system font of
 * the same kind.
 */
export const FONT_STACKS: Readonly<Record<string, string>> = Object.fromEntries(
  THEME_FONTS.map((font) => [
    font.family,
    `var(${variableOf(font.id)}), "${font.family}", ${FALLBACKS[font.kind]}`,
  ]),
)
