// The JSON rows the document queries return (loadMenuDocument, loadUnplacedItems) and their
// mapping to the resolver's `MenuDocument` parts. Internal to this folder: not exported from
// ./index.

import type { Layer, Scope, Source } from '../change-set'
import type { DocumentParts } from '../document/merge'
import type { NodeId } from '../ids'
import type { NodeStatus, NodeType } from '../node-types'

/** The nodes, values and links of a document read, as the SQL builds them. */
export interface DocumentPartRows {
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

/** Types the rows of a document read. Links carry no external id (rule 3). */
export function documentPartsFromRows(row: DocumentPartRows): DocumentParts {
  return {
    nodes: row.nodes.map((node) => ({
      id: node.id as NodeId,
      type: node.type as NodeType,
      parentId: node.parentId as NodeId | null,
      status: node.status as NodeStatus,
      revision: node.revision,
      sortKey: node.sortKey,
    })),
    values: row.values.map((value) => ({
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
    links: row.links.map((link) => ({
      nodeId: link.nodeId as NodeId,
      source: link.source as Source,
      externalType: link.externalType,
      state: link.state as 'active' | 'missing' | 'deleted',
    })),
  }
}
