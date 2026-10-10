// Guard against future tables that forget tenant isolation (brief S1-03, case 6). It reads the
// live catalog after `pnpm db:migrate`, so it checks what the migrations really did:
// - every table with a tenant_id column (and the tenant root) has ENABLE + FORCE row-level
//   security and policies that all test app.tenant_id, for reading and for writing;
// - a table without tenant_id must be declared `system` in src/table-access.ts, and every
//   table there must exist (so a new table cannot dodge the check by not having tenant_id);
// - no view in `restro` runs with its owner's rights (security_invoker), no materialized view
//   and no SECURITY DEFINER function exists there: each would read past row-level security.
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { APP_SCHEMA, TABLE_ACCESS, type TableAccess } from '../src/table-access'
import { hasDatabase, openOwnerPool } from './database'

const TENANT_PREDICATE = "current_setting('app.tenant_id'"

interface TableRow {
  name: string
  hasTenantId: boolean
  rls: boolean
  forced: boolean
}

interface PolicyRow {
  table: string
  policy: string
  command: string
  using: string | null
  check: string | null
}

describe.skipIf(!hasDatabase)('row-level security guard', () => {
  const access: Record<string, TableAccess> = TABLE_ACCESS
  let owner: pg.Pool
  let tables: TableRow[]
  let policies: PolicyRow[]

  beforeAll(async () => {
    owner = await openOwnerPool()
    tables = (
      await owner.query<TableRow>(
        `select c.relname as name,
                exists (select 1 from pg_attribute a where a.attrelid = c.oid
                        and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped)
                  as "hasTenantId",
                c.relrowsecurity as rls, c.relforcerowsecurity as forced
         from pg_class c
         where c.relnamespace = $1::regnamespace and c.relkind in ('r', 'p', 'f')
         order by 1`,
        [APP_SCHEMA],
      )
    ).rows
    policies = (
      await owner.query<PolicyRow>(
        `select tablename as table, policyname as policy, cmd as command, qual as using,
                with_check as check
         from pg_policies where schemaname = $1`,
        [APP_SCHEMA],
      )
    ).rows
  })

  afterAll(async () => {
    await owner?.end()
  })

  it('finds the tables of this stage (the guard is looking at a migrated database)', () => {
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['tenants', 'venues', 'templates', 'worker_heartbeats']),
    )
  })

  it('every table is declared in src/table-access.ts, and every declared table exists', () => {
    expect(tables.map((table) => table.name).sort()).toEqual(Object.keys(access).sort())
  })

  it('only tables declared `system` lack tenant isolation, and they have no tenant_id', () => {
    for (const table of tables) {
      const tenancy = access[table.name]?.tenancy
      if (tenancy === 'system') {
        expect(table.hasTenantId, `${table.name} is declared system but has tenant_id`).toBe(false)
      } else if (tenancy !== 'tenant-root') {
        expect(table.hasTenantId, `${table.name} has no tenant_id column`).toBe(true)
      }
    }
  })

  it('every table with tenant_id, and the tenant root, has FORCE RLS and tenant policies', () => {
    const isolated = tables.filter(
      (table) => table.hasTenantId || access[table.name]?.tenancy === 'tenant-root',
    )
    expect(isolated.length).toBeGreaterThan(0)
    const failures: string[] = []
    for (const table of isolated) {
      if (!table.rls) failures.push(`${table.name}: row-level security is not enabled`)
      if (!table.forced) failures.push(`${table.name}: row-level security is not FORCED`)
      const own = policies.filter((policy) => policy.table === table.name)
      if (own.length === 0) failures.push(`${table.name}: has no policy`)
      for (const policy of own) {
        const reads = ['ALL', 'SELECT', 'UPDATE', 'DELETE'].includes(policy.command)
        const writes = ['ALL', 'INSERT', 'UPDATE'].includes(policy.command)
        if (reads && !policy.using?.includes(TENANT_PREDICATE)) {
          failures.push(`${table.name}.${policy.policy}: USING does not test app.tenant_id`)
        }
        if (writes && !policy.check?.includes(TENANT_PREDICATE)) {
          failures.push(`${table.name}.${policy.policy}: WITH CHECK does not test app.tenant_id`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('no view, materialized view or SECURITY DEFINER function can read past RLS', async () => {
    const { rows } = await owner.query<{ problem: string }>(
      `select 'view ' || c.relname || ' is not security_invoker' as problem
       from pg_class c
       where c.relnamespace = $1::regnamespace and c.relkind = 'v'
         and not coalesce('security_invoker=true' = any(c.reloptions)
                          or 'security_invoker=on' = any(c.reloptions), false)
       union all
       select 'materialized view ' || c.relname from pg_class c
       where c.relnamespace = $1::regnamespace and c.relkind = 'm'
       union all
       select 'function ' || p.proname || ' is SECURITY DEFINER' from pg_proc p
       where p.pronamespace = $1::regnamespace and p.prosecdef`,
      [APP_SCHEMA],
    )
    expect(rows.map((row) => row.problem)).toEqual([])
  })

  it('catches a tenant table created without FORCE RLS (self-test on a scratch table)', async () => {
    // Proves the catalog query above would see a forgotten table: create one in a transaction
    // that is rolled back, so nothing is left behind.
    const client = await owner.connect()
    try {
      await client.query('begin')
      await client.query(
        'create table restro.guard_probe (id text primary key, tenant_id text not null)',
      )
      await client.query('alter table restro.guard_probe enable row level security')
      const { rows } = await client.query<{ forced: boolean; policies: number }>(
        `select c.relforcerowsecurity as forced,
                (select count(*)::int from pg_policies p
                 where p.schemaname = 'restro' and p.tablename = c.relname) as policies
         from pg_class c where c.oid = 'restro.guard_probe'::regclass`,
      )
      expect(rows[0]).toEqual({ forced: false, policies: 0 })
      await client.query("select restro.enable_tenant_rls('restro.guard_probe')")
      const after = await client.query<{ forced: boolean; using: string; check: string }>(
        `select c.relforcerowsecurity as forced, p.qual as using, p.with_check as check
         from pg_class c join pg_policies p on p.schemaname = 'restro' and p.tablename = c.relname
         where c.oid = 'restro.guard_probe'::regclass`,
      )
      expect(after.rows[0]?.forced).toBe(true)
      expect(after.rows[0]?.using).toContain(TENANT_PREDICATE)
      expect(after.rows[0]?.check).toContain(TENANT_PREDICATE)
    } finally {
      await client.query('rollback')
      client.release()
    }
  })
})
