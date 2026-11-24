// @vitest-environment jsdom
// The Design page on a screen (D129, #175): Style tiles, the three colours and the fonts in a draft,
// Undo, Cancel, Done with the revision it loaded, a refused save, an unreadable pair, the leave
// warning, the read-only view and a preview that could not load; the list of parts (D159), its
// summaries, opening a part and back, the address's `?part=` and the level switch. The server
// actions, the toast and the navigation are the only fakes. The frames' own drawing is the
// Playwright spec's (design.spec.ts).
import { DEFAULT_DESIGN, designThemeOf } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignView } from '@/server/design/service'
import { renderWithIntl } from '@/test-utils'

import { DesignPage } from './design-page'

const actions = vi.hoisted(() => ({
  saveDesignAction: vi.fn(),
  previewDraftAction: vi.fn(),
  saveStyleAction: vi.fn(),
  setStyleStatusAction: vi.fn(),
}))
const push = vi.hoisted(() => vi.fn())
/** What the address's `?part=` says when the page loads. */
const address = vi.hoisted(() => ({ part: null as string | null }))
const uploadImage = vi.hoisted(() => vi.fn())
vi.mock('@/composer/item-sheet-upload', async (original) => ({
  ...(await original<typeof import('@/composer/item-sheet-upload')>()),
  uploadImage,
}))
vi.mock('@/server/design/actions', () => ({
  saveDesignAction: actions.saveDesignAction,
  saveStyleAction: actions.saveStyleAction,
  setStyleStatusAction: actions.setStyleStatusAction,
}))
vi.mock('@/server/publish/actions', () => ({ previewDraftAction: actions.previewDraftAction }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(address.part === null ? '' : `part=${address.part}`),
}))

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
      myStyles={{ saved: [], venues: [] }}
      menuId={MENU}
    />,
    { locale: 'en' },
  )
}

/**
 * Opens a part of the panel from its list (D159), back to the list first when another is open; a
 * part already open stays.
 */
function show(part: string) {
  const open = screen.queryByTestId('design-part-page')
  if (open?.getAttribute('data-part') === part) return
  if (open !== null) fireEvent.click(screen.getByTestId('design-part-back'))
  fireEvent.click(screen.getByTestId(`design-part-${part}`))
}
const openPart = () => screen.queryByTestId('design-part-page')?.getAttribute('data-part') ?? null
const row = (part: string) => screen.getByTestId(`design-part-${part}`)

const done = () => screen.getByTestId('design-done') as HTMLButtonElement
const cancel = () => screen.getByTestId('design-cancel') as HTMLButtonElement
const undo = () => screen.getByTestId('design-undo') as HTMLButtonElement
const brand = () => {
  show('colours')
  return screen.getByLabelText('Your brand colour') as HTMLInputElement
}
const type = (element: HTMLInputElement, value: string) =>
  fireEvent.change(element, { target: { value } })
const radio = (style: string) => {
  show('style')
  return within(
    screen
      .getAllByTestId('design-style-tile')
      .find((tile) => tile.getAttribute('data-style') === style) as HTMLElement,
  ).getByRole('radio') as HTMLInputElement
}

const pageColour = () => {
  show('colours')
  return document.querySelector(
    '[data-colour="primary"] input:not([type="color"])',
  ) as HTMLInputElement
}
const bodyFont = () => {
  show('fonts')
  return screen.getByTestId('design-body-font') as HTMLButtonElement
}
const level = (name: 'Simple' | 'Advanced') =>
  userEvent.click(
    within(screen.getByRole('group', { name: 'Level of detail' })).getByRole('button', { name }),
  )

/** A promise the test settles by hand. */
function deferred<T>() {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

const realUrls = {
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
}
afterEach(() => {
  Object.assign(URL, realUrls)
})

/** The local links made for chosen files, and the ones released (the real ones come back after). */
function fakeObjectUrls() {
  const made: string[] = []
  const revoked: string[] = []
  Object.assign(URL, {
    createObjectURL: (_file: Blob) => {
      const url = `blob:logo-${made.length + 1}`
      made.push(url)
      return url
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url)
    },
  })
  return { made, revoked }
}

