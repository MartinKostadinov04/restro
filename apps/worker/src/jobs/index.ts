// The one list of background jobs. A job exists when it is in this list (see ./types.ts for the
// convention); removing it here stops its worker and removes its schedule on the next start.
import type { JobDefinition } from './types'
import { workerHeartbeat } from './worker-heartbeat'

export const jobs: readonly JobDefinition[] = [workerHeartbeat]
