// Settings › Hours and › Ordering, a server component (U4, #87): it reads the venue's saved
// ordering settings and hands the panel plain data. Nothing here writes; the write is the server
// action in server/settings/ordering-actions.ts, which the service write path checks again.
import type { Venue } from '@restro/db'

import { loadOrderingView } from '@/server/settings/ordering-view'

import { HoursPanel } from './hours-panel'
import { OrderingPanel } from './ordering-panel'
import { SectionFailed } from './section-notices'

export async function OrderingSection({
  tenantId,
  venue,
  part,
  hasPos,
  canChange,
  canEditLegal,
  email,
}: {
  tenantId: string
  venue: Venue
  part: 'hours' | 'ordering'
  hasPos: boolean
  canChange: boolean
  /** Holds `settings.connect_payments`: may save the venue's legal details on Ordering (#288). */
  canEditLegal: boolean
  email: string
}) {
  const view = await loadOrderingView({
    tenantId,
    venue,
    hasPos,
    canChange,
    canEditLegal,
    email,
  }).catch(() => null)
  if (view === null) return <SectionFailed what="settings" />
  return part === 'hours' ? <HoursPanel view={view} /> : <OrderingPanel view={view} />
}
