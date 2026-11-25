# Database: tests and migrations

These rules apply to database tests in any package (`packages/db`, `packages/core`, `apps/worker`, `apps/web`), not only here. The root `CLAUDE.md` still applies.

- **Database tests** run only with `CI=true` and `DATABASE_URL`, `DATABASE_URL_OWNER` and `DATABASE_APP_PASSWORD` set (local values in `.env.example`). Reuse the running Postgres on 54329 (`pnpm db:local`, embedded, no Docker) with your own database name: create it, then `pnpm db:migrate` and `pnpm db:roles`. Leave running instances you did not start alone.
- **Migrations** (`pnpm db:generate` / `db:migrate` / `db:roles`) use the owner URL, local / CI only; a remote target needs `RESTRO_DB_ALLOW_REMOTE=1` and Martin's OK.
- **Backfills:** a migration that updates or inserts rows in a tenant table wraps that statement in `NO FORCE ROW LEVEL SECURITY` before and `FORCE ROW LEVEL SECURITY` after, as `0019` does. Staging's own owner does hold BYPASSRLS (`rolsuper` false, `rolbypassrls` true: query 7 of `docs/runbooks/supabase-setup.md`, run 11-07), so the statement does touch rows there; the wrap stays the convention because it costs nothing and a host whose owner lacks BYPASSRLS would otherwise update no rows and abort the deploy. CI's `migrations-hosted-owner` job replays every migration as an owner shaped like staging's.
- **Sorting:** CI's Postgres sorts with `en_US`, the local one with `C`, so sort a SQL `order by` result and its JavaScript comparison the same way before comparing.
