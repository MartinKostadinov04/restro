// The database backup (T85's gap; D103, ticket #320).
//
//   db-backup   every hour on the hour: dumps the database with `pg_dump` (custom format) into the
//               backup store (`@restro/assets`, a private bucket of its own on R2) when a dump is
//               due, then removes the dumps older than 30 days, oldest first.
//
// A dump is due when any venue is inside its service hours (or closed within the last hour, so the
// end of a night is covered), and otherwise about once a day: when the newest dump is nearly 24
// hours old, or there is none. That is D103's "hourly during service hours, nightly otherwise".
// Retention runs only after the dump step went well or found nothing due (a dump less than a day
// old exists then), so a run of failing dumps never lets retention empty the store.
//
// A failure can never be silent: the job fails (pg-boss records it and moves it to `db-backup.dead`),
// it is logged, and the Restro team's Telegram chat is told. The team chat is the one the alerts of
// audience `restro` reach (./alerts.ts, ../alerts/deliver.ts); a backup belongs to no venue, and an
// alert row always has one, so the message goes to the chat directly. Without a bot token and a team
// chat the failure is only in the log and the dead-letter queue (the worker says so at start).
//
// What is dumped: the schemas `restro` (the data), `pgboss` (the queue) and `drizzle` (the migration
// journal, without which a restored database would apply every migration again), by an explicit
// list, so the host's own schemas never end up in a dump that has to restore elsewhere. The dump is held in
// memory (at pilot size a few megabytes); `MAX_DUMP_BYTES` fails the run loudly long before that
// matters, which is the day to stream the dump into the store instead.
//
// The connection is the role `restro_backup` (DATABASE_URL_BACKUP): one that can read every row,
// which neither the app role nor the purge role can by design (row-level security). Never logged,
// never on a command line: `pg_dump` gets it through its environment variables.
//
// `pg_dump` must be the same major version as the server, or newer; it refuses an older client by
// itself. If the binary is missing, the run fails with a message that says so.
import { spawn } from 'node:child_process'

import { type BackupStore, backupKey, parseBackupKey } from '@restro/assets'
import { serviceHoursWindow } from '@restro/core/service'
import type { DbPool } from '@restro/db'

import { summarizeError } from '../errors'
import type { Logger } from '../logger'
import { type NightVenue, venuesWithHours } from './service-hours'
import { defineJob, type JobDefinition } from './types'

export const DB_BACKUP_JOB = 'db-backup'

/** How long dumps are kept (D103). */
export const BACKUP_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60_000
/** Outside service a dump is due when the newest is this old: a day, less the hourly tick's slack. */
export const NIGHTLY_AFTER_MS = DAY_MS - 10 * 60_000
/** A venue still counts as in service this long after it closed, so the last hour is dumped. */
export const AFTER_CLOSE_MS = 60 * 60_000
/** The schemas that make a backup. A new schema is added here on purpose (a test checks). */
export const BACKUP_SCHEMAS = ['restro', 'pgboss', 'drizzle'] as const
/** A dump larger than this fails the run: it is time to stream it instead of holding it. */
export const MAX_DUMP_BYTES = 512 * 1024 * 1024
/** A dump that takes longer than this is stopped (the queue also expires the run at 55 minutes). */
export const DUMP_TIMEOUT_MS = 45 * 60_000
/** The first bytes of a PostgreSQL custom-format archive. */
const ARCHIVE_MAGIC = 'PGDMP'

/** Takes a dump of the database at `databaseUrl` and answers its bytes. The replaceable part. */
export type DumpDatabase = (databaseUrl: string, signal?: AbortSignal) => Promise<Uint8Array>

/** `pg_dump` is not on this machine (or `PG_DUMP_PATH` does not lead to it). */
export class PgDumpMissingError extends Error {
  override name = 'PgDumpMissingError'
  constructor() {
    super(
      'pg_dump was not found. The worker needs the PostgreSQL client tools, the same major version as the database (set PG_DUMP_PATH if it is not on the PATH).',
    )
  }
}

/** `pg_dump` ran and failed, or produced something that is not a dump. */
export class DumpFailedError extends Error {
  override name = 'DumpFailedError'
}

/** What a child process may see of this one's environment: where to find programs, not secrets. */
const CHILD_ENV_ALLOWED = [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LANG',
  'LC_ALL',
  'SSL_CERT_FILE',
  'PGSSLROOTCERT',
] as const

