// Settings › Alerts, a server component (U4, #87): it reads who works at the venue, their devices,
// who is ticked and the venue's Telegram group, and hands the panel plain data. Nothing here
// writes; the writes are the server actions in server/settings/alerts-actions.ts, which the
// service write path checks again.
import type { Venue } from '@restro/db'

import { loadAlertsView } from '@/server/settings/alerts-view'

import { AlertsPanel } from './alerts-panel'
import { SectionFailed } from './section-notices'

export async function AlertsSection({
  tenantId,
  venue,
  email,
  canUnlinkPerson,
}: {
  tenantId: string
  venue: Venue
  email: string
  canUnlinkPerson: boolean
}) {
  const view = await loadAlertsView({ tenantId, venue, email, canUnlinkPerson }).catch(() => null)
  if (view === null) return <SectionFailed what="alerts" />
  return <AlertsPanel view={view} />
}
