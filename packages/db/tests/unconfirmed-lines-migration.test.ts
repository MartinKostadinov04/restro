// The migration that keeps an `unconfirmed` payment's lines claimed (#244, RR-14), on a scratch
// database of its own: migrated to the one before, where a payment's lines closed when `settled_at`
// was first set; seeded with what that trigger left, then migrated through it. A payment that has
// not ended claims its lines again, under the migration's job; one that ended, or a line another
// payment has claimed since, is left alone; `settled_at` is touched nowhere. Skipped without a
// database.
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
const TAG = '0043_unconfirmed_lines_stay_claimed'
const ENDS = ['captured', 'released', 'stranded', 'capture_failed']

interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

/** A migrations folder holding the migrations before this one, or, with `through`, this one too. */
function migrationsFolder(through: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-ucl-'))
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

describe.skipIf(!hasDatabase)('the unconfirmed lines migration (#244)', () => {
  const database = `restro_ucl_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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

  /** A payment as the owner writes it (the foreign keys are off: only the migration is under test). */
  const payment = (id: string, state: string, createdAt = '2026-10-28T20:00:00Z') =>
    client.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, currency, provider_kind, settled_at, created_at, source, actor, job_id)
       values ($1, 'org_x', 'vn_x', 'tb_x', 'st_x', '2026-10-28', 'on_bill', $2, $3, 1500, 'EUR',
          'sim-pay', case when $2 = any($4) then $5::timestamptz end, $5, 'restro', 'system', 'jb_x')`,
      [
        id,
        state,
        createHash('sha256').update(id).digest('hex'),
        [...ENDS, 'unconfirmed'],
        createdAt,
      ],
    )
  const line = (paymentId: string, ref: string | null, open: boolean) =>
    client.query(
      `insert into restro.payment_lines
         (tenant_id, venue_id, payment_id, position, pos_line_ref, quantity, pos_amount_minor,
          display_name, open, source, actor, job_id)
       values ('org_x', 'vn_x', $1, 1, $2, 1, 700, 'Gin', $3, 'restro', 'system', 'jb_x')`,
      [paymentId, ref, open],
    )
  const endId = (end: string) => `py_END${end.replace('_', '')}`

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
    // As the old trigger left them: closed once `settled_at` was set, and still closed on the way
    // out of `unconfirmed` (`cancelling`, `settled_at` cleared).
    await payment('py_UNCONF1', 'unconfirmed')
    await line('py_UNCONF1', 'L-unconf', false)
    await payment('py_CANCELLING1', 'cancelling')
    await line('py_CANCELLING1', 'L-cancelling', false)
    await payment('py_NOREF1', 'unconfirmed')
    await line('py_NOREF1', null, false)
    // Each end stays closed.
    for (const end of ENDS) {
      await payment(endId(end), end)
      await line(endId(end), `L-${end}`, false)
    }
    // A payment in flight took a line the unconfirmed one had freed: it keeps its claim.
    await payment('py_TAKEN1', 'unconfirmed')
    await line('py_TAKEN1', 'L-taken', false)
    await payment('py_INFLIGHT1', 'held')
    await line('py_INFLIGHT1', 'L-taken', true)
    // Two unconfirmed payments on one line, the very bug: the older one claims it.
    await payment('py_OLDER1', 'unconfirmed', '2026-10-28T20:00:00Z')
    await line('py_OLDER1', 'L-twice', false)
    await payment('py_YOUNGER1', 'unconfirmed', '2026-10-28T21:00:00Z')
    await line('py_YOUNGER1', 'L-twice', false)
    await client.query('set session_replication_role = origin')
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

  const lineOf = async (id: string) =>
    (
      await client.query<{ open: boolean; job_id: string }>(
        'select open, job_id from restro.payment_lines where payment_id = $1',
        [id],
      )
    ).rows[0]

  it('claims again the lines of a payment that has not ended, under its own job', async () => {
    for (const id of ['py_UNCONF1', 'py_CANCELLING1', 'py_NOREF1', 'py_OLDER1']) {
      expect(await lineOf(id), id).toEqual({
        open: true,
        job_id: 'migration:0043_unconfirmed_lines_stay_claimed',
      })
    }
  })

  it('leaves an ended payment’s lines closed, and a line another payment holds to that payment', async () => {
    for (const end of ENDS) {
      expect(await lineOf(endId(end)), end).toEqual({ open: false, job_id: 'jb_x' })
    }
    expect(await lineOf('py_TAKEN1')).toEqual({ open: false, job_id: 'jb_x' })
    expect(await lineOf('py_INFLIGHT1')).toEqual({ open: true, job_id: 'jb_x' })
    expect(await lineOf('py_YOUNGER1')).toEqual({ open: false, job_id: 'jb_x' })
  })

  it('changes nothing about settled_at: `unconfirmed` still counts as settled', async () => {
    const { rows } = await client.query<{ state: string; settled: boolean }>(
      `select state, bool_and(settled_at is not null) as settled from restro.payments
        group by state order by state collate "C"`,
    )
    expect(rows).toEqual([
      { state: 'cancelling', settled: false },
      { state: 'capture_failed', settled: true },
      { state: 'captured', settled: true },
      { state: 'held', settled: false },
      { state: 'released', settled: true },
      { state: 'stranded', settled: true },
      { state: 'unconfirmed', settled: true },
    ])
    const check = await client.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
        where conname = 'payments_settled'`,
    )
    expect(check.rows[0]?.definition).toContain('unconfirmed')
  })

  it('forces row-level security on the owner again', async () => {
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
  })
})
