import { PlugIcon, QrCodeIcon, RocketIcon } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'

import { AdminHeader } from '@/components/admin/admin-header'
import { StagePlaceholder } from '@/components/admin/stage-placeholder'
import { VenueSettings } from '@/components/admin/venue-settings'
import { DEFAULT_WORKSPACE_TAB, isWorkspaceTab } from '@/components/admin/workspace-tab-defs'
import { WorkspaceTabs } from '@/components/admin/workspace-tabs'
import { ComposerSkeleton } from '@/composer/composer-skeleton'
import { ComposerTab } from '@/composer/composer-tab'
import { requireTenant } from '@/server/session'
import { getVenue } from '@/server/venues'

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
  const composerOpen =
    (isWorkspaceTab(requestedTab) ? requestedTab : DEFAULT_WORKSPACE_TAB) === 'composer'

  const t = await getTranslations('workspace')
  const tNav = await getTranslations('nav')
  const stage = (n: number) => t('comingInStage', { stage: n })

  return (
    <>
      <AdminHeader trail={[{ label: tNav('venues'), href: '/venues' }]} current={venue.name} />
      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{venue.name}</h1>
          <code className="mt-2 inline-block rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground ring-1 ring-border">
            #{venue.slug}
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
            tables: (
              <StagePlaceholder
                icon={QrCodeIcon}
                title={t('tables.title')}
                description={t('tables.description')}
                stageLabel={stage(3)}
              />
            ),
            publishing: (
              <StagePlaceholder
                icon={RocketIcon}
                title={t('publishing.title')}
                description={t('publishing.description')}
                stageLabel={stage(3)}
              />
            ),
            integration: (
              <StagePlaceholder
                icon={PlugIcon}
                title={t('integration.title')}
                description={t('integration.description')}
                stageLabel={stage(2)}
              />
            ),
            settings: <VenueSettings venue={venue} />,
          }}
        />
      </div>
    </>
  )
}
