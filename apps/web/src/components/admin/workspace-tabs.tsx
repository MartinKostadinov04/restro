'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type ReactNode, useOptimistic, useTransition } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import {
  NO_SETTINGS_RIGHTS,
  NO_WORKSPACE_RIGHTS,
  SETTINGS_SECTION_DEFS,
  type SettingsModule,
  type SettingsRights,
  type SettingsSectionValue,
  settingsSectionOf,
  settingsSectionsOf,
  sharedDeviceTabOf,
  sharedDeviceTabsOf,
  WORKSPACE_TAB_DEFS,
  type WorkspaceRights,
  type WorkspaceTabDef,
  type WorkspaceTabValue,
  workspaceTabOf,
  workspaceTabsOf,
} from './workspace-tab-defs'

/**
 * The tab a URL parameter names, and the way to choose another. The current tab is *derived* from
 * the URL (the Platform set it while rendering); a choice shows at once (`useOptimistic`) while
 * `router.replace` writes the parameter, keeping the others but those named in `drop` (another
 * tab's state, C1), and the page catches up. Exported for Tonight's and Reservations' views.
 */
export function useUrlTab<V extends string>(
  param: string,
  resolve: (requested: string | null) => V,
  isValue: (value: string) => value is V,
  drop: readonly string[] = [],
): readonly [V, (value: string) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const fromUrl = resolve(searchParams.get(param))
  const [current, show] = useOptimistic(fromUrl)

  // The tabs activate on a click or Enter only (`activationMode="manual"`), so one choice fires
  // once: no remembered "last asked" to fall out of step with the URL (C6, C7).
  function select(value: string) {
    if (!isValue(value) || value === current) return
    const params = new URLSearchParams(searchParams.toString())
    for (const key of drop) params.delete(key)
    params.set(param, value)
    startTransition(() => {
      show(value)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    })
  }
  return [current, select] as const
}

