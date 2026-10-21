// The sections of the organisation's Settings area (D73, D74), declared once. The sub-navigation
// and the breadcrumb are both drawn from this list, and `/settings` opens the first entry. A new
// section (members, billing) is one entry here plus its page under `app/(admin)/settings/`.
import { ArchiveRestoreIcon, Building2Icon, type LucideIcon, PlugIcon } from 'lucide-react'

/** What a section is, without its content (each section is a page of its own). */
export interface SettingsSectionDef {
  /** The last part of the path: stable, lower-case, URL-safe. */
  readonly value: string
  /** next-intl key of the label. */
  readonly labelKey: string
  readonly icon: LucideIcon
  /**
   * Only an owner sees the section in the navigation (D76: Deleted venues). The page checks the
   * role itself; this only keeps a link nobody else can use out of their way.
   */
  readonly ownersOnly?: boolean
}

export const SETTINGS_SECTIONS = [
  // The first section: `/settings` opens it (D91: the organisation's name and address name).
  { value: 'general', labelKey: 'settings.sections.general', icon: Building2Icon },
  { value: 'integrations', labelKey: 'settings.sections.integrations', icon: PlugIcon },
  {
    value: 'deleted-venues',
    labelKey: 'settings.sections.deletedVenues',
    icon: ArchiveRestoreIcon,
    ownersOnly: true,
  },
] as const satisfies readonly SettingsSectionDef[]

/** The address of the Settings area; `/settings` redirects to the first section. */
export const SETTINGS_PATH = '/settings'

/** The address of one section. */
export function settingsSectionPath(section: SettingsSectionDef): string {
  return `${SETTINGS_PATH}/${section.value}`
}

/** The sections a person sees in the navigation: those for owners only are left out for the rest. */
export function visibleSettingsSections(isOwner: boolean): readonly SettingsSectionDef[] {
  return SETTINGS_SECTIONS.filter((section: SettingsSectionDef) => isOwner || !section.ownersOnly)
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