/** The libpq variables for a connection string, so no password is ever on a command line. */
export function connectionEnvironment(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl)
  const environment: Record<string, string> = {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  }
  if (url.port !== '') environment.PGPORT = url.port
  const sslmode = url.searchParams.get('sslmode')
  if (sslmode !== null) environment.PGSSLMODE = sslmode
  return environment
}

/** `text` with the connection string and its password taken out, wherever they appear. */
export function withoutSecrets(text: string, databaseUrl: string): string {
  let clean = text.split(databaseUrl).join('[connection]')
  try {
    const password = decodeURIComponent(new URL(databaseUrl).password)
    if (password !== '') clean = clean.split(password).join('[secret]')
  } catch {
    // Not a URL: the first replacement was all there is to do.
  }
  return clean
}

/** The real dump: runs `pg_dump` (at `pgDumpPath`, default the PATH's) and collects its output. */
export function pgDump(pgDumpPath = 'pg_dump'): DumpDatabase {
  return (databaseUrl, signal) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const stopAfter = AbortSignal.timeout(DUMP_TIMEOUT_MS)
      const stop = signal === undefined ? stopAfter : AbortSignal.any([signal, stopAfter])
      const environment: Record<string, string> = {}
      for (const name of CHILD_ENV_ALLOWED) {
        const value = process.env[name]
        if (value !== undefined) environment[name] = value
      }
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(
          pgDumpPath,
          [
            '--format=custom',
            '--no-password',
            '--lock-wait-timeout=60s',
            ...BACKUP_SCHEMAS.map((schema) => `--schema=${schema}`),
          ],
          {
            env: { ...environment, ...connectionEnvironment(databaseUrl) },
            stdio: ['ignore', 'pipe', 'pipe'],
            signal: stop,
            windowsHide: true,
          },
        )
      } catch (error) {
        reject(new DumpFailedError(withoutSecrets(summarizeError(error), databaseUrl)))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      let tooBig = false
      let errors = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > MAX_DUMP_BYTES) {
          tooBig = true
          child.kill()
          return
        }
        chunks.push(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        // The last of what pg_dump says is the reason; keep a bounded tail.
        errors = (errors + chunk.toString('utf8')).slice(-2000)
      })
      child.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') reject(new PgDumpMissingError())
        else if (error.name === 'AbortError') {
          reject(
            new DumpFailedError(
              'the dump was stopped: it took too long, or the worker is shutting down',
            ),
          )
        } else reject(new DumpFailedError(withoutSecrets(summarizeError(error), databaseUrl)))
      })
      child.on('close', (code) => {
        if (tooBig) {
          reject(
            new DumpFailedError(
              `the dump is larger than ${MAX_DUMP_BYTES} bytes: it has to be streamed into the store instead of held in memory`,
            ),
          )
          return
        }
        if (code !== 0) {
          const reason = withoutSecrets(
            errors.trim().split('\n').slice(-3).join(' | '),
            databaseUrl,
          )
          reject(new DumpFailedError(`pg_dump exited with code ${code}: ${reason}`))
          return
        }
        const dump = Buffer.concat(chunks)
        if (dump.subarray(0, ARCHIVE_MAGIC.length).toString('latin1') !== ARCHIVE_MAGIC) {
          reject(
            new DumpFailedError('pg_dump finished but its output is not a custom-format archive'),
          )
          return
        }
        resolve(dump)
      })
    })
}

/** True when `venue` is inside its service hours at `now`, or closed within the last hour. */
export function venueIsActive(
  venue: Pick<NightVenue, 'settings' | 'timeZone' | 'dayEndsAt'>,
  now: Date,
): boolean {
  const window = serviceHoursWindow(venue.settings, venue.timeZone, venue.dayEndsAt, now)
  if (window.opensAt === null || window.closesAt === null) return false
  return (
    window.opensAt.getTime() <= now.getTime() &&
    now.getTime() < window.closesAt.getTime() + AFTER_CLOSE_MS
  )
}

/** Whether any venue is active at `now` (see {@link venueIsActive}). */
export async function anyVenueInService(pool: DbPool, now: Date): Promise<boolean> {
  return (await venuesWithHours(pool)).some((venue) => venueIsActive(venue, now))
}

export interface DbBackupDeps {
  /** Connection string of the backup role (DATABASE_URL_BACKUP). */
  readonly databaseUrl: string
  readonly store: BackupStore
  /** Tells the Restro team; absent without a Telegram bot and team chat. Must not throw. */
  readonly notify: ((text: string) => Promise<void>) | null
  /** The dump command; `pgDump()` unless a test or a deployment replaces it. */
  readonly dump?: DumpDatabase
  /** Replaced in tests. */
  readonly inService?: (pool: DbPool, now: Date) => Promise<boolean>
}

