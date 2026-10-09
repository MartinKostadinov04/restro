// The upload route's logic, with its dependencies handed in so a test can call it with a real
// `Request` and a fake store (app/api/assets/route.ts wires the session, the pool and the store).
//
// A route handler is not covered by Server Actions' origin check, and a multipart POST is a
// "simple" cross-site request, so this checks the Origin header itself, and reads the body with a
// hard cap instead of letting `formData()` buffer whatever arrives.
import { MAX_IMAGE_BYTES } from '@restro/core'
import type { DbPool } from '@restro/db'

import { logError } from '../log'
import type { AssetStore } from './types'
import { storeImage, UploadError } from './upload'

/** Multipart framing around the file (boundaries, part headers) on top of the file's own bytes. */
const MULTIPART_OVERHEAD = 64 * 1024

export type UploadFailure =
  | 'unauthorized'
  | 'bad_origin'
  | 'no_file'
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'corrupt'
  | 'dimensions'
  | 'server_error'

const STATUS: Record<UploadFailure, number> = {
  unauthorized: 401,
  bad_origin: 403,
  no_file: 400,
  empty: 400,
  too_large: 413,
  unsupported_type: 415,
  corrupt: 422,
  dimensions: 422,
  server_error: 500,
}

function failure(code: UploadFailure): Response {
  return Response.json({ error: code }, { status: STATUS[code] })
}

/** True if the request names this server as its origin (browsers always send Origin on a POST). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  try {
    return host !== null && new URL(origin).host === host
  } catch {
    return false
  }
}

/** The body as bytes, or null as soon as it passes `limit` (the rest is not read). */
export async function readBodyLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) return null
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return body
}

export interface UploadDependencies {
  /** The tenant of the signed-in person, or null when nobody is signed in. */
  readonly tenantId: () => Promise<string | null>
  readonly pool: DbPool
  readonly store: () => Promise<AssetStore>
}

/** Handles `POST` of a multipart form with one image in the field `file`. */
export async function handleUpload(request: Request, deps: UploadDependencies): Promise<Response> {
  const tenantId = await deps.tenantId()
  if (tenantId === null) return failure('unauthorized')
  if (!isSameOrigin(request)) return failure('bad_origin')

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) return failure('no_file')
  const body = await readBodyLimited(request, MAX_IMAGE_BYTES + MULTIPART_OVERHEAD)
  if (body === null) return failure('too_large')

  let file: FormDataEntryValue | null
  try {
    const form = await new Response(body as BodyInit, {
      headers: { 'content-type': contentType },
    }).formData()
    file = form.get('file')
  } catch {
    return failure('no_file')
  }
  if (typeof file === 'string' || file === null) return failure('no_file')
  if (file.size > MAX_IMAGE_BYTES) return failure('too_large')

  try {
    const stored = await storeImage({
      pool: deps.pool,
      tenantId,
      store: await deps.store(),
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
    return Response.json(stored, { status: 201 })
  } catch (error) {
    if (error instanceof UploadError) return failure(error.code)
    logError('asset_upload_failed', error)
    return failure('server_error')
  }
}
