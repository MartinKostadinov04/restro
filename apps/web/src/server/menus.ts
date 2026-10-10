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
