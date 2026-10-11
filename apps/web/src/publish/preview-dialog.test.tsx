// @vitest-environment jsdom
// The preview: a phone-frame dialog with the guest face drawn from the draft snapshot the server
// builds in memory (brief S3-05). The face and the shell are the guest page's own: the template the
// draft names, loaded on first use (brief SH-04), the Editorial Market when it names none.
import { fixture } from '@restro/shell/testing'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import { PreviewDialog } from './preview-dialog'

const actions = vi.hoisted(() => ({ previewDraftAction: vi.fn() }))
vi.mock('@/server/publish/actions', () => actions)

beforeEach(() => {
  actions.previewDraftAction.mockReset()
})

/** The face's root, once the lazy template has loaded (the skeleton shows until then). */
const faceRoot = (frame: HTMLElement, face = 'editorial-market') =>
  waitFor(() => {
    const root = frame.querySelector(`[data-face="${face}"]:not([data-testid])`)
    expect(root).toBeTruthy()
    return root as HTMLElement
  })

const open = async (locale: 'en' | 'bg' = 'en') => {
  const user = userEvent.setup()
  renderWithIntl(
    <PreviewDialog venueId="vn_demoVenueForPublishTests">
      <button type="button">{locale === 'en' ? 'Preview' : 'Преглед'}</button>
    </PreviewDialog>,
    { locale },
  )
  await user.click(screen.getByRole('button', { name: locale === 'en' ? 'Preview' : 'Преглед' }))
  return user
}

describe('the preview dialog', () => {
  it('builds the draft when it opens and draws the guest face in a phone frame', async () => {
    const f = fixture('with-images')
    actions.previewDraftAction.mockResolvedValue({
      ok: true,
      snapshot: f.snapshot,
      overlay: { version: 1, items: {} },
    })
    await open()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Preview of the draft')).toBeTruthy()
    expect(within(dialog).getByText(/Nothing is published/)).toBeTruthy()
    const frame = await within(dialog).findByTestId('phone-frame')
    // The same face the guest page uses: the default one, as the draft names none.
    await faceRoot(frame)
    expect(actions.previewDraftAction).toHaveBeenCalledWith('vn_demoVenueForPublishTests')
    // An item of the draft is on the screen.
    const firstItem = Object.values(f.snapshot.items)[0]
    const name = firstItem?.name.en_US ?? firstItem?.name.bg_BG
    expect(name).toBeTruthy()
    expect(frame.textContent).toContain(name as string)
  })

  it('builds it again each time it opens (the menu may have changed)', async () => {
    const f = fixture('with-images')
    actions.previewDraftAction.mockResolvedValue({
      ok: true,
      snapshot: f.snapshot,
      overlay: { version: 1, items: {} },
    })
    const user = await open()
    await screen.findByTestId('phone-frame')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByTestId('phone-frame')
    expect(actions.previewDraftAction).toHaveBeenCalledTimes(2)
  })

  it('switches the face between light and dark', async () => {
    const f = fixture('with-images')
    actions.previewDraftAction.mockResolvedValue({
      ok: true,
      snapshot: f.snapshot,
      overlay: { version: 1, items: {} },
    })
    const user = await open()
    const frame = await screen.findByTestId('phone-frame')
    const root = await faceRoot(frame)
    expect(root.getAttribute('data-scheme')).toBe('light')
    await user.click(screen.getByRole('button', { name: 'Dark' }))
    expect(root.getAttribute('data-scheme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows the menu in the admin’s language when the menu has it', async () => {
    const f = fixture('six-languages')
    actions.previewDraftAction.mockResolvedValue({
      ok: true,
      snapshot: f.snapshot,
      overlay: { version: 1, items: {} },
    })
    await open('bg')
    const frame = await screen.findByTestId('phone-frame')
    expect((await faceRoot(frame)).getAttribute('lang')).toBe('bg-BG')
  })

  it.each([
    ['nothing_visible', 'Nothing visible to publish, so there is nothing to preview.'],
    ['blocked', 'The menu cannot be published yet, so there is nothing to preview.'],
    ['no_menu', 'This venue has no menu yet.'],
  ] as const)('says why there is nothing to show: %s', async (error, text) => {
    actions.previewDraftAction.mockResolvedValue({ ok: false, error })
    await open()
    expect(await screen.findByText(text)).toBeTruthy()
    expect(screen.queryByTestId('phone-frame')).toBeNull()
  })

  it('offers another try when the preview could not be built', async () => {
    const f = fixture('with-images')
    actions.previewDraftAction.mockResolvedValueOnce({ ok: false, error: 'failed' })
    actions.previewDraftAction.mockResolvedValueOnce({
      ok: true,
      snapshot: f.snapshot,
      overlay: { version: 1, items: {} },
    })
    const user = await open()
    expect(await screen.findByText('The preview could not be built. Try again.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('phone-frame')).toBeTruthy()
  })

  it('treats a server action that throws like a failed preview', async () => {
    actions.previewDraftAction.mockRejectedValue(new Error('network'))
    await open()
    expect(await screen.findByText('The preview could not be built. Try again.')).toBeTruthy()
  })
})
