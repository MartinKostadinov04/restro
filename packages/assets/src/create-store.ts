import type { AssetStoreConfig } from './config'
import { LocalAssetStore } from './local-store'
import type { AssetStore } from './types'

/** Builds the store a configuration describes. `signingSecret` signs the local store's links. */
export async function createAssetStore(
  config: AssetStoreConfig,
  signingSecret: string,
): Promise<AssetStore> {
  if (config.kind === 'local') return new LocalAssetStore({ rootDir: config.dir, signingSecret })
  const { R2AssetStore } = await import('./r2-store')
  return R2AssetStore.fromSettings(config)
}
