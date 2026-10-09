// Localized text from barsy's per-language objects (doc "Shared transforms": barsy language keys
// map one-to-one to our locales).
//
// - Keys are normalised to core's LOCALES: `sr_RS@latin` becomes `sr_RS`, `bg-BG` becomes `bg_BG`,
//   anything else is dropped (never guessed).
// - An empty string, whitespace only or null means "no text in that language" and is left out:
//   a localized_text never holds an empty string.
// - Text that barsy holds without a language (`article_name_public`, a group name) is stored under
//   the default locale, unless the per-language object already has that locale.
// - Only public texts come in here. The internal names (`article_name`, `cat_name`) never do.

import { LOCALES, type Locale, type LocalizedText } from '@restro/core'

/** `sr_RS@latin` → `sr_RS`, `bg-BG` → `bg_BG`; null for a key that is not one of our locales. */
export function normaliseLocaleKey(key: string): Locale | null {
  const base = (key.split('@', 1)[0] ?? '').replace('-', '_')
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : null
}

/** The locales an installation holds (from `Languages_getlist`); empty input means "all of ours". */
export function allowedLocales(
  languages: readonly { readonly lang_id: string }[],
  defaultLocale: Locale,
): ReadonlySet<Locale> {
  const found = new Set<Locale>()
  for (const language of languages) {
    const locale = normaliseLocaleKey(language.lang_id)
    if (locale !== null) found.add(locale)
  }
  if (found.size === 0) return new Set(LOCALES)
  found.add(defaultLocale)
  return found
}

function clean(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

export interface TextContext {
  readonly defaultLocale: Locale
  readonly allowed: ReadonlySet<Locale>
}

/**
 * Builds a localized_text from barsy's per-language object and its language-less fallback.
 * Returns an empty object when barsy holds no public text at all.
 */
export function localizedText(
  perLanguage: Readonly<Record<string, string | null>> | null | undefined,
  fallback: string | null | undefined,
  context: TextContext,
): LocalizedText {
  const found = new Map<Locale, string>()
  // Sorted keys: when `sr_RS` and `sr_RS@latin` both exist the plain key sorts first and wins.
  for (const key of Object.keys(perLanguage ?? {}).sort()) {
    const locale = normaliseLocaleKey(key)
    if (locale === null || !context.allowed.has(locale) || found.has(locale)) continue
    const text = clean(perLanguage?.[key])
    if (text !== null) found.set(locale, text)
  }
  const unnamed = clean(fallback)
  if (unnamed !== null && !found.has(context.defaultLocale)) {
    found.set(context.defaultLocale, unnamed)
  }
  const result: LocalizedText = {}
  for (const locale of LOCALES) {
    const text = found.get(locale)
    if (text !== undefined) result[locale] = text
  }
  return result
}

/** True if a localized_text holds no text. */
export function isEmptyText(text: LocalizedText): boolean {
  return Object.keys(text).length === 0
}
