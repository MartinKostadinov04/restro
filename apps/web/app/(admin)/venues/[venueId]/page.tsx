import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { AdminHeader } from '@/components/admin/admin-header'
import { VenueSettingsGeneral } from '@/components/admin/venue-settings-general'
import {
  NO_SETTINGS_RIGHTS,
  type SettingsRights,
  settingsSectionOf,
  sharedDeviceTabOf,
  workspaceTabOf,
} from '@/components/admin/workspace-tab-defs'
import { SettingsSections, WorkspaceTabs } from '@/components/admin/workspace-tabs'
import { ComposerSkeleton } from '@/composer/composer-skeleton'
import { ComposerTab } from '@/composer/composer-tab'
import {
  PublishSettingsSection,
  SettingsSectionSkeleton,
  VersioningSection,
} from '@/publish/settings-sections'
import { TonightPublish, VenueHeader } from '@/publish/venue-header'
import { getPool } from '@/server/db'
import { guestPathOf } from '@/server/publish/summary'
import { canPublishMenu } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { loadSettingsAccess } from '@/server/settings/access'
import { payingOffered } from '@/server/settings/paying-offer'
import { onSharedDevice as sessionIsSharedDevice } from '@/server/staff/shared-device'
import { getVenue, venueHasTill } from '@/server/venues'
import { AlertsSection } from '@/settings/alerts-section'
import { OrderingSection } from '@/settings/ordering-section'
import { PayingSection } from '@/settings/paying-section'
import { StaffSection } from '@/settings/staff-section'
import { TablesSkeleton } from '@/tables/tables-skeleton'
import { TablesTab } from '@/tables/tables-tab'
import { TonightSkeleton } from '@/tonight/tonight-skeleton'
import { TonightTab } from '@/tonight/tonight-tab'

export async function generateMetadata({ params }: PageProps<'/venues/[venueId]'>) {
  const { organization } = await requireTenant()
  const venue = await getVenue(organization.id, (await params).venueId)
  return { title: venue?.name ?? (await getTranslations('venues'))('title') }
}

