import { ArchiveRestoreIcon } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { DeletedVenuesList } from '@/components/admin/deleted-venues-list'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { canDeleteVenue } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { listArchivedVenues } from '@/server/venues'

export async function generateMetadata() {
  const t = await getTranslations('settings')
  return { title: t('sections.deletedVenues') }
}

// Settings -> Deleted venues (D76): the venues an owner deleted, each with the day it was deleted
// and a Restore button. Owners only: for anyone else the page does not exist. Restoring brings a
// venue back as it was, without its till link and unpublished.
export default async function SettingsDeletedVenuesPage() {
  const { organization } = await requireTenant()
  if (!canDeleteVenue(organization.role)) notFound()
  const t = await getTranslations('settings')
  const archived = await listArchivedVenues(organization.id)

  return (
    <section aria-labelledby="settings-deleted-venues-heading" className="space-y-4">
      <div>
        <h2 id="settings-deleted-venues-heading" className="text-lg font-semibold tracking-tight">
          {t('sections.deletedVenues')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('deletedVenues.description')}</p>
      </div>
      {archived.length === 0 ? (
        <Empty data-testid="deleted-venues-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArchiveRestoreIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t('deletedVenues.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('deletedVenues.empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DeletedVenuesList
          venues={archived.flatMap((venue) =>
            venue.archivedAt === null
              ? []
              : [{ id: venue.id, name: venue.name, deletedAt: venue.archivedAt.toISOString() }],
          )}
        />
      )}
    </section>
  )
}
