// loadItemDocument(): the menu document plus one item that may sit outside it. `loadMenuDocument`
// reaches an item only through the placements of the menu's sections, so an item placed nowhere
// (new from the till and not yet sorted, or taken out of every section) is not in it. The item sheet
// opens such items too, and shows their values and issues, so this adds the item's own subtree
// (the item, its modifier groups and options with their values and links) to the document.
// Read side only: it runs in READ ONLY transactions (`withTenant`).
//
// The item is added to a copy of the document read a moment before; the two reads are not one
// snapshot of the database, which does not matter for an editor that re-reads after each save.

import { type DbPool, withTenant } from '@restro/db'
import { sql } from 'drizzle-orm'

import type { Layer, Scope, Source } from '../change-set'
import type { MenuDocument } from '../document/types'
import { isId, type NodeId } from '../ids'
import type { NodeStatus, NodeType } from '../node-types'
import { loadMenuDocument } from './load-document'

/** The item asked for does not exist in this tenant, or is not an item. */
export class ItemNotFoundError extends Error {
  override name = 'ItemNotFoundError'
  readonly code = 'item_not_found'

  constructor(itemId: string) {
    super(`this tenant has no item ${itemId}`)
  }
}

interface SubtreeRow {
  nodes: {
    id: string
    type: string
    parentId: string | null
    status: string
    revision: number
    sortKey: string | null
  }[]
  values: {
    nodeId: string
    fieldKey: string
    layer: string
    scope: string
    value: unknown
    valueHash: string
    source: string
    observedAt: string
    basis: unknown
    valid: boolean
  }[]
  links: { nodeId: string; source: string; externalType: string; state: string }[]
}

/**
 * Reads a menu's document and makes sure it holds the item `itemId`, placed or not. Throws
 * `ItemNotFoundError` when the id is not an item of this tenant, and `ApplyError`
 * (`menu_not_found`) when the menu is not.
 */
export async function loadItemDocument(
  pool: DbPool,
  tenantId: string,
  menuId: string,
  itemId: string,
): Promise<MenuDocument> {
  if (!isId('nd', itemId)) throw new ItemNotFoundError(itemId)
  const doc = await loadMenuDocument(pool, tenantId, menuId)
  const known = doc.nodes.find((node) => node.id === itemId)
  if (known) {
    if (known.type !== 'item') throw new ItemNotFoundError(itemId)
    return doc
  }

  const venueId = doc.menu.venueId
  const result = await withTenant(pool, tenantId, (tx) =>
    tx.execute<Record<keyof SubtreeRow, unknown>>(sql`
      with recursive sub (id) as (
        select id from restro.nodes where id = ${itemId} and node_type = 'item'
        union
        select n.id from restro.nodes n join sub s on n.parent_id = s.id
      )
      select
        coalesce((
          select json_agg(json_build_object(
              'id', n.id, 'type', n.node_type, 'parentId', n.parent_id,
              'status', n.status, 'revision', n.revision, 'sortKey', n.sort_key)
            order by n.id collate "C")
          from restro.nodes n where n.id in (select id from sub)
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
          where v.node_id in (select id from sub)
            and (v.scope = 'master' or v.scope = ${`venue:${venueId}`})
        ), '[]'::json) as values,
        coalesce((
          select json_agg(json_build_object(
              'nodeId', l.node_id, 'source', 'till:' || l.integration_id,
              'externalType', l.external_type, 'state', l.state)
            order by l.node_id collate "C", l.integration_id collate "C",
              l.external_type collate "C")
          from restro.source_links l
          join restro.integrations i on i.id = l.integration_id
          where l.node_id in (select id from sub)
        ), '[]'::json) as links`),
  )
  const row = result.rows[0] as SubtreeRow | undefined
  if (!row || row.nodes.length === 0) throw new ItemNotFoundError(itemId)

  return {
    menu: doc.menu,
    nodes: [
      ...doc.nodes,
      ...row.nodes.map((node) => ({
        id: node.id as NodeId,
        type: node.type as NodeType,
        parentId: node.parentId as NodeId | null,
        status: node.status as NodeStatus,
        revision: node.revision,
        sortKey: node.sortKey,
      })),
    ],
    placements: doc.placements,
    values: [
      ...doc.values,
      ...row.values.map((value) => ({
        nodeId: value.nodeId as NodeId,
        fieldKey: value.fieldKey,
        layer: value.layer as Layer,
        scope: value.scope as Scope,
        value: value.value,
        valueHash: value.valueHash,
        source: value.source as Source,
        observedAt: new Date(value.observedAt).toISOString(),
        basis: value.basis ?? null,
        valid: value.valid,
      })),
    ],
    links: [
      ...doc.links,
      ...row.links.map((link) => ({
        nodeId: link.nodeId as NodeId,
        source: link.source as Source,
        externalType: link.externalType,
        state: link.state as 'active' | 'missing' | 'deleted',
      })),
    ],
  }
}
