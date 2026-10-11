'use client'

// What the composer's parts share: the view, which section is open, and what each row can do.
// One context instead of a dozen props through the tree and its rows. The stub of the item sheet
// reads the item's name from here; the real sheet (S2-06b) loads its own data from the id.
import type { Locale, NodeId, TagId } from '@restro/core'
import { createContext, type ReactNode, useContext } from 'react'

import type { TagDraft } from '@/fields/environment'

import type { ComposerView } from './view-model'

/** The open section: a section id, or `'unsorted'`. */
export type Selection = NodeId | 'unsorted'

export type { TagDraft }

/** What a row or a menu in the composer may do. */
export interface ComposerActions {
  readonly select: (selection: Selection) => void
  readonly openItem: (itemId: NodeId) => void
  readonly toggleExpanded: (sectionId: NodeId) => void
  readonly toggleItemHidden: (itemId: NodeId) => void
  readonly toggleSectionHidden: (sectionId: NodeId) => void
  /** Moves an item to the end of a section; `null` takes it out of `fromSectionId`. */
  readonly moveItemToSection: (
    itemId: NodeId,
    fromSectionId: NodeId | null,
    toSectionId: NodeId | null,
  ) => void
  /** Moves a section to the end of a parent (`null` = top level). */
  readonly moveSectionTo: (sectionId: NodeId, parentId: NodeId | null) => void
  readonly newSection: (parentId?: NodeId | null) => void
  /** Opens "New item" for a section (`null` = Unsorted). */
  readonly newItem: (sectionId: NodeId | null) => void

  // --- tags (D60) ---------------------------------------------------------------------------
  /** Adds a tag to the venue's list under the id the caller made; true when it was saved. */
  readonly createTag: (id: TagId, draft: TagDraft) => Promise<boolean>
  /** Renames and/or recolours a tag; true when it was saved. */
  readonly updateTag: (id: TagId, draft: Partial<TagDraft>) => Promise<boolean>
  /** Moves a tag before another tag (`null` = to the end). */
  readonly moveTag: (id: TagId, beforeId: TagId | null) => void
  readonly setTagArchived: (id: TagId, archived: boolean) => void
  /** Adds and removes tags on a selection of items in one atomic change. */
  readonly setItemTags: (
    itemIds: readonly NodeId[],
    add: readonly TagId[],
    remove: readonly TagId[],
  ) => void
  readonly openTagsPanel: () => void

  // --- sold out tonight (D46) --------------------------------------------------------------------
  /**
   * Marks items sold out tonight (`true`) or takes OUR mark off (`false`: "back on sale" only
   * removes the mark, so an item the till has off sale stays off sale, rule 5). Only owners and
   * admins; items the till has off sale are left out.
   */
  readonly setSoldOut: (itemIds: readonly NodeId[], soldOut: boolean) => void

  // --- selecting items and filtering by tag ---------------------------------------------------
  readonly toggleSelected: (itemId: NodeId) => void
  /** Selects (or unselects) these items, the ones the list shows right now. */
  readonly selectItems: (itemIds: readonly NodeId[], selected: boolean) => void
  readonly clearSelection: () => void
  readonly toggleTagFilter: (tagId: TagId) => void
  readonly clearTagFilter: () => void
}

/** The composer's shared state. */
export interface ComposerState extends ComposerActions {
  readonly view: ComposerView
  readonly selection: Selection | null
  readonly expanded: ReadonlySet<NodeId>
  /** The language the interface (and so the menu text on this screen) is in. */
  readonly locale: Locale
  /** While an item is dragged: the tree row (a section id or `unsorted`) the pointer is over. */
  readonly overTarget: string | null
  /** The items ticked for a bulk change. */
  readonly selected: ReadonlySet<NodeId>
  /** The tags the list is filtered by (an item with any of them shows); empty = no filter. */
  readonly tagFilter: ReadonlySet<TagId>
  /** The person may mark items sold out tonight and take the mark off (owner or admin). */
  readonly canMarkSoldOut: boolean
  /**
   * The person may create items by hand here: an owner or admin, in a venue without a till
   * (CF-01, D66).
   */
  readonly canCreateItem: boolean
  /** The venue has a till: its items come from the till (the empty states say so). */
  readonly hasTill: boolean
}

const Context = createContext<ComposerState | null>(null)

export function ComposerProvider({
  value,
  children,
}: {
  value: ComposerState
  children: ReactNode
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}

/** The composer's shared state; only valid inside the composer. */
export function useComposer(): ComposerState {
  const value = useContext(Context)
  if (!value) throw new Error('useComposer is used outside the composer')
  return value
}
