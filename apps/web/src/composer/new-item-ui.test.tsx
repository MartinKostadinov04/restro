// @vitest-environment jsdom
// "New item" (CF-01, D66): the dialog (the main-language name is required, the price is kept as
// typed), and where the New item buttons are: in a section's header, in Unsorted, in an empty
// list; and where they are not: a venue with a till, a person who is not an owner or admin.
import { DragDropContext } from '@hello-pangea/dnd'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { ItemPane } from './item-pane'
import { NewItemDialog } from './new-item-dialog'
import { makeTestState, WithComposer } from './test-state'

function dialog(overrides: Partial<Parameters<typeof NewItemDialog>[0]> = {}, locale?: 'bg') {
  const onCreate = vi.fn()
  const onOpenChange = vi.fn()
  renderWithIntl(
    <NewItemDialog
      open
      onOpenChange={onOpenChange}
      defaultLocale="bg_BG"
      enabledLocales={['bg_BG', 'en_US']}
      currency="EUR"
      sectionLabel="Cocktails"
      onCreate={onCreate}
      {...overrides}
    />,
    locale ? { locale } : {},
  )
  return { onCreate, onOpenChange, user: userEvent.setup({ delay: null }) }
}

const submit = () => screen.getByTestId('new-item-submit')

describe('the New item dialog', () => {
  it('says where the item goes and labels the price with the venue currency', () => {
    dialog()
    expect(screen.getByText(/It is added to “Cocktails”/)).toBeTruthy()
    expect(screen.getByLabelText(/^Price \(EUR\)/)).toBeTruthy()
    // The main language comes first and is required; the others are optional.
    const labels = screen
      .getAllByLabelText(/^Name \(/)
      .map((input) => input.getAttribute('data-testid'))
    expect(labels).toEqual(['new-item-name-bg_BG', 'new-item-name-en_US'])
  })

  it('needs a name in the main language: another language alone is not enough', async () => {
    const { onCreate, onOpenChange, user } = dialog()
    await user.click(submit())
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Enter a name in the main language.',
    )
    await user.type(screen.getByTestId('new-item-name-en_US'), 'Mojito')
    await user.click(submit())
    expect(screen.getByRole('alert').textContent).toBe('Enter a name in the main language.')
    expect(onCreate).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('sends the names that were typed and the price exactly as typed, then closes', async () => {
    const { onCreate, onOpenChange, user } = dialog()
    await user.type(screen.getByTestId('new-item-name-bg_BG'), '  Мохито ')
    await user.type(screen.getByTestId('new-item-name-en_US'), 'Mojito')
    await user.type(screen.getByTestId('new-item-price'), ' 4,50 ')
    await user.click(submit())
    // The text, not a number: the server converts it with core's money module (rule 8).
    expect(onCreate).toHaveBeenCalledWith({
      name: { bg_BG: 'Мохито', en_US: 'Mojito' },
      price: '4,50',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps a point as typed too, and leaves out a language that was not filled in', async () => {
    const { onCreate, user } = dialog()
    await user.type(screen.getByTestId('new-item-name-bg_BG'), 'Мохито')
    await user.type(screen.getByTestId('new-item-price'), '4.50')
    await user.click(submit())
    expect(onCreate).toHaveBeenCalledWith({ name: { bg_BG: 'Мохито' }, price: '4.50' })
  })

  it('does not need a price', async () => {
    const { onCreate, user } = dialog()
    await user.type(screen.getByTestId('new-item-name-bg_BG'), 'Мохито')
    await user.click(submit())
    expect(onCreate).toHaveBeenCalledWith({ name: { bg_BG: 'Мохито' }, price: '' })
  })

  it('refuses a price that is not a price, and keeps the dialog open', async () => {
    const { onCreate, onOpenChange, user } = dialog()
    await user.type(screen.getByTestId('new-item-name-bg_BG'), 'Мохито')
    for (const text of ['abc', '4.505', '-1', '4,5,0']) {
      await user.clear(screen.getByTestId('new-item-price'))
      await user.type(screen.getByTestId('new-item-price'), text)
      await user.click(submit())
      expect((await screen.findByRole('alert')).textContent, text).toBe(
        'Enter a price like 4.50, with at most two decimals.',
      )
    }
    expect(onCreate).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('works with a single enabled language, and in Bulgarian', async () => {
    const { onCreate, user } = dialog({ enabledLocales: ['en_US'], defaultLocale: 'en_US' }, 'bg')
    expect(screen.getByText('Нов артикул')).toBeTruthy()
    expect(screen.getAllByLabelText(/^Име \(/)).toHaveLength(1)
    await user.type(screen.getByTestId('new-item-name-en_US'), 'Mojito')
    await user.click(submit())
    expect(onCreate).toHaveBeenCalledWith({ name: { en_US: 'Mojito' }, price: '' })
  })
})

function pane(state: ReturnType<typeof makeTestState>) {
  return renderWithIntl(
    <WithComposer state={state}>
      <DragDropContext onDragEnd={() => undefined}>
        <ItemPane />
      </DragDropContext>
    </WithComposer>,
  )
}

describe('where the New item buttons are', () => {
  it('has one in the header of a section; it asks for that section', async () => {
    const state = makeTestState()
    pane(state)
    await userEvent.setup({ delay: null }).click(screen.getByTestId('new-item'))
    expect(state.newItem).toHaveBeenCalledWith(state.ids.cocktails)
  })

  it('has one in the header of Unsorted; it asks for no section', async () => {
    const state = makeTestState()
    state.selection = 'unsorted'
    pane(state)
    await userEvent.setup({ delay: null }).click(screen.getByTestId('new-item'))
    expect(state.newItem).toHaveBeenCalledWith(null)
  })

  it('has one in an empty list too, and the text points at it', async () => {
    const state = makeTestState()
    state.selection = state.ids.stirred
    pane(state)
    expect(screen.getByTestId('item-list-empty').textContent).toContain(
      'Create an item with New item',
    )
    await userEvent.setup({ delay: null }).click(screen.getByTestId('new-item-empty'))
    expect(state.newItem).toHaveBeenCalledWith(state.ids.stirred)
  })

  it('has none in a venue with a till: its items come from the till (D66)', () => {
    const state = makeTestState({ canCreateItem: false, hasTill: true })
    state.selection = state.ids.stirred
    pane(state)
    expect(screen.queryByTestId('new-item')).toBeNull()
    expect(screen.queryByTestId('new-item-empty')).toBeNull()
    const empty = screen.getByTestId('item-list-empty').textContent ?? ''
    expect(empty).toContain('Items come from the till')
    expect(empty).toContain('photos, descriptions and tags are added here')
    expect(empty).not.toContain('New item')
  })

  it('has none for a person who may not create items, and the text does not mention it', () => {
    const state = makeTestState({ canCreateItem: false, hasTill: false })
    state.selection = state.ids.stirred
    pane(state)
    expect(screen.queryByTestId('new-item')).toBeNull()
    expect(screen.queryByTestId('new-item-empty')).toBeNull()
    expect(screen.getByTestId('item-list-empty').textContent).not.toContain('New item')
  })

  it('has none in Unsorted for a venue with a till', () => {
    const state = makeTestState({ canCreateItem: false, hasTill: true })
    state.selection = 'unsorted'
    pane(state)
    expect(screen.queryByTestId('new-item')).toBeNull()
  })

  it('offers the first section when the menu has none at all', async () => {
    const state = makeTestState()
    state.selection = null
    state.view = { ...state.view, rootIds: [], sections: {}, placements: {}, unsortedIds: [] }
    pane(state)
    expect(screen.getByTestId('pane-no-sections').textContent).toContain(
      'Create a section, or connect a till in Settings → Integrations.',
    )
    await userEvent.setup({ delay: null }).click(screen.getByTestId('new-section-empty'))
    expect(state.newSection).toHaveBeenCalledWith(null)
  })
})
