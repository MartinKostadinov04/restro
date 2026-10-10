// What an image asset may be (brief S2-06b), shared by the writer (`createAsset`, in core/apply),
// the upload route that checks a file before it is stored, and the browser, which uses the same
// limits to refuse an obviously wrong file before sending it. Pure: no I/O.

/** The image types an asset may have: the ones the guest phone shell can show. */
export const ASSET_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** One of the accepted image content types. */
export type AssetImageType = (typeof ASSET_IMAGE_TYPES)[number]

/** The file extension each accepted type is stored under (never taken from the upload's name). */
export const ASSET_IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const satisfies Record<AssetImageType, string>

/** Where an asset came from: a person's upload or a photo fetched from barsy. */
export const ASSET_ORIGINS = ['upload', 'barsy'] as const

/** One of the asset origins. */
export type AssetOrigin = (typeof ASSET_ORIGINS)[number]

/** The largest upload accepted, in bytes (10 MiB). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** The largest side of an image in pixels (WebP's own limit is 16 383). */
export const MAX_IMAGE_SIDE = 16_383

/** The most pixels an image may have (100 megapixels): a guard against decompression bombs. */
export const MAX_IMAGE_PIXELS = 100_000_000

/** True if `value` is one of the accepted image content types. */
export function isAssetImageType(value: unknown): value is AssetImageType {
  return typeof value === 'string' && (ASSET_IMAGE_TYPES as readonly string[]).includes(value)
}
