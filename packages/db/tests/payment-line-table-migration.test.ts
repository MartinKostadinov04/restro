// The migration that records the table each paid line came from (D160 §2, #542:
// `payment_lines.table_id`), on a scratch database of its own: migrated to the one before, seeded
// with payments on two tables, then migrated through it. Every line takes its payment's table (all
// payments so far cover one table); the column is then required, with a foreign key to the
// tenant's tables. Skipped without a database.
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
const TAG = '0057_payment_line_table'

interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

/** A migrations folder holding the migrations before this one, or, with `through`, this one too. */
function migrationsFolder(through: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-plt-'))
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

describe.skipIf(!hasDatabase)('the payment line table migration (#542)', () => {
  const database = `restro_plt_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const before = migrationsFolder(false)
  const through = migrationsFolder(true)
  let admin: pg.Client
  let client: pg.Client

  const migrateTo = (folder: string) =>
    migrate(drizzle({ client }), {
      migrationsFolder: folder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })

  /** A table, as the owner writes it (its own foreign keys are off: only the migration is under test). */
  const table = (id: string) =>
    client.query(
      `insert into restro.tables (id, tenant_id, venue_id, area_id, number, sort_key)
       values ($1, 'org_x', 'vn_x', 'ar_x', $1, 'a0')`,
      [id],
    )
  const payment = (id: string, tableId: string) =>
    client.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, currency, provider_kind, settled_at, source, actor, job_id)
       values ($1, 'org_x', 'vn_x', $2, 'st_x', '2026-11-24', 'on_bill', 'captured', $3, 1400,
          'EUR', 'sim-pay', now(), 'restro', 'system', 'jb_x')`,
      [id, tableId, createHash('sha256').update(id).digest('hex')],
    )
  const line = (paymentId: string, position: number) =>
    client.query(
      `insert into restro.payment_lines
         (tenant_id, venue_id, payment_id, position, pos_line_ref, quantity, pos_amount_minor,
          display_name, open, source, actor, job_id)
       values ('org_x', 'vn_x', $1, $2, $3, 1, 700, 'Gin', false, 'restro', 'system', 'jb_x')`,
      [paymentId, position, `${paymentId}-L${position}`],
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
    await table('tb_ONE')
    await table('tb_TWO')
    await payment('py_ONE', 'tb_ONE')
    await line('py_ONE', 1)
    await line('py_ONE', 2)
    await payment('py_TWO', 'tb_TWO')
    await line('py_TWO', 1)
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
  }, 60_000)

  it('puts every line on its payment’s table', async () => {
    const { rows } = await client.query<{ payment_id: string; position: number; table_id: string }>(
      `select payment_id, position, table_id from restro.payment_lines order by payment_id, position`,
    )
    expect(rows).toEqual([
      { payment_id: 'py_ONE', position: 1, table_id: 'tb_ONE' },
      { payment_id: 'py_ONE', position: 2, table_id: 'tb_ONE' },
      { payment_id: 'py_TWO', position: 1, table_id: 'tb_TWO' },
    ])
  })

  it('requires the table from now on, as a table of the same tenant', async () => {
    await expect(line('py_ONE', 3)).rejects.toThrow(/table_id/)
    // The foreign key was added validated over the backfilled rows (the seeded tables exist).
    const { rows } = await client.query<{ definition: string; validated: boolean }>(
      `select pg_get_constraintdef(oid) as definition, convalidated as validated
         from pg_constraint where conname = 'payment_lines_table_fk'`,
    )
    expect(rows).toEqual([
      {
        definition: 'FOREIGN KEY (tenant_id, table_id) REFERENCES restro.tables(tenant_id, id)',
        validated: true,
      },
    ])
  })

  it('forces row-level security on the owner again, and the updated_at trigger is back on', async () => {
    const { rows } = await client.query<{ name: string; enabled: boolean; forced: boolean }>(
      `select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'restro' and c.relname in ('payments', 'payment_lines')
        order by c.relname`,
    )
    expect(rows).toEqual([
      { name: 'payment_lines', enabled: true, forced: true },
      { name: 'payments', enabled: true, forced: true },
    ])
    const triggers = await client.query<{ tgenabled: string }>(
      `select tgenabled from pg_trigger
        where tgrelid = 'restro.payment_lines'::regclass and tgname = 'payment_lines_touch_updated_at'`,
    )
    expect(triggers.rows).toEqual([{ tgenabled: 'O' }])
  })
})
