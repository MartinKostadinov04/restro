// The screens of a venue, declared once and kept in the URL as `?tab=…` (and `&section=…` for
// Settings, D97). On a person's own sign-in the sidebar opens them (D154, venue-nav-defs.ts); a
// shared device keeps them as one row of tabs (D122 §7). The Platform (PassportEdit.jsx) wrote the
// tab list twice and let it drift; here a new screen is one entry. Each Settings section belongs to
// one module (D156): the sidebar opens a module's first section and the page's row shows that
// module's sections only.
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
 * The sections of the Settings tab (D97, #87), by the module they belong to (D156): the venue's
 * own (General, Staff and roles, Publish only for a venue with a till, Versioning), Ordering's
 * (Hours, Ordering, Paying only where the venue's POS can take card payments, #116, and Alerts,
 * whose every alert is the night's), and Reservations' one section (#325, for every venue:
 * reservations are Restro's own, never a POS's; read-only without `settings.reservations`). Hours
 * and Ordering are read-only for a role without `settings.guards`; Staff and roles and Alerts are
 * left out for a role without `settings.roles` or `settings.alerts`.
 */
export const SETTINGS_SECTION_DEFS = [
  { value: 'general', labelKey: 'workspace.settingsSections.general', icon: SlidersHorizontalIcon },
  { value: 'staff', labelKey: 'ownerSettings.sf_title', icon: UsersIcon },
  { value: 'publish', labelKey: 'workspace.settingsSections.publish', icon: CloudUploadIcon },
  { value: 'versioning', labelKey: 'workspace.settingsSections.versioning', icon: HistoryIcon },
  { value: 'hours', labelKey: 'ownerSettings.st_hours', icon: ClockIcon },
  { value: 'ordering', labelKey: 'ownerSettings.st_ordering', icon: ListChecksIcon },
  { value: 'paying', labelKey: 'ownerSettings.pa_title', icon: CreditCardIcon },
  { value: 'alerts', labelKey: 'ownerSettings.al_title', icon: BellIcon },
  { value: 'reservations', labelKey: 'ownerSettings.rs_title', icon: CalendarCheckIcon },
] as const satisfies readonly WorkspaceTabDef[]

export type SettingsSectionValue = (typeof SETTINGS_SECTION_DEFS)[number]['value']

/**
 * The part of the venue a Settings section belongs to: the venue itself, or one of its modules
 * (D155, D156; GLOSSARY "Module").
 */
export type SettingsModule = 'venue' | 'ordering' | 'reservations'

/** Each section's module: the sidebar has one "Settings" per module, and the row shows its own. */
export const SETTINGS_MODULE_OF: Readonly<Record<SettingsSectionValue, SettingsModule>> = {
  general: 'venue',
  staff: 'venue',
  publish: 'venue',
  versioning: 'venue',
  hours: 'ordering',
  ordering: 'ordering',
  paying: 'ordering',
  alerts: 'ordering',
  reservations: 'reservations',
}

/** The section a module's "Settings" opens: one every role is offered. */
export const FIRST_SECTION_OF: Readonly<Record<SettingsModule, SettingsSectionValue>> = {
  venue: 'general',
  ordering: 'hours',
  reservations: 'reservations',
}

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

/**
 * The sections a venue has (Publish only with a till; Staff, Alerts and Paying only with their
 * right), of one module when one is named.
 */
export function settingsSectionsOf(
  hasTill: boolean,
  rights: SettingsRights = NO_SETTINGS_RIGHTS,
  module?: SettingsModule,
): readonly SettingsSectionValue[] {
  return SETTINGS_SECTION_DEFS.map((section) => section.value).filter((value) => {
    if (module !== undefined && SETTINGS_MODULE_OF[value] !== module) return false
    if (value === 'publish') return hasTill
    if (value === 'staff') return rights.roles
    if (value === 'alerts') return rights.alerts
    if (value === 'paying') return rights.paying === true
    return true
  })
}

/**
 * The section a `?section=` value opens for a venue with or without a till. A known section the
 * venue or the person is not offered (Paying without a POS, Alerts without the right) opens its
 * own module's first section, so the person stays in that module's Settings; anything else opens
 * the default.
 */
export function settingsSectionOf(
  requested: unknown,
  hasTill: boolean,
  rights: SettingsRights = NO_SETTINGS_RIGHTS,
): SettingsSectionValue {
  const sections = settingsSectionsOf(hasTill, rights)
  const offered = sections.find((section) => section === requested)
  if (offered !== undefined) return offered
  return isSettingsSection(requested)
    ? FIRST_SECTION_OF[SETTINGS_MODULE_OF[requested]]
    : DEFAULT_SETTINGS_SECTION
}

function isSettingsSection(value: unknown): value is SettingsSectionValue {
  return typeof value === 'string' && Object.hasOwn(SETTINGS_MODULE_OF, value)
}

/** A page's query as Next.js hands it over. */
export type VenueQuery = Readonly<Record<string, string | readonly string[] | undefined>>

/** What Settings offers this person at this venue, for resolving a `?section=`. */
export interface SettingsOffer {
  readonly hasTill: boolean
  readonly rights: SettingsRights
}

/**
 * The parameters each screen reads, in the order the address writes them. The Studio's `section`
 * is a menu section's id (`item-param.ts`), not a Settings section. Anything else a link carries
 * (another screen's `view`, a Settings section on the Studio) is left behind, so one screen's
 * state never leaks into another's (lane 6 step 0, C1).
 */
const KEPT_PARAMS: Readonly<Record<WorkspaceTabValue, readonly string[]>> = {
  studio: ['menu', 'section', 'item', 'sub'],
  tables: [],
  tonight: ['view', 'day'],
  reservations: ['view', 'day', 'guest'],
  settings: ['section', 'connection'],
}

/**
 * The one address a venue link means, as a query string: old and unknown tabs and sections
 * resolved to where they open now (the composer is the Studio, the Integration tab Settings ›
 * General, the Publishing tab Settings › Publish; D97, D129), and only the parameters the screen
 * reads. The Design links (`tab=design`, `sub=design`) are the page's own redirect, before this.
 */
export function canonicalVenueQuery(
  query: VenueQuery,
  rights: WorkspaceRights,
  settings: SettingsOffer,
): string {
  const one = (key: string): string | undefined => {
    const value = query[key]
    return typeof value === 'string' ? value : undefined
  }
  const requested = one('tab')
  const tab = workspaceTabOf(requested, rights)
  const params = new URLSearchParams({ tab })
  if (tab === 'settings') {
    const asked =
      requested === 'integration'
        ? 'general'
        : requested === 'publishing'
          ? 'publish'
          : one('section')
    const section = settingsSectionOf(asked, settings.hasTill, settings.rights)
    params.set('section', section)
    // The payment provider's return and refresh addresses (#116) are Paying's alone.
    const connection = one('connection')
    if (section === 'paying' && connection !== undefined) params.set('connection', connection)
    return params.toString()
  }
  for (const key of KEPT_PARAMS[tab]) {
    const value = one(key)
    if (value !== undefined) params.set(key, value)
  }
  return params.toString()
}

/**
 * Where a venue link should be sent instead, as a query string, or null when it already is the one
 * address it means (C9). A link without `?tab=` is the Studio's own and is left as it is.
 */
export function venueQueryRedirect(
  query: VenueQuery,
  rights: WorkspaceRights,
  settings: SettingsOffer,
): string | null {
  if (query.tab === undefined) return null
  const target = canonicalVenueQuery(query, rights, settings)
  const wanted = new URLSearchParams(target)
  const keys = Object.keys(query).filter((key) => query[key] !== undefined)
  const same =
    keys.length === [...wanted.keys()].length && keys.every((key) => query[key] === wanted.get(key))
  return same ? null : target
}
