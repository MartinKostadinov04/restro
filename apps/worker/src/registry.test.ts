import type { DbPool } from '@restro/db'
import type { Job, PgBoss } from 'pg-boss'
import { describe, expect, it } from 'vitest'

import { WorkerStatus } from './health'
import { defineJob, type JobDefinition, type WorkerContext } from './jobs/types'
import { createLogger } from './logger'
import { assertValidJobs, deadLetterName, JobFailedError, registerJobs } from './registry'

const SECRET = 'jane.doe@example.com'

type Call = [method: string, ...args: unknown[]]

/** Records the pg-boss calls the registry makes. */
function fakeBoss(existingSchedules: { name: string; key: string }[] = []) {
  const calls: Call[] = []
  const handlers = new Map<string, (batch: Job<object>[]) => Promise<void>>()
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push([method, ...args])
    }
  const boss = {
    createQueue: record('createQueue'),
    updateQueue: record('updateQueue'),
    schedule: record('schedule'),
    unschedule: record('unschedule'),
    getSchedules: async () => existingSchedules,
    work: async (
      name: string,
      options: unknown,
      handler: (batch: Job<object>[]) => Promise<void>,
    ) => {
      calls.push(['work', name, options])
      handlers.set(name, handler)
      return 'worker-id'
    },
  } as unknown as PgBoss
  return { boss, calls, handlers }
}

async function context() {
  const lines: string[] = []
  const log = await createLogger({
    level: 'debug',
    pretty: false,
    destination: { write: (line: string) => void lines.push(line) },
  })
  const ctx: WorkerContext = {
    pool: {} as DbPool,
    log,
    workerId: 'w1',
    version: '1.2.3',
    now: () => new Date('2026-10-08T12:00:00Z'),
    status: new WorkerStatus(),
  }
  return { ctx, lines }
}

const job = (name: string, extra: Partial<JobDefinition> = {}) =>
  defineJob({
    name,
    options: { queue: { retryLimit: 1 } },
    async handler() {},
    ...extra,
  })

const batch = (...ids: string[]) => ids.map((id) => ({ id, retryCount: 0 }) as Job<object>)

describe('assertValidJobs', () => {
  it('accepts distinct, well-formed names', () => {
    expect(() => assertValidJobs([job('a'), job('barsy-reconcile'), job('x_y.z')])).not.toThrow()
  })

  it('rejects duplicates, odd characters and the reserved .dead suffix', () => {
    expect(() => assertValidJobs([job('a'), job('a')])).toThrow(/registered twice/)
    expect(() => assertValidJobs([job('has space')])).toThrow(/may only contain/)
    expect(() => assertValidJobs([job('a/b')])).toThrow(/may only contain/)
    expect(() => assertValidJobs([job('menu-publish.dead')])).toThrow(/reserved/)
  })
})

