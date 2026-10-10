// The heartbeat: proves the queue works end to end and tells GET /health the worker is alive.
//
// Every minute pg-boss's scheduler creates one job on this queue; a worker fetches it and upserts
// this process's row in restro.worker_heartbeats through withSystem (a system table: no tenant).
// Only after the write succeeded does the worker report the beat to /health.
//
// The job goes through the shared queue, so with several worker replicas each beat is taken by
// one of them and the others would look stale. Run one worker until the heartbeat is made
// per replica (see the S1-06 report).
import { withSystem, workerHeartbeats } from '@restro/db'

import { defineJob } from './types'

export const WORKER_HEARTBEAT_JOB = 'worker-heartbeat'

export const workerHeartbeat = defineJob({
  name: WORKER_HEARTBEAT_JOB,
  schedule: { cron: '* * * * *' },
  options: {
    queue: {
      // The next beat is a minute away; retrying a missed one adds nothing.
      retryLimit: 0,
      expireInSeconds: 60,
      // A beat that has not run after 15 minutes is meaningless; do not keep a backlog of them.
      retentionSeconds: 15 * 60,
      // One finished job per minute: keep an hour of them, not the default week.
      deleteAfterSeconds: 60 * 60,
    },
  },
  async handler(_jobs, { pool, log, workerId, version, now, status }) {
    const beatAt = now()
    await withSystem(pool, (tx) =>
      tx
        .insert(workerHeartbeats)
        .values({ workerId, lastBeatAt: beatAt, version })
        .onConflictDoUpdate({
          target: workerHeartbeats.workerId,
          set: { lastBeatAt: beatAt, version },
        }),
    )
    status.recordBeat(beatAt)
    log.debug({ lastBeatAt: beatAt.toISOString() }, 'heartbeat recorded')
  },
})
