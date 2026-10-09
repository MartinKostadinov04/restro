// @vitest-environment jsdom
import { MAX_IMAGE_BYTES } from '@restro/core'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SheetImage } from '@/server/item-sheet/types'
import { renderWithIntl } from '@/test-utils'

import { ItemSheetMediaTab } from './item-sheet-media-tab'
import { sheetData } from './item-sheet-test-data'
import * as upload from './item-sheet-upload'

vi.mock('./item-sheet-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./item-sheet-upload')>()),
  uploadImage: vi.fn(),
}))

const image: SheetImage = {
  assetId: 'as_0123456789ABCDEFGHIJKL',
  url: 'https://files.example/photo.png?sig=1',
  width: 640,
  height: 480,
  contentType: 'image/png',
  alt: { bg_BG: 'Чаша Негрони' },
  focal: null,
  provenance: 'owned',
  canRemove: true,
}

function setup(withImage: SheetImage | null = null, locale: 'en' | 'bg' = 'en') {
  const handlers = {
    onAttach: vi.fn(async () => true),
    onSaveDetails: vi.fn(async () => true),
    onRemove: vi.fn(async () => true),
  }
  renderWithIntl(
    <ItemSheetMediaTab data={sheetData({ image: withImage })} busy={false} {...handlers} />,
    { locale },
  )
  return handlers
}

const pick = (file: File) =>
  fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } })
const png = (size = 100) => new File([new Uint8Array(size)], 'photo.png', { type: 'image/png' })

beforeEach(() => {
  vi.mocked(upload.uploadImage).mockReset()
})

