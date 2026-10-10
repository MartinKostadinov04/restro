// The change-set ops behind each thing a person does in the composer. Pure, so the shapes can be
// tested without a server; actions.ts wraps them in a manual change set and hands it to apply().
//
// An intent with more than one op ("move an item": place it there, take it out of here) is sent
// atomically (ApplyOptions.atomic): all of it happens, or none of it.

import type { ChangeSetOp, LocalizedText, NodeId } from '@restro/core'

import type { KeyedId } from './plan'

/** Items: put the item in `toSectionId` at these keys, then take it out of `fromSectionId`. */
export function placeItemOps(input: {
  itemId: NodeId
  fromSectionId: NodeId | null
  toSectionId: NodeId | null
  keys: readonly KeyedId<NodeId>[]
}): ChangeSetOp[] | null {
  const { itemId, fromSectionId, toSectionId, keys } = input
  const ops: ChangeSetOp[] = []
  if (toSectionId !== null) {
    if (!keys.some((entry) => entry.id === itemId)) return null
    for (const { id, key } of keys) {
      ops.push({
        op: 'setPlacement',
        item: { id },
        section: { id: toSectionId },
        sortKey: key,
      })
    }
  }
  if (fromSectionId !== null && fromSectionId !== toSectionId) {
    ops.push({ op: 'removePlacement', item: { id: itemId }, section: { id: fromSectionId } })
  }
  return ops.length > 0 ? ops : null
}

/** Sections: move `sectionId` (and re-space its new siblings, if `keys` says so) under a parent. */
export function moveSectionOps(input: {
  sectionId: NodeId
  parentId: NodeId | null
  menuId: NodeId
  keys: readonly KeyedId<NodeId>[]
}): ChangeSetOp[] | null {
  const { sectionId, parentId, menuId, keys } = input
  if (!keys.some((entry) => entry.id === sectionId)) return null
  return keys.map(({ id, key }) => ({
    op: 'moveNode' as const,
    node: { id },
    parent: { id: parentId ?? menuId },
    sortKey: key,
  }))
}

/** A new curated section: the node, then its title in the manual layer. */
export function createSectionOps(input: {
  id: NodeId
  parentId: NodeId | null
  menuId: NodeId
  title: LocalizedText
  sortKey: string
}): ChangeSetOp[] {
  const { id, parentId, menuId, title, sortKey } = input
  return [
    {
      op: 'createNode',
      id,
      nodeType: 'section',
      parent: { id: parentId ?? menuId },
      status: 'active',
      sortKey,
    },
    {
      op: 'setField',
      node: { id },
      fieldKey: 'title',
      layer: 'manual',
      scope: 'master',
      value: title,
    },
  ]
}

/**
 * Hide or show an item. Hiding writes `visible = false` in the manual layer. Showing only
 * removes that value (and makes a held-back item active again): the barsy layer is never
 * written, so an item barsy hides stays hidden (rule 5).
 */
export function setItemHiddenOps(input: {
  itemId: NodeId
  hidden: boolean
  /** The item's status now: a `hidden` item is made `active` when shown. */
  status: string
}): ChangeSetOp[] {
  const { itemId, hidden, status } = input
  if (hidden) {
    return [
      {
        op: 'setField',
        node: { id: itemId },
        fieldKey: 'visible',
        layer: 'manual',
        scope: 'master',
        value: false,
      },
    ]
  }
  const ops: ChangeSetOp[] = [
    {
      op: 'clearField',
      node: { id: itemId },
      fieldKey: 'visible',
      layer: 'manual',
      scope: 'master',
    },
  ]
  if (status === 'hidden') ops.push({ op: 'setNodeStatus', node: { id: itemId }, status: 'active' })
  return ops
}

/** Hide or show a section: its status (sections have no `visible` field). */
export function setSectionHiddenOps(input: { sectionId: NodeId; hidden: boolean }): ChangeSetOp[] {
  return [
    {
      op: 'setNodeStatus',
      node: { id: input.sectionId },
      status: input.hidden ? 'hidden' : 'active',
    },
  ]
}
