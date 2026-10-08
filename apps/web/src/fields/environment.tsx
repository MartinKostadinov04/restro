'use client'

import { type Currency, type Locale, localeToBcp47 } from '@restro/core'
import { useLocale } from 'next-intl'
import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { isAdminLocale, toDataLocale } from '@/i18n/locales'

/** What a field's Display and Editor need to know about where they are shown. */
export interface FieldEnvironment {
  /** The interface language as a document language: the language labels and numbers use. */
  readonly locale: Locale
  /** The languages the venue enabled: a localized_text editor has one tab for each. */
  readonly enabledLocales: readonly Locale[]
  readonly currency: Currency
  /** The venue's IANA time zone: datetimes are shown in it, never in the browser's. */
  readonly timezone: string
}

export type FieldEnvironmentOverrides = Partial<Omit<FieldEnvironment, 'locale'>>

const Context = createContext<FieldEnvironmentOverrides | null>(null)

/** Tells the fields below it about the venue they belong to (languages, currency, time zone). */
export function FieldEnvironmentProvider({
  children,
  ...environment
}: FieldEnvironmentOverrides & { children: ReactNode }) {
  const { enabledLocales, currency, timezone } = environment
  const value = useMemo(
    () => ({ enabledLocales, currency, timezone }),
    [enabledLocales, currency, timezone],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

/** The interface language plus the venue's settings (Bulgarian + English, EUR, Sofia by default). */
export function useFieldEnvironment(): FieldEnvironment {
  const uiLocale = useLocale()
  const overrides = useContext(Context)
  return useMemo(
    () => ({
      locale: toDataLocale(isAdminLocale(uiLocale) ? uiLocale : 'bg'),
      enabledLocales: overrides?.enabledLocales ?? ['bg_BG', 'en_US'],
      currency: overrides?.currency ?? 'EUR',
      timezone: overrides?.timezone ?? 'Europe/Sofia',
    }),
    [uiLocale, overrides],
  )
}

/** The BCP 47 tag of the environment's language, for `Intl`. */
export function bcp47(environment: FieldEnvironment): string {
  return localeToBcp47(environment.locale)
}
