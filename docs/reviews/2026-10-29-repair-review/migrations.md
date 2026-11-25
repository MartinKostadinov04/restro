# A4: Migrations and roles

Reviewer A4, repair-review of `or/foundation` at `6b467a01` (worktree `rr-a4`, detached, nothing edited or committed). I used only the local embedded Postgres 17.10 on `localhost:54329`; `RESTRO_DB_ALLOW_REMOTE` stayed unset throughout. My databases `restro_rr_a4_empty` and `restro_rr_a4_seeded` and the scratch role `rr_a4_owner` were dropped at the end. A check query on `pg_database` / `pg_roles` returns 0 rows.

## 1. Commands and durations

| Step | Command | Time | Result |
|---|---|---|---|
| Empty DB | `create database restro_rr_a4_empty` | - | ok |
| Migrate | `pnpm db:migrate` (owner URL) | 2.79 s | "43 migrations applied" (0000-0042), no warnings |
| Roles | `pnpm db:roles` | 1.59 s | "privileges match src/table-access.ts (58 tables)" |
| Migrate again | `pnpm db:migrate` | 1.94 s | no-op (43 applied, nothing new) |
| Roles again | `pnpm db:roles` | 1.69 s | no-op, still matching |
| Seed | `pnpm db:seed:dev` (`DATABASE_URL` = `restro_app`, `.env.example` values) | 4.9 s | Demo Club, 2 venues, 66 nodes |
| Drift | `pnpm db:generate` | 4.9 s | "No schema changes, nothing to migrate"; `git status` clean |
| Seeded replay, pass 1 | scratch harness, drizzle migrator on 0000-0027 / 0028-0036 / 0037-0042 | 472 / 448 / 195 ms | all applied |
| Seeded replay, pass 2 (owner without BYPASSRLS) | same harness, run as `rr_a4_owner` | 3.6 s / fails at 0029 / 2.6 s / 2.1 s | see RR-A4-1 |

The only messages were NOTICEs (the harness prints them, `db:migrate` does not): `policy "tenant_isolation" for relation ... does not exist, skipping`. They come from `DROP POLICY IF EXISTS` inside `enable_tenant_rls` and are harmless.

`packages/db/scripts/migrate.ts` runs all pending migrations in one transaction and has no stop-at option. To stop at 0027 I used a scratch harness: it copies migrations `0000..N` and a shortened `_journal.json` into a temp folder, then runs the same drizzle migrator. Afterwards, the official `pnpm db:migrate` on the seeded DB was a no-op (same 43 hashes), so the harness and the script agree.

## 2. The two replays

### 2a. Empty: 0000 -> 0042, then roles
The replay ran clean and is idempotent: the second migrate and the second roles run were both no-ops. The result has 58 tables, with grants exactly as `table-access.ts` declares.

### 2b. Seeded: 0027 -> seed -> 0028 -> 0042

**Seed data at 0027.** Today's `db:seed:dev` writes columns that did not exist at 0027. So I seeded the empty DB (at 0042), then copied every column the two schemas share into the 0027 DB (replica mode, `OVERRIDING SYSTEM VALUE`).

**Synthetic rows.** The seed has one organisation and no floor tables or service rows, so I added these:
- At 0027: organisation B (`tn_rrB`, venue `vn_rrB1`), 3 areas and 5 tables. Four tables have a `qr_token`; `tb_rrA3` has none.
- At 0036: 2 sittings, 3 closed service days, 3 waiter calls, and 8 payments with 2 lines each. The payments cover the states checked, captured, requested and released, once per organisation.

Row counts. Tables not listed had equal counts at every step:

