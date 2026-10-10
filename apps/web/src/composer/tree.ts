// Questions about the section tree that the UI asks while someone drags or picks a target, and
// that the reducer needs: depth, height, descendants, where a section may move. Pure. The rules
// are core's (`canNest`, `MAX_SECTION_DEPTH`); `apply()` checks them again on the server.

import { canNest, MAX_SECTION_DEPTH, type NodeId } from '@restro/core'

import type { ComposerSection, ComposerView } from './view-model'

/** The key that stands for the menu itself where a parent section is named (`children:root`). */
export const ROOT_KEY = 'root'

/** Child section ids of a parent (`null` = the menu), in order. */
export function childIdsOf(view: ComposerView, parentId: NodeId | null): readonly NodeId[] {
  return parentId === null ? view.rootIds : (view.sections[parentId]?.childIds ?? [])
}

/** 1 for a section directly under the menu, 2 for a sub-section, … */
export function depthOf(view: ComposerView, id: NodeId): number {
  let depth = 0
  let current: ComposerSection | undefined = view.sections[id]
  while (current && depth <= MAX_SECTION_DEPTH + 1) {
    depth += 1
    current = current.parentId === null ? undefined : view.sections[current.parentId]
  }
  return depth
}

/** How many levels of sections sit below a section (0 when it has no sub-section). */
export function heightOf(view: ComposerView, id: NodeId): number {
  const children = view.sections[id]?.childIds ?? []
  let height = 0
  for (const child of children) height = Math.max(height, 1 + heightOf(view, child))
  return height
}

/** Every section below `id`, however deep. */
export function descendantsOf(view: ComposerView, id: NodeId): Set<NodeId> {
  const found = new Set<NodeId>()
  const walk = (current: NodeId) => {
    for (const child of view.sections[current]?.childIds ?? []) {
      found.add(child)
      walk(child)
    }
  }
  walk(id)
  return found
}

/**
 * True if `sectionId` may become a child of `parentId` (`null` = the menu): not into itself or
 * its own sections, and neither it nor the sections inside it end up deeper than 3 levels.
 */
export function canMoveSection(
  view: ComposerView,
  sectionId: NodeId,
  parentId: NodeId | null,
): boolean {
  if (!view.sections[sectionId]) return false
  if (parentId !== null) {
    if (!view.sections[parentId]) return false
    if (parentId === sectionId || descendantsOf(view, sectionId).has(parentId)) return false
  }
  const depth = (parentId === null ? 0 : depthOf(view, parentId)) + 1
  if (!canNest(parentId === null ? 'menu' : 'section', 'section', depth)) return false
  return depth + heightOf(view, sectionId) <= MAX_SECTION_DEPTH
}

/** One place a section could go, for the "Move to" menu. */
export interface MoveTarget {
  /** `null` = top level (the menu). */
  readonly id: NodeId | null
  /** 0 for the top level, else the target's own depth. */
  readonly depth: number
}

/** Every parent a section may move to (not its current one), in tree order. */
export function moveTargets(view: ComposerView, sectionId: NodeId): MoveTarget[] {
  const current = view.sections[sectionId]?.parentId ?? null
  const targets: MoveTarget[] = []
  if (current !== null && canMoveSection(view, sectionId, null)) {
    targets.push({ id: null, depth: 0 })
  }
  for (const { id, depth } of flattenSections(view)) {
    if (id !== current && canMoveSection(view, sectionId, id)) targets.push({ id, depth })
  }
  return targets
}

/** Every section depth first, in the order the tree shows them. */
export function flattenSections(view: ComposerView): { id: NodeId; depth: number }[] {
  const flat: { id: NodeId; depth: number }[] = []
  const walk = (ids: readonly NodeId[], depth: number) => {
    for (const id of ids) {
      flat.push({ id, depth })
      walk(view.sections[id]?.childIds ?? [], depth + 1)
    }
  }
  walk(view.rootIds, 1)
  return flat
}
