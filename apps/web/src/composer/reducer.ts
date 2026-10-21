// The optimistic half of every composer action: the view as it will look once the server has
// applied the change, computed on the client the moment someone drops, toggles or creates
// something. `useOptimistic` shows it while the server action runs; when the action finishes the
// server's own view replaces it, and when the action fails the optimistic view simply goes away
// (the base view never changed): that is the rollback. Pure.
//
// The reducer never decides what is allowed: the UI only offers legal moves (./tree.ts) and
// `apply()` refuses the rest. It only has to show a legal move correctly.

import type { Locale, NodeId, SectionLayout, TagId } from '@restro/core'

import type { KeyedId } from './plan'
import type {
  ComposerItem,
  ComposerPlacement,
  ComposerSection,
  ComposerTag,
  ComposerView,
} from './view-model'

/** One change someone just made in the composer. */
export type ComposerOp =
  /**
   * An item goes to `toSectionId` (`null` = nowhere: it becomes unsorted) and leaves
   * `fromSectionId` (`null` = it came from Unsorted). `keys` are the sort keys to write in the
   * target section: the item's own, plus every sibling's if the section had to be re-spaced.
   */
  | {
      readonly type: 'placeItem'
      readonly itemId: NodeId
      readonly fromSectionId: NodeId | null
      readonly toSectionId: NodeId | null
      readonly keys: readonly KeyedId<NodeId>[]
    }
  /** A section goes under `parentId` (`null` = the menu), with these sort keys among its siblings. */
  | {
      readonly type: 'moveSection'
      readonly sectionId: NodeId
      readonly parentId: NodeId | null
      readonly keys: readonly KeyedId<NodeId>[]
    }
  | { readonly type: 'setItemHidden'; readonly itemId: NodeId; readonly hidden: boolean }
  | { readonly type: 'setSectionHidden'; readonly sectionId: NodeId; readonly hidden: boolean }
  | { readonly type: 'addSection'; readonly section: ComposerSection }
  /**
   * A new item made by hand. In a section (`sectionId`) it goes at its end, with the sort key the
   * action writes; with `null` it starts in Unsorted, which lists items by name in `locale`.
   */
  | {
      readonly type: 'addItem'
      readonly item: ComposerItem
      readonly sectionId: NodeId | null
      readonly sortKey: string
      readonly locale: Locale
    }
  /** Tags added to and removed from a selection of items (the bulk bar and the item sheet). */
  | {
      readonly type: 'setItemTags'
      readonly itemIds: readonly NodeId[]
      readonly add: readonly TagId[]
      readonly remove: readonly TagId[]
    }
  /** A tag is created (appended to the list) or changed (name, colour, archived) in place. */
  | { readonly type: 'upsertTag'; readonly tag: ComposerTag }
  /** A tag moves before another tag (`null` = to the end). */
  | { readonly type: 'moveTag'; readonly tagId: TagId; readonly beforeId: TagId | null }
  /** Items are marked sold out tonight, or the mark is taken off (D46). */
  | {
      readonly type: 'setSoldOut'
      readonly itemIds: readonly NodeId[]
      readonly soldOut: boolean
    }
  /** A section is laid out as a vertical list or a horizontal row (D92). */
  | {
      readonly type: 'setSectionLayout'
      readonly sectionId: NodeId
      readonly layout: SectionLayout
    }
  /** A section's title in the interface language changes. */
  | { readonly type: 'renameSection'; readonly sectionId: NodeId; readonly title: string }
  /** An item's name in the interface language changes. */
  | { readonly type: 'renameItem'; readonly itemId: NodeId; readonly name: string }
  /**
   * A section and the sections under it leave the menu; their items leave them too, and an item
   * that is then placed nowhere goes to Unsorted (the end of the list until the server sorts it).
   */
  | { readonly type: 'deleteSection'; readonly sectionId: NodeId }
  /** An item leaves the menu: every list it was in. */
  | { readonly type: 'deleteItem'; readonly itemId: NodeId }

const byKeyThenId = (a: { sortKey: string; id: string }, b: { sortKey: string; id: string }) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** The ids of sections in sibling order. */
function orderSiblings(
  sections: Readonly<Record<NodeId, ComposerSection>>,
  ids: readonly NodeId[],
): NodeId[] {
  return ids
    .map((id) => ({ id, sortKey: sections[id]?.sortKey ?? '' }))
    .sort(byKeyThenId)
    .map(({ id }) => id)
}

