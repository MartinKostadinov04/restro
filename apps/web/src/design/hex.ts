// Hex colours as people type them, and the brand colours the Design tab offers as one-click
// starting points. Moved from the old Appearance card's `preview.ts` (the contrast preview there is
// replaced by the derived roles of the Design tab). Pure.
import { FALLBACK_BRAND, isHexColour } from '@restro/core'

/** The colours offered as one-click starting points for a brand colour. */
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
