// Migration 0016 (brief CF-16: the catalogue and the price per till venue) on a scratch database
// of its own: migrated to 0015 by the real migrator, seeded with link rows, an integration whose
// setting is `current_price`, another with none, and the stored venue-list records, then 0016 is
// applied. Every link must come out with the price its integration had and the catalogue of the
// newest stored record, every other column untouched, and row-level security forced again.
// (This check lived in apps/worker/tests/venue-catalogue-migration.test.ts until T79, when that
// test moved to the current schema.)
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
const TAG = '0016_venue_catalogue'
const HASH = 'c'.repeat(64)

type Row = Record<string, unknown>
interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** A migrations folder holding the migrations before 0016, or, with `through`, up to and including it. */
function migrationsFolder(through: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-0016-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'))
  const entries = (journal as Journal).entries.filter((entry) =>
    through ? entry.tag <= TAG : entry.tag < TAG,
  )
  expect(entries.map((entry) => entry.idx)).toEqual([...Array(through ? 17 : 16).keys()])
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  return folder
}

describe.skipIf(!hasDatabase)('migration 0016 (the catalogue and the price per till venue)', () => {
  const database = `restro_catalogue_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const tenant = testId('tn')
  const current = testId('in')
  const unset = testId('in')
  let admin: pg.Client
  let client: pg.Client
  let before: string
  let through: string
  const links = async (): Promise<Row[]> => {
    const { rows } = await client.query<{ row: Row }>(
      'select to_jsonb(v) as row from restro.barsy_venues v',
    )
    return rows
      .map((r) => r.row)
      .sort((a, b) => compareText(`${a.integration_id}|${a.bid}`, `${b.integration_id}|${b.bid}`))
  }
  const withoutAdded = ({ catalogue_id: _c, price_source: _p, ...rest }: Row): Row => rest
  let start: Row[]

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ownerDatabaseUrl() })
    await admin.connect()
    await admin.query(`create database ${database}`)
    const url = new URL(ownerDatabaseUrl())
    url.pathname = `/${database}`
    client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    before = migrationsFolder(false)
    await migrate(drizzle({ client }), {
      migrationsFolder: before,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })
    await client.query('insert into restro.tenants (id, name) values ($1, $2)', [tenant, 'Club'])
    await client.query(
      `insert into restro.integrations (id, tenant_id, kind, host, config)
       values ($1, $2, 'barsy', 'a.example.test', '{"price_source": "current_price"}'::jsonb),
              ($3, $2, 'barsy', 'b.example.test', '{}'::jsonb)`,
      [current, tenant, unset],
    )
    await client.query(
      `insert into restro.barsy_venues (tenant_id, integration_id, bid, name)
       values ($1, $2, 10, 'With records'), ($1, $2, 20, 'Without records'), ($1, $3, 30, 'Other')`,
      [tenant, current, unset],
    )
    // Two stored venue-list records for bid 10 (the newest wins) and an unreadable one for 20.
    const record = (
      id: string,
      integration: string,
      bid: string,
      payload: string,
      fetchedAt: string,
    ) =>
      client.query(
        `insert into restro.source_records
           (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw, payload, fetched_at)
         values ($1, $2, $3, 'barsy_venue', $4, 'master', $5, $6, $7::jsonb, $8)`,
        [id, tenant, integration, bid, HASH, payload, payload, fetchedAt],
      )
    await record(testId('sr'), current, '10', '{"barsy_id":10,"menu_id":1}', '2026-10-01T00:00:00Z')
    await record(testId('sr'), current, '10', '{"barsy_id":10,"menu_id":2}', '2026-10-02T00:00:00Z')
    await record(
      testId('sr'),
      current,
      '20',
      '{"barsy_id":20,"menu_id":"x"}',
      '2026-10-02T00:00:00Z',
    )
    start = await links()
  })

  afterAll(async () => {
    await client?.end()
    if (before) rmSync(before, { recursive: true, force: true })
    if (through) rmSync(through, { recursive: true, force: true })
    if (admin) {
      await admin.query(`drop database if exists ${database} with (force)`)
      await admin.end()
    }
  })

  it('before 0016 a link has no catalogue and no price of its own', () => {
    expect(start).toHaveLength(3)
    expect(start.every((row) => !('catalogue_id' in row) && !('price_source' in row))).toBe(true)
  })

  it('gives every link its integration’s price and the newest stored catalogue, and changes nothing else', async () => {
    through = migrationsFolder(true)
    await migrate(drizzle({ client }), {
      migrationsFolder: through,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })
    const after = await links()
    expect(after.map(withoutAdded)).toEqual(start)
    expect(
      after.map((row) => [row.integration_id, row.bid, row.catalogue_id, row.price_source]),
    ).toEqual(
      [
        [current, 10, 2, 'current_price'],
        [current, 20, null, 'current_price'],
        [unset, 30, null, 'actual_price'],
      ].sort((a, b) => compareText(`${a[0]}|${a[1]}`, `${b[0]}|${b[1]}`)),
    )
  })

  it('leaves row-level security forced on the three tables the backfill read', async () => {
    const { rows } = await client.query<{ relname: string; forced: boolean }>(
      `select relname, relforcerowsecurity as forced from pg_class
       where oid in ('restro.barsy_venues'::regclass, 'restro.integrations'::regclass,
                     'restro.source_records'::regclass)`,
    )
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.forced)).toBe(true)
    const { rows: trigger } = await client.query<{ enabled: string }>(
      `select tgenabled as enabled from pg_trigger
        where tgrelid = 'restro.barsy_venues'::regclass and tgname = 'barsy_venues_touch_updated_at'`,
    )
    expect(trigger[0]?.enabled).toBe('O')
  })
})
