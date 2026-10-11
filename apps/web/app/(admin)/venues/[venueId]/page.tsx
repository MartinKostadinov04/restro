import { menuPath } from '@restro/core'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { AdminHeader } from '@/components/admin/admin-header'
import { VenueDangerZone } from '@/components/admin/venue-danger-zone'
import { VenueSettings } from '@/components/admin/venue-settings'
import { workspaceTabOf } from '@/components/admin/workspace-tab-defs'
import { WorkspaceTabs } from '@/components/admin/workspace-tabs'
import { ComposerSkeleton } from '@/composer/composer-skeleton'
import { ComposerTab } from '@/composer/composer-tab'
import { DesignSkeleton } from '@/design/design-skeleton'
import { DesignTab } from '@/design/design-tab'
import { MenuSourceSkeleton } from '@/integration/menu-source-skeleton'
import { MenuSourceTab } from '@/integration/menu-source-tab'
import { PublishSkeleton } from '@/publish/publish-skeleton'
import { PublishTab } from '@/publish/publish-tab'
import { canDeleteVenue } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { getVenue } from '@/server/venues'
import { TablesSkeleton } from '@/tables/tables-skeleton'
import { TablesTab } from '@/tables/tables-tab'

export async function generateMetadata({ params }: PageProps<'/venues/[venueId]'>) {
  const { organization } = await requireTenant()
  const venue = await getVenue(organization.id, (await params).venueId)
  return { title: venue?.name ?? (await getTranslations('venues'))('title') }
}

export default async function VenueWorkspacePage({
  params,
  searchParams,
}: PageProps<'/venues/[venueId]'>) {
  const { organization } = await requireTenant()
  // Another tenant's venue and a made-up id both come back as null: row-level security hides
  // the row, so the answer is the same 404 either way.
  const venue = await getVenue(organization.id, (await params).venueId)
  if (!venue) notFound()

  // The composer reads the whole menu: only read it while its tab is the open one (the tab bar
  // shows the skeleton at once when someone switches to it, and the page streams the rest in).
  const openTab = workspaceTabOf((await searchParams).tab)
  const composerOpen = openTab === 'composer'
  const publishingOpen = openTab === 'publishing'
  const settingsOpen = openTab === 'settings'
  const tablesOpen = openTab === 'tables'
  const designOpen = openTab === 'design'

  const tNav = await getTranslations('nav')

  return (
    <>
      <AdminHeader trail={[{ label: tNav('venues'), href: '/venues' }]} current={venue.name} />
      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{venue.name}</h1>
          <code
            className="mt-2 inline-block max-w-full break-all rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground ring-1 ring-border"
            data-testid="venue-header-address"
          >
            {menuPath(venue)}
          </code>
        </div>
        <WorkspaceTabs
          contents={{
            composer: composerOpen ? (
              <Suspense fallback={<ComposerSkeleton />}>
                <ComposerTab tenantId={organization.id} venue={venue} />
              </Suspense>
            ) : (
              <ComposerSkeleton />
            ),
            tables: tablesOpen ? (
              <Suspense fallback={<TablesSkeleton />}>
                <TablesTab tenantId={organization.id} role={organization.role} venue={venue} />
              </Suspense>
            ) : (
              <TablesSkeleton />
            ),
            publishing: publishingOpen ? (
              <Suspense fallback={<PublishSkeleton />}>
                <PublishTab tenantId={organization.id} role={organization.role} venue={venue} />
              </Suspense>
            ) : (
              <PublishSkeleton />
            ),
            design: designOpen ? (
              <Suspense fallback={<DesignSkeleton />}>
                <DesignTab tenantId={organization.id} role={organization.role} venue={venue} />
              </Suspense>
            ) : (
              <DesignSkeleton />
            ),
            settings: (
              <div className="grid gap-8">
                <VenueSettings venue={venue} role={organization.role} />
                {settingsOpen ? (
                  <Suspense fallback={<MenuSourceSkeleton />}>
                    <MenuSourceTab
                      tenantId={organization.id}
                      role={organization.role}
                      venue={venue}
                    />
                  </Suspense>
                ) : (
                  <MenuSourceSkeleton />
                )}
                {/* The end of the tab (D76): only an owner deletes a venue; the action checks again. */}
                {canDeleteVenue(organization.role) ? (
                  <VenueDangerZone venueId={venue.id} venueName={venue.name} />
                ) : null}
              </div>
            ),
          }}
        />
      </div>
    </>
  )
}
