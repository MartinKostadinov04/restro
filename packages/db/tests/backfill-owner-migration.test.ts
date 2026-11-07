// The two backfills of 0029 (the hash of every table code) and 0037 (old nights count as reported),
// replayed from 0000 on a scratch database of their own under two owners: a superuser (local and
// CI) and a role that cannot bypass row-level security, as the owner of a hosted database is
// (RR-44, RR-45; `packages/db/CLAUDE.md`, Backfills). Under forced row-level security the second
// owner sees no row, so without the NO FORCE wrap the `UPDATE`s change nothing: 0029 then aborts
// on its own check, and 0037 leaves old nights unreported (their end-of-night messages go out
// again). The rows are seeded after 0028, as the superuser; the migrations around them run as the
// owner under test. Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'
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
const FIRST_BACKFILL = '0029_table_code_hash'

interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

/** A migrations folder holding only the migrations before 0029 (the seed is written there). */
function folderBeforeFirstBackfill(): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-bfo-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as Journal
  const entries = journal.entries.filter((entry) => entry.tag < FIRST_BACKFILL)
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  return folder
}

const TOKENS: [id: string, sortKey: string, token: string][] = [
  ['tb_BFO1', 'a1', 'token-of-table-1'],
  ['tb_BFO2', 'a2', 'token-of-table-2'],
  ['tb_BFO3', 'a3', 'token-of-table-3'],
]
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

describe.skipIf(!hasDatabase).each([
  { owner: 'a superuser', bypasses: true },
  { owner: 'an owner that cannot bypass row-level security', bypasses: false },
])('the backfills of 0029 and 0037, replayed by $owner', ({ bypasses }) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const database = `restro_bfo_${suffix}`
  const role = `restro_bfo_${suffix}`
  const password = randomUUID()
  const before = folderBeforeFirstBackfill()
  let admin: pg.Client
  let seed: pg.Client
  let owner: pg.Client

  const migrateAs = (client: pg.Client, folder: string) =>
    migrate(drizzle({ client }), {
      migrationsFolder: folder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })

  beforeAll(async () => {
    const adminUrl = new URL(ownerDatabaseUrl())
    admin = new pg.Client({ connectionString: adminUrl.toString() })
    await admin.connect()
    if (bypasses) {
      await admin.query(`create database ${database}`)
    } else {
      // A scratch role for this test only: nothing in the app uses an owner like it.
      await admin.query(
        `create role ${role} login nosuperuser nobypassrls nocreaterole nocreatedb password '${password}'`,
      )
      await admin.query(`create database ${database} owner ${role}`)
    }
    const urlFor = (user?: string) => {
      const url = new URL(adminUrl.toString())
      url.pathname = `/${database}`
      if (user !== undefined) {
        url.username = user
        url.password = encodeURIComponent(password)
      }
      return url.toString()
    }
    seed = new pg.Client({ connectionString: urlFor() })
    await seed.connect()
    owner = bypasses ? seed : new pg.Client({ connectionString: urlFor(role) })
    if (!bypasses) await owner.connect()

    await migrateAs(owner, before)
    // Seeded as the superuser, with the foreign keys off: only the backfills are under test.
    await seed.query('set session_replication_role = replica')
    await seed.query(
      `insert into restro.areas (id, tenant_id, venue_id, name, sort_key)
       values ('ar_BFO1', 'org_x', 'vn_x', 'Floor', 'a0')`,
    )
    for (const [id, sortKey, token] of TOKENS) {
      await seed.query(
        `insert into restro.tables (id, tenant_id, venue_id, area_id, number, sort_key, qr_token)
         values ($1, 'org_x', 'vn_x', 'ar_BFO1', $2, $2, $3)`,
        [id, sortKey, token],
      )
    }
    await seed.query(
      `insert into restro.tables (id, tenant_id, venue_id, area_id, number, sort_key)
       values ('tb_BFO4', 'org_x', 'vn_x', 'ar_BFO1', '4', 'a4')`,
    )
    for (const [day, closedAt] of [
      ['2026-10-01', '2026-10-02T03:00:00Z'],
      ['2026-10-02', '2026-10-03T03:30:00Z'],
    ] as const) {
      await seed.query(
        `insert into restro.service_days
           (tenant_id, venue_id, service_date, closed_at, source, actor, job_id)
         values ('org_x', 'vn_x', $1, $2, 'worker', 'system', 'jb_x')`,
        [day, closedAt],
      )
    }
    await migrateAs(owner, MIGRATIONS)
  }, 120_000)

  afterAll(async () => {
    if (!bypasses) await owner?.end()
    await seed?.end()
    if (admin !== undefined) {
      await admin.query(`drop database if exists ${database} with (force)`)
      if (!bypasses) await admin.query(`drop role if exists ${role}`)
      await admin.end()
    }
    rmSync(before, { recursive: true, force: true })
  }, 60_000)

  it('is the owner it says it is (the run would prove nothing otherwise)', async () => {
    const { rows } = await owner.query<{ bypass: boolean }>(
      'select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user',
    )
    expect(rows[0]?.bypass).toBe(bypasses)
  })

  it('0029 gives every table with a code its hash, and leaves a table without one alone', async () => {
    const { rows } = await seed.query<{ id: string; qr_code_hash: string | null }>(
      'select id, qr_code_hash from restro.tables order by id',
    )
    expect(rows).toEqual([
      ...TOKENS.map(([id, , token]) => ({ id, qr_code_hash: sha256(token) })),
      { id: 'tb_BFO4', qr_code_hash: null },
    ])
  })

  it('0037 marks the nights closed before it as reported, with their close time', async () => {
    const { rows } = await seed.query<{ service_date: string; same: boolean }>(
      `select service_date::text, report_sent_at = closed_at as same
         from restro.service_days order by service_date`,
    )
    expect(rows).toEqual([
      { service_date: '2026-10-01', same: true },
      { service_date: '2026-10-02', same: true },
    ])
  })

  it('forces row-level security on the owner again after both migrations', async () => {
    const { rows } = await seed.query<{ name: string; enabled: boolean; forced: boolean }>(
      `select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'restro' and c.relname in ('tables', 'service_days')
        order by c.relname`,
    )
    expect(rows).toEqual([
      { name: 'service_days', enabled: true, forced: true },
      { name: 'tables', enabled: true, forced: true },
    ])
  })
})
