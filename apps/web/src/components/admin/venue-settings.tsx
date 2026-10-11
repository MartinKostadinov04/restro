import type { Venue } from '@restro/db'
import { getLocale, getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { FormSection } from '@/components/ui/form-section'
import { canManageIntegration } from '@/server/roles'

import { VenueAddress } from './venue-address'
import { VenueName } from './venue-name'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-foreground">{label}</dt>
      <dd className="text-sm text-muted-foreground sm:col-span-2">{children}</dd>
    </div>
  )
}

/**
 * The venue's settings. The name (CF-18, D76) and the menu address (CF-14, D68) can be changed by an
 * owner or admin; the rest is read-only: editing it arrives with the composer (Stage 2).
 */
export async function VenueSettings({ venue, role }: { venue: Venue; role: string }) {
  const t = await getTranslations('workspace.settings')
  const uiLocale = await getLocale()
  const languageNames = new Intl.DisplayNames([uiLocale], { type: 'language' })
  // The language only (`en`), not the dialect (`en-US`): "английски", not "американски английски".
  const languageName = (locale: string) =>
    languageNames.of(locale.split('_')[0] ?? locale) ?? locale

  return (
    <FormSection title={t('title')} description={t('description')}>
      <dl className="grid gap-4">
        <Row label={t('name')}>
          {/* A new key when the name changes elsewhere, so the field starts from the saved name. */}
          <VenueName
            key={venue.name}
            venueId={venue.id}
            name={venue.name}
            canEdit={canManageIntegration(role)}
          />
        </Row>
        <Row label={t('address')}>
          <VenueAddress
            venueId={venue.id}
            venueName={venue.name}
            slug={venue.slug}
            publicId={venue.publicId}
            canEdit={canManageIntegration(role)}
          />
        </Row>
        <Row label={t('timezone')}>{venue.timezone}</Row>
        <Row label={t('serviceDayEnd')}>{venue.serviceDayEndsAt.slice(0, 5)}</Row>
        <Row label={t('languages')}>
          <span className="flex flex-wrap gap-1.5">
            {venue.enabledLocales.map((locale) => (
              <Badge
                key={locale}
                variant={locale === venue.defaultLocale ? 'default' : 'secondary'}
                className="capitalize"
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
