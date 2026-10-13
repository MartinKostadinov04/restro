// The warnings that need action, under the venue header on every tab (D97), a server component:
// a publish V11 held (approve or reject, one banner per menu that has one), the pause after a
// return to an older version ("Resume"), and the address switched off (D86: "publish to put it
// back"). Only what applies is shown (D96). It reads the page's one publish state
// (`venuePublishState`: the held rows, the pause and the address check), which the Publish bar
// shares; its buttons press through the header's publisher.
import { venuePublishState } from '@/server/publish/summary'
import { publishBlock, targetOf } from '@/server/publish/view'

import { AddressOffBanner } from './address-off-banner'
import { HeldBanner } from './held-banner'
import { PausedBanner } from './paused-banner'

export async function VenueWarnings({
  tenantId,
  venueId,
  canPublish,
}: {
  tenantId: string
  venueId: string
  /** Owner or admin: the banners' buttons are theirs. */
  canPublish: boolean
}) {
  const state = await venuePublishState(tenantId, venueId)
  const several = state.menus.length > 1
  const held = state.menus.flatMap((menu) => (menu.held === null ? [] : [{ menu, held: menu.held }]))
  if (held.length === 0 && !state.paused && state.addressServed) return null
  return (
    <div className="grid gap-3" data-testid="venue-warnings">
      {held.map(({ menu, held: hold }) => (
        <HeldBanner
          key={hold.snapshotId}
          held={hold}
          menuId={menu.menuId}
          menu={several ? menu.name : null}
          canPublish={canPublish}
          canPublishNow={
            publishBlock(
              targetOf(menu, { canPublish, paused: state.paused, addressServed: state.addressServed }),
              false,
            ) === null
          }
        />
      ))}
      {state.paused ? <PausedBanner venueId={venueId} canPublish={canPublish} /> : null}
      {state.addressServed ? null : <AddressOffBanner />}
    </div>
  )
}
