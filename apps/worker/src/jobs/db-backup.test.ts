// The database backup job (ticket #320) without a database: the dump command is replaced, the
// store is a folder, and the clock is ours. The real `pg_dump` run, and the restore of its output
// into an empty database, are in tests/db-backup.test.ts (they need Postgres and the client tools).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { type BackupStore, backupKey, LocalBackupStore } from '@restro/assets'
import { DEFAULT_ORDERING_SETTINGS, type OrderingSettings } from '@restro/core'
import type { DbPool } from '@restro/db'
import type { Job } from 'pg-boss'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger } from '../logger'
import {
  AFTER_CLOSE_MS,
  BACKUP_RETENTION_DAYS,
  BACKUP_SCHEMAS,
  connectionEnvironment,
  createDbBackupJob,
  DB_BACKUP_JOB,
  type DumpDatabase,
  NIGHTLY_AFTER_MS,
  PgDumpMissingError,
  pgDump,
  runBackup,
  venueIsActive,
  withoutSecrets,
} from './db-backup'
import type { WorkerContext } from './types'

const SECRET = 'Sup3r-secret-pw'
const URL = `postgres://restro_backup:${SECRET}@db.example.com:5432/restro?sslmode=require`
const NOW = new Date('2026-11-08T14:00:00Z')
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const DUMP = Uint8Array.from([...Buffer.from('PGDMP'), 1, 2, 3])
const pool = {} as DbPool

const ago = (ms: number) => new Date(NOW.getTime() - ms)
const keyAgo = (ms: number) => backupKey(ago(ms))

let root: string
let store: LocalBackupStore
let lines: string[]
let dump: ReturnType<typeof vi.fn<DumpDatabase>>

async function logger() {
  return createLogger({
    level: 'debug',
    pretty: false,
    destination: { write: (line: string) => void lines.push(line) },
  })
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'restro-db-backup-'))
  store = new LocalBackupStore({ rootDir: root })
  lines = []
  dump = vi.fn<DumpDatabase>(async () => DUMP)
})
afterEach(() => rm(root, { recursive: true, force: true }))

const keys = async () => (await store.list()).map((object) => object.key).sort()

/** Runs the whole job handler, as the registry would, and answers the error it threw (or null). */
async function runJob(deps: Partial<Parameters<typeof createDbBackupJob>[0]> = {}) {
  const log = await logger()
  const job = createDbBackupJob({
    databaseUrl: URL,
    store,
    notify: null,
    dump,
    inService: async () => true,
    ...deps,
  })
  const context = { pool, log, now: () => NOW } as unknown as WorkerContext
  try {
    await job.handler([{ id: 'job-1' } as Job<object>], context)
    return null
  } catch (error) {
    return error as Error
  }
}

describe('the job', () => {
  it('is hourly, on the hour, and named as the stack doc names it', () => {
    const job = createDbBackupJob({ databaseUrl: URL, store, notify: null })
    expect(job.name).toBe(DB_BACKUP_JOB)
    expect(DB_BACKUP_JOB).toBe('db-backup')
    expect(job.schedule).toEqual({ cron: '0 * * * *' })
    // A run is over before the next hour's starts.
    expect(job.options.queue.expireInSeconds).toBeLessThan(60 * 60)
  })

  it('keeps the schemas it dumps in one list', () => {
    expect(BACKUP_SCHEMAS).toEqual(['restro', 'pgboss', 'drizzle'])
  })
})

describe('when a dump is due', () => {
  it('takes one every hour while a venue is in service', async () => {
    await store.put(keyAgo(HOUR), DUMP)
    expect(await runJob()).toBeNull()
    expect(dump).toHaveBeenCalledTimes(1)
    expect(dump.mock.calls[0]?.[0]).toBe(URL)
    expect(await keys()).toEqual([keyAgo(HOUR), backupKey(NOW)].sort())
    expect(Array.from((await store.get(backupKey(NOW))) ?? [])).toEqual(Array.from(DUMP))
  })

  it('takes none out of service while the newest dump is under a day old', async () => {
    await store.put(keyAgo(23 * HOUR), DUMP)
    expect(await runJob({ inService: async () => false })).toBeNull()
    expect(dump).not.toHaveBeenCalled()
    expect(await keys()).toEqual([keyAgo(23 * HOUR)])
  })

  it('takes the nightly one when the newest dump is a day old, less the hourly tick’s slack', async () => {
    await store.put(keyAgo(NIGHTLY_AFTER_MS - 1000), DUMP)
    await runJob({ inService: async () => false })
    expect(dump).not.toHaveBeenCalled()

    await store.put(keyAgo(NIGHTLY_AFTER_MS), DUMP)
    await store.delete(keyAgo(NIGHTLY_AFTER_MS - 1000))
    await runJob({ inService: async () => false })
    expect(dump).toHaveBeenCalledTimes(1)
  })

  it('takes one when the store has none at all', async () => {
    await runJob({ inService: async () => false })
    expect(dump).toHaveBeenCalledTimes(1)
    expect(await keys()).toEqual([backupKey(NOW)])
  })

  it('takes one when the service hours cannot be read', async () => {
    await store.put(keyAgo(HOUR), DUMP)
    const error = await runJob({
      inService: async () => {
        throw new Error('the database is down')
      },
    })
    expect(error).toBeNull()
    expect(dump).toHaveBeenCalledTimes(1)
  })
})

