'use client'

import {
  type Currency,
  type Locale,
  type LocalizedText,
  localeToBcp47,
  type TagColor,
} from '@restro/core'
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
  /**
   * Short-lived links to the files behind image values, by asset id, when the screen has them
   * (the item sheet does). A value holds the id only; without a link an image shows a placeholder.
   */
  readonly assetUrls: Readonly<Record<string, string>>
  /** The venue's language the menu is written in first (a new tag needs a name in it). */
  readonly defaultLocale: Locale
  /**
   * The venue's active tags in order, when the screen knows them (the composer does): a `tags`
   * value holds ids from this list. Without it a tags value shows nothing to pick from.
   */
  readonly tags: readonly EnvironmentTag[] | undefined
  /**
   * Creates a tag in the venue's list and resolves with it once it is saved (null when it was
   * not); absent where tags cannot be made (the tags editor then offers only the existing ones).
   */
  readonly createTag: ((draft: TagDraft) => Promise<EnvironmentTag | null>) | undefined
}

/** A venue tag as a field's Display and Editor see it. */
export interface EnvironmentTag {
  readonly id: string
  /** The name in the interface language. */
  readonly name: string
  readonly color: TagColor
}

/** A new tag: its name per language and its colour. */
export interface TagDraft {
  readonly label: LocalizedText
  readonly color: TagColor
}

export type FieldEnvironmentOverrides = Partial<Omit<FieldEnvironment, 'locale'>>

const Context = createContext<FieldEnvironmentOverrides | null>(null)

const NO_ASSET_URLS: Readonly<Record<string, string>> = {}

/** Tells the fields below it about the venue they belong to (languages, currency, time zone). */
export function FieldEnvironmentProvider({
  children,
  ...environment
}: FieldEnvironmentOverrides & { children: ReactNode }) {
  const { enabledLocales, defaultLocale, currency, timezone, assetUrls, tags, createTag } =
    environment
  const value = useMemo(
    () => ({ enabledLocales, defaultLocale, currency, timezone, assetUrls, tags, createTag }),
    [enabledLocales, defaultLocale, currency, timezone, assetUrls, tags, createTag],
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
      assetUrls: overrides?.assetUrls ?? NO_ASSET_URLS,
      defaultLocale: overrides?.defaultLocale ?? overrides?.enabledLocales?.[0] ?? 'bg_BG',
      tags: overrides?.tags,
      createTag: overrides?.createTag,
    }),
    [uiLocale, overrides],
  )
}

/** The BCP 47 tag of the environment's language, for `Intl`. */
export function bcp47(environment: FieldEnvironment): string {
  return localeToBcp47(environment.locale)
}
