// createAsset(): the writer for the `assets` table (brief S2-06b). Rule 1 keeps every write of the
// menu document inside core/apply, and an asset row is what an image field's `asset_id` points at,
// so the web app (the upload route) and the worker (the photo fetch of S2-03) create assets here
// and nowhere else. The bytes themselves live in the asset store; this writes only the row that
// says where they are (`storage_key`), what they are (type, size in pixels, SHA-256) and where
// they came from. A field value never holds a URL or a key, only the `as_` id (rule 3 applies to
// external ids; the same discipline keeps storage details out of snapshots).
//
// The row is written in one statement and never changes afterwards except for its status, so
// there is nothing to lock: the document lock (./lock.ts) protects nodes and values, not assets.

import { type Asset, assets, type DbPool } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { parseAssetVariants } from '../asset-variants'
import { ASSET_IMAGE_TYPES, ASSET_ORIGINS, MAX_IMAGE_SIDE } from '../assets'
import { type AssetId, idSchema, newId } from '../ids'
import type { AssetVariantWidths } from '../snapshot/build'

/**
 * Storage keys: path-like, ASCII, no `..` or empty segment, at most 255 characters. The asset
 * store builds them (`<tenant>/<asset id>/original.<ext>`); this only refuses anything that could
 * climb out of a folder or hide a character.
 */
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

const CreateAssetInputSchema = z.strictObject({
  /** Pre-generated so the caller can name the asset in its storage key; default: a new `as_` id. */
  id: idSchema('as').optional(),
  origin: z.enum(ASSET_ORIGINS),
  /** Backend-only note on where it came from (for a connector photo: which object and picture). */
  originRef: z.string().min(1).max(512).optional(),
  contentType: z.enum(ASSET_IMAGE_TYPES),
  /** SHA-256 of the stored bytes: 64 lower-case hex characters. */
  checksum: z.string().regex(/^[0-9a-f]{64}$/, 'expected a SHA-256 in lower-case hex'),
  width: z.int().min(1).max(MAX_IMAGE_SIDE),
  height: z.int().min(1).max(MAX_IMAGE_SIDE),
  storageKey: z
    .string()
    .max(255)
    .regex(STORAGE_KEY_PATTERN, 'expected a path of safe segments without ".." or "//"'),
})

/** What `createAsset` needs. */
export type CreateAssetInput = z.input<typeof CreateAssetInputSchema>

/** Why a `createAsset` call was refused. */
export type CreateAssetErrorCode =
  /** The input does not pass its checks; nothing was written. */
  | 'invalid_input'
  /** The id exists already with different content (same id, another checksum or key). */
  | 'id_conflict'

/** Thrown by `createAsset` for input or state it refuses. */
export class CreateAssetError extends Error {
  override name = 'CreateAssetError'
  readonly code: CreateAssetErrorCode

  constructor(code: CreateAssetErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** The asset row after `createAsset`; `created` is false when the same asset existed already. */
export type CreatedAsset = Asset & { readonly created: boolean }

/**
 * Creates the row of a stored asset for one tenant (row-level security lets the app role insert
 * exactly this tenant's rows). Idempotent by id: calling it again with the same id and the same
 * content changes nothing and reports `created: false`; the same id with other content is an
 * `id_conflict`. Nothing is written for input that fails its checks.
 */
export async function createAsset(
  pool: DbPool,
  tenantId: string,
  input: CreateAssetInput,
): Promise<CreatedAsset> {
  const parsed = CreateAssetInputSchema.safeParse(input)
  if (!parsed.success) throw new CreateAssetError('invalid_input', z.prettifyError(parsed.error))
  const asset = parsed.data
  const id: AssetId = asset.id ?? newId('as')
  return withTenantWrite(pool, tenantId, async (tx) => {
    const inserted = await tx
      .insert(assets)
      .values({
        id,
        tenantId,
        origin: asset.origin,
        originRef: asset.originRef ?? null,
        checksum: asset.checksum,
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
        storageKey: asset.storageKey,
        status: 'stored',
      })
      .onConflictDoNothing()
      .returning()
    const row = inserted[0]
    if (row) return { ...row, created: true }

    const [existing] = await tx.select().from(assets).where(eq(assets.id, id))
    if (
      existing &&
      existing.checksum === asset.checksum &&
      existing.storageKey === asset.storageKey &&
      existing.contentType === asset.contentType
    ) {
      return { ...existing, created: false }
    }
    throw new CreateAssetError('id_conflict', `asset ${id} exists with different content`)
  })
}

/**
 * Records which webp variants of a stored asset exist in the publish store (brief S3-01b): call
 * it AFTER the files are written, because a published snapshot names these files. Returns
 * whether the tenant has such a stored asset. Idempotent: the same record changes nothing.
 */
export async function setAssetVariants(
  pool: DbPool,
  tenantId: string,
  assetId: string,
  variants: AssetVariantWidths,
): Promise<boolean> {
  const id = idSchema('as').safeParse(assetId)
  const stored = parseAssetVariants(variants)
  if (!id.success || stored === null) {
    throw new CreateAssetError(
      'invalid_input',
      'expected an as_ id and growing thumb/card/full widths',
    )
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const rows = await tx
      .update(assets)
      .set({ variants: stored })
      .where(and(eq(assets.id, id.data), eq(assets.status, 'stored')))
      .returning({ id: assets.id })
    return rows.length > 0
  })
}
