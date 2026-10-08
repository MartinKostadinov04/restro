// Set-up shared by the web app's integration tests (they need a real Postgres). Same rules as the
// db and core packages: they run when DATABASE_URL_OWNER is set (after `pnpm db:migrate &&
// pnpm db:roles`), are skipped with a message otherwise, and fail instead of skipping when CI is
// set. They never read .env files and refuse a database that is not on this machine.
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
    '\n[@restro/web] Skipping the database integration tests: DATABASE_URL_OWNER is not set. ' +
      'Start `pnpm db:local`, run `pnpm db:migrate && pnpm db:roles`, then `pnpm test`.\n',
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

/** restro_app connection string: DATABASE_URL, or the owner URL with restro_app's password. */
export function appDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL
  if (explicit) {
    assertLocal(explicit, 'DATABASE_URL')
    return explicit
  }
  const password = process.env.DATABASE_APP_PASSWORD
  if (!password) throw new Error('Set DATABASE_URL (restro_app) or DATABASE_APP_PASSWORD.')
  assertLocal(ownerUrl, 'DATABASE_URL_OWNER')
  const url = new URL(ownerUrl)
  url.username = 'restro_app'
  url.password = encodeURIComponent(password)
  return url.toString()
}

/** Owner pool, for clean-up only (the app role has no DELETE on most of these tables). */
export function openOwnerPool(): pg.Pool {
  assertLocal(ownerUrl, 'DATABASE_URL_OWNER')
  return new pg.Pool({ connectionString: ownerUrl, max: 2 })
}

/** Points the server code at the test database with a throwaway secret, before its first use. */
export function useTestServerEnvironment(): void {
  process.env.DATABASE_URL = appDatabaseUrl()
  process.env.BETTER_AUTH_SECRET = 'test-only-secret-not-used-anywhere-else-0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
}

/** Deletes what a test created: sessions, accounts, members, organisations, users, venues, tenants. */
export async function cleanUp(
  owner: pg.Pool,
  rows: { userIds: readonly string[]; organizationIds: readonly string[] },
): Promise<void> {
  const { userIds, organizationIds } = rows
  await owner.query('delete from restro.auth_session where user_id = any($1)', [userIds])
  await owner.query('delete from restro.auth_account where user_id = any($1)', [userIds])
  await owner.query('delete from restro.auth_member where organization_id = any($1)', [
    organizationIds,
  ])
  await owner.query('delete from restro.auth_invitation where organization_id = any($1)', [
    organizationIds,
  ])
  await owner.query('delete from restro.auth_organization where id = any($1)', [organizationIds])
  await owner.query('delete from restro.auth_user where id = any($1)', [userIds])
  await owner.query('delete from restro.venues where tenant_id = any($1)', [organizationIds])
  await owner.query('delete from restro.tenants where id = any($1)', [organizationIds])
}
