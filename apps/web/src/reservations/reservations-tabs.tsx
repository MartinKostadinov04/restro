'use client'

// The tabs of Reservations (#326): the night's list, the floor plan (#327) and Guests (#333). The same bar as the venue's own tabs and Tonight's (UrlTabs: a tab bar from
// 1024 px, a dropdown below), mirrored in the URL as `?view=` beside `?tab=reservations`. A view
// the role may not open is not listed, so nobody meets a tab they cannot use.
import { CalendarDaysIcon, LayoutGridIcon, UsersIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { UrlTabs, useUrlTab } from '@/components/admin/workspace-tabs'

import { isReservationView, type ReservationViewName } from './reservation-views'
import { ReservationsSkeleton } from './reservations-skeleton'

/** What each view's tab shows. */
const TABS = {
  // Beside a second view the night's list is "List": "Tonight" is what the night button says, and
  // the plan shows tonight too (#327's own string list).
  list: { labelKey: 'reservations.tab_view_list', icon: CalendarDaysIcon },
  plan: { labelKey: 'reservations.tab_plan', icon: LayoutGridIcon },
  guests: { labelKey: 'reservations.tab_guests', icon: UsersIcon },
} as const satisfies Record<ReservationViewName, { labelKey: string; icon: unknown }>

export function ReservationsTabs({
  views,
  contents,
}: {
  /** The views this role may open, in order; the first is where Reservations opens. */
  views: readonly ReservationViewName[]
  /** The content of the view that is open (the server read it); the others show a skeleton. */
  contents: Partial<Record<ReservationViewName, ReactNode>>
}) {
  const t = useTranslations('reservations')
  const first = views[0] ?? 'list'
  const [current, select] = useUrlTab<ReservationViewName>(
    'view',
    (requested) => (isReservationView(requested) && views.includes(requested) ? requested : first),
    (value): value is ReservationViewName => isReservationView(value) && views.includes(value),
  )
  const defs = views.map((value) => ({ value, ...TABS[value] }))
  const filled = Object.fromEntries(
    views.map((value) => [value, contents[value] ?? <ReservationsSkeleton />]),
  ) as Partial<Record<ReservationViewName, ReactNode>>
  return (
    <UrlTabs
      defs={defs}
      current={current}
      select={select}
      contents={filled}
      label={t('tabs_label')}
      // Three short words fit one row at 390 px, so the row stays a row at every width: a
      // dropdown would make opening the plan two taps, and the ticket's budget for it is one.
      oneRow
    />
  )
}
