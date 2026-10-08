// Integration tests on a real Postgres: the app role restro_app cannot escape row-level security
// or change the schema (brief S1-03, case 4), and holds exactly the privileges listed in
// src/table-access.ts (what `pnpm db:roles` promises).
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { APP_ROLE, APP_SCHEMA, TABLE_ACCESS } from '../src/table-access'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testId } from './database'

const PERMISSION_DENIED = /permission denied/
const MUST_BE_OWNER = /must be owner of/

describe.skipIf(!hasDatabase)('the app role restro_app', () => {
  const tenant = testId('tn')
  const template = testId('tp')
  let owner: pg.Pool
  let app: pg.Client

  /** Runs `statement` in its own transaction as restro_app, scoped to the test tenant. */
  async function asApp(statement: string, params: unknown[] = []): Promise<pg.QueryResult> {
    await app.query('begin')
    try {
      await app.query("select set_config('app.tenant_id', $1, true)", [tenant])
      const result = await app.query(statement, params)
      await app.query('commit')
      return result
    } catch (error) {
      await app.query('rollback')
      throw error
    }
  }

  beforeAll(async () => {
    owner = await openOwnerPool()
    app = new pg.Client({ connectionString: appDatabaseUrl() })
    await app.connect()
    await asApp("insert into restro.tenants (id, name) values ($1, 'Role test')", [tenant])
    await asApp(
      `insert into restro.templates (id, tenant_id, key, version, definition)
       values ($1, $2, 'role-test', 1, '{}'::jsonb)`,
      [template, tenant],
    )
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, { tenants: [tenant] })
      await owner.end()
    }
  })

  it('logs in as restro_app, which is not superuser, BYPASSRLS, CREATEROLE or CREATEDB', async () => {
    const { rows } = await app.query(
      `select current_user as role, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
              rolreplication, rolinherit
       from pg_roles where rolname = current_user`,
    )
    expect(rows[0]).toEqual({
      role: APP_ROLE,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolinherit: false,
    })
  })

  it('starts every session with statement_timeout 30s and idle_in_transaction_session_timeout 60s', async () => {
    // The connection string above carries no startup parameters, so these come from the role
    // itself (ALTER ROLE ... SET in db:roles), which is what Supabase's session pooler honours.
    const { rows } = await app.query(
      `select current_setting('statement_timeout') as statement_timeout,
              current_setting('idle_in_transaction_session_timeout') as idle_in_transaction`,
    )
    expect(rows[0]).toEqual({ statement_timeout: '30s', idle_in_transaction: '1min' })

    const stored = await owner.query<{ database: string | null; setconfig: string[] }>(
      `select d.datname as database, s.setconfig
       from pg_db_role_setting s
       left join pg_database d on d.oid = s.setdatabase
       where s.setrole = $1::regrole`,
      [APP_ROLE],
    )
    // One row, for all databases, with exactly these two settings: nothing scoped to one
    // database that would override them.
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0]?.database).toBeNull()
    expect([...(stored.rows[0]?.setconfig ?? [])].sort()).toEqual([
      'idle_in_transaction_session_timeout=60s',
      'statement_timeout=30s',
    ])
  })

  it('owns nothing in schema restro and is a member of no other role', async () => {
    const owned = await owner.query(
      `select relname from pg_class
       where relnamespace = $2::regnamespace and pg_has_role($1, relowner, 'MEMBER')`,
      [APP_ROLE, APP_SCHEMA],
    )
    expect(owned.rows).toEqual([])
    const memberships = await owner.query(
      `select roleid::regrole::text as role from pg_auth_members where member = $1::regrole`,
      [APP_ROLE],
    )
    expect(memberships.rows).toEqual([])
  })

  it('4. cannot SET row_security = off to bypass row-level security', async () => {
    await expect(
      (async () => {
        await app.query('begin')
        try {
          await app.query('set local row_security = off')
          await app.query('select * from restro.venues')
        } finally {
          await app.query('rollback')
        }
      })(),
    ).rejects.toThrow(/row-level security/)
  })

  it.each([
    'alter table restro.venues disable row level security',
    'alter table restro.venues no force row level security',
    'alter table restro.venues add column leak text',
    'drop policy tenant_isolation on restro.venues',
    'create policy open_door on restro.venues using (true)',
    'drop table restro.templates',
  ])('4. cannot change the schema: %s', async (statement) => {
    await expect(asApp(statement)).rejects.toThrow(MUST_BE_OWNER)
  })

  it.each([
    'update restro.templates set definition = \'{"changed": true}\'::jsonb',
    'delete from restro.templates',
    'delete from restro.venues',
    'delete from restro.tenants',
    'truncate restro.venues',
    'create table restro.sneaky (id text)',
    "select restro.enable_tenant_rls('restro.venues')",
    'set role postgres',
  ])('4. is denied: %s', async (statement) => {
    await expect(asApp(statement)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('holds exactly the table privileges listed in src/table-access.ts', async () => {
    const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    const { rows } = await owner.query<{ relname: string; privilege: string }>(
      `select c.relname, p.privilege
       from pg_class c cross join unnest($3::text[]) as p(privilege)
       where c.relnamespace = $2::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and has_table_privilege($1, c.oid, p.privilege)
       order by 1, 2`,
      [APP_ROLE, APP_SCHEMA, privileges],
    )
    const granted: Record<string, string[]> = {}
    for (const { relname, privilege } of rows) {
      granted[relname] = [...(granted[relname] ?? []), privilege]
    }
    const expected = Object.fromEntries(
      Object.entries(TABLE_ACCESS).map(([table, access]) => [table, [...access.app].sort()]),
    )
    expect(granted).toEqual(expected)
  })

  it('may use but not create in schema restro, and may use and create in schema pgboss', async () => {
    const { rows } = await owner.query(
      `select has_schema_privilege($1, 'restro', 'USAGE') as restro_usage,
              has_schema_privilege($1, 'restro', 'CREATE') as restro_create,
              has_schema_privilege($1, 'pgboss', 'USAGE') as pgboss_usage,
              has_schema_privilege($1, 'pgboss', 'CREATE') as pgboss_create`,
      [APP_ROLE],
    )
    expect(rows[0]).toEqual({
      restro_usage: true,
      restro_create: false,
      pgboss_usage: true,
      pgboss_create: true,
    })
  })
})