/** A tab bar (large screens) and a select (small screens) drawn from one list, and the panels. */
export function UrlTabs<V extends string>({
  defs,
  current,
  select,
  contents,
  label,
  listClassName,
  selectClassName = 'w-full lg:hidden',
  oneRow = false,
}: {
  defs: readonly (WorkspaceTabDef & { readonly value: V })[]
  current: V
  select: (value: string) => void
  contents: Partial<Record<V, ReactNode>>
  label: string
  listClassName?: string
  /** The select's classes: the width it hides from must be the width `listClassName` shows from. */
  selectClassName?: string
  /**
   * A list short enough for the narrowest screen — a shared device's Tonight and Reservations
   * (#326, D141). The row is then drawn at every width and there is no select at all, so the tab
   * a hostess needs at the door is one tap, in portrait as in landscape.
   */
  oneRow?: boolean
}) {
  const t = useTranslations()
  return (
    <Tabs value={current} onValueChange={select} activationMode="manual">
      {/* One tab is no choice: a device whose role is off the door has Tonight alone (D141). */}
      {defs.length > 1 ? (
        <>
          {/* Whatever the list, the row scrolls inside itself rather than pushing the page. */}
          <TabsList
            className={
              listClassName ??
              (oneRow
                ? 'inline-flex max-w-full overflow-x-auto overflow-y-hidden'
                : 'hidden max-w-full overflow-x-auto overflow-y-hidden lg:inline-flex')
            }
            aria-label={label}
          >
            {defs.map(({ value, labelKey, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon aria-hidden />
                {t(labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          {oneRow ? null : (
            <Select value={current} onValueChange={select}>
              <SelectTrigger className={selectClassName} aria-label={label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {defs.map(({ value, labelKey, icon: Icon }) => (
                  <SelectItem key={value} value={value}>
                    <Icon aria-hidden />
                    {t(labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </>
      ) : null}
      {defs.map(({ value }) => (
        <TabsContent key={value} value={value} className="pt-2">
          {contents[value]}
        </TabsContent>
      ))}
    </Tabs>
  )
}

interface WorkspaceTabsProps {
  /** The content of every tab the person is offered (a tab nobody is offered needs none). */
  contents: Partial<Record<WorkspaceTabValue, ReactNode>>
  /**
   * A shared device: Tonight and Reservations only (RR-83). On a person's own sign-in the sidebar
   * opens the venue's screens (D154) and this row is not drawn.
   */
  sharedDevice?: boolean
  /** What the person holds: Reservations shows only with its key (#326). */
  rights?: WorkspaceRights
}

const isWorkspaceTabValue = (value: string): value is WorkspaceTabValue =>
  WORKSPACE_TAB_DEFS.some((tab) => tab.value === value)

/**
 * The screens of a shared device's venue page (Tonight, Reservations), mirrored in the URL
 * (`?tab=tonight`); a person's own sign-in opens screens from the sidebar instead (D154). Ported
 * from the Platform's PassportEdit.jsx (27-75, 157-179) with its two defects fixed: the tab list is
 * declared once (workspace-tab-defs.ts), and the current tab is *derived* from the URL instead of
 * being set while rendering.
 */
export function WorkspaceTabs({
  contents,
  sharedDevice = false,
  rights = NO_WORKSPACE_RIGHTS,
}: WorkspaceTabsProps) {
  const t = useTranslations('workspace')
  const defs = (
    sharedDevice ? sharedDeviceTabsOf(rights) : workspaceTabsOf(rights)
  ) as readonly (WorkspaceTabDef & { readonly value: WorkspaceTabValue })[]
  const [current, select] = useUrlTab<WorkspaceTabValue>(
    'tab',
    (requested) =>
      sharedDevice ? sharedDeviceTabOf(requested, rights) : workspaceTabOf(requested, rights),
    (value): value is WorkspaceTabValue =>
      isWorkspaceTabValue(value) && defs.some((tab) => tab.value === value),
  )
  return (
    <UrlTabs
      defs={defs}
      current={current}
      select={select}
      contents={contents}
      label={t('switchTab')}
      // A shared device has Tonight and the night's list, two tabs that fit a 390 px phone: no
      // chooser between them at any width (RR-85, #326).
      oneRow={sharedDevice}
    />
  )
}

/**
 * The sections of one module's Settings (D156), mirrored in the URL as `?section=` beside `?tab=`,
 * the same port as the workspace tabs: the venue's (General, Staff and roles, Publish, Versioning),
 * Ordering's (Hours, Ordering, Paying, Alerts) or Reservations' one, which needs no row.
 */
export function SettingsSections({
  hasTill,
  rights = NO_SETTINGS_RIGHTS,
  module,
  contents,
}: {
  hasTill: boolean
  /** What the person holds: Staff and roles and Alerts show only with their right. */
  rights?: SettingsRights
  /** The module whose sections the row offers; the sidebar opens the others. */
  module: SettingsModule
  /** The content of each section the venue has. */
  contents: Partial<Record<SettingsSectionValue, ReactNode>>
}) {
  const t = useTranslations('workspace')
  const sections = settingsSectionsOf(hasTill, rights, module)
  const defs = SETTINGS_SECTION_DEFS.filter((def) => sections.includes(def.value))
  const [current, select] = useUrlTab<SettingsSectionValue>(
    'section',
    (requested) => settingsSectionOf(requested, hasTill, rights),
    (value): value is SettingsSectionValue => sections.some((section) => section === value),
    // The payment provider's return (#116) is Paying's: leaving Paying leaves it behind.
    ['connection'],
  )
  return (
    <UrlTabs
      defs={defs}
      current={current}
      select={select}
      contents={contents}
      label={t('switchSection')}
      // A module's few sections fit one row beside the sidebar from lg (D156). If a longer label
      // still tips it, the row starts at its first tab (a centred row that overflows cuts its
      // start off) and scrolls inside itself with no visible bar, which would take the tabs'
      // height (lane 5 S3, N1).
      listClassName="hidden max-w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] group-data-[orientation=horizontal]/tabs:h-auto lg:inline-flex [&::-webkit-scrollbar]:hidden *:min-h-8"
    />
  )
}