describe('registerJobs', () => {
  it('creates the dead-letter queue first, then the queue that points at it, then the worker', async () => {
    const { boss, calls } = fakeBoss()
    const { ctx } = await context()
    await registerJobs(
      boss,
      [job('menu-publish', { options: { queue: { retryLimit: 3 }, work: { batchSize: 5 } } })],
      ctx,
    )
    expect(deadLetterName('menu-publish')).toBe('menu-publish.dead')
    const queue = { retryLimit: 3, deadLetter: 'menu-publish.dead' }
    expect(calls.filter(([method]) => method !== 'getSchedules')).toEqual([
      ['createQueue', 'menu-publish.dead', { retentionSeconds: 2592000 }],
      ['updateQueue', 'menu-publish.dead', { retentionSeconds: 2592000 }],
      ['createQueue', 'menu-publish', queue],
      ['updateQueue', 'menu-publish', queue],
      ['work', 'menu-publish', { batchSize: 5 }],
    ])
  })

  it('schedules a job that has a schedule, in UTC unless told otherwise', async () => {
    const { boss, calls } = fakeBoss()
    const { ctx } = await context()
    await registerJobs(
      boss,
      [
        job('a', { schedule: { cron: '* * * * *' } }),
        job('b', { schedule: { cron: '0 12 * * *', tz: 'Europe/Sofia' } }),
        job('c'),
      ],
      ctx,
    )
    expect(calls.filter(([method]) => method === 'schedule')).toEqual([
      ['schedule', 'a', '* * * * *', null, { tz: 'UTC' }],
      ['schedule', 'b', '0 12 * * *', null, { tz: 'Europe/Sofia' }],
    ])
  })

  it('removes schedules of removed jobs and of jobs that lost their schedule, nothing else', async () => {
    const { boss, calls } = fakeBoss([
      { name: 'removed-job', key: '' },
      { name: 'removed-job', key: 'venue-1' },
      { name: 'lost-schedule', key: '' },
      { name: 'lost-schedule', key: 'venue-1' }, // dynamic, per-venue: kept
      { name: 'still-scheduled', key: '' },
    ])
    const { ctx } = await context()
    await registerJobs(
      boss,
      [job('lost-schedule'), job('still-scheduled', { schedule: { cron: '* * * * *' } })],
      ctx,
    )
    expect(calls.filter(([method]) => method === 'unschedule')).toEqual([
      ['unschedule', 'removed-job', ''],
      ['unschedule', 'removed-job', 'venue-1'],
      ['unschedule', 'lost-schedule', ''],
    ])
  })

  it('refuses an invalid list before calling pg-boss', async () => {
    const { boss, calls } = fakeBoss()
    const { ctx } = await context()
    await expect(registerJobs(boss, [job('a'), job('a')], ctx)).rejects.toThrow(/twice/)
    expect(calls).toEqual([])
  })
})

describe('the handler the registry gives pg-boss', () => {
  it('runs the job with the context, a logger that carries the job name, and logs success', async () => {
    const { boss, handlers } = fakeBoss()
    const { ctx, lines } = await context()
    const seen: { workerId: string; ids: string[] }[] = []
    await registerJobs(
      boss,
      [
        job('ok', {
          async handler(jobs, context) {
            context.log.info('inside')
            seen.push({ workerId: context.workerId, ids: jobs.map((item) => item.id) })
          },
        }),
      ],
      ctx,
    )
    await handlers.get('ok')?.(batch('j1', 'j2'))
    expect(seen).toEqual([{ workerId: 'w1', ids: ['j1', 'j2'] }])
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records.find((record) => record.msg === 'inside')).toMatchObject({ job: 'ok' })
    expect(records.find((record) => record.msg === 'job done')).toMatchObject({
      job: 'ok',
      jobIds: ['j1', 'j2'],
    })
  })

  it('logs a failure safely and rethrows only a summary', async () => {
    const { boss, handlers } = fakeBoss()
    const { ctx, lines } = await context()
    const cause = Object.assign(new Error('relation "x" does not exist'), {
      code: '42P01',
      detail: SECRET,
    })
    const wrapper = Object.assign(new Error(`Failed query: select\nparams: ${SECRET}`), {
      query: 'select',
      params: [SECRET],
      cause,
    })
    await registerJobs(
      boss,
      [
        job('bad', {
          async handler() {
            throw wrapper
          },
        }),
      ],
      ctx,
    )

    const rejection = await handlers
      .get('bad')?.(batch('j1'))
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    expect(rejection).toBeInstanceOf(JobFailedError)
    const thrown = rejection as JobFailedError
    expect(thrown.message).toContain('42P01')
    expect(thrown.message).not.toContain(SECRET)
    expect(thrown.cause).toBeUndefined()
    expect(lines.join('')).not.toContain(SECRET)
    const failure = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((record) => record.msg === 'job failed')
    expect(failure).toMatchObject({ job: 'bad', jobIds: ['j1'], retryCount: 0 })
  })
})
