// Storing one uploaded image (brief S2-06b): look at the bytes, put them in the asset store under
// a key built from the tenant and the new asset id, then write the `assets` row through core's
// `createAsset` (rule 1: the row is written in core/apply, not here). Attaching the image to an
// item is a separate change set (the item sheet's `image` field), so an upload that is never
// attached leaves an unused asset, not a half-edited item.
import { createHash } from 'node:crypto'
import { type AssetImageType, newId } from '@restro/core'
import { createAsset } from '@restro/core/apply'
import type { DbPool } from '@restro/db'

import { type ImageRefusal, inspectImage } from './inspect-image'
import { assetStorageKey } from './keys'
import type { AssetStore } from './types'

/** An upload that was refused; `code` says why (see `ImageRefusal`). */
export class UploadError extends Error {
  override name = 'UploadError'
  readonly code: ImageRefusal

  constructor(code: ImageRefusal) {
    super(`image refused: ${code}`)
    this.code = code
  }
}

/** What a stored upload is. */
export interface StoredImage {
  readonly assetId: string
  readonly contentType: AssetImageType
  readonly width: number
  readonly height: number
  readonly checksum: string
}

/** SHA-256 of the bytes as 64 lower-case hex characters. */
export function checksumOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Checks `bytes` (type by magic bytes, size, dimensions), stores them and records the asset.
 * Throws `UploadError` for a file that is refused, before anything is stored.
 */
export async function storeImage(input: {
  readonly pool: DbPool
  readonly tenantId: string
  readonly store: AssetStore
  readonly bytes: Uint8Array
}): Promise<StoredImage> {
  const { pool, tenantId, store, bytes } = input
  const inspected = inspectImage(bytes)
  if (!inspected.ok) throw new UploadError(inspected.reason)

  const id = newId('as')
  const checksum = checksumOf(bytes)
  const storageKey = assetStorageKey(tenantId, id, inspected.contentType)
  await store.put(storageKey, bytes, inspected.contentType)
  const asset = await createAsset(pool, tenantId, {
    id,
    origin: 'upload',
    contentType: inspected.contentType,
    checksum,
    width: inspected.width,
    height: inspected.height,
    storageKey,
  })
  return {
    assetId: asset.id,
    contentType: inspected.contentType,
    width: inspected.width,
    height: inspected.height,
    checksum,
  }
}
