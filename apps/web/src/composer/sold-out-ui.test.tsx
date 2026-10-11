// @vitest-environment jsdom
// The sold-out screens of the composer (brief S3-08, D46): the badge on a row, the toggle in its
// menu, the "Sold out (N)" chip and its list, and the sale card of the item sheet. Rule 5 shows
// in what is missing: an item barsy has off sale has no "Back on sale" anywhere.
import { DragDropContext } from '@hello-pangea/dnd'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { SaleBadge } from './badges'
import { ItemPane } from './item-pane'
import { ItemSheetSale } from './item-sheet-sale'
import { SoldOutChip, soldOutTonightIds } from './sold-out-chip'
import { makeTestState, WithComposer } from './test-state'
import type { ComposerItem } from './view-model'

type State = ReturnType<typeof makeTestState>

/** The test view with Negroni marked sold out tonight and Spritz off sale in barsy. */
function stateWith(overrides: Record<string, Partial<ComposerItem>> = {}): State {
  const state = makeTestState()
  const items = { ...state.view.items }
  for (const [id, change] of Object.entries(overrides)) {
    items[id as keyof typeof items] = {
      ...(items[id as keyof typeof items] as ComposerItem),
      ...change,
    }
  }
  state.view = { ...state.view, items }
  return state
}

function pane(state: State) {
  return renderWithIntl(
    <WithComposer state={state}>
      <DragDropContext onDragEnd={() => undefined}>
        <ItemPane />
      </DragDropContext>
    </WithComposer>,
  )
}

const rowOf = (name: string) => {
  const found = screen
    .getAllByTestId('item-row')
    .find((row) => within(row).queryByTestId('item-open')?.textContent === name)
  if (!found) throw new Error(`no row for ${name}`)
  return found
}

describe('the sale badge', () => {
  it('says "Sold out tonight" for a manager\'s mark, in English and in Bulgarian', () => {
    const { unmount } = renderWithIntl(<SaleBadge soldOutTonight offSale={null} />)
    expect(screen.getByTestId('sold-out-badge').textContent).toBe('Sold out tonight')
    unmount()
    renderWithIntl(<SaleBadge soldOutTonight offSale={null} />, { locale: 'bg' })
    expect(screen.getByTestId('sold-out-badge').textContent).toBe('Изчерпано тази вечер')
  })

  it('says "Not on sale in barsy" when barsy has it off sale, whatever else is true', () => {
    renderWithIntl(<SaleBadge soldOutTonight={false} offSale="till" />, { locale: 'bg' })
    expect(screen.getByTestId('off-sale-badge').textContent).toBe('Не се продава в barsy')
    expect(screen.queryByTestId('sold-out-badge')).toBeNull()
  })

  it('draws nothing for an item on sale', () => {
    const { container } = renderWithIntl(<SaleBadge soldOutTonight={false} offSale={null} />)
    expect(container.textContent).toBe('')
  })
})

