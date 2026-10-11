// Migration 0017 (brief CF-18: deleting a venue archives it, D76) on a scratch database of its own:
// migrated to 0016 by the real migrator, seeded with venues, then 0017 is applied. Every venue must
// come out live (`archived_at` null) with every other column untouched (`updated_at` included),
// the column must be nullable, and the app role must still be unable to delete a venue.
//
// Rows are sorted in JavaScript on both sides, never by SQL `order by` (CLAUDE.md).
import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase, ownerDatabaseUrl, testId, testPublicId } from './database'

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))
const TAG = '0017_venue_archived'

type Row = Record<string, unknown>
interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** A migrations folder holding the migrations before 0017 only (the database before CF-18). */
function foldersBefore0017(): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-0016-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'))
  const entries = (journal as Journal).entries.filter((entry) => entry.tag < TAG)
  expect(entries.map((entry) => entry.idx)).toEqual([...Array(17).keys()])
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  return folder
}

describe.skipIf(!hasDatabase)('migration 0017 (a venue can be archived)', () => {
  const database = `restro_archived_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const tenant = testId('tn')
  const venueIds = [testId('vn'), testId('vn'), testId('vn')]
  let admin: pg.Client
  let client: pg.Client
  let before0017: string
  const venueRows = async (): Promise<Row[]> => {
    const { rows } = await client.query<{ row: Row }>(
      'select to_jsonb(v) as row from restro.venues v',
    )
    return rows.map((r) => r.row).sort((a, b) => compareText(String(a.id), String(b.id)))
  }
  const withoutArchived = ({ archived_at: _archived, ...rest }: Row): Row => rest
  let start: Row[]

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ownerDatabaseUrl() })
    await admin.connect()
    await admin.query(`create database ${database}`)
    const url = new URL(ownerDatabaseUrl())
    url.pathname = `/${database}`
    client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    before0017 = foldersBefore0017()
    await migrate(drizzle({ client }), {
      migrationsFolder: before0017,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })
    await client.query('insert into restro.tenants (id, name) values ($1, $2)', [tenant, 'Club'])
    for (const [index, id] of venueIds.entries()) {
      await client.query(
        'insert into restro.venues (id, tenant_id, name, slug, public_id) values ($1, $2, $3, $4, $5)',
        [id, tenant, `Venue ${index}`, `venue-${index}`, testPublicId()],
      )
    }
    start = await venueRows()
  })

  afterAll(async () => {
    await client?.end()
    if (before0017) rmSync(before0017, { recursive: true, force: true })
    if (admin) {
      await admin.query(`drop database if exists ${database} with (force)`)
      await admin.end()
    }
  })

  it('before 0017 a venue has no archive column', () => {
    expect(start).toHaveLength(venueIds.length)
    expect(start.every((row) => !('archived_at' in row))).toBe(true)
  })

  it('leaves every venue live and changes nothing else', async () => {
    await migrate(drizzle({ client }), {
      migrationsFolder: MIGRATIONS,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })
    const after = await venueRows()
    expect(after).toHaveLength(start.length)
    expect(after.every((row) => row.archived_at === null)).toBe(true)
    // Every other column, `updated_at` included, is what it was.
    expect(after.map(withoutArchived)).toEqual(start)
  })

  it('makes the column nullable, with no default', async () => {
    const { rows } = await client.query<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default from information_schema.columns
        where table_schema = 'restro' and table_name = 'venues' and column_name = 'archived_at'`,
    )
    expect(rows[0]).toEqual({ is_nullable: 'YES', column_default: null })
  })

  it('leaves row-level security forced and updated_at touched, as before', async () => {
    const { rows: forced } = await client.query<{ force: boolean; enabled: boolean }>(
      `select relforcerowsecurity as force, relrowsecurity as enabled
         from pg_class where oid = 'restro.venues'::regclass`,
    )
    expect(forced[0]).toEqual({ force: true, enabled: true })

    const { rows: trigger } = await client.query<{ enabled: string }>(
      `select tgenabled as enabled from pg_trigger
        where tgrelid = 'restro.venues'::regclass and tgname = 'venues_touch_updated_at'`,
    )
    expect(trigger[0]?.enabled).toBe('O')
  })
})
