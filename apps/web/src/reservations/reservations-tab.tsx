// The Reservations tab, a server component (U4): it reads the open view through the service read
// side as the signed-in account (a shared device's account sees what Staff see, a person's session
// what their role holds) and hands the screen plain data. Nothing here writes; the writes are
// their own tickets' server actions, which `applyService` checks again.
//
// The views (#326): the night's list today. The floor plan (#327) and Guests (#333) each add a
// name to `reservation-views.ts`, a tab to `reservations-tabs.tsx` and a branch here.
import type { Venue } from '@restro/db'
import { getTranslations } from 'next-intl/server'

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { loadReservationNight, type RvScope } from '@/server/reservations/load'

import { NightList } from './night-list'
import {
  isReservationView,
  RESERVATION_VIEW_NAMES,
  type ReservationViewName,
} from './reservation-views'
import { ReservationsTabs } from './reservations-tabs'

export async function ReservationsTab({
  tenantId,
  venue,
  userId,
  sessionId,
  view,
  day,
}: {
  tenantId: string
  venue: Venue
  userId: string
  sessionId: string
  /** `?view=`: which of the Reservations screens is open. */
  view?: string | undefined
  /** `?day=`: the night shown; absent is always the venue's own tonight. */
  day?: string | undefined
}) {
  const t = await getTranslations('reservations')
  const scope: RvScope = {
    tenantId,
    venue,
    actor: { kind: 'user', userId, sessionId },
  }
  const result = await loadReservationNight(scope, day === undefined ? {} : { day })
  if (!result.ok) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('title')}</EmptyTitle>
          <EmptyDescription>{t('noAccess')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const views: readonly ReservationViewName[] = RESERVATION_VIEW_NAMES
  const open: ReservationViewName = isReservationView(view) && views.includes(view) ? view : 'list'
  const content = <NightList key={result.night.day} initial={result.night} frame={result.frame} />
  return <ReservationsTabs views={views} contents={{ [open]: content }} />
}
