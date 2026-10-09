// The asset store this process uses, chosen by the environment (./config.ts) and created on first
// use, once per process (it survives Next.js hot reloads in development). The R2 implementation
// is loaded only when it is chosen, so a local run never loads the AWS SDK.
import { serverEnv } from '../env'
import { type AssetStoreConfig, assetStoreConfig } from './config'
import { LocalAssetStore } from './local-store'
import type { AssetStore } from './types'

export { ADMIN_URL_TTL_SECONDS, type AssetStore } from './types'

/** Builds the store a configuration describes. `signingSecret` signs the local store's links. */
export async function createAssetStore(
  config: AssetStoreConfig,
  signingSecret: string,
): Promise<AssetStore> {
  if (config.kind === 'local') return new LocalAssetStore({ rootDir: config.dir, signingSecret })
  const { R2AssetStore } = await import('./r2-store')
  return R2AssetStore.fromSettings(config)
}

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
