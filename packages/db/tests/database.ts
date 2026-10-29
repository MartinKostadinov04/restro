// Shared set-up for the integration tests that need a real Postgres.
//
// They need DATABASE_URL_OWNER (the migration owner; local: the db:local superuser) and either
// DATABASE_URL (restro_app) or DATABASE_APP_PASSWORD to build it, after `pnpm db:migrate` and
// `pnpm db:roles`. Without DATABASE_URL_OWNER they are skipped with a message; in CI (CI is set)
// a missing variable fails the run instead, because there these tests are required.
// They never read .env files, and refuse any database that is not on this machine.
import { randomUUID } from 'node:crypto'

import pg from 'pg'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const ownerUrl = process.env.DATABASE_URL_OWNER ?? ''

/** True when the integration tests can run. */
export const hasDatabase = ownerUrl !== ''

if (!hasDatabase) {
  if (process.env.CI) {
    throw new Error(
      'DATABASE_URL_OWNER is not set. The database integration tests are required in CI: ' +
        'run `pnpm db:migrate && pnpm db:roles` against the CI Postgres service first.',
    )
  }
  process.stderr.write(
    '\n[@restro/db] Skipping the database integration tests: DATABASE_URL_OWNER is not set. ' +
      'Start `pnpm db:local`, set DATABASE_URL_OWNER, DATABASE_APP_PASSWORD (and DATABASE_URL), ' +
      'run `pnpm db:migrate && pnpm db:roles`, then `pnpm test`.\n',
  )
}

function assertLocal(url: string, name: string): void {
  const parsed = new URL(url)
  const host = parsed.searchParams.get('host') ?? parsed.hostname
  if (!LOCAL_HOSTS.has(host) && !host.startsWith('/')) {
    throw new Error(
      `${name} points at ${host}; the integration tests only run on a local database.`,
    )
  }
}

/** Owner connection string (tests use it for set-up and clean-up only). */
export function ownerDatabaseUrl(): string {
  assertLocal(ownerUrl, 'DATABASE_URL_OWNER')
  return ownerUrl
}

/** restro_app connection string: DATABASE_URL, or the owner URL with restro_app's password. */
export function appDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL
  if (explicit) {
    assertLocal(explicit, 'DATABASE_URL')
    return explicit
  }
  const password = process.env.DATABASE_APP_PASSWORD
  if (!password) {
    throw new Error('Set DATABASE_URL (restro_app) or DATABASE_APP_PASSWORD for the tests.')
  }
  const url = new URL(ownerDatabaseUrl())
  url.username = 'restro_app'
  url.password = encodeURIComponent(password)
  return url.toString()
}

/**
 * restro_purge connection string (D83): DATABASE_URL_PURGE, or the owner URL with restro_purge's
 * password (DATABASE_PURGE_PASSWORD).
 */
export function purgeDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL_PURGE
  if (explicit) {
    assertLocal(explicit, 'DATABASE_URL_PURGE')
    return explicit
  }
  const password = process.env.DATABASE_PURGE_PASSWORD
  if (!password) {
    throw new Error(
      'Set DATABASE_URL_PURGE (restro_purge) or DATABASE_PURGE_PASSWORD for the tests.',
    )
  }
  const url = new URL(ownerDatabaseUrl())
  url.username = 'restro_purge'
  url.password = encodeURIComponent(password)
  return url.toString()
}

/**
 * A venue slug with a random suffix. Slugs are unique within an organisation (D84), and tests
 * that share a database with other test files need one nobody else uses.
 */
export function testSlug(base: string): string {
  return `${base}-${randomUUID().replaceAll('-', '').slice(0, 8)}`
}

/**
 * A venue public code no other test created: 12 characters of `a-z0-9`, unique per call (the
 * `venues_public_id_unique` index spans every test file). Core's `newPublicId` is not importable
 * here (core depends on this package), and this one does not need its uniform draw.
 */
export function testPublicId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12)
}

