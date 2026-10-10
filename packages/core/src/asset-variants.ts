// Photo variants (brief S3-01b): which webp widths a photo gets, and how the stored record of them
// is read back. Pure: the worker makes the files (sharp), core/apply stores the record
// (`assets.variants`), the publisher hands it to the snapshot builder.
//
// A variant is a webp file `a/<as_ id>/w<width>.webp` in the publish store, named by its REAL
// width, never wider than the original: a face that reads the width from the name is not lied to.
// So a 300 px photo has one file, `w300.webp`, which serves all three variant names; a 500 px photo
// has `w320.webp` and `w500.webp`.
import { z } from 'zod'

import type { AssetId } from './ids'
import { ASSET_VARIANT_WIDTHS, type AssetVariantWidths } from './snapshot/build'

/** What `planAssetVariants` decides for a photo of a given width. */
export interface AssetVariantPlan {
  /** The width each variant name uses. */
  readonly variants: AssetVariantWidths
  /** The distinct widths to make, smallest first (one file each). */
  readonly files: readonly number[]
}

/** The variants for an original `originalWidth` pixels wide: the usual widths, capped at it. */
export function planAssetVariants(originalWidth: number): AssetVariantPlan {
  if (!Number.isInteger(originalWidth) || originalWidth < 1) {
    throw new RangeError('an image is at least one pixel wide')
  }
  const variants: AssetVariantWidths = {
    thumb: Math.min(ASSET_VARIANT_WIDTHS.thumb, originalWidth),
    card: Math.min(ASSET_VARIANT_WIDTHS.card, originalWidth),
    full: Math.min(ASSET_VARIANT_WIDTHS.full, originalWidth),
  }
  const files = [...new Set([variants.thumb, variants.card, variants.full])].sort((a, b) => a - b)
  return { variants, files }
}

/** The publish-store path of one variant file: `a/<as_ id>/w<width>.webp` (no leading slash). */
export function assetVariantFile(assetId: AssetId, width: number): string {
  return `a/${assetId}/w${width}.webp`
}

const WidthSchema = z.int().min(1).max(16_383)

const StoredVariantsSchema = z
  .strictObject({ thumb: WidthSchema, card: WidthSchema, full: WidthSchema })
  .refine((v) => v.thumb <= v.card && v.card <= v.full, 'widths grow from thumb to full')

/**
 * Reads `assets.variants` (jsonb: anything may be in it). A record that is not exactly
 * `{thumb, card, full}` with growing widths counts as no variants, so a snapshot shows no image
 * rather than a path to a file that may not exist.
 */
export function parseAssetVariants(value: unknown): AssetVariantWidths | null {
  const parsed = StoredVariantsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
