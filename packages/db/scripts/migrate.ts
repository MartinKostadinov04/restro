// `pnpm db:migrate`: applies the SQL migrations in packages/db/migrations as the migration owner
// (DATABASE_URL_OWNER). Run `pnpm db:roles` afterwards so the app role's privileges cover any
// new table. Owner-only code: never imported by the package's entry points.
//
// Pending migrations run in one transaction (Drizzle's migrator); a session advisory lock makes
// two concurrent runs (say, two deploys) wait for each other instead of racing.
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

import { assertSafeTarget, describeTarget, requireEnv } from './lib/target.ts'

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url))
const MIGRATIONS_SCHEMA = 'drizzle'
const MIGRATIONS_TABLE = '__drizzle_migrations'
const LOCK_NAME = 'restro:db:migrate'

async function appliedCount(client: pg.Client): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*) from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function main(): Promise<void> {
  const url = requireEnv(
    'DATABASE_URL_OWNER',
    'It is the migration owner connection (local: postgres://postgres:postgres@localhost:54329/restro).',
  )
  assertSafeTarget(url, 'db:migrate')

  const client = new pg.Client({ connectionString: url, application_name: 'restro-db-migrate' })
  await client.connect()
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [LOCK_NAME])
    await migrate(drizzle({ client }), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    })
    console.log(
      `db:migrate: ${describeTarget(url)} is up to date (${await appliedCount(client)} migrations applied).`,
    )
  } finally {
    // Closing the session also releases the advisory lock.
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(`db:migrate failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
