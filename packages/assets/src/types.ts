// The asset store (brief S2-06b): where the bytes of uploaded and fetched images live. Two
// implementations behind one small interface, chosen by the environment (./index.ts): files on
// disk for local development (`LocalAssetStore`) and a private Cloudflare R2 bucket for staging
// and production (`R2AssetStore`). The database knows an asset by its `as_` id and its storage
// key (`assets` table, written by core's `createAsset`); a field value holds the id only.

/** Where image bytes are kept, and how a signed-in admin gets to see them. */
export interface AssetStore {
  /** Stores `bytes` under `key`, replacing anything there. Never returns a URL. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>

  /**
   * A URL the admin's browser can load the object from, valid for `ttlSeconds`. For R2 it is a
   * presigned GET URL of the private bucket; for the local store it is a signed link to our own
   * authenticated route. Never stored in a field value or a snapshot.
   */
  getUrl(key: string, ttlSeconds: number): Promise<string>
}

/** How long the admin's image links stay valid: an hour covers a long editing session. */
export const ADMIN_URL_TTL_SECONDS = 60 * 60
