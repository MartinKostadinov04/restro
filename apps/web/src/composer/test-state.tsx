// A composer state for the component tests of this folder: the hand-made view of ./test-view.ts
// and an action that is a spy. Not part of the app.
import { vi } from 'vitest'

import { ComposerProvider, type ComposerState } from './composer-context'
import { makeTestView, type TestView } from './test-view'

/** The state with its parts writable (a test sets up the screen it needs) and the ids it uses. */
export type TestState = { -readonly [K in keyof ComposerState]: ComposerState[K] } & {
  readonly ids: TestView['ids']
}

/** A state with every action a spy, over the test view; `overrides` replaces any part of it. */
export function makeTestState(overrides: Partial<ComposerState> = {}): TestState {
  const { view, ids } = makeTestView()
  return {
    ids,
    view,
    selection: ids.cocktails,
    expanded: new Set(),
    locale: 'en_US',
    overTarget: null,
    selected: new Set(),
    tagFilter: new Set(),
    canMarkSoldOut: true,
    canCreateItem: true,
    hasTill: false,
    select: vi.fn(),
    openItem: vi.fn(),
    toggleExpanded: vi.fn(),
    toggleItemHidden: vi.fn(),
    toggleSectionHidden: vi.fn(),
    moveItemToSection: vi.fn(),
    moveSectionTo: vi.fn(),
    newSection: vi.fn(),
    newItem: vi.fn(),
    createTag: vi.fn(async () => true),
    updateTag: vi.fn(async () => true),
    moveTag: vi.fn(),
    setTagArchived: vi.fn(),
    setItemTags: vi.fn(),
    openTagsPanel: vi.fn(),
    setSoldOut: vi.fn(),
    toggleSelected: vi.fn(),
    selectItems: vi.fn(),
    clearSelection: vi.fn(),
    toggleTagFilter: vi.fn(),
    clearTagFilter: vi.fn(),
    ...overrides,
  }
}

/** Provides `state` to the composer parts below it. */
export function WithComposer({
  state,
  children,
}: {
  state: ComposerState
  children: React.ReactNode
}) {
  return <ComposerProvider value={state}>{children}</ComposerProvider>
}
