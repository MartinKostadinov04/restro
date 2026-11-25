// The Tables & QR tab, a server component (U4): it reads the venue's tables and draws their QR codes
// in one go and hands the panel plain data. Nothing here writes; the writes are the server actions
// in server/tables/actions.ts. Who may change things is decided from the person's role, here for
// what to draw and again in every action for what to allow. It reveals no codes (#70): the panel
// asks the worker for them once the page is up, so the refresh after each action waits on no
// worker and writes no Log entry. Payment tables (the right to mark them, the bars still without
// one) are added to the view where a connector can take payments; the person's right is read here
// (`settings.payment_tables`, never on a shared device) and checked again by the command.
import type { Venue } from '@restro/db'

import { getPool } from '@/server/db'
import { defaultQrBaseUrl } from '@/server/env'
import { canManageIntegration } from '@/server/roles'
import { loadSettingsAccess } from '@/server/settings/access'
import { loadTablesView } from '@/server/tables/service'

import { TablesPanel } from './tables-panel'

export async function TablesTab({
  tenantId,
  role,
  venue,
  userId,
  sessionId,
  email,
}: {
  tenantId: string
  role: string
  venue: Venue
  userId: string
  sessionId: string
  /** The signed-in person's email, for the password again. */
  email: string
}) {
  const access = await loadSettingsAccess({ tenantId, venueId: venue.id, userId, sessionId })
  const view = await loadTablesView(
    {
      pool: getPool(),
      tenantId,
      venue,
      canManage: canManageIntegration(role),
      person: {
        canMarkPaymentTables:
          !access.sharedDevice && access.held.includes('settings.payment_tables'),
        email,
      },
    },
    defaultQrBaseUrl(),
  )
  return <TablesPanel view={view} />
}
