// Hex colours as people type them (the Design tab's colour boxes). Moved from the old Appearance
// card's `preview.ts`. Pure.
import { isHexColour } from '@restro/core'

/** A typed colour as `#rrggbb` in lower case (`3366CC`, `#36c` also pass), or null when it is not one. */
export function normaliseHex(value: string): string | null {
  const text = value.trim().replace(/^#/, '')
  const full = /^[0-9a-fA-F]{3}$/.test(text)
    ? [...text].map((digit) => digit + digit).join('')
    : text
  const hex = `#${full}`.toLowerCase()
  return isHexColour(hex) ? hex : null
}
