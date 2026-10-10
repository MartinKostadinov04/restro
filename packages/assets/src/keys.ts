// Storage keys of assets: `tenants/<tn_…>/assets/<as_…>/original.<ext>`. The tenant is part of
// the key so one tenant's objects can be listed, exported or deleted on their own, and so the
// local route can check that a signed-in person only reads their own tenant's files. The
// extension comes from the type found in the bytes (magic bytes), never from the upload's name.
import {
  ASSET_IMAGE_EXTENSIONS,
  type AssetId,
  type AssetImageType,
  isId,
  type TenantId,
} from '@restro/core'

const EXTENSION_TYPES: Readonly<Record<string, AssetImageType>> = Object.fromEntries(
  (Object.entries(ASSET_IMAGE_EXTENSIONS) as [AssetImageType, string][]).map(
    ([type, extension]) => [extension, type],
  ),
)

const KEY_PATTERN =
  /^tenants\/(tn_[0-9A-Za-z]{22})\/assets\/(as_[0-9A-Za-z]{22})\/original\.([a-z0-9]+)$/

/** The key of an asset's original file. */
export function assetStorageKey(
  tenantId: TenantId | string,
  assetId: AssetId,
  contentType: AssetImageType,
): string {
  return `tenants/${tenantId}/assets/${assetId}/original.${ASSET_IMAGE_EXTENSIONS[contentType]}`
}

/** What a storage key says, or null when it is not a key this module builds. */
export interface ParsedAssetKey {
  readonly tenantId: string
  readonly assetId: AssetId
  readonly contentType: AssetImageType
}

/** Reads a key built by `assetStorageKey`; anything else (other shapes, odd extensions) is null. */
export function parseAssetKey(key: string): ParsedAssetKey | null {
  const match = KEY_PATTERN.exec(key)
  if (!match) return null
  const [, tenantId, assetId, extension] = match
  const contentType = EXTENSION_TYPES[extension ?? '']
  if (!isId('tn', tenantId) || !isId('as', assetId) || contentType === undefined) return null
  return { tenantId, assetId, contentType }
}