describe('which venues count as in service', () => {
  const sofia = 'Europe/Sofia'
  const settings: OrderingSettings = {
    ...DEFAULT_ORDERING_SETTINGS,
    serviceHours: {
      ...DEFAULT_ORDERING_SETTINGS.serviceHours,
      // Friday 22:00 to Saturday 05:00, Sofia.
      fri: { opens: '22:00', lastOrders: '04:00', closes: '05:00' },
    },
  }
  const venue = { settings, timeZone: sofia, dayEndsAt: '07:00' }

  it('counts the open hours and the hour after closing, and nothing else', () => {
    // Friday 2026-10-23: opens 19:00Z, closes Saturday 02:00Z.
    expect(venueIsActive(venue, new Date('2026-10-23T18:59:00Z'))).toBe(false)
    expect(venueIsActive(venue, new Date('2026-10-23T19:00:00Z'))).toBe(true)
    expect(venueIsActive(venue, new Date('2026-10-24T01:59:00Z'))).toBe(true)
    expect(venueIsActive(venue, new Date('2026-10-24T02:00:00Z'))).toBe(true)
    expect(
      venueIsActive(venue, new Date(Date.parse('2026-10-24T02:00:00Z') + AFTER_CLOSE_MS - 1)),
    ).toBe(true)
    expect(
      venueIsActive(venue, new Date(Date.parse('2026-10-24T02:00:00Z') + AFTER_CLOSE_MS)),
    ).toBe(false)
  })

  it('does not count a weekday the venue is closed', () => {
    expect(venueIsActive(venue, new Date('2026-10-21T20:00:00Z'))).toBe(false)
  })
})

