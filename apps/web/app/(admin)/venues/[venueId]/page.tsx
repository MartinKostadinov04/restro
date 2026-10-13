import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { AdminHeader } from '@/components/admin/admin-header'
import { VenueSettingsGeneral } from '@/components/admin/venue-settings-general'
import { settingsSectionOf, workspaceTabOf } from '@/components/admin/workspace-tab-defs'
import { SettingsSections, WorkspaceTabs } from '@/components/admin/workspace-tabs'
import { ComposerSkeleton } from '@/composer/composer-skeleton'
import { ComposerTab } from '@/composer/composer-tab'
import { DesignSkeleton } from '@/design/design-skeleton'
import { DesignTab } from '@/design/design-tab'
import {
  PublishSettingsSection,
  SettingsSectionSkeleton,
  VersioningSection,
} from '@/publish/settings-sections'
import { VenueHeader } from '@/publish/venue-header'
import { getPool } from '@/server/db'
import { guestPathOf } from '@/server/publish/summary'
import { canPublishMenu } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { getVenue, venueHasTill } from '@/server/venues'
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
  // The same holds for the Settings sections (`?section=`, D97).
  const query = await searchParams
  const openTab = workspaceTabOf(query.tab)
  const composerOpen = openTab === 'composer'
  const settingsOpen = openTab === 'settings'
  const tablesOpen = openTab === 'tables'
  const designOpen = openTab === 'design'
  const [hasTill, guestPath] = await Promise.all([
    venueHasTill(organization.id, venue.id),
    guestPathOf(getPool(), organization.id, venue.slug),
  ])
  const openSection = settingsSectionOf(query.section, hasTill)
  const sectionOpen = (section: typeof openSection) => settingsOpen && openSection === section

  const tNav = await getTranslations('nav')

  // The name and the guest address `/m/<organisation>/<venue>` (D84) head every tab.
  const title = (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{venue.name}</h1>
      {guestPath === null ? null : (
        <code
          className="mt-2 inline-block max-w-full break-all rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground ring-1 ring-border"
          data-testid="venue-header-address"
        >
          {guestPath}
        </code>
      )}
    </>
  )

  return (
    <>
      <AdminHeader trail={[{ label: tNav('venues'), href: '/venues' }]} current={venue.name} />
      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* The Publish bar top right and the warnings under the header, on every tab (D96, D97). */}
        <VenueHeader
          tenantId={organization.id}
          venueId={venue.id}
          guestPath={guestPath}
          canPublish={canPublishMenu(organization.role)}
          title={title}
        />
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
            design: designOpen ? (
              <Suspense fallback={<DesignSkeleton />}>
                <DesignTab tenantId={organization.id} role={organization.role} venue={venue} />
              </Suspense>
            ) : (
              <DesignSkeleton />
            ),
            settings: (
              <SettingsSections
                hasTill={hasTill}
                contents={{
                  general: sectionOpen('general') ? (
                    <Suspense fallback={<SettingsSectionSkeleton />}>
                      <VenueSettingsGeneral
                        tenantId={organization.id}
                        role={organization.role}
                        venue={venue}
                        hasTill={hasTill}
                      />
                    </Suspense>
                  ) : (
                    <SettingsSectionSkeleton />
                  ),
                  ...(hasTill
                    ? {
                        publish: sectionOpen('publish') ? (
                          <Suspense fallback={<SettingsSectionSkeleton />}>
                            <PublishSettingsSection
                              tenantId={organization.id}
                              role={organization.role}
                              venue={venue}
                            />
                          </Suspense>
                        ) : (
                          <SettingsSectionSkeleton />
                        ),
                      }
                    : {}),
                  versioning: sectionOpen('versioning') ? (
                    <Suspense fallback={<SettingsSectionSkeleton />}>
                      <VersioningSection
                        tenantId={organization.id}
                        role={organization.role}
                        venue={venue}
                      />
                    </Suspense>
                  ) : (
                    <SettingsSectionSkeleton />
                  ),
                }}
              />
            ),
          }}
        />
      </div>
    </>
  )
}
