import { organizationAddress } from '@restro/core/apply'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { OrganizationGeneral } from '@/components/admin/organization-general'
import { getPool } from '@/server/db'
import { canManageOrganization } from '@/server/roles'
import { requireTenant } from '@/server/session'

export async function generateMetadata() {
  const t = await getTranslations('settings')
  return { title: t('sections.general') }
}

// Settings -> General (D91): the organisation's name and its address name, the first part of every
// guest address `/m/<organisation>/<venue>` (D84). A server component (U4): it reads the saved
// values and hands them to the form. Everyone in the organisation may open it; owners change the
// two values, the others see them (the action checks the role again).
export default async function SettingsGeneralPage() {
  const { organization } = await requireTenant()
  const t = await getTranslations('settings')
  const address = await organizationAddress(getPool(), organization.id)
  if (address === null) notFound()

  return (
    <section aria-labelledby="settings-general-heading" className="space-y-4">
      <div>
        <h2 id="settings-general-heading" className="text-lg font-semibold tracking-tight">
          {t('sections.general')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('general.description')}</p>
      </div>
      {/* A new key when a save (or another tab) changed the values, so the fields start from them. */}
      <OrganizationGeneral
        key={`${address.name}\n${address.slug}`}
        name={address.name}
        slug={address.slug}
        canEdit={canManageOrganization(organization.role)}
      />
    </section>
  )
}
