// The Menu source card of a venue's Settings tab, a server component (U4): it reads everything the
// card shows in one go and hands it plain data. Nothing here writes; the writes are the server
// actions in server/integration/actions.ts. Who may change things is decided from the person's
// role in the organisation, here for what to draw and again in every action for what to allow.
import type { Venue } from '@restro/db'

import { getPool } from '@/server/db'
import { loadMenuSourceView } from '@/server/integration/service'
import { canManageIntegration } from '@/server/roles'

import { MenuSourceCard } from './menu-source-card'

export async function MenuSourceTab({
  tenantId,
  role,
  venue,
}: {
  tenantId: string
  role: string
  venue: Venue
}) {
  const view = await loadMenuSourceView({
    pool: getPool(),
    tenantId,
    venue: { id: venue.id, name: venue.name, timezone: venue.timezone },
    canManage: canManageIntegration(role),
  })
  return <MenuSourceCard venueId={venue.id} view={view} />
}
