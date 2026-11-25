// @vitest-environment jsdom
// The composer's tag screens (brief S3-06): the chips on an item row, the multi-select bar, the
// strip with "select all" and the tag filter, and the Tags panel.
import { DragDropContext } from '@hello-pangea/dnd'
import { newId } from '@restro/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { ItemChips } from './item-chips'
import { ItemPane } from './item-pane'
import { ItemToolbar } from './item-toolbar'
import { SelectionBar } from './selection-bar'
import { TagsPanel } from './tags-panel'
import { makeTestState, WithComposer } from './test-state'
import type { ComposerItem } from './view-model'

const names = (nodes: HTMLElement[]) => nodes.map((node) => node.textContent)

describe('the chips on an item row', () => {
  it('shows the active tags in the venue’s order and the dietary labels, never an archived tag', () => {
    const state = makeTestState()
    const negroni = state.view.items[state.ids.negroni] as ComposerItem
    renderWithIntl(
      <WithComposer state={state}>
        <ItemChips item={negroni} />
      </WithComposer>,
    )
    // Negroni holds Signature, Spicy and the archived Old; it is vegan.
    expect(names(screen.getAllByTestId('tag-chip'))).toEqual(['Signature', 'Spicy'])
    expect(names(screen.getAllByTestId('dietary-chip'))).toEqual(['Vegan'])
    expect(screen.queryByText('Old')).toBeNull()
  })

  it('shows three tags at most, then “+N” that lists the others', () => {
    const state = makeTestState()
    const extra = [newId('tg'), newId('tg'), newId('tg')]
    const tags = Object.fromEntries(
      extra.map((id, index) => [
        id,
        {
          id,
          name: `Extra ${index}`,
          label: { bg_BG: `Extra ${index}` },
          color: 'muted' as const,
          archived: false,
        },
      ]),
    )
    const view = {
      ...state.view,
      tagIds: [...state.view.tagIds, ...extra],
      tags: { ...state.view.tags, ...tags },
    }
    const item: ComposerItem = {
      ...(state.view.items[state.ids.spritz] as ComposerItem),
      tags: [state.ids.signature, state.ids.spicy, state.ids.local, ...extra],
    }
    renderWithIntl(
      <WithComposer state={{ ...state, view }}>
        <ItemChips item={item} />
      </WithComposer>,
    )
    expect(names(screen.getAllByTestId('tag-chip'))).toEqual(['Signature', 'Spicy', 'Local'])
    const more = screen.getByTestId('more-chip')
    expect(more.textContent).toBe('+3')
    expect(more.getAttribute('title')).toBe('More tags: Extra 0, Extra 1, Extra 2')
  })

  it('draws nothing for an item without tags or dietary labels', () => {
    const state = makeTestState()
    const lager = state.view.items[state.ids.lager] as ComposerItem
    const { container } = renderWithIntl(
      <WithComposer state={state}>
        <ItemChips item={lager} />
      </WithComposer>,
    )
    expect(container.textContent).toBe('')
  })
})

