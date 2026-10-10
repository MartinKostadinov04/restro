// New items held for review (brief S3-04; setting `publish.new_items = hold`). After a pull has
// applied, the sync hides every item that pull created, so that a manager looks at it before
// guests do. The hide is the builder's own: `visible = false` in the manual layer, which only
// ever makes the menu more cautious (rule 5), and which "Show" clears like any other hide.
//
// What marks such an item as "new from barsy, hidden until you show it" is who wrote the hide:
// the actor `system`. A person's hide carries their own `user:<id>`. The composer reads the
// marker with `loadHeldNewItemIds`; the sync writes it with `heldNewItemOps`.

import { type DbPool, fieldValues, withTenant } from '@restro/db'
import { and, eq, sql } from 'drizzle-orm'

import type { Actor, ChangeSetOp } from '../change-set'
import type { NodeId } from '../ids'

/** The actor of the hide the sync writes for a new item. */
export const HELD_NEW_ACTOR: Actor = 'system'

/** The ops that hide `itemIds` in the manual layer (master scope): `visible = false`. */
export function heldNewItemOps(itemIds: readonly NodeId[]): ChangeSetOp[] {
  return itemIds.map((id) => ({
    op: 'setField',
    node: { id },
    fieldKey: 'visible',
    layer: 'manual',
    scope: 'master',
    value: false,
  }))
}

/**
 * The items of the tenant whose manual hide was written by the sync (still in place: showing the
 * item clears the value, and a person who hides it again writes their own).
 */
export async function loadHeldNewItemIds(pool: DbPool, tenantId: string): Promise<NodeId[]> {
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ nodeId: fieldValues.nodeId })
      .from(fieldValues)
      .where(
        and(
          eq(fieldValues.fieldKey, 'visible'),
          eq(fieldValues.layer, 'manual'),
          eq(fieldValues.scope, 'master'),
          eq(fieldValues.actor, HELD_NEW_ACTOR),
          sql`${fieldValues.value} = 'false'::jsonb`,
        ),
      ),
  )
  return rows.map((row) => row.nodeId as NodeId)
}
