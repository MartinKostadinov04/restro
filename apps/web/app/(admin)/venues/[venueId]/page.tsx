import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { type ReactNode, Suspense } from 'react'
import { AdminHeader } from '@/components/admin/admin-header'
import { VenueSettingsGeneral } from '@/components/admin/venue-settings-general'
import {
  NO_SETTINGS_RIGHTS,
  SETTINGS_MODULE_OF,
  type SettingsRights,
  type SettingsSectionValue,
  settingsSectionOf,
  sharedDeviceTabOf,
  venueQueryRedirect,
  type WorkspaceRights,
  type WorkspaceTabValue,
  workspaceTabOf,
} from '@/components/admin/workspace-tab-defs'
import { SettingsSections, WorkspaceTabs } from '@/components/admin/workspace-tabs'
import { ComposerSkeleton } from '@/composer/composer-skeleton'
import { ComposerTab } from '@/composer/composer-tab'
import { designPagePath } from '@/composer/design-path'
import {
  PublishSettingsSection,
  SettingsSectionSkeleton,
  VersioningSection,
} from '@/publish/settings-sections'
import { TonightPublish, VenueHeader } from '@/publish/venue-header'
import { ReservationsSkeleton } from '@/reservations/reservations-skeleton'
import { ReservationsTab } from '@/reservations/reservations-tab'
import { getPool } from '@/server/db'
import { guestPathOf } from '@/server/publish/summary'
import { reservationsOffered } from '@/server/reservations/load'
import { canPublishMenu } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { loadSettingsAccess } from '@/server/settings/access'
import { payingOffered } from '@/server/settings/paying-offer'
import { sharedDeviceOf } from '@/server/staff/shared-device'
import { getVenue, venueHasTill } from '@/server/venues'
import { AlertsSection } from '@/settings/alerts-section'
import { OrderingSection } from '@/settings/ordering-section'
import { PayingSection } from '@/settings/paying-section'
import { ReservationsSection } from '@/settings/reservations-section'
import { StaffSection } from '@/settings/staff-section'
import { TablesSkeleton } from '@/tables/tables-skeleton'
import { TablesTab } from '@/tables/tables-tab'
import { TonightSkeleton } from '@/tonight/tonight-skeleton'
import { TonightTab } from '@/tonight/tonight-tab'

/** The open screen's name: the page's title and the browser tab's (D154, WCAG 2.4.2). */
async function screenNameOf(tab: WorkspaceTabValue, section: SettingsSectionValue) {
  const t = await getTranslations()
  return tab === 'settings'
    ? t(`nav.settingsOf.${SETTINGS_MODULE_OF[section]}`)
    : t(`workspace.tabs.${tab}`)
}

