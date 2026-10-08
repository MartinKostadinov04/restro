// Node types and nesting (doc "Schema layer" → "Node types"). Items are first-class: they are
// never children of sections and appear in sections only through placements.

import { z } from 'zod'

/** The node types of a menu document. */
export const NODE_TYPES = [
  'menu',
  'section',
  'item',
  'modifier_group',
  'option',
  'special',
] as const

/** One of the node types. */
export type NodeType = (typeof NODE_TYPES)[number]

/** Zod schema for a `NodeType`. */
export const NodeTypeSchema = z.enum(NODE_TYPES)

/** How instances of a node type occur under their parent. */
export type Cardinality = 'singular' | 'many' | 'series'

/** Cardinality and allowed parents of one node type, exactly as in the doc's table. */
export interface NodeTypeSpec {
  readonly cardinality: Cardinality
  /** Node types that may be the parent; empty for the root (menu) and for items (placements). */
  readonly allowedParents: readonly NodeType[]
  /** True if the node type can never have children. */
  readonly leaf: boolean
}

/** The doc's "Node types" table as data. */
export const NODE_TYPE_SPECS: { readonly [K in NodeType]: NodeTypeSpec } = {
  menu: { cardinality: 'singular', allowedParents: [], leaf: false },
  section: { cardinality: 'many', allowedParents: ['menu', 'section'], leaf: false },
  item: { cardinality: 'many', allowedParents: [], leaf: false },
  modifier_group: { cardinality: 'many', allowedParents: ['item'], leaf: false },
  option: { cardinality: 'many', allowedParents: ['modifier_group'], leaf: true },
  special: { cardinality: 'series', allowedParents: ['menu', 'section'], leaf: false },
}

/** Sections nest at most this deep: a section directly under the menu is at depth 1. */
export const MAX_SECTION_DEPTH = 3

/**
 * True if a `childType` node may sit under a `parentType` node at `depth` (the child's level
 * below the menu root: a child of the menu is at depth 1; only sections are depth-limited).
 * Enforces: the doc's allowed parents; a series never under a many; an item never contains an
 * item and is never a child; an option is a leaf; sections at most 3 deep. The series rule makes
 * the doc's "Special under Section" impossible, because Section is `many` (a doc inconsistency,
 * resolved here on the stricter side).
 */
export function canNest(parentType: NodeType, childType: NodeType, depth: number): boolean {
  if (!Number.isSafeInteger(depth) || depth < 1) return false
  const parent = NODE_TYPE_SPECS[parentType]
  const child = NODE_TYPE_SPECS[childType]
  if (parent === undefined || child === undefined) return false
  if (parent.leaf) return false
  if (parentType === 'item' && childType === 'item') return false
  if (!child.allowedParents.includes(parentType)) return false
  if (child.cardinality === 'series' && parent.cardinality === 'many') return false
  if (childType === 'section') {
    if (depth > MAX_SECTION_DEPTH) return false
    if (parentType === 'menu' && depth !== 1) return false
    if (parentType === 'section' && depth < 2) return false
  }
  return true
}

/** Lifecycle states of a node. `archived` keeps a node and its history without showing it. */
export const NODE_STATUSES = ['active', 'hidden', 'archived'] as const

/** One of the node statuses. */
export type NodeStatus = (typeof NODE_STATUSES)[number]

/** Zod schema for a `NodeStatus`. */
export const NodeStatusSchema = z.enum(NODE_STATUSES)