describe('the multi-select bar', () => {
  it('is not there until something is selected', () => {
    renderWithIntl(
      <WithComposer state={makeTestState()}>
        <SelectionBar />
      </WithComposer>,
    )
    expect(screen.queryByTestId('selection-bar')).toBeNull()
  })

  it('counts the selection and clears it', async () => {
    const state = makeTestState()
    state.selected = new Set([state.ids.negroni, state.ids.spritz])
    renderWithIntl(
      <WithComposer state={state}>
        <SelectionBar />
      </WithComposer>,
    )
    expect(screen.getByTestId('selection-count').textContent).toBe('2 items selected')
    await userEvent.click(screen.getByTestId('clear-selection'))
    expect(state.clearSelection).toHaveBeenCalledTimes(1)
  })

  it('adds a tag to the whole selection in one call; archived tags are not offered', async () => {
    const state = makeTestState()
    const picked = [state.ids.negroni, state.ids.spritz]
    state.selected = new Set(picked)
    renderWithIntl(
      <WithComposer state={state}>
        <SelectionBar />
      </WithComposer>,
    )
    await userEvent.click(screen.getByTestId('add-tag'))
    const options = await screen.findAllByTestId('add-tag-option')
    expect(names(options)).toEqual(['Signature', 'Spicy', 'Local'])
    await userEvent.click(within(options[2] as HTMLElement).getByText('Local'))
    expect(state.setItemTags).toHaveBeenCalledWith(picked, [state.ids.local], [])
  })

  it('offers “Payment mode…” only where pay first can take effect', () => {
    const state = makeTestState()
    state.selected = new Set([state.ids.negroni])
    renderWithIntl(
      <WithComposer state={state}>
        <SelectionBar />
      </WithComposer>,
    )
    expect(screen.queryByTestId('payment-mode')).toBeNull()
  })

  it('sets the payment mode of the whole selection in one call', async () => {
    const state = makeTestState({ payFirstDefault: 'on_bill' })
    const picked = [state.ids.negroni, state.ids.spritz]
    state.selected = new Set(picked)
    renderWithIntl(
      <WithComposer state={state}>
        <SelectionBar />
      </WithComposer>,
    )
    await userEvent.click(screen.getByTestId('payment-mode'))
    expect(await screen.findByTestId('payment-mode-option-same')).toBeTruthy()
    expect(screen.getByTestId('payment-mode-option-same').textContent).toBe(
      'Same as the venue (On the bill)',
    )
    await userEvent.click(screen.getByTestId('payment-mode-option-pay_first'))
    expect(state.setPaymentMode).toHaveBeenCalledWith(picked, 'pay_first')
  })

  it('“Same as the venue” takes the mode away from the whole selection', async () => {
    const state = makeTestState({ payFirstDefault: 'pay_first' })
    state.selected = new Set([state.ids.negroni])
    renderWithIntl(
      <WithComposer state={state}>
        <SelectionBar />
      </WithComposer>,
    )
    await userEvent.click(screen.getByTestId('payment-mode'))
    await userEvent.click(await screen.findByTestId('payment-mode-option-same'))
    expect(state.setPaymentMode).toHaveBeenCalledWith([state.ids.negroni], null)
  })

  it('removes a tag only from the tags the selection holds, with how many hold it', async () => {
    const state = makeTestState()
    const picked = [state.ids.negroni, state.ids.spritz]
    state.selected = new Set(picked)
    renderWithIntl(
      <WithComposer state={state}>
        <SelectionBar />
      </WithComposer>,
    )
    await userEvent.click(screen.getByTestId('remove-tag'))
    const options = await screen.findAllByTestId('remove-tag-option')
    // Negroni holds Signature and Spicy, Spritz holds Local; the archived Old is not offered.
    expect(options.map((option) => option.textContent)).toEqual([
      'Signature1/2',
      'Spicy1/2',
      'Local1/2',
    ])
    await userEvent.click(options[1] as HTMLElement)
    expect(state.setItemTags).toHaveBeenCalledWith(picked, [], [state.ids.spicy])
  })

  it('cannot remove when no selected item holds a tag', () => {
    const state = makeTestState()
    state.selected = new Set([state.ids.lager, state.ids.stout])
    renderWithIntl(
      <WithComposer state={state}>
        <SelectionBar />
      </WithComposer>,
    )
    expect((screen.getByTestId('remove-tag') as HTMLButtonElement).disabled).toBe(true)
  })

  it('points to the Tags panel when the venue has no tags', async () => {
    const state = makeTestState()
    state.view = { ...state.view, tagIds: [], tags: {} }
    state.selected = new Set([state.ids.negroni])
    renderWithIntl(
      <WithComposer state={state}>
        <SelectionBar />
      </WithComposer>,
    )
    await userEvent.click(screen.getByTestId('add-tag'))
    await userEvent.click(await screen.findByText('No tags yet. Create some.'))
    expect(state.openTagsPanel).toHaveBeenCalledTimes(1)
  })
})

