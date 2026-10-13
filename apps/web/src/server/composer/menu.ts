// Which menu the composer works on (D88, D90, D92; brief S6): a venue has several menus, and the
// composer edits the one its URL names (`?menu=`), else the live one, else the first. A binned
// menu is never offered nor edited. Reads only, through core's `listMenus` (row-level security
// shows only the signed-in organisation's rows).
import type { NodeId } from '@restro/core'
import { listMenus, type MenuSummary } from '@restro/core/apply'

import { getPool } from '@/server/db'

/** The venue's menus in use, in order, and the one the composer shows. */
export interface ComposerMenus {
  readonly menus: readonly MenuSummary[]
  /** The menu named in the URL if it is one of them, else the live one, else the first; null = none. */
  readonly current: MenuSummary | null
}

/** The menu `requested` names when it is one of the venue's menus in use, else the live one. */
export function pickMenu(menus: readonly MenuSummary[], requested: unknown): MenuSummary | null {
  return (
    menus.find((menu) => menu.id === requested) ??
    menus.find((menu) => menu.live) ??
    menus[0] ??
    null
  )
}

/** The venue's menus in use and the one the composer shows for `requested` (`?menu=`). */
export async function composerMenusOf(
  tenantId: string,
  venueId: string,
  requested: unknown,
): Promise<ComposerMenus> {
  const menus = await listMenus(getPool(), tenantId, venueId)
  return { menus, current: pickMenu(menus, requested) }
}

/**
 * The menu a composer write names, when it is one of the venue's menus in use (not binned, not
 * another venue's or organisation's); null otherwise.
 */
export async function menuInUse(
  tenantId: string,
  venueId: string,
  menuId: string,
): Promise<NodeId | null> {
  const menus = await listMenus(getPool(), tenantId, venueId)
  return menus.find((menu) => menu.id === menuId)?.id ?? null
}
