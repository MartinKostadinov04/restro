// The admin's interface languages. These are *interface* strings only (messages/*.json); the
// menu's own text comes from the document's `localized_text`, never from here (CLAUDE.md, i18n).
// The language is a cookie: no URL prefix in the admin.
import type { Locale } from '@restro/core'

export const ADMIN_LOCALES = ['bg', 'en'] as const

/** An interface language of the admin. */
export type AdminLocale = (typeof ADMIN_LOCALES)[number]

export const DEFAULT_ADMIN_LOCALE: AdminLocale = 'bg'

/** Name of the cookie that holds the interface language (next-intl's usual name). */
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export function isAdminLocale(value: unknown): value is AdminLocale {
  return typeof value === 'string' && (ADMIN_LOCALES as readonly string[]).includes(value)
}

/** The interface language for a cookie value; Bulgarian when absent or unknown. */
export function resolveAdminLocale(value: string | undefined): AdminLocale {
  return isAdminLocale(value) ? value : DEFAULT_ADMIN_LOCALE
}

/** The document language (barsy key) that matches an interface language. */
export function toDataLocale(locale: AdminLocale): Locale {
  return locale === 'bg' ? 'bg_BG' : 'en_US'
}

/** The interface language that matches a document language, if the admin has one. */
export function fromDataLocale(locale: Locale): AdminLocale | undefined {
  if (locale === 'bg_BG') return 'bg'
  if (locale === 'en_US') return 'en'
  return undefined
}
