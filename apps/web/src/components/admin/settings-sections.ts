// The sections of the organisation's Settings area (D73, D74), declared once. The sub-navigation
// and the breadcrumb are both drawn from this list, and `/settings` opens the first entry. A new
// section (members, billing) is one entry here plus its page under `app/(admin)/settings/`.
import { type LucideIcon, PlugIcon } from 'lucide-react'

/** What a section is, without its content (each section is a page of its own). */
export interface SettingsSectionDef {
  /** The last part of the path: stable, lower-case, URL-safe. */
  readonly value: string
  /** next-intl key of the label. */
  readonly labelKey: string
  readonly icon: LucideIcon
}

export const SETTINGS_SECTIONS = [
  { value: 'integrations', labelKey: 'settings.sections.integrations', icon: PlugIcon },
] as const satisfies readonly SettingsSectionDef[]

/** The address of the Settings area; `/settings` redirects to the first section. */
export const SETTINGS_PATH = '/settings'

/** The address of one section. */
export function settingsSectionPath(section: SettingsSectionDef): string {
  return `${SETTINGS_PATH}/${section.value}`
}

/** The section that owns a path (the section itself or anything below it), or undefined. */
export function settingsSectionOf(
  pathname: string,
): (typeof SETTINGS_SECTIONS)[number] | undefined {
  return SETTINGS_SECTIONS.find((section) => {
    const path = settingsSectionPath(section)
    return pathname === path || pathname.startsWith(`${path}/`)
  })
}