export default async function VenueWorkspacePage({
  params,
  searchParams,
}: PageProps<'/venues/[venueId]'>) {
  const { organization, user, sessionId } = await requireTenant()
  // Another tenant's venue and a made-up id both come back as null: row-level security hides
  // the row, so the answer is the same 404 either way.
  const venue = await getVenue(organization.id, (await params).venueId)
  if (!venue) notFound()

  // The composer reads the whole menu: only read it while its tab is the open one (the tab bar
  // shows the skeleton at once when someone switches to it, and the page streams the rest in).
  // The same holds for the Settings sections (`?section=`, D97).
  const query = await searchParams
  // The Design tab is the composer's Design subtab now (D92): an old link lands there.
  if (query.tab === 'design') {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string' && key !== 'tab' && key !== 'sub') params.set(key, value)
    }
    params.set('tab', 'composer')
    params.set('sub', 'design')
    redirect(`/venues/${venue.id}?${params.toString()}`)
  }
  // A shared device works Tonight: no composer, no Tables & QR, no Settings and no Publish bar,
  // which need the person's own sign-in (D122 §7, RR-83, RR-84, RR-85). An old link lands on Tonight.
  const sharedDevice = await sessionIsSharedDevice({ tenantId: organization.id, sessionId })
  if (sharedDevice && sharedDeviceTabOf(query.tab) !== workspaceTabOf(query.tab)) {
    redirect(`/venues/${venue.id}?tab=tonight`)
  }
  const openTab = sharedDevice ? sharedDeviceTabOf(query.tab) : workspaceTabOf(query.tab)
  const composerOpen = openTab === 'composer'
  const settingsOpen = openTab === 'settings'
  const tablesOpen = openTab === 'tables'
  const tonightOpen = openTab === 'tonight'
  const [hasTill, guestPath] = await Promise.all([
    venueHasTill(organization.id, venue.id),
    guestPathOf(getPool(), organization.id, venue.slug),
  ])
  // What the person holds here decides which Settings sections they see (#87); every command
  // checks it again. Read only while Settings is open, which a shared device never does.
  const access = settingsOpen
    ? await loadSettingsAccess({
        tenantId: organization.id,
        venueId: venue.id,
        userId: user.id,
        sessionId,
      })
    : null
  const held = access?.held ?? []
  // Paying is listed only where a POS serving the venue can take card payments (D122 §3, #116).
  const paying =
    settingsOpen && access !== null && !access.sharedDevice
      ? await payingOffered(organization.id, venue.id)
      : false
  const rights: SettingsRights =
    access === null
      ? NO_SETTINGS_RIGHTS
      : { roles: held.includes('settings.roles'), alerts: held.includes('settings.alerts'), paying }
  const openSection = settingsSectionOf(query.section, hasTill, rights)
  const sectionOpen = (section: typeof openSection) => settingsOpen && openSection === section

  const tNav = await getTranslations('nav')

  // The name and the guest address `/m/<organisation>/<venue>` (D84) head every tab.
  const title = (
    <>
      <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
        {venue.name}
      </h1>
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
        {/* The Publish bar top right and the warnings under the header (D96, D97), but on Tonight,
            where the night's work comes first and they follow it, for who may publish (RR-80). */}
        <VenueHeader
          tenantId={organization.id}
          venueId={venue.id}
          guestPath={guestPath}
          canPublish={canPublishMenu(organization.role)}
          offerPublish={!sharedDevice && !tonightOpen}
          title={title}
        />
        <WorkspaceTabs
          sharedDevice={sharedDevice}
          contents={{
            composer: composerOpen ? (
              <Suspense fallback={<ComposerSkeleton />}>
                <ComposerTab
                  tenantId={organization.id}
                  role={organization.role}
                  venue={venue}
                  menu={query.menu}
                  sub={query.sub}
                />
              </Suspense>
            ) : (
              <ComposerSkeleton />
            ),
            tables: tablesOpen ? (
              <Suspense fallback={<TablesSkeleton />}>
                <TablesTab
                  tenantId={organization.id}
                  role={organization.role}
                  venue={venue}
                  userId={user.id}
                  sessionId={sessionId}
                  email={user.email}
                />
              </Suspense>
            ) : (
              <TablesSkeleton />
            ),
            tonight: tonightOpen ? (
              <Suspense fallback={<TonightSkeleton />}>
                <TonightTab
                  tenantId={organization.id}
                  venue={venue}
                  userId={user.id}
                  sessionId={sessionId}
                  view={typeof query.view === 'string' ? query.view : undefined}
                  day={typeof query.day === 'string' ? query.day : undefined}
                />
              </Suspense>
            ) : (
              <TonightSkeleton />
            ),
            settings: (
              <SettingsSections
                hasTill={hasTill}
                rights={rights}
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
                  hours: sectionOpen('hours') ? (
                    <Suspense fallback={<SettingsSectionSkeleton />}>
                      <OrderingSection
                        tenantId={organization.id}
                        venue={venue}
                        part="hours"
                        hasPos={hasTill}
                        canChange={held.includes('settings.guards')}
                        email={user.email}
                      />
                    </Suspense>
                  ) : (
                    <SettingsSectionSkeleton />
                  ),
                  ordering: sectionOpen('ordering') ? (
                    <Suspense fallback={<SettingsSectionSkeleton />}>
                      <OrderingSection
                        tenantId={organization.id}
                        venue={venue}
                        part="ordering"
                        hasPos={hasTill}
                        canChange={held.includes('settings.guards')}
                        email={user.email}
                      />
                    </Suspense>
                  ) : (
                    <SettingsSectionSkeleton />
                  ),
                  ...(paying
                    ? {
                        paying: sectionOpen('paying') ? (
                          <Suspense fallback={<SettingsSectionSkeleton />}>
                            <PayingSection
                              tenantId={organization.id}
                              venue={venue}
                              canConnect={held.includes('settings.connect_payments')}
                              email={user.email}
                              connection={
                                query.connection === 'return' || query.connection === 'refresh'
                                  ? query.connection
                                  : undefined
                              }
                            />
                          </Suspense>
                        ) : (
                          <SettingsSectionSkeleton />
                        ),
                      }
                    : {}),
                  ...(rights.alerts
                    ? {
                        alerts: sectionOpen('alerts') ? (
                          <Suspense fallback={<SettingsSectionSkeleton />}>
                            <AlertsSection
                              tenantId={organization.id}
                              venue={venue}
                              email={user.email}
                              canUnlinkPerson={rights.roles}
                            />
                          </Suspense>
                        ) : (
                          <SettingsSectionSkeleton />
                        ),
                      }
                    : {}),
                  ...(rights.roles
                    ? {
                        staff: sectionOpen('staff') ? (
                          <Suspense fallback={<SettingsSectionSkeleton />}>
                            <StaffSection
                              tenantId={organization.id}
                              venue={venue}
                              userId={user.id}
                              sessionId={sessionId}
                              email={user.email}
                              held={held}
                            />
                          </Suspense>
                        ) : (
                          <SettingsSectionSkeleton />
                        ),
                      }
                    : {}),
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
        {tonightOpen && !sharedDevice && canPublishMenu(organization.role) ? (
          <TonightPublish tenantId={organization.id} venueId={venue.id} guestPath={guestPath} />
        ) : null}
      </div>
    </>
  )
}