function placeItem(view: ComposerView, op: Extract<ComposerOp, { type: 'placeItem' }>) {
  const placements: Record<NodeId, readonly ComposerPlacement[]> = { ...view.placements }
  const { itemId, fromSectionId, toSectionId } = op
  if (fromSectionId !== null && fromSectionId !== toSectionId) {
    placements[fromSectionId] = (view.placements[fromSectionId] ?? []).filter(
      (placement) => placement.itemId !== itemId,
    )
  }
  if (toSectionId !== null) {
    const keyOf = new Map(op.keys.map(({ id, key }) => [id, key]))
    const current = view.placements[toSectionId] ?? []
    const rest = current.filter((placement) => placement.itemId !== itemId)
    const next = [...rest, { itemId, sortKey: keyOf.get(itemId) ?? '' }].map((placement) => ({
      itemId: placement.itemId,
      sortKey: keyOf.get(placement.itemId) ?? placement.sortKey,
    }))
    placements[toSectionId] = next.sort((a, b) =>
      byKeyThenId({ sortKey: a.sortKey, id: a.itemId }, { sortKey: b.sortKey, id: b.itemId }),
    )
  }
  const placedAnywhere = Object.values(placements).some((list) =>
    list.some((placement) => placement.itemId === itemId),
  )
  const unsortedIds = placedAnywhere
    ? view.unsortedIds.filter((id) => id !== itemId)
    : view.unsortedIds.includes(itemId)
      ? view.unsortedIds
      : [...view.unsortedIds, itemId]
  return { ...view, placements, unsortedIds }
}

function moveSection(view: ComposerView, op: Extract<ComposerOp, { type: 'moveSection' }>) {
  const moved = view.sections[op.sectionId]
  if (!moved) return view
  const keyOf = new Map(op.keys.map(({ id, key }) => [id, key]))
  const sections: Record<NodeId, ComposerSection> = { ...view.sections }
  for (const [id, key] of keyOf) {
    const section = sections[id]
    if (section) sections[id] = { ...section, sortKey: key }
  }
  sections[op.sectionId] = {
    ...(sections[op.sectionId] as ComposerSection),
    parentId: op.parentId,
  }

  const without = (ids: readonly NodeId[]) => ids.filter((id) => id !== op.sectionId)
  let rootIds = view.rootIds
  if (moved.parentId === null) rootIds = without(rootIds)
  else {
    const old = sections[moved.parentId]
    if (old) sections[moved.parentId] = { ...old, childIds: without(old.childIds) }
  }
  if (op.parentId === null) {
    rootIds = orderSiblings(sections, [...rootIds, op.sectionId])
  } else {
    const parent = sections[op.parentId]
    if (parent) {
      sections[op.parentId] = {
        ...parent,
        childIds: orderSiblings(sections, [...without(parent.childIds), op.sectionId]),
      }
    }
  }
  // Re-spaced siblings may also have changed place within a list that is not the target's.
  return { ...view, sections, rootIds }
}

function setItemHidden(view: ComposerView, op: Extract<ComposerOp, { type: 'setItemHidden' }>) {
  const item = view.items[op.itemId]
  if (!item) return view
  // The till's hide is not ours to change (rule 5): the base view keeps it.
  if (item.hiddenBy === 'till' || item.hiddenBy === 'other') return view
  const next: ComposerItem = op.hidden
    ? { ...item, hiddenBy: 'builder', shown: false }
    : {
        ...item,
        hiddenBy: null,
        shown: !item.issues.some((issue) => issue.severity === 'block_node'),
      }
  return { ...view, items: { ...view.items, [op.itemId]: next } }
}

function setSectionHidden(
  view: ComposerView,
  op: Extract<ComposerOp, { type: 'setSectionHidden' }>,
) {
  const section = view.sections[op.sectionId]
  if (!section) return view
  const next: ComposerSection = {
    ...section,
    hidden: op.hidden,
    shown: op.hidden ? false : section.shown || (view.placements[section.id]?.length ?? 0) > 0,
  }
  return { ...view, sections: { ...view.sections, [op.sectionId]: next } }
}

