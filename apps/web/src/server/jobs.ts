// The web app's side of the background jobs (brief S2-03b): it only SENDS. `enqueueJob` puts a job
// in the pg-boss queue the worker runs; nothing here calls `work`, so the web process never runs
// a job. S2-05's "Connect" and "Sync now" buttons use it.
//
// The names and the payloads come from `@restro/core` (`JOB_NAMES`, `prepareJob`), the same module
// the worker imports, so both sides always agree. A payload is validated before it is sent, and
// the singleton key is derived from it: the queues use pg-boss's `exclusive` policy, so a second
// "Sync now" while a pull of the same integration is queued or running is not queued again
// (`enqueueJob` then returns `null`).
//
// The producer connects as the app role with `migrate: false`, `createSchema: false`,
// `supervise: false` and `schedule: false`: the worker owns the queue tables, the maintenance and
// the schedules. One small pool (max 1) of its own, created on first use and kept across Next.js
// hot reloads.
import { type JobPayload, type ProducedJobName, prepareJob } from '@restro/core'
import { PgBoss } from 'pg-boss'

import { serverEnv } from './env'
import { logError } from './log'

/** The schema the worker's pg-boss keeps its tables in (apps/worker/src/connection.ts). */
const QUEUE_SCHEMA = 'pgboss'

/** The one method of pg-boss the producer uses; tests pass a fake. */
export interface JobSender {
  send(
    name: string,
    data: object,
    options: { singletonKey: string; startAfter?: number; group?: { readonly id: string } },
  ): Promise<string | null>
}

interface Producer {
  boss?: PgBoss
  started?: Promise<PgBoss>
}

const globals = globalThis as typeof globalThis & { __restroJobProducer?: Producer }
globals.__restroJobProducer ??= {}
const producer: Producer = globals.__restroJobProducer

function startedBoss(): Promise<PgBoss> {
  producer.started ??= (async () => {
    const boss = new PgBoss({
      connectionString: serverEnv().DATABASE_URL,
      schema: QUEUE_SCHEMA,
      createSchema: false,
      migrate: false,
      supervise: false,
      schedule: false,
      max: 1,
      application_name: 'restro-web-queue',
    })
    boss.on('error', (error) => logError('job_queue_error', error))
    await boss.start()
    producer.boss = boss
    return boss
  })().catch((error: unknown) => {
    // A failed start is not remembered: the next call tries again.
    producer.started = undefined
    throw error
  })
  return producer.started
}

/**
 * Validates `data` for the job `name` and sends it. Returns the pg-boss job id, or `null` when an
 * identical job (same queue, same integration) is already queued or running. Throws on a payload
 * that does not match the job's schema, and when the queue cannot be reached.
 *
 * `sender` is for tests; the app never passes it.
 */
export async function enqueueJob<N extends ProducedJobName>(
  name: N,
  data: JobPayload<N>,
  sender?: JobSender,
): Promise<string | null> {
  const prepared = prepareJob(name, data)
  const target: JobSender = sender ?? (await startedBoss())
  return target.send(name, prepared.data, {
    singletonKey: prepared.singletonKey,
    // An automatic publish waits out its merge window (core/jobs.ts); every other job starts at once.
    ...(prepared.startAfter === undefined ? {} : { startAfter: prepared.startAfter }),
    // The route's queues run one run at a time per key, several keys at once (core/jobs.ts).
    ...(prepared.group === undefined ? {} : { group: prepared.group }),
  })
}

/** Closes the producer's connection (tests and shutdown hooks). */
export async function closeJobProducer(): Promise<void> {
  const started = producer.started
  producer.started = undefined
  producer.boss = undefined
  if (started) await (await started.catch(() => undefined))?.stop({ graceful: false })
}
