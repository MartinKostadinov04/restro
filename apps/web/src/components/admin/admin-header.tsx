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
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

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

/**
 * The bar above every admin page: sidebar toggle and breadcrumbs. Ported from the Platform's
 * SidebarLayout.jsx (337-371); the trail is passed by each page as props, because a layout does
 * not re-render when you move between its pages. Not async, so a client component can draw it
 * too (the Settings layout works out its section from the URL, see settings-header.tsx).
 */
export function AdminHeader({ trail = [], current }: AdminHeaderProps) {
  const t = useTranslations('nav')
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb aria-label={t('breadcrumb')}>
        <BreadcrumbList>
          {trail.map((crumb) => (
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
    </header>
  )
}
