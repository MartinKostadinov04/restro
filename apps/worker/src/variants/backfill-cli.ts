// `pnpm --filter @restro/worker variants:backfill`: makes the webp variants of every stored photo
// that has none (see backfill.ts). Reads the same environment as the worker (DATABASE_URL of the
// app role, ASSET_STORE, PUBLISH_STORE and their settings); needs no sealing key.
import { randomBytes } from 'node:crypto'

import { createAssetStore, createPublishStore } from '@restro/assets'
import { createPool } from '@restro/db'

import { ConfigError, loadConfig } from '../config'
import { createLogger } from '../logger'
import { backfillVariants } from './backfill'

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig()
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : 'Could not read the settings.')
    process.exit(1)
  }
  const log = await createLogger({ level: config.logLevel, pretty: config.prettyLogs })
  const pool = createPool(config.databaseUrl, {
    max: 2,
    applicationName: 'restro-variants-backfill',
  })
  try {
    const assets = await createAssetStore(config.assets, randomBytes(32).toString('hex'))
    const store = await createPublishStore(config.publish)
    const summary = await backfillVariants({ pool, assets, store, log })
    log.info(summary, 'photo variants backfilled')
    if (summary.failed > 0) process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error('The backfill stopped:', error instanceof Error ? error.message : 'unknown error')
  process.exit(1)
})
