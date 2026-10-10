// The Integration tab, a server component (U4): it reads everything the tab shows in one go and
// hands the cards plain data. Nothing here writes; the writes are the server actions in
// server/integration/actions.ts. Who may change things is decided from the person's role in the
// organisation, here for what to draw and again in every action for what to allow.
import type { Venue } from '@restro/db'

import { getPool } from '@/server/db'
import { serverEnv } from '@/server/env'
import { loadIntegrationView } from '@/server/integration/service'
import { canManageIntegration } from '@/server/roles'

import { IntegrationPanel } from './integration-panel'

export async function IntegrationTab({
  tenantId,
  role,
  venue,
}: {
  tenantId: string
  role: string
  venue: Venue
}) {
  const view = await loadIntegrationView(
    {
      pool: getPool(),
      tenantId,
      venue: { id: venue.id, name: venue.name, timezone: venue.timezone },
      canManage: canManageIntegration(role),
    },
    { sealPublicKey: serverEnv().SEAL_PUBLIC_KEY },
  )
  return <IntegrationPanel venueId={venue.id} view={view} />
}
