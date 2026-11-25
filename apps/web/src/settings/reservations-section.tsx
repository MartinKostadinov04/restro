// Settings › Reservations, a server component (#325): it reads the venue's reservation rules, its
// one-off closed dates and its spots with their seats, and hands the panel plain data. Nothing here
// writes; the writes are the server actions in server/settings/reservations-actions.ts, which the
// service write path checks again.
import type { Venue } from '@restro/db'

import { loadReservationsView } from '@/server/settings/reservations-view'

import { ReservationsPanel } from './reservations-panel'
import { SectionFailed } from './section-notices'

export async function ReservationsSection({
  tenantId,
  venue,
  canChange,
  email,
}: {
  tenantId: string
  venue: Venue
  /** Holds `settings.reservations`: otherwise the section is read-only. */
  canChange: boolean
  email: string
}) {
  const view = await loadReservationsView({ tenantId, venue, canChange, email }).catch(() => null)
  if (view === null) return <SectionFailed what="settings" />
  return <ReservationsPanel view={view} />
}
