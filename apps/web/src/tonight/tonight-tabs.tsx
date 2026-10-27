'use client'

// The tabs of Tonight (#86): Actions and tables, Sent orders, Log, End of night. The same bar as
// the venue's own tabs (UrlTabs: a tab bar from 1024 px, a dropdown below), mirrored in the URL as
// `?view=` beside `?tab=tonight`. The Log and the end of the night are listed only for roles that
// may open them (the server passes the list), so a role never sees a tab it cannot use.
import { ClipboardListIcon, ConciergeBellIcon, HistoryIcon, MoonIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { UrlTabs, useUrlTab } from '@/components/admin/workspace-tabs'

import { TonightSkeleton } from './tonight-skeleton'
import { isTonightView, type TonightViewName } from './tonight-views'

/** What each view's tab shows. */
const TABS = {
  actions: { labelKey: 'tonight.tab_act', icon: ConciergeBellIcon },
  sent: { labelKey: 'tonight.tab_sent', icon: ClipboardListIcon },
  log: { labelKey: 'tonight.tab_log', icon: HistoryIcon },
  night: { labelKey: 'tonight.tab_night', icon: MoonIcon },
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
  const defs = views.map((value) => ({ value, ...TABS[value] }))
  const filled = Object.fromEntries(
    views.map((value) => [value, contents[value] ?? <TonightSkeleton />]),
  ) as Partial<Record<TonightViewName, ReactNode>>
  return (
    <UrlTabs
      defs={defs}
      current={current}
      select={select}
      contents={filled}
      label={t('tabs_label')}
      listClassName="hidden lg:inline-flex"
    />
  )
}
