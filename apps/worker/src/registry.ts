// Registers the jobs from jobs/index.ts with pg-boss: queues, dead-letter queues, workers and
// schedules. The convention a job author follows is described in jobs/types.ts.
import { isProducedJob, prepareJob } from '@restro/core'
import type { Job, JobWithMetadata, PgBoss, QueueOptions, QueuePolicy } from 'pg-boss'

import { summarizeError } from './errors'
import type { JobDefinition, WorkerContext } from './jobs/types'

/** Failed jobs of queue `x` end up in queue `x.dead`. */
export const DEAD_LETTER_SUFFIX = '.dead'

/** Dead-lettered jobs stay for 30 days (the backup retention), then pg-boss deletes them. */
const DEAD_LETTER_RETENTION_SECONDS = 30 * 24 * 60 * 60

const QUEUE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/

export function deadLetterName(queue: string): string {
  return `${queue}${DEAD_LETTER_SUFFIX}`
}

/** What a failed job rethrows: a one-line summary that is safe to store (see errors.ts). */
export class JobFailedError extends Error {
  constructor(summary: string) {
    super(summary)
    this.name = 'JobFailedError'
  }
}

/** Throws when the list would confuse pg-boss: duplicate or malformed names. */
export function assertValidJobs(jobs: readonly JobDefinition[]): void {
  const seen = new Set<string>()
  for (const { name } of jobs) {
    if (!QUEUE_NAME_PATTERN.test(name)) {
      throw new Error(`Job name "${name}" may only contain letters, digits, _, - and .`)
    }
    if (name.endsWith(DEAD_LETTER_SUFFIX)) {
      throw new Error(`Job name "${name}" ends in ${DEAD_LETTER_SUFFIX}, which is reserved.`)
    }
    if (seen.has(name)) throw new Error(`Job name "${name}" is registered twice.`)
    seen.add(name)
  }
}

/**
 * Creates the queue if it is missing, then applies the options (createQueue never updates). The
 * policy is part of creation only: pg-boss cannot change it afterwards. A queue still on the
 * job's `previousPolicy` is deleted first, so it is created again with the new one; its waiting
 * jobs (queued or waiting for a retry) are sent again into it, as their producers send them.
 */
async function ensureQueue(
  boss: PgBoss,
  name: string,
  options: QueueOptions & { deadLetter?: string },
  context: WorkerContext,
  policy?: QueuePolicy,
  previousPolicy?: QueuePolicy,
) {
  let carried: JobWithMetadata<object>[] | undefined
  if (policy !== undefined && previousPolicy !== undefined) {
    const found = (await boss.getQueue(name))?.policy
    if (found === previousPolicy && found !== policy) {
      carried = await boss.findJobs<object>(name, { queued: true })
      await boss.deleteQueue(name)
    } else if (found !== undefined && found !== policy) {
      context.log.error(
        { queue: name, found, wanted: policy },
        'queue has another policy than its job, which pg-boss cannot change',
      )
    }
  }
  await boss.createQueue(name, policy === undefined ? options : { ...options, policy })
  await boss.updateQueue(name, options)
  if (carried === undefined) return
  // One waiting job per key on the new policy: of a key's queued job and its retry (`stately` kept
  // one of each), the queued one is sent first and kept, then the earliest due.
  const order = (job: JobWithMetadata<object>) => (job.state === 'created' ? 0 : 1)
  carried.sort((a, b) => order(a) - order(b) || a.startAfter.getTime() - b.startAfter.getTime())
  let sent = 0
  for (const job of carried) if (await sendAgain(boss, name, job, context)) sent += 1
  context.log.warn(
    { queue: name, from: previousPolicy, to: policy, waiting: carried.length, sent },
    'queue created again with its new policy; its waiting jobs were sent again',
  )
}

/**
 * Sends a job of a queue created again (`ensureQueue`) as its producer sends it (`prepareJob`: its
 * key and its group), to start when it was due. True when it is queued; false when the same job
 * was already queued again (one waiting per key), or its payload is no longer valid (logged).
 */
