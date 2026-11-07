import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

import { SettingsHeader } from '@/components/admin/settings-header'
import { SettingsNav } from '@/components/admin/settings-nav'
import { canDeleteVenue } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { onSharedDevice } from '@/server/staff/shared-device'
import { OwnSignInNotice } from '@/settings/section-notices'

export async function generateMetadata() {
  const t = await getTranslations('settings')
  return { title: t('title') }
}

// The frame of the organisation's Settings (D73, D74): a title, the sections to move between, and
// a slot for the open section. Everyone in the organisation may open it; who may change what is
// decided per section, inside the section's own page. As in every admin layout, the pages check
// the session themselves. The layout only reads the role to draw the sections that are for owners
// only (Deleted venues, D76); their pages check it again.
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('settings')
  const { organization, sessionId } = await requireTenant()
  // A shared device has no link here; an old link says what it takes instead of offering sections
  // that would only answer "not allowed" (RR-85).
  const device = await onSharedDevice({ tenantId: organization.id, sessionId })

  return (
    <>
      <SettingsHeader />
      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {device ? (
          <OwnSignInNotice />
        ) : (
          <>
            <SettingsNav isOwner={canDeleteVenue(organization.role)} />
            <div data-testid="settings-content">{children}</div>
          </>
        )}
      </div>
    </>
  )
}
