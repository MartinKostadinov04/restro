// Integration tests on a real Postgres: the backup role restro_backup (D143, ticket #320) reads
// every row of every tenant (it is the one role with BYPASSRLS) and writes nothing: SELECT on
// the tables and sequences of `restro` and `drizzle`, no CREATE anywhere, no queue schema, and
// sessions that are read-only by default.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { APP_SCHEMA, BACKUP_ROLE, TABLE_ACCESS } from '../src/table-access'
import {
  appDatabaseUrl,
  backupDatabaseUrl,
  cleanUp,
  hasDatabase,
  openOwnerPool,
  testId,
  testPublicId,
  testSlug,
} from './database'

const hasBackupRole = backupDatabaseUrl() !== null

if (hasDatabase && !hasBackupRole && process.env.CI) {
  throw new Error(
    'DATABASE_BACKUP_PASSWORD (or DATABASE_URL_BACKUP) is not set. The backup role test is required in CI.',
  )
}

describe.skipIf(!hasDatabase || !hasBackupRole)('the backup role restro_backup', () => {
  const tenantA = testId('tn')
  const tenantB = testId('tn')
  const venueA = testId('vn')
  const venueB = testId('vn')
  let owner: pg.Pool
  let backup: pg.Client
  let app: pg.Client

  beforeAll(async () => {
    owner = await openOwnerPool()
    backup = new pg.Client({ connectionString: backupDatabaseUrl() as string })
    await backup.connect()
    app = new pg.Client({ connectionString: appDatabaseUrl() })
    await app.connect()
    for (const [tenant, venue] of [
      [tenantA, venueA],
      [tenantB, venueB],
    ]) {
      await owner.query('insert into restro.tenants (id, name) values ($1, $2)', [tenant, 'Backup'])
      await owner.query(
        'insert into restro.venues (id, tenant_id, name, slug, public_id) values ($1, $2, $3, $4, $5)',
        [venue, tenant, 'Venue', testSlug('backup'), testPublicId()],
      )
    }
  })

  afterAll(async () => {
    await backup?.end()
    await app?.end()
    if (owner) {
      await cleanUp(owner, { tenants: [tenantA, tenantB] })
      await owner.end()
    }
  })

  it('is not superuser, CREATEROLE, CREATEDB or replication, but has BYPASSRLS', async () => {
    const { rows } = await backup.query(
      `select current_user as role, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
              rolreplication, rolinherit
       from pg_roles where rolname = current_user`,
    )
    expect(rows[0]).toEqual({
      role: BACKUP_ROLE,
      rolsuper: false,
      rolbypassrls: true,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolinherit: false,
    })
  })

  it('is the only role with BYPASSRLS among the roles the apps use', async () => {
    const { rows } = await owner.query(
      `select rolname from pg_roles where rolname in ('restro_app', 'restro_purge', 'restro_backup')
         and rolbypassrls order by 1`,
    )
    expect(rows.map((row) => row.rolname)).toEqual([BACKUP_ROLE])
  })

  it('starts every session read-only, with a long statement timeout for a dump', async () => {
    const { rows } = await backup.query(
      `select current_setting('default_transaction_read_only') as read_only,
              current_setting('statement_timeout') as statement_timeout,
              current_setting('idle_in_transaction_session_timeout') as idle_in_transaction`,
    )
    expect(rows[0]).toEqual({
      read_only: 'on',
      statement_timeout: '30min',
      idle_in_transaction: '30min',
    })
  })

  it('reads every tenant’s rows with no tenant set, where the app role reads none', async () => {
    const { rows } = await backup.query('select id from restro.venues where id = any($1)', [
      [venueA, venueB],
    ])
    expect(rows.map((row) => row.id).sort()).toEqual([venueA, venueB].sort())
    const blind = await app.query('select id from restro.venues where id = any($1)', [
      [venueA, venueB],
    ])
    expect(blind.rows).toEqual([])
  })

  it('holds SELECT on every table of restro and nothing else', async () => {
    const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    const { rows } = await owner.query<{ relname: string; privilege: string }>(
      `select c.relname, p.privilege
       from pg_class c cross join unnest($3::text[]) as p(privilege)
       where c.relnamespace = $2::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and has_table_privilege($1, c.oid, p.privilege)
       order by 1, 2`,
      [BACKUP_ROLE, APP_SCHEMA, privileges],
    )
    const granted: Record<string, string[]> = {}
    for (const { relname, privilege } of rows) {
      granted[relname] = [...(granted[relname] ?? []), privilege]
    }
    expect(granted).toEqual(
      Object.fromEntries(Object.keys(TABLE_ACCESS).map((t) => [t, ['SELECT']])),
    )
  })

  it('reads the migration journal and the sequences, writes neither', async () => {
    const journal = await backup.query(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    )
    expect(journal.rows[0].n).toBeGreaterThan(0)
    const { rows } = await owner.query(
      `select n.nspname || '.' || c.relname as sequence,
              has_sequence_privilege($1, c.oid, 'SELECT') as can_read,
              has_sequence_privilege($1, c.oid, 'UPDATE') as can_advance
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'S' and n.nspname in ('restro', 'drizzle')`,
      [BACKUP_ROLE],
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).toMatchObject({ can_read: true, can_advance: false })
  })

  it('may use restro and drizzle, create nowhere, and not touch the queue schema', async () => {
    const { rows } = await owner.query(
      `select has_schema_privilege($1, 'restro', 'USAGE') as restro_usage,
              has_schema_privilege($1, 'restro', 'CREATE') as restro_create,
              has_schema_privilege($1, 'drizzle', 'USAGE') as drizzle_usage,
              has_schema_privilege($1, 'drizzle', 'CREATE') as drizzle_create,
              has_schema_privilege($1, 'pgboss', 'USAGE') as pgboss_usage,
              has_schema_privilege($1, 'public', 'CREATE') as public_create`,
      [BACKUP_ROLE],
    )
    expect(rows[0]).toEqual({
      restro_usage: true,
      restro_create: false,
      drizzle_usage: true,
      drizzle_create: false,
      pgboss_usage: false,
      public_create: false,
    })
  })

  it.each([
    "update restro.venues set name = 'renamed'",
    "insert into restro.tenants (id, name) values ('tn_x', 'x')",
    'delete from restro.venues',
    'delete from restro.auth_session',
    'truncate restro.nodes',
    'delete from drizzle.__drizzle_migrations',
    'create table restro.sneaky (id text)',
    'create table public.sneaky (id text)',
    "select nextval('drizzle.__drizzle_migrations_id_seq')",
    'select * from pgboss.job limit 1',
    'set role postgres',
  ])('is denied: %s', async (statement) => {
    await expect(backup.query(statement)).rejects.toThrow(/permission denied|read-only/)
  })
})
