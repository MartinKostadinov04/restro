'use client'

// The admin's frame: icon-collapse sidebar with navigation, the venue switcher and the user menu
// in the footer. Ported from the Platform's SidebarLayout.jsx (134-224 menu, 226-332 footer).
// The Platform left a "Lookup" collapsible hidden in the menu and logged to the console; neither
// is ported.
import { Building2Icon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Suspense } from 'react'

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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'

import { UserMenu } from './user-menu'
import { type OrganizationOption, type VenueOption, VenueSwitcher } from './venue-switcher'
import { DEFAULT_WORKSPACE_TAB, isWorkspaceTab, WORKSPACE_TAB_DEFS } from './workspace-tab-defs'

interface AppSidebarProps {
  venues: readonly VenueOption[]
  organizations: readonly OrganizationOption[]
  activeOrganizationId: string
  user: { name: string; email: string }
}

const VENUE_PATH = /^\/venues\/([^/]+)/

/** The tabs of the open venue, under its entry in the menu; highlights the current one. */
function VenueSubmenu({ venueId }: { venueId: string }) {
  const t = useTranslations()
  const requested = useSearchParams().get('tab')
  const current = isWorkspaceTab(requested) ? requested : DEFAULT_WORKSPACE_TAB
  return (
    <SidebarMenuSub>
      {WORKSPACE_TAB_DEFS.map(({ value, labelKey, icon: Icon }) => (
        <SidebarMenuSubItem key={value}>
          <SidebarMenuSubButton asChild isActive={value === current}>
            <Link href={`/venues/${venueId}?tab=${value}`}>
              <Icon aria-hidden />
              <span>{t(labelKey)}</span>
            </Link>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  )
}

export function AppSidebar({ venues, organizations, activeOrganizationId, user }: AppSidebarProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const currentVenueId = VENUE_PATH.exec(pathname)?.[1] ?? null

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
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('manage')}</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/venues')}
                tooltip={t('venues')}
              >
                <Link href="/venues">
                  <Building2Icon aria-hidden />
                  <span>{t('venues')}</span>
                </Link>
              </SidebarMenuButton>
              {currentVenueId ? (
                <Suspense fallback={null}>
                  <VenueSubmenu venueId={currentVenueId} />
                </Suspense>
              ) : null}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <VenueSwitcher
          venues={venues}
          currentVenueId={currentVenueId}
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