/** A fresh id of a kind (`tn`, `vn`, `tp`): unique per test run, valid for the id checks. */
export function testId(kind: string): string {
  return `${kind}_test${randomUUID().replaceAll('-', '')}`
}

/**
 * Owner pool for set-up and clean-up. The owner must bypass row-level security (true for the
 * db:local and CI superuser): only it can add system templates and delete test rows.
 */
export async function openOwnerPool(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: ownerDatabaseUrl(), max: 2 })
  const { rows } = await pool.query<{ bypass: boolean }>(
    'select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user',
  )
  if (!rows[0]?.bypass) {
    await pool.end()
    throw new Error('DATABASE_URL_OWNER must be a superuser (or BYPASSRLS) for the test set-up.')
  }
  return pool
}

/**
 * Awaits a statement that must fail and returns Postgres's own message. Drizzle wraps driver
 * errors ("Failed query: ...", with the parameters); the database's reason is the `cause`.
 */
export async function databaseError(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    let current: unknown = error
    while (current instanceof Error && current.cause instanceof Error) current = current.cause
    return current instanceof Error ? current.message : String(current)
  }
  throw new Error('Expected the database to reject the statement, but it succeeded.')
}

/**
 * The paying tables (migration 0030) a clean-up empties before the ordering tables they refer to.
 * Their tenancy is tested in payment-tables.test.ts.
 */
export const PAYING_TABLES_CHILDREN_FIRST = [
  'payment_refunds',
  'payment_steps',
  'payment_lines',
  'payments',
  'payment_accounts',
] as const

/**
 * The ordering tables (migration 0028) a clean-up empties next, children before parents. Their
 * tenancy is tested in service-tables.test.ts; `bars` is emptied after `tables`, which refer to it.
 */
export const ORDERING_TABLES_CHILDREN_FIRST = [
  'sent_order_notes',
  'log_entries',
  'table_orders',
  'waiter_calls',
  'sent_orders',
  'sittings',
  'locks',
  'bill_readings',
  'alerts',
  'pauses',
  'service_days',
  'staff_assignments',
  'venue_roles',
  'shared_devices',
  'staff_members',
  'push_subscriptions',
] as const

/**
 * The tenant tables a clean-up empties for the test tenants, children before parents (foreign
 * keys). Venues, templates and tenants follow in `cleanUp`.
 */
export const DOCUMENT_TABLES_CHILDREN_FIRST = [
  'events',
  'field_values',
  'placements',
  'source_links',
  'menu_routes',
  'menus',
  'nodes',
  'source_records',
  'job_runs',
  'places',
  'tables',
  'areas',
  'venue_slug_history',
  'barsy_venues',
  'assets',
  'integrations',
] as const

/** Deletes everything the tests created for these tenants, templates and workers. */
export async function cleanUp(
  owner: pg.Pool,
  ids: { tenants?: string[]; templates?: string[]; workers?: string[] },
): Promise<void> {
  const tenants = ids.tenants ?? []
  for (const table of [
    ...PAYING_TABLES_CHILDREN_FIRST,
    ...ORDERING_TABLES_CHILDREN_FIRST,
    ...DOCUMENT_TABLES_CHILDREN_FIRST,
  ]) {
    await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
  }
  await owner.query('delete from restro.bars where tenant_id = any($1)', [tenants])
  // The purge's log is not a document table (the app role only reads it), but it names a tenant.
  await owner.query('delete from restro.purge_log where tenant_id = any($1)', [tenants])
  await owner.query('delete from restro.venues where tenant_id = any($1)', [tenants])
  await owner.query('delete from restro.templates where tenant_id = any($1) or id = any($2)', [
    tenants,
    ids.templates ?? [],
  ])
  await owner.query('delete from restro.tenants where id = any($1)', [tenants])
  await owner.query('delete from restro.worker_heartbeats where worker_id = any($1)', [
    ids.workers ?? [],
  ])
}
