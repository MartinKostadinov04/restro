// The migration that lets a captured payment leave a paper receipt to bring (#200:
// `receipt_to_bring_at`, `receipt_brought_at`, `receipt_brought_by`), on a scratch database of its
// own: migrated to the one before, seeded with a payment captured then, then migrated through it.
// The old payment must read as one with no receipt to bring; the check must refuse a Brought mark
// without a receipt to bring, without an account, with a name that is no account, and a receipt to
// bring on a payment with no receipt number. Skipped without a database.
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
const TAG = '0039_receipt_brought'

interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

/** A migrations folder holding the migrations before this one, or, with `through`, this one too. */
function migrationsFolder(through: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-rcb-'))
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

describe.skipIf(!hasDatabase)('the receipt to bring migration (#200)', () => {
  const database = `restro_rcb_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const before = migrationsFolder(false)
  const through = migrationsFolder(true)
  const oldPayment = 'py_OLDPAYMENT1'
  let admin: pg.Client
  let client: pg.Client

  const migrateTo = (folder: string) =>
    migrate(drizzle({ client }), {
      migrationsFolder: folder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    })

  /** A captured payment as the owner writes it (the foreign keys are off: only the check is under test). */
  const insertPayment = (
    id: string,
    receiptNumber: string | null,
    receipt: { toBring?: boolean; broughtBy?: string } = {},
  ) =>
    client.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, captured_minor, currency, provider_kind, receipt_number, settled_at,
          receipt_to_bring_at, receipt_brought_at, receipt_brought_by, source, actor, job_id)
       values ($1, 'org_x', 'vn_x', 'tb_x', 'st_x', '2026-10-29', 'on_bill', 'captured', $2,
          1000, 1000, 'EUR', 'sim-pay', $3, now(),
          case when $4::boolean then now() end,
          case when $5::text is not null then now() end, $5, 'restro', 'system', 'jb_x')`,
      [
        id,
        createHash('sha256').update(id).digest('hex'),
        receiptNumber,
        receipt.toBring ?? false,
        receipt.broughtBy ?? null,
      ],
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
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, captured_minor, currency, provider_kind, receipt_number, settled_at,
          source, actor, job_id)
       values ($1, 'org_x', 'vn_x', 'tb_x', 'st_x', '2026-10-28', 'on_bill', 'captured', $2,
          1000, 1000, 'EUR', 'sim-pay', 'R-1', now(), 'restro', 'system', 'jb_x')`,
      [oldPayment, createHash('sha256').update(oldPayment).digest('hex')],
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
  }, 60_000)

  it('leaves a payment captured before it with no receipt to bring', async () => {
    const { rows } = await client.query(
      `select receipt_to_bring_at, receipt_brought_at, receipt_brought_by
         from restro.payments where id = $1`,
      [oldPayment],
    )
    expect(rows).toEqual([
      { receipt_to_bring_at: null, receipt_brought_at: null, receipt_brought_by: null },
    ])
  })

  it('holds a receipt to bring only with a receipt number, and Brought only with both a time and an account', async () => {
    await insertPayment('py_TOBRING1', 'R-2', { toBring: true })
    await insertPayment('py_BROUGHT1', 'R-3', { toBring: true, broughtBy: 'user:u1' })
    // No receipt number, so nothing to bring.
    await expect(insertPayment('py_NONUMBER', null, { toBring: true })).rejects.toThrow(
      /payments_receipt_brought/,
    )
    // Brought without a receipt to bring, and an account that is not one.
    await expect(insertPayment('py_NOTHING', 'R-4', { broughtBy: 'user:u1' })).rejects.toThrow(
      /payments_receipt_brought/,
    )
    await expect(
      insertPayment('py_BADNAME', 'R-5', { toBring: true, broughtBy: 'Ana the waiter' }),
    ).rejects.toThrow(/payments_receipt_brought/)
  })
})
