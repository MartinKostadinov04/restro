// @vitest-environment jsdom
// The composer's Structure on a screen (brief S6; D88, D89, D90, D92): the subtabs and the URL,
// the menu switcher, the menu layout control, a section's layout toggle, which structure actions
// a venue made by hand and a venue with a till offer, the "Overrides to review" badge, renaming in
// place and the "Delete?" dialog. The server actions and the navigation are the only fakes.
import { DragDropContext } from '@hello-pangea/dnd'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setMenuSettingsAction } from '@/server/menus-actions'
import { renderWithIntl } from '@/test-utils'

import type { ComposerState } from './composer-context'
import { ComposerSubtabs } from './composer-subtabs'
import { DeleteDialog } from './delete-dialog'
import { ItemPane } from './item-pane'
import { MenuBar } from './menu-bar'
import { SectionTree } from './section-tree'
import { makeTestState, type TestState, WithComposer } from './test-state'

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/venues/vn_0123456789ABCDEFGHIJKL',
  search: '',
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
vi.mock('@/server/menus-actions', () => ({ setMenuSettingsAction: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const LIVE = 'nd_0000000000000000000001'
const BRUNCH = 'nd_0000000000000000000002'

beforeEach(() => {
  navigation.replace.mockReset()
  navigation.search = ''
  vi.mocked(setMenuSettingsAction).mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

/** The composer parts below `state`, in the drag-and-drop context they need. */
function inComposer(state: ComposerState, children: React.ReactNode) {
  return renderWithIntl(
    <WithComposer state={state}>
      <DragDropContext onDragEnd={() => {}}>{children}</DragDropContext>
    </WithComposer>,
    { locale: 'en' },
  )
}

/** The test state as a venue made by hand, or as one with a till (sections and items its own). */
function venue(kind: 'hand' | 'till', overrides: Partial<ComposerState> = {}): TestState {
  const state = makeTestState({ hasTill: kind === 'till', ...overrides })
  if (kind === 'hand') {
    // Everything on a venue made by hand is its own.
    for (const id of Object.keys(state.view.sections) as (keyof typeof state.view.sections)[]) {
      const section = state.view.sections[id]
      if (section)
        (state.view.sections as Record<string, typeof section>)[id] = {
          ...section,
          origin: 'owned',
        }
    }
    for (const id of Object.keys(state.view.items) as (keyof typeof state.view.items)[]) {
      const item = state.view.items[id]
      if (item) (state.view.items as Record<string, typeof item>)[id] = { ...item, origin: 'owned' }
    }
  }
  return state
}

describe('the subtabs, Structure and Design (D92)', () => {
  const contents = { structure: <p>the structure</p>, design: <p>the design</p> }

  it('opens Structure without ?sub=, and Design with ?sub=design', () => {
    const { unmount } = renderWithIntl(<ComposerSubtabs contents={contents} />, { locale: 'en' })
    expect(screen.getByRole('tab', { name: 'Structure' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByText('the structure')).toBeTruthy()
    expect(screen.queryByText('the design')).toBeNull()
    unmount()
    navigation.search = 'tab=composer&sub=design'
    renderWithIntl(<ComposerSubtabs contents={contents} />, { locale: 'en' })
    expect(screen.getByRole('tab', { name: 'Design' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('the design')).toBeTruthy()
  })

  it('writes the subtab into the URL and keeps the other parameters', async () => {
    navigation.search = 'tab=composer&menu=nd_x'
    renderWithIntl(<ComposerSubtabs contents={contents} />, { locale: 'en' })
    await userEvent.click(screen.getByRole('tab', { name: 'Design' }))
    expect(navigation.replace).toHaveBeenCalledTimes(1)
    const url = new URL(navigation.replace.mock.calls[0]?.[0] as string, 'http://x')
    expect(url.searchParams.get('sub')).toBe('design')
    expect(url.searchParams.get('menu')).toBe('nd_x')
    expect(url.searchParams.get('tab')).toBe('composer')
  })
})

describe('the menu switcher and the menu layout', () => {
  const MENUS = [
    { id: LIVE, name: null, live: true },
    { id: BRUNCH, name: 'Brunch', live: false },
  ]
  function bar(overrides: Partial<Parameters<typeof MenuBar>[0]> = {}) {
    return renderWithIntl(
      <MenuBar
        venueId={VENUE}
        venueName="Club"
        menus={MENUS}
        currentId={LIVE}
        settings={{}}
        canEdit
        {...overrides}
      />,
      { locale: 'en' },
    )
  }

  it('lists the venue’s menus, the live one marked; a menu without a name is the venue’s', async () => {
    bar()
    await userEvent.click(screen.getByTestId('menu-switcher'))
    const options = screen.getAllByTestId('menu-option')
    expect(options.map((option) => option.textContent)).toEqual(['ClubLive', 'Brunch'])
    expect(within(options[0] as HTMLElement).getByTestId('menu-live')).toBeTruthy()
  })

  it('opens another menu in the URL, leaving the old menu’s section and item behind', async () => {
    navigation.search = 'tab=composer&section=nd_s&item=nd_i'
    bar()
    await userEvent.click(screen.getByTestId('menu-switcher'))
    await userEvent.click(screen.getByRole('option', { name: 'Brunch' }))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1))
    const url = new URL(navigation.replace.mock.calls[0]?.[0] as string, 'http://x')
    expect(url.searchParams.get('menu')).toBe(BRUNCH)
    expect(url.searchParams.get('tab')).toBe('composer')
    expect(url.searchParams.has('section')).toBe(false)
    expect(url.searchParams.has('item')).toBe(false)
  })

  it('shows two columns with the switch for a menu that set none (the look before D92), and saves a change at once', async () => {
    vi.mocked(setMenuSettingsAction).mockResolvedValue({ ok: true } as never)
    bar()
    const layout = screen.getByTestId('menu-layout')
    expect(
      within(layout).getByRole('button', { name: 'Two columns' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByTestId('menu-layout-switch').getAttribute('aria-checked')).toBe('true')
    await userEvent.click(within(layout).getByRole('button', { name: 'List' }))
    await waitFor(() =>
      expect(setMenuSettingsAction).toHaveBeenCalledWith({
        venueId: VENUE,
        menuId: LIVE,
        settings: { layout: 'list', layout_switch: true },
      }),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByTestId('menu-layout-switch'))
    await waitFor(() =>
      expect(setMenuSettingsAction).toHaveBeenLastCalledWith({
        venueId: VENUE,
        menuId: LIVE,
        settings: { layout: 'list', layout_switch: false },
      }),
    )
  })

  it('goes back to what was saved, and says why, when the server refuses', async () => {
    vi.mocked(setMenuSettingsAction).mockResolvedValue({ ok: false, error: 'not_allowed' })
    bar({ settings: { layout: 'one_column', layout_switch: true } })
    const layout = screen.getByTestId('menu-layout')
    await userEvent.click(within(layout).getByRole('button', { name: 'List' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Only an owner or admin can change the menus.'),
    )
    expect(
      within(layout).getByRole('button', { name: 'One column' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('is read-only for someone who may not change it', () => {
    bar({ canEdit: false, settings: { layout: 'two_columns', layout_switch: true } })
    const layout = screen.getByTestId('menu-layout')
    // The segmented control is a disabled fieldset: its buttons are disabled through it.
    expect(within(layout).getByRole('button', { name: 'List' }).matches(':disabled')).toBe(true)
    expect((screen.getByTestId('menu-layout-switch') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('menu-layout-switch').getAttribute('aria-checked')).toBe('true')
  })
})

describe('a section’s layout (D92)', () => {
  it('the toggle in the section’s header lays it out as a horizontal row, or back', async () => {
    const state = venue('till', { selection: undefined })
    state.selection = state.ids.beer
    inComposer(state, <ItemPane />)
    const toggle = screen.getByTestId('section-layout')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(toggle)
    expect(state.setSectionLayout).toHaveBeenCalledWith(state.ids.beer, 'horizontal')
  })

  it('a horizontal section shows as such in the tree and in its header, for till sections too', async () => {
    const state = venue('till')
    const beer = state.view.sections[state.ids.beer]
    if (!beer) throw new Error('the test view has Beer')
    ;(state.view.sections as Record<string, typeof beer>)[state.ids.beer] = {
      ...beer,
      layout: 'horizontal',
    }
    inComposer(state, <SectionTree />)
    const rows = screen.getAllByTestId('section-node')
    const beerRow = rows.find((row) => row.getAttribute('data-section-id') === state.ids.beer)
    expect(within(beerRow as HTMLElement).getByTestId('section-horizontal')).toBeTruthy()
    // Its menu offers the same toggle, checked.
    await userEvent.click(within(beerRow as HTMLElement).getByTestId('section-menu'))
    const item = await screen.findByTestId('section-layout-item')
    expect(item.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(item)
    expect(state.setSectionLayout).toHaveBeenCalledWith(state.ids.beer, 'vertical')
  })
})

/** The row of an item in the open pane. */
function rowOf(itemId: string): HTMLElement {
  const row = screen
    .getAllByTestId('item-row')
    .find((candidate) => candidate.getAttribute('data-item-id') === itemId)
  if (row === undefined) throw new Error(`no row for ${itemId}`)
  return row
}

describe('what each kind of venue may do (D89, D90, D92)', () => {
  async function sectionMenu(state: TestState, sectionId: string) {
    state.selection = sectionId as TestState['selection']
    inComposer(state, <ItemPane />)
    await userEvent.click(
      within(screen.getByTestId('item-pane')).getAllByTestId('section-menu')[0] as HTMLElement,
    )
  }
  /** Opens the menu of an item of Beer (Lager or Stout), in the pane where its row is. */
  async function itemMenu(state: TestState, itemId: string) {
    state.selection = state.ids.beer
    inComposer(state, <ItemPane />)
    await userEvent.click(within(rowOf(itemId)).getByTestId('item-menu'))
  }

  it('a venue made by hand: rename and delete a section, rename and delete an item', async () => {
    const state = venue('hand')
    await sectionMenu(state, state.ids.cocktails)
    expect(await screen.findByTestId('section-rename')).toBeTruthy()
    await userEvent.click(screen.getByTestId('section-delete'))
    expect(state.deleteSection).toHaveBeenCalledWith(state.ids.cocktails)
  })

  it('a venue made by hand: an item is renamed in place and deleted from its menu', async () => {
    const state = venue('hand')
    await itemMenu(state, state.ids.lager)
    await userEvent.click(await screen.findByTestId('item-rename'))
    expect(state.startRename).toHaveBeenCalledWith({ kind: 'item', id: state.ids.lager })
    expect(within(rowOf(state.ids.lager)).getByTestId('item-rename-start')).toBeTruthy()
  })

  it('a venue made by hand: the item’s delete asks first', async () => {
    const state = venue('hand')
    await itemMenu(state, state.ids.lager)
    await userEvent.click(await screen.findByTestId('item-delete'))
    expect(state.deleteItem).toHaveBeenCalledWith(state.ids.lager)
  })

  it('a venue with a till: a till section is renamed and hidden, never deleted', async () => {
    const state = venue('till')
    await sectionMenu(state, state.ids.beer)
    expect(await screen.findByTestId('section-rename')).toBeTruthy()
    expect(screen.queryByTestId('section-delete')).toBeNull()
  })

  it('a venue with a till: its own section can be deleted', async () => {
    const state = venue('till')
    const beer = state.view.sections[state.ids.beer]
    if (!beer) throw new Error('the test view has Beer')
    ;(state.view.sections as Record<string, typeof beer>)[state.ids.beer] = {
      ...beer,
      origin: 'owned',
    }
    await sectionMenu(state, state.ids.beer)
    expect(await screen.findByTestId('section-delete')).toBeTruthy()
  })

  it('a venue with a till: no item is renamed in place or deleted (its name is in the sheet)', async () => {
    const state = venue('till')
    await itemMenu(state, state.ids.lager)
    expect(await screen.findByRole('menuitem', { name: /^Open/ })).toBeTruthy()
    expect(screen.queryByTestId('item-rename')).toBeNull()
    expect(screen.queryByTestId('item-delete')).toBeNull()
    expect(screen.queryByTestId('item-rename-start')).toBeNull()
  })

  it('someone who is not an owner or admin deletes nothing', async () => {
    const state = venue('hand', { canDelete: false })
    await sectionMenu(state, state.ids.cocktails)
    expect(await screen.findByTestId('section-rename')).toBeTruthy()
    expect(screen.queryByTestId('section-delete')).toBeNull()
  })
})

describe('renaming in place', () => {
  it('a section: the pencil starts it, Enter saves the new title', async () => {
    const state = venue('hand')
    state.selection = state.ids.beer
    const { rerender } = inComposer(state, <ItemPane />)
    await userEvent.click(screen.getByTestId('section-rename-start'))
    expect(state.startRename).toHaveBeenCalledWith({ kind: 'section', id: state.ids.beer })
    state.renaming = { kind: 'section', id: state.ids.beer }
    rerender(
      <WithComposer state={{ ...state }}>
        <DragDropContext onDragEnd={() => {}}>
          <ItemPane />
        </DragDropContext>
      </WithComposer>,
    )
    const input = screen.getByTestId('section-rename-field-input') as HTMLInputElement
    expect(input.value).toBe('Section a1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Beers{Enter}')
    expect(state.renameSection).toHaveBeenCalledWith(state.ids.beer, 'Beers')
  })

  it('an item: Escape cancels, and an unchanged name saves nothing', async () => {
    const state = venue('hand', { renaming: null })
    state.renaming = { kind: 'item', id: state.ids.lager }
    state.selection = state.ids.beer
    inComposer(state, <ItemPane />)
    const input = within(rowOf(state.ids.lager)).getByTestId('item-rename-field-input')
    await userEvent.type(input, '{Enter}')
    expect(state.renameItem).not.toHaveBeenCalled()
    expect(state.startRename).toHaveBeenCalledWith(null)
    await userEvent.type(input, ' lager{Escape}')
    expect(state.renameItem).not.toHaveBeenCalled()
  })
})

describe('"Overrides to review" (V12)', () => {
  it('is a badge on the item with a stale override, and none on the others', () => {
    const state = venue('till')
    const lager = state.view.items[state.ids.lager]
    if (!lager) throw new Error('the test view has Lager')
    ;(state.view.items as Record<string, typeof lager>)[state.ids.lager] = {
      ...lager,
      reviewFields: ['name', 'description'],
    }
    state.selection = state.ids.beer
    inComposer(state, <ItemPane />)
    expect(within(rowOf(state.ids.stout)).queryByTestId('review-badge')).toBeNull()
    const badges = screen.getAllByTestId('review-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0]?.getAttribute('data-count')).toBe('2')
    expect(badges[0]?.textContent).toBe('2 overrides to review')
  })
})

describe('the "Delete?" dialog', () => {
  it('names what goes and where its items go, and deletes only when confirmed', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    renderWithIntl(
      <DeleteDialog
        target={{ kind: 'section', name: 'Cocktails' }}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
      { locale: 'en' },
    )
    const dialog = screen.getByTestId('delete-dialog')
    expect(within(dialog).getByText('Delete Cocktails?')).toBeTruthy()
    expect(dialog.textContent).toContain('Their items move to Unsorted')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('delete-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
