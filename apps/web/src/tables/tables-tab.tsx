// The Tables & QR tab, a server component (U4): it reads the venue's tables and draws their QR codes
// in one go and hands the panel plain data. Nothing here writes; the writes are the server actions
// in server/tables/actions.ts. Who may change things is decided from the person's role, here for
// what to draw and again in every action for what to allow.
import type { Venue } from '@restro/db'

import { getPool } from '@/server/db'
import { defaultQrBaseUrl } from '@/server/env'
import { canManageIntegration } from '@/server/roles'
import { loadTablesView } from '@/server/tables/service'

import { TablesPanel } from './tables-panel'

export async function TablesTab({
  tenantId,
  role,
  venue,
}: {
  tenantId: string
  role: string
  venue: Venue
}) {
  const view = await loadTablesView(
    { pool: getPool(), tenantId, venue, canManage: canManageIntegration(role) },
    defaultQrBaseUrl(),
  )
  return <TablesPanel view={view} />
}
