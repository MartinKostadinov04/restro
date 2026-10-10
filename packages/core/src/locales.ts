import { z } from 'zod'

/**
 * Our locales: exactly the 11 language keys of barsy's `MultiLanguageData`, so barsy text maps
 * one-to-one (tracker, "barsy API — verified 10-08").
 */
export const LOCALES = [
  'bg_BG',
  'en_US',
  'de_DE',
  'es_ES',
  'fr_FR',
  'it_IT',
  'ro_RO',
  'ru_RU',
  'sr_RS',
  'el_GR',
  'tr_TR',
] as const

/** One of the 11 barsy language keys, e.g. `bg_BG`. */
export type Locale = (typeof LOCALES)[number]

/** Zod schema for a `Locale`. */
export const LocaleSchema = z.enum(LOCALES)

/** True if `value` is one of the 11 barsy language keys. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Converts a barsy locale key (`bg_BG`) to a BCP 47 tag for `Intl` (`bg-BG`). */
export function localeToBcp47(locale: Locale): string {
  return locale.replace('_', '-')
}

/**
 * Canonical `localized_text`: text per locale, any subset of the 11 keys, each text non-empty.
 * A locale with no text is absent, never an empty string. Unknown locale keys are rejected.
 */
export const LocalizedTextSchema = z.partialRecord(LocaleSchema, z.string().min(1))

/** Text per locale, e.g. `{ bg_BG: 'Негрони', en_US: 'Negroni' }`. */
export type LocalizedText = z.output<typeof LocalizedTextSchema>
