# Database

Drizzle schema, migrations, roles, RLS, and the tenant-scoped client (read / write split).

- **Database tests** run only with `CI=true` and `DATABASE_URL`, `DATABASE_URL_OWNER` and `DATABASE_APP_PASSWORD` set (local values in `.env.example`). Reuse the running Postgres on 54329 (`pnpm db:local`, embedded, no Docker) with your own database name: create it, then `pnpm db:migrate` and `pnpm db:roles`. Leave running instances you did not start alone.
- **Migrations** (`pnpm db:generate` / `db:migrate` / `db:roles`) use the owner URL, local / CI only; a remote target needs `RESTRO_DB_ALLOW_REMOTE=1` and Martin's OK.
- **Sorting:** CI's Postgres sorts with `en_US`, the local one with `C`, so sort a SQL `order by` result and its JavaScript comparison the same way before comparing.
