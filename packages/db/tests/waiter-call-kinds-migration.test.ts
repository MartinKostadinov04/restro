// The migration that makes a waiter call keep its requests (#180: `kinds`, `last_called_at`), on a
// scratch database of its own: migrated to the one before, seeded with a call made when a call had
// no kind, then migrated through it. The old call must read as the plain `waiter` call and its
// newest request is its one request's time; the list's check must refuse a kind outside it and an empty list. Skipped without a database.
import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase, ownerDatabaseUrl } from './database'

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))
const TAG = '0036_waiter_call_kinds'

interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

/** A migrations folder holding the migrations before this one, or, with `through`, this one too. */
function migrationsFolder(through: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-wck-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as Journal
  const entries = journal.entries.filter((entry) => (through ? entry.tag <= TAG : entry.tag < TAG))
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  return folder
}

describe.skipIf(!hasDatabase)('the waiter call kinds migration (#180)', () => {
  const database = `restro_wck_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const before = migrationsFolder(false)
  const through = migrationsFolder(true)
  const oldCall = 'wc_OLDCALL1'
  let admin: pg.Client
  let client: pg.Client

  const migrateTo = (folder: string) =>
    migrate(drizzle({ client }), {
      migrationsFolder: folder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })

  /** A call row as the owner writes it (the foreign keys are off: only the list is under test). */
  const insertCall = (id: string, kinds: string) =>
    client.query(
      `insert into restro.waiter_calls
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, source, actor, job_id, kinds)
       values ($1, 'org_x', 'vn_x', 'tb_' || $1, 'st_x', '2026-10-28', 'worker', 'system', 'jb_x', $2::text[])`,
      [id, kinds],
    )

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ownerDatabaseUrl() })
    await admin.connect()
    await admin.query(`create database ${database}`)
    const url = new URL(ownerDatabaseUrl())
    url.pathname = `/${database}`
    client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    await migrateTo(before)
    await client.query('set session_replication_role = replica')
    await client.query(
      `insert into restro.waiter_calls
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, called_at, source, actor, job_id)
       values ($1, 'org_x', 'vn_x', 'tb_x', 'st_x', '2026-10-28', '2026-10-28T21:00:00Z', 'worker', 'system', 'jb_x')`,
      [oldCall],
    )
    await migrateTo(through)
  }, 120_000)

  afterAll(async () => {
    await client?.end()
    if (admin !== undefined) {
      await admin.query(`drop database if exists ${database} with (force)`)
      await admin.end()
    }
    rmSync(before, { recursive: true, force: true })
    rmSync(through, { recursive: true, force: true })
  })

  it('gives a call made before it the plain `waiter` kind and its one request’s time', async () => {
    const { rows } = await client.query<{ kinds: string[]; same: boolean }>(
      'select kinds, last_called_at = called_at as same from restro.waiter_calls where id = $1',
      [oldCall],
    )
    expect(rows).toEqual([{ kinds: ['waiter'], same: true }])
  })

  it('holds one or more kinds of the list and nothing else', async () => {
    await insertCall('wc_TWOKINDS', '{ice,water}')
    await expect(insertCall('wc_OTHERKIND', '{cutlery}')).rejects.toThrow(/waiter_calls_kinds/)
    await expect(insertCall('wc_NOKINDS', '{}')).rejects.toThrow(/waiter_calls_kinds/)
  })
})
