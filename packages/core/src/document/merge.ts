// Adding nodes to a loaded document. `loadMenuDocument` reaches items through the placements of a
// menu's sections, so an item placed nowhere is missing from it; `loadUnplacedItems` reads those
// items, and this puts them into the document before the resolver runs. Pure.

import type { MenuDocument } from './types'

/** The part of a document that holds nodes: what an extra read adds. */
export type DocumentParts = Pick<MenuDocument, 'nodes' | 'values' | 'links'>

/**
 * The document plus extra nodes, values and links. A node the document already has (same id) is
 * kept as it is, and so are its rows: the extra read never overrides the main one.
 */
export function mergeDocumentParts(doc: MenuDocument, extra: DocumentParts): MenuDocument {
  const known = new Set(doc.nodes.map((node) => node.id))
  const added = new Set(extra.nodes.filter((node) => !known.has(node.id)).map((node) => node.id))
  if (added.size === 0) return doc
  return {
    ...doc,
    nodes: [...doc.nodes, ...extra.nodes.filter((node) => added.has(node.id))],
    values: [...doc.values, ...extra.values.filter((value) => added.has(value.nodeId))],
    links: [...doc.links, ...extra.links.filter((link) => added.has(link.nodeId))],
  }
}
