// The browser side of an image upload: a quick look at the file before anything is sent, and the
// upload itself to POST /api/assets with progress (fetch has no upload progress, XHR does). The
// server checks the file again by its bytes; the look here only saves a round trip for the
// obvious cases (too big, plainly not an image).
import { ASSET_IMAGE_TYPES, isAssetImageType, MAX_IMAGE_BYTES } from '@restro/core'

import { type UploadFailure, uploadFailureOf } from './item-sheet-support'

/** The `accept` value of the file input. */
export const IMAGE_ACCEPT = ASSET_IMAGE_TYPES.join(',')

/** Why a file should not be sent at all, or null. A file with no reported type is sent anyway. */
export function precheckImage(file: {
  readonly size: number
  readonly type: string
}): UploadFailure | null {
  if (file.size === 0) return 'empty'
  if (file.size > MAX_IMAGE_BYTES) return 'too_large'
  if (file.type !== '' && !isAssetImageType(file.type)) return 'unsupported_type'
  return null
}

export type UploadOutcome =
  | { readonly ok: true; readonly assetId: string }
  | { readonly ok: false; readonly error: UploadFailure }

export interface UploadOptions {
  /** Called with 0 to 1 while the file goes up. */
  readonly onProgress?: (fraction: number) => void
  /** For tests: makes the request object. */
  readonly createRequest?: () => XMLHttpRequest
}

/** Sends the file to the upload route; resolves with the new asset's id or the reason it failed. */
export function uploadImage(file: File, options: UploadOptions = {}): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const request = options.createRequest?.() ?? new XMLHttpRequest()
    const form = new FormData()
    form.set('file', file)
    request.open('POST', '/api/assets')
    request.responseType = 'json'
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        options.onProgress?.(event.loaded / event.total)
    }
    request.onerror = () => resolve({ ok: false, error: 'network' })
    request.onabort = () => resolve({ ok: false, error: 'network' })
    request.onload = () => {
      const body: unknown = request.response
      if (request.status >= 200 && request.status < 300) {
        const assetId = (body as { assetId?: unknown } | null)?.assetId
        resolve(
          typeof assetId === 'string'
            ? { ok: true, assetId }
            : { ok: false, error: 'server_error' },
        )
      } else {
        resolve({ ok: false, error: uploadFailureOf(body) })
      }
    }
    request.send(form)
  })
}