export async function generateMetadata({ params, searchParams }: PageProps<'/venues/[venueId]'>) {
  const { organization } = await requireTenant()
  const venue = await getVenue(organization.id, (await params).venueId)
  if (!venue) return { title: (await getTranslations('venues'))('title') }
  // Named from the address alone: a screen the person may not open is sent elsewhere by the page.
  const query = await searchParams
  const tab = workspaceTabOf(query.tab, { reservations: true })
  const section = settingsSectionOf(query.section, true, {
    roles: true,
    alerts: true,
    paying: true,
  })
  return { title: `${await screenNameOf(tab, section)} · ${venue.name}` }
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

  // The Studio reads the whole menu: read it only while it is the open screen (its Suspense
  // fallback shows the skeleton while the page streams in). The same holds for the Settings
  // sections (`?section=`, D97).
  const query = await searchParams
  // Old links: the Design tab and subtab are the Design page now, and the composer is the Studio (D129).
  const menu = typeof query.menu === 'string' ? query.menu : null
  if (query.tab === 'design' || (query.tab === 'composer' && query.sub === 'design')) {
    redirect(designPagePath(venue.id, menu))
  }
  if (query.tab === 'studio' && query.sub === 'design') redirect(designPagePath(venue.id, menu))
  // A shared device works Tonight: no Studio, no Tables & QR, no Settings and no Publish bar,
  // which need the person's own sign-in (D122 §7, RR-83, RR-84, RR-85). An old link lands on Tonight.
  const sharedDevice = (await sharedDeviceOf(organization.id, sessionId)) !== null
  // Reservations is a tab of its own after Tonight (#326), for whoever works tonight's
  // reservations (D141). Without the key there is no tab and no link to it.
  const tabRights: WorkspaceRights = {
    reservations: await reservationsOffered({
      tenantId: organization.id,
      venueId: venue.id,
      userId: user.id,
      sessionId,
    }),
  }
  if (
    sharedDevice &&
    sharedDeviceTabOf(query.tab, tabRights) !== workspaceTabOf(query.tab, tabRights)
  ) {
    redirect(`/venues/${venue.id}?tab=tonight`)
  }
  const openTab = sharedDevice
    ? sharedDeviceTabOf(query.tab, tabRights)
    : workspaceTabOf(query.tab, tabRights)
  const studioOpen = openTab === 'studio'
  const settingsOpen = openTab === 'settings'
  const tablesOpen = openTab === 'tables'
  const tonightOpen = openTab === 'tonight'
  const reservationsOpen = openTab === 'reservations'
  // What the person holds here decides which Settings sections they see (#87); every command
  // checks it again. Read on every tab but a shared device's (which never opens Settings), so the
  // section row is drawn whole before Settings opens and does not grow from 6 to 9 (R6). All four
  // reads go out together.
  const [hasTill, guestPath, access, payingHere] = await Promise.all([
    venueHasTill(organization.id, venue.id),
    guestPathOf(getPool(), organization.id, venue.slug),
    sharedDevice
      ? null
      : loadSettingsAccess({
          tenantId: organization.id,
          venueId: venue.id,
          userId: user.id,
          sessionId,
        }),
    // Paying is listed only where a POS serving the venue can take card payments (D122 §3, #116).
    sharedDevice ? false : payingOffered(organization.id, venue.id),
  ])
  const held = access?.held ?? []
  const paying = access !== null && !access.sharedDevice && payingHere
  const rights: SettingsRights =
    access === null
      ? NO_SETTINGS_RIGHTS
      : { roles: held.includes('settings.roles'), alerts: held.includes('settings.alerts'), paying }
  // One address per screen (C9): an old tab (the composer, Integration, Publishing), a section the
  // person is not offered, or another screen's parameters (C1) are sent to the address the
  // sidebar marks: an unoffered section lands on its module's first, an unknown one on General,
  // with the address saying so (lane 5 S26). The composer's old links were redirected here before (D129).
  if (!sharedDevice) {
    const target = venueQueryRedirect(query, tabRights, { hasTill, rights })
    if (target !== null) redirect(`/venues/${venue.id}?${target}`)
  }
  const openSection = settingsSectionOf(query.section, hasTill, rights)
  const sectionOpen = (section: typeof openSection) => settingsOpen && openSection === section

  const tNav = await getTranslations('nav')

  // The open screen's name (the venue is in the breadcrumb and the sidebar's switcher, D154) and
  // the guest address `/m/<organisation>/<venue>` (D84). A shared device has no sidebar (Tonight,
  // and Reservations where it may): its title stays the venue's name.
  const title = (
    <>
      <h1
        className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]"
        data-testid="venue-screen-title"
      >
        {sharedDevice ? venue.name : await screenNameOf(openTab, openSection)}
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

  const screens: Partial<Record<WorkspaceTabValue, ReactNode>> = {
    studio: studioOpen ? (
      <Suspense fallback={<ComposerSkeleton />}>
        <ComposerTab
          tenantId={organization.id}
          role={organization.role}
          venue={venue}
          menu={query.menu}
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
          email={user.email}
          sessionId={sessionId}
          view={typeof query.view === 'string' ? query.view : undefined}
          day={typeof query.day === 'string' ? query.day : undefined}
        />
      </Suspense>
    ) : (
      <TonightSkeleton />
    ),
    ...(tabRights.reservations
      ? {
          reservations: reservationsOpen ? (
            <Suspense fallback={<ReservationsSkeleton />}>
              <ReservationsTab
                tenantId={organization.id}
                venue={venue}
                userId={user.id}
                email={user.email}
                sessionId={sessionId}
                view={typeof query.view === 'string' ? query.view : undefined}
                day={typeof query.day === 'string' ? query.day : undefined}
                guest={typeof query.guest === 'string' ? query.guest : undefined}
              />
            </Suspense>
          ) : (
            <ReservationsSkeleton />
          ),
        }
      : {}),
    settings: (
      <SettingsSections
        hasTill={hasTill}
        rights={rights}
        module={SETTINGS_MODULE_OF[openSection]}
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
                canEditLegal={held.includes('settings.connect_payments')}
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
                canEditLegal={held.includes('settings.connect_payments')}
                email={user.email}
              />
            </Suspense>
          ) : (
            <SettingsSectionSkeleton />
          ),
          reservations: sectionOpen('reservations') ? (
            <Suspense fallback={<SettingsSectionSkeleton />}>
              <ReservationsSection
                tenantId={organization.id}
                venue={venue}
                canChange={held.includes('settings.reservations')}
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
  }

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
        {sharedDevice ? (
          <WorkspaceTabs
            sharedDevice
            rights={tabRights}
            contents={{ tonight: screens.tonight, reservations: screens.reservations }}
          />
        ) : (
          // On a person's own sign-in the sidebar opens the screens (D154): only the open one is
          // drawn, its skeleton shown while it streams in. No `loading.tsx` above it: that answers
          // a deleted venue with 200, not 404, and leaves a hidden copy of the screen (CI, 11-19).
          <div key={openTab}>{screens[openTab]}</div>
        )}
        {tonightOpen && !sharedDevice && canPublishMenu(organization.role) ? (
          <TonightPublish tenantId={organization.id} venueId={venue.id} guestPath={guestPath} />
        ) : null}
      </div>
    </>
  )
}
