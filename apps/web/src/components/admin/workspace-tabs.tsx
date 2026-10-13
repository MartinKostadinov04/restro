'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useOptimistic, useRef, useTransition } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import {
  SETTINGS_SECTION_DEFS,
  type SettingsSectionValue,
  settingsSectionOf,
  settingsSectionsOf,
  WORKSPACE_TAB_DEFS,
  type WorkspaceTabDef,
  type WorkspaceTabValue,
  workspaceTabOf,
} from './workspace-tab-defs'

/**
 * The tab a URL parameter names, and the way to choose another. The current tab is *derived* from
 * the URL (the Platform set it while rendering); a choice shows at once (`useOptimistic`) while
 * `router.replace` writes the parameter, keeping the others, and the page catches up.
 */
function useUrlTab<V extends string>(
  param: string,
  resolve: (requested: string | null) => V,
  isValue: (value: string) => value is V,
): readonly [V, (value: string) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const fromUrl = resolve(searchParams.get(param))
  const [current, show] = useOptimistic(fromUrl)
  // The tab last asked for: a click can fire Radix's change event twice (press, then focus) before
  // the URL has caught up, and the URL should be written once.
  const asked = useRef<string>(fromUrl)
  useEffect(() => {
    asked.current = fromUrl
  }, [fromUrl])

  function select(value: string) {
    if (!isValue(value) || value === asked.current) return
    asked.current = value
    const params = new URLSearchParams(searchParams.toString())
    params.set(param, value)
    startTransition(() => {
      show(value)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    })
  }
  return [current, select] as const
}

/** A tab bar (large screens) and a select (small screens) drawn from one list, and the panels. */
function UrlTabs<V extends string>({
  defs,
  current,
  select,
  contents,
  label,
  listClassName,
}: {
  defs: readonly (WorkspaceTabDef & { readonly value: V })[]
  current: V
  select: (value: string) => void
  contents: Partial<Record<V, ReactNode>>
  label: string
  listClassName?: string
}) {
  const t = useTranslations()
  return (
    <Tabs value={current} onValueChange={select}>
      <TabsList className={listClassName ?? 'hidden lg:inline-flex'} aria-label={label}>
        {defs.map(({ value, labelKey, icon: Icon }) => (
          <TabsTrigger key={value} value={value}>
            <Icon aria-hidden />
            {t(labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
      <Select value={current} onValueChange={select}>
        <SelectTrigger className="w-full lg:hidden" aria-label={label}>
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
      {defs.map(({ value }) => (
        <TabsContent key={value} value={value} className="pt-2">
          {contents[value]}
        </TabsContent>
      ))}
    </Tabs>
  )
}

interface WorkspaceTabsProps {
  /** The content of every tab, keyed by tab value (a missing tab is a type error). */
  contents: Record<WorkspaceTabValue, ReactNode>
}

const isWorkspaceTabValue = (value: string): value is WorkspaceTabValue =>
  WORKSPACE_TAB_DEFS.some((tab) => tab.value === value)

/**
 * The tabs of a venue workspace, mirrored in the URL (`?tab=settings`). Ported from the
 * Platform's PassportEdit.jsx (27-75, 157-179) with its two defects fixed: the tab list is
 * declared once (workspace-tab-defs.ts) and drawn twice from that list (tab bar on large screens,
 * select below it), and the current tab is *derived* from the URL instead of being set while
 * rendering.
 */
export function WorkspaceTabs({ contents }: WorkspaceTabsProps) {
  const t = useTranslations('workspace')
  const [current, select] = useUrlTab<WorkspaceTabValue>(
    'tab',
    workspaceTabOf,
    isWorkspaceTabValue,
  )
  return (
    <UrlTabs
      defs={WORKSPACE_TAB_DEFS}
      current={current}
      select={select}
      contents={contents}
      label={t('switchTab')}
    />
  )
}

/**
 * The sections of the Settings tab (D97), mirrored in the URL as `?section=` beside `?tab=`, the
 * same port as the workspace tabs: General, Publish (only for a venue with a till) and Versioning.
 */
export function SettingsSections({
  hasTill,
  contents,
}: {
  hasTill: boolean
  /** The content of each section the venue has. */
  contents: Partial<Record<SettingsSectionValue, ReactNode>>
}) {
  const t = useTranslations('workspace')
  const sections = settingsSectionsOf(hasTill)
  const defs = SETTINGS_SECTION_DEFS.filter((def) => sections.includes(def.value))
  const [current, select] = useUrlTab<SettingsSectionValue>(
    'section',
    (requested) => settingsSectionOf(requested, hasTill),
    (value): value is SettingsSectionValue => sections.some((section) => section === value),
  )
  return (
    <UrlTabs
      defs={defs}
      current={current}
      select={select}
      contents={contents}
      label={t('switchSection')}
      listClassName="hidden lg:inline-flex"
    />
  )
}
