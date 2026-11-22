'use client'

// The tabs of Tonight (#86): Actions and tables, Sent orders, Log, End of night, mirrored in the
// URL as `?view=` beside `?tab=tonight`. From 1024 px a tab bar; below it the section switch is a
// dropdown drawn in the open section's own heading row ("Tonight [Actions and tables ▾]", S2), so
// a phone spends no row on a chooser of its own. A section drawn without that heading (a failed
// read, no access, the loading skeleton) still gets the switch, on a row above it, so a phone is
// never stuck in one section: the row hides itself by CSS wherever a heading holds the switch, so
// nothing moves when the page hydrates. Every tab and the switch are 44 px high (S11). The
// Log and the end of the night are listed only for roles that may open them (the server passes the
// list), so a role never sees a tab it cannot use.
import { ClipboardListIcon, ConciergeBellIcon, HistoryIcon, MoonIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { useUrlTab } from '@/components/admin/workspace-tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { SectionSwitch } from './tab-parts'
import { TonightSkeleton } from './tonight-skeleton'
import { isTonightView, type TonightViewName } from './tonight-views'

/** What each view's tab shows. */
const TABS = {
  actions: { labelKey: 'tab_act', icon: ConciergeBellIcon },
  sent: { labelKey: 'tab_sent', icon: ClipboardListIcon },
  log: { labelKey: 'tab_log', icon: HistoryIcon },
  night: { labelKey: 'tab_night', icon: MoonIcon },
} as const satisfies Record<TonightViewName, { labelKey: string; icon: unknown }>

export function TonightTabs({
  views,
  contents,
}: {
  /** The views this role may open, in order; the first is where Tonight opens. */
  views: readonly TonightViewName[]
  /** The content of the view that is open (the server read it); the others show a skeleton. */
  contents: Partial<Record<TonightViewName, ReactNode>>
}) {
  const t = useTranslations('tonight')
  const first = views[0] ?? 'actions'
  const [current, select] = useUrlTab<TonightViewName>(
    'view',
    (requested) => (isTonightView(requested) && views.includes(requested) ? requested : first),
    (value): value is TonightViewName => isTonightView(value) && views.includes(value),
  )
  // One section is no choice: there is nothing to switch.
  const switcher =
    views.length > 1 ? (
      <Select value={current} onValueChange={select}>
        <SelectTrigger
          className="h-11 min-w-0 max-w-full lg:hidden"
          aria-label={t('tabs_label')}
          data-testid="tonight-section-switch"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {views.map((value) => {
            const { labelKey, icon: Icon } = TABS[value]
            return (
              <SelectItem key={value} value={value} className="min-h-11">
                <Icon aria-hidden />
                {t(labelKey)}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    ) : null
  return (
    <SectionSwitch.Provider value={switcher}>
      <Tabs value={current} onValueChange={select}>
        {views.length > 1 ? (
          // Each tab sizes to its own name (no equal split that squeezes a long one). Start-aligned so a row
          // wider than the screen scrolls from the first tab; no vertical scroll for the triggers' hidden underline.
          <TabsList
            className="hidden max-w-full justify-start overflow-x-auto overflow-y-hidden group-data-[orientation=horizontal]/tabs:h-auto lg:inline-flex"
            aria-label={t('tabs_label')}
            data-testid="tonight-section-tabs"
          >
            {views.map((value) => {
              const { labelKey, icon: Icon } = TABS[value]
              return (
                <TabsTrigger key={value} value={value} className="h-11 min-w-11 flex-none">
                  <Icon aria-hidden />
                  {t(labelKey)}
                </TabsTrigger>
              )
            })}
          </TabsList>
        ) : null}
        {views.map((value) => (
          <TabsContent key={value} value={value} className="group/section pt-2">
            {switcher === null ? null : (
              <div
                className="mb-3 lg:hidden group-has-[[data-tonight-heading]]/section:hidden"
                data-testid="tonight-switch-row"
              >
                {switcher}
              </div>
            )}
            {contents[value] ?? <TonightSkeleton />}
          </TabsContent>
        ))}
      </Tabs>
    </SectionSwitch.Provider>
  )
}
