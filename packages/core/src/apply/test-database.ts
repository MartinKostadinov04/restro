// Set-up shared by the integration tests of this folder (they need a real Postgres). Same rules
// as packages/db/tests/database.ts: the tests run when DATABASE_URL_OWNER is set (after
// `pnpm db:migrate && pnpm db:roles`), are skipped with a message otherwise, and fail instead of
// skipping when CI is set. They never read .env files and refuse a database that is not local.
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
    '\n[@restro/core] Skipping the provisioning integration tests: DATABASE_URL_OWNER is not ' +
      'set. Start `pnpm db:local`, run `pnpm db:migrate && pnpm db:roles`, then `pnpm test`.\n',
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

/**
 * A venue slug no other test created: `base` and a random suffix. Slugs need not be unique any
 * more (D68, the public code is), but the test files of a run share one database and run in
 * parallel, and a test that looks a venue up by its slug needs one that is its own.
 */
export function testSlug(base: string): string {
  return `${base}-${randomUUID().replaceAll('-', '').slice(0, 8)}`
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
  assertLocal(ownerUrl, 'DATABASE_URL_OWNER')
  const url = new URL(ownerUrl)
  url.username = 'restro_app'
  url.password = encodeURIComponent(password)
  return url.toString()
}

/** Owner pool for clean-up only (the app role has no DELETE on tenants and venues). */
export function openOwnerPool(): pg.Pool {
  assertLocal(ownerUrl, 'DATABASE_URL_OWNER')
  return new pg.Pool({ connectionString: ownerUrl, max: 2 })
}

/** Tenant tables emptied by `cleanUp`, children before parents (foreign keys). */
const TABLES_CHILDREN_FIRST = [
  'item_first_published',
  'publish_pointers',
  'snapshots',
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
  'purge_log',
  'barsy_venues',
  'assets',
  'integrations',
  'tags',
  'venues',
] as const

/** Deletes everything the tests created for these tenants, then the tenants. */
export async function cleanUp(owner: pg.Pool, tenantIds: readonly string[]): Promise<void> {
  for (const table of TABLES_CHILDREN_FIRST) {
    await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenantIds])
  }
  await owner.query('delete from restro.tenants where id = any($1)', [tenantIds])
}