/** The dumps in the store, newest first. */
async function dumpsNewestFirst(store: BackupStore): Promise<{ key: string; takenAt: Date }[]> {
  const found: { key: string; takenAt: Date }[] = []
  for (const { key } of await store.list()) {
    const takenAt = parseBackupKey(key)
    if (takenAt !== null) found.push({ key, takenAt })
  }
  return found.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
}

/** What one run did, for the log. */
export interface BackupRun {
  readonly dumped: string | null
  readonly bytes: number
  readonly removed: readonly string[]
}

/**
 * One run: dumps when due, then applies the retention. A failed dump throws before the retention
 * runs. A dump that went well but whose retention failed throws after it, with the dump stored.
 */
export async function runBackup(
  pool: DbPool,
  deps: DbBackupDeps,
  now: Date,
  log: Pick<Logger, 'info' | 'warn'>,
  signal?: AbortSignal,
): Promise<BackupRun> {
  const stored = await dumpsNewestFirst(deps.store)
  let inService = true
  try {
    inService = await (deps.inService ?? anyVenueInService)(pool, now)
  } catch (error) {
    // Not knowing the hours is no reason to skip a backup.
    log.warn({ err: error }, 'the service hours could not be read; a dump is taken')
  }
  const newest = stored[0]
  const due =
    inService ||
    newest === undefined ||
    now.getTime() - newest.takenAt.getTime() >= NIGHTLY_AFTER_MS

  let dumped: string | null = null
  let bytes = 0
  if (due) {
    const dump = await (deps.dump ?? pgDump())(deps.databaseUrl, signal)
    dumped = backupKey(now)
    bytes = dump.byteLength
    await deps.store.put(dumped, dump)
  }

  // Oldest first, and only dumps of the backup shape: anything else in the store is not ours.
  const cutoff = now.getTime() - BACKUP_RETENTION_DAYS * DAY_MS
  const expired = (await dumpsNewestFirst(deps.store))
    .reverse()
    .filter((dump) => dump.takenAt.getTime() < cutoff)
  const removed: string[] = []
  let retentionError: unknown
  for (const { key } of expired) {
    try {
      await deps.store.delete(key)
      removed.push(key)
    } catch (error) {
      retentionError ??= error
      log.warn({ key, err: error }, 'an old database dump could not be removed')
    }
  }
  const run = { dumped, bytes, removed }
  log.info(
    {
      dumped,
      bytes,
      inService,
      removed,
      kept: stored.length + (dumped === null ? 0 : 1) - removed.length,
    },
    due ? 'database dump stored' : 'no database dump due',
  )
  if (retentionError !== undefined) throw retentionError
  return run
}

/** The text the team is sent for a failed run. No connection string, no credential. */
export function failureMessage(error: unknown, now: Date, databaseUrl: string): string {
  return withoutSecrets(
    `Database backup failed at ${now.toISOString()}. ${summarizeError(error)}. ` +
      'The job fails and is in the db-backup.dead queue; the next run is in an hour.',
    databaseUrl,
  )
}

/** The backup job. */
export function createDbBackupJob(deps: DbBackupDeps): JobDefinition {
  return defineJob({
    name: DB_BACKUP_JOB,
    schedule: { cron: '0 * * * *' },
    options: {
      queue: {
        // The next hour is the retry; a second attempt a minute later would only repeat an alert.
        retryLimit: 0,
        // Shorter than the hour, so two runs never overlap.
        expireInSeconds: 55 * 60,
        retentionSeconds: 60 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      },
    },
    async handler(batch, context) {
      const now = context.now()
      try {
        await runBackup(context.pool, deps, now, context.log, batch[0]?.signal)
      } catch (error) {
        const text = failureMessage(error, now, deps.databaseUrl)
        if (deps.notify === null) {
          context.log.error('the team could not be told: no Telegram bot and team chat are set')
        } else {
          try {
            await deps.notify(text)
          } catch (notifyError) {
            context.log.error(
              { err: notifyError },
              'the team could not be told of the failed backup',
            )
          }
        }
        // The registry logs the error and keeps its one-line summary in the job record.
        throw new Error(withoutSecrets(summarizeError(error), deps.databaseUrl))
      }
    },
  })
}
