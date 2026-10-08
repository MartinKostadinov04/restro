import type { Layer, Scope, Source } from '../change-set'
import type { NodeId } from '../ids'
import type { NodeStatus, NodeType } from '../node-types'

export interface MenuDocument {
  menu: {
    id: NodeId
    venueId: string
    templateKey: string
    templateVersion: number
    rootNodeId: NodeId
  }
  nodes: ReadonlyArray<{
    id: NodeId
    type: NodeType
    parentId: NodeId | null
    status: NodeStatus
    revision: number
  }>
  placements: ReadonlyArray<{ itemId: NodeId; sectionId: NodeId; sortKey: string }>
  values: ReadonlyArray<{
    nodeId: NodeId
    fieldKey: string
    layer: Layer
    scope: Scope
    value: unknown
    valueHash: string
    source: Source
    observedAt: string
    basis: unknown | null
    valid: boolean
  }>
  links: ReadonlyArray<{
    nodeId: NodeId
    source: Source
    externalType: string
    state: 'active' | 'missing' | 'deleted'
  }>
}
