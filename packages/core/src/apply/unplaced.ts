// loadUnplacedItems(): the items of a tenant that appear in no section of one menu (the
// composer's "Unsorted" list). Server-only read side, like loadMenuDocument: one READ ONLY
// transaction, one SQL statement.
//
// An item has no parent: it is reached through the placements of a menu's sections, so an item
// that is placed nowhere is not part of `loadMenuDocument`'s result and the resolver never sees
// it. This returns those items with their modifier groups and options, values (master and the
// menu's venue scope, like the document) and links, as parts that `mergeDocumentParts`
// (../document/merge) adds to the document before resolving, so the composer can show them with
// the same provenance, visibility and issues as every other item (`unplaced_item` included).
// Archived items are left out. An item placed only in a section of another menu counts as
// unplaced here: "under this menu" is the question.

import { type DbPool, withTenant } from '@restro/db'
import { sql } from 'drizzle-orm'

import type { DocumentParts } from '../document/merge'
import { isId, type NodeId } from '../ids'
import { ApplyError } from './apply'
import { type DocumentPartRows, documentPartsFromRows } from './document-rows'

interface UnplacedRow extends DocumentPartRows {
  menu: { id: string } | null
  itemIds: string[]
}

/** The unplaced items of one menu, as parts of a document. */
export interface UnplacedItems extends DocumentParts {
  /** The unplaced items, oldest first. */
  readonly itemIds: readonly NodeId[]
}

/**
 * Items placed in no section under the menu, with their groups, options, values and links.
 * Throws `ApplyError` with code `menu_not_found` when the tenant has no such menu.
 */
export async function loadUnplacedItems(
  pool: DbPool,
  tenantId: string,
  menuId: string,
): Promise<UnplacedItems> {
  if (!isId('nd', menuId)) {
    throw new ApplyError('menu_not_found', 'a menu id is the nd_ id of its root node')
  }
  const result = await withTenant(pool, tenantId, (tx) =>
    tx.execute<Record<keyof UnplacedRow, unknown>>(sql`
      with recursive
      menu as (
        select id, venue_id, root_node_id from restro.menus where id = ${menuId}
      ),
      sections (id) as (
        select n.id from restro.nodes n, menu
        where n.parent_id = menu.root_node_id and n.node_type = 'section'
        union
        select n.id from restro.nodes n join sections s on n.parent_id = s.id
        where n.node_type = 'section'
      ),
      unplaced as (
        select n.id, n.created_at from restro.nodes n
        where n.node_type = 'item' and n.status <> 'archived'
          and exists (select 1 from menu)
          and not exists (
            select 1 from restro.placements p
            where p.item_id = n.id and p.section_id in (select id from sections))
      ),
      reach (id) as (
        select id from unplaced
        union
        select n.id from restro.nodes n join reach r on n.parent_id = r.id
      )
      select
        (select row_to_json(m) from menu m) as menu,
        coalesce((
          select json_agg(u.id order by u.created_at, u.id collate "C") from unplaced u
        ), '[]'::json) as "itemIds",
        coalesce((
          select json_agg(json_build_object(
              'id', n.id, 'type', n.node_type, 'parentId', n.parent_id,
              'status', n.status, 'revision', n.revision, 'sortKey', n.sort_key)
            order by n.id collate "C")
          from restro.nodes n where n.id in (select id from reach)
        ), '[]'::json) as nodes,
        coalesce((
          select json_agg(json_build_object(
              'nodeId', v.node_id, 'fieldKey', v.field_key, 'layer', v.layer,
              'scope', v.scope, 'value', v.value, 'valueHash', v.value_hash,
              'source', v.source, 'observedAt', v.observed_at, 'basis', v.basis,
              'valid', v.valid)
            order by v.node_id collate "C", v.field_key collate "C", v.layer collate "C",
              v.scope collate "C")
          from restro.field_values v
          where v.node_id in (select id from reach)
            and (v.scope = 'master' or v.scope = 'venue:' || (select venue_id from menu))
        ), '[]'::json) as values,
        coalesce((
          select json_agg(json_build_object(
              'nodeId', l.node_id, 'source', i.kind || ':' || l.integration_id,
              'externalType', l.external_type, 'state', l.state)
            order by l.node_id collate "C", l.integration_id collate "C",
              l.external_type collate "C")
          from restro.source_links l
          join restro.integrations i on i.id = l.integration_id
          where l.node_id in (select id from reach)
        ), '[]'::json) as links`),
  )
  const row = result.rows[0] as UnplacedRow | undefined
  if (!row?.menu) throw new ApplyError('menu_not_found', `this tenant has no menu ${menuId}`)
  return { itemIds: row.itemIds as NodeId[], ...documentPartsFromRows(row) }
}
