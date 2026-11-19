// The sidebar of a venue's page (D154), declared once: groups by what the venue does — its menu,
// its modules (ordering, reservations; D155) and the venue itself — each entry opening one of
// today's addresses (`?tab=…&section=…`). Each module has its own "Settings" (D156). A new module is
// one group here plus its screens. The page decides again who may open what: a missing entry is a
// convenience, never the guard.
import {
  CalendarDaysIcon,
  ConciergeBellIcon,
  LayoutListIcon,
  type LucideIcon,
  QrCodeIcon,
  SettingsIcon,
} from 'lucide-react'

import {
  FIRST_SECTION_OF,
  SETTINGS_MODULE_OF,
  type SettingsModule,
  type SettingsSectionValue,
  type WorkspaceTabValue,
} from './workspace-tab-defs'

/** One entry of the venue's sidebar. */
export interface VenueNavEntry {
  /** Stable key, also the entry's `data-nav` in the page (tests find entries by it). */
  readonly key: string
  /** next-intl key of the visible label. */
  readonly labelKey: string
  /**
   * next-intl key of the tooltip, when the label alone is not enough collapsed to icons ("Settings"
   * names its module there: "Ordering settings").
   */
  readonly tooltipKey?: string
  readonly icon: LucideIcon
  /** The screen it opens. */
  readonly tab: WorkspaceTabValue
  /** Settings entries: the module whose sections it opens. */
  readonly module?: SettingsModule
}

export type VenueNavGroupKey = 'menu' | 'ordering' | 'reservations' | 'venue'

export interface VenueNavGroup {
  readonly key: VenueNavGroupKey
  readonly labelKey: string
  readonly entries: readonly VenueNavEntry[]
}

const settingsEntry = (module: SettingsModule): VenueNavEntry => ({
  key: `settings-${module}`,
  labelKey: 'nav.settings',
  tooltipKey: `nav.settingsOf.${module}`,
  icon: SettingsIcon,
  tab: 'settings',
  module,
})

/** The groups in sidebar order, every entry a person might be offered. */
export const VENUE_NAV_GROUPS: readonly VenueNavGroup[] = [
  {
    key: 'menu',
    labelKey: 'nav.groups.menu',
    entries: [
      { key: 'studio', labelKey: 'workspace.tabs.studio', icon: LayoutListIcon, tab: 'studio' },
      { key: 'tables', labelKey: 'workspace.tabs.tables', icon: QrCodeIcon, tab: 'tables' },
    ],
  },
  {
    key: 'ordering',
    labelKey: 'nav.groups.ordering',
    entries: [
      {
        key: 'tonight',
        labelKey: 'workspace.tabs.tonight',
        icon: ConciergeBellIcon,
        tab: 'tonight',
      },
      settingsEntry('ordering'),
    ],
  },
  {
    key: 'reservations',
    labelKey: 'nav.groups.reservations',
    entries: [
      {
        key: 'reservations',
        labelKey: 'workspace.tabs.reservations',
        icon: CalendarDaysIcon,
        tab: 'reservations',
      },
      settingsEntry('reservations'),
    ],
  },
  { key: 'venue', labelKey: 'nav.groups.venue', entries: [settingsEntry('venue')] },
]

/** What decides which entries a person is shown at one venue. */
export interface VenueNavViewer {
  /** `reservations.tonight` at this venue (D141, #326): the night's list is theirs. */
  readonly reservations: boolean
}

/** The groups this person is shown at a venue; a group keeps its Settings whatever else goes. */
export function venueNavGroupsOf(viewer: VenueNavViewer): readonly VenueNavGroup[] {
  return VENUE_NAV_GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => entry.key !== 'reservations' || viewer.reservations),
  })).filter((group) => group.entries.length > 0)
}

/** The address an entry opens, at one venue. */
export function venueEntryHref(venueId: string, entry: VenueNavEntry): string {
  const query =
    entry.module === undefined
      ? `tab=${entry.tab}`
      : `tab=settings&section=${FIRST_SECTION_OF[entry.module]}`
  return `/venues/${venueId}?${query}`
}

/**
 * Whether an entry is the open screen. `tab` and `section` are the URL's, which the page has
 * already made canonical (`venueQueryRedirect`): no `?tab=` is the Studio, no `?section=` General.
 */
export function isVenueEntryOpen(
  entry: VenueNavEntry,
  tab: string | null,
  section: string | null,
): boolean {
  const openTab = tab ?? 'studio'
  if (entry.tab !== openTab) return false
  if (entry.module === undefined) return true
  const module =
    section !== null && Object.hasOwn(SETTINGS_MODULE_OF, section)
      ? SETTINGS_MODULE_OF[section as SettingsSectionValue]
      : 'venue'
  return module === entry.module
}
