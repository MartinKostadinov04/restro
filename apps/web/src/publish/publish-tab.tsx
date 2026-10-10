// The Publish tab, a server component (U4): it reads everything the tab shows in one go and hands
// the cards plain data. Nothing here writes; the writes are the server actions in
// server/publish/actions.ts. Who may act is decided from the person's role in the organisation,
// here for what to draw and again in every action for what to allow.
import type { Venue } from '@restro/db'

import { getPool } from '@/server/db'
import { loadPublishView } from '@/server/publish/load'
import { canPublishMenu } from '@/server/roles'

import { PublishPanel } from './publish-panel'

export async function PublishTab({
  tenantId,
  role,
  venue,
}: {
  tenantId: string
  role: string
  venue: Venue
}) {
  const view = await loadPublishView({
    pool: getPool(),
    tenantId,
    venue: { id: venue.id, slug: venue.slug, timezone: venue.timezone },
    canPublish: canPublishMenu(role),
  })
  return <PublishPanel view={view} />
}
