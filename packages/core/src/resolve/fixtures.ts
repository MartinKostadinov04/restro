// Test helpers for the resolver: a small builder for menu documents, so each test states only
// the rows it is about. Not exported from the package.

import type { Layer, Scope, Source } from '../change-set'
import type { MenuDocument } from '../document/types'
import { canonicalJson, sha256Hex } from '../hash'
import type { NodeId } from '../ids'
import type { Money } from '../money'
import type { NodeStatus, NodeType } from '../node-types'
import type { ResolveContext } from './types'

/** A valid id of `kind` built from a readable label (alphanumeric, at most 22 characters). */
export function testId<K extends string>(kind: K, label: string): `${K}_${string}` {
  if (!/^[0-9A-Za-z]{1,22}$/.test(label)) throw new Error(`bad label ${label}`)
  return `${kind}_${label.padStart(22, '0')}`
}

/** Node id from a label, e.g. `nd('negroni')`. */
export function nd(label: string): NodeId {
  return testId('nd', label)
}

export const VENUE_ID = testId('vn', 'beach')
export const VENUE: `venue:${string}` = `venue:${VENUE_ID}`
export const OTHER_VENUE: `venue:${string}` = `venue:${testId('vn', 'city')}`
export const ROOT = nd('root')
export const BARSY: Source = 'barsy:in_test'

/** The default context: venue `beach`, BG default plus EN, fixed time. */
export const CONTEXT: ResolveContext = {
  venueScope: VENUE,
  locales: ['bg_BG', 'en_US'],
  now: '2026-10-09T12:00:00+03:00',
}

export function eur(amountMinor: number): Money {
  return { amount_minor: amountMinor, currency: 'EUR' }
}

type Row = MenuDocument['values'][number]
type Link = MenuDocument['links'][number]
type DocNode = MenuDocument['nodes'][number]

export interface ValueOptions {
  scope?: Scope
  basis?: unknown
  valid?: boolean
  observedAt?: string
}

function sourceFor(layer: Layer): Source {
  if (layer === 'barsy') return BARSY
  if (layer === 'import') return 'import:wines'
  return 'manual'
}

/** Builds a `MenuDocument` for venue `beach` with template `venue-menu@1`. */
export class DocBuilder {
  readonly nodes: DocNode[] = []
  readonly placements: { itemId: NodeId; sectionId: NodeId; sortKey: string }[] = []
  readonly values: Row[] = []
  readonly links: Link[] = []
  private readonly templateVersion: number

  constructor(templateVersion = 1) {
    this.templateVersion = templateVersion
    this.node(ROOT, 'menu', null)
    this.set(ROOT, 'title', 'manual', { bg_BG: 'Бар', en_US: 'Bar' })
  }

  /**
   * A node. A node with a parent gets the sibling sort key `sortKey` (default `a0` for all, so
   * siblings fall back to id order unless a test sets keys); a root or an item gets none.
   */
  node(
    id: NodeId,
    type: NodeType,
    parentId: NodeId | null,
    status: NodeStatus = 'active',
    sortKey = 'a0',
  ): this {
    this.nodes.push({
      id,
      type,
      parentId,
      status,
      revision: 1,
      sortKey: parentId === null ? null : sortKey,
    })
    return this
  }

  /** A section with a BG + EN title in the manual layer. */
  section(
    id: NodeId,
    parentId: NodeId = ROOT,
    status: NodeStatus = 'active',
    sortKey = 'a0',
  ): this {
    this.node(id, 'section', parentId, status, sortKey)
    return this.set(id, 'title', 'manual', { bg_BG: `Раздел ${id}`, en_US: `Section ${id}` })
  }

  /** A bare item node (no values, no links). */
  item(id: NodeId, status: NodeStatus = 'active'): this {
    return this.node(id, 'item', null, status)
  }

  /**
   * An item linked to an active barsy article that resolves orderable: barsy name (BG + EN),
   * venue-scoped price, for sale here, public, explicit empty allergens.
   */
  barsyItem(id: NodeId, priceMinor = 1250, status: NodeStatus = 'active'): this {
    this.item(id, status)
    this.link(id)
    this.set(id, 'name', 'barsy', { bg_BG: 'Негрони', en_US: 'Negroni' })
    this.set(id, 'price', 'barsy', eur(priceMinor), { scope: VENUE })
    this.set(id, 'for_sale', 'barsy', true, { scope: VENUE })
    this.set(id, 'visible', 'barsy', true)
    return this.set(id, 'allergens', 'barsy', [])
  }

  link(
    nodeId: NodeId,
    state: Link['state'] = 'active',
    externalType = 'article',
    source: Source = BARSY,
  ): this {
    this.links.push({ nodeId, source, externalType, state })
    return this
  }

  place(itemId: NodeId, sectionId: NodeId, sortKey = 'a0'): this {
    this.placements.push({ itemId, sectionId, sortKey })
    return this
  }

  set(
    nodeId: NodeId,
    fieldKey: string,
    layer: Layer,
    value: unknown,
    options: ValueOptions = {},
  ): this {
    let hash = ''
    try {
      hash = sha256Hex(canonicalJson(value))
    } catch {
      hash = 'unhashable'
    }
    const scope = options.scope ?? 'master'
    // One row per (node, field, layer, scope), like the table's unique key: a set replaces.
    this.unset(nodeId, fieldKey, layer, scope)
    this.values.push({
      nodeId,
      fieldKey,
      layer,
      scope,
      value,
      valueHash: hash,
      source: sourceFor(layer),
      observedAt: options.observedAt ?? '2026-10-01T10:00:00+03:00',
      basis: layer === 'override' ? (options.basis ?? null) : null,
      valid: options.valid ?? true,
    })
    return this
  }

  /** Removes the rows of a field (of one layer and scope when given). */
  unset(nodeId: NodeId, fieldKey: string, layer?: Layer, scope?: Scope): this {
    const keep = this.values.filter(
      (row) =>
        !(
          row.nodeId === nodeId &&
          row.fieldKey === fieldKey &&
          (layer === undefined || row.layer === layer) &&
          (scope === undefined || row.scope === scope)
        ),
    )
    this.values.splice(0, this.values.length, ...keep)
    return this
  }

  /** Changes a node's status. */
  status(id: NodeId, status: NodeStatus): this {
    const index = this.nodes.findIndex((node) => node.id === id)
    const node = this.nodes[index]
    if (node === undefined) throw new Error(`no node ${id}`)
    this.nodes[index] = { ...node, status }
    return this
  }

  build(): MenuDocument {
    return {
      menu: {
        id: ROOT,
        venueId: VENUE_ID,
        templateKey: 'venue-menu',
        templateVersion: this.templateVersion,
        rootNodeId: ROOT,
      },
      nodes: [...this.nodes],
      placements: [...this.placements],
      values: [...this.values],
      links: [...this.links],
    }
  }
}

/** A menu with one section holding one orderable barsy item. */
export function oneItemMenu(item = nd('negroni'), section = nd('cocktails')): DocBuilder {
  return new DocBuilder().section(section).barsyItem(item).place(item, section)
}