function addSection(view: ComposerView, op: Extract<ComposerOp, { type: 'addSection' }>) {
  const { section } = op
  if (view.sections[section.id]) return view
  const sections: Record<NodeId, ComposerSection> = { ...view.sections, [section.id]: section }
  let rootIds = view.rootIds
  if (section.parentId === null) rootIds = orderSiblings(sections, [...rootIds, section.id])
  else {
    const parent = sections[section.parentId]
    if (parent) {
      sections[section.parentId] = {
        ...parent,
        childIds: orderSiblings(sections, [...parent.childIds, section.id]),
      }
    }
  }
  return { ...view, sections, rootIds, placements: { ...view.placements, [section.id]: [] } }
}

function addItem(view: ComposerView, op: Extract<ComposerOp, { type: 'addItem' }>) {
  const { item, sectionId, sortKey } = op
  if (view.items[item.id]) return view
  const items: Record<NodeId, ComposerItem> = { ...view.items, [item.id]: item }
  if (sectionId !== null) {
    const section = view.sections[sectionId]
    // The section vanished meanwhile: the item would be in no list. Keep it in Unsorted.
    if (section) {
      const placements = {
        ...view.placements,
        [sectionId]: [...(view.placements[sectionId] ?? []), { itemId: item.id, sortKey }].sort(
          (a, b) =>
            byKeyThenId({ sortKey: a.sortKey, id: a.itemId }, { sortKey: b.sortKey, id: b.itemId }),
        ),
      }
      return { ...view, items, placements }
    }
  }
  // Unsorted lists items by name in the interface language, then by id (as the server does).
  const tag = op.locale.replace('_', '-')
  const unsortedIds = [...view.unsortedIds, item.id].sort((a, b) => {
    const left = items[a]?.name ?? ''
    const right = items[b]?.name ?? ''
    return left.localeCompare(right, tag) || (a < b ? -1 : a > b ? 1 : 0)
  })
  return { ...view, items, unsortedIds }
}

function setItemTags(view: ComposerView, op: Extract<ComposerOp, { type: 'setItemTags' }>) {
  const removed = new Set<TagId>(op.remove)
  const items: Record<NodeId, ComposerItem> = { ...view.items }
  for (const id of op.itemIds) {
    const item = items[id]
    if (!item) continue
    const next = [...new Set([...item.tags.filter((tag) => !removed.has(tag)), ...op.add])]
    items[id] = { ...item, tags: next }
  }
  return { ...view, items }
}

function upsertTag(view: ComposerView, op: Extract<ComposerOp, { type: 'upsertTag' }>) {
  const known = view.tags[op.tag.id] !== undefined
  return {
    ...view,
    tagIds: known ? view.tagIds : [...view.tagIds, op.tag.id],
    tags: { ...view.tags, [op.tag.id]: op.tag },
  }
}

function moveTag(view: ComposerView, op: Extract<ComposerOp, { type: 'moveTag' }>) {
  const rest = view.tagIds.filter((id) => id !== op.tagId)
  const at = op.beforeId === null ? -1 : rest.indexOf(op.beforeId)
  const tagIds = at < 0 ? [...rest, op.tagId] : [...rest.slice(0, at), op.tagId, ...rest.slice(at)]
  return { ...view, tagIds }
}

function setSoldOut(view: ComposerView, op: Extract<ComposerOp, { type: 'setSoldOut' }>) {
  const items: Record<NodeId, ComposerItem> = { ...view.items }
  for (const id of op.itemIds) {
    const item = items[id]
    // An item the till (or another layer) has off sale is not ours to change: the base view keeps it.
    if (!item || item.offSale !== null) continue
    items[id] = { ...item, soldOutTonight: op.soldOut }
  }
  return { ...view, items }
}

function setSectionLayout(
  view: ComposerView,
  op: Extract<ComposerOp, { type: 'setSectionLayout' }>,
) {
  const section = view.sections[op.sectionId]
  if (!section) return view
  return {
    ...view,
    sections: { ...view.sections, [op.sectionId]: { ...section, layout: op.layout } },
  }
}

