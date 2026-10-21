# Runbook: roles and migrations on Supabase `restro-staging`

For the lead agent. Brings an empty Supabase project to the state the code expects: schema `restro` with forced row-level security, schema `pgboss`, and the login role `restro_app` the web app and worker use. The same steps later apply to `restro-prod`.

What the code expects is defined in `packages/db`: migrations in `packages/db/migrations/`, the app role's privileges in `packages/db/src/table-access.ts`, and the two owner scripts `pnpm db:migrate` and `pnpm db:roles`.

## 0. Ground rules

- **Not from a local machine.** CLAUDE.md forbids running migrations against staging or production from a laptop. The scripts enforce it: they refuse any non-local database unless `RESTRO_DB_ALLOW_REMOTE=1` is set. The runner is a manually started GitHub Actions workflow (step 6). Running the first bootstrap from the lead's machine instead needs Martin's explicit OK in chat, once.
- **No secret in chat, in the repo, or in a log.** Database passwords live in GitHub environment secrets (and later Railway variables). `pnpm db:roles` sends the app password to Postgres only as a SCRAM verifier, so it never appears in Supabase's logs.
- **We never use** the Data API (PostgREST), the `anon` / `authenticated` / `service_role` roles, Supabase keys, or `drizzle-kit push` (push would drop our hand-written policies).
- **The owner connection never reaches the apps.** `DATABASE_URL_OWNER` exists only in the migration runner. The web app and the worker get `DATABASE_URL` (restro_app) and refuse to start their scoped transactions as any role that could bypass row-level security.

## 1. Before you start

