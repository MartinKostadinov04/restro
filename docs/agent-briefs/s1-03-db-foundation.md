# Brief S1-03: database foundation in `packages/db` (Drizzle, roles, row-level security)

- **Model:** Opus 5.5 (tenancy and rule 2 enforcement)
- **Branch:** your worktree branch, based on `s1/ground` after the scaffold (S1-01) is merged
- **Read first:** `CLAUDE.md`; `docs/architecture/stack.md` → "Kickoff amendments", "Data, tenancy and secrets", "How the nine rules are enforced"; `docs/architecture/data-architecture.md` → "The internal data source" (tiers + supporting tables); `docs/tracker.md` → D43, D45, D50

## Goal
A Postgres foundation that is safe for AI-written code from day one: Drizzle schema and migrations in our own schema, a migration owner role and a non-owner app role, row-level security that isolates tenants even when a query forgets its filter, a tenant-scoped client, a read/write split the import rules can police, and an integration test that proves isolation. Works on local Docker Postgres 17, in CI, and on Supabase (Frankfurt) later.

## Decisions already made (do not reopen)
- Database = Postgres 17. Local: the scaffold's `docker-compose.yml`. Hosted: Supabase free plan, **Data API off**; we never use Supabase's `anon`/`authenticated` roles or PostgREST.
- All our tables live in schema **`restro`** (not `public`). pg-boss will use schema **`pgboss`**.
- Ids are opaque prefixed text (`tn_…`, `vn_…`, `tp_…`, see `@restro/core` `newId` once S1-02 lands; until then accept any non-empty text with a check constraint on the prefix).
- Driver: `pg` (node-postgres) — the same driver pg-boss uses. ORM: Drizzle ORM + drizzle-kit.

## Done when
- [ ] `pnpm db:generate` and `pnpm db:migrate` work locally against Docker Postgres, using `DATABASE_URL_OWNER` for migrations
- [ ] `pnpm db:roles` (idempotent script) creates/updates the login role `restro_app` with the password from `DATABASE_APP_PASSWORD`, grants it only what it needs, `NOBYPASSRLS`, not owner of any `restro` table
- [ ] Integration tests (Vitest, real Postgres; skipped with a clear message if `DATABASE_URL_OWNER` is absent, but **required in CI**) prove the isolation cases below
- [ ] `docs/runbooks/supabase-setup.md` explains, step by step, how the lead will apply roles and migrations to Supabase `restro-staging` (session pooler connection string format, which SQL runs as `postgres`, how to switch off the Data API, how to verify)
- [ ] CI workflow updated so migrations + role setup run against the CI Postgres service before tests
- [ ] `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass

## Schema for this stage (migration 0001)
| Table | Columns | RLS |
|---|---|---|
| `restro.tenants` | `id` text pk (`tn_`), `name`, `created_at` | row visible when `id = current tenant` |
| `restro.venues` | `id` text pk (`vn_`), `tenant_id` fk, `name`, `slug` (unique per tenant), `timezone` default `Europe/Sofia`, `service_day_ends_at` time default `07:00` (D45), `currency` default `EUR`, `default_locale` default `bg_BG`, `enabled_locales` text[] default `{bg_BG,en_US}`, `created_at`, `updated_at` | tenant isolation |
| `restro.templates` | `id` text pk (`tp_`), `tenant_id` null = system template, `key`, `version` int, `definition` jsonb, `created_at`; unique (`coalesce(tenant_id,'')`, `key`, `version`); **immutable rows** (no UPDATE grant) | read: own tenant or system; write: own tenant only |
| `restro.worker_heartbeats` | `worker_id` text pk, `last_beat_at` timestamptz, `version` text | system table: no tenant, app role may upsert |
Also: schema `pgboss` created by the owner with `USAGE, CREATE` granted to `restro_app` (pg-boss creates and migrates its own tables at worker start).

## RLS pattern (write it once, reuse for every future tenant table)
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY;`
- Policy using `tenant_id = current_setting('app.tenant_id', true)` for USING and WITH CHECK; with no tenant set, a tenant table returns zero rows and rejects writes.
- A SQL helper or Drizzle helper so future tables add RLS in one line; a test that **fails if any table in schema `restro` with a `tenant_id` column lacks FORCE RLS and a policy** (catches future agents forgetting it).

## Client API (`packages/db`)
- `@restro/db` (read side): `createPool(url)`, `withTenant(tenantId, async (tx) => …)` — opens a transaction, `select set_config('app.tenant_id', $1, true)`, runs the callback, commits; `withSystem(async (tx) => …)` for system tables only (heartbeats); the Drizzle schema objects.
- `@restro/db/write`: the writable transaction entry that `core/apply` will use later; for now export a typed `withTenantWrite` that is identical but lives on the subpath the import rule protects. Make sure the package `exports` map exposes exactly these two entry points.
- Never export a helper that runs as the owner role from the package used by apps. Owner-only code (migrations, `db:roles`) lives under `packages/db/scripts/`.

## Tests that must exist (integration, real Postgres)
1. Tenant A and tenant B each have venues; `withTenant(A)` sees only A's venues; `withTenant(B)` only B's.
2. Inserting a venue with `tenant_id = B` inside `withTenant(A)` fails (WITH CHECK).
3. No tenant set → `select * from restro.venues` returns 0 rows.
4. `restro_app` cannot `SET row_security = off` to bypass, cannot `ALTER TABLE`, cannot `UPDATE restro.templates`.
5. System template visible to both tenants; tenant A's template invisible to B.
6. The "every tenant table has FORCE RLS + policy" guard.

## Out of scope / never do
- No product tables beyond the four above (nodes, field_values, events etc. come in Stage 2), no Better Auth tables (S1-05 adds them through this package's migration pipeline), no Supabase calls (no credentials yet).
- Do not edit CLAUDE.md, the tracker or architecture docs. Nothing from CLAUDE.md "Never". Commit on your branch only (end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Stop and ask if
- Supavisor (Supabase's pooler) session mode is incompatible with `set_config(..., true)` inside a transaction or with pg-boss as you understand them
- you need superuser rights for anything at runtime
- drizzle-kit cannot express FORCE RLS / policies and you would need raw SQL migrations (raw SQL is acceptable — say which you chose)

## Report back
CLAUDE.md report format, plus the exact env variables the apps now need (names and meaning, no values).
