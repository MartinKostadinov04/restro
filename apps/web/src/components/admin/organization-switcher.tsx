'use client'

// The organisation in the sidebar footer (D74). The venues are listed in the sidebar itself now, so
// the footer only says which organisation the person works in: its name when they belong to one,
// and a switcher when they belong to several. Ported from the Platform's team switcher
// (SidebarLayout.jsx 226-277): it switched teams, this switches organisations, and shows nothing
// to switch for a person who belongs to one.
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useTransition } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { switchOrganization } from '@/server/actions'

export interface OrganizationOption {
  id: string
  name: string
}

interface OrganizationSwitcherProps {
  organizations: readonly OrganizationOption[]
  activeOrganizationId: string
}

function initialOf(name: string): string {
  return ([...name.trim()][0] ?? '?').toUpperCase()
}

const MARK_CLASS =
  'flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'

export function OrganizationSwitcher({
  organizations,
  activeOrganizationId,
}: OrganizationSwitcherProps) {
  const t = useTranslations('organizationSwitcher')
  const { isMobile } = useSidebar()
  const [, startTransition] = useTransition()
  const active = organizations.find((organization) => organization.id === activeOrganizationId)
  const name = active?.name ?? ''

  // One organisation: its name, nothing to switch.
  if (organizations.length <= 1) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div
            className="flex h-12 items-center gap-2 overflow-hidden rounded-md p-2 text-sm group-data-[collapsible=icon]:p-0"
            data-testid="organization-name"
            title={name}
          >
            <div className={MARK_CLASS}>{initialOf(name)}</div>
            <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-semibold">{name}</span>
              <span className="truncate text-xs text-muted-foreground">{t('label')}</span>
            </div>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={name}
              data-testid="organization-switcher"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className={MARK_CLASS}>{initialOf(name)}</div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{name}</span>
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
              {t('switchTo')}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  onSelect={() => startTransition(() => switchOrganization(organization.id))}
                >
                  <span className="flex size-6 items-center justify-center rounded-sm border text-xs">
                    {initialOf(organization.name)}
                  </span>
                  <span className="flex-1 truncate">{organization.name}</span>
                  {organization.id === activeOrganizationId ? <CheckIcon aria-hidden /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