describe('the Media tab without a photo', () => {
  it('invites an upload and states the limits', () => {
    setup()
    expect(screen.getByText('No photo yet')).toBeTruthy()
    expect(screen.getByText('Upload a photo or drop one here')).toBeTruthy()
    expect(screen.getByText('JPEG, PNG or WebP, up to 10 MB')).toBeTruthy()
    expect(screen.queryByTestId('image-details')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull()
  })

  it('uploads the chosen file, then attaches the new asset', async () => {
    vi.mocked(upload.uploadImage).mockResolvedValue({
      ok: true,
      assetId: 'as_NEWNEWNEWNEWNEWNEWNEWN',
    })
    const { onAttach } = setup()
    pick(png())
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith('as_NEWNEWNEWNEWNEWNEWNEWN'))
    expect(vi.mocked(upload.uploadImage)).toHaveBeenCalledTimes(1)
  })

  it('accepts a dropped file', async () => {
    vi.mocked(upload.uploadImage).mockResolvedValue({
      ok: true,
      assetId: 'as_DROPDROPDROPDROPDROPDR',
    })
    const { onAttach } = setup()
    fireEvent.drop(screen.getByTestId('photo-drop'), { dataTransfer: { files: [png()] } })
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith('as_DROPDROPDROPDROPDROPDR'))
  })

  it.each([
    [
      'a file over 10 MB',
      new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' }),
      'The file is larger than 10 MB.',
    ],
    [
      'an SVG',
      new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }),
      'Only JPEG, PNG and WebP photos are accepted.',
    ],
    ['an empty file', new File([], 'empty.png', { type: 'image/png' }), 'The file is empty.'],
  ])('refuses %s before sending anything', async (_label, file, message) => {
    const { onAttach } = setup()
    pick(file)
    expect((await screen.findByTestId('upload-error')).textContent).toBe(message)
    expect(vi.mocked(upload.uploadImage)).not.toHaveBeenCalled()
    expect(onAttach).not.toHaveBeenCalled()
  })

  it('shows what the server said when it refuses the file, and does not attach', async () => {
    vi.mocked(upload.uploadImage).mockResolvedValue({ ok: false, error: 'corrupt' })
    const { onAttach } = setup()
    pick(png())
    expect((await screen.findByTestId('upload-error')).textContent).toBe('The file looks damaged.')
    expect(onAttach).not.toHaveBeenCalled()
  })

  it('shows progress while the file goes up', async () => {
    let finish: (value: upload.UploadOutcome) => void = () => undefined
    vi.mocked(upload.uploadImage).mockImplementation((_file, options) => {
      options?.onProgress?.(0.4)
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    setup()
    pick(png())
    const status = await screen.findByRole('status')
    expect(status.textContent).toBe('Uploading…')
    finish({ ok: false, error: 'network' })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})

describe('the Media tab with a photo', () => {
  it('shows it with its size and type, and its alt text in each language', () => {
    setup(image)
    const picture = screen.getByTestId('item-image') as HTMLImageElement
    expect(picture.src).toBe(image.url)
    expect(picture.alt).toBe('Чаша Негрони')
    expect(screen.getByTestId('image-dimensions').textContent).toBe('640 × 480')
    expect(screen.getByText('PNG')).toBeTruthy()
    expect(screen.getByText('Owned here')).toBeTruthy()
    expect((screen.getByLabelText(/Alt text, Bulgarian/) as HTMLInputElement).value).toBe(
      'Чаша Негрони',
    )
    expect((screen.getByLabelText(/Alt text, English/) as HTMLInputElement).value).toBe('')
  })

  it('saves alt text per language; Save waits until something changed', async () => {
    const { onSaveDetails } = setup(image)
    const details = screen.getByTestId('image-details')
    const save = within(details).getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText(/Alt text, English/), 'A glass of Negroni')
    expect(save.disabled).toBe(false)
    await userEvent.click(save)
    expect(onSaveDetails).toHaveBeenCalledWith(
      { bg_BG: 'Чаша Негрони', en_US: 'A glass of Negroni' },
      null,
    )
  })

  it('clears a language by emptying its field', async () => {
    const { onSaveDetails } = setup(image)
    await userEvent.clear(screen.getByLabelText(/Alt text, Bulgarian/))
    await userEvent.click(
      within(screen.getByTestId('image-details')).getByRole('button', { name: 'Save' }),
    )
    expect(onSaveDetails).toHaveBeenCalledWith({}, null)
  })

  it('sets the focal point by clicking the photo, with a marker, and saves it', async () => {
    const { onSaveDetails } = setup(image)
    await userEvent.click(screen.getByRole('button', { name: 'Set focal point' }))
    const picker = screen.getByTestId('focal-picker')
    vi.spyOn(picker, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      width: 200,
      height: 100,
      right: 300,
      bottom: 150,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    })
    fireEvent.click(picker, { clientX: 150, clientY: 100, detail: 1 })
    const marker = screen.getByTestId('focal-marker')
    expect(marker.style.left).toBe('25%')
    expect(marker.style.top).toBe('50%')
    await userEvent.click(
      within(screen.getByTestId('image-details')).getByRole('button', { name: 'Save' }),
    )
    expect(onSaveDetails).toHaveBeenCalledWith({ bg_BG: 'Чаша Негрони' }, { x: 0.25, y: 0.5 })
  })

  it('moves the focal point with the arrow keys', async () => {
    setup(image)
    await userEvent.click(screen.getByRole('button', { name: 'Set focal point' }))
    const picker = screen.getByTestId('focal-picker')
    fireEvent.keyDown(picker, { key: 'ArrowRight' })
    expect(screen.getByTestId('focal-marker').style.left).toBe('55%')
    fireEvent.keyDown(picker, { key: 'ArrowUp' })
    fireEvent.keyDown(picker, { key: 'ArrowUp' })
    expect(screen.getByTestId('focal-marker').style.top).toBe('40%')
  })

  it("removes our photo, and offers no Remove for a photo that is barsy's", async () => {
    const { onRemove } = setup(image)
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('says a barsy photo is replaced by an upload', () => {
    setup({ ...image, provenance: 'barsy', canRemove: false })
    expect(screen.getByText(/comes from barsy/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull()
    expect(screen.getByText('Replace the photo or drop a new one here')).toBeTruthy()
  })

  it('shows a notice when the file cannot be linked', () => {
    setup({ ...image, url: null })
    expect(screen.getByText('The photo cannot be shown')).toBeTruthy()
    expect(screen.queryByTestId('item-image')).toBeNull()
  })

  it('speaks Bulgarian', () => {
    setup(image, 'bg')
    expect(screen.getByText('Снимка')).toBeTruthy()
    expect(screen.getByLabelText(/Алтернативен текст – български/)).toBeTruthy()
  })
})
