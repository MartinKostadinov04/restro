// The publish store this process serves, chosen by the environment (`publishStoreConfig` in
// @restro/assets) and created on first use, once per process (it survives Next.js hot reloads in
// development). The web app only ever serves the LOCAL store (the `/cdn` route); with
// `PUBLISH_STORE=r2` the CDN serves the files and the route answers 404. Publishing itself is the
// worker's job: the web app writes no file here.
import { createPublishStore, type PublishStore, publishStoreConfig } from '@restro/assets'

import { logError } from '../log'

const globals = globalThis as typeof globalThis & {
  __restroLocalPublishStore?: Promise<PublishStore | null>
}

/**
 * The local publish store, or null when the process publishes to R2 (or its settings are
 * unusable, which is logged: the route then answers 404 rather than an error page).
 */
export function getLocalPublishStore(): Promise<PublishStore | null> {
  if (!globals.__restroLocalPublishStore) {
    const started = (async () => {
      const config = publishStoreConfig(process.env)
      return config.kind === 'local' ? createPublishStore(config) : null
    })().catch((error: unknown) => {
      // A failed start is not remembered, so a fixed setting works without a restart.
      globals.__restroLocalPublishStore = undefined
      logError('publish_store_unusable', error)
      return null
    })
    globals.__restroLocalPublishStore = started
  }
  return globals.__restroLocalPublishStore
}