Martin has done T37 (`docs/owner-actions.md`): organisation "Restro", project `restro-staging` in Central EU (Frankfurt), and sent the **project ref**. The database password (the `postgres` role's) is in his password manager, not in chat.

## 2. Switch off the Data API

1. Open `https://supabase.com/dashboard/project/<project-ref>/integrations/data_api/overview` (in older dashboards: Project Settings → Data API).
2. Turn **Enable Data API** off and save.
3. Reload the page and check that it still shows the Data API as disabled.

Our schemas are protected even if it were on: nobody but `postgres` and `restro_app` has `USAGE` on `restro` (step 7 checks it). Keeping the API off is a second lock.

## 3. SSL

1. Open `https://supabase.com/dashboard/project/<project-ref>/database/settings`, section **SSL Configuration**.
2. Turn on **Enforce SSL on incoming connections** (the database restarts for a few seconds).
3. **Download certificate** (`prod-ca-2021.crt`). It is a public CA certificate, not a secret; store its text as the GitHub environment secret `SUPABASE_CA_CERT` so the runner can write it to a file.

Connection strings use `sslmode=verify-full&sslrootcert=<path to the certificate>`. With node-postgres, `sslmode=require` alone is treated as `verify-full` and fails with "self-signed certificate in certificate chain" unless `sslrootcert` is given.

## 4. Connection strings (session pooler)

Free projects have an IPv6-only direct host (`db.<ref>.supabase.co`); GitHub runners and Railway need IPv4, so we use **Supavisor's session pooler** (port **5432**). Copy the pooler host from the dashboard's **Connect** dialog (it looks like `aws-<n>-eu-central-1.pooler.supabase.com`; it cannot be derived from the region). The database name on Supabase is `postgres`; our schemas live inside it.

| Variable | Role | Format |
|---|---|---|
| `DATABASE_URL_OWNER` | `postgres` (migration owner; runner only) | `postgresql://postgres.<ref>:<db password>@<pooler host>:5432/postgres?sslmode=verify-full&sslrootcert=<cert path>` |
| `DATABASE_URL` | `restro_app` (web app, worker) | `postgresql://restro_app.<ref>:<app password>@<pooler host>:5432/postgres?sslmode=verify-full&sslrootcert=<cert path>` |
| `DATABASE_APP_PASSWORD` | the password `db:roles` sets for `restro_app` | same value as in `DATABASE_URL` |
| `DATABASE_PURGE_PASSWORD` | the password `db:roles` sets for `restro_purge` (the purge job's role, D83) | a second generated password |
| `DATABASE_URL_PURGE` | `restro_purge` (worker only, the purge job) | like `DATABASE_URL` with `restro_purge.<ref>` and the purge password |

Through the shared pooler every user name carries the project ref (`<role>.<ref>`); custom roles work the same way as `postgres`.

**Why session mode is safe for us.** Tenancy is set per transaction with `set_config('app.tenant_id', $1, true)`; a session-mode client keeps one server connection for its whole session, so the setting and the transaction always run on the same backend (it would also hold in transaction mode, since the setting is transaction-local). Session mode also supports the session-level features that transaction mode (port 6543) does not, such as the session advisory lock `db:migrate` holds and prepared statements, so nothing in our code or in pg-boss has to avoid them. Budget: every pool counts against the pooler's per-project client limit on the free plan; `createPool` defaults to 5 connections, so keep web + worker + pg-boss well under it.

**pg-boss** must start with `schema: 'pgboss'` and `createSchema: false`: the schema is created by the owner in migration 0001, and `restro_app` may create tables inside it but not schemas in the database.

## 5. Generate the app password

On any trusted machine (this generates a value, it touches no database):

```
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

32 characters, printable ASCII without spaces (what `db:roles` requires: at least 16). Store it as the GitHub environment secret `STAGING_DATABASE_APP_PASSWORD`, and build `STAGING_DATABASE_URL` and `STAGING_DATABASE_URL_OWNER` from step 4 as secrets too. Generate a second one the same way for the purge role (`STAGING_DATABASE_PURGE_PASSWORD`, and `STAGING_DATABASE_URL_PURGE` for the worker). Never paste any of them in chat.

## 6. Apply migrations and roles

Everything below runs **as `postgres`** (the owner connection):

- `pnpm db:migrate`: creates schemas `restro`, `pgboss` and `drizzle` (the migration journal), the four tables, `restro.enable_tenant_rls()`, the forced RLS policies, the templates policies and the `updated_at` trigger. Pending migrations run in one transaction under an advisory lock.
- `pnpm db:roles`: creates or updates `restro_app` and `restro_purge` (LOGIN, NOINHERIT, no SUPERUSER / BYPASSRLS / CREATEROLE / CREATEDB / REPLICATION), grants CONNECT, `USAGE` on `restro` (and `USAGE, CREATE` on `pgboss` to `restro_app` only), exactly the table privileges in `src/table-access.ts` (`app` and `purge` lists), revokes everything else, and checks the result before committing. On Supabase `postgres` is not a superuser, so the script only names role attributes that actually need changing.

Runner: a manually started workflow with a protected `staging` environment. It does not exist yet (adding it is a follow-up); its shape, with actions pinned to the same SHAs as `ci.yml`:

```yaml
name: DB migrate (staging)
on: workflow_dispatch
permissions:
  contents: read
jobs:
  migrate:
    runs-on: ubuntu-latest
    environment: staging          # holds the secrets below; add a required reviewer
    steps:
      - uses: actions/checkout@<sha as in ci.yml>
      - uses: pnpm/action-setup@<sha as in ci.yml>
      - uses: actions/setup-node@<sha as in ci.yml>
        with: { node-version: 24.21.0, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Supabase CA certificate
        run: printf '%s\n' "$SUPABASE_CA_CERT" > "$RUNNER_TEMP/supabase-ca.crt"
        env: { SUPABASE_CA_CERT: '${{ secrets.SUPABASE_CA_CERT }}' }
      - name: Migrations and roles
        run: pnpm db:migrate && pnpm db:roles
        env:
          RESTRO_DB_ALLOW_REMOTE: '1'
          DATABASE_URL_OWNER: ${{ secrets.STAGING_DATABASE_URL_OWNER }}
          DATABASE_APP_PASSWORD: ${{ secrets.STAGING_DATABASE_APP_PASSWORD }}
          DATABASE_PURGE_PASSWORD: ${{ secrets.STAGING_DATABASE_PURGE_PASSWORD }}
      - name: Log in as restro_app through the pooler
        run: psql "$DATABASE_URL" -c "select current_user, (select count(*) from restro.venues) as rows_without_tenant"
        env: { DATABASE_URL: '${{ secrets.STAGING_DATABASE_URL }}' }
```

In the secrets, `sslrootcert` is `/home/runner/work/_temp/supabase-ca.crt` (the runner's `$RUNNER_TEMP`). Expected output:

```
db:migrate: postgres.<ref>@<pooler host>:5432/postgres is up to date (2 migrations applied).
db:roles: restro_app created on postgres.<ref>@<pooler host>:5432/postgres; privileges match src/table-access.ts (4 tables).
 current_user | rows_without_tenant
 restro_app   |                   0
```

Both scripts are idempotent: run the workflow again after every merge that adds a migration (later Railway's pre-deploy step does the same with the same variables).

## 7. Verify

In the dashboard's **SQL Editor** (it runs as `postgres`):

```sql
-- 1. restro_app: can log in; every other column false.
select rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
from pg_roles where rolname = 'restro_app';

-- 2. Row-level security enabled AND forced on tenants, venues, templates
--    (worker_heartbeats is the only system table: both false there).
select relname, relrowsecurity, relforcerowsecurity
from pg_class where relnamespace = 'restro'::regnamespace and relkind = 'r' order by 1;

-- 3. Policies: tenant_isolation on tenants and venues; templates_read and templates_insert.
select tablename, policyname, cmd from pg_policies where schemaname = 'restro' order by 1, 2;

-- 4. Only restro_app (besides postgres) can reach schema restro: anon, authenticated,
--    service_role and authenticator must all be false.
select rolname, has_schema_privilege(rolname, 'restro', 'USAGE') as can_use_restro
from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'restro_app');

-- 5. restro_app owns nothing in restro (expect no rows).
select relname from pg_class
where relnamespace = 'restro'::regnamespace and pg_has_role('restro_app', relowner, 'MEMBER');

-- 6. Migrations applied (expect 2 rows today).
select id, hash, created_at from drizzle.__drizzle_migrations order by id;

-- 7. For the record: what `postgres` is on this project.
select rolsuper, rolbypassrls from pg_roles where rolname = 'postgres';
```

If (7) shows `rolbypassrls = false`, then `postgres` too sees no tenant rows (FORCE RLS applies to the owner): a manual data fix as `postgres` must run `select set_config('app.tenant_id', '<tn_…>', true)` inside its transaction first.

## 8. Rotating the app password

Generate a new one (step 5), update `STAGING_DATABASE_APP_PASSWORD` and `STAGING_DATABASE_URL`, rerun the workflow with `DATABASE_APP_PASSWORD_ROTATE=1` (only then does `db:roles` re-set the password of an existing role; routine runs keep it, because Supavisor caches the old SCRAM verifier and every re-set — even to the same password — breaks pooled logins until its cache refreshes), then update `DATABASE_URL` wherever the apps run and restart them.

## 9. Troubleshooting

| Message | Cause and fix |
|---|---|
| `db:migrate refuses to run against …: it is not a local database` | Working as intended outside the runner. Only the workflow sets `RESTRO_DB_ALLOW_REMOTE=1`. |
| `self-signed certificate in certificate chain` | `sslrootcert` missing or wrong path in the URL. |
| `Tenant or user not found` (from the pooler) | User name lacks the project ref: use `postgres.<ref>` / `restro_app.<ref>`. |
| `permission denied to alter role` / `Only roles with the SUPERUSER attribute may …` | `restro_app` has gained an attribute only a superuser can remove. Stop; it needs Supabase support. Do not work around it. |
| `Table(s) restro.x are not listed in packages/db/src/table-access.ts` | A migration added a table without deciding the app's privileges. Fix in code, merge, rerun. |
| `Role check failed, nothing was changed` | Listed problems are real (for example a grant made by another role). Nothing was applied; fix the cause and rerun. |
| `Refusing to run: database role "postgres" can bypass row-level security` (from an app) | The app was given the owner URL. Give it `DATABASE_URL` (restro_app). |

## 10. Free-plan notes

Free projects pause after about a week without activity; the worker's 5-minute polling keeps staging awake once it runs. There are no downloadable backups on the free plan; our own `pg_dump` to R2 is the backup (Stack tab).
