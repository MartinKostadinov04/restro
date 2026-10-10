'use client'

// Small helpers the Publish tab's cards share: the words for who did something, a menu name in the
// interface language, and a price. Menu text comes from the document's `localized_text`, never
// from interface strings (CLAUDE.md, i18n); only the labels around it are translated.
import { formatMoney, type LocalizedText, type Money } from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'

import { pickLocalized } from '@/fields/localized'
import { type AdminLocale, resolveAdminLocale, toDataLocale } from '@/i18n/locales'
import type { ActorView } from '@/server/publish/view'

/** The interface language, as one of the admin's. */
export function useAdminLocale(): AdminLocale {
  return resolveAdminLocale(useLocale())
}

/** "Maria Ivanova", "barsy sync", "the system", or "a team member" when the person is not known. */
export function useActorLabel(): (actor: ActorView) => string {
  const t = useTranslations('publish.actor')
  return (actor) => (actor.kind === 'person' ? (actor.name ?? t('person')) : t(actor.kind))
}

/** A menu name in the interface language (else English, Bulgarian, any), or `fallback`. */
export function menuName(
  name: LocalizedText | null,
  locale: AdminLocale,
  fallback: string,
): string {
  return (name === null ? undefined : pickLocalized(name, toDataLocale(locale))) ?? fallback
}

/** A price in the interface language's number style, or `none`. */
export function priceText(money: Money | null, locale: AdminLocale, none: string): string {
  return money === null
    ? none
    : formatMoney(money.amount_minor, money.currency, toDataLocale(locale))
}
