import type { Locale, LocalizedText } from '@restro/core'

/**
 * The text of a `localized_text` value to show in `locale`: that language if present, else
 * English, else Bulgarian, else any language there is. Menu text comes from the document, never
 * from interface strings.
 */
export function pickLocalized(text: LocalizedText, locale: Locale): string | undefined {
  const exact = text[locale]
  if (exact !== undefined) return exact
  return text.en_US ?? text.bg_BG ?? Object.values(text).find((value) => value !== undefined)
}

/** Two-letter chip for a document language: `bg_BG` becomes `BG`. */
export function localeChip(locale: string): string {
  return (locale.split('_')[0] ?? locale).toUpperCase()
}
