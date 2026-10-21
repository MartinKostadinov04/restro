// Integration tests on a real Postgres: the purge role restro_purge (D83, adjustments V1) holds
// exactly the privileges src/table-access.ts lists under `purge`, is held to row-level security
// like the app role, is the only role that can erase venue data, and `@restro/db/purge` refuses
// to run on any other role.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool, type DbPool } from '../src'
import { NotThePurgeRoleError, withTenantPurge } from '../src/purge'
import { APP_SCHEMA, PURGE_ROLE, TABLE_ACCESS, type TableAccess } from '../src/table-access'
import {
  appDatabaseUrl,
  cleanUp,
  hasDatabase,
  openOwnerPool,
  purgeDatabaseUrl,
  testId,
  testPublicId,
  testSlug,
} from './database'

const PERMISSION_DENIED = /permission denied/

describe.skipIf(!hasDatabase)('the purge role restro_purge', () => {
  const tenantA = testId('tn')
  const tenantB = testId('tn')
  const venueA = testId('vn')
  const venueB = testId('vn')
  const tombstone = testPublicId()
  let owner: pg.Pool
  let purge: pg.Client
  let appPool: DbPool
  let purgePool: DbPool

  /** Runs `statement` in its own transaction as restro_purge, scoped to `tenant`. */
  async function asPurge(
    statement: string,
    params: unknown[] = [],
    tenant: string = tenantA,
  ): Promise<pg.QueryResult> {
    await purge.query('begin')
    try {
      await purge.query("select set_config('app.tenant_id', $1, true)", [tenant])
      const result = await purge.query(statement, params)
      await purge.query('commit')
      return result
    } catch (error) {
      await purge.query('rollback')
      throw error
    }
  }

  beforeAll(async () => {
    owner = await openOwnerPool()
    purge = new pg.Client({ connectionString: purgeDatabaseUrl() })
    await purge.connect()
    appPool = createPool(appDatabaseUrl(), { max: 1 })
    purgePool = createPool(purgeDatabaseUrl(), { max: 1 })
    // The owner bypasses row-level security: two tenants, a venue each.
    for (const [tenant, venue] of [
      [tenantA, venueA],
      [tenantB, venueB],
    ]) {
      await owner.query('insert into restro.tenants (id, name) values ($1, $2)', [tenant, 'Purge'])
      await owner.query(
        'insert into restro.venues (id, tenant_id, name, slug, public_id) values ($1, $2, $3, $4, $5)',
        [venue, tenant, 'Venue', testSlug('purge'), testPublicId()],
      )
    }
  })

  afterAll(async () => {
    await appPool?.end()
    await purgePool?.end()
    await purge?.end()
    if (owner) {
      await cleanUp(owner, { tenants: [tenantA, tenantB] })
      await owner.query('delete from restro.tombstones where value = $1', [tombstone])
      await owner.end()
    }
  })

  it('logs in as restro_purge, which is not superuser, BYPASSRLS, CREATEROLE or CREATEDB', async () => {
    const { rows } = await purge.query(
      `select current_user as role, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
              rolreplication, rolinherit
       from pg_roles where rolname = current_user`,
    )
    expect(rows[0]).toEqual({
      role: PURGE_ROLE,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolinherit: false,
    })
  })

  it('starts every session with statement_timeout 5min and idle_in_transaction_session_timeout 60s', async () => {
    const { rows } = await purge.query(
      `select current_setting('statement_timeout') as statement_timeout,
              current_setting('idle_in_transaction_session_timeout') as idle_in_transaction`,
    )
    expect(rows[0]).toEqual({ statement_timeout: '5min', idle_in_transaction: '1min' })
  })

  it('holds exactly the table privileges listed under `purge` in src/table-access.ts', async () => {
    const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    const { rows } = await owner.query<{ relname: string; privilege: string }>(
      `select c.relname, p.privilege
       from pg_class c cross join unnest($3::text[]) as p(privilege)
       where c.relnamespace = $2::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and has_table_privilege($1, c.oid, p.privilege)
       order by 1, 2`,
      [PURGE_ROLE, APP_SCHEMA, privileges],
    )
    const granted: Record<string, string[]> = {}
    for (const { relname, privilege } of rows) {
      granted[relname] = [...(granted[relname] ?? []), privilege]
    }
    const access: Record<string, TableAccess> = TABLE_ACCESS
    const expected = Object.fromEntries(
      Object.entries(access)
        .filter(([, table]) => (table.purge?.length ?? 0) > 0)
        .map(([table, entry]) => [table, [...(entry.purge ?? [])].sort()]),
    )
    expect(granted).toEqual(expected)
  })

  it('may use schema restro only: no CREATE there, nothing in pgboss', async () => {
    const { rows } = await owner.query(
      `select has_schema_privilege($1, 'restro', 'USAGE') as restro_usage,
              has_schema_privilege($1, 'restro', 'CREATE') as restro_create,
              has_schema_privilege($1, 'pgboss', 'USAGE') as pgboss_usage,
              has_schema_privilege($1, 'pgboss', 'CREATE') as pgboss_create`,
      [PURGE_ROLE],
    )
    expect(rows[0]).toEqual({
      restro_usage: true,
      restro_create: false,
      pgboss_usage: false,
      pgboss_create: false,
    })
  })

  it('is held to row-level security: scoped to one tenant it sees that tenant alone', async () => {
    const { rows } = await asPurge('select id from restro.venues', [], tenantA)
    expect(rows.map((row) => row.id)).toEqual([venueA])
    const other = await asPurge('select id from restro.venues', [], tenantB)
    expect(other.rows.map((row) => row.id)).toEqual([venueB])
  })

  it.each([
    "update restro.venues set name = 'renamed'",
    "insert into restro.venues (id, tenant_id, name, slug, public_id) values ('vn_x', 'tn_x', 'x', 'x', 'abcdefghijkl')",
    'delete from restro.templates',
    'delete from restro.tenants',
    'delete from restro.auth_user',
    'delete from restro.auth_session',
    'delete from restro.worker_heartbeats',
    'delete from restro.organization_slug_history',
    'delete from restro.tombstones',
    'truncate restro.nodes',
    'create table restro.sneaky (id text)',
    'set role postgres',
  ])('is denied: %s', async (statement) => {
    await expect(asPurge(statement)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('writes a tombstone and a purge log line, which the app role can read', async () => {
    await asPurge(
      "insert into restro.tombstones (kind, value, organization_id) values ('public_code', $1, $2)",
      [tombstone, tenantA],
    )
    await asPurge(
      "insert into restro.purge_log (tenant_id, kind, subject_id, counts) values ($1, 'venue', $2, '{\"venues\": 1}'::jsonb)",
      [tenantA, venueA],
    )
    const app = new pg.Client({ connectionString: appDatabaseUrl() })
    await app.connect()
    try {
      await app.query('begin')
      await app.query("select set_config('app.tenant_id', $1, true)", [tenantA])
      const stones = await app.query(
        'select organization_id from restro.tombstones where value = $1',
        [tombstone],
      )
      expect(stones.rows).toEqual([{ organization_id: tenantA }])
      const log = await app.query(
        'select kind, subject_id, counts from restro.purge_log where tenant_id = $1',
        [tenantA],
      )
      expect(log.rows).toEqual([{ kind: 'venue', subject_id: venueA, counts: { venues: 1 } }])
      await app.query('rollback')
    } finally {
      await app.end()
    }
  })

  it('deletes only the scoped tenant’s rows: tenant A’s venue goes, tenant B’s stays', async () => {
    const deleted = await asPurge('delete from restro.venues', [], tenantA)
    expect(deleted.rowCount).toBe(1)
    const { rows } = await owner.query(
      'select id from restro.venues where id = any($1) order by id',
      [[venueA, venueB]],
    )
    expect(rows.map((row) => row.id)).toEqual([venueB])
  })

  it('withTenantPurge runs on the purge pool and refuses the app pool', async () => {
    const role = await withTenantPurge(purgePool, tenantB, async (tx) => {
      const result = await tx.execute<{ role: string }>('select current_user as role')
      return result.rows[0]?.role
    })
    expect(role).toBe(PURGE_ROLE)
    await expect(withTenantPurge(appPool, tenantB, async () => 'ran')).rejects.toBeInstanceOf(
      NotThePurgeRoleError,
    )
  })
})
