'use client'

// The admin's frame: icon-collapse sidebar with the organisation's venues and its Settings, the
// organisation and the user menu in the footer (D74). Ported from the Platform's SidebarLayout.jsx
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
import { VenueNav, type VenueOption } from './venue-nav'

interface AppSidebarProps {
  venues: readonly VenueOption[]
  organizations: readonly OrganizationOption[]
  activeOrganizationId: string
  /** Owners and admins may add venues; the "New venue" item is only drawn for them. */
  canCreateVenue: boolean
  /** False on a shared device (RR-85): the organisation's Settings need the person's own sign-in. */
  offerSettings: boolean
  user: { name: string; email: string }
}

export function AppSidebar({
  venues,
  organizations,
  activeOrganizationId,
  canCreateVenue,
  offerSettings,
  user,
}: AppSidebarProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const inSettings = pathname === SETTINGS_PATH || pathname.startsWith(`${SETTINGS_PATH}/`)

  // On a phone the sidebar is a sheet over the page: close it once a link has taken the person
  // elsewhere (it stays open when only the tab changes, which does not move the path).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is the trigger, not an input
  useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/venues"
          className="flex h-12 items-center gap-2 px-2 font-semibold tracking-tight"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm text-sidebar-primary-foreground">
            R
          </span>
          <span className="truncate group-data-[collapsible=icon]:hidden">Restro</span>
        </Link>
        <SidebarSeparator />
      </SidebarHeader>
      {/* Many venues: the list scrolls, also when the sidebar is collapsed to icons (where a
          scroll bar would not fit beside the icons, so it is not drawn). */}
      <SidebarContent className="group-data-[collapsible=icon]:overflow-y-auto group-data-[collapsible=icon]:[scrollbar-width:none]">
        <VenueNav venues={venues} canCreateVenue={canCreateVenue} />
        {offerSettings ? (
          <SidebarGroup>
            <SidebarGroupLabel>{t('organization')}</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={inSettings} tooltip={t('settings')}>
                  <Link
                    href={SETTINGS_PATH}
                    aria-current={inSettings ? 'page' : undefined}
                    data-testid="nav-settings"
                  >
                    <SettingsIcon aria-hidden />
                    <span>{t('settings')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
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
