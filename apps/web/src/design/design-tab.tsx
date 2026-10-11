// The Design tab, a server component (U4): it reads the venue's saved look, template and logo link
// in one go and hands the panel plain data. Nothing here writes; the writes are the server actions
// in server/design/actions.ts. Who may change things is decided from the person's role, here for
// what to draw and again in every action for what to allow.
import type { Venue } from '@restro/db'

import { getAssetStore } from '@/server/assets'
import { getPool } from '@/server/db'
import { loadDesign } from '@/server/design/service'

import { DesignPanel } from './design-panel'

export async function DesignTab({
  tenantId,
  role,
  venue,
}: {
  tenantId: string
  role: string | null | undefined
  venue: Venue
}) {
  const initial = await loadDesign(getPool(), tenantId, venue, getAssetStore, role)
  return <DesignPanel venueId={venue.id} initial={initial} />
}
