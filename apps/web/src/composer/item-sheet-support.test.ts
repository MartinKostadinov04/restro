import { MAX_IMAGE_BYTES } from '@restro/core'
import { describe, expect, it, vi } from 'vitest'

import {
  badgeProvenance,
  languageName,
  layerProvenance,
  marks,
  splitMarks,
  uploadFailureOf,
} from './item-sheet-support'
import { IMAGE_ACCEPT, precheckImage, uploadImage } from './item-sheet-upload'

describe('marks and splitMarks', () => {
  it("cut a sentence at the places the caller puts elements, in the translation's word order", () => {
    const sentence = `${marks('who').who} changed ${marks('field').field} from ${marks('from').from} to ${marks('to').to}`
    expect(splitMarks(sentence)).toEqual([
      { kind: 'mark', name: 'who' },
      { kind: 'text', text: ' changed ' },
      { kind: 'mark', name: 'field' },
      { kind: 'text', text: ' from ' },
      { kind: 'mark', name: 'from' },
      { kind: 'text', text: ' to ' },
      { kind: 'mark', name: 'to' },
    ])
    // A language may put a mark first, last or twice, or leave one out.
    const reordered = `${marks('to').to}: ${marks('field').field}`
    expect(
      splitMarks(reordered).map((part) => (part.kind === 'mark' ? part.name : part.text)),
    ).toEqual(['to', ': ', 'field'])
    expect(splitMarks('no marks')).toEqual([{ kind: 'text', text: 'no marks' }])
  })

  it('leave text that merely looks like a mark alone', () => {
    expect(splitMarks('{who} and \u0001 alone')).toEqual([
      { kind: 'text', text: '{who} and \u0001 alone' },
    ])
  })
})

describe('languageName', () => {
  it('names a document language in the interface language', () => {
    expect(languageName('bg_BG', 'en')).toBe('Bulgarian')
    expect(languageName('en_US', 'en')).toBe('English')
    expect(languageName('bg_BG', 'bg')).toBe('български')
    expect(languageName('en_US', 'bg')).toBe('английски')
    expect(languageName('de_DE', 'en')).toBe('German')
  })

  it('falls back to the language code for an interface language Intl does not know', () => {
    expect(languageName('bg_BG', 'not a language tag')).toBe('bg')
  })
})

describe('provenance mapping', () => {
  it('maps stored layers to the badge they stand for', () => {
    expect(layerProvenance('till')).toBe('till')
    expect(layerProvenance('manual')).toBe('owned')
    expect(layerProvenance('import')).toBeNull()
    expect(layerProvenance('override')).toBe('overridden')
    expect(layerProvenance('edition:venue:vn_x')).toBeNull()
  })

  it('shows no badge for a value nobody set', () => {
    expect(badgeProvenance('none')).toBeUndefined()
    expect(badgeProvenance('locked')).toBe('locked')
  })
})

describe('uploadFailureOf', () => {
  it("reads the route's error code, and calls anything else a server error", () => {
    expect(uploadFailureOf({ error: 'too_large' })).toBe('too_large')
    expect(uploadFailureOf({ error: 'nonsense' })).toBe('server_error')
    expect(uploadFailureOf(null)).toBe('server_error')
    expect(uploadFailureOf('<html>')).toBe('server_error')
  })
})

describe('precheckImage', () => {
  it('lets a good file through and stops the obvious refusals', () => {
    expect(precheckImage({ size: 1000, type: 'image/webp' })).toBeNull()
    expect(precheckImage({ size: 1000, type: '' })).toBeNull()
    expect(precheckImage({ size: 0, type: 'image/png' })).toBe('empty')
    expect(precheckImage({ size: MAX_IMAGE_BYTES, type: 'image/png' })).toBeNull()
    expect(precheckImage({ size: MAX_IMAGE_BYTES + 1, type: 'image/png' })).toBe('too_large')
    expect(precheckImage({ size: 10, type: 'image/gif' })).toBe('unsupported_type')
    expect(precheckImage({ size: 10, type: 'application/pdf' })).toBe('unsupported_type')
  })

  it('offers exactly the three types in the file input', () => {
    expect(IMAGE_ACCEPT).toBe('image/jpeg,image/png,image/webp')
  })
})

describe('uploadImage', () => {
  function fakeRequest(respond: (request: ReturnType<typeof fakeRequest>) => void) {
    const request = {
      open: vi.fn(),
      send: vi.fn(() => respond(request)),
      responseType: '',
      response: null as unknown,
      status: 0,
      upload: {} as { onprogress?: (event: unknown) => void },
      onload: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      onabort: undefined as (() => void) | undefined,
    }
    return request
  }
  const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })

  it('posts the file as a form to the upload route and resolves with the asset id', async () => {
    const progress = vi.fn()
    const request = fakeRequest((r) => {
      r.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
      r.status = 201
      r.response = { assetId: 'as_x' }
      r.onload?.()
    })
    const outcome = await uploadImage(file, {
      onProgress: progress,
      createRequest: () => request as unknown as XMLHttpRequest,
    })
    expect(outcome).toEqual({ ok: true, assetId: 'as_x' })
    expect(request.open).toHaveBeenCalledWith('POST', '/api/assets')
    const sent = (request.send.mock.calls[0] as unknown as [FormData])[0]
    expect((sent.get('file') as File).name).toBe('a.png')
    expect(progress).toHaveBeenCalledWith(0.5)
  })

  it('resolves with the route\'s reason when it refuses, and "network" when nothing came back', async () => {
    const refused = fakeRequest((r) => {
      r.status = 415
      r.response = { error: 'unsupported_type' }
      r.onload?.()
    })
    expect(
      await uploadImage(file, { createRequest: () => refused as unknown as XMLHttpRequest }),
    ).toEqual({
      ok: false,
      error: 'unsupported_type',
    })
    const dropped = fakeRequest((r) => r.onerror?.())
    expect(
      await uploadImage(file, { createRequest: () => dropped as unknown as XMLHttpRequest }),
    ).toEqual({
      ok: false,
      error: 'network',
    })
    const odd = fakeRequest((r) => {
      r.status = 201
      r.response = {}
      r.onload?.()
    })
    expect(
      await uploadImage(file, { createRequest: () => odd as unknown as XMLHttpRequest }),
    ).toEqual({
      ok: false,
      error: 'server_error',
    })
  })
})
