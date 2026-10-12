'use client'

// Settings -> Integrations, source-agnostic (adjustments I1, I2, D81): the systems picker, then one
// tab per chosen system, each listing that system's named instances. Plain data in (see
// server/integration/view.ts); no secret is ever in it. The open tab is mirrored in the address
// (`?system=`) with `history.replaceState`, as the venue workspace's tabs are (ported from the
// Platform's PassportEdit.jsx tabs: one declared list, the open tab derived from the address).
import { PlugIcon } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { IntegrationsView } from '@/server/integration/view'

import { LiveRefresh } from './live-refresh'
import { SystemTab } from './system-tab'
import { SystemsPicker } from './systems-picker'

export function IntegrationsScreen({ view }: { view: IntegrationsView }) {
  const t = useTranslations('integration')
  const searchParams = useSearchParams()
  // The tab last picked here; until one is, the address says which is open (derived, never set
  // while rendering: the Platform's tabs did that).
  const [picked, setPicked] = useState<string | null>(null)
  const asked = picked ?? searchParams.get('system')

  // A system has a tab when it is chosen, or still has instances (it cannot be left out then).
  const tabs = view.systems.filter(
    (system) => view.chosen.includes(system.kind) || system.instances > 0,
  )
  const current = tabs.find((system) => system.kind === asked)?.kind ?? tabs[0]?.kind

  function select(kind: string) {
    setPicked(kind)
    const url = new URL(window.location.href)
    url.searchParams.set('system', kind)
    window.history.replaceState(null, '', url)
  }

  return (
    <div className="grid gap-8 pt-2" data-testid="integration-panel">
      <LiveRefresh active={view.instances.some((instance) => instance.activeJob !== null)} />
      {view.canManage ? null : (
        <p
          className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
          data-testid="read-only"
        >
          {t('readOnly')}
        </p>
      )}
      <SystemsPicker systems={view.systems} chosen={view.chosen} canManage={view.canManage} />

      {current === undefined ? (
        <Empty className="min-h-48" data-testid="systems-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t('tabs.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('tabs.empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs value={current} onValueChange={select} className="gap-6">
          <TabsList
            aria-label={t('tabs.label')}
            className="max-w-full justify-start overflow-x-auto"
          >
            {tabs.map((system) => (
              <TabsTrigger key={system.kind} value={system.kind} data-testid="system-tab-trigger">
                {system.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((system) => (
            <TabsContent key={system.kind} value={system.kind}>
              <SystemTab
                system={system}
                instances={view.instances.filter((instance) => instance.kind === system.kind)}
                canManage={view.canManage}
                sealReady={view.sealReady}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}
