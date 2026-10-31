// @vitest-environment jsdom
// The Design page on a screen (D129, #175): Style tiles, the three colours and the fonts in a draft,
// Undo, Cancel, Done with the revision it loaded, a refused save, an unreadable pair, the leave
// warning, the read-only view and a preview that could not load. The server actions, the toast and
// the navigation are the only fakes. The frames' own drawing is the Playwright spec's (design.spec.ts).
import { DEFAULT_DESIGN, designThemeOf } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignView } from '@/server/design/service'
import { renderWithIntl } from '@/test-utils'

import { DesignPage } from './design-page'

const actions = vi.hoisted(() => ({ saveDesignAction: vi.fn(), previewDraftAction: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/server/design/actions', () => ({ saveDesignAction: actions.saveDesignAction }))
vi.mock('@/server/publish/actions', () => ({ previewDraftAction: actions.previewDraftAction }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const MENU = 'nd_0123456789ABCDEFGHIJKL'
const OVERLAY = { version: 1, items: {} }
const BRAND = '#2563eb'

const COLOURED = {
  ...DEFAULT_DESIGN,
  colors: { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: BRAND },
}

const SAVED: DesignView = {
  revision: 3,
  design: COLOURED,
  theme: designThemeOf(COLOURED),
  logo: null,
  canEdit: true,
}

function setup(initial: Partial<DesignView> = {}) {
  return renderWithIntl(
    <DesignPage
      venueId={VENUE}
      venueName="Demo Club"
      initial={{ ...SAVED, ...initial }}
      menuId={MENU}
    />,
    { locale: 'en' },
  )
}

const done = () => screen.getByTestId('design-done') as HTMLButtonElement
const cancel = () => screen.getByTestId('design-cancel') as HTMLButtonElement
const undo = () => screen.getByTestId('design-undo') as HTMLButtonElement
const brand = () => screen.getByLabelText('Your brand colour') as HTMLInputElement
const type = (element: HTMLInputElement, value: string) =>
  fireEvent.change(element, { target: { value } })
const radio = (style: string) =>
  within(
    screen
      .getAllByTestId('design-style-tile')
      .find((tile) => tile.getAttribute('data-style') === style) as HTMLElement,
  ).getByRole('radio') as HTMLInputElement

/** The design the last save sent. */
const sent = () => actions.saveDesignAction.mock.lastCall?.[0]

beforeEach(() => {
  actions.saveDesignAction.mockReset().mockResolvedValue({ ok: true, revision: 4 })
  actions.previewDraftAction.mockReset().mockResolvedValue({
    ok: true,
    snapshot: fixture('with-images').snapshot,
    overlay: OVERLAY,
  })
  push.mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Design page', () => {
  it('opens with nothing to save, the saved Style chosen, the preview and the switcher', async () => {
    setup()
    expect(done().disabled).toBe(true)
    expect(cancel().disabled).toBe(true)
    expect(undo().disabled).toBe(true)
    expect(screen.queryByTestId('design-unsaved')).toBeNull()
    expect(radio('basic').checked).toBe(true)
    // Only the Styles with a file are offered; all five have one since #178.
    expect(
      screen.getAllByTestId('design-style-tile').map((tile) => tile.getAttribute('data-style')),
    ).toEqual(['basic', 'editorial', 'soft', 'classic', 'club'])
    const preview = within(screen.getByTestId('design-preview'))
    expect(preview.getByRole('button', { name: 'Phone' }).getAttribute('aria-pressed')).toBe('true')
    expect(preview.getByRole('button', { name: 'Tablet' })).toBeTruthy()
    expect(preview.getByRole('button', { name: 'PC' })).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('design-preview-frame')).toBeTruthy())
    expect((screen.getByTestId('design-preview-frame') as HTMLIFrameElement).style.width).toBe(
      '390px',
    )
    await userEvent.click(preview.getByRole('button', { name: 'PC' }))
    expect((screen.getByTestId('design-preview-frame') as HTMLIFrameElement).style.width).toBe(
      '1280px',
    )
  })

  it('a look saved with one brand colour opens with nothing to save, and leaving asks nothing', () => {
    const old = { ...DEFAULT_DESIGN, brand: BRAND } as DesignView['design']
    setup({ design: old, theme: designThemeOf(old) })
    expect(done().disabled).toBe(true)
    expect(cancel().disabled).toBe(true)
    expect(screen.queryByTestId('design-unsaved')).toBeNull()
    fireEvent.click(screen.getByTestId('design-back'))
    expect(screen.queryByTestId('design-leave')).toBeNull()
  })

  it('a Style fills the draft and keeps the colours; Done saves the whole design from the loaded revision', async () => {
    setup()
    await userEvent.click(radio('editorial'))
    expect(radio('editorial').checked).toBe(true)
    expect(screen.getByTestId('design-unsaved').textContent).toBe('Unsaved')
    await userEvent.click(done())
    await waitFor(() => expect(actions.saveDesignAction).toHaveBeenCalledTimes(1))
    expect(sent()).toMatchObject({
      venueId: VENUE,
      expectedRevision: 3,
      design: { style: 'editorial', colors: COLOURED.colors, logo_asset_id: null },
    })
    expect(sent().design.values.general.buttons).toBe('ink')
    expect(sent().design.values.general.body_font).toBe(COLOURED.values.general.body_font)
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Design saved. Guests see it on the next publish.',
      ),
    )
    expect(done().disabled).toBe(true)
    expect(undo().disabled).toBe(true)
    expect(screen.queryByTestId('design-unsaved')).toBeNull()

    // The next save names the new revision.
    await userEvent.click(radio('basic'))
    await userEvent.click(done())
    await waitFor(() => expect(actions.saveDesignAction).toHaveBeenCalledTimes(2))
    expect(sent().expectedRevision).toBe(4)
  })

  it('Undo takes back the last step; Cancel everything since the last save', async () => {
    setup()
    await userEvent.click(radio('editorial'))
    type(brand(), '#16a34a')
    expect(brand().value).toBe('#16a34a')
    await userEvent.click(undo())
    expect(brand().value).toBe(BRAND)
    expect(radio('editorial').checked).toBe(true)
    await userEvent.click(undo())
    expect(radio('basic').checked).toBe(true)
    expect(undo().disabled).toBe(true)
    expect(done().disabled).toBe(true)

    await userEvent.click(radio('editorial'))
    type(brand(), '#16a34a')
    await userEvent.click(cancel())
    expect(radio('basic').checked).toBe(true)
    expect(brand().value).toBe(BRAND)
    expect(done().disabled).toBe(true)
    expect(actions.saveDesignAction).not.toHaveBeenCalled()
  })

  it('half a colour turns Done off and says so; the look comes back with a whole one', () => {
    setup()
    type(brand(), '#25')
    expect(done().disabled).toBe(true)
    expect(screen.getByTestId('design-status').textContent).toContain('not complete')
    type(brand(), '#16a34a')
    expect(done().disabled).toBe(false)
    expect(screen.queryByTestId('design-status')).toBeNull()
  })

  it('a refused stale save shows the stored design, says so and stays', async () => {
    const stored = { ...COLOURED, colors: { ...COLOURED.colors, tertiary: '#e11d48' } }
    actions.saveDesignAction.mockResolvedValue({
      ok: false,
      error: 'stale',
      view: { ...SAVED, revision: 7, design: stored, theme: designThemeOf(stored) },
    })
    setup()
    type(brand(), '#16a34a')
    await userEvent.click(done())
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Someone else saved this design. Showing their version.',
        { duration: Number.POSITIVE_INFINITY, closeButton: true },
      ),
    )
    expect(brand().value).toBe('#e11d48')
    expect(done().disabled).toBe(true)
    // The next save starts from the revision it now holds.
    type(brand(), '#16a34a')
    actions.saveDesignAction.mockResolvedValue({ ok: true, revision: 8 })
    await userEvent.click(done())
    await waitFor(() => expect(sent().expectedRevision).toBe(7))
  })

  it('says what went wrong when the save fails, and keeps the edits', async () => {
    actions.saveDesignAction.mockRejectedValue(new Error('network'))
    setup()
    type(brand(), '#16a34a')
    await userEvent.click(done())
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Something went wrong. Try again.'),
    )
    expect(brand().value).toBe('#16a34a')
    await waitFor(() => expect(done().disabled).toBe(false))
  })

  it('asks before leaving with unsaved edits, and warns the browser too', async () => {
    const adding = vi.spyOn(window, 'addEventListener')
    setup()
    expect(adding.mock.calls.some(([name]) => name === 'beforeunload')).toBe(false)
    // Nothing to lose yet: the link just goes.
    const back = screen.getByTestId('design-back')
    expect(back.getAttribute('href')).toBe(`/venues/${VENUE}?tab=studio&menu=${MENU}`)

    type(brand(), '#16a34a')
    expect(adding.mock.calls.some(([name]) => name === 'beforeunload')).toBe(true)
    await userEvent.click(back)
    const dialog = within(screen.getByTestId('design-leave'))
    expect(dialog.getByText('Leave without saving?')).toBeTruthy()
    await userEvent.click(dialog.getByRole('button', { name: 'Keep editing' }))
    expect(push).not.toHaveBeenCalled()
    expect(brand().value).toBe('#16a34a')

    await userEvent.click(back)
    await userEvent.click(
      within(screen.getByTestId('design-leave')).getByRole('button', { name: 'Leave' }),
    )
    expect(push).toHaveBeenCalledWith(`/venues/${VENUE}?tab=studio&menu=${MENU}`)
  })

  it('is read-only for someone who may not change it: no Done, no Cancel, no Undo', () => {
    setup({ canEdit: false })
    expect(screen.getByTestId('design-read-only').textContent).toContain('owners and admins')
    expect(screen.queryByTestId('design-bar')).toBeNull()
    expect(screen.queryByTestId('design-done')).toBeNull()
    expect(screen.queryByTestId('design-cancel')).toBeNull()
    expect(screen.queryByTestId('design-undo')).toBeNull()
    expect(radio('basic').disabled).toBe(true)
    expect(brand().disabled).toBe(true)
    expect((screen.getByTestId('design-body-font') as HTMLButtonElement).disabled).toBe(true)
  })

  it('says so when the preview cannot load, offers Retry, and the panel stays usable', async () => {
    actions.previewDraftAction.mockRejectedValueOnce(new Error('network'))
    setup()
    await waitFor(() =>
      expect(screen.getByTestId('design-preview-error').textContent).toBe(
        "The preview couldn't load. Try again.",
      ),
    )
    type(brand(), '#16a34a')
    expect(done().disabled).toBe(false)
    await userEvent.click(
      within(screen.getByTestId('design-preview')).getByRole('button', { name: 'Try again' }),
    )
    await waitFor(() => expect(screen.getByTestId('design-preview-frame')).toBeTruthy())
  })
})
