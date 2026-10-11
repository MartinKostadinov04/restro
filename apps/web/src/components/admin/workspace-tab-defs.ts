// The tabs of a venue workspace, declared once. The tab bar (large screens) and the select (small
// screens) are both rendered from this list; the sidebar lists venues, not their tabs (D74). The
// Platform (PassportEdit.jsx) wrote the tab list twice and let it drift; here a new tab is one
// entry.
import {
  LayoutListIcon,
  type LucideIcon,
  PaletteIcon,
  QrCodeIcon,
  RocketIcon,
  SettingsIcon,
} from 'lucide-react'

/** What a tab is, without its content (the page supplies the content per value). */
export interface WorkspaceTabDef {
  /** The `?tab=` value: stable, lower-case, URL-safe. */
  readonly value: string
  /** next-intl key of the label. */
  readonly labelKey: string
  readonly icon: LucideIcon
}

export const WORKSPACE_TAB_DEFS = [
  { value: 'composer', labelKey: 'workspace.tabs.composer', icon: LayoutListIcon },
  { value: 'tables', labelKey: 'workspace.tabs.tables', icon: QrCodeIcon },
  { value: 'publishing', labelKey: 'workspace.tabs.publishing', icon: RocketIcon },
  { value: 'design', labelKey: 'workspace.tabs.design', icon: PaletteIcon },
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
 * The tab a `?tab=` value opens. The venue's Integration tab is gone (CF-09b, D73: the connection
 * is the organisation's, the venue's part is the Menu source card in its Settings tab), so an old
 * link `?tab=integration` opens Settings; anything else unknown opens the default tab.
 */
export function workspaceTabOf(requested: unknown): WorkspaceTabValue {
  if (requested === 'integration') return 'settings'
  return isWorkspaceTab(requested) ? requested : DEFAULT_WORKSPACE_TAB
}
