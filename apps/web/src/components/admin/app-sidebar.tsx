'use client'

// The admin's frame: icon-collapse sidebar with, on a venue's page, the venue switcher and the
// venue's own menu (D161), elsewhere the organisation's venues (D74); the organisation's Settings;
// the organisation and the user menu in the footer. A shared device has no sidebar at all (its
// layout leaves it out, D122 §7). Ported from the Platform's SidebarLayout.jsx
// (134-224 menu, 226-332 footer). The Platform left a "Lookup" collapsible hidden in the menu and
// logged to the console; neither is ported.
import { SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'

import { type OrganizationOption, OrganizationSwitcher } from './organization-switcher'
import { SETTINGS_PATH } from './settings-sections'
import { UserMenu } from './user-menu'
import { openVenueOf, VenueNav, type VenueOption, VenueSwitcher } from './venue-nav'

interface AppSidebarProps {
  venues: readonly VenueOption[]
  organizations: readonly OrganizationOption[]
  activeOrganizationId: string
  /** Owners and admins may add venues; the "New venue" item is only drawn for them. */
  canCreateVenue: boolean
  /** Not an owner or admin, and working at one venue (D141): no venues list to go back to (C4). */
  staffOnly: boolean
  user: { name: string; email: string }
}

export function AppSidebar({
  venues,
  organizations,
  activeOrganizationId,
  canCreateVenue,
  staffOnly,
  user,
}: AppSidebarProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const inSettings = pathname === SETTINGS_PATH || pathname.startsWith(`${SETTINGS_PATH}/`)
  const openVenue = openVenueOf(pathname, venues)
  // A tap that changes only the query (another screen of the same venue) closes the sheet too (C5).
  const closeSheet = () => setOpenMobile(false)

  // On a phone the sidebar is a sheet over the page: close it once a link has taken the person
  // elsewhere, however they got there (Back included).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is the trigger, not an input
  useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {openVenue !== null ? (
          <VenueSwitcher
            venues={venues}
            venue={openVenue}
            staffOnly={staffOnly}
            canCreateVenue={canCreateVenue}
            onNavigate={closeSheet}
          />
        ) : staffOnly ? (
          <RestroMark />
        ) : (
          <Link href="/venues" onClick={closeSheet}>
            <RestroMark />
          </Link>
        )}
        <SidebarSeparator />
      </SidebarHeader>
      {/* Many venues: the list scrolls, also when the sidebar is collapsed to icons (where a
          scroll bar would not fit beside the icons, so it is not drawn). */}
      <SidebarContent className="group-data-[collapsible=icon]:overflow-y-auto group-data-[collapsible=icon]:[scrollbar-width:none]">
        <VenueNav
          venues={venues}
          canCreateVenue={canCreateVenue}
          staffOnly={staffOnly}
          onNavigate={closeSheet}
        />
        <SidebarGroup>
          <SidebarGroupLabel>{t('organization')}</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={inSettings}
                tooltip={t('settingsOf.organization')}
              >
                <Link
                  href={SETTINGS_PATH}
                  aria-current={inSettings ? 'page' : undefined}
                  aria-label={t('settingsOf.organization')}
                  data-testid="nav-settings"
                  onClick={closeSheet}
                >
                  <SettingsIcon aria-hidden />
                  <span>{t('settings')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <OrganizationSwitcher
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
        />
        <SidebarSeparator />
        <UserMenu name={user.name} email={user.email} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** Restro's mark and name, where no venue is open. */
function RestroMark() {
  return (
    <span className="flex h-12 items-center gap-2 px-2 font-semibold tracking-tight">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm text-sidebar-primary-foreground">
        R
      </span>
      <span className="truncate group-data-[collapsible=icon]:hidden">Restro</span>
    </span>
  )
}
