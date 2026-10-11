// Migration 0015 (brief CF-14: the public menu address, D68) on a scratch database of its own:
// migrated to 0014 by the real migrator, seeded with venues the way the old address rules allowed
// them (every slug globally unique), then 0015 is applied. Every venue must come out with a code
// of 12 characters of a-z0-9, all different, with every other column untouched (`updated_at`
// included), the unique rules on the slug gone, and the table back to forcing row-level security.
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

import { hasDatabase, ownerDatabaseUrl, testId } from './database'

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))
const TAG = '0015_venues_public_id'

type Row = Record<string, unknown>
interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** A migrations folder holding the migrations before 0015 only (the database before CF-14). */
function foldersBefore0015(): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-0014-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'))
  const entries = (journal as Journal).entries.filter((entry) => entry.tag < TAG)
  expect(entries.map((entry) => entry.idx)).toEqual([...Array(15).keys()])
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  return folder
}

describe.skipIf(!hasDatabase)('migration 0015 (public code of a venue)', () => {
  const database = `restro_pubid_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const tenantA = testId('tn')
  const tenantB = testId('tn')
  // A few named venues, then a few hundred more so every character of the alphabet turns up.
  const named = [
    { id: testId('vn'), tenant: tenantA, name: 'Alpha', slug: 'alpha' },
    { id: testId('vn'), tenant: tenantA, name: 'Beta', slug: 'beta' },
    { id: testId('vn'), tenant: tenantB, name: 'Gamma', slug: 'gamma' },
  ]
  const MANY = 300
  let admin: pg.Client
  let client: pg.Client
  let before0015: string
  const migrateTo = (folder: string) =>
    migrate(drizzle({ client }), {
      migrationsFolder: folder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })
  const venueRows = async (): Promise<Row[]> => {
    const { rows } = await client.query<{ row: Row }>(
      'select to_jsonb(v) as row from restro.venues v',
    )
    return rows.map((r) => r.row).sort((a, b) => compareText(String(a.id), String(b.id)))
  }
  // The test applies every migration after 0014; the columns added to `venues` by later ones
  // (0017: `archived_at`, null for every venue) are not part of what 0015 did.
  const withoutCode = ({ public_id: _code, archived_at: _archived, ...rest }: Row): Row => rest
  let start: Row[]

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ownerDatabaseUrl() })
    await admin.connect()
    await admin.query(`create database ${database}`)
    const url = new URL(ownerDatabaseUrl())
    url.pathname = `/${database}`
    client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    before0015 = foldersBefore0015()
    await migrateTo(before0015)

    await client.query('insert into restro.tenants (id, name) values ($1, $2), ($3, $4)', [
      tenantA,
      'Club A',
      tenantB,
      'Club B',
    ])
    for (const venue of named) {
      await client.query(
        'insert into restro.venues (id, tenant_id, name, slug) values ($1, $2, $3, $4)',
        [venue.id, venue.tenant, venue.name, venue.slug],
      )
    }
    // Many more, all in tenant B, each with its own slug (the old rule).
    await client.query(
      `insert into restro.venues (id, tenant_id, name, slug)
       select 'vn_many' || lpad(n::text, 15, '0'), $1, 'Venue ' || n, 'venue-' || n
       from generate_series(1, $2::int) as n`,
      [tenantB, MANY],
    )
    start = await venueRows()
  })

  afterAll(async () => {
    await client?.end()
    if (before0015) rmSync(before0015, { recursive: true, force: true })
    if (admin) {
      await admin.query(`drop database if exists ${database} with (force)`)
      await admin.end()
    }
  })

  it('before 0015 a venue has no code and a slug is unique', async () => {
    expect(start).toHaveLength(named.length + MANY)
    expect(start.every((row) => !('public_id' in row))).toBe(true)
  })

  it('gives every venue its own code of 12 characters a-z0-9 and changes nothing else', async () => {
    await migrate(drizzle({ client }), {
      migrationsFolder: MIGRATIONS,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })
    const after = await venueRows()
    expect(after).toHaveLength(start.length)

    const codes = after.map((row) => String(row.public_id))
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{12}$/)
    expect(new Set(codes).size).toBe(codes.length)
    // 3,600 draws: every one of the 36 characters shows up, and nothing else does.
    expect([...new Set(codes.join(''))].sort(compareText).join('')).toBe(
      '0123456789abcdefghijklmnopqrstuvwxyz',
    )

    // Every other column, `updated_at` included, is what it was.
    expect(after.map(withoutCode)).toEqual(start)
  })

  it('makes the code required, unique and well-formed', async () => {
    const { rows } = await client.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
        where table_schema = 'restro' and table_name = 'venues' and column_name = 'public_id'`,
    )
    expect(rows[0]?.is_nullable).toBe('NO')

    const insert = (publicId: string | null, slug = 'free') =>
      client.query(
        'insert into restro.venues (id, tenant_id, name, slug, public_id) values ($1, $2, $3, $4, $5)',
        [testId('vn'), tenantA, 'Extra', slug, publicId],
      )
    await expect(insert(null)).rejects.toThrow(/null value in column "public_id"/)
    await expect(insert('NOT-A-CODE-12')).rejects.toThrow(/venues_public_id_format/)
    const [first] = await venueRows()
    await expect(insert(String(first?.public_id))).rejects.toThrow(/venues_public_id_unique/)
  })

  it('frees the slug: the same slug in one tenant and in another is fine', async () => {
    const { rows } = await client.query<{ name: string }>(
      `select conname as name from pg_constraint
        where conrelid = 'restro.venues'::regclass and conname like '%slug%'
       union all
       select indexname as name from pg_indexes
        where schemaname = 'restro' and tablename = 'venues' and indexname like '%slug%'`,
    )
    expect(rows).toEqual([])

    const insert = (tenant: string, slug: string, publicId: string) =>
      client.query(
        'insert into restro.venues (id, tenant_id, name, slug, public_id) values ($1, $2, $3, $4, $5)',
        [testId('vn'), tenant, 'Twin', slug, publicId],
      )
    await insert(tenantA, 'alpha', 'aaaaaaaaaaa1')
    await insert(tenantA, 'alpha', 'aaaaaaaaaaa2')
    await insert(tenantB, 'alpha', 'aaaaaaaaaaa3')
    const { rows: twins } = await client.query<{ n: number }>(
      `select count(*)::int as n from restro.venues where slug = 'alpha'`,
    )
    expect(twins[0]?.n).toBe(4)
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
