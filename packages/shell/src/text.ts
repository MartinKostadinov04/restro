// R3 Language: for each text, the requested language, then the menu default, then any available.
// A text that comes back is never empty and carries the language it is really in, so the face can
// set the `lang` attribute.

import { LOCALES, type Locale, type LocalizedText } from '@restro/core'

/** A text and the language it is in. */
export interface ViewText {
  readonly text: string
  readonly lang: Locale
}

/**
 * The order languages are tried in: the requested one, the menu default, the menu's available
 * languages in their order, then any other language a text happens to hold.
 */
export function fallbackChain(
  requested: Locale,
  menuDefault: Locale,
  available: readonly Locale[],
): readonly Locale[] {
  return [...new Set<Locale>([requested, menuDefault, ...available, ...LOCALES])]
}

/** The first non-blank text in the chain, or null when the text holds nothing readable. */
export function pickText(
  text: LocalizedText | undefined,
  chain: readonly Locale[],
): ViewText | null {
  if (text === undefined) return null
  for (const lang of chain) {
    const value = text[lang]
    if (value !== undefined && value.trim() !== '') return { text: value, lang }
  }
  return null
}
