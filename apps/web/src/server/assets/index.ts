// The asset store this process uses, chosen by the environment (./config.ts) and created on first
// use, once per process (it survives Next.js hot reloads in development). The R2 implementation
// is loaded only when it is chosen, so a local run never loads the AWS SDK.

import type { AssetStore } from '@restro/assets'
import { assetStoreConfig, createAssetStore, type LocalAssetStore } from '@restro/assets'
import { serverEnv } from '../env'

export { ADMIN_URL_TTL_SECONDS, type AssetStore } from '@restro/assets'

const globals = globalThis as typeof globalThis & { __restroAssetStore?: Promise<AssetStore> }

/** The process-wide asset store. A failed start is not remembered, so a fixed setting works. */
export function getAssetStore(): Promise<AssetStore> {
  if (!globals.__restroAssetStore) {
    const started = createAssetStore(assetStoreConfig(process.env), serverEnv().BETTER_AUTH_SECRET)
    started.catch(() => {
      if (globals.__restroAssetStore === started) globals.__restroAssetStore = undefined
    })
    globals.__restroAssetStore = started
  }
  return globals.__restroAssetStore
}

/**
 * The local store when that is the chosen one (the serving route needs its `read`), else null.
 * Recognised by what it can do, not by `instanceof`: `next dev` may evaluate this module twice,
 * and the store kept on `globalThis` then belongs to the other copy of the class.
 */
export async function getLocalAssetStore(): Promise<LocalAssetStore | null> {
  const store = await getAssetStore()
  const local = store as Partial<LocalAssetStore>
  return typeof local.read === 'function' && typeof local.linkSecret === 'string'
    ? (store as LocalAssetStore)
    : null
}