describe('an item row', () => {
  it('shows the badge only on the marked row, and the barsy badge on the item barsy has off sale', () => {
    const state = stateWith({})
    const [negroni, spritz] = [state.ids.negroni, state.ids.spritz]
    state.view = {
      ...state.view,
      items: {
        ...state.view.items,
        [negroni]: { ...(state.view.items[negroni] as ComposerItem), soldOutTonight: true },
        [spritz]: { ...(state.view.items[spritz] as ComposerItem), offSale: 'till' },
      },
    }
    pane(state)
    expect(within(rowOf('Negroni')).getByTestId('sold-out-badge').textContent).toBe(
      'Sold out tonight',
    )
    expect(within(rowOf('Spritz')).getByTestId('off-sale-badge').textContent).toBe(
      'Not on sale in barsy',
    )
  })

  it('has "Sold out tonight" in its menu, which marks that one item', async () => {
    const state = makeTestState()
    pane(state)
    await userEvent.click(within(rowOf('Negroni')).getByTestId('item-menu'))
    await userEvent.click(await screen.findByTestId('item-mark-sold-out'))
    expect(state.setSoldOut).toHaveBeenCalledWith([state.ids.negroni], true)
  })

  it('offers "Back on sale" instead on a marked row, which removes the mark', async () => {
    const state = stateWith({})
    state.view = {
      ...state.view,
      items: {
        ...state.view.items,
        [state.ids.negroni]: {
          ...(state.view.items[state.ids.negroni] as ComposerItem),
          soldOutTonight: true,
        },
      },
    }
    pane(state)
    await userEvent.click(within(rowOf('Negroni')).getByTestId('item-menu'))
    expect(screen.queryByTestId('item-mark-sold-out')).toBeNull()
    await userEvent.click(await screen.findByTestId('item-unmark-sold-out'))
    expect(state.setSoldOut).toHaveBeenCalledWith([state.ids.negroni], false)
  })

  it('has no sold-out control at all for an item barsy has off sale (rule 5)', async () => {
    const state = makeTestState()
    state.view = {
      ...state.view,
      items: {
        ...state.view.items,
        [state.ids.negroni]: {
          ...(state.view.items[state.ids.negroni] as ComposerItem),
          offSale: 'till',
        },
      },
    }
    pane(state)
    await userEvent.click(within(rowOf('Negroni')).getByTestId('item-menu'))
    await screen.findByRole('menuitem', { name: /open negroni/i })
    expect(screen.queryByTestId('item-mark-sold-out')).toBeNull()
    expect(screen.queryByTestId('item-unmark-sold-out')).toBeNull()
    expect(screen.queryByText('Back on sale')).toBeNull()
  })

  it('has no sold-out control for someone who is not an owner or admin', async () => {
    const state = makeTestState({ canMarkSoldOut: false })
    pane(state)
    await userEvent.click(within(rowOf('Negroni')).getByTestId('item-menu'))
    await screen.findByRole('menuitem', { name: /open negroni/i })
    expect(screen.queryByTestId('item-mark-sold-out')).toBeNull()
  })
})

describe('the "Sold out (N)" chip and its list', () => {
  function marked(...names: ('negroni' | 'spritz' | 'lager')[]): State {
    const state = makeTestState()
    const items = { ...state.view.items }
    for (const name of names) {
      const id = state.ids[name]
      items[id] = { ...(items[id] as ComposerItem), soldOutTonight: true }
    }
    state.view = { ...state.view, items }
    return state
  }

  it('is not there until something is marked', () => {
    const { container } = renderWithIntl(
      <WithComposer state={makeTestState()}>
        <SoldOutChip />
      </WithComposer>,
    )
    expect(container.textContent).toBe('')
  })

  it("counts every marked item of the menu, not only this section's, and lists them by name", async () => {
    const state = marked('negroni', 'lager')
    renderWithIntl(
      <WithComposer state={state}>
        <SoldOutChip />
      </WithComposer>,
    )
    const chip = screen.getByTestId('sold-out-chip')
    expect(chip.textContent).toBe('Sold out (2)')
    await userEvent.click(chip)
    const entries = await screen.findAllByTestId('sold-out-entry')
    expect(entries.map((entry) => within(entry).getAllByRole('button')[0]?.textContent)).toEqual([
      'Lager',
      'Negroni',
    ])
  })

  it('puts an item back on sale from the list (the mark only)', async () => {
    const state = marked('negroni')
    renderWithIntl(
      <WithComposer state={state}>
        <SoldOutChip />
      </WithComposer>,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('sold-out-chip').textContent).toBe('Изчерпани (1)')
    await userEvent.click(screen.getByTestId('sold-out-chip'))
    await userEvent.click(await screen.findByTestId('sold-out-entry-unmark'))
    expect(state.setSoldOut).toHaveBeenCalledWith([state.ids.negroni], false)
  })

  it('shows the list to a person who may not change it, without the buttons', async () => {
    const state = marked('negroni')
    state.canMarkSoldOut = false
    renderWithIntl(
      <WithComposer state={state}>
        <SoldOutChip />
      </WithComposer>,
    )
    await userEvent.click(screen.getByTestId('sold-out-chip'))
    expect(await screen.findAllByTestId('sold-out-entry')).toHaveLength(1)
    expect(screen.queryByTestId('sold-out-entry-unmark')).toBeNull()
  })

  it('leaves out an item barsy has off sale, with or without a stale mark', () => {
    const state = marked('negroni', 'spritz')
    state.view = {
      ...state.view,
      items: {
        ...state.view.items,
        [state.ids.spritz]: {
          ...(state.view.items[state.ids.spritz] as ComposerItem),
          offSale: 'till',
          soldOutTonight: true,
        },
      },
    }
    expect(soldOutTonightIds(state.view)).toEqual([state.ids.negroni])
  })

  it('is in the header of the open section', () => {
    const state = marked('negroni')
    pane(state)
    expect(screen.getByTestId('sold-out-chip').textContent).toBe('Sold out (1)')
  })
})

