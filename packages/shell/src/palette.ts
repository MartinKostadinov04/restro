// R13 Theme, the colour half: one brand colour to an 11-step palette, and from a palette to the
// semantic colours a face uses, each text-on-colour pair readable (WCAG 2.x contrast of at least
// 4.5:1, AA for normal text). Written in-house, no colour library (Martin, 10-10).
//
// Ported from the Platform's `resources/js/Pages/Design/Index.jsx` lines 26-46 (`generatePalette`:
// steps 50..950 at HSL lightness .95, .9, .8 … .1, .05 with `chroma(base).set('hsl.l', l).hex()`)
// and 120-130 (the palette stored as a list, the brand colour being the 500 step).
// Changed while porting: no chroma-js; semantic colours (background, surface, accent, on-accent,
// text, muted …) instead of palette slots picked by magic index; every pair checked for contrast
// and nudged along the palette (then to black or white) until it passes; invalid colours ignored.
//
// The colour maths lives in @restro/core (`theme/`), so the publisher, which cannot import the
// shell, works with the same functions: the palette and the HSL conversions moved in S3-03; the
// contrast helpers and the semantic colours (`semanticColours`, `semanticColoursDark`) in SH-01.
// They are re-exported here unchanged, so nothing that imports the shell changes.

import {
  contrastRatio,
  FALLBACK_BRAND,
  generatePalette,
  hexToHsl,
  hslToHex,
  isHexColour,
  MIN_TEXT_CONTRAST,
  PALETTE_STEPS,
  type Palette,
  type PaletteStep,
  readableOn,
  relativeLuminance,
  type SemanticColours,
  semanticColours,
  semanticColoursDark,
} from '@restro/core'

export {
  contrastRatio,
  FALLBACK_BRAND,
  generatePalette,
  hexToHsl,
  hslToHex,
  isHexColour,
  MIN_TEXT_CONTRAST,
  PALETTE_STEPS,
  type Palette,
  type PaletteStep,
  readableOn,
  relativeLuminance,
  type SemanticColours,
  semanticColours,
  semanticColoursDark,
}

const WHITE = '#ffffff'
const BLACK = '#000000'

/** The palette steps of a theme, however many colours the snapshot carries. */
export function resolvePalette(colours: readonly string[]): Palette {
  const valid = colours.filter(isHexColour)
  if (valid.length === PALETTE_STEPS.length && colours.length === valid.length) {
    return Object.fromEntries(PALETTE_STEPS.map((step, index) => [step, valid[index]])) as Palette
  }
  // Another count is a list the publisher did not lay out by step: take the colour nearest the
  // middle lightness as the brand colour and lay the steps out ourselves.
  const brand = [...valid].sort(
    (a, b) => Math.abs(hexToHsl(a).l - 0.5) - Math.abs(hexToHsl(b).l - 0.5),
  )[0]
  return generatePalette(brand ?? FALLBACK_BRAND)
}

/** A readable text colour for any colour a venue picks (a section's colour hint). */
export function textOn(colour: string, palette: Palette): string {
  return readableOn([colour], [WHITE, palette[950], BLACK])
}
