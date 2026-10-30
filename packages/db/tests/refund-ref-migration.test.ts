// The migration that gives a refund row the provider's id of its refund (#261, RR-1), on a scratch
// database of its own: migrated to the one before, seeded with what the old reading left, then
// migrated through it. Every old row is kept as it was, with no id (a reading names it later, see
// `reconcileRefunds`), and the new rules hold: one row per refund of a payment, any number of rows
// with no id, and an id of the usual shape. Skipped without a database.
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
const TAG = '0044_refund_provider_ref'

interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

/** A migrations folder holding the migrations before this one, or, with `through`, this one too. */
function migrationsFolder(through: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-rrf-'))
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

describe.skipIf(!hasDatabase)('the refund id migration (#261)', () => {
  const database = `restro_rrf_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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

  /** A refund row as the owner writes it (the foreign keys are off: only the migration is tested). */
  const insertRefund = (id: string, paymentId: string, ref?: string) =>
    client.query(
      `insert into restro.payment_refunds
         (id, tenant_id, venue_id, payment_id, ${ref === undefined ? '' : 'provider_refund_ref,'}
          amount_minor, service_date, source, actor, job_id)
       values ($1, 'org_x', 'vn_x', $2, ${ref === undefined ? '' : `'${ref}',`}
          500, '2026-10-28', 'restro', 'system', 'jb_x')`,
      [id, paymentId],
    )
  const oldRows = async () =>
    (
      await client.query(
        `select to_jsonb(t) - 'provider_refund_ref' as row, provider_refund_ref as ref
           from restro.payment_refunds t where job_id = 'jb_old' order by id`,
      )
    ).rows as { row: unknown; ref: string | null }[]

  let oldBefore: unknown[] = []

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
    // As the old reading left them: a row of a refund, a failed one, one with its storno made.
    await client.query(
      `insert into restro.payment_refunds
         (id, tenant_id, venue_id, payment_id, amount_minor, failed_at, storno_at, storno_by,
          service_date, source, actor, job_id)
       values
         ('rf_OLD1', 'org_x', 'vn_x', 'py_OLD', 500, null, null, null, '2026-10-28', 'worker', 'system', 'jb_old'),
         ('rf_OLD2', 'org_x', 'vn_x', 'py_OLD', 500, '2026-10-28T21:00:00Z', null, null, '2026-10-28', 'worker', 'system', 'jb_old'),
         ('rf_OLD3', 'org_x', 'vn_x', 'py_OLD', 800, null, '2026-10-28T22:00:00Z', 'user:u1', '2026-10-28', 'worker', 'system', 'jb_old')`,
    )
    oldBefore = (
      await client.query(
        `select to_jsonb(t) as row from restro.payment_refunds t where job_id = 'jb_old' order by id`,
      )
    ).rows.map((entry) => (entry as { row: unknown }).row)
    await migrateTo(through)
  }, 120_000)

  afterAll(async () => {
    await client?.end()
    await admin?.query(`drop database if exists ${database} with (force)`)
    await admin?.end()
    rmSync(before, { recursive: true, force: true })
    rmSync(through, { recursive: true, force: true })
  })

  it('keeps every old row exactly as it was, with no id', async () => {
    const rows = await oldRows()
    expect(rows.map((entry) => entry.row)).toEqual(oldBefore)
    expect(rows.map((entry) => entry.ref)).toEqual([null, null, null])
  })

  it('takes a refund of a payment once, and the same id on another payment', async () => {
    await insertRefund('rf_NEW1', 'py_A', 're_1')
    await expect(insertRefund('rf_NEW2', 'py_A', 're_1')).rejects.toThrow(
      /payment_refunds_provider_ref_unique/,
    )
    await insertRefund('rf_NEW3', 'py_B', 're_1')
    await insertRefund('rf_NEW4', 'py_A', 're_2')
  })

  it('takes any number of rows with no id on one payment', async () => {
    await insertRefund('rf_NOID1', 'py_C')
    await insertRefund('rf_NOID2', 'py_C')
    const { rows } = await client.query(
      `select count(*)::int as n from restro.payment_refunds where payment_id = 'py_C'`,
    )
    expect(rows[0]).toEqual({ n: 2 })
  })

  it('refuses an id of another shape', async () => {
    await expect(insertRefund('rf_BAD1', 'py_D', 're bad')).rejects.toThrow(
      /payment_refunds_provider_ref/,
    )
  })
})