describe('the sale card of the item sheet', () => {
  const noop = async () => true
  const sale = (change: Partial<Parameters<typeof ItemSheetSale>[0]['sale']> = {}) => ({
    soldOutTonight: false,
    offSale: null,
    canMark: true,
    ...change,
  })

  it('offers "Mark sold out tonight" for an item on sale', async () => {
    const calls: boolean[] = []
    renderWithIntl(
      <ItemSheetSale
        sale={sale()}
        busy={false}
        onChange={async (value) => {
          calls.push(value)
          return true
        }}
      />,
    )
    expect(screen.getByTestId('sale-state').textContent).toBe('On sale')
    await userEvent.click(screen.getByTestId('sale-mark'))
    expect(calls).toEqual([true])
    expect(screen.queryByTestId('sale-unmark')).toBeNull()
  })

  it('offers "Back on sale" for a marked item, and says the mark ends by itself', async () => {
    const calls: boolean[] = []
    renderWithIntl(
      <ItemSheetSale
        sale={sale({ soldOutTonight: true })}
        busy={false}
        onChange={async (value) => {
          calls.push(value)
          return true
        }}
      />,
    )
    expect(screen.getByTestId('sale-state').textContent).toBe('Sold out tonight')
    expect(screen.getByTestId('sale-note').textContent).toMatch(/ends by itself/)
    await userEvent.click(screen.getByTestId('sale-unmark'))
    expect(calls).toEqual([false])
    expect(screen.queryByTestId('sale-mark')).toBeNull()
  })

  it('shows "Not on sale in barsy" and NO button when barsy has it off sale (rule 5)', () => {
    const { unmount } = renderWithIntl(
      <ItemSheetSale sale={sale({ offSale: 'till' })} busy={false} onChange={noop} />,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('sale-state').textContent).toBe('Не се продава в barsy')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('Върни в продажба')).toBeNull()
    unmount()

    // Even when a mark of tonight sits under barsy's flag, and for any other layer's flag.
    for (const offSale of ['till', 'other'] as const) {
      const view = renderWithIntl(
        <ItemSheetSale
          sale={sale({ offSale, soldOutTonight: false })}
          busy={false}
          onChange={noop}
        />,
      )
      expect(screen.queryByRole('button')).toBeNull()
      view.unmount()
    }
  })

  it('has no buttons for someone who may not mark, and says why', () => {
    renderWithIntl(<ItemSheetSale sale={sale({ canMark: false })} busy={false} onChange={noop} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTestId('sale-note').textContent).toMatch(/owner or admin/)
  })

  it('disables nothing it should not: a save under way blocks the button', () => {
    renderWithIntl(<ItemSheetSale sale={sale()} busy onChange={noop} />)
    expect((screen.getByTestId('sale-mark') as HTMLButtonElement).disabled).toBe(true)
  })
})
