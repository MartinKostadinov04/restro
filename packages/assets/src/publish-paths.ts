// The paths of the publish store and the rules that go with them, in one place (brief S3-01b; doc
// "Files on the CDN"). The publish store holds the files a guest page reads: public by design,
// nothing internal. Only four shapes exist, and every store and the `/cdn` route accept those and
// nothing else, so a path from a URL can never reach another file, and an original photo or a
// private file has no path to be stored under.
//
//   snap/<sn_ id>.json                 a snapshot; never changes
//   m/<nd_ id>/<vn_ id>/current.json   {snapshot_id, version, hash}: which snapshot is current
//   m/<nd_ id>/<vn_ id>/live.json      the live overlay (sold-out marks)
//   a/<as_ id>/w<width>.webp           a photo variant; never changes
//
// Pure: no I/O.
import { type AssetId, isId, type NodeId, type SnapshotId, type VenueId } from '@restro/core'

/** The four kinds of file the publish store holds. */
export type PublishPathKind = 'snapshot' | 'current' | 'live' | 'variant'

/** What a publish-store path says. */
export type ParsedPublishPath =
  | { readonly kind: 'snapshot'; readonly snapshotId: SnapshotId }
  | { readonly kind: 'current'; readonly menuId: NodeId; readonly venueId: VenueId }
  | { readonly kind: 'live'; readonly menuId: NodeId; readonly venueId: VenueId }
  | { readonly kind: 'variant'; readonly assetId: AssetId; readonly width: number }

/** Thrown for a path that is not one of the four shapes. */
export class InvalidPublishPathError extends Error {
  override name = 'InvalidPublishPathError'
  constructor(path: string) {
    super(`not a publish-store path: ${JSON.stringify(path.slice(0, 80))}`)
  }
}

const MAX_PATH_LENGTH = 200

/** Reads a path; null for anything that is not one of the four shapes. */
export function parsePublishPath(path: string): ParsedPublishPath | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) return null
  const parts = path.split('/')
  if (parts.length === 2 && parts[0] === 'snap') {
    const match = /^(sn_[0-9A-Za-z]+)\.json$/.exec(parts[1] ?? '')
    if (match && isId('sn', match[1])) return { kind: 'snapshot', snapshotId: match[1] }
    return null
  }
  if (parts.length === 4 && parts[0] === 'm') {
    const [, menuId, venueId, file] = parts
    if (!isId('nd', menuId) || !isId('vn', venueId)) return null
    if (file === 'current.json') return { kind: 'current', menuId, venueId }
    if (file === 'live.json') return { kind: 'live', menuId, venueId }
    return null
  }
  if (parts.length === 3 && parts[0] === 'a') {
    const [, assetId, file] = parts
    const match = /^w([1-9][0-9]{0,4})\.webp$/.exec(file ?? '')
    if (isId('as', assetId) && match) {
      const width = Number(match[1])
      if (width <= 16_383) return { kind: 'variant', assetId, width }
    }
  }
  return null
}

/** `parsePublishPath`, but throws `InvalidPublishPathError`. */
export function assertPublishPath(path: string): ParsedPublishPath {
  const parsed = parsePublishPath(path)
  if (parsed === null) throw new InvalidPublishPathError(path)
  return parsed
}

/** The path of a snapshot file. */
export const snapshotPath = (snapshotId: SnapshotId): string => `snap/${snapshotId}.json`
/** The path of the pointer file of a menu + venue. */
export const currentPath = (menuId: NodeId, venueId: VenueId): string =>
  `m/${menuId}/${venueId}/current.json`
/** The path of the live overlay of a menu + venue. */
export const livePath = (menuId: NodeId, venueId: VenueId): string =>
  `m/${menuId}/${venueId}/live.json`
/** The path of a photo variant (`assetVariantFile` in core builds the same string). */
export const variantPath = (assetId: AssetId, width: number): string =>
  `a/${assetId}/w${width}.webp`

const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * The `Cache-Control` of a file, by its path (doc "Files on the CDN"): snapshots and variants never
 * change under their path (a year, immutable); the pointer is read every 30 seconds; the live
 * overlay every 15. Throws for a path that is not one of the four shapes.
 */
export function publishCacheControl(path: string): string {
  switch (assertPublishPath(path).kind) {
    case 'snapshot':
    case 'variant':
      return IMMUTABLE
    case 'current':
      return 'public, max-age=30'
    case 'live':
      return 'public, max-age=15'
  }
}

/** The `Content-Type` of a file, by its path. Throws for a path that is not one of the four shapes. */
export function publishContentType(path: string): string {
  return assertPublishPath(path).kind === 'variant' ? 'image/webp' : 'application/json'
}

/** What a store's `put` takes besides the bytes. */
export interface PublishPutOptions {
  readonly contentType: string
  readonly cacheControl: string
}

/** The options for `put` at `path`: its content type and cache rule, from one place. */
export function publishPutOptions(path: string): PublishPutOptions {
  return { contentType: publishContentType(path), cacheControl: publishCacheControl(path) }
}
