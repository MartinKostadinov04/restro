// Menu reads for the composer. Like venues.ts, every query runs inside `withTenant`: row-level
// security shows only the signed-in organisation's rows, even if a `where` clause is forgotten.
// Reads only; every write goes through core's apply() (rule 1).
import { isId } from '@restro/core'
import { menus, nodes, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import { getPool } from './db'

/** The menu of a venue (its id is its root node's id), or null if the venue has none yet. */
export async function getVenueMenuId(tenantId: string, venueId: string): Promise<string | null> {
  if (!isId('vn', venueId)) return null
  const rows = await withTenant(getPool(), tenantId, (tx) =>
    tx.select({ id: menus.id }).from(menus).where(eq(menus.venueId, venueId)).limit(1),
  )
  return rows[0]?.id ?? null
}

/** The type and status of one node of the tenant, or null (also for another tenant's node). */
export async function getNodeBasics(
  tenantId: string,
  nodeId: string,
): Promise<{ type: string; status: string } | null> {
  if (!isId('nd', nodeId)) return null
  const rows = await withTenant(getPool(), tenantId, (tx) =>
    tx
      .select({ type: nodes.nodeType, status: nodes.status })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1),
  )
  return rows[0] ?? null
}

/** How many parent steps up from a section to its menu we follow (sections nest three deep). */
const MAX_PARENT_STEPS = 8

/**
 * True when the node sits in this menu: the menu itself, or a node whose chain of parents ends at
 * the menu's root. Items have no parent (they belong to a menu through a placement), so this
 * answers for sections. False for another tenant's node or another menu's (row-level security
 * hides what is not the tenant's), and for a node that does not exist.
 */
export async function isNodeInMenu(
  tenantId: string,
  menuId: string,
  nodeId: string,
): Promise<boolean> {
  if (!isId('nd', menuId) || !isId('nd', nodeId)) return false
  return withTenant(getPool(), tenantId, async (tx) => {
    let current: string | null = nodeId
    for (let step = 0; step <= MAX_PARENT_STEPS && current !== null; step += 1) {
      if (current === menuId) return true
      const rows: { parentId: string | null }[] = await tx
        .select({ parentId: nodes.parentId })
        .from(nodes)
        .where(eq(nodes.id, current))
        .limit(1)
      current = rows[0]?.parentId ?? null
    }
    return false
  })
}
