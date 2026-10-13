// Readability (R13): WCAG 2.x relative luminance and contrast ratio, and the pick of the first
// colour that reads on a set of backgrounds. Moved here from the shell's `palette.ts` (brief SH-01)
// unchanged, so core can check the venue's colour roles; the shell re-exports all of it.

import { hexToRgb } from './colour'

/** WCAG AA contrast for normal text. */
export const MIN_TEXT_CONTRAST = 4.5

/** WCAG 1.4.11 contrast for controls and their parts against what they sit on (D93). */
export const MIN_CONTROL_CONTRAST = 3

const BLACK = '#000000'

/** WCAG relative luminance of a `#rrggbb` colour (0 black … 1 white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The first candidate that reads on every background at `min` contrast; when none does, the one
 * that comes closest. Black and white at the end of a list make a pass certain for a single
 * background (one of them always reaches 4.58:1).
 */
export function readableOn(
  backgrounds: readonly string[],
  candidates: readonly string[],
  min = MIN_TEXT_CONTRAST,
): string {
  let best = candidates[0] ?? BLACK
  let bestScore = -1
  for (const candidate of candidates) {
    const score = Math.min(...backgrounds.map((background) => contrastRatio(candidate, background)))
    if (score >= min) return candidate
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/** The lowest contrast `colour` has against any of `backgrounds` (Infinity for none). New in SH-01. */
export function minContrast(colour: string, backgrounds: readonly string[]): number {
  let lowest = Number.POSITIVE_INFINITY
  for (const background of backgrounds) lowest = Math.min(lowest, contrastRatio(colour, background))
  return lowest
}

/** True when `colour` reads on every one of `backgrounds` at `min` contrast or better. */
export function readsOnAll(
  colour: string,
  backgrounds: readonly string[],
  min = MIN_TEXT_CONTRAST,
): boolean {
  return minContrast(colour, backgrounds) >= min
}
