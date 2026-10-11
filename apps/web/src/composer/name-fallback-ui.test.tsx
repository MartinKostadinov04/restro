// @vitest-environment jsdom
// The warning that a name is the till's own, standing in for a missing public one (D75, CF-17), on
// the composer's screens: a row, a section's header and the section tree. It only warns: the
// row's switch and every other control are as they were.
import { DragDropContext } from '@hello-pangea/dnd'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { ItemPane } from './item-pane'
import { SectionTree } from './section-tree'
import { makeTestState, WithComposer } from './test-state'
import type { ComposerItem, ComposerSection } from './view-model'

type State = ReturnType<typeof makeTestState>

/** The test view with Negroni and the Cocktails section named by the till's own name. */
function stateWith(flags: { item?: boolean; section?: boolean }): State {
  const state = makeTestState()
  const items = { ...state.view.items }
  items[state.ids.negroni] = {
    ...(items[state.ids.negroni] as ComposerItem),
    nameFromTill: flags.item === true,
  }
  const sections = { ...state.view.sections }
  sections[state.ids.cocktails] = {
    ...(sections[state.ids.cocktails] as ComposerSection),
    nameFromTill: flags.section === true,
  }
  state.view = { ...state.view, items, sections }
  return state
}

const inDnd = (state: State, ui: React.ReactNode) =>
  renderWithIntl(
    <WithComposer state={state}>
      <DragDropContext onDragEnd={() => undefined}>{ui}</DragDropContext>
    </WithComposer>,
    { tillLabel: 'Kasa 2' },
  )

const rowOf = (name: string) => {
  const found = screen
    .getAllByTestId('item-row')
    .find((row) => within(row).queryByTestId('item-open')?.textContent === name)
  if (!found) throw new Error(`no row for ${name}`)
  return found
}

describe('the row of an item', () => {
  it('carries the warning only when its name is the till’s own', () => {
    inDnd(stateWith({ item: true }), <ItemPane />)
    expect(within(rowOf('Negroni')).getByTestId('name-from-till-badge').textContent).toBe(
      'Menu name missing in Kasa 2: its own name is shown',
    )
    expect(within(rowOf('Spritz')).queryByTestId('name-from-till-badge')).toBeNull()
  })

  it('and not otherwise: a public or typed name has none', () => {
    inDnd(stateWith({ item: false }), <ItemPane />)
    expect(screen.queryByTestId('name-from-till-badge')).toBeNull()
  })

  it('does not take the switch away: it never blocks anything', () => {
    inDnd(stateWith({ item: true }), <ItemPane />)
    const toggle = within(rowOf('Negroni')).getByTestId('item-visible')
    expect(toggle.hasAttribute('disabled')).toBe(false)
  })
})

describe('a section', () => {
  it('shows the warning in its header when its title is the till’s own', () => {
    inDnd(stateWith({ section: true }), <ItemPane />)
    const title = screen.getByTestId('pane-title')
    const header = title.closest('header')
    expect(header).not.toBeNull()
    expect(within(header as HTMLElement).getByTestId('name-from-till-badge')).toBeTruthy()
  })

  it('and a mark in the section tree, in the section’s own row only', () => {
    inDnd(stateWith({ section: true }), <SectionTree />)
    const marks = screen.getAllByTestId('section-name-from-till')
    expect(marks).toHaveLength(1)
    // The tree names the till as the view does (`view.tillLabel`).
    expect(marks[0]?.getAttribute('aria-label')).toBe(
      'Menu name missing in barsy: its own name is shown',
    )
    const row = marks[0]?.closest('[data-testid="section-row"]')
    expect(row?.textContent).toContain('Section a0')
  })

  it('has neither when its title is public', () => {
    inDnd(stateWith({ section: false }), <SectionTree />)
    expect(screen.queryByTestId('section-name-from-till')).toBeNull()
  })
})