| Table | 0027 | 0036 | 0042 |
|---|---|---|---|
| tenants | 2 | 2 | 2 |
| venues | 3 | 3 | 3 |
| events | 411 | 411 | 411 |
| field_values | 235 | 235 | 235 |
| nodes | 66 | 66 | 66 |
| placements | 49 | 49 | 49 |
| source_links / source_records | 63 / 63 | 63 / 63 | 63 / 63 |
| menus | 2 | 2 | 2 |
| integrations / barsy_venues | 2 / 1 | 2 / 1 | 2 / 1 |
| areas / tables | 3 / 5 | 3 / 5 | 3 / 5 |
| sittings / service_days / waiter_calls | - | 2 / 3 / 3 | 2 / 3 / 3 |
| payments / payment_lines | - | 8 / 16 | 8 / 16 |
| payment_refunds | - | - | 0 |

No row was lost at any step.

**Backfills, pass 1.** The owner is the local superuser, as in dev and CI.

| Migration | Backfill | Result |
|---|---|---|
| 0029 | `tables.qr_code_hash = sha256(qr_token)` | correct on the 4 coded tables; `code_generation = 1`; `is_payment_table = false` |
| 0037 | `service_days.report_sent_at = closed_at` | set on 3 of 3 |
| 0038 (#211) | `waiter_calls.last_called_at = called_at`, `kinds = {waiter}` | set on 3 of 3 |
| 0040 | `payment_lines.closed_minor / closed_quantity`, `name` jsonb | lines of checked and captured payments closed (500 / 1.5); requested and released left null. `name` becomes `{"bg_BG":"Mojito"}`; "Other item" becomes null |
| 0040 | NO FORCE / FORCE wrap | FORCE restored on `venues`, `payments`, `payment_lines`; trigger re-enabled |

**Pass 2: an owner shaped like Supabase's.** I recreated the database with `OWNER rr_a4_owner` (`login nosuperuser nobypassrls nocreaterole nocreatedb`) and ran the migrations as that role. The seed copy and the synthetic rows were written as `postgres`.

| Migration | Result with an owner without BYPASSRLS |
|---|---|
| 0000-0028 | ok |
| **0029** | **Fails** with `check constraint "tables_qr_code_complete" of relation "tables" is violated by some row`. The transaction rolls back; the journal stops at 0028. |
| 0029-0036 (after I nulled every `qr_token` as superuser so the replay could go on) | ok |
| **0037** | Applies, but **the backfill touches 0 rows**: `report_sent_at` stays null on all 3 closed days |
| 0038, 0040 | correct (their NO FORCE wraps work) |
| 0039, 0041, 0042 | ok |

**Proof for 0029.** As `rr_a4_owner`, in a transaction I rolled back:
- the 0029 `UPDATE` under forced RLS gives `UPDATE 0`;
- after `alter table restro.tables no force row level security`, the same `UPDATE` gives `UPDATE 4`.

**Guest lookup in pass 2.** After `db:roles`, `guest_table_by_code_hash(<B's hash>)` called as `restro_app` returned **0 rows**; in pass 1 it returns B's row. Why: the function is `SECURITY DEFINER` and owned by the migration owner, and `tables` has `FORCE ROW LEVEL SECURITY`. With no `app.tenant_id` set and an owner without BYPASSRLS, the policy hides every row. See RR-A4-3.

## 3. Grants and RLS, and the diff against `table-access.ts`

`compare.mjs` (the database catalogue against `TABLE_ACCESS`) finds **no diff**, on both the empty and the seeded database. `roles.ts` makes the same check itself and refuses tables that are not listed.

| Group | Tables | Owner | RLS / forced | Policy | `restro_app` | `restro_purge` |
|---|---|---|---|---|---|---|
| Tenant, standard | 44 tables with `tenant_id`, plus `tenants` (by `id`) | postgres | on / on | `tenant_isolation` FOR ALL, USING = WITH CHECK `tenant_id = nullif(current_setting('app.tenant_id', true), '')` | per `TABLE_ACCESS` | SELECT+DELETE where `PURGED` |
| `templates` | 1 | postgres | on / on | `templates_read`, `templates_insert` (custom; unchanged since before 0028) | per list | per list |
| System | `auth_*` (7), `operators`, `organization_slug_history`, `provider_notices`, `tombstones`, `worker_heartbeats` | postgres | off | none | per list | per list |

- **System tables.** `operators` (0028) and `provider_notices` (0030) are declared `tenancy: 'system'` at `packages/db/src/table-access.ts:164` and `:181`. Confirmed in the database: no `tenant_id`, no RLS. The app holds SELECT on `operators` and SELECT/INSERT/UPDATE on `provider_notices`.
- **New tenant tables.** All 23 have RLS on and forced, with the standard policy: the 17 from 0028, `payments`, `payment_lines`, `payment_steps` and `payment_accounts` from 0030, and `payment_refunds` from 0042. This is what D122 §9 asks: "Every service table gets its own RLS, in the existing tenant pattern".
- **PUBLIC:** no table grant anywhere. There are no other grantees.
- **DELETE grants:**
  - `restro_app` holds DELETE on exactly `auth_session`, `auth_verification`, `field_values`, `placements` and `source_links`. That equals `APP_DELETE_TABLES` and matches D83.
  - `restro_purge` holds SELECT+DELETE on 44 tables, plus INSERT on `tombstones` and `purge_log`.
  - No other role holds DELETE.
- **Purge DELETE tables against `apps/worker/src/jobs/purge.ts`.** 43 of the 44 have a delete path. Three examples: `barsy_venues` through `tillVenueLinks`, `provider_notices` through `purgeProviderNotices`, `job_runs` at lines 742-744. **`assets` has a DELETE grant but no delete path** (RR-A4-4).
- **Routines.** `roles.ts` revokes PUBLIC EXECUTE on every routine in `restro`, then grants `ROUTINE_ACCESS`.

| Routine | Security | EXECUTE |
|---|---|---|
| `guest_table_by_code_hash(text)` | DEFINER, `search_path = pg_catalog, restro` | owner, `restro_app` |
| `close_payment_lines()` (0032, trigger) | invoker | owner only |
| `payments_erase_receipt_email()` (0041, trigger) | invoker | owner only |
| `enable_tenant_rls`, `integrations_default_name`, `menus_guard_update`, `snapshots_guard_update`, `touch_updated_at` | invoker | owner only |

Only the owner holds EXECUTE on `close_payment_lines()`. A trigger function needs no EXECUTE grant to fire. Tested as `restro_app` under A's tenant: setting `py_rrA3` to released/settled closed both of its lines (job `jb_rrtest`). The test was rolled back.

- **Schemas:**
  - `restro`: owner UC, `restro_app` U, `restro_purge` U.
  - `pgboss`: `restro_app` UC.
  - Neither role has CREATE on `public`.
  - The database ACL keeps the Postgres default for PUBLIC, `Tc` (TEMP, CONNECT).
- **Role attributes:** both roles are NOSUPERUSER, NOBYPASSRLS and NOINHERIT. `statement_timeout` / `idle_in_transaction_session_timeout` are 30 s / 60 s for the app role and 5 min / 60 s for the purge role.

## 4. Tenancy smoke

**Set-up:**
- the seeded DB from pass 1, after `db:roles`;
- 2 synthetic rows per organisation in every new table the replay had left empty;
- role `restro_app` (`rolbypassrls = false`), with `set_config('app.tenant_id', 'tn_6pRck1LCSZeaqc9dPEwUXB', true)`, so A is Demo Club;
- each probe in its own transaction, rolled back.

| Table | A's rows visible | B's rows visible | INSERT naming B's tenant/venue | UPDATE of B's rows | INSERT with A's tenant + B's venue |
|---|---|---|---|---|---|
| areas, tables | yes | 0 | RLS refused | UPDATE 0 | FK refused (tables) |
| sittings, waiter_calls, table_orders, sent_orders, bill_readings, bars, locks, pauses, push_subscriptions, shared_devices, staff_members, venue_roles | yes | 0 | RLS refused | UPDATE 0 | refused by a unique index or FK |
| alerts, service_days, staff_assignments | yes | 0 | RLS refused | UPDATE 0 | FK refused |
| sent_order_notes, log_entries | yes | 0 | RLS refused | permission denied (append-only) | FK refused (log_entries) |
| payments, payment_lines | yes | 0 | RLS refused | UPDATE 0 | refused by a unique index or FK |
| payment_steps | yes | 0 | RLS refused | permission denied (append-only) | FK refused |
| payment_accounts, payment_refunds | yes | 0 | RLS refused | UPDATE 0 | FK refused |

What the refusals mean:
- "RLS refused" is `new row violates row-level security policy for table ...`.
- "FK refused" is `insert or update on table ... violates foreign key constraint`.
- Where a unique index fired before the FK could, a catalogue check covers the gap. Every table with `venue_id` has a composite FK `(tenant_id, venue_id) -> venues` (0 missing). No tenant table has an FK to a tenant parent that leaves out `tenant_id` (0 found).

**Guest lookup.** `guest_table_by_code_hash(<B's hash>)`, run as `restro_app` under A's tenant, returned B's table (state live). This is by design: a guest has no tenant, the function is the only bypass, and it returns only the table's public fields.

## 5. Journal and drift

- `_journal.json` has 43 entries with idx 0-42 and no gap. Every `.sql` and `meta/<n>_snapshot.json` file exists, `when` strictly increases, and the snapshot `prevId` chain is unbroken.
- `pnpm db:generate` printed "No schema changes, nothing to migrate". `git status --porcelain` was empty afterwards, so there was nothing to clean up.
- `snapdiff.mjs` compares the live catalogue with `0042_snapshot.json`. Columns, nullability, defaults, checks, FKs and indexes all match.
- `migrations-reverse/` holds only `0014`; 0028-0042 have no down migrations. I found no rule that requires them, so this is noted only.

## 6. Candidate rows

RR-A4-1 | high (if the hosted owner lacks BYPASSRLS, see RR-A4-3) | `packages/db/migrations/0029_table_code_hash.sql:14` (backfill, no NO FORCE wrap) and `:18` (check `tables_qr_code_complete`) | `packages/db/CLAUDE.md`: "a migration that updates or inserts rows in a tenant table wraps that statement in `NO FORCE ROW LEVEL SECURITY` before and `FORCE ROW LEVEL SECURITY` after". 0040's own header says "the owner of a hosted database has no BYPASSRLS" | If 0029 runs on a database whose owner has no BYPASSRLS while any `tables` row has a `qr_token`, then the `UPDATE` sets no hash and the next statement's check fails. The deploy's migration transaction aborts and the release cannot ship. | Pass 2: `ERROR: check constraint "tables_qr_code_complete" of relation "tables" is violated by some row`. As `rr_a4_owner`, the 0029 `UPDATE` gives `UPDATE 0`; after `alter table restro.tables no force row level security` it gives `UPDATE 4` | high (reproduced); whether staging and production are affected depends on RR-A4-3

RR-A4-2 | medium (same condition as RR-A4-1) | `packages/db/migrations/0037_night_report_sent.sql:6` (backfill, no wrap) | same rule as RR-A4-1 | If 0037 runs with an owner without BYPASSRLS while closed service days from the last ~3 days exist, then `report_sent_at` stays null. The worker (`apps/worker/src/jobs/service-day.ts:156`, window `NIGHT_REPORT_MAX_AGE_DAYS = 2` at line 129) then sends those nights' end-of-night reports again after deploy. | Pass 2: 0037 applied; `select count(*) from restro.service_days where report_sent_at is null and closed_at is not null` gives 3 (pass 1 gives 0) | high (reproduced); the impact is at most one repeated message per recent night

RR-A4-3 | high | `packages/db/tests/rls-guard.test.ts:207-208`, against `packages/db/CLAUDE.md` (Backfills), the 0040 header and #211 (the `0038` wrap) | rls-guard.test.ts: "the owner is `postgres`, which has BYPASSRLS". packages/db/CLAUDE.md: "On Supabase the owner has no BYPASSRLS" | The repo states both premises and tests neither. If the hosted owner has no BYPASSRLS, then `guest_table_by_code_hash` (SECURITY DEFINER over `tables`, whose RLS is forced) returns nothing, every QR scan finds no table, and RR-A4-1 and RR-A4-2 also happen. If the owner has BYPASSRLS, the wrap rule and #211 change nothing, and `rls-guard`'s expectation holds. | Pass 2: `select * from restro.guest_table_by_code_hash('<B hash>')` as `restro_app` gives 0 rows (pass 1 gives 1 row). `docs/runbooks/supabase-setup.md` query (7), `select rolsuper, rolbypassrls from pg_roles where rolname='postgres'`, has no recorded result. `docs/deliverables/2026-10-20-guest-api-second-opinion.md` advised "Test with the same owner attributes in CI"; this was never done | high that the contradiction exists; the real staging value is unknown

RR-A4-4 | low | `packages/db/src/table-access.ts:108` (`assets: ... purge: PURGED`) against `apps/worker/src/jobs/purge.ts` | D83: "erasing venue data or anything in bulk is the purge job's alone, through `restro_purge`" | If an organisation is purged while it has photo assets, then its `assets` rows (and the storage keys they point to) stay behind. The purge role holds DELETE on `assets`, but no purge path deletes from it, so the grant is also an unused privilege. | `purge.ts` has no delete on `assets`. `assets` has no `venue_id` (it is an organisation-level store). This pre-dates 0028 | medium (the job may use another path I did not find)

## 7. Observations

- **Unique indexes without `tenant_id` on new tables:**
  - `bars (venue_id, source_key)`
  - `sent_orders (venue_id, service_date, reference)`
  - `venue_roles (venue_id, default_kind)`
  - `payments (handle_hash)` and `(provider_kind, provider_payment_ref)`
  - `payment_accounts (provider_kind, account_ref)`
  - `tables (qr_code_hash)` and `(qr_token)`

  A unique-violation error, where an RLS error would otherwise come, tells the caller that a row exists (one bit). Only someone who already knows another organisation's venue id or provider reference can use it. For A7.
- 0040 (line 30) also closes the lines of payments in states `closed` and `unconfirmed`. Closing `unconfirmed` lines is a product judgement, for A6.
- Between `db:migrate` and `db:roles` the new tables have no app grants. This is by design, so the deploy must keep the two steps together.
- PUBLIC keeps the Postgres default TEMP and CONNECT on the database. This breaks no rule; least privilege would revoke TEMP.
- The dev seed has one organisation and no floor tables or service rows, so no repository test runs the 0028-0042 backfills on data. Every backfill above was checked on synthetic rows only.
- CI runs migrations as a superuser owner (`packages/db/CLAUDE.md`: "no test sees the difference"). Bugs like RR-A4-1 and RR-A4-2 are therefore invisible to CI by construction.

## 8. Not covered

- **The real role attributes of the hosted `postgres` owner.** Checking them needs a remote database, which this task forbids. They decide whether RR-A4-1, RR-A4-2 and the guest-lookup failure are live. **Stop-and-ask, with a recommendation:**
  1. Martin runs runbook query (7) on staging once and records the answer.
  2. A CI job replays the migrations as a `nosuperuser nobypassrls` owner, as the 10-20 second opinion advised.
- The seed as it was at 0027: I used today's seed and copied the 0027 columns.
- Deeper attacks on the SECURITY DEFINER function and on the indexes that reveal existence (A7's scope).
- Collation: CI's Postgres uses `en_US`, the local one uses `C`; the replays ran on `C` only.
