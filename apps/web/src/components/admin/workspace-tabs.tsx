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
  DEFAULT_WORKSPACE_TAB,
  isWorkspaceTab,
  WORKSPACE_TAB_DEFS,
  type WorkspaceTabValue,
} from './workspace-tab-defs'

interface WorkspaceTabsProps {
  /** The content of every tab, keyed by tab value (a missing tab is a type error). */
  contents: Record<WorkspaceTabValue, ReactNode>
}

/**
 * The tabs of a venue workspace, mirrored in the URL (`?tab=settings`). Ported from the
 * Platform's PassportEdit.jsx (27-75, 157-179) with its two defects fixed: the tab list is
 * declared once (workspace-tab-defs.ts) and drawn twice from that list (tab bar on large screens,
 * select below it), and the current tab is *derived* from the URL instead of being set while
 * rendering.
 */
export function WorkspaceTabs({ contents }: WorkspaceTabsProps) {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const requested = searchParams.get('tab')
  const fromUrl: WorkspaceTabValue = isWorkspaceTab(requested) ? requested : DEFAULT_WORKSPACE_TAB
  // Shows the new tab at once while the URL (and the page) catch up; falls back to the URL's tab.
  const [current, showTab] = useOptimistic(fromUrl)
  // The tab last asked for: a click can fire Radix's change event twice (press, then focus) before
  // the URL has caught up, and the URL should be written once.
  const asked = useRef<string>(fromUrl)
  useEffect(() => {
    asked.current = fromUrl
  }, [fromUrl])

  function selectTab(value: string) {
    if (!isWorkspaceTab(value) || value === asked.current) return
    asked.current = value
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    startTransition(() => {
      showTab(value)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    })
  }

  return (
    <Tabs value={current} onValueChange={selectTab}>
      <TabsList className="hidden lg:inline-flex">
        {WORKSPACE_TAB_DEFS.map(({ value, labelKey, icon: Icon }) => (
          <TabsTrigger key={value} value={value}>
            <Icon aria-hidden />
            {t(labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
      <Select value={current} onValueChange={selectTab}>
        <SelectTrigger className="w-full lg:hidden" aria-label={t('workspace.switchTab')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WORKSPACE_TAB_DEFS.map(({ value, labelKey, icon: Icon }) => (
            <SelectItem key={value} value={value}>
              <Icon aria-hidden />
              {t(labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {WORKSPACE_TAB_DEFS.map(({ value }) => (
        <TabsContent key={value} value={value} className="pt-2">
          {contents[value]}
        </TabsContent>
      ))}
    </Tabs>
  )
}
