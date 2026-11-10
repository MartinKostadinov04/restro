// The Reservations tab, a server component (U4): it reads the open view through the service read
// side as the signed-in account (a shared device's account sees what Staff see, a person's session
// what their role holds) and hands the screen plain data. Nothing here writes; the writes are
// their own tickets' server actions, which `applyService` checks again.
//
// The views: the night's list (#326), the floor plan (#327) and the venue's guests (#333). Only
// the view that is open is read, so opening Reservations on the plan does not read the night's
// list as well.
import type { Venue } from '@restro/db'
import { getTranslations } from 'next-intl/server'

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  loadFloorPlan,
  loadGuestList,
  loadReservationNight,
  type RvScope,
} from '@/server/reservations/load'

import { FloorPlan } from './floor-plan'
import { GuestsView } from './guests-view'
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
  email,
  sessionId,
  view,
  day,
  guest,
}: {
  tenantId: string
  venue: Venue
  userId: string
  /** The signed-in person's: an erasure asks for the password again (D122 §7). */
  email: string
  sessionId: string
  /** `?view=`: which of the Reservations screens is open. */
  view?: string | undefined
  /** `?day=`: the night shown; absent is always the venue's own tonight. */
  day?: string | undefined
  /** `?guest=`: the guest's card to open on Guests (a reservation's sheet links to it). */
  guest?: string | undefined
}) {
  const t = await getTranslations('reservations')
  const scope: RvScope = {
    tenantId,
    venue,
    actor: { kind: 'user', userId, sessionId },
  }
  const noAccess = (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>{t('noAccess')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
  const views: readonly ReservationViewName[] = RESERVATION_VIEW_NAMES
  const open: ReservationViewName = isReservationView(view) && views.includes(view) ? view : 'list'
  if (open === 'plan') {
    const read = await loadFloorPlan(scope, day === undefined ? {} : { day })
    if (!read.ok) return noAccess
    return (
      <ReservationsTabs
        views={views}
        contents={{
          plan: <FloorPlan key={read.plan.day} initial={read.plan} frame={read.frame} />,
        }}
      />
    )
  }
  if (open === 'guests') {
    const read = await loadGuestList(scope)
    if (!read.ok) return noAccess
    return (
      <ReservationsTabs
        views={views}
        contents={{
          guests: (
            <GuestsView initial={read.guests} frame={read.frame} email={email} openGuest={guest} />
          ),
        }}
      />
    )
  }
  const result = await loadReservationNight(scope, day === undefined ? {} : { day })
  if (!result.ok) return noAccess
  const content = <NightList key={result.night.day} initial={result.night} frame={result.frame} />
  return <ReservationsTabs views={views} contents={{ [open]: content }} />
}
