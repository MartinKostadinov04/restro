import { InfoIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { requireTenant } from '@/server/session'

export async function generateMetadata() {
  const t = await getTranslations('settings')
  return { title: t('sections.integrations') }
}

// Settings → Integrations (D73). For now the heading and a note: the connection is still set up in
// each venue's Integration tab until CF-09b moves it here. A server component, so the screens that
// follow can read their data on the server; everyone in the organisation may open it, and the
// controls that change something will check the role themselves.
export default async function SettingsIntegrationsPage() {
  await requireTenant()
  const t = await getTranslations('settings')

  return (
    <section aria-labelledby="settings-integrations-heading" className="space-y-4">
      <div>
        <h2 id="settings-integrations-heading" className="text-lg font-semibold tracking-tight">
          {t('sections.integrations')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('integrations.description')}</p>
      </div>
      <p
        className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        data-testid="settings-integrations-interim"
      >
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t('integrations.interim')}</span>
      </p>
    </section>
  )
}
