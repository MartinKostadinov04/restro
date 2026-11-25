'use client'

// The sidebar's venue part (D161). On a venue's page: the venue switcher in the sidebar's header
// and the venue's own menu, grouped by what the venue does (venue-nav-defs.ts). Elsewhere (the
// venues overview, the organisation's Settings): one item per venue, the overview and "New venue"
// for owners and admins, as before (D74). Ported from the item list of the Platform's
// SidebarLayout.jsx (134-224); the Platform's list was fixed, this one is drawn from the
// organisation's venues.
import { CheckIcon, ChevronsUpDownIcon, LayoutGridIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Suspense, useMemo, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'

import { NewVenueDialog } from './new-venue-dialog'
import {
  isVenueEntryOpen,
  type VenueNavEntry,
  venueEntryHref,
  venueNavGroupsOf,
} from './venue-nav-defs'
import { isWorkspaceTab } from './workspace-tab-defs'

export interface VenueOption {
  id: string
  name: string
  /**
   * The signed-in person works this venue's reservations (`reservations.tonight`, D141): its
   * sidebar lists the night's list. The page checks again.
   */
  reservations?: boolean
}

const VENUE_PATH = /^\/venues\/([^/]+)/
const VENUES_PATH = '/venues'

// Names in the order a person reads them: case and accents ignored, "Club 2" before "Club 10".
const NAME_ORDER = new Intl.Collator(['bg', 'en'], { sensitivity: 'base', numeric: true })

/** The venues by name; the id breaks a tie so the order never depends on how they arrived. */
export function sortVenuesByName<V extends VenueOption>(venues: readonly V[]): V[] {
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

/** The open venue, when the path is a venue's page and the venue is one of the organisation's. */
export function openVenueOf<V extends VenueOption>(
  pathname: string,
  venues: readonly V[],
): V | null {
  const id = openVenueId(pathname)
  return id === null ? null : (venues.find((venue) => venue.id === id) ?? null)
}

/** A venue's initial in a small square: all there is of the venue when collapsed to icons. */
function VenueMark({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={
        large
          ? 'flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground'
          : 'flex size-4 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none font-semibold group-data-[collapsible=icon]:-m-1 group-data-[collapsible=icon]:size-6 group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:text-xs'
      }
    >
      {initialOf(name)}
    </span>
  )
}

/**
 * Another venue's address from this one: the same screen (`tab`, and Settings' `section`), nothing
 * of this venue's own state (its open menu, item, view or day; C1). The page sends a screen that
 * venue does not offer to the Studio, and a section to its module's first.
 */
function sameScreenAt(venueId: string, search: URLSearchParams | null): string {
  const tab = search?.get('tab') ?? null
  if (!isWorkspaceTab(tab)) return `${VENUES_PATH}/${venueId}`
  const section = search?.get('section') ?? null
  return tab === 'settings' && section !== null
    ? `${VENUES_PATH}/${venueId}?tab=settings&section=${encodeURIComponent(section)}`
    : `${VENUES_PATH}/${venueId}?tab=${tab}`
}

interface SwitcherItemsProps {
  venues: readonly VenueOption[]
  openId: string
  search: URLSearchParams | null
  onNavigate: () => void
}

function SwitcherVenueItems({ venues, openId, search, onNavigate }: SwitcherItemsProps) {
  return venues.map((venue) => {
    const open = venue.id === openId
    return (
      <DropdownMenuItem key={venue.id} asChild>
        <Link
          href={sameScreenAt(venue.id, search)}
          aria-current={open ? 'page' : undefined}
          data-testid="venue-nav-item"
          data-venue-id={venue.id}
          onClick={onNavigate}
        >
          <VenueMark name={venue.name} />
          <span className="[overflow-wrap:anywhere]">{venue.name}</span>
          {open ? <CheckIcon aria-hidden className="ml-auto" /> : null}
        </Link>
      </DropdownMenuItem>
    )
  })
}

function SwitcherVenueItemsWithSearch(props: Omit<SwitcherItemsProps, 'search'>) {
  return <SwitcherVenueItems {...props} search={useSearchParams()} />
}

interface VenueSwitcherProps {
  venues: readonly VenueOption[]
  venue: VenueOption
  /** A staff-only sign-in works this venue alone: its name, and nothing to switch to (C4). */
  staffOnly: boolean
  canCreateVenue: boolean
  onNavigate: () => void
}

/**
 * The open venue's name at the top of the sidebar, which switches venue (D161): the other venues
 * on the same screen, all venues, and a new venue for owners and admins.
 */
export function VenueSwitcher({
  venues,
  venue,
  staffOnly,
  canCreateVenue,
  onNavigate,
}: VenueSwitcherProps) {
  const t = useTranslations('nav')
  const router = useRouter()
  const { isMobile } = useSidebar()
  const [creating, setCreating] = useState(false)
  const sorted = useMemo(() => sortVenuesByName(venues), [venues])

  const name = (
    <>
      <VenueMark name={venue.name} large />
      <span className="grid flex-1 text-left leading-tight whitespace-normal!">
        <span className="font-semibold [overflow-wrap:anywhere]" data-testid="venue-switcher-name">
          {venue.name}
        </span>
      </span>
    </>
  )

  if (staffOnly) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div
            className="flex min-h-12 items-center gap-2 px-2 py-2 text-sm group-data-[collapsible=icon]:px-0"
            data-testid="venue-switcher"
          >
            {name}
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
              tooltip={venue.name}
              data-testid="venue-switcher"
              // A long name wraps instead of being cut (lane 5 S19); folded to icons it stays the square.
              className="h-auto min-h-12 group-data-[collapsible=icon]:min-h-0! data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {name}
              {/* The name read out is the visible one, then what the button does (WCAG 2.5.3). */}
              <span className="sr-only">{`, ${t('switchVenue')}`}</span>
              <ChevronsUpDownIcon aria-hidden className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('venues')}
            </DropdownMenuLabel>
            <Suspense
              fallback={
                <SwitcherVenueItems
                  venues={sorted}
                  openId={venue.id}
                  search={null}
                  onNavigate={onNavigate}
                />
              }
            >
              <SwitcherVenueItemsWithSearch
                venues={sorted}
                openId={venue.id}
                onNavigate={onNavigate}
              />
            </Suspense>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={VENUES_PATH} data-testid="venue-nav-all" onClick={onNavigate}>
                <LayoutGridIcon aria-hidden />
                {t('allVenues')}
              </Link>
            </DropdownMenuItem>
            {canCreateVenue ? (
              <DropdownMenuItem onSelect={() => setCreating(true)} data-testid="venue-nav-new">
                <PlusIcon aria-hidden />
                {t('newVenue')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {canCreateVenue ? (
          <NewVenueDialog
            open={creating}
            onOpenChange={setCreating}
            onCreated={(venueId) => {
              onNavigate()
              router.push(`${VENUES_PATH}/${venueId}`)
            }}
          />
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

interface VenueGroupsProps {
  venue: VenueOption
  tab: string | null
  section: string | null
  onNavigate: () => void
}

/** The venue's own menu: one group per part of the venue, the open screen marked. */
function VenueGroups({ venue, tab, section, onNavigate }: VenueGroupsProps) {
  const t = useTranslations()
  // The entry tapped shows as open at once, while the page is on its way (the URL catches up).
  const urlKey = `${tab ?? ''}|${section ?? ''}`
  const [tapped, setTapped] = useState<{ key: string; from: string } | null>(null)
  const pending = tapped !== null && tapped.from === urlKey ? tapped.key : null
  const isOpen = (entry: VenueNavEntry) =>
    pending === null ? isVenueEntryOpen(entry, tab, section) : pending === entry.key

  return venueNavGroupsOf({ reservations: venue.reservations === true }).map((group, index) => (
    <SidebarGroup key={group.key} data-testid={`venue-nav-group-${group.key}`}>
      {/* Collapsed to icons the labels go: a rule keeps the groups, and their Settings, apart. */}
      {index > 0 ? (
        <SidebarSeparator className="mb-2 hidden group-data-[collapsible=icon]:block" />
      ) : null}
      <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
      <SidebarMenu>
        {group.entries.map((entry) => {
          const open = isOpen(entry)
          const Icon = entry.icon
          // "Settings" says whose in its tooltip and its accessible name, which still begins with
          // or holds the visible word (WCAG 2.5.3): never a bare "Settings" to a screen reader.
          const fullName = entry.tooltipKey === undefined ? undefined : t(entry.tooltipKey)
          return (
            <SidebarMenuItem key={entry.key}>
              <SidebarMenuButton asChild isActive={open} tooltip={fullName ?? t(entry.labelKey)}>
                <Link
                  href={venueEntryHref(venue.id, entry)}
                  aria-current={open ? 'page' : undefined}
                  aria-label={fullName}
                  data-nav={entry.key}
                  onClick={(event) => {
                    // A modified or middle click opens another browser tab: this one stays put.
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return
                    }
                    setTapped({ key: entry.key, from: urlKey })
                    onNavigate()
                  }}
                >
                  <Icon aria-hidden />
                  <span>{t(entry.labelKey)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  ))
}

/** Reads `?tab=` and `?section=`, which needs a Suspense boundary; the groups below it do not. */
function VenueGroupsWithSearch(props: Omit<VenueGroupsProps, 'tab' | 'section'>) {
  const search = useSearchParams()
  return <VenueGroups {...props} tab={search.get('tab')} section={search.get('section')} />
}

/**
 * "New venue": opens the dialog of CF-01, then the new venue. The list is up to date by then,
 * because the server action revalidates the admin pages (the e2e test checks it).
 */
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
        }}
      />
    </SidebarMenuItem>
  )
}

interface VenueNavProps {
  venues: readonly VenueOption[]
  /** Owners and admins add venues; members do not see the item (the action checks again). */
  canCreateVenue: boolean
  /**
   * A staff-only sign-in (D141) works one venue: off its page the list shows that venue alone,
   * with no All venues entry (plan C4).
   */
  staffOnly?: boolean
  /** Closes the phone's sheet: a tap that only changes the query does not move the path (C5). */
  onNavigate?: () => void
}

/** The venue's menu on its page; the list of venues anywhere else. */
export function VenueNav({
  venues,
  canCreateVenue,
  staffOnly = false,
  onNavigate = () => {},
}: VenueNavProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const sorted = useMemo(() => sortVenuesByName(venues), [venues])
  const open = openVenueOf(pathname, venues)

  if (open !== null) {
    return (
      <nav aria-label={t('venueNav')} data-testid="venue-nav" className="contents">
        <Suspense
          fallback={<VenueGroups venue={open} tab={null} section={null} onNavigate={onNavigate} />}
        >
          <VenueGroupsWithSearch venue={open} onNavigate={onNavigate} />
        </Suspense>
      </nav>
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t('venues')}</SidebarGroupLabel>
      <SidebarMenu data-testid="venue-nav">
        {sorted.map((venue) => (
          <SidebarMenuItem key={venue.id}>
            <SidebarMenuButton
              asChild
              tooltip={venue.name}
              // A long name wraps instead of being cut (lane 5 S19): the row grows from its usual
              // height. Folded to icons, the button stays the sidebar's square, a touch screen's too
              // (`!`: the `phone` floor would otherwise win).
              className="h-auto min-h-8 phone:h-auto phone:min-h-11 group-data-[collapsible=icon]:min-h-8!"
            >
              <Link
                href={`${VENUES_PATH}/${venue.id}`}
                data-testid="venue-nav-item"
                data-venue-id={venue.id}
                onClick={onNavigate}
              >
                <VenueMark name={venue.name} />
                {/* `!`: the button's own rule cuts its last span to one line. */}
                <span className="whitespace-normal! [overflow-wrap:anywhere]">{venue.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
        {staffOnly ? null : (
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === VENUES_PATH} tooltip={t('allVenues')}>
              <Link
                href={VENUES_PATH}
                aria-current={pathname === VENUES_PATH ? 'page' : undefined}
                data-testid="venue-nav-all"
                onClick={onNavigate}
              >
                <LayoutGridIcon aria-hidden />
                <span>{t('allVenues')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {canCreateVenue && !staffOnly ? <NewVenueItem /> : null}
      </SidebarMenu>
    </SidebarGroup>
  )
}
