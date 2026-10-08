import { type Locale, localeToBcp47 } from '@restro/core'
import type { Venue } from '@restro/db'
import { getLocale, getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { FormSection } from '@/components/ui/form-section'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-foreground">{label}</dt>
      <dd className="text-sm text-muted-foreground sm:col-span-2">{children}</dd>
    </div>
  )
}

/** The venue's settings, read-only: editing them arrives with the composer (Stage 2). */
export async function VenueSettings({ venue }: { venue: Venue }) {
  const t = await getTranslations('workspace.settings')
  const uiLocale = await getLocale()
  const languageNames = new Intl.DisplayNames([uiLocale], { type: 'language' })
  const languageName = (locale: string) =>
    languageNames.of(localeToBcp47(locale as Locale)) ?? locale

  return (
    <FormSection title={t('title')} description={t('description')}>
      <dl className="grid gap-4">
        <Row label={t('name')}>{venue.name}</Row>
        <Row label={t('slug')}>
          <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{venue.slug}</code>
        </Row>
        <Row label={t('timezone')}>{venue.timezone}</Row>
        <Row label={t('serviceDayEnd')}>{venue.serviceDayEndsAt.slice(0, 5)}</Row>
        <Row label={t('languages')}>
          <span className="flex flex-wrap gap-1.5">
            {venue.enabledLocales.map((locale) => (
              <Badge
                key={locale}
                variant={locale === venue.defaultLocale ? 'default' : 'secondary'}
              >
                {languageName(locale)}
                {locale === venue.defaultLocale ? ` · ${t('defaultLanguage')}` : ''}
              </Badge>
            ))}
          </span>
        </Row>
        <Row label={t('currency')}>{venue.currency}</Row>
      </dl>
      <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
    </FormSection>
  )
}