describe('the 30 days', () => {
  it('keeps a dump at 29 days and removes one at 31, oldest first, and says which', async () => {
    const day = (days: number) => keyAgo(days * DAY)
    for (const days of [29, 31, 45, 30.5, 400]) await store.put(day(days), DUMP)
    const removed: string[] = []
    const original = store.delete.bind(store)
    store.delete = async (key) => {
      removed.push(key)
      await original(key)
    }
    expect(BACKUP_RETENTION_DAYS).toBe(30)
    expect(await runJob()).toBeNull()
    expect(removed).toEqual([day(400), day(45), day(31), day(30.5)])
    expect(await keys()).toEqual([day(29), backupKey(NOW)].sort())
    const done = lines.map((line) => JSON.parse(line) as { removed?: string[]; msg: string })
    expect(done.find((line) => line.msg === 'database dump stored')?.removed).toEqual(removed)
  })

  it('keeps a dump at exactly 30 days', async () => {
    await store.put(keyAgo(30 * DAY), DUMP)
    await runJob()
    expect(await keys()).toContain(keyAgo(30 * DAY))
  })

  it('removes expired dumps on a tick that took none', async () => {
    await store.put(keyAgo(HOUR), DUMP)
    await store.put(keyAgo(31 * DAY), DUMP)
    await runJob({ inService: async () => false })
    expect(dump).not.toHaveBeenCalled()
    expect(await keys()).toEqual([keyAgo(HOUR)])
  })

  it('leaves alone anything under the prefix that is not a dump', async () => {
    await mkdir(path.join(root, 'db'), { recursive: true })
    await writeFile(path.join(root, 'db', 'restro-20200101T000000Z.dump.keep'), 'by hand')
    await runJob()
    const kept = await new LocalBackupStore({ rootDir: root }).list()
    expect(kept.map((object) => object.key)).toEqual([backupKey(NOW)])
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(path.join(root, 'db'))).toContain('restro-20200101T000000Z.dump.keep')
  })

  it('goes on past a dump it cannot remove, then fails the run, with the new dump stored', async () => {
    await store.put(keyAgo(40 * DAY), DUMP)
    await store.put(keyAgo(35 * DAY), DUMP)
    const original = store.delete.bind(store)
    store.delete = async (key) => {
      if (key === keyAgo(40 * DAY)) throw new Error('R2 said no')
      await original(key)
    }
    const notify = vi.fn(async () => undefined)
    const error = await runJob({ notify })
    expect(error?.message).toContain('R2 said no')
    expect(await keys()).toEqual([keyAgo(40 * DAY), backupKey(NOW)].sort())
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

describe('a failed dump', () => {
  const failing = () =>
    dump.mockImplementation(async () => {
      throw new Error(`pg_dump exited with code 1: could not connect with ${URL}`)
    })

  it('fails the job, raises one alert to the team and removes nothing', async () => {
    failing()
    await store.put(keyAgo(31 * DAY), DUMP)
    await store.put(keyAgo(HOUR), DUMP)
    const notify = vi.fn(async (_text: string) => undefined)
    const error = await runJob({ notify })
    expect(error).toBeInstanceOf(Error)
    expect(notify).toHaveBeenCalledTimes(1)
    const text = notify.mock.calls[0]?.[0] ?? ''
    expect(text).toContain('Database backup failed')
    expect(text).toContain(NOW.toISOString())
    // Retention did not run: a failing dump never lets the old ones go.
    expect(await keys()).toEqual([keyAgo(31 * DAY), keyAgo(HOUR)].sort())
  })

  it('puts no connection string and no password in the alert, the log or the error', async () => {
    failing()
    const notify = vi.fn(async (_text: string) => undefined)
    const error = await runJob({ notify })
    const everything = [notify.mock.calls[0]?.[0], error?.message, error?.stack, ...lines].join(
      '\n',
    )
    expect(everything).not.toContain(SECRET)
    expect(everything).not.toContain('restro_backup:')
    expect(everything).not.toContain(URL)
    expect(everything).toContain('[connection]')
  })

  it('still fails the job, and says so in the log, when nobody can be told', async () => {
    failing()
    const error = await runJob({ notify: null })
    expect(error).toBeInstanceOf(Error)
    expect(lines.join('\n')).toContain('the team could not be told')
  })

  it('still fails the job with the dump’s own error when the alert cannot be sent', async () => {
    failing()
    const error = await runJob({
      notify: async () => {
        throw new Error('Telegram is down')
      },
    })
    expect(error?.message).toContain('pg_dump exited with code 1')
    expect(lines.join('\n')).toContain('the team could not be told of the failed backup')
  })

  it('alerts when the store cannot take the dump', async () => {
    const broken: BackupStore = {
      put: async () => Promise.reject(new Error('bucket gone')),
      get: (key) => store.get(key),
      list: () => store.list(),
      delete: (key) => store.delete(key),
    }
    const notify = vi.fn(async (_text: string) => undefined)
    const error = await runJob({ store: broken, notify, dump })
    expect(error?.message).toContain('bucket gone')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('runBackup throws before it removes anything', async () => {
    failing()
    await store.put(keyAgo(31 * DAY), DUMP)
    await expect(
      runBackup(
        pool,
        { databaseUrl: URL, store, notify: null, dump, inService: async () => true },
        NOW,
        {
          info: () => undefined,
          warn: () => undefined,
        },
      ),
    ).rejects.toThrow()
    expect(await keys()).toEqual([keyAgo(31 * DAY)])
  })
})

describe('pg_dump', () => {
  it('fails with a message that names the missing binary, not a bare ENOENT', async () => {
    const run = pgDump('restro-no-such-pg-dump-binary')
    await expect(run(URL)).rejects.toBeInstanceOf(PgDumpMissingError)
    await expect(run(URL)).rejects.toThrow(/PG_DUMP_PATH/)
  })

  it('is given the connection through its environment, never its command line', () => {
    expect(connectionEnvironment(URL)).toEqual({
      PGHOST: 'db.example.com',
      PGPORT: '5432',
      PGUSER: 'restro_backup',
      PGPASSWORD: SECRET,
      PGDATABASE: 'restro',
      PGSSLMODE: 'require',
    })
    expect(connectionEnvironment('postgres://u%40x:p%2Fw@[::1]/db')).toEqual({
      PGHOST: '::1',
      PGUSER: 'u@x',
      PGPASSWORD: 'p/w',
      PGDATABASE: 'db',
    })
  })

  it('takes the connection string and the password out of any text', () => {
    expect(withoutSecrets(`failed: ${URL} (${SECRET})`, URL)).toBe(
      'failed: [connection] ([secret])',
    )
    expect(withoutSecrets('nothing to hide', URL)).toBe('nothing to hide')
  })
})
