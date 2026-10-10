// The one list of background jobs. A job exists when it is in this list (see ./types.ts for the
// convention); removing it here stops its worker and removes its schedule on the next start.
//
// `jobs` are the ones every worker runs. The barsy sync jobs need the sealing keys (they open the
// integrations' credentials) and the asset store, so they are built from the configuration by
// `buildJobs`: without SEAL_PUBLIC_KEY and SEAL_PRIVATE_KEY the worker still starts, runs the
// heartbeat, and registers no sync job (one warning in the log).
import { randomBytes } from 'node:crypto'

import { createAssetStore } from '@restro/assets'

import { ConfigError, requireSealKeys, type SealKeys, type WorkerConfig } from '../config'
import type { Logger } from '../logger'
import { createBarsyJobs } from './barsy'
import type { JobDefinition } from './types'
import { workerHeartbeat } from './worker-heartbeat'

export const jobs: readonly JobDefinition[] = [workerHeartbeat]

/** Every job this worker runs: the fixed ones, plus the barsy sync jobs when the keys are set. */
export async function buildJobs(config: WorkerConfig, log: Logger): Promise<JobDefinition[]> {
  let keys: SealKeys
  try {
    keys = requireSealKeys(config)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    log.warn(
      'SEAL_PUBLIC_KEY and SEAL_PRIVATE_KEY are not set: the barsy sync jobs are not registered',
    )
    return [...jobs]
  }
  // The worker only stores photos; the signing secret is for links the web app hands out, which
  // this process never makes. A random one keeps the local store's constructor satisfied.
  const store = await createAssetStore(config.assets, randomBytes(32).toString('hex'))
  return [...jobs, ...createBarsyJobs({ keys, policy: config.barsy, store })]
}
