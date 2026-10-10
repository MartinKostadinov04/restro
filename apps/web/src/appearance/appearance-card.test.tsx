// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as upload from '@/composer/item-sheet-upload'
import { saveAppearanceAction } from '@/server/appearance/actions'
import type { AppearanceView } from '@/server/appearance/service'
import { renderWithIntl } from '@/test-utils'

import { AppearanceCard } from './appearance-card'

vi.mock('@/server/appearance/actions', () => ({ saveAppearanceAction: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/composer/item-sheet-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composer/item-sheet-upload')>()),
  uploadImage: vi.fn(),
}))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const NONE: AppearanceView = { brand: null, logo: null }

function setup(initial: AppearanceView = NONE, canEdit = true) {
  renderWithIntl(<AppearanceCard venueId={VENUE} initial={initial} canEdit={canEdit} />, {
    locale: 'en',
  })
}

beforeEach(() => {
  vi.mocked(saveAppearanceAction).mockReset()
  vi.mocked(saveAppearanceAction).mockResolvedValue({ ok: true })
  vi.mocked(upload.uploadImage).mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:logo-preview')
  URL.revokeObjectURL = vi.fn()
})

describe('the Appearance card', () => {
  it('starts on the neutral grey with nothing to save, and previews a light and a dark screen', () => {
    setup()
    expect((screen.getByLabelText('Brand colour') as HTMLInputElement).value).toBe('#6b7280')
    expect(
      (screen.getByRole('button', { name: 'Save appearance' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    const schemes = screen.getAllByTestId('appearance-scheme')
    expect(schemes).toHaveLength(2)
    // Four named pairs per screen, each with its contrast ratio.
    for (const scheme of schemes) {
      expect(within(scheme).getAllByText(/^\d+(\.\d)?:1$/)).toHaveLength(4)
    }
  })

  it('takes a typed colour in several forms and updates the preview', async () => {
    setup()
    const input = screen.getByLabelText('Brand colour')
    await userEvent.clear(input)
    await userEvent.type(input, '36C')
    expect(screen.queryByText('Enter a colour like #3366cc.')).toBeNull()
    const accent = within(screen.getAllByTestId('appearance-scheme')[0] as HTMLElement).getByText(
      'Selected',
    )
    expect(accent.style.backgroundColor).toBe('rgb(51, 102, 204)')
  })

  it('names a colour that is not one and keeps Save off', async () => {
    setup()
    const input = screen.getByLabelText('Brand colour')
    await userEvent.clear(input)
    await userEvent.type(input, 'blue')
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a colour like #3366cc.')
    expect(
      (screen.getByRole('button', { name: 'Save appearance' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('picks a swatch and saves the colour with no logo', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: '#2563eb' }))
    expect((screen.getByLabelText('Brand colour') as HTMLInputElement).value).toBe('#2563eb')
    await userEvent.click(screen.getByRole('button', { name: 'Save appearance' }))
    await waitFor(() =>
      expect(saveAppearanceAction).toHaveBeenCalledWith({
        venueId: VENUE,
        brand: '#2563eb',
        logoAssetId: null,
      }),
    )
  })

  it('uploads a logo with the same checks as the item photos and saves its id', async () => {
    vi.mocked(upload.uploadImage).mockResolvedValue({
      ok: true,
      assetId: 'as_0123456789ABCDEFGHIJKL',
    })
    setup({ brand: '#2563eb', logo: null })
    const file = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('appearance-logo-input'), { target: { files: [file] } })
    expect(await screen.findByTestId('appearance-logo')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Save appearance' }))
    await waitFor(() =>
      expect(saveAppearanceAction).toHaveBeenCalledWith({
        venueId: VENUE,
        brand: '#2563eb',
        logoAssetId: 'as_0123456789ABCDEFGHIJKL',
      }),
    )
  })

  it('refuses a file that is not an image before sending it', async () => {
    setup()
    const file = new File(['x'], 'logo.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByTestId('appearance-logo-input'), { target: { files: [file] } })
    expect((await screen.findByTestId('appearance-error')).textContent).toContain(
      'JPEG, PNG and WebP',
    )
    expect(upload.uploadImage).not.toHaveBeenCalled()
  })

  it('shows what the server refused', async () => {
    vi.mocked(saveAppearanceAction).mockResolvedValue({ ok: false, error: 'logo_not_usable' })
    setup()
    await userEvent.click(screen.getByRole('button', { name: '#2563eb' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save appearance' }))
    expect((await screen.findByTestId('appearance-error')).textContent).toBe(
      'That logo could not be used. Upload it again.',
    )
  })

  it('only shows the saved look to someone who may not change it', () => {
    setup({ brand: '#2563eb', logo: null }, false)
    expect(screen.getByText('Only owners and admins can change the appearance.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save appearance' })).toBeNull()
    expect((screen.getByLabelText('Brand colour') as HTMLInputElement).disabled).toBe(true)
  })
})
