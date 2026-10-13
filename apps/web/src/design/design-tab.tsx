// The Design tab, a server component (U4): it reads the venue's saved look, template and logo link,
// the open menu (`?menu=`, like Structure) and the guest services the venue switched on, in one go,
// and hands the panel plain data. Nothing here writes; the writes are the server actions in
// server/design/actions.ts, the guest-feature actions and the menus' rename. Who may change things
// is decided from the person's role, here for what to draw and again in every action for what to
// allow.
import { readGuestFeatures } from '@restro/core'
import type { Venue } from '@restro/db'

import { getAssetStore } from '@/server/assets'
import { composerMenusOf } from '@/server/composer/menu'
import { getPool } from '@/server/db'
import { loadDesign } from '@/server/design/service'

import { DesignPanel } from './design-panel'

export async function DesignTab({
  tenantId,
  role,
  venue,
  menu,
}: {
  tenantId: string
  role: string | null | undefined
  venue: Venue
  /** `?menu=`: the menu to preview and to name (else the live one). */
  menu?: unknown
}) {
  const [initial, { current }] = await Promise.all([
    loadDesign(getPool(), tenantId, venue, getAssetStore, role),
    composerMenusOf(tenantId, venue.id, menu),
  ])
  return (
    <DesignPanel
      venueId={venue.id}
      initial={initial}
      menu={current === null ? null : { id: current.id, name: current.name }}
      venueName={venue.name}
      features={readGuestFeatures(venue.settings)}
    />
  )
}
