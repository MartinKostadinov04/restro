// The change-set ops behind each thing a person does in the composer. Pure, so the shapes can be
// tested without a server; actions.ts wraps them in a manual change set and hands it to apply().
//
// An intent with more than one op ("move an item": place it there, take it out of here) is sent
// atomically (ApplyOptions.atomic): all of it happens, or none of it.

import {
  type ChangeSetOp,
  type LocalizedText,
  type Money,
  MoneySchema,
  type NodeId,
} from '@restro/core'

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
 * A new item made by hand: the node, its name (and price, when one was given) in the manual
 * layer, and its place in a section (when it was made inside one; otherwise it starts in Unsorted).
 * An item has no parent: membership is a placement. It has no till link, so it is display-only
 * and cannot be ordered (rule 5). The price is checked as core's `Money` (integer minor units,
 * rule 8); the caller converts typed text with core's money module, never with `x * 100`.
 */
export function createItemOps(input: {
  id: NodeId
  sectionId: NodeId | null
  name: LocalizedText
  price: Money | null
  sortKey: string
}): ChangeSetOp[] {
  const { id, sectionId, name, price, sortKey } = input
  const ops: ChangeSetOp[] = [
    { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
    {
      op: 'setField',
      node: { id },
      fieldKey: 'name',
      layer: 'manual',
      scope: 'master',
      value: name,
    },
  ]
  if (price !== null) {
    ops.push({
      op: 'setField',
      node: { id },
      fieldKey: 'price',
      layer: 'manual',
      scope: 'master',
      value: MoneySchema.parse(price),
    })
  }
  if (sectionId !== null) {
    ops.push({ op: 'setPlacement', item: { id }, section: { id: sectionId }, sortKey })
  }
  return ops
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
