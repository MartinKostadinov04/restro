// Photo variants (brief S3-01b, job `asset-variants`): small webp copies of a stored photo for
// phones, put in the publish store at `a/<as_ id>/w<width>.webp`, and recorded in
// `assets.variants` so that the next publish names them in its snapshot.
//
// The widths are 320, 640 and 1280, never wider than the original and with the aspect ratio kept
// (`planAssetVariants` in core decides). Metadata (EXIF with its GPS position, colour profiles) is
// not copied: sharp drops it unless asked to keep it, and the orientation is applied to the pixels
// first so a phone photo does not turn sideways without it. The original stays in the private
// asset store and is never put in the publish store.
import { type AssetStore, type PublishStore, publishPutOptions, variantPath } from '@restro/assets'
import {
  type AssetId,
  type AssetVariantWidths,
  MAX_IMAGE_PIXELS,
  parseAssetVariants,
  planAssetVariants,
} from '@restro/core'
import { setAssetVariants } from '@restro/core/apply'
import { assets, type DbPool, withTenant } from '@restro/db'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import sharp from 'sharp'

/** The quality of the webp copies: small files, no visible loss on a phone. */
const WEBP_QUALITY = 80

export interface VariantsDeps {
  readonly pool: DbPool
  /** Where the originals are (private). */
  readonly assets: Pick<AssetStore, 'get'>
  /** Where the variants go (public). */
  readonly store: PublishStore
}

export type VariantsResult =
  | { readonly status: 'made'; readonly variants: AssetVariantWidths; readonly files: number[] }
  | { readonly status: 'already' }
  | {
      readonly status: 'skipped'
      readonly reason: 'unknown_asset' | 'not_stored' | 'unreadable'
    }

function openInput(original: Uint8Array) {
  // limitInputPixels repeats the upload limit: a decompression bomb is refused, not decoded.
  return sharp(Buffer.from(original), { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
}

/** One webp copy `width` pixels wide (or the original's width when that is smaller). */
export async function renderVariant(original: Uint8Array, width: number): Promise<Uint8Array> {
  return openInput(original)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()
}

/** The width of the picture as it is shown: EXIF orientations 5 to 8 swap the sides. */
async function shownWidth(original: Uint8Array): Promise<number | null> {
  const meta = await openInput(original).metadata()
  const sideways = (meta.orientation ?? 1) >= 5
  return (sideways ? meta.height : meta.width) ?? null
}

/**
 * Makes and records the variants of one asset. Idempotent: an asset that has them is left alone
 * (`already`). A missing original throws, so the queue retries (the upload may still be landing);
 * an unreadable one is `skipped` (retrying will not make it a picture).
 */
export async function runAssetVariants(
  deps: VariantsDeps,
  job: { readonly tenantId: string; readonly assetId: string },
): Promise<VariantsResult> {
  const [asset] = await withTenant(deps.pool, job.tenantId, (tx) =>
    tx.select().from(assets).where(eq(assets.id, job.assetId)),
  )
  if (asset === undefined) return { status: 'skipped', reason: 'unknown_asset' }
  if (asset.status !== 'stored' || asset.storageKey === null) {
    return { status: 'skipped', reason: 'not_stored' }
  }
  if (parseAssetVariants(asset.variants) !== null) return { status: 'already' }

  const original = await deps.assets.get(asset.storageKey)
  if (original === null) throw new Error('the original of an asset is not in the asset store')
  let width: number | null
  try {
    width = await shownWidth(original)
  } catch {
    return { status: 'skipped', reason: 'unreadable' }
  }
  if (width === null) return { status: 'skipped', reason: 'unreadable' }

  const plan = planAssetVariants(width)
  for (const fileWidth of plan.files) {
    const bytes = await renderVariant(original, fileWidth)
    const file = variantPath(asset.id as AssetId, fileWidth)
    await deps.store.put(file, bytes, publishPutOptions(file))
  }
  // Recorded only after every file is in place: a snapshot names these files.
  await setAssetVariants(deps.pool, job.tenantId, asset.id, plan.variants)
  return { status: 'made', variants: plan.variants, files: [...plan.files] }
}

/** The stored assets of one tenant that have no variants yet, oldest first, after `afterId`. */
export async function assetsWithoutVariants(
  pool: DbPool,
  tenantId: string,
  options: { readonly limit?: number; readonly afterId?: string } = {},
): Promise<string[]> {
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.status, 'stored'),
          isNull(assets.variants),
          options.afterId === undefined ? undefined : gt(assets.id, options.afterId),
        ),
      )
      .orderBy(asc(assets.id))
      .limit(options.limit ?? 200),
  )
  return rows.map((row) => row.id)
}
