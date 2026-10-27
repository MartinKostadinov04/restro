// Settings › Staff and roles, a server component (U4, #87): it reads the venue's roles, people and
// shared devices as the signed-in account and hands the panel plain data. Nothing here writes; the
// writes are the server actions in server/settings/staff-actions.ts, which the service write path
// checks again.
import type { Venue } from '@restro/db'

import { loadStaffView } from '@/server/settings/staff-view'

import { SectionFailed } from './section-notices'
import { StaffPanel } from './staff-panel'

export async function StaffSection({
  tenantId,
  venue,
  userId,
  sessionId,
  email,
  held,
}: {
  tenantId: string
  venue: Venue
  userId: string
  sessionId: string
  email: string
  held: Parameters<typeof loadStaffView>[0]['held']
}) {
  const view = await loadStaffView({
    tenantId,
    venueId: venue.id,
    venueName: venue.name,
    userId,
    sessionId,
    email,
    held,
  })
  if (view === null) return <SectionFailed what="staff" />
  return <StaffPanel view={view} />
}
