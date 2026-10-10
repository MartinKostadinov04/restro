// loadMenusUsingAsset(): which menus (and venues) a stored picture is part of. The worker asks
// when a picture's webp variants have just been made, to publish the menus whose snapshot can
// show it now (S3-04). Server-only read side, one READ ONLY transaction, one SQL statement.
//
// A menu uses a picture when an `image` field value in ANY layer or scope names it, on a node the
// menu reaches: a section under the menu's root, an item placed in one of those sections (or a
// section deeper down), or an option or group of such an item. An item placed nowhere belongs to
// no menu: a snapshot cannot show it.

import { type DbPool, withTenant } from '@restro/db'
import { sql } from 'drizzle-orm'

import { isId } from '../ids'

/** A menu that uses a picture, with the venue it is for. */
export interface MenuUsingAsset {
  /** The menu's `nd_` id. */
  readonly menuId: string
  /** OUR venue (`vn_`). */
  readonly venueId: string
}

/** The menus of the tenant that use the stored picture `assetId`, by menu id. Empty for an unknown id. */
export async function loadMenusUsingAsset(
  pool: DbPool,
  tenantId: string,
  assetId: string,
): Promise<MenuUsingAsset[]> {
  if (!isId('as', assetId)) return []
  const result = await withTenant(pool, tenantId, (tx) =>
    tx.execute<{ menu_id: string; venue_id: string }>(sql`
      with recursive
      using_nodes (id) as (
        select distinct v.node_id from restro.field_values v
        where v.field_key = 'image'
          and jsonb_typeof(v.value) = 'object'
          and v.value ->> 'asset_id' = ${assetId}
      ),
      -- Who contains whom: a child under its parent, an item in its section.
      edges (child, parent) as (
        select n.id, n.parent_id from restro.nodes n where n.parent_id is not null
        union
        select p.item_id, p.section_id from restro.placements p
      ),
      climb (id) as (
        select id from using_nodes
        union
        select e.parent from climb c join edges e on e.child = c.id
      )
      select m.id as menu_id, m.venue_id
      from restro.menus m
      where m.root_node_id in (select id from climb)
      order by m.id collate "C"`),
  )
  return result.rows.map((row) => ({ menuId: row.menu_id, venueId: row.venue_id }))
}
