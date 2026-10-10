// Drag and drop ids and what a drop means. The library only knows strings and indexes; these
// functions give them a meaning, in one pure place that is tested without a browser.
//
// Draggables:   `item:<nd>`, `section:<nd>`
// Droppables:   `items:<section nd | unsorted>`   the item list on the right (type ITEM)
//               `target:<section nd | unsorted>`  a row of the tree an item can be dropped on (ITEM)
//               `children:<parent nd | root>`     one list of sibling sections (type SECTIONS:<parent>)
import { isId, type NodeId } from '@restro/core'

import { ROOT_KEY } from './tree'

/** The id of the Unsorted list and its tree row. */
export const UNSORTED_KEY = 'unsorted'

export const itemDraggableId = (id: NodeId) => `item:${id}`
export const sectionDraggableId = (id: NodeId) => `section:${id}`

/** The part of a droppable id after its prefix, as a section id or `null` for Unsorted. */
function sectionOrUnsorted(rest: string): NodeId | null | undefined {
  if (rest === UNSORTED_KEY) return null
  return isId('nd', rest) ? rest : undefined
}

/** Reads a draggable id. */
export function parseDraggable(id: string): { kind: 'item' | 'section'; id: NodeId } | null {
  const match = /^(item|section):(.+)$/.exec(id)
  if (!match || !isId('nd', match[2])) return null
  return { kind: match[1] as 'item' | 'section', id: match[2] }
}

/** Reads an item droppable: a list (`items:`) or a tree row (`target:`); `sectionId` null = Unsorted. */
export function parseItemDroppable(
  id: string,
): { kind: 'list' | 'target'; sectionId: NodeId | null } | null {
  const match = /^(items|target):(.+)$/.exec(id)
  if (!match) return null
  const sectionId = sectionOrUnsorted(match[2] ?? '')
  if (sectionId === undefined) return null
  return { kind: match[1] === 'items' ? 'list' : 'target', sectionId }
}

/** Reads a list of sibling sections; `parentId` null = the top level. */
export function parseSectionList(id: string): { parentId: NodeId | null } | null {
  const match = /^children:(.+)$/.exec(id)
  if (!match) return null
  const rest = match[1] ?? ''
  if (rest === ROOT_KEY) return { parentId: null }
  return isId('nd', rest) ? { parentId: rest } : null
}

/** The part of the library's drop result a decision needs. */
export interface DropLike {
  readonly draggableId: string
  readonly source: { readonly droppableId: string; readonly index: number }
  readonly destination?: { readonly droppableId: string; readonly index: number } | null
}

/** What a drop asks the composer to do. */
export type DropIntent =
  /** Put the item in `toSectionId` (`null` = Unsorted) at `index`, or at the end if undefined. */
  | {
      readonly kind: 'placeItem'
      readonly itemId: NodeId
      readonly fromSectionId: NodeId | null
      readonly toSectionId: NodeId | null
      readonly index: number | undefined
    }
  /** Put the section at `index` among the children of `parentId` (`null` = top level). */
  | {
      readonly kind: 'moveSection'
      readonly sectionId: NodeId
      readonly parentId: NodeId | null
      readonly index: number
    }

/**
 * Turns a drop into an intent, or null when nothing changes (dropped outside a list, dropped
 * where it was, reordered inside Unsorted, which has no order).
 */
export function resolveDrop(drop: DropLike): DropIntent | null {
  const { destination } = drop
  if (!destination) return null
  const dragged = parseDraggable(drop.draggableId)
  if (!dragged) return null

  if (dragged.kind === 'section') {
    const from = parseSectionList(drop.source.droppableId)
    const to = parseSectionList(destination.droppableId)
    if (!from || !to || from.parentId !== to.parentId) return null
    if (drop.source.index === destination.index) return null
    return {
      kind: 'moveSection',
      sectionId: dragged.id,
      parentId: to.parentId,
      index: destination.index,
    }
  }

  const from = parseItemDroppable(drop.source.droppableId)
  const to = parseItemDroppable(destination.droppableId)
  if (from?.kind !== 'list' || !to) return null
  if (to.sectionId === from.sectionId) {
    // Reorder in the same list; Unsorted has no order to change, and a drop on the row of the
    // section the item is already in changes nothing.
    if (to.kind === 'target' || to.sectionId === null) return null
    if (drop.source.index === destination.index) return null
    return {
      kind: 'placeItem',
      itemId: dragged.id,
      fromSectionId: from.sectionId,
      toSectionId: to.sectionId,
      index: destination.index,
    }
  }
  return {
    kind: 'placeItem',
    itemId: dragged.id,
    fromSectionId: from.sectionId,
    toSectionId: to.sectionId,
    index: to.kind === 'list' ? destination.index : undefined,
  }
}

/** Attribute of the tree rows an item can be dropped on; its value is a section id or `unsorted`. */
export const DROP_TARGET_ATTR = 'data-drop-target'

/**
 * A drop decided by where the pointer is rather than where the library puts the dragged row's
 * centre: the row is wider than the tree, so its centre can never reach a tree row while the
 * pointer is on it. `target` is the `data-drop-target` of the row under the pointer. An item
 * dropped on the section it came from changes nothing.
 */
export function resolvePointerDrop(
  drop: Pick<DropLike, 'draggableId' | 'source'>,
  target: string,
): DropIntent | null {
  const dragged = parseDraggable(drop.draggableId)
  const from = parseItemDroppable(drop.source.droppableId)
  const to = parseItemDroppable(`target:${target}`)
  if (dragged?.kind !== 'item' || from?.kind !== 'list' || !to) return null
  if (to.sectionId === from.sectionId) return null
  return {
    kind: 'placeItem',
    itemId: dragged.id,
    fromSectionId: from.sectionId,
    toSectionId: to.sectionId,
    index: undefined,
  }
}
