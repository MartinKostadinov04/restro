// The one list of background jobs. A job exists when it is in this list (see ./types.ts for the
// convention); removing it here stops its worker and removes its schedule on the next start.
//
// `jobs` are the ones every worker runs (the heartbeat, and the idle order tick of #75, which
// needs nothing but the database). The publish jobs (./publish.ts) need the asset store and
// the publish store but no credentials, so every worker runs them. The barsy sync jobs need the
// sealing keys (they open the integrations' credentials) and the asset store, so they are built
// from the configuration by `buildJobs`: without SEAL_PUBLIC_KEY and SEAL_PRIVATE_KEY the worker
// still starts, runs the heartbeat, the floor reading, the publish jobs and the provider notices
// (#108), and registers no sync job (one warning in the log). `seal-table-codes` (#70) needs only
// the public key; WORKER_POS_SYNC=off keeps the sync jobs out while the keys are set. The table
// readings (#74) run beside the floor reading when BILL_ID_KEY is set (one warning in the log
// when it is not).
import { randomBytes } from 'node:crypto'

import { createAssetStore, createPublishStore } from '@restro/assets'

import { ConfigError, requireSealKeys, type SealKeys, type WorkerConfig } from '../config'
import { paymentProviders } from '../connectors'
import type { Logger } from '../logger'
import { createBarsyJobs } from './barsy'
import { createFloorJobs } from './floor'
import { orderTidyTick } from './order-tidy'
import { createProviderNoticesJob } from './provider-notices'
import { createPublishJobs } from './publish'
import { createPurgeJobs } from './purge'
import { createReadingJobs } from './readings'
import { createSealTableCodesJob } from './seal-table-codes'
import type { JobDefinition } from './types'
import { workerHeartbeat } from './worker-heartbeat'

export const jobs: readonly JobDefinition[] = [workerHeartbeat, orderTidyTick]

/** Every job this worker runs: the fixed ones, the publish jobs, and the sync jobs when the keys are set. */
export async function buildJobs(config: WorkerConfig, log: Logger): Promise<JobDefinition[]> {
  // The worker only stores photos; the signing secret is for links the web app hands out, which
  // this process never makes. A random one keeps the local store's constructor satisfied.
  const assetStore = await createAssetStore(config.assets, randomBytes(32).toString('hex'))
  const publishStore = await createPublishStore(config.publish)
  const publishJobs = createPublishJobs({ publishStore, assetStore })
  // The provider notices (#108) need no POS and no sealing key: every worker handles them.
  const noticeJobs = [createProviderNoticesJob({ providers: paymentProviders() })]
  // The floor reading (#71) needs no credentials (the simulated POS has none) and no sealing keys,
  // so every worker runs it unless WORKER_POS_SYNC is off (it is a POS read); a `sim` instance is
  // refused in production inside it.
  // The table readings (#74) are POS reads like the floor's; they need the bill-id key, without
  // which no reading is recorded (the log says so once).
  const billIdKey = config.billIdKey ?? null
  if (config.posSync && billIdKey === null) {
    log.warn('BILL_ID_KEY is not set: the table reading jobs are not registered')
  }
  const floorJobs = [
    ...createFloorJobs({ sim: config.sim }),
    ...(billIdKey === null ? [] : createReadingJobs({ sim: config.sim, billIdKey })),
  ]
  // The purge (D83) runs only where the purge role's connection is set; without it nothing is
  // ever erased, and the log says so once.
  const purgeDatabaseUrl = config.purgeDatabaseUrl ?? null
  const purgeJobs =
    purgeDatabaseUrl === null ? [] : createPurgeJobs({ purgeDatabaseUrl, publishStore })
  if (purgeDatabaseUrl === null) {
    log.warn('DATABASE_URL_PURGE is not set: the purge jobs are not registered (nothing is erased)')
  }

  let keys: SealKeys
  try {
    keys = requireSealKeys(config)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    log.warn(
      'SEAL_PUBLIC_KEY and SEAL_PRIVATE_KEY are not set: the barsy sync jobs and seal-table-codes are not registered',
    )
    return [
      ...jobs,
      ...(config.posSync ? floorJobs : []),
      ...publishJobs,
      ...noticeJobs,
      ...purgeJobs,
    ]
  }
  const sealJobs = [createSealTableCodesJob({ publishStore, publicKey: keys.publicKey })]
  if (!config.posSync) {
    log.warn('WORKER_POS_SYNC is off: the POS sync jobs are not registered')
    return [...jobs, ...publishJobs, ...noticeJobs, ...purgeJobs, ...sealJobs]
  }
  return [
    ...jobs,
    ...createBarsyJobs({ keys, policy: config.barsy, store: assetStore }),
    ...floorJobs,
    ...publishJobs,
    ...noticeJobs,
    ...purgeJobs,
    ...sealJobs,
  ]
}
