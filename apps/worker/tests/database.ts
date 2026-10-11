// Set-up for the worker's integration test: a brand-new Postgres database, migrated and with the
// app role in place, so pg-boss really installs its tables as `restro_app` (the same privileges
// production gives it) and nothing the test does touches any other database.
//
// Needs DATABASE_URL_OWNER (the migration owner; local: the db:local superuser) and either
// DATABASE_URL (restro_app) or DATABASE_APP_PASSWORD. Without DATABASE_URL_OWNER the test is
// skipped with a message; in CI (CI is set) a missing variable fails the run, because there the
// test is required. Like the packages/db tests it never reads .env files and refuses a database
// that is not on this machine.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { vi } from 'vitest'

const run = promisify(execFile)

/** A short-lived owner connection, for set-up and for inspecting what the worker did. */
export async function withOwnerClient<T>(
  url: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const DB_SCRIPTS = fileURLToPath(new URL('../../../packages/db/scripts/', import.meta.url))
const MIGRATIONS = fileURLToPath(new URL('../../../packages/db/migrations/', import.meta.url))

const ownerUrl = process.env.DATABASE_URL_OWNER ?? ''

/**
 * How long a test file may take to set its database up. Files queue on the lock below while the
 * whole suite runs in parallel, and each set-up runs the migrations and `db:roles`.
 */
export const SETUP_TIMEOUT_MS = 180_000

/**
 * Gives the calling test file generous hook and test timeouts. With the whole suite running at
 * once the machine is busy, and a hook that waits for the lock or drops a database can take a
 * while; a timeout there is a false failure.
 */
export function allowSlowSetup(): void {
  vi.setConfig({ hookTimeout: SETUP_TIMEOUT_MS, testTimeout: 120_000 })
}

/** Advisory lock key that serialises test-database set-up across processes. */
const ROLES_LOCK = 7_311_020_926

/** True when the integration test can run. */
export const hasDatabase = ownerUrl !== ''

if (!hasDatabase) {
  if (process.env.CI) {
    throw new Error(
      'DATABASE_URL_OWNER is not set. The worker integration test is required in CI: set ' +
        'DATABASE_URL_OWNER and DATABASE_APP_PASSWORD (or DATABASE_URL) for the CI Postgres service.',
    )
  }
  process.stderr.write(
    '\n[@restro/worker] Skipping the integration test: DATABASE_URL_OWNER is not set. ' +
      'Start `pnpm db:local`, set DATABASE_URL_OWNER and DATABASE_APP_PASSWORD, then `pnpm test`.\n',
  )
}

function assertLocal(url: string, name: string): void {
  const parsed = new URL(url)
  const host = parsed.searchParams.get('host') ?? parsed.hostname
  if (!LOCAL_HOSTS.has(host) && !host.startsWith('/')) {
    throw new Error(
      `${name} points at ${host}; the integration test only runs on a local database.`,
    )
  }
}

/**
 * A venue slug that no other test created: `base` and a random suffix. Slugs need not be unique
 * any more (D68, the public code is); a test that tells its venue from another world's by slug
 * still needs one that is its own.
 */
export function testSlug(base: string): string {
  return `${base}-${randomUUID().replaceAll('-', '').slice(0, 8)}`
}

/** `url` pointing at database `name` instead. */
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

export interface TestDatabase {
  readonly name: string
  /** Connection string of the app role `restro_app` for the new database. */
  readonly appUrl: string
  /** Connection string of the migration owner for the new database (set-up and inspection). */
  readonly ownerUrl: string
  /** Drops the database, closing whatever is still connected to it. */
  drop(): Promise<void>
}

/**
 * Applies the migrations up to and including `tag` (a database as it was before the later ones),
 * the way Drizzle's migrator does, from a folder holding only those.
 */
async function migrateThrough(url: string, tag: string): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), 'restro-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[]
  }
  const entries = journal.entries.filter((entry) => entry.tag <= tag)
  if (!entries.some((entry) => entry.tag === tag)) throw new Error(`no migration ${tag}`)
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  await withOwnerClient(url, (client) =>
    migrate(drizzle({ client }), {
      migrationsFolder: folder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    }),
  )
}

/** Applies every pending migration to a test database (what `pnpm db:migrate` does). */
export async function migrateTestDatabase(db: TestDatabase): Promise<void> {
  await run(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', `${DB_SCRIPTS}migrate.ts`],
    {
      env: { ...process.env, DATABASE_URL_OWNER: db.ownerUrl },
    },
  )
}

/**
 * Creates a fresh database, applies the migrations and sets up the app role in it. With
 * `through`, only the migrations up to that one (`0015_venues_public_id`): a test of a later
 * migration seeds the older database, then calls `migrateTestDatabase`.
 */
export async function createTestDatabase(
  options: { readonly through?: string } = {},
): Promise<TestDatabase> {
  assertLocal(ownerUrl, 'DATABASE_URL_OWNER')
  const explicitAppUrl = process.env.DATABASE_URL
  if (explicitAppUrl) assertLocal(explicitAppUrl, 'DATABASE_URL')
  const password = process.env.DATABASE_APP_PASSWORD
  if (!explicitAppUrl && !password) {
    throw new Error('Set DATABASE_URL (restro_app) or DATABASE_APP_PASSWORD for the test.')
  }

  const name = `restro_worker_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  await withOwnerClient(ownerUrl, (client) =>
    client.query(`create database ${client.escapeIdentifier(name)}`),
  )

  const newOwnerUrl = withDatabase(ownerUrl, name)
  let appUrl: string
  if (explicitAppUrl) {
    appUrl = withDatabase(explicitAppUrl, name)
  } else {
    const parsed = new URL(newOwnerUrl)
    parsed.username = 'restro_app'
    parsed.password = encodeURIComponent(password ?? '')
    appUrl = parsed.toString()
  }

  const drop = async () => {
    await withOwnerClient(ownerUrl, (client) =>
      client.query(`drop database if exists ${client.escapeIdentifier(name)} with (force)`),
    )
  }

  try {
    const env = {
      ...process.env,
      DATABASE_URL_OWNER: newOwnerUrl,
      ...(password ? { DATABASE_APP_PASSWORD: password } : {}),
    }
    // `db:roles` alters the cluster-wide role restro_app, and two test files setting up a
    // database at the same moment make Postgres fail with "tuple concurrently updated". An
    // advisory lock on the owner's maintenance connection (any process, same server) lines them up.
    await withOwnerClient(ownerUrl, async (lock) => {
      await lock.query('select pg_advisory_lock($1)', [ROLES_LOCK])
      try {
        for (const script of ['migrate.ts', 'roles.ts']) {
          if (script === 'migrate.ts' && options.through !== undefined) {
            await migrateThrough(newOwnerUrl, options.through)
            continue
          }
          await run(
            process.execPath,
            ['--disable-warning=ExperimentalWarning', DB_SCRIPTS + script],
            { env },
          )
        }
      } finally {
        await lock.query('select pg_advisory_unlock($1)', [ROLES_LOCK])
      }
    })
  } catch (error) {
    await drop().catch(() => undefined)
    throw error
  }
  return { name, appUrl, ownerUrl: newOwnerUrl, drop }
}
