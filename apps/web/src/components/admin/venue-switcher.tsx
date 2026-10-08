'use client'

// Switches between the venues of the organisation, in the sidebar footer. Ported from the
// Platform's team switcher (SidebarLayout.jsx 226-277), which switched *teams*; Restro's switches
// venues, and shows an organisation switcher only to a person who belongs to several.
import { Building2Icon, CheckIcon, ChevronsUpDownIcon, LayoutGridIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useTransition } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { switchOrganization } from '@/server/actions'

export interface VenueOption {
  id: string
  name: string
}

export interface OrganizationOption {
  id: string
  name: string
}

interface VenueSwitcherProps {
  venues: readonly VenueOption[]
  /** The venue whose workspace is open, if any. */
  currentVenueId: string | null
  organizations: readonly OrganizationOption[]
  activeOrganizationId: string
}

function initialOf(name: string): string {
  return ([...name.trim()][0] ?? '?').toUpperCase()
}

export function VenueSwitcher({
  venues,
  currentVenueId,
  organizations,
  activeOrganizationId,
}: VenueSwitcherProps) {
  const t = useTranslations('venueSwitcher')
  const { isMobile } = useSidebar()
  const [, startTransition] = useTransition()
  const current = venues.find((venue) => venue.id === currentVenueId)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="venue-switcher"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                {current ? (
                  initialOf(current.name)
                ) : (
                  <Building2Icon className="size-4" aria-hidden />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{current?.name ?? t('choose')}</span>
                <span className="truncate text-xs text-muted-foreground">{t('label')}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('venues')}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {venues.map((venue) => (
                <DropdownMenuItem key={venue.id} asChild>
                  <Link href={`/venues/${venue.id}`}>
                    <span className="flex size-6 items-center justify-center rounded-sm border text-xs">
                      {initialOf(venue.name)}
                    </span>
                    <span className="flex-1 truncate">{venue.name}</span>
                    {venue.id === currentVenueId ? <CheckIcon aria-hidden /> : null}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/venues">
                <LayoutGridIcon aria-hidden />
                {t('allVenues')}
              </Link>
            </DropdownMenuItem>
            {organizations.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t('organization')}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {organizations.map((organization) => (
                    <DropdownMenuItem
                      key={organization.id}
                      onSelect={() => startTransition(() => switchOrganization(organization.id))}
                    >
                      <span className="flex-1 truncate">{organization.name}</span>
                      {organization.id === activeOrganizationId ? <CheckIcon aria-hidden /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