function renameSection(view: ComposerView, op: Extract<ComposerOp, { type: 'renameSection' }>) {
  const section = view.sections[op.sectionId]
  if (!section) return view
  // A name typed here replaces the till's own (D75): the warning goes with it.
  const next: ComposerSection = { ...section, title: op.title, nameFromTill: false }
  return { ...view, sections: { ...view.sections, [op.sectionId]: next } }
}

function renameItem(view: ComposerView, op: Extract<ComposerOp, { type: 'renameItem' }>) {
  const item = view.items[op.itemId]
  if (!item) return view
  return {
    ...view,
    items: { ...view.items, [op.itemId]: { ...item, name: op.name, nameFromTill: false } },
  }
}

/** The section and every section under it. */
function subtreeOf(view: ComposerView, sectionId: NodeId): Set<NodeId> {
  const out = new Set<NodeId>()
  const visit = (id: NodeId) => {
    if (out.has(id)) return
    out.add(id)
    for (const child of view.sections[id]?.childIds ?? []) visit(child)
  }
  visit(sectionId)
  return out
}

function deleteSection(view: ComposerView, op: Extract<ComposerOp, { type: 'deleteSection' }>) {
  const removed = view.sections[op.sectionId]
  if (!removed) return view
  const gone = subtreeOf(view, op.sectionId)
  const sections: Record<NodeId, ComposerSection> = {}
  for (const [id, section] of Object.entries(view.sections) as [NodeId, ComposerSection][]) {
    if (!gone.has(id)) sections[id] = section
  }
  const parent = removed.parentId === null ? undefined : sections[removed.parentId]
  if (parent) {
    sections[parent.id] = {
      ...parent,
      childIds: parent.childIds.filter((id) => id !== op.sectionId),
    }
  }
  const placements: Record<NodeId, readonly ComposerPlacement[]> = {}
  const freed = new Set<NodeId>()
  for (const [id, list] of Object.entries(view.placements) as [
    NodeId,
    readonly ComposerPlacement[],
  ][]) {
    if (gone.has(id)) for (const placement of list) freed.add(placement.itemId)
    else placements[id] = list
  }
  const stillPlaced = new Set(
    Object.values(placements).flatMap((list) => list.map((placement) => placement.itemId)),
  )
  const unsorted = [...freed].filter((id) => !stillPlaced.has(id) && !view.unsortedIds.includes(id))
  return {
    ...view,
    sections,
    rootIds: view.rootIds.filter((id) => id !== op.sectionId),
    placements,
    unsortedIds: [...view.unsortedIds, ...unsorted],
  }
}

function deleteItem(view: ComposerView, op: Extract<ComposerOp, { type: 'deleteItem' }>) {
  if (!view.items[op.itemId]) return view
  const items: Record<NodeId, ComposerItem> = { ...view.items }
  delete items[op.itemId]
  const placements: Record<NodeId, readonly ComposerPlacement[]> = {}
  for (const [id, list] of Object.entries(view.placements) as [
    NodeId,
    readonly ComposerPlacement[],
  ][]) {
    placements[id] = list.filter((placement) => placement.itemId !== op.itemId)
  }
  return {
    ...view,
    items,
    placements,
    unsortedIds: view.unsortedIds.filter((id) => id !== op.itemId),
  }
}

/** The view after one change. */
export function reduceView(view: ComposerView, op: ComposerOp): ComposerView {
  switch (op.type) {
    case 'setSectionLayout':
      return setSectionLayout(view, op)
    case 'renameSection':
      return renameSection(view, op)
    case 'renameItem':
      return renameItem(view, op)
    case 'deleteSection':
      return deleteSection(view, op)
    case 'deleteItem':
      return deleteItem(view, op)
    case 'setSoldOut':
      return setSoldOut(view, op)
    case 'setItemTags':
      return setItemTags(view, op)
    case 'upsertTag':
      return upsertTag(view, op)
    case 'moveTag':
      return moveTag(view, op)
    case 'placeItem':
      return placeItem(view, op)
    case 'moveSection':
      return moveSection(view, op)
    case 'setItemHidden':
      return setItemHidden(view, op)
    case 'setSectionHidden':
      return setSectionHidden(view, op)
    case 'addSection':
      return addSection(view, op)
    case 'addItem':
      return addItem(view, op)
  }
}
