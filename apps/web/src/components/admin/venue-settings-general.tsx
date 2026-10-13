// Settings › General of a venue (D97), a server component composing what exists: the venue's
// settings (name, address, languages), its menus with their bin (D88, D91), the Menu source card
// (S1) and, for an owner, the danger zone at the end. Nothing here writes; the cards' actions do.
import { MENU_BIN_DAYS } from '@restro/core'
import { listMenus } from '@restro/core/apply'
import type { Venue } from '@restro/db'
import { Suspense } from 'react'

import { MenuSourceSkeleton } from '@/integration/menu-source-skeleton'
import { MenuSourceTab } from '@/integration/menu-source-tab'
import { getPool } from '@/server/db'
import { canDeleteVenue, canManageIntegration } from '@/server/roles'

import { MenusCard, type MenuRow } from './menus-card'
import { VenueDangerZone } from './venue-danger-zone'
import { VenueSettings } from './venue-settings'

export async function VenueSettingsGeneral({
  tenantId,
  role,
  venue,
  hasTill,
}: {
  tenantId: string
  role: string
  venue: Venue
  hasTill: boolean
}) {
  const all = await listMenus(getPool(), tenantId, venue.id, { includeDeleted: true })
  const row = (menu: (typeof all)[number]): MenuRow => ({
    id: menu.id,
    name: menu.name,
    live: menu.live,
    deletedAt: menu.deletedAt,
  })
  const inUse = all.filter((menu) => menu.deletedAt === null).map(row)
  const deleted = all
    .filter((menu) => menu.deletedAt !== null)
    .sort((a, b) => ((a.deletedAt ?? '') < (b.deletedAt ?? '') ? 1 : -1))
    .map(row)

  return (
    <div className="grid gap-8" data-testid="settings-general">
      <VenueSettings venue={venue} role={role} />
      <MenusCard
        venueId={venue.id}
        venueName={venue.name}
        hasTill={hasTill}
        canManage={canManageIntegration(role)}
        menus={inUse}
        deleted={deleted}
        binDays={MENU_BIN_DAYS}
      />
      <Suspense fallback={<MenuSourceSkeleton />}>
        <MenuSourceTab tenantId={tenantId} role={role} venue={venue} />
      </Suspense>
      {/* The end of the tab (D76): only an owner deletes a venue; the action checks again. */}
      {canDeleteVenue(role) ? <VenueDangerZone venueId={venue.id} venueName={venue.name} /> : null}
    </div>
  )
}
