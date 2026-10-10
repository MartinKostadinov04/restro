// What the Appearance card previews: the semantic colour pairs a guest's screen will use, worked out
// from the brand colour with the same functions the publisher and the face use (`generatePalette`,
// `semanticColours`, `semanticColoursDark`), each pair with its real contrast ratio. Pure.
//
// Ported from the Platform's Design page (`Pages/Design/Index.jsx` 167-180: a colour input and the
// eleven swatches). Changed: the preview shows the pairs that matter for reading (text on page,
// text on accent …) for a light and a dark screen instead of eleven bare swatches, and a typed hex
// is accepted next to the picker.
import {
  contrastRatio,
  FALLBACK_BRAND,
  generatePalette,
  isHexColour,
  type SemanticColours,
  semanticColours,
  semanticColoursDark,
} from '@restro/shell'

/** The colours offered as one-click starting points. */
export const BRAND_SWATCHES = [
  '#e11d48',
  '#f97316',
  '#eab308',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  FALLBACK_BRAND,
] as const

/** A typed colour as `#rrggbb` in lower case (`3366CC`, `#36c` also pass), or null when it is not one. */
export function normaliseHex(value: string): string | null {
  const text = value.trim().replace(/^#/, '')
  const full = /^[0-9a-fA-F]{3}$/.test(text)
    ? [...text].map((digit) => digit + digit).join('')
    : text
  const hex = `#${full}`.toLowerCase()
  return isHexColour(hex) ? hex : null
}

/** The pairs the card names, in the order it shows them. */
export const PAIR_KEYS = ['text', 'muted', 'onAccent', 'accentText'] as const

/** One text-on-colour pair with its WCAG contrast. */
export interface PairView {
  readonly key: (typeof PAIR_KEYS)[number]
  readonly foreground: string
  readonly background: string
  readonly ratio: number
}

/** The colours of one scheme and the pairs among them. */
export interface SchemeView {
  readonly colours: SemanticColours
  readonly pairs: readonly PairView[]
}

function schemeOf(colours: SemanticColours): SchemeView {
  const pair = (key: PairView['key'], foreground: string, background: string): PairView => ({
    key,
    foreground,
    background,
    ratio: Math.round(contrastRatio(foreground, background) * 10) / 10,
  })
  return {
    colours,
    pairs: [
      pair('text', colours.text, colours.background),
      pair('muted', colours.muted, colours.surface),
      pair('onAccent', colours.onAccent, colours.accent),
      pair('accentText', colours.accentText, colours.surface),
    ],
  }
}

/** The light and the dark scheme for a brand colour (the neutral grey when it is not valid). */
export function previewOf(brand: string): { light: SchemeView; dark: SchemeView } {
  const palette = generatePalette(isHexColour(brand) ? brand : FALLBACK_BRAND)
  return { light: schemeOf(semanticColours(palette)), dark: schemeOf(semanticColoursDark(palette)) }
}
