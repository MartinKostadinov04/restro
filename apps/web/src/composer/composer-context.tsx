'use client'

// What the composer's parts share: the view, which section is open, and what each row can do.
// One context instead of a dozen props through the tree and its rows. The stub of the item sheet
// reads the item's name from here; the real sheet (S2-06b) loads its own data from the id.
import type { Locale, NodeId } from '@restro/core'
import { createContext, type ReactNode, useContext } from 'react'

import type { ComposerView } from './view-model'

/** The open section: a section id, or `'unsorted'`. */
export type Selection = NodeId | 'unsorted'

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
