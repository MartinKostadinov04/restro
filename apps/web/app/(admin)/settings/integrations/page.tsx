import { getTranslations } from 'next-intl/server'

import { IntegrationsScreen } from '@/integration/integrations-screen'
import { getPool } from '@/server/db'
import { serverEnv } from '@/server/env'
import { loadIntegrationsView } from '@/server/integration/service'
import { canManageIntegration } from '@/server/roles'
import { requireTenant } from '@/server/session'

export async function generateMetadata() {
  const t = await getTranslations('settings')
  return { title: t('sections.integrations') }
}

// Settings -> Integrations (D81): the systems the organisation uses, a tab for each, and in it the
// named connections to that system. A server component (U4): it reads the whole page in one go and
// hands the cards plain data. Everyone in the organisation may open it; owners and admins change
// things, the others see it read-only (the actions check the role again).
export default async function SettingsIntegrationsPage() {
  const { organization } = await requireTenant()
  const t = await getTranslations('settings')
  const view = await loadIntegrationsView(
    {
      pool: getPool(),
      tenantId: organization.id,
      canManage: canManageIntegration(organization.role),
    },
    { sealPublicKey: serverEnv().SEAL_PUBLIC_KEY },
  )

  return (
    <section aria-labelledby="settings-integrations-heading" className="space-y-4">
      <div>
        <h2 id="settings-integrations-heading" className="text-lg font-semibold tracking-tight">
          {t('sections.integrations')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('integrations.description')}</p>
      </div>
      <IntegrationsScreen view={view} />
    </section>
  )
}
