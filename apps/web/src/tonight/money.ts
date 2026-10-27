'use client'

// Money as the screen words it: through core's money module (rule 8), in the admin's language.
import { CURRENCIES, type Currency, formatMoney } from '@restro/core'
import { useLocale } from 'next-intl'

import { resolveAdminLocale, toDataLocale } from '@/i18n/locales'

export function useMoney() {
  const locale = toDataLocale(resolveAdminLocale(useLocale()))
  return (minor: number, currency: string) =>
    formatMoney(
      minor,
      (CURRENCIES as readonly string[]).includes(currency) ? (currency as Currency) : 'EUR',
      locale,
    )
}
