// The convention every background job follows.
//
// To add a job:
//   1. Create apps/worker/src/jobs/<name>.ts that exports a JobDefinition made with defineJob().
//   2. Add it to the one list in apps/worker/src/jobs/index.ts.
// Nothing else: the registry (../registry.ts) creates the queue and its dead-letter queue, starts
// the worker and, when the job has a `schedule`, schedules it.
//
// What the registry does for every job, so a job file does not repeat it:
//   - creates the queue `<name>` and a dead-letter queue `<name>.dead`; a job that fails after
//     its last retry is moved to `<name>.dead` (visible in the pg-boss dashboard);
//   - applies `options.queue` to the queue on every start, so a changed option takes effect on
//     the next deploy;
//   - catches an error thrown by `handler`, logs it safely, and rethrows only a one-line summary
//     (so that the job record pg-boss stores never holds query parameters);
//   - for a job with a `schedule`, upserts the schedule; a schedule whose job was removed from
//     the list or lost its `schedule` is removed.
import type { DbPool } from '@restro/db'
import type { Job, QueueOptions, WorkOptions } from 'pg-boss'
import type { WorkerStatus } from '../health'
import type { Logger } from '../logger'

/** What a handler may use. Database access goes through the scoped helpers of @restro/db. */
export interface WorkerContext {
  /** Pool of the app role. Pass it to `withSystem` (or `withTenant`); never query it directly. */
  readonly pool: DbPool
  /** Logger of this job run (already carries the worker id). Errors: `log.error({ err }, ...)`. */
  readonly log: Logger
  readonly workerId: string
  /** The version in apps/worker/package.json. */
  readonly version: string
  /** The clock; tests replace it. */
  readonly now: () => Date
  /** What GET /health reports. Only the heartbeat job writes to it. */
  readonly status: WorkerStatus
}

/** A recurring run. `cron` is a cron expression (five fields) or an RFC 5545 RRULE. */
export interface JobSchedule {
  readonly cron: string
  /** IANA time zone the expression is read in. Default: UTC. */
  readonly tz?: string
}

export interface JobOptions {
  /**
   * Settings of the queue: retries (`retryLimit`, `retryDelay`, `retryBackoff`), how long a run
   * may take (`expireInSeconds`) and how long finished jobs are kept (`deleteAfterSeconds`,
   * `retentionSeconds`). `deadLetter` is set by the registry.
   */
  readonly queue: Omit<QueueOptions, 'deadLetter'>
  /** How the worker fetches: `batchSize`, `localConcurrency`, `pollingIntervalSeconds`. */
  readonly work?: WorkOptions
}

export interface JobDefinition<Data extends object = object> {
  /** Queue name: letters, digits, `_`, `-` and `.`. Must be unique. Do not end it in `.dead`. */
  readonly name: string
  readonly schedule?: JobSchedule
  /**
   * Runs a batch of jobs (a batch of one unless `options.work.batchSize` says more). Throwing
   * fails the whole batch and pg-boss retries it per `options.queue`. `job.signal` aborts when
   * the worker is shutting down past its grace period.
   */
  handler(jobs: Job<Data>[], context: WorkerContext): Promise<void>
  readonly options: JobOptions
}

/** Identity function that type-checks a job definition and infers its data type. */
export function defineJob<Data extends object = object>(
  definition: JobDefinition<Data>,
): JobDefinition<Data> {
  return definition
}
