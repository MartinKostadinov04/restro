// drizzle-kit is used only to GENERATE migration files (`pnpm db:generate`), which needs no
// database. Migrations are applied by scripts/migrate.ts (`pnpm db:migrate`), never by
// `drizzle-kit migrate` or `drizzle-kit push`: push diffs against the live database and would
// drop the row-level security policies that live in hand-written SQL migrations. That is why
// this config deliberately has no database credentials.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
  strict: true,
  verbose: true,
})
