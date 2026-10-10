import type { PublishStoreConfig } from './publish-config'
import { LocalPublishStore, type PublishStore } from './publish-store'

/** Builds the publish store a configuration describes. */
export async function createPublishStore(config: PublishStoreConfig): Promise<PublishStore> {
  if (config.kind === 'local') return new LocalPublishStore({ rootDir: config.dir })
  const { R2PublishStore } = await import('./r2-publish-store')
  return R2PublishStore.fromSettings(config)
}
