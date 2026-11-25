// The database backup on Postgres (ticket #320; D103): the real `pg_dump` takes a dump of a
// migrated and seeded database through the job, the dump lands in the store, and `pg_restore`
// puts it into an empty database with the same tables and the same row counts. Also: every schema
// the migrations create is in the backup's list, so a new schema cannot go unbacked.
//
// Needs the PostgreSQL client tools (`pg_dump` and `pg_restore`, the same major version as the
// server or newer): on the PATH, or at PG_DUMP_PATH and PG_RESTORE_PATH. Without them the test is
// skipped with a message; in CI (CI is set) their absence fails the run, because there it is
// required.
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { backupKey, LocalBackupStore } from '@restro/assets'
import { newId } from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type { Job } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BACKUP_SCHEMAS,
  createDbBackupJob,
  MIN_DUMP_BYTES,
  pgDump,
  SCHEMAS_NOT_BACKED_UP,
} from '../src/jobs/db-backup'
import type { WorkerContext } from '../src/jobs/types'
import { createLogger } from '../src/logger'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

const run = promisify(execFile)

/** The path of a client tool when it runs, else null. */
function clientTool(name: string, variable: string): string | null {
  const path = process.env[variable]?.trim() || name
  const probe = spawnSync(path, ['--version'], { encoding: 'utf8' })
  return probe.error === undefined && probe.status === 0 ? path : null
}

const pgDumpPath = clientTool('pg_dump', 'PG_DUMP_PATH')
const pgRestorePath = clientTool('pg_restore', 'PG_RESTORE_PATH')
const hasTools = pgDumpPath !== null && pgRestorePath !== null

if (hasDatabase && !hasTools) {
  if (process.env.CI) {
    throw new Error(
      'pg_dump and pg_restore are not available. The backup test is required in CI: install the PostgreSQL 17 client tools (or set PG_DUMP_PATH and PG_RESTORE_PATH).',
    )
  }
  process.stderr.write(
    '\n[@restro/worker] Skipping the backup test: pg_dump and pg_restore (version 17 or newer) are not on the PATH. Install them or set PG_DUMP_PATH and PG_RESTORE_PATH.\n',
  )
}

allowSlowSetup()

const NOW = new Date('2026-11-08T14:00:00Z')

/** `url` pointing at database `name` instead. */
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

describe.skipIf(!hasDatabase)('the database schemas', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase()
  })
  afterAll(() => db?.drop())

  it('are all in the backup’s list, or are left out on purpose', async () => {
    const found = await withOwnerClient(db.ownerUrl, async (client) =>
      (
        await client.query<{ name: string }>(
          `select nspname as name from pg_namespace
            where nspname not like 'pg\\_%' and nspname <> 'information_schema'`,
        )
      ).rows.map((row) => row.name),
    )
    const unbacked = found.filter(
      (name) =>
        !(BACKUP_SCHEMAS as readonly string[]).includes(name) &&
        !(SCHEMAS_NOT_BACKED_UP as readonly string[]).includes(name),
    )
    // A new schema is added to BACKUP_SCHEMAS or SCHEMAS_NOT_BACKED_UP (jobs/db-backup.ts) on purpose.
    expect(unbacked).toEqual([])
    expect(found).toEqual(expect.arrayContaining(['restro', 'drizzle']))
  })
})

