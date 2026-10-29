import { Building2Icon } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { AdminHeader } from '@/components/admin/admin-header'
import { NewVenueButton } from '@/components/admin/new-venue-dialog'
import { VenueCard } from '@/components/admin/venue-card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { getPool } from '@/server/db'
import { canManageIntegration } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { staffLandingVenue } from '@/server/tonight/landing'
import { listVenueCards } from '@/server/venues'

export async function generateMetadata() {
  const t = await getTranslations('venues')
  return { title: t('title') }
}

export default async function VenuesPage() {
  // The query runs inside withTenant: row-level security shows only this organisation's venues.
  const { organization, user, sessionId } = await requireTenant()
  // A staff-only sign-in lands on Tonight of the venue it works at (plan §2).
  const landing = await staffLandingVenue({
    tenantId: organization.id,
    role: organization.role,
    userId: user.id,
    sessionId,
  })
  if (landing !== null) redirect(`/venues/${landing}?tab=tonight`)
  const venues = await listVenueCards(getPool(), organization.id)
  const t = await getTranslations('venues')
  // Owners and admins add and unpublish venues (the actions check the role again).
  const canCreate = canManageIntegration(organization.role)

  return (
    <>
      <AdminHeader current={t('title')} />
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('description', { organization: organization.name })}
            </p>
          </div>
          {canCreate ? <NewVenueButton testId="new-venue" /> : null}
        </div>
        {venues.length === 0 ? (
          <Empty data-testid="venues-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2Icon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{t('empty.title')}</EmptyTitle>
              <EmptyDescription>
                {t(canCreate ? 'empty.description' : 'empty.descriptionReadOnly')}
              </EmptyDescription>
            </EmptyHeader>
            {canCreate ? (
              <EmptyContent>
                <NewVenueButton testId="new-venue-empty" />
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <ul className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
            {venues.map((venue) => (
              <li key={venue.id}>
                <VenueCard venue={venue} canManage={canCreate} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
