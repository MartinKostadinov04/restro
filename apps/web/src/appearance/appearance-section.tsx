// The Appearance card with its data, for the Settings tab (server component): the saved look and a
// link to the saved logo, read inside the person's tenant. The card edits only when the role may.
import type { Venue } from '@restro/db'
import { loadAppearance } from '@/server/appearance/service'
import { getAssetStore } from '@/server/assets'
import { getPool } from '@/server/db'
import { canManageIntegration } from '@/server/roles'

import { AppearanceCard } from './appearance-card'

export async function AppearanceSection({
  tenantId,
  role,
  venue,
}: {
  tenantId: string
  role: string | null | undefined
  venue: Venue
}) {
  const initial = await loadAppearance(getPool(), tenantId, venue, getAssetStore)
  return (
    <AppearanceCard venueId={venue.id} initial={initial} canEdit={canManageIntegration(role)} />
  )
}