describe.skipIf(!hasDatabase || !hasTools)('the real dump and restore', () => {
  let db: TestDatabase
  let restored: string | null = null
  let pool: DbPool
  let folder: string

  /** The row count of every table of the backed-up schemas, by `schema.table`. */
  const counts = (url: string) =>
    withOwnerClient(url, async (client) => {
      const tables = await client.query<{ schemaname: string; tablename: string }>(
        `select schemaname, tablename from pg_tables where schemaname = any($1) order by 1, 2`,
        [[...BACKUP_SCHEMAS]],
      )
      const found: Record<string, number> = {}
      for (const { schemaname, tablename } of tables.rows) {
        const name = `${client.escapeIdentifier(schemaname)}.${client.escapeIdentifier(tablename)}`
        const result = await client.query<{ n: string }>(`select count(*) as n from ${name}`)
        found[`${schemaname}.${tablename}`] = Number(result.rows[0]?.n)
      }
      return found
    })

  beforeAll(async () => {
    db = await createTestDatabase()
    folder = await mkdtemp(join(tmpdir(), 'restro-backup-test-'))
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-backup-tests', max: 2 })
    const tenantId = newId('tn')
    await provisionTenant(pool, { tenantId, name: 'Backup club' })
    await withOwnerClient(db.ownerUrl, (client) =>
      client.query(
        `insert into restro.auth_organization (id, name, slug) values ($1, 'Backup club', $2)`,
        [tenantId, `backup-${newId('tn').slice(3, 11)}`],
      ),
    )
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Backup Bar',
      slug: testSlug('backup'),
    })
    const area = await createArea(pool, tenantId, venue.id, 'Hall')
    if (!area.ok) throw new Error(area.reason)
    for (const number of ['1', '2', '3']) {
      const table = await createTable(pool, tenantId, { areaId: area.area.id, name: null, number })
      if (!table.ok) throw new Error(table.reason)
    }
  })

  afterAll(async () => {
    await pool?.end()
    // The restored copy first: it is dropped through the database it was made from.
    if (restored !== null) {
      const name = restored
      await withOwnerClient(db.ownerUrl, (client) =>
        client.query(`drop database if exists ${client.escapeIdentifier(name)} with (force)`),
      )
    }
    await db?.drop()
    if (folder) await rm(folder, { recursive: true, force: true })
  })

  it('stores a dump that restores into an empty database with the schema and the row counts intact', async () => {
    const store = new LocalBackupStore({ rootDir: join(folder, 'store') })
    const lines: string[] = []
    const log = await createLogger({
      level: 'debug',
      pretty: false,
      destination: { write: (line: string) => void lines.push(line) },
    })
    const job = createDbBackupJob({
      // The backup role where the environment has one (CI does): proves it reads every row.
      databaseUrl: db.backupUrl ?? db.ownerUrl,
      store,
      notify: null,
      dump: pgDump(pgDumpPath ?? undefined),
      inService: async () => true,
    })
    const context = { pool, log, now: () => NOW } as unknown as WorkerContext
    await job.handler([{ id: 'job-1' } as Job<object>], context)

    // It landed in the store, under the key of the minute it was taken, as a custom-format archive.
    const objects = await store.list()
    expect(objects.map((object) => object.key)).toEqual([backupKey(NOW)])
    const dump = await store.get(backupKey(NOW))
    expect(
      Buffer.from(dump ?? [])
        .subarray(0, 5)
        .toString('latin1'),
    ).toBe('PGDMP')
    expect(dump?.byteLength).toBeGreaterThanOrEqual(MIN_DUMP_BYTES)
    // And the log names no credential.
    expect(lines.join('\n')).not.toContain(new URL(db.backupUrl ?? db.ownerUrl).password)

    // Restore it into a database that has nothing.
    restored = `restro_worker_restore_${newId('tn').slice(3, 13).toLowerCase()}`
    await withOwnerClient(db.ownerUrl, (client) =>
      client.query(`create database ${client.escapeIdentifier(restored as string)}`),
    )
    const file = join(folder, 'restro.dump')
    await writeFile(file, dump ?? new Uint8Array())
    const restoredUrl = withDatabase(db.ownerUrl, restored)
    await run(
      pgRestorePath as string,
      ['--no-password', '--no-owner', '--exit-on-error', `--dbname=${restoredUrl}`, file],
      { env: { ...process.env } },
    )

    const before = await counts(db.ownerUrl)
    const after = await counts(restoredUrl)
    expect(Object.keys(before).length).toBeGreaterThan(20)
    expect(after).toEqual(before)
    // Something real was in it, and the migration journal came along.
    expect(before['restro.venues']).toBe(1)
    expect(before['restro.tables']).toBe(3)
    expect(before['drizzle.__drizzle_migrations']).toBeGreaterThan(0)
  })

  it('writes no empty dump when the role cannot bypass row-level security: it fails', async () => {
    // A role that may read every table but is held to row-level security, like restro_app.
    const role = `restro_nobypass_${newId('tn').slice(3, 11).toLowerCase()}`
    await withOwnerClient(db.ownerUrl, async (client) => {
      await client.query(`create role ${role} login password 'nobypass-test-pw' nobypassrls`)
      await client.query(`grant usage on schema restro, drizzle to ${role}`)
      await client.query(`grant select on all tables in schema restro, drizzle to ${role}`)
      await client.query(`grant select on all sequences in schema restro, drizzle to ${role}`)
    })
    try {
      const url = new URL(db.ownerUrl)
      url.username = role
      url.password = 'nobypass-test-pw'
      const error = await pgDump(pgDumpPath ?? undefined)(url.toString()).catch(
        (caught: Error) => caught,
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/row-level security|row_security/i)
    } finally {
      await withOwnerClient(db.ownerUrl, async (client) => {
        await client.query(`drop owned by ${role}`)
        await client.query(`drop role if exists ${role}`)
      })
    }
  })

  it('fails loudly, with the error and no credential, when the server cannot be reached', async () => {
    const unreachable = new URL(db.ownerUrl)
    unreachable.port = '1'
    unreachable.password = 'not-the-real-password'
    const error = await pgDump(pgDumpPath ?? undefined)(unreachable.toString()).catch(
      (caught: Error) => caught,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/pg_dump exited with code/)
    expect((error as Error).message).not.toContain('not-the-real-password')
  })
})
