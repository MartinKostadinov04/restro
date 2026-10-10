// The tabs of a venue workspace, declared once. The tab bar (large screens), the select (small
// screens) and the sidebar's venue sub-menu are all rendered from this list. The Platform
// (PassportEdit.jsx) wrote the tab list twice and let it drift; here a new tab is one entry.
import {
  LayoutListIcon,
  type LucideIcon,
  PlugIcon,
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
  { value: 'integration', labelKey: 'workspace.tabs.integration', icon: PlugIcon },
  { value: 'settings', labelKey: 'workspace.tabs.settings', icon: SettingsIcon },
] as const satisfies readonly WorkspaceTabDef[]

/** The value of one of the declared tabs. */
export type WorkspaceTabValue = (typeof WORKSPACE_TAB_DEFS)[number]['value']

/** The tab shown when `?tab=` is absent or unknown. */
export const DEFAULT_WORKSPACE_TAB: WorkspaceTabValue = 'composer'

export function isWorkspaceTab(value: unknown): value is WorkspaceTabValue {
  return WORKSPACE_TAB_DEFS.some((tab) => tab.value === value)
}
