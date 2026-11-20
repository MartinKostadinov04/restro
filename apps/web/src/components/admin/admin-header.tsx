'use client'

import { MonitorSmartphoneIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Fragment } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

import { useAdminFrame } from './admin-frame'
import { UserMenuItems } from './user-menu'

export interface Crumb {
  label: string
  href?: string
}

interface AdminHeaderProps {
  /** The trail above the page, e.g. the venue list; links. */
  trail?: readonly Crumb[]
  /** The page itself, last and not a link. */
  current: string
}

/** The venues overview: a staff-only sign-in and a shared device have none to go back to (C4). */
const VENUES_PATH = '/venues'

/**
 * The bar above every admin page: sidebar toggle and breadcrumbs. Ported from the Platform's
 * SidebarLayout.jsx (337-371); the trail is passed by each page as props, because a layout does
 * not re-render when you move between its pages. A client component, so it reads the frame the
 * layout set (admin-frame.tsx): on a shared device there is no sidebar to toggle, and the device's
 * name on the right opens the language, theme and sign-out (D154).
 */
export function AdminHeader({ trail = [], current }: AdminHeaderProps) {
  const t = useTranslations('nav')
  const { device, staffOnly } = useAdminFrame()
  const shown =
    device !== null ? [] : staffOnly ? trail.filter((c) => c.href !== VENUES_PATH) : trail
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4">
      {device === null ? (
        <>
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
        </>
      ) : null}
      <Breadcrumb aria-label={t('breadcrumb')} className="min-w-0 flex-1">
        <BreadcrumbList>
          {shown.map((crumb) => (
            <Fragment key={`${crumb.label}-${crumb.href ?? ''}`}>
              <BreadcrumbItem>
                {crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  crumb.label
                )}
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </Fragment>
          ))}
          <BreadcrumbItem>
            <BreadcrumbPage>{current}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {device === null ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="max-w-[50%] shrink-0" data-testid="device-menu">
              <MonitorSmartphoneIcon aria-hidden />
              <span className="truncate">{device.name}</span>
              {/* The name read out is the visible one, then what it opens (WCAG 2.5.3). */}
              <span className="sr-only">{`, ${t('deviceMenu')}`}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56 rounded-lg" align="end" sideOffset={4}>
            <UserMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  )
}
