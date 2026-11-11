// @vitest-environment jsdom
// My styles on a screen (D129, #177): the organisation's saved Styles and the design in use at its
// other venues beside Restro's, saving the draft under a name, updating a Style with the current
// design, deleting one with Undo in the toast, and the taps each takes. The Style writes do not
// wait for Done: they are the organisation's, not the venue's. The server actions, the toast and
// the navigation are the only fakes; the frames' own drawing is the Playwright spec's.
import { DEFAULT_DESIGN, designThemeOf, styleValuesOf } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignView } from '@/server/design/service'
import type { MyStyles } from '@/server/design/styles'
import { renderWithIntl } from '@/test-utils'

import { DesignPage } from './design-page'

const actions = vi.hoisted(() => ({
  saveDesignAction: vi.fn(),
  previewDraftAction: vi.fn(),
  saveStyleAction: vi.fn(),
  setStyleStatusAction: vi.fn(),
}))
const refresh = vi.hoisted(() => vi.fn())
vi.mock('@/server/design/actions', () => ({
  saveDesignAction: actions.saveDesignAction,
  saveStyleAction: actions.saveStyleAction,
  setStyleStatusAction: actions.setStyleStatusAction,
}))
vi.mock('@/server/publish/actions', () => ({ previewDraftAction: actions.previewDraftAction }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const MENU = 'nd_0123456789ABCDEFGHIJKL'
const STYLE_ID = 'ds_0123456789ABCDEFGHIJKL'

const COLOURED = {
  ...DEFAULT_DESIGN,
  colors: { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#2563eb' },
}

const SAVED: DesignView = {
  revision: 3,
  design: COLOURED,
  theme: designThemeOf(COLOURED),
  logo: null,
  canEdit: true,
}

/** A Style of the organisation: Club's choices, saved under a name. */
const dark = (screenValue: 'dark' | 'light') =>
  styleValuesOf({
    ...DEFAULT_DESIGN.values,
    general: { ...DEFAULT_DESIGN.values.general, screen: screenValue },
  })

const MINE: MyStyles = {
  saved: [{ id: STYLE_ID, name: 'Club night', style: 'club', values: dark('dark') }],
  venues: [
    {
      venueId: 'vn_9999999999ABCDEFGHIJKL',
      venueName: 'Sea Bar',
      style: 'soft',
      values: dark('light'),
    },
  ],
}

function setup(myStyles: MyStyles = MINE, initial: Partial<DesignView> = {}) {
  return renderWithIntl(
    <DesignPage
      venueId={VENUE}
      venueName="Demo Club"
      initial={{ ...SAVED, ...initial }}
      myStyles={myStyles}
      menuId={MENU}
    />,
    { locale: 'en' },
  )
}

const tiles = () => screen.getAllByTestId('design-my-style-tile')
const tile = (label: string) =>
  tiles().find((one) => one.textContent?.includes(label)) as HTMLElement
const radioOf = (label: string) => within(tile(label)).getByRole('radio') as HTMLInputElement
const premade = (style: string) =>
  within(
    screen
      .getAllByTestId('design-style-tile')
      .find((one) => one.getAttribute('data-style') === style) as HTMLElement,
  ).getByRole('radio') as HTMLInputElement
const done = () => screen.getByTestId('design-done') as HTMLButtonElement

beforeEach(() => {
  actions.saveDesignAction.mockReset().mockResolvedValue({ ok: true, revision: 4 })
  actions.saveStyleAction.mockReset().mockResolvedValue({ ok: true, styleId: STYLE_ID })
  actions.setStyleStatusAction.mockReset().mockResolvedValue({ ok: true, styleId: STYLE_ID })
  actions.previewDraftAction.mockReset().mockResolvedValue({
    ok: true,
    snapshot: fixture('with-images').snapshot,
    overlay: { version: 1, items: {} },
  })
  refresh.mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('My styles', () => {
  it('shows the two groups: Restro’s Styles, then the organisation’s own and its venues’', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Restro styles' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'My styles' })).toBeTruthy()
    expect(tiles()).toHaveLength(2)
    expect(tile('Club night')).toBeTruthy()
    expect(tile('In use at Sea Bar')).toBeTruthy()
  })

  it('ticks one tile across both groups: Basic until a saved Style is picked', async () => {
    setup()
    expect(premade('basic').checked).toBe(true)
    expect(radioOf('Club night').checked).toBe(false)
    await userEvent.click(radioOf('Club night'))
    expect(radioOf('Club night').checked).toBe(true)
    expect(premade('basic').checked).toBe(false)
    // Back to a premade Style, and the saved one is no longer ticked.
    await userEvent.click(premade('editorial'))
    expect(premade('editorial').checked).toBe(true)
    expect(radioOf('Club night').checked).toBe(false)
  })

  it('fills the draft from a saved Style and keeps the venue’s colours and body font', async () => {
    setup()
    await userEvent.click(radioOf('Club night'))
    expect(screen.getByTestId('design-unsaved')).toBeTruthy()
    await userEvent.click(done())
    await waitFor(() => expect(actions.saveDesignAction).toHaveBeenCalledTimes(1))
    const sent = actions.saveDesignAction.mock.lastCall?.[0]
    expect(sent.design.values.general.screen).toBe('dark')
    // The brand stays the venue's: its colours and its body font are not the Style's (D128).
    expect(sent.design.colors).toEqual(COLOURED.colors)
    expect(sent.design.values.general.body_font).toBe(COLOURED.values.general.body_font)
    // The record keeps the premade Style the values came from.
    expect(sent.design.style).toBe('club')
  })

  it('copies another venue’s design without copying that venue’s brand', async () => {
    setup()
    await userEvent.click(radioOf('In use at Sea Bar'))
    await userEvent.click(done())
    await waitFor(() => expect(actions.saveDesignAction).toHaveBeenCalledTimes(1))
    const sent = actions.saveDesignAction.mock.lastCall?.[0]
    expect(sent.design.style).toBe('soft')
    expect(sent.design.colors).toEqual(COLOURED.colors)
    expect(sent.design.values.general.body_font).toBe(COLOURED.values.general.body_font)
  })

  it('saves the draft under a name in three taps and typing, and reloads the list', async () => {
    setup()
    await userEvent.click(premade('editorial'))
    await userEvent.click(screen.getByTestId('design-save-style'))
    await userEvent.type(screen.getByTestId('design-save-style-name'), '  Editorial ours  ')
    await userEvent.click(screen.getByTestId('design-save-style-confirm'))
    await waitFor(() => expect(actions.saveStyleAction).toHaveBeenCalledTimes(1))
    const sent = actions.saveStyleAction.mock.lastCall?.[0]
    expect(sent).toMatchObject({ styleId: null, name: 'Editorial ours', style: 'editorial' })
    // A Style carries no body font: it is the venue's brand.
    expect(sent.values.general.body_font).toBeUndefined()
    expect(sent.values.general.screen).toBe('auto')
    expect(toast.success).toHaveBeenCalledWith('Style saved')
    expect(refresh).toHaveBeenCalled()
  })

  it('opens the box again after a save, so a second Style can be named', async () => {
    setup()
    await userEvent.click(screen.getByTestId('design-save-style'))
    await userEvent.type(screen.getByTestId('design-save-style-name'), 'First')
    await userEvent.click(screen.getByTestId('design-save-style-confirm'))
    await waitFor(() => expect(screen.queryByTestId('design-save-style-dialog')).toBeNull())
    await userEvent.click(screen.getByTestId('design-save-style'))
    await waitFor(() => expect(screen.getByTestId('design-save-style-name')).toBeTruthy())
    // The box opens empty: the name just saved is not still in it.
    expect((screen.getByTestId('design-save-style-name') as HTMLInputElement).value).toBe('')
  })

  it('names a name the organisation already has, and keeps the dialog open', async () => {
    actions.saveStyleAction.mockResolvedValue({ ok: false, error: 'name_taken' })
    setup()
    await userEvent.click(screen.getByTestId('design-save-style'))
    await userEvent.type(screen.getByTestId('design-save-style-name'), 'Club night')
    await userEvent.click(screen.getByTestId('design-save-style-confirm'))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'A style with this name exists. Choose another name.',
      ),
    )
    expect(screen.getByTestId('design-save-style-dialog')).toBeTruthy()
  })

  it('updates a Style with the current design in two taps', async () => {
    setup()
    await userEvent.click(premade('classic'))
    await userEvent.click(screen.getByTestId('design-my-style-menu'))
    await userEvent.click(screen.getByTestId('design-my-style-update'))
    await waitFor(() => expect(actions.saveStyleAction).toHaveBeenCalledTimes(1))
    expect(actions.saveStyleAction.mock.lastCall?.[0]).toMatchObject({
      styleId: STYLE_ID,
      name: 'Club night',
      style: 'classic',
    })
    expect(toast.success).toHaveBeenCalledWith('Club night now holds this design')
    // Updating a Style changes no venue's design: nothing was saved for this venue.
    expect(actions.saveDesignAction).not.toHaveBeenCalled()
  })

  it('deletes a Style in two taps, with Undo in the toast that restores it', async () => {
    setup()
    await userEvent.click(screen.getByTestId('design-my-style-menu'))
    await userEvent.click(screen.getByTestId('design-my-style-delete'))
    await waitFor(() => expect(actions.setStyleStatusAction).toHaveBeenCalledTimes(1))
    expect(actions.setStyleStatusAction.mock.lastCall?.[0]).toEqual({
      styleId: STYLE_ID,
      status: 'removed',
    })
    expect(toast.success).toHaveBeenCalledWith('Style deleted', expect.anything())
    const undo = vi.mocked(toast.success).mock.lastCall?.[1] as {
      action: { label: string; onClick: () => void }
    }
    expect(undo.action.label).toBe('Undo')
    undo.action.onClick()
    await waitFor(() => expect(actions.setStyleStatusAction).toHaveBeenCalledTimes(2))
    expect(actions.setStyleStatusAction.mock.lastCall?.[0]).toEqual({
      styleId: STYLE_ID,
      status: 'active',
    })
    expect(actions.saveDesignAction).not.toHaveBeenCalled()
  })

  it('shows the group to a member who may not edit, with no button and no “…” menu', () => {
    setup(MINE, { canEdit: false })
    expect(screen.getByRole('heading', { name: 'My styles' })).toBeTruthy()
    expect(tiles()).toHaveLength(2)
    expect(screen.queryByTestId('design-save-style')).toBeNull()
    expect(screen.queryByTestId('design-my-style-menu')).toBeNull()
  })

  it('shows a venue’s design even when the organisation has saved no Style', () => {
    setup({ saved: [], venues: MINE.venues })
    expect(tiles()).toHaveLength(1)
    expect(screen.queryByTestId('design-my-style-menu')).toBeNull()
    expect(screen.getByTestId('design-save-style')).toBeTruthy()
  })
})
