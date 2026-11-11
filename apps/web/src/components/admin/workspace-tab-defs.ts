// The tabs of a venue workspace, declared once. The tab bar (large screens) and the select (small
// screens) are both rendered from this list; the sidebar lists venues, not their tabs (D74). The
// Platform (PassportEdit.jsx) wrote the tab list twice and let it drift; here a new tab is one
// entry. The Settings tab has sections of its own (D97), declared the same way and kept in the
// URL as `?tab=settings&section=…`.
import {
  BellIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  ClockIcon,
  CloudUploadIcon,
  ConciergeBellIcon,
  CreditCardIcon,
  HistoryIcon,
  LayoutListIcon,
  ListChecksIcon,
  type LucideIcon,
  QrCodeIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from 'lucide-react'

/** What a tab is, without its content (the page supplies the content per value). */
export interface WorkspaceTabDef {
  /** The `?tab=` value: stable, lower-case, URL-safe. */
  readonly value: string
  /** next-intl key of the label. */
  readonly labelKey: string
  readonly icon: LucideIcon
}

/**
 * The venue page's tabs (D97, #85): Studio, Tables & QR, Tonight, Reservations, Settings. Structure
 * and Design are the Studio's subtabs (D129); Reservations is its own tab (D141, #326), offered
 * only to a role that holds `reservations.tonight`. The Publishing tab is gone: the Publish button
 * is in the header on every tab, and its settings are Settings › Publish and › Versioning.
 */
export const WORKSPACE_TAB_DEFS = [
  { value: 'studio', labelKey: 'workspace.tabs.studio', icon: LayoutListIcon },
  { value: 'tables', labelKey: 'workspace.tabs.tables', icon: QrCodeIcon },
  { value: 'tonight', labelKey: 'workspace.tabs.tonight', icon: ConciergeBellIcon },
  { value: 'reservations', labelKey: 'workspace.tabs.reservations', icon: CalendarDaysIcon },
  { value: 'settings', labelKey: 'workspace.tabs.settings', icon: SettingsIcon },
] as const satisfies readonly WorkspaceTabDef[]

/** The value of one of the declared tabs. */
export type WorkspaceTabValue = (typeof WORKSPACE_TAB_DEFS)[number]['value']

/** The tab shown when `?tab=` is absent or unknown. */
export const DEFAULT_WORKSPACE_TAB: WorkspaceTabValue = 'studio'

export function isWorkspaceTab(value: unknown): value is WorkspaceTabValue {
  return WORKSPACE_TAB_DEFS.some((tab) => tab.value === value)
}

/**
 * Which permission-gated tabs the signed-in person's role holds the key for. Reservations is
 * `reservations.tonight` (D141, #326): a role without it is not shown a tab it cannot open, on a
 * shared device either.
 */
export interface WorkspaceRights {
  readonly reservations: boolean
}

/** No keys: what the tab bar assumes until the page has read them. */
export const NO_WORKSPACE_RIGHTS: WorkspaceRights = { reservations: false }

/** The tabs a venue page offers this person. */
export function workspaceTabsOf(
  rights: WorkspaceRights = NO_WORKSPACE_RIGHTS,
): readonly WorkspaceTabDef[] {
  return WORKSPACE_TAB_DEFS.filter((tab) => tab.value !== 'reservations' || rights.reservations)
}

/**
 * The tab a `?tab=` value opens. Tabs that are gone open where their content went: the venue's
 * Integration tab (CF-09b, D73: the venue's part is the Menu source card) and the Publishing tab
 * (D97: Settings › Publish and › Versioning) open Settings; the composer and the Design tab open
 * the Studio (D129; the page sends an old link on to its new address). A tab the person's rights do
 * not offer, and anything else unknown, open the default tab.
 */
export function workspaceTabOf(
  requested: unknown,
  rights: WorkspaceRights = NO_WORKSPACE_RIGHTS,
): WorkspaceTabValue {
  if (requested === 'integration' || requested === 'publishing') return 'settings'
  if (requested === 'composer' || requested === 'design') return 'studio'
  const offered = workspaceTabsOf(rights)
  return isWorkspaceTab(requested) && offered.some((tab) => tab.value === requested)
    ? requested
    : DEFAULT_WORKSPACE_TAB
}

/**
 * The tabs a shared device offers (D122 §7, RR-83, RR-84, RR-85): Tonight, where it opens, and
 * Reservations where the device's own account works them (D141, #326) — a tablet on the door is
 * what the night's list is for. The Studio, Tables & QR and Settings need the person's own
 * sign-in, so they are not there at all.
 */
export function sharedDeviceTabsOf(
  rights: WorkspaceRights = NO_WORKSPACE_RIGHTS,
): readonly WorkspaceTabDef[] {
  return workspaceTabsOf(rights).filter(
    (tab) => tab.value === 'tonight' || tab.value === 'reservations',
  )
}

/** The tab a `?tab=` value opens on a shared device. */
export function sharedDeviceTabOf(
  requested: unknown,
  rights: WorkspaceRights = NO_WORKSPACE_RIGHTS,
): WorkspaceTabValue {
  const tab = workspaceTabOf(requested, rights)
  return sharedDeviceTabsOf(rights).some((one) => one.value === tab) ? tab : 'tonight'
}

/**
 * The sections of the Settings tab (D97, #87): General, Hours, Ordering, Staff and roles, Alerts,
 * Publish (only for a venue with a till) and Versioning, in the order of
 * docs/deliverables/2026-10-27-owner-settings-grouping.md. Reservations (#325) goes after Ordering,
 * for every venue (reservations are Restro's own, never a POS's), read-only without
 * `settings.reservations`. Paying (#116) goes between Reservations and
 * Staff and roles, only where the venue's POS can take card payments. Hours and Ordering are read-only for a role without `settings.guards`; Staff
 * and roles and Alerts are left out for a role without `settings.roles` or `settings.alerts`.
 */
export const SETTINGS_SECTION_DEFS = [
  { value: 'general', labelKey: 'workspace.settingsSections.general', icon: SlidersHorizontalIcon },
  { value: 'hours', labelKey: 'ownerSettings.st_hours', icon: ClockIcon },
  { value: 'ordering', labelKey: 'ownerSettings.st_ordering', icon: ListChecksIcon },
  { value: 'reservations', labelKey: 'ownerSettings.rs_title', icon: CalendarCheckIcon },
  { value: 'paying', labelKey: 'ownerSettings.pa_title', icon: CreditCardIcon },
  { value: 'staff', labelKey: 'ownerSettings.sf_title', icon: UsersIcon },
  { value: 'alerts', labelKey: 'ownerSettings.al_title', icon: BellIcon },
  { value: 'publish', labelKey: 'workspace.settingsSections.publish', icon: CloudUploadIcon },
  { value: 'versioning', labelKey: 'workspace.settingsSections.versioning', icon: HistoryIcon },
] as const satisfies readonly WorkspaceTabDef[]

export type SettingsSectionValue = (typeof SETTINGS_SECTION_DEFS)[number]['value']

/** The section shown when `?section=` is absent, unknown, or not the venue's. */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionValue = 'general'

/** Which permission-gated sections the signed-in person's role holds the right for. */
export interface SettingsRights {
  /** `settings.roles`: Staff and roles. */
  readonly roles: boolean
  /** `settings.alerts`: Alerts. */
  readonly alerts: boolean
  /**
   * The venue's POS can take card payments (D122 §3, #116): Paying is listed for every role then,
   * read-only without `settings.connect_payments`. Never at a venue no POS serves.
   */
  readonly paying?: boolean
}

/** No rights: what the Settings tab assumes until the page has read them. */
export const NO_SETTINGS_RIGHTS: SettingsRights = { roles: false, alerts: false }

/** The sections a venue has: Publish only with a till, Staff and Alerts only with their right. */
export function settingsSectionsOf(
  hasTill: boolean,
  rights: SettingsRights = NO_SETTINGS_RIGHTS,
): readonly SettingsSectionValue[] {
  return SETTINGS_SECTION_DEFS.map((section) => section.value).filter((value) => {
    if (value === 'publish') return hasTill
    if (value === 'staff') return rights.roles
    if (value === 'alerts') return rights.alerts
    if (value === 'paying') return rights.paying === true
    return true
  })
}

/** The section a `?section=` value opens for a venue with or without a till. */
export function settingsSectionOf(
  requested: unknown,
  hasTill: boolean,
  rights: SettingsRights = NO_SETTINGS_RIGHTS,
): SettingsSectionValue {
  const sections = settingsSectionsOf(hasTill, rights)
  return sections.find((section) => section === requested) ?? DEFAULT_SETTINGS_SECTION
}
