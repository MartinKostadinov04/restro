// Settings › Paying, a server component (U4, #116): it reads the venue's payment account, what is
// still missing and the owner's paying choices, and hands the panel plain data. Nothing here
// writes; the writes are the server actions in server/settings/paying-actions.ts, which the
// service write path checks again.
import type { Venue } from '@restro/db'

import { loadPayingView } from '@/server/settings/paying-view'

import { PayingPanel } from './paying-panel'
import { SectionFailed } from './section-notices'

export async function PayingSection({
  tenantId,
  venue,
  canConnect,
  email,
  connection,
}: {
  tenantId: string
  venue: Venue
  canConnect: boolean
  email: string
  /** `?connection=`: the provider's form sent the owner back (`return`), or its link ran out. */
  connection: 'return' | 'refresh' | undefined
}) {
  const view = await loadPayingView({ tenantId, venue, canConnect, email }).catch(() => null)
  if (view === null) return <SectionFailed what="settings" />
  return <PayingPanel view={view} connection={connection} />
}
