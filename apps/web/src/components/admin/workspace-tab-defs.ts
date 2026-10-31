// The tabs of a venue workspace, declared once. The tab bar (large screens) and the select (small
// screens) are both rendered from this list; the sidebar lists venues, not their tabs (D74). The
// Platform (PassportEdit.jsx) wrote the tab list twice and let it drift; here a new tab is one
// entry. The Settings tab has sections of its own (D97), declared the same way and kept in the
// URL as `?tab=settings&section=…`.
import {
  BellIcon,
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
 * The venue page's tabs (D97, #85): Composer, Tables & QR, Tonight, Settings. Design is the composer's second
 * subtab (D92, brief S6). The Publishing tab is gone: the Publish button is in the header on
 * every tab, and its settings are Settings › Publish and › Versioning.
 */
export const WORKSPACE_TAB_DEFS = [
  { value: 'composer', labelKey: 'workspace.tabs.composer', icon: LayoutListIcon },
  { value: 'tables', labelKey: 'workspace.tabs.tables', icon: QrCodeIcon },
  { value: 'tonight', labelKey: 'workspace.tabs.tonight', icon: ConciergeBellIcon },
  { value: 'settings', labelKey: 'workspace.tabs.settings', icon: SettingsIcon },
] as const satisfies readonly WorkspaceTabDef[]

/** The value of one of the declared tabs. */
export type WorkspaceTabValue = (typeof WORKSPACE_TAB_DEFS)[number]['value']

/** The tab shown when `?tab=` is absent or unknown. */
export const DEFAULT_WORKSPACE_TAB: WorkspaceTabValue = 'composer'

export function isWorkspaceTab(value: unknown): value is WorkspaceTabValue {
  return WORKSPACE_TAB_DEFS.some((tab) => tab.value === value)
}

/**
 * The tab a `?tab=` value opens. Tabs that are gone open where their content went: the venue's
 * Integration tab (CF-09b, D73: the venue's part is the Menu source card) and the Publishing tab
 * (D97: Settings › Publish and › Versioning) open Settings; the Design tab (D92) opens the
 * composer, whose Design subtab the page then shows. Anything else unknown opens the default tab.
 */
export function workspaceTabOf(requested: unknown): WorkspaceTabValue {
  if (requested === 'integration' || requested === 'publishing') return 'settings'
  if (requested === 'design') return 'composer'
  return isWorkspaceTab(requested) ? requested : DEFAULT_WORKSPACE_TAB
}

/**
 * The tabs a shared device has (D122 §7, RR-83, RR-84, RR-85): it works Tonight, and the composer,
 * Tables & QR and Settings need the person's own sign-in, so they aren't there and Tonight is where
 * it opens.
 */
export const SHARED_DEVICE_TAB_DEFS = WORKSPACE_TAB_DEFS.filter((tab) => tab.value === 'tonight')

/** The tab a `?tab=` value opens on a shared device. */
export function sharedDeviceTabOf(requested: unknown): WorkspaceTabValue {
  const tab = workspaceTabOf(requested)
  return SHARED_DEVICE_TAB_DEFS.some((one) => one.value === tab) ? tab : 'tonight'
}

/**
 * The sections of the Settings tab (D97, #87): General, Hours, Ordering, Staff and roles, Alerts,
 * Publish (only for a venue with a till) and Versioning, in the order of
 * docs/deliverables/2026-10-27-owner-settings-grouping.md. Paying (#116) goes between Ordering and
 * Staff and roles, only where the venue's POS can take card payments. Hours and Ordering are read-only for a role without `settings.guards`; Staff
 * and roles and Alerts are left out for a role without `settings.roles` or `settings.alerts`.
 */
export const SETTINGS_SECTION_DEFS = [
  { value: 'general', labelKey: 'workspace.settingsSections.general', icon: SlidersHorizontalIcon },
  { value: 'hours', labelKey: 'ownerSettings.st_hours', icon: ClockIcon },
  { value: 'ordering', labelKey: 'ownerSettings.st_ordering', icon: ListChecksIcon },
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
