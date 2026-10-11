'use client'

// The "Venues" group of the sidebar (D74): one item per venue of the organisation, an item for the
// overview, and "New venue" for owners and admins. A venue's sections are not listed here; they
// are the tabs at the top of the venue's page, so nothing is shown twice. Ported from the item
// list of the Platform's SidebarLayout.jsx (134-224); the Platform's list was fixed, this one is
// drawn from the organisation's venues.
import { LayoutGridIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Suspense, useMemo, useState } from 'react'

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

import { NewVenueDialog } from './new-venue-dialog'
import { isWorkspaceTab } from './workspace-tab-defs'

export interface VenueOption {
  id: string
  name: string
}

interface VenueNavProps {
  venues: readonly VenueOption[]
  /** Owners and admins add venues; members do not see the item (the action checks again). */
  canCreateVenue: boolean
}

const VENUE_PATH = /^\/venues\/([^/]+)/
const VENUES_PATH = '/venues'

// Names in the order a person reads them: case and accents ignored, "Club 2" before "Club 10".
const NAME_ORDER = new Intl.Collator(['bg', 'en'], { sensitivity: 'base', numeric: true })

/** The venues by name; the id breaks a tie so the order never depends on how they arrived. */
export function sortVenuesByName(venues: readonly VenueOption[]): VenueOption[] {
  return [...venues].sort(
    (a, b) => NAME_ORDER.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

function initialOf(name: string): string {
  return ([...name.trim()][0] ?? '?').toUpperCase()
}

/** The id of the venue whose page is open (`/venues/<id>…`), or null. */
export function openVenueId(pathname: string): string | null {
  return VENUE_PATH.exec(pathname)?.[1] ?? null
}

interface VenueItemsProps {
  venues: readonly VenueOption[]
  openId: string | null
  /** The `?tab=` of the open venue page, carried over when another venue is opened. */
  tab: string | null
}

function VenueItems({ venues, openId, tab }: VenueItemsProps) {
  return venues.map((venue) => {
    const open = venue.id === openId
    return (
      <SidebarMenuItem key={venue.id}>
        <SidebarMenuButton asChild isActive={open} tooltip={venue.name}>
          <Link
            href={tab ? `${VENUES_PATH}/${venue.id}?tab=${tab}` : `${VENUES_PATH}/${venue.id}`}
            aria-current={open ? 'page' : undefined}
            data-testid="venue-nav-item"
            data-venue-id={venue.id}
          >
            <span
              aria-hidden
              className="flex size-4 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none font-semibold"
            >
              {initialOf(venue.name)}
            </span>
            <span>{venue.name}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  })
}

/** Reads `?tab=`, which needs a Suspense boundary; the items below it do not. */
function VenueItemsWithTab({ venues, openId }: Omit<VenueItemsProps, 'tab'>) {
  const requested = useSearchParams().get('tab')
  // Only on a venue page: from the overview or the Settings there is no tab to keep.
  const tab = openId !== null && isWorkspaceTab(requested) ? requested : null
  return <VenueItems venues={venues} openId={openId} tab={tab} />
}

/** "New venue": opens the dialog of CF-01, then the new venue, and refreshes this list. */
function NewVenueItem() {
  const t = useTranslations('nav')
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        tooltip={t('newVenue')}
        onClick={() => setOpen(true)}
        data-testid="venue-nav-new"
      >
        <PlusIcon aria-hidden />
        <span>{t('newVenue')}</span>
      </SidebarMenuButton>
      <NewVenueDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(venueId) => {
          router.push(`${VENUES_PATH}/${venueId}`)
          // The sidebar belongs to the layout, which a move between pages does not re-render:
          // ask for it again so the new venue is in the list.
          router.refresh()
        }}
      />
    </SidebarMenuItem>
  )
}

export function VenueNav({ venues, canCreateVenue }: VenueNavProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const openId = openVenueId(pathname)
  const sorted = useMemo(() => sortVenuesByName(venues), [venues])

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t('venues')}</SidebarGroupLabel>
      <SidebarMenu data-testid="venue-nav">
        <Suspense fallback={<VenueItems venues={sorted} openId={openId} tab={null} />}>
          <VenueItemsWithTab venues={sorted} openId={openId} />
        </Suspense>
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={pathname === VENUES_PATH} tooltip={t('allVenues')}>
            <Link
              href={VENUES_PATH}
              aria-current={pathname === VENUES_PATH ? 'page' : undefined}
              data-testid="venue-nav-all"
            >
              <LayoutGridIcon aria-hidden />
              <span>{t('allVenues')}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {canCreateVenue ? <NewVenueItem /> : null}
      </SidebarMenu>
    </SidebarGroup>
  )
}
