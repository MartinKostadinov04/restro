// The Tables & QR tab, a server component (U4): it reads the venue's tables and draws their QR codes
// in one go and hands the panel plain data. Nothing here writes; the writes are the server actions
// in server/tables/actions.ts. Who may change things is decided from the person's role, here for
// what to draw and again in every action for what to allow. The codes it draws are revealed by the
// worker in one batch for the signed-in person (#70): only an owner or admin is asked for.
import type { Venue } from '@restro/db'

import { getPool } from '@/server/db'
import { defaultQrBaseUrl } from '@/server/env'
import { type RevealActor, revealConfig, revealFor } from '@/server/reveal'
import { canManageIntegration } from '@/server/roles'
import { loadTablesView } from '@/server/tables/service'

import { TablesPanel } from './tables-panel'

export async function TablesTab({
  tenantId,
  role,
  venue,
  actor,
}: {
  tenantId: string
  role: string
  venue: Venue
  actor: RevealActor
}) {
  const view = await loadTablesView(
    { pool: getPool(), tenantId, venue, canManage: canManageIntegration(role), actor },
    defaultQrBaseUrl(),
    undefined,
    revealFor(revealConfig(), { tenantId, venueId: venue.id, actor }),
  )
  return <TablesPanel view={view} />
}
