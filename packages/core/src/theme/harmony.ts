// "Suggest with colour theory" (D70, brief SH-01 §5): three venue colours from one brand colour by
// a classic harmony rule, worked out in OKLCH so the hue relations hold as people see them.
//
// The seed is the venue's brand colour and stays the tertiary (the ~10% highlights) exactly as
// chosen. The primary (the ~60% page) and the secondary (the ~30% panels) take the rule's hues:
// the primary a calm, light, low-chroma page colour, the secondary a slightly deeper panel colour.
// `deriveRoles` then makes every pair readable, so a suggestion never has to.

import { hexToOklch, oklchToHex } from './colour'
import type { ThemeColours } from './roles'

/** The harmony rules the Design tab offers. */
export const HARMONY_RULES = [
  'complementary',
  'analogous',
  'triadic',
  'split_complementary',
  'monochrome',
] as const

/** One harmony rule. */
export type HarmonyRule = (typeof HARMONY_RULES)[number]

/**
 * The hue offsets (degrees from the seed's hue) of the primary and the secondary per rule:
 * complementary opposite; analogous a neighbour on each side; triadic the two thirds; split
 * complementary the two neighbours of the opposite; monochrome the seed's own hue.
 */
export const HARMONY_OFFSETS: { readonly [R in HarmonyRule]: readonly [number, number] } = {
  complementary: [180, 180],
  analogous: [30, -30],
  triadic: [120, 240],
  split_complementary: [150, 210],
  monochrome: [0, 0],
}

/**
 * The page: light and calm (OKLCH L 0.94–0.97 band), a tint rather than a colour (the designer's
 * pages sit at chroma 0.002–0.013; a little more keeps the rule's hue visible).
 */
const PRIMARY_L = 0.96
const PRIMARY_MAX_CHROMA = 0.02
/** The panels: a step deeper than the page, a little more colour (the designer's: 0.015–0.025). */
const SECONDARY_L = 0.91
const SECONDARY_MAX_CHROMA = 0.035
/** Page and panels never carry more than this share of the seed's own chroma. */
const PRIMARY_CHROMA_SHARE = 0.5
const SECONDARY_CHROMA_SHARE = 0.75

const hueOf = (degrees: number) => ((degrees % 360) + 360) % 360

/**
 * Three venue colours from a brand colour (`#rrggbb`) by `rule`. Deterministic; a grey seed gives
 * grey page and panels (its chroma is zero, so the hue does not matter).
 */
export function suggestHarmony(seed: string, rule: HarmonyRule): ThemeColours {
  const tertiary = seed.toLowerCase()
  const { c, h } = hexToOklch(tertiary)
  const [primaryOffset, secondaryOffset] = HARMONY_OFFSETS[rule]
  return {
    primary: oklchToHex({
      l: PRIMARY_L,
      c: Math.min(PRIMARY_MAX_CHROMA, c * PRIMARY_CHROMA_SHARE),
      h: hueOf(h + primaryOffset),
    }),
    secondary: oklchToHex({
      l: SECONDARY_L,
      c: Math.min(SECONDARY_MAX_CHROMA, c * SECONDARY_CHROMA_SHARE),
      h: hueOf(h + secondaryOffset),
    }),
    tertiary,
  }
}