describe('select all and the tag filter', () => {
  it('selects all the items the list shows, and unselects them when all are selected', async () => {
    const state = makeTestState()
    const shown = [state.ids.negroni, state.ids.spritz]
    renderWithIntl(
      <WithComposer state={state}>
        <ItemToolbar visibleIds={shown} totalCount={2} />
      </WithComposer>,
    )
    await userEvent.click(screen.getByTestId('select-all'))
    expect(state.selectItems).toHaveBeenCalledWith(shown, true)
  })

  it('unselects when every shown item is selected already; some are “mixed”', async () => {
    const state = makeTestState()
    const shown = [state.ids.negroni, state.ids.spritz]
    state.selected = new Set(shown)
    const { unmount } = renderWithIntl(
      <WithComposer state={state}>
        <ItemToolbar visibleIds={shown} totalCount={2} />
      </WithComposer>,
    )
    const checkbox = screen.getByTestId('select-all') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    await userEvent.click(checkbox)
    expect(state.selectItems).toHaveBeenCalledWith(shown, false)
    unmount()

    const partial = makeTestState()
    partial.selected = new Set([partial.ids.negroni])
    renderWithIntl(
      <WithComposer state={partial}>
        <ItemToolbar visibleIds={[partial.ids.negroni, partial.ids.spritz]} totalCount={2} />
      </WithComposer>,
    )
    const some = screen.getByTestId('select-all') as HTMLInputElement
    expect(some.checked).toBe(false)
    expect(some.indeterminate).toBe(true)
  })

  it('offers the active tags in the filter and toggles one with the keyboard', async () => {
    const state = makeTestState()
    renderWithIntl(
      <WithComposer state={state}>
        <ItemToolbar visibleIds={[state.ids.negroni, state.ids.spritz]} totalCount={2} />
      </WithComposer>,
    )
    const trigger = screen.getByTestId('tag-filter')
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const options = await screen.findAllByTestId('tag-filter-option')
    expect(options.map((option) => option.textContent)).toEqual(['Signature', 'Spicy', 'Local'])
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(state.toggleTagFilter).toHaveBeenCalledTimes(1)
  })

  it('shows what is filtered by, how many items match, and stops filtering by a tag', async () => {
    const state = makeTestState()
    state.tagFilter = new Set([state.ids.local])
    renderWithIntl(
      <WithComposer state={state}>
        <ItemToolbar visibleIds={[state.ids.spritz]} totalCount={2} />
      </WithComposer>,
    )
    expect(screen.getByTestId('filter-count').textContent).toBe('Showing 1 of 2')
    await userEvent.click(screen.getByRole('button', { name: 'Stop filtering by Local' }))
    expect(state.toggleTagFilter).toHaveBeenCalledWith(state.ids.local)
  })
})

describe('the item list under a filter', () => {
  function pane(state: ReturnType<typeof makeTestState>) {
    return renderWithIntl(
      <WithComposer state={state}>
        <DragDropContext onDragEnd={() => undefined}>
          <ItemPane />
        </DragDropContext>
      </WithComposer>,
    )
  }

  it('shows only the items with the chosen tag in the open section', () => {
    const state = makeTestState({ tagFilter: new Set() })
    state.tagFilter = new Set([state.ids.local])
    pane(state)
    expect(names(screen.getAllByTestId('item-open'))).toEqual(['Spritz'])
  })

  it('shows every item again without a filter, and each row has a checkbox and its chips', () => {
    const state = makeTestState()
    pane(state)
    expect(names(screen.getAllByTestId('item-open'))).toEqual(['Negroni', 'Spritz'])
    expect(screen.getAllByTestId('item-select')).toHaveLength(2)
    const negroni = screen.getAllByTestId('item-row')[0] as HTMLElement
    expect(names(within(negroni).getAllByTestId('tag-chip'))).toEqual(['Signature', 'Spicy'])
  })

  it('says so when the filter hides everything, and clears it', async () => {
    const state = makeTestState()
    state.selection = state.ids.beer
    state.tagFilter = new Set([state.ids.local])
    pane(state)
    expect(screen.getByTestId('filter-empty')).toBeTruthy()
    await userEvent.click(
      within(screen.getByTestId('filter-empty')).getByRole('button', { name: 'Clear filter' }),
    )
    expect(state.clearTagFilter).toHaveBeenCalledTimes(1)
  })

  it('ticks a row with its checkbox', async () => {
    const state = makeTestState()
    pane(state)
    await userEvent.click(screen.getAllByTestId('item-select')[1] as HTMLElement)
    expect(state.toggleSelected).toHaveBeenCalledWith(state.ids.spritz)
  })
})

