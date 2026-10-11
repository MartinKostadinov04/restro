import { menuPath } from '@restro/core'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { AppearanceSection } from '@/appearance/appearance-section'
import { AdminHeader } from '@/components/admin/admin-header'
import { VenueSettings } from '@/components/admin/venue-settings'
import { DEFAULT_WORKSPACE_TAB, isWorkspaceTab } from '@/components/admin/workspace-tab-defs'
import { WorkspaceTabs } from '@/components/admin/workspace-tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { ComposerSkeleton } from '@/composer/composer-skeleton'
import { ComposerTab } from '@/composer/composer-tab'
import { IntegrationSkeleton } from '@/integration/integration-skeleton'
import { IntegrationTab } from '@/integration/integration-tab'
import { PublishSkeleton } from '@/publish/publish-skeleton'
import { PublishTab } from '@/publish/publish-tab'
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
  const requestedTab = (await searchParams).tab
  const openTab = isWorkspaceTab(requestedTab) ? requestedTab : DEFAULT_WORKSPACE_TAB
  const composerOpen = openTab === 'composer'
  const publishingOpen = openTab === 'publishing'
  const integrationOpen = openTab === 'integration'
  const tablesOpen = openTab === 'tables'
  const settingsOpen = openTab === 'settings'

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
            integration: integrationOpen ? (
              <Suspense fallback={<IntegrationSkeleton />}>
                <IntegrationTab tenantId={organization.id} role={organization.role} venue={venue} />
              </Suspense>
            ) : (
              <IntegrationSkeleton />
            ),
            settings: (
              <div className="space-y-8">
                <VenueSettings venue={venue} role={organization.role} />
                {settingsOpen ? (
                  <Suspense fallback={<Skeleton className="h-96 w-full" />}>
                    <AppearanceSection
                      tenantId={organization.id}
                      role={organization.role}
                      venue={venue}
                    />
                  </Suspense>
                ) : null}
              </div>
            ),
          }}
        />
      </div>
    </>
  )
}