async function sendAgain(
  boss: PgBoss,
  name: string,
  job: JobWithMetadata<object>,
  context: WorkerContext,
): Promise<boolean> {
  try {
    // Its group as `prepareJob` gives it, which also checks the payload is still valid.
    const group = isProducedJob(name) ? prepareJob(name, job.data).group : undefined
    const id = await boss.send(name, job.data, {
      // The key it had: a producer may send a key of its own (a payment's deadline check).
      ...(job.singletonKey == null ? {} : { singletonKey: job.singletonKey }),
      ...(group === undefined ? {} : { group }),
      startAfter: job.startAfter,
    })
    return id !== null
  } catch (error) {
    context.log.error(
      { queue: name, jobId: job.id, error: summarizeError(error) },
      'a waiting job could not be sent again',
    )
    return false
  }
}

/**
 * Wraps a job's handler: logs a failure safely and rethrows only a summary, so the error text
 * pg-boss stores in the job record never contains query parameters.
 */
function guarded(job: JobDefinition, context: WorkerContext) {
  const log = context.log.child({ job: job.name })
  const jobContext: WorkerContext = { ...context, log }
  return async (batch: Job<object>[]): Promise<void> => {
    const startedAt = Date.now()
    const ids = batch.map((item) => item.id)
    try {
      await job.handler(batch, jobContext)
      log.debug({ jobIds: ids, durationMs: Date.now() - startedAt }, 'job done')
    } catch (error) {
      log.error(
        {
          err: error,
          jobIds: ids,
          retryCount: batch[0]?.retryCount,
          durationMs: Date.now() - startedAt,
        },
        'job failed',
      )
      throw new JobFailedError(summarizeError(error))
    }
  }
}

/**
 * Brings pg-boss's persisted schedules in line with the list. Static schedules live under the
 * default key (''). Removed: any schedule of a job that is no longer in the list, and the
 * default-key schedule of a job that no longer has a `schedule`. Schedules under another key
 * of a listed job are left alone: later jobs may create those per venue.
 */
async function removeStaleSchedules(
  boss: PgBoss,
  jobs: readonly JobDefinition[],
  context: WorkerContext,
): Promise<void> {
  const byName = new Map(jobs.map((job) => [job.name, job]))
  for (const schedule of await boss.getSchedules()) {
    const job = byName.get(schedule.name)
    const stale = job === undefined || (schedule.key === '' && job.schedule === undefined)
    if (!stale) continue
    await boss.unschedule(schedule.name, schedule.key)
    context.log.info({ queue: schedule.name, key: schedule.key }, 'removed a stale schedule')
  }
}

/**
 * Creates every job's queues, starts its worker and (re)writes its schedule. Idempotent: it
 * runs on every start. pg-boss must be started (its tables exist). With `schedules: false` (a
 * worker beside the deployment's own on the same queue, like the e2e pay harness) it writes no
 * schedule and removes none: the schedules are the full worker's, and a partial list would
 * remove every tick it doesn't carry.
 */
export async function registerJobs(
  boss: PgBoss,
  jobs: readonly JobDefinition[],
  context: WorkerContext,
  { schedules = true }: { readonly schedules?: boolean } = {},
): Promise<void> {
  assertValidJobs(jobs)
  for (const job of jobs) {
    const deadLetter = deadLetterName(job.name)
    // The dead-letter queue must exist before the queue that points at it.
    await ensureQueue(
      boss,
      deadLetter,
      { retentionSeconds: DEAD_LETTER_RETENTION_SECONDS },
      context,
    )
    await ensureQueue(
      boss,
      job.name,
      { ...job.options.queue, deadLetter },
      context,
      job.options.policy,
      job.options.previousPolicy,
    )
    await boss.work(job.name, job.options.work ?? {}, guarded(job, context))
    if (schedules && job.schedule) {
      await boss.schedule(job.name, job.schedule.cron, null, { tz: job.schedule.tz ?? 'UTC' })
    }
    context.log.info(
      { job: job.name, schedule: schedules ? (job.schedule?.cron ?? null) : null, deadLetter },
      'job registered',
    )
  }
  if (schedules) await removeStaleSchedules(boss, jobs, context)
}