describe('the Tags panel', () => {
  const languages = { defaultLocale: 'bg_BG', enabledLocales: ['bg_BG', 'en_US'] } as const

  function panel(state = makeTestState()) {
    renderWithIntl(
      <WithComposer state={state}>
        <TagsPanel open onOpenChange={vi.fn()} {...languages} />
      </WithComposer>,
    )
    return state
  }

  it('lists the active tags in order with how many items hold each, and the archived ones apart', () => {
    panel()
    const rows = screen.getAllByTestId('tag-row')
    expect(rows.map((row) => within(row).getByTestId('tag-chip').textContent)).toEqual([
      'Signature',
      'Spicy',
      'Local',
    ])
    expect(within(rows[0] as HTMLElement).getByText('1 item')).toBeTruthy()
    expect(within(screen.getByTestId('tag-archived-list')).getByText('Old')).toBeTruthy()
  })

  it('creates a tag with a name in each language and a colour', async () => {
    const state = panel()
    await userEvent.click(screen.getByTestId('tag-new'))
    await userEvent.type(screen.getByTestId('tag-name-bg_BG'), 'Веган')
    await userEvent.type(screen.getByTestId('tag-name-en_US'), 'Vegan')
    await userEvent.click(screen.getByTestId('tag-color-text'))
    await userEvent.click(screen.getByTestId('tag-form-save'))
    await waitFor(() => expect(state.createTag).toHaveBeenCalledTimes(1))
    expect(state.createTag).toHaveBeenCalledWith(expect.stringMatching(/^tg_[0-9A-Za-z]{22}$/), {
      label: { bg_BG: 'Веган', en_US: 'Vegan' },
      color: 'text',
    })
    // The form closes once the tag is saved.
    await waitFor(() => expect(screen.queryByTestId('tag-create')).toBeNull())
  })

  it('renames and recolours a tag in its row', async () => {
    const state = panel()
    const row = screen.getAllByTestId('tag-row')[1] as HTMLElement
    await userEvent.click(within(row).getByTestId('tag-edit'))
    const name = screen.getByTestId('tag-name-bg_BG') as HTMLInputElement
    expect(name.value).toBe('Spicy')
    await userEvent.clear(name)
    await userEvent.type(name, 'Люто')
    await userEvent.click(screen.getByTestId('tag-color-muted'))
    await userEvent.click(screen.getByTestId('tag-form-save'))
    await waitFor(() =>
      expect(state.updateTag).toHaveBeenCalledWith(state.ids.spicy, {
        label: { bg_BG: 'Люто' },
        color: 'muted',
      }),
    )
  })

  it('archives a tag and restores an archived one', async () => {
    const state = panel()
    await userEvent.click(
      within(screen.getAllByTestId('tag-row')[2] as HTMLElement).getByTestId('tag-archive'),
    )
    expect(state.setTagArchived).toHaveBeenCalledWith(state.ids.local, true)
    await userEvent.click(screen.getByTestId('tag-restore'))
    expect(state.setTagArchived).toHaveBeenCalledWith(state.ids.old, false)
  })

  it('does not create a tag without a name in the venue’s default language', async () => {
    const state = panel()
    await userEvent.click(screen.getByTestId('tag-new'))
    await userEvent.type(screen.getByTestId('tag-name-en_US'), 'Only English')
    await userEvent.click(screen.getByTestId('tag-form-save'))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a name in Bulgarian.')
    expect(state.createTag).not.toHaveBeenCalled()
  })

  it('invites the first tag when the list is empty', () => {
    const state = makeTestState()
    state.view = { ...state.view, tagIds: [], tags: {} }
    panel(state)
    expect(screen.getByTestId('tags-empty')).toBeTruthy()
  })
})
