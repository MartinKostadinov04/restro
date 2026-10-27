// The tabs of a venue workspace, declared once. The tab bar (large screens) and the select (small
// screens) are both rendered from this list; the sidebar lists venues, not their tabs (D74). The
// Platform (PassportEdit.jsx) wrote the tab list twice and let it drift; here a new tab is one
// entry. The Settings tab has sections of its own (D97), declared the same way and kept in the
// URL as `?tab=settings&section=…`.
import {
  CloudUploadIcon,
  ConciergeBellIcon,
  HistoryIcon,
  LayoutListIcon,
  type LucideIcon,
  QrCodeIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
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
 * The sections of the Settings tab (D97): General (name, address, languages, menus, menu source,
 * danger zone), Publish (Automation settings, only for a venue with a till) and Versioning.
 */
export const SETTINGS_SECTION_DEFS = [
  { value: 'general', labelKey: 'workspace.settingsSections.general', icon: SlidersHorizontalIcon },
  { value: 'publish', labelKey: 'workspace.settingsSections.publish', icon: CloudUploadIcon },
  { value: 'versioning', labelKey: 'workspace.settingsSections.versioning', icon: HistoryIcon },
] as const satisfies readonly WorkspaceTabDef[]

export type SettingsSectionValue = (typeof SETTINGS_SECTION_DEFS)[number]['value']

/** The section shown when `?section=` is absent, unknown, or not the venue's. */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionValue = 'general'

/** The sections a venue has: Publish only with a till (its settings are about syncing). */
export function settingsSectionsOf(hasTill: boolean): readonly SettingsSectionValue[] {
  return SETTINGS_SECTION_DEFS.map((section) => section.value).filter(
    (value) => hasTill || value !== 'publish',
  )
}

/** The section a `?section=` value opens for a venue with or without a till. */
export function settingsSectionOf(requested: unknown, hasTill: boolean): SettingsSectionValue {
  const sections = settingsSectionsOf(hasTill)
  return sections.find((section) => section === requested) ?? DEFAULT_SETTINGS_SECTION
}
