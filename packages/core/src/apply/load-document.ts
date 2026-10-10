// loadMenuDocument(): the read side of the document, as the resolver consumes it (`MenuDocument`,
// pure, in ../document/types.ts). Server-only, like everything under @restro/core/apply, but it
// only reads: it runs in a READ ONLY transaction (`withTenant`).
//
// The menu's document is what its root reaches: sections (and specials) through parent_id, items
// through the placements of those sections, modifier groups and options through parent_id again.
// An item placed in no section of this menu is not part of it. Values are those of these nodes in
// the master scope and this menu's venue scope (other venues' prices are left out); rejected rows
// (`valid = false`) are included for the editor's Data issues panel and the resolver skips them.
// Links carry their source and state only: never an external id (rule 3).
//
// One SQL statement, so the whole document comes from one snapshot of the database even while a
// change set commits.

import { type DbPool, withTenant } from '@restro/db'
import { sql } from 'drizzle-orm'

import type { MenuDocument } from '../document/types'
import { isId, type NodeId } from '../ids'
import { ApplyError } from './apply'
import { type DocumentPartRows, documentPartsFromRows } from './document-rows'

interface DocumentRow extends DocumentPartRows {
  menu: {
    id: string
    venue_id: string
    template_key: string
    template_version: number
    root_node_id: string
  } | null
  placements: { itemId: string; sectionId: string; sortKey: string }[]
}

/**
 * Reads one menu's document for the resolver and the composer. Throws `ApplyError` with code
 * `menu_not_found` when the tenant has no such menu.
 */
export async function loadMenuDocument(
  pool: DbPool,
  tenantId: string,
  menuId: string,
): Promise<MenuDocument> {
  if (!isId('nd', menuId)) {
    throw new ApplyError('menu_not_found', 'a menu id is the nd_ id of its root node')
  }
  const result = await withTenant(pool, tenantId, (tx) =>
    tx.execute<Record<keyof DocumentRow, unknown>>(sql`
      with recursive
      menu as (
        select id, venue_id, template_key, template_version, root_node_id
        from restro.menus where id = ${menuId}
      ),
      edges (from_id, to_id) as (
        select parent_id, id from restro.nodes where parent_id is not null
        union all
        select section_id, item_id from restro.placements
      ),
      reach (id) as (
        select root_node_id from menu
        union
        select e.to_id from edges e join reach r on e.from_id = r.id
      )
      select
        (select row_to_json(m) from menu m) as menu,
        coalesce((
          select json_agg(json_build_object(
              'id', n.id, 'type', n.node_type, 'parentId', n.parent_id,
              'status', n.status, 'revision', n.revision, 'sortKey', n.sort_key)
            order by n.id collate "C")
          from restro.nodes n where n.id in (select id from reach)
        ), '[]'::json) as nodes,
        coalesce((
          select json_agg(json_build_object(
              'itemId', p.item_id, 'sectionId', p.section_id, 'sortKey', p.sort_key)
            order by p.section_id collate "C", p.sort_key, p.item_id collate "C")
          from restro.placements p where p.section_id in (select id from reach)
        ), '[]'::json) as placements,
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
  const row = result.rows[0] as DocumentRow | undefined
  if (!row?.menu) throw new ApplyError('menu_not_found', `this tenant has no menu ${menuId}`)
  const { menu } = row
  return {
    menu: {
      id: menu.id as NodeId,
      venueId: menu.venue_id,
      templateKey: menu.template_key,
      templateVersion: menu.template_version,
      rootNodeId: menu.root_node_id as NodeId,
    },
    ...documentPartsFromRows(row),
    placements: row.placements.map((placement) => ({
      itemId: placement.itemId as NodeId,
      sectionId: placement.sectionId as NodeId,
      sortKey: placement.sortKey,
    })),
  }
}