async function chooseLogo() {
  show('colours')
  const file = new File([new Uint8Array(64)], 'logo.png', { type: 'image/png' })
  await userEvent.upload(screen.getByTestId('design-logo-input') as HTMLInputElement, file)
}

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
  address.part = null
  // The address of the page: jsdom keeps one for the whole file.
  window.history.replaceState(null, '', '/')
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
    // The panel opens on its list of parts.
    expect(screen.getByTestId('design-part-list')).toBeTruthy()
    expect(openPart()).toBeNull()
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
    expect(brand().value).toBe(BRAND)
    expect(screen.queryByTestId('design-unsaved')).toBeNull()
    fireEvent.click(screen.getByTestId('design-back'))
    expect(screen.queryByTestId('design-leave')).toBeNull()
  })

  it('keeps that one brand colour until a colour is touched (DA-13)', async () => {
    const old = { ...DEFAULT_DESIGN, brand: BRAND } as DesignView['design']
    setup({ design: old, theme: designThemeOf(old) })
    // Another option is saved on its own: the brand colour stays, so no colour role is rewritten.
    await userEvent.click(radio('editorial'))
    await userEvent.click(done())
    await waitFor(() => expect(actions.saveDesignAction).toHaveBeenCalledTimes(1))
    expect(sent().design).toMatchObject({ style: 'editorial', brand: BRAND })
    expect(sent().design).not.toHaveProperty('colors')

    // The first colour the person sets turns the look into its three colours.
    type(brand(), '#16a34a')
    await userEvent.click(done())
    await waitFor(() => expect(actions.saveDesignAction).toHaveBeenCalledTimes(2))
    expect(sent().design).not.toHaveProperty('brand')
    expect(sent().design.colors.tertiary).toBe('#16a34a')
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

  // DA-38: each refusal has its own message. One generic toast for every one of them would pass
  // nothing here, and the owner would be told to try again where the answer is "you may not".
  const REFUSALS = [
    ['forbidden', 'Only owners and admins can change the design.'],
    ['not_found', 'This venue could not be found.'],
    ['unreadable', 'The look was not saved: some text would be hard to read.'],
    ['logo_not_usable', 'That logo could not be used. Upload it again.'],
    ['failed', 'Something went wrong. Try again.'],
    ['invalid', 'Check the look and try again.'],
  ] as const

  it('has a message of its own for every save refusal, and no two are the same', () => {
    expect(new Set(REFUSALS.map(([, message]) => message)).size).toBe(REFUSALS.length)
  })

  for (const [error, message] of REFUSALS) {
    it(`says what a save refused as ${error} means, and keeps the edits`, async () => {
      actions.saveDesignAction.mockResolvedValue(
        error === 'unreadable' ? { ok: false, error, issues: [] } : { ok: false, error },
      )
      setup()
      type(brand(), '#16a34a')
      await userEvent.click(done())
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
      // The refusal is the only toast, and the edit is still there to try again with.
      expect(vi.mocked(toast.error).mock.calls).toEqual([[message]])
      expect(toast.success).not.toHaveBeenCalled()
      expect(brand().value).toBe('#16a34a')
    })
  }

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

  it('picking the Style the venue is on changes nothing: no step, nothing unsaved (C7)', async () => {
    setup()
    await userEvent.click(radio('basic'))
    expect(radio('basic').checked).toBe(true)
    expect(undo().disabled).toBe(true)
    expect(done().disabled).toBe(true)
    expect(screen.queryByTestId('design-unsaved')).toBeNull()
  })

  it('an edit made while Done is saving stays, as an unsaved change (C3)', async () => {
    const save = deferred<{ ok: true; revision: number }>()
    actions.saveDesignAction.mockReturnValueOnce(save.promise)
    setup()
    await userEvent.click(radio('editorial'))
    await userEvent.click(done())
    type(brand(), '#16a34a')
    await act(async () => save.settle({ ok: true, revision: 4 }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(brand().value).toBe('#16a34a')
    expect(radio('editorial').checked).toBe(true)
    expect(screen.getByTestId('design-unsaved')).toBeTruthy()
    expect(done().disabled).toBe(false)
    // Undo still takes back the colour; the Style was saved.
    expect(undo().disabled).toBe(false)
  })

  it('a logo that finishes going up after other edits keeps those edits (C4)', async () => {
    fakeObjectUrls()
    const upload = deferred<{ ok: true; assetId: string }>()
    uploadImage.mockReturnValueOnce(upload.promise)
    setup()
    await chooseLogo()
    type(brand(), '#16a34a')
    await userEvent.click(radio('editorial'))
    await act(async () => upload.settle({ ok: true, assetId: 'as_0123456789ABCDEFGHIJKL' }))
    show('colours')
    await waitFor(() =>
      expect(screen.getByTestId('design-logo-image').getAttribute('src')).toBe('blob:logo-1'),
    )
    expect(brand().value).toBe('#16a34a')
    expect(radio('editorial').checked).toBe(true)
    await userEvent.click(done())
    await waitFor(() => expect(actions.saveDesignAction).toHaveBeenCalledTimes(1))
    expect(sent().design).toMatchObject({
      style: 'editorial',
      logo_asset_id: 'as_0123456789ABCDEFGHIJKL',
    })
    expect(sent().design.colors.tertiary).toBe('#16a34a')
  })

  it('keeps a new logo picture across Simple, Advanced and Undo, until the page goes (C5)', async () => {
    const urls = fakeObjectUrls()
    uploadImage.mockResolvedValueOnce({ ok: true, assetId: 'as_0123456789ABCDEFGHIJKL' })
    const { unmount } = setup()
    await chooseLogo()
    await waitFor(() => expect(screen.getByTestId('design-logo-image')).toBeTruthy())
    await level('Advanced')
    await level('Simple')
    type(brand(), '#16a34a')
    await userEvent.click(undo())
    expect(screen.getByTestId('design-logo-image').getAttribute('src')).toBe('blob:logo-1')
    expect(urls.revoked).toEqual([])
    unmount()
    expect(urls.revoked).toEqual(['blob:logo-1'])
  })

  it('releases a new logo picture as soon as no step can show it again (C5)', async () => {
    const urls = fakeObjectUrls()
    uploadImage.mockResolvedValueOnce({ ok: true, assetId: 'as_0123456789ABCDEFGHIJKL' })
    setup()
    await chooseLogo()
    await waitFor(() => expect(screen.getByTestId('design-logo-image')).toBeTruthy())
    expect(urls.revoked).toEqual([])
    await userEvent.click(cancel())
    expect(screen.queryByTestId('design-logo-image')).toBeNull()
    expect(urls.revoked).toEqual(['blob:logo-1'])
  })

  it('a logo going up keeps its progress across Simple and Advanced, and Upload and Done wait', async () => {
    fakeObjectUrls()
    const upload = deferred<{ ok: true; assetId: string }>()
    uploadImage.mockReturnValueOnce(upload.promise)
    setup()
    type(brand(), '#16a34a')
    await chooseLogo()
    await level('Advanced')
    await level('Simple')
    const button = () => screen.getByTestId('design-logo-upload') as HTMLButtonElement
    expect(button().disabled).toBe(true)
    expect(button().textContent).toContain('0%')
    expect(done().disabled).toBe(true)
    await act(async () => upload.settle({ ok: true, assetId: 'as_0123456789ABCDEFGHIJKL' }))
    await waitFor(() => expect(button().disabled).toBe(false))
    expect(done().disabled).toBe(false)
  })

  it('on a phone docks the preview above the bar, with no width switch (S3, S4)', () => {
    setup()
    const dock = screen.getByTestId('design-dock')
    expect(dock.className).toContain('sticky')
    expect(dock.className).toContain('md:contents')
    expect(within(dock).getByTestId('design-preview-section')).toBeTruthy()
    expect(within(dock).getByTestId('design-bar')).toBeTruthy()
    expect(screen.getByTestId('design-preview-devices').className).toContain('hidden md:block')
  })

  it('the docked preview steps aside while a text box has the keyboard (S3)', () => {
    setup()
    const section = () => screen.getByTestId('design-preview-section')
    expect(section().className).not.toContain('max-md:hidden')
    fireEvent.focusIn(brand())
    expect(section().className).toContain('max-md:hidden')
    fireEvent.focusOut(brand())
    expect(section().className).not.toContain('max-md:hidden')
  })

  it('the docked preview comes back when the keyboard closes and the box keeps the focus (S3)', () => {
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 800 })
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    try {
      setup()
      const hidden = () =>
        screen.getByTestId('design-preview-section').className.includes('max-md:hidden')
      fireEvent.focusIn(brand())
      expect(hidden()).toBe(false)
      act(() => {
        viewport.height = 450
        viewport.dispatchEvent(new Event('resize'))
      })
      expect(hidden()).toBe(true)
      act(() => {
        viewport.height = 800
        viewport.dispatchEvent(new Event('resize'))
      })
      expect(hidden()).toBe(false)
    } finally {
      Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  it('says the preview is loading while it is built (S5)', () => {
    actions.previewDraftAction.mockReturnValueOnce(new Promise(() => {}))
    setup()
    expect(screen.getByTestId('design-preview-loading').textContent).toBe('Loading the preview…')
  })

  it('says quietly that a Style tile is loading while its picture is drawn', () => {
    actions.previewDraftAction.mockReturnValueOnce(new Promise(() => {}))
    setup()
    show('style')
    const tile = screen.getAllByTestId('design-style-tile')[0] as HTMLElement
    const loading = within(tile).getByTestId('design-tile-loading')
    expect(loading.textContent).toBe('Loading…')
    expect(loading.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes the loading note away once the frame has loaded (S5)', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('design-preview-frame')).toBeTruthy())
    fireEvent.load(screen.getByTestId('design-preview-frame'))
    expect(screen.queryByTestId('design-preview-loading')).toBeNull()
  })

  it('shows an empty swatch for a brand colour not chosen yet, not a grey one (S9)', () => {
    setup({ design: DEFAULT_DESIGN, theme: designThemeOf(DEFAULT_DESIGN) })
    expect(brand().value).toBe('')
    const field = () => brand().closest('div') as HTMLElement
    expect(within(field()).getByTestId('hex-field-empty')).toBeTruthy()
    type(brand(), '#16a34a')
    expect(within(field()).queryByTestId('hex-field-empty')).toBeNull()
  })

  it('warns of a strong page colour when guests can get a light screen, whatever the preview shows (R2)', async () => {
    setup()
    type(pageColour(), '#e11d48')
    expect(screen.getByTestId('design-saturation-warning')).toBeTruthy()
    // The preview's own switch is for looking; guests still get the design's screen.
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Screen colours' })).getByRole('button', {
        name: 'Dark',
      }),
    )
    expect(screen.getByTestId('design-saturation-warning')).toBeTruthy()
  })

  it('says nothing of a strong page colour on a design with a dark screen (R2)', () => {
    const dark = {
      ...COLOURED,
      values: {
        ...COLOURED.values,
        general: { ...COLOURED.values.general, screen: 'dark' as const },
      },
    }
    setup({ design: dark, theme: designThemeOf(dark) })
    type(pageColour(), '#e11d48')
    expect(screen.queryByTestId('design-saturation-warning')).toBeNull()
  })

  it('is read-only for someone who may not change it: no Done, no Cancel, no Undo', () => {
    setup({ canEdit: false })
    expect(screen.getByTestId('design-read-only').textContent).toContain('owners and admins')
    expect(screen.queryByTestId('design-bar')).toBeNull()
    expect(screen.queryByTestId('design-done')).toBeNull()
    expect(screen.queryByTestId('design-cancel')).toBeNull()
    expect(screen.queryByTestId('design-undo')).toBeNull()
    // The list opens every part; nothing in them can be changed.
    expect(screen.getByTestId('design-part-list')).toBeTruthy()
    expect(radio('basic').disabled).toBe(true)
    expect(brand().disabled).toBe(true)
    expect(bodyFont().disabled).toBe(true)
    show('layout')
    const layout = within(screen.getByTestId('design-layout'))
    for (const button of layout.getAllByRole('button')) {
      expect(button.matches(':disabled')).toBe(true)
    }
    expect(layout.getByRole('switch').matches(':disabled')).toBe(true)
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

describe('the list of parts (D159)', () => {
  /** The saved design with some values of its own. */
  function designWith(general: Record<string, string>, items: Record<string, string> = {}) {
    const design = {
      ...COLOURED,
      values: {
        ...COLOURED.values,
        general: { ...COLOURED.values.general, ...general },
        items: { ...COLOURED.values.items, ...items },
      },
    } as DesignView['design']
    return { design, theme: designThemeOf(design) }
  }
  const advancedPressed = () =>
    within(screen.getByRole('group', { name: 'Level of detail' }))
      .getByRole('button', { name: 'Advanced' })
      .getAttribute('aria-pressed')

  it('Simple lists the Style, Colours and logo, Fonts and Layout, each with its summary', () => {
    setup(
      designWith(
        { body_font: 'lora', heading_font: 'playfair-display' },
        { layout: 'two', guest_switch: 'off' },
      ),
    )
    const list = screen.getByTestId('design-part-list')
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.dataset.part),
    ).toEqual(['style', 'colours', 'fonts', 'layout'])
    // No "Parts of the menu" in Simple.
    expect(screen.queryByRole('heading', { name: 'Parts of the menu' })).toBeNull()
    // The summary is read whole in the row's name; on the screen it is one line, cut if long.
    expect(row('style').getAttribute('aria-label')).toBe('Style: Basic, changed')
    expect(row('colours').getAttribute('aria-label')).toBe('Colours and logo: No logo')
    expect(within(row('colours')).getAllByTestId('design-part-dot')).toHaveLength(3)
    expect(row('fonts').getAttribute('aria-label')).toBe('Fonts: Lora · Playfair Display')
    expect(row('layout').getAttribute('aria-label')).toBe(
      'Layout: Two columns · guests cannot switch',
    )
    const summary = within(row('layout')).getByText('Two columns · guests cannot switch')
    expect(summary.className).toContain('truncate')
    expect(summary.getAttribute('aria-hidden')).toBe('true')
    // Each font's name is drawn in that font.
    const body = within(row('fonts')).getByText('Lora')
    const heading = within(row('fonts')).getByText('Playfair Display')
    expect(body.style.fontFamily).not.toBe('')
    expect(heading.style.fontFamily).not.toBe(body.style.fontFamily)
    // Every row is a tap target of at least 44 px.
    expect(row('style').className).toContain('min-h-11')
  })

  it('says the Style unchanged, the body font once when the heading is the same, and a logo', () => {
    setup({
      ...designWith({ body_font: 'lora', heading_font: 'same' }, { guest_switch: 'on' }),
      logo: { assetId: 'as_0123456789ABCDEFGHIJKL', url: null, width: 10, height: 10 },
    })
    expect(row('style').getAttribute('aria-label')).toBe('Style: Basic')
    expect(row('fonts').getAttribute('aria-label')).toBe('Fonts: Lora')
    expect(row('colours').getAttribute('aria-label')).toBe('Colours and logo: Logo')
    expect(row('layout').getAttribute('aria-label')).toMatch(/· guests can switch$/)
    cleanup()
    setup()
    // A Style picked is named in its row.
    fireEvent.click(radio('editorial'))
    fireEvent.click(screen.getByTestId('design-part-back'))
    expect(row('style').getAttribute('aria-label')).toBe('Style: Editorial')
  })

  it('a row opens its part in place, the title takes the focus, and Back returns to the row', async () => {
    setup()
    await userEvent.click(row('fonts'))
    expect(openPart()).toBe('fonts')
    expect(screen.queryByTestId('design-part-list')).toBeNull()
    const title = screen.getByTestId('design-part-title')
    expect(title.textContent).toBe('Fonts')
    expect(document.activeElement).toBe(title)
    expect(window.location.search).toBe('?part=fonts')
    // The pane slides and fades in over 180 ms; with reduced motion it only fades, over 120 ms.
    const pane = screen.getByTestId('design-pane')
    expect(pane.className).toContain('duration-180')
    expect(pane.className).toContain('motion-reduce:duration-120')
    expect(pane.className).toContain('motion-safe:data-[entering=forward]:translate-x-2')

    const back = screen.getByRole('button', { name: 'Back to all parts' })
    expect(back.textContent).toBe('Back')
    await userEvent.click(back)
    expect(openPart()).toBeNull()
    expect(document.activeElement).toBe(row('fonts'))
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it("the browser's Back returns from a part to the list, with the focus on its row", async () => {
    setup()
    await userEvent.click(row('layout'))
    expect(window.location.search).toBe('?part=layout')
    act(() => window.history.back())
    await waitFor(() => expect(openPart()).toBeNull())
    expect(document.activeElement).toBe(row('layout'))
    // Forward opens it again.
    act(() => window.history.forward())
    await waitFor(() => expect(openPart()).toBe('layout'))
  })

  it('opens the part the address names, at the level that lists it', async () => {
    address.part = 'items'
    window.history.replaceState(null, '', '/?part=items')
    setup()
    expect(openPart()).toBe('items')
    expect(advancedPressed()).toBe('true')
    expect(screen.getByTestId('design-part-title').textContent).toBe('Items')
    // Back from a part a link opened returns to the list under it and stays on the page.
    await userEvent.click(screen.getByTestId('design-part-back'))
    expect(screen.getByTestId('design-part-list')).toBeTruthy()
    await waitFor(() => expect(window.location.search).toBe(''))
    cleanup()

    address.part = 'layout'
    setup()
    expect(openPart()).toBe('layout')
    expect(advancedPressed()).toBe('false')
    cleanup()

    address.part = 'nothing'
    setup()
    expect(openPart()).toBeNull()
    expect(screen.getByTestId('design-part-list')).toBeTruthy()
  })

  it("a part a link opened has the list under it: the browser's Back returns to the list", async () => {
    address.part = 'fonts'
    window.history.replaceState(null, '', '/?part=fonts')
    setup()
    expect(openPart()).toBe('fonts')
    act(() => window.history.back())
    await waitFor(() => expect(openPart()).toBeNull())
    expect(window.location.search).toBe('')
    expect(document.activeElement).toBe(row('fonts'))
  })

  it('names the open part by its title', async () => {
    setup()
    await userEvent.click(row('fonts'))
    expect(screen.getByRole('region', { name: 'Fonts' })).toBe(
      screen.getByTestId('design-part-page'),
    )
  })

  it('Simple and Advanced keep the open part where the other level has it, else the list', async () => {
    setup()
    show('style')
    await level('Advanced')
    expect(openPart()).toBe('style')
    await level('Simple')
    expect(openPart()).toBe('style')
    show('colours')
    await level('Advanced')
    expect(openPart()).toBe('colours')
    // Layout's options are on the Items page in Advanced.
    await level('Simple')
    show('layout')
    await level('Advanced')
    expect(openPart()).toBe('items')
    expect(window.location.search).toBe('?part=items')
    await level('Simple')
    expect(openPart()).toBe('layout')
    // A page Simple does not have: the list.
    await level('Advanced')
    show('photos')
    await level('Simple')
    expect(openPart()).toBeNull()
    expect(screen.getByTestId('design-part-list')).toBeTruthy()
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('a part opened before Back has landed keeps a step of its own', async () => {
    setup()
    await userEvent.click(row('fonts'))
    // Two quick taps: ‹ Back, then another row, before the browser's step back lands.
    fireEvent.click(screen.getByTestId('design-part-back'))
    fireEvent.click(row('layout'))
    await waitFor(() => expect(window.location.search).toBe('?part=layout'))
    expect(openPart()).toBe('layout')
    act(() => window.history.back())
    await waitFor(() => expect(openPart()).toBeNull())
  })
})
