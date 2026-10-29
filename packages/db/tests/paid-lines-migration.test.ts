// The migration that records what the POS closed, line by line, and each line's name per language
// (#197: `payment_lines.closed_minor`, `closed_quantity`, `name`), on a scratch database of its own:
// migrated to the one before, seeded with payments in every state, then migrated through it. A
// payment the POS had already checked or closed keeps its lines as closed (so a captured one still
// reads as paid); one that had not reaches the check with nothing closed. A line's name keeps the
// text the guest saw under the venue's default language, and "Other item" becomes null. The checks
// refuse a closed amount without a closed quantity, a zero quantity and a name that is no object.
// Skipped without a database.
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
const TAG = '0040_paid_lines'

interface Journal {
  entries: { idx: number; tag: string; when: number }[]
}

/** A migrations folder holding the migrations before this one, or, with `through`, this one too. */
function migrationsFolder(through: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'restro-pdl-'))
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

describe.skipIf(!hasDatabase)('the paid lines migration (#197)', () => {
  const database = `restro_pdl_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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
  const payment = (id: string, state: string) =>
    client.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, currency, provider_kind, settled_at, source, actor, job_id)
       values ($1, 'org_x', 'vn_x', 'tb_x', 'st_x', '2026-10-28', 'on_bill', $2, $3, 1500, 'EUR',
          'sim-pay', case when $2 in ('captured', 'released', 'unconfirmed') then now() end,
          'restro', 'system', 'jb_x')`,
      [id, state, createHash('sha256').update(id).digest('hex')],
    )
  const line = (paymentId: string, position: number, name: string) =>
    client.query(
      `insert into restro.payment_lines
         (tenant_id, venue_id, payment_id, position, pos_line_ref, quantity, pos_amount_minor,
          display_name, source, actor, job_id)
       values ('org_x', 'vn_x', $1, $2, $3, 2, 700, $4, 'restro', 'system', 'jb_x')`,
      [paymentId, position, `${paymentId}-L${position}`, name],
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
      `insert into restro.venues
         (id, tenant_id, name, slug, public_id, default_locale)
       values ('vn_x', 'org_x', 'Club', 'club', 'abcdefghijkl', 'bg_BG')`,
    )
    for (const [id, state] of [
      ['py_CAPTURED1', 'captured'],
      ['py_CHECKED1', 'checked'],
      ['py_UNCONF1', 'unconfirmed'],
      ['py_ISOLATED1', 'isolated'],
      ['py_RELEASED1', 'released'],
    ] as const) {
      await payment(id, state)
      await line(id, 1, 'House wine')
      await line(id, 2, 'Other item')
    }
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

  const closed = async (id: string) =>
    (
      await client.query<{ closed_minor: string | null; closed_quantity: string | null }>(
        'select closed_minor, closed_quantity from restro.payment_lines where payment_id = $1 order by position',
        [id],
      )
    ).rows

  it('keeps the lines of a payment past its check as closed, so a captured one still reads as paid', async () => {
    for (const id of ['py_CAPTURED1', 'py_CHECKED1', 'py_UNCONF1']) {
      expect(await closed(id), id).toEqual([
        { closed_minor: '700', closed_quantity: '2.000000' },
        { closed_minor: '700', closed_quantity: '2.000000' },
      ])
    }
  })

  it('leaves the lines of a payment that had not reached its check, and a released one, not closed', async () => {
    for (const id of ['py_ISOLATED1', 'py_RELEASED1']) {
      expect(await closed(id), id).toEqual([
        { closed_minor: null, closed_quantity: null },
        { closed_minor: null, closed_quantity: null },
      ])
    }
  })

  it('names a line under the venue’s default language, and "Other item" as null', async () => {
    const { rows } = await client.query<{ name: unknown }>(
      `select name from restro.payment_lines where payment_id = 'py_CAPTURED1' order by position`,
    )
    expect(rows.map((row) => row.name)).toEqual([{ bg_BG: 'House wine' }, null])
  })

  it('forces row-level security on the owner again, and the updated_at trigger is back on', async () => {
    // The backfills ran with it off (a hosted owner has no BYPASSRLS); the migration puts it back.
    const { rows } = await client.query<{ name: string; enabled: boolean; forced: boolean }>(
      `select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'restro' and c.relname in ('payments', 'payment_lines', 'venues')
        order by c.relname`,
    )
    expect(rows).toEqual([
      { name: 'payment_lines', enabled: true, forced: true },
      { name: 'payments', enabled: true, forced: true },
      { name: 'venues', enabled: true, forced: true },
    ])
    const triggers = await client.query<{ tgenabled: string }>(
      `select tgenabled from pg_trigger
        where tgrelid = 'restro.payment_lines'::regclass and tgname = 'payment_lines_touch_updated_at'`,
    )
    expect(triggers.rows).toEqual([{ tgenabled: 'O' }])
  })

  it('refuses a closed amount without a closed quantity, a zero quantity, and a name that is no object', async () => {
    await payment('py_NEW1', 'isolated')
    await line('py_NEW1', 1, 'Gin')
    const set = (sqlText: string) => client.query(sqlText.replace('$ID', `'py_NEW1'`))
    await expect(
      set(`update restro.payment_lines set closed_minor = 100 where payment_id = $ID`),
    ).rejects.toThrow(/payment_lines_closed/)
    await expect(
      set(
        `update restro.payment_lines set closed_minor = 100, closed_quantity = 0 where payment_id = $ID`,
      ),
    ).rejects.toThrow(/payment_lines_closed/)
    await expect(
      set(`update restro.payment_lines set name = '[]'::jsonb where payment_id = $ID`),
    ).rejects.toThrow(/payment_lines_name/)
    await expect(
      set(`update restro.payment_lines set name = '{}'::jsonb where payment_id = $ID`),
    ).rejects.toThrow(/payment_lines_name/)
    await set(
      `update restro.payment_lines set closed_minor = 100, closed_quantity = 1, name = '{"en_US":"Gin"}'::jsonb where payment_id = $ID`,
    )
  })
})
