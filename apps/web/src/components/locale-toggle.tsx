'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { setAdminLocale } from '@/i18n/actions'
import { ADMIN_LOCALES, type AdminLocale } from '@/i18n/locales'

/** BG | EN buttons for places without the user menu (the sign-in page). */
export function LocaleToggle() {
  const t = useTranslations('language')
  const current = useLocale()
  const [pending, startTransition] = useTransition()

  return (
    <fieldset className="m-0 flex min-w-0 gap-1 border-0 p-0">
      <legend className="sr-only">{t('label')}</legend>
      {ADMIN_LOCALES.map((locale: AdminLocale) => (
        <Button
          key={locale}
          type="button"
          size="sm"
          variant={locale === current ? 'secondary' : 'ghost'}
          aria-pressed={locale === current}
          disabled={pending}
          lang={locale}
          onClick={() => startTransition(() => setAdminLocale(locale))}
        >
          {t(`short.${locale}`)}
        </Button>
      ))}
    </fieldset>
  )
}
