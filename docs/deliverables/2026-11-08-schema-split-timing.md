# Should D103's schema split happen before the reservations tables? (independent opinion, 11-08)

> **Lead's correction, 11-08, after checking the migrations: one load-bearing fact below is wrong.**
> This opinion states that `payments` has a single foreign key (`tenant_id → tenants.id`) and that D103's no-foreign-key rule "is already true in `restro`". It is not true on the money side. `packages/db/migrations/0030_payment_tables.sql` gives `restro.payments` **seven** foreign keys, and six of them point into core tables: `venues`, `tables` (twice, including `payment_table_id`), `sittings`, `bars` and `sent_orders`. `payment_lines` and `payment_steps` add their own.
> So D103's clause "no foreign keys from events or money into the core except by id" is **already breached by merged code**, and a check written to D103's words would fail today rather than guard against drift. What holds is the guest-events half: `0045_guest_events.sql` has no foreign keys at all, matching D103's narrower per-workload sentence, which names only guest events as the thing that must be able to move.
> The recommendation below (reservation tables in `restro`; unbundle T85; write the check) is unaffected and matches what ticket #323 had already recorded. The reasoning for it is not: the check is not a formality over an already-satisfied rule, and the open question is now whether D103's money clause should be scoped to guest events or the payments foreign keys dropped. That decision is Martin's.

**Recommendation: no, and the framing is half wrong.** Create the reservation tables in `restro` with every other table — but do not file the split as "later", because the thing D103 actually asks for (guest events and money movable without touching the menu engine) is delivered by the no-foreign-key rule, which is already true in `restro` and is not delivered by a namespace. Unbundle T85: do the no-join check, the restore drill, the container image and the S3 module now, and demote the six-schema layout to a trigger-driven option, the same shape D103 already uses for the hosting move.

---

## The reasoning

### 1. The namespace is not the portability property; the absent foreign key is

D103's stated goal is precise: "separate Postgres schemas for the core, auth, jobs, guest events, money and bookings, **with no foreign keys from events or money into the core except by id**, so guest events and payments can move to their own instance or an edge ingest without touching the menu engine."

The clause after the comma is the load-bearing one, and it is already satisfied without the split:

- `packages/db/migrations/0045_guest_events.sql` creates `restro.guest_events` with **zero foreign keys**. `tenant_id` and `venue_id` are plain `text` with regex `CHECK`s (`~ '^tn_[0-9A-Za-z]+$'`, `~ '^vn_[0-9A-Za-z]+$'`), as are `table_id`, `sitting_id` and `node_id`. It is already an id-only island.
- `restro.payments` (`packages/db/src/schema.ts`) has exactly **one** foreign key, `tenant_id → tenants.id`; `venue_id`, `table_id`, `sitting_id`, `bar_id`, `sent_order_id` are all plain `text`.

A Postgres schema is a namespace, not a boundary: a foreign key and a join across schemas are entirely legal ([PostgreSQL docs, 5.10 Schemas](https://www.postgresql.org/docs/current/ddl-schemas.html) — schemas exist "to organize database objects into logical groups to make them more manageable", and cross-schema access is just a qualified name). So moving `guest_events` into a `guest_events` schema would neither create the id-only property nor protect it. Only a test protects it, and **that test does not exist yet** — T85 promises "a dependency or SQL check that events and money never join core tables except by id", and nothing in the repo implements it (no such rule in `.dependency-cruiser.cjs`, no such guard test).

That is the inversion at the heart of this: the cheap, valuable 20% of T85 is unwritten, and it is being blocked behind the expensive, near-cosmetic 80%.

### 2. Moving a table later is cheap in the database — I measured it

I probed this on the project's own local Postgres (port 54329), inside a transaction that I rolled back; nothing was left behind (verified: zero leftover schemas, zero leftover roles). Created a table in schema A with a `tenant_isolation` policy, `ENABLE` + `FORCE ROW LEVEL SECURITY`, an index and table grants, then `ALTER TABLE ... SET SCHEMA`:

| What | After the move |
|---|---|
| `pg_policies` row for `tenant_isolation` | present, `schemaname = probe_b`, qual intact |
| `relrowsecurity` / `relforcerowsecurity` | both still `true` |
| index | followed the table into `probe_b` |
| `SELECT`/`INSERT` grants to the app-ish role | followed the table into `probe_b` |
| `has_schema_privilege(role, new_schema, 'USAGE')` | **`false`** |

So the one thing that does *not* follow is schema-level `USAGE` — exactly the three maps in `packages/db/src/table-access.ts` (`APP_SCHEMA_PRIVILEGES`, `PURGE_SCHEMA_PRIVILEGES`, `BACKUP_SCHEMA_PRIVILEGES`). This matches the docs: `SET SCHEMA` "moves the table into another schema. Associated indexes, constraints, and sequences owned by table columns are moved as well" ([ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)), and it is not among the forms that rewrite a table. Policies are keyed by `polrelid` in [`pg_policy`](https://www.postgresql.org/docs/current/catalog-pg-policy.html) and have no namespace of their own, so they live wherever their table lives — which is what the probe showed.

The feared cost of a later move ("rebuild every RLS policy, re-grant everything") is therefore not real. `guest_events`'s identity sequence `guest_events_seq_seq` is column-owned, so it moves too.

### 3. The real cost of the split is a code sweep, and it is dominated by tables that already exist

Counted in the working tree (`restro.<table>` as a literal in `.ts` and `.sql`, excluding `@restro/…` imports): **2,334 occurrences across 60 tables.** For the areas D103 would split out:

| Area | literals |
|---|---|
| money (`payments`, `payment_lines`, `payment_steps`, `payment_refunds`, `payment_accounts`, `provider_notices`) | 303 |
| auth (`auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_organization`, `auth_member`, `auth_invitation`) | 123 |
| jobs (`job_runs`) | 37 |
| guest events (`guest_events`) | 13 |
| **total** | **~476** |

Reservations will add roughly ten tables to a sixty-table sweep. The tracker's premise — do it now "so both prototypes land in their own schemas" — optimises the small end of the bill. Whether reservations lands before or after changes the sweep by a few per cent and changes nothing else.

### 4. Creating the reservation tables in `bookings` now is not the cheap option — it is the whole plumbing bill, paid for one area

This is the part the framing understates. "Create them in place now" sounds free. It is not, because the repo's guardrails are written around one schema:

- `packages/db/src/table-access.test.ts`: `it('puts every table in schema restro')` — asserts `table.schema === APP_SCHEMA` for every Drizzle export. A `bookings` schema means **loosening a guardrail** before the first reservation row exists. Under D67 that is a stop-and-ask, not a task step.
- `packages/db/scripts/roles.ts`: grants, revokes, scans for unlisted tables, checks ownership and checks routine grants **only in `APP_SCHEMA`** (schema-level privileges are already multi-schema via `ALL_SCHEMAS`, table-level ones are not). Tables outside `restro` would sit outside the unlisted-table check and the privilege audit — i.e. outside the tenant-isolation checks.
- `packages/db/tests/rls-guard.test.ts` hard-codes `p.schemaname = 'restro'` in its catalog queries, twice. Tables elsewhere would pass vacuously.
- `apps/worker/src/jobs/db-backup.ts`: `BACKUP_SCHEMAS = ['restro', 'drizzle']`, pinned by a test. A new schema fails that test until listed — a good tripwire, and one more thing to change.
- `apps/worker/src/jobs/purge.ts` names `restro.<table>` 29 times.

So the honest comparison is not "cheap now vs expensive later". It is **"pay the whole multi-schema plumbing bill now for one area that D103 does not even want moved, or pay it once later for all six"**. D103's reason sentence covers guest events and payments; `bookings` appears in the list with no stated benefit behind it. Reservations in their own schema buys nothing D103 names.

Ticket #323's "Blocked by" section already reaches this conclusion, citing the lead on 11-08 and a review on 11-07. I reached it independently from the code, and I agree with it — including its note that "if the split is ever done it moves every area at once, with `TABLE_ACCESS`, `roles.ts` and the role tests taught about schemas first."

### 5. Nothing is deployed, so expand-migrate-contract is not the cost — and that argues against the sequencing, not for it

Expand-migrate-contract exists because you cannot update an interface and all its consumers at once; the migrate phase "is the longest phase" precisely when external clients must keep working ([Fowler, ParallelChange](https://martinfowler.com/bliki/ParallelChange.html)). Fowler notes it is still useful when you control every usage — fair — but the expensive half is absent here: nothing is deployed, there is no Railway, staging holds test data only, and `packages/db/CLAUDE.md` already bars running migrations at a remote target without Martin's OK.

With no live data, the split is one migration (`CREATE SCHEMA` × 5, `ALTER TABLE … SET SCHEMA` × ~25, grants) plus the sweep plus the plumbing. No dual-write, no backfill, no cut-over. Which means the "do it before more tables exist" argument is the *weakest* argument available: the thing that makes it expensive is code volume, which grows slowly and is already large, not migration choreography, which is currently free. If anything, a no-production database is the argument for **deferring** it: there is no window to miss.

CI would survive it, mechanically. Migrations already create two schemas (`restro` in `0000`, `pgboss` in `0001`), and `.github/workflows/ci.yml`'s `migrations-hosted-owner` job replays them as a non-superuser owner with `BYPASSRLS` shaped like staging's. `roles.ts` fails loudly if a schema in a role's privilege map is missing, so the split cannot half-land.

### 6. Schema-per-area buys isolation only with a role per area, which Restro does not have and should not want

The practitioner case for schema-per-module is explicit about its condition: "isolation only holds if nothing bypasses it", so you need "separate database users per module, with permissions limited to each module's schema, so cross-module queries fail with a permission error" ([Jovanović, schema-per-module vs database-per-module](https://milanjovanovic.tech/blog/schema-per-module-vs-database-per-module)). The older pgsql-admin thread makes the same point from the security side: per-schema roles are simpler to reason about than fine-grained roles inside one schema, and the cross-schema cost is "mostly cosmetic" ([pgsql-admin, Schemas vs single database with prefixes](https://www.postgresql.org/message-id/871sa25nys.fsf%40gmail.com)).

Restro has three roles and they are deliberately cross-cutting: `restro_app` writes everything, `restro_purge` deletes across every venue table (D83), `restro_backup` reads everything with `BYPASSRLS` (D143). The write-path boundary is enforced *statically* instead — `packages/core/src/write-targets.test.ts` pins which tables `apply()` may name and which `applyService()` may name, and `.dependency-cruiser.cjs` keeps the write side of `db` out of everything but the write paths. That is a better fit for a six-package monorepo with one deployable than per-schema grants would be, and it already works.

A six-schema layout under one app role with `USAGE` on all six is a rename. Nobody would be prevented from anything.

### 7. The Supabase-specific motive for custom schemas does not apply here

On Supabase the usual reason to put tables outside `public` is to control what the auto-generated Data API serves ([Hardening the Data API](https://supabase.com/docs/guides/api/hardening-data-api), [Using custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas)). Restro has the Data API and anon keys switched off by D43/D103 and by the never-list, and everything already lives in `restro` rather than `public`. The host-specific argument is spent.

### 8. What a schema would genuinely buy, stated fairly

Two mechanical things, both at the moment of the move rather than before it:

- `pg_dump -n <schema>` extracts one area in one flag. Useful, but `pg_dump -t` takes table lists too, and `db-backup.ts` already passes `--schema=` per schema.
- `CREATE PUBLICATION … FOR TABLES IN SCHEMA guest_events` replicates the area "including tables created in the future", where a table list must be maintained by hand ([CREATE PUBLICATION](https://www.postgresql.org/docs/current/sql-createpublication.html)). This is the strongest pro-split fact I found — and the same page says `FOR TABLES IN SCHEMA` "require[s] the invoking user to be a superuser", which on Supabase Restro is not (D143 and the CI job both record that the hosted owner is `nosuperuser`). So the benefit is probably unreachable on the current host anyway. Flagged below as the one thing I could not settle.

Either way: both are one line of DDL **when the move happens**, which is also when the schema can be created. Neither needs the schema to exist a year early.

### 9. The risk that the split never happens, and what that costs

It is a real risk and mostly a benign one. If the six-schema layout never lands, Restro keeps 60-plus tables in `restro`, grouped by name (`payment_*`, `auth_*`, `guest_events`), with the module boundary enforced by the write-target guard. That is the ordinary shape of a modular monolith on Postgres and it is what the practitioner material describes as the sane starting point.

What would actually hurt if T85 never happens is the rest of it: no container image (the move stops being a redeploy), no tested restore from the R2 dumps (D103 promises "one restore drill before the first club goes live", and D143's whole point is that the dump exists — an untested restore is a dump, not a backup), and **no check that events and money stay join-free**, which is the one invariant that silently decays. One ticket that joins `payments` to `nodes` for a convenient report, and the portability D103 paid for is gone with nobody noticing. That decay is invisible; a missing namespace is not.

So the answer to "what if it never happens" is: make sure the parts that rot are not the parts bundled with the part that is merely tidy.

### What I would do differently

1. **#323 proceeds in `restro`.** No `bookings` schema, no guardrail loosened. (This is already what the ticket says; I confirm it independently.)
2. **Rewrite T85's row** to drop "before the song-requests port (T82), so both prototypes land in their own schemas". That clause is the whole sequencing claim and it does not survive contact with the code.
3. **Split T85 into two.** T85a, do now, small: the no-join check for events and money (a SQL/catalog test over `pg_constraint` plus a static check over the query sites — both areas pass today, so it only has to stay passing), the restore drill from the R2 dumps written up as a runbook, the container image, the S3 module. T85b, the six-schema layout, parked behind a trigger in D103's own style: an actual decision to move guest events to an edge ingest or money to its own instance. When that trigger fires, do all six areas in one change, teaching `TABLE_ACCESS`, `roles.ts`, `rls-guard.test.ts`, `BACKUP_SCHEMAS` and the purge job about schemas first.
4. **Amend D103** rather than quietly diverge from it. D103 currently reads as a commitment to six schemas, and two tickets have now shipped tables into `restro` against it (#335 by merging, #323 by deciding to). An unamended firm decision that the code contradicts is worse than either answer: it will be cited next time as "we were supposed to". The amendment is small — keep the no-FK rule as the binding part, make the schema layout conditional on a move actually being planned.

## What it costs if I am wrong

- **If guest events or payments must move sooner than expected** (a cost trigger, or Martin wanting the edge ingest at the first paying clubs): create the schema, `ALTER TABLE … SET SCHEMA` (verified cheap, policies and grants follow), grant `USAGE`, sweep 13 literals for `guest_events` or 303 for money, teach the five plumbing sites about schemas. Days, not weeks, and the hard part — no foreign keys into core — is already done. This is the main thing I am betting on and I think the bet is safe.
- **If continuous logical replication of guest events becomes the plan**, a per-schema publication would have been one line and auto-including; without it, the publication carries an explicit table list that someone must remember to extend. Mitigated by the superuser requirement above making it moot on Supabase, and by `guest_events` being a single table today.
- **If T85b is parked and then forgotten**, the cost is tidiness only — provided recommendation 3 actually lands the no-join check. If that check is also lost, I am wrong in a way that matters, because the invariant decays silently. That is why I would not simply say "do it later"; later is where this goes to die.
- **If I have underrated per-schema roles as a security story**, then a future "money is read by a separate reporting role" requirement would be easier with money in its own schema. I judge this unlikely before the pilot: D122, and decision 141 on the reservations branch, put the access model in permission keys and RLS, not in schema grants.

## Sources

Primary (PostgreSQL documentation):
- [5.10 Schemas](https://www.postgresql.org/docs/current/ddl-schemas.html) — what schemas are for; qualified names; `search_path` and its security warning.
- [ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) — `SET SCHEMA` moves indexes, constraints and column-owned sequences; not listed among rewriting forms; needs `CREATE` on the new schema.
- [`pg_policy`](https://www.postgresql.org/docs/current/catalog-pg-policy.html) — a policy is keyed by `polrelid` and has no namespace of its own.
- [CREATE PUBLICATION](https://www.postgresql.org/docs/current/sql-createpublication.html) — `FOR TABLES IN SCHEMA` covers future tables; requires superuser.

Practitioner sources:
- [Fowler, ParallelChange](https://martinfowler.com/bliki/ParallelChange.html) — expand/migrate/contract and what makes the migrate phase expensive.
- [Richardson, Database per service](https://microservices.io/patterns/data/database-per-service) — private tables, schema-per-service and server-per-service as three variants with different overheads.
- [Jovanović, Schema-per-module vs database-per-module](https://milanjovanovic.tech/blog/schema-per-module-vs-database-per-module) — schema-per-module as the starting point; isolation holds only with a user per module; the later move is largely configuration.
- [pgsql-admin, Schemas vs single database with prefixes](https://www.postgresql.org/message-id/871sa25nys.fsf%40gmail.com) — per-schema roles simpler than roles inside one schema; cross-schema cost "mostly cosmetic". One old thread; treat as anecdote.
- [Supabase: Hardening the Data API](https://supabase.com/docs/guides/api/hardening-data-api) and [Using custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas) — the host's own motive for custom schemas is Data API exposure, which Restro has off.

Repository evidence: `packages/db/migrations/0045_guest_events.sql`, `0000_foundation.sql`, `0001_tenant_rls.sql`, `0004_document_tables_rls.sql`; `packages/db/src/schema.ts`; `packages/db/src/table-access.ts` and `table-access.test.ts`; `packages/db/scripts/roles.ts`; `packages/db/tests/rls-guard.test.ts`; `apps/worker/src/jobs/db-backup.ts`, `purge.ts`; `packages/core/src/write-targets.test.ts`; `.github/workflows/ci.yml`; `docs/tracker.md` (T85); GitHub issues #321, #323.

Measured here: the `SET SCHEMA` probe in §2 (local Postgres on 54329, in a rolled-back transaction, nothing left behind) and the literal counts in §3.

## What I could not settle

1. **Can Restro's Supabase owner create `CREATE PUBLICATION … FOR TABLES IN SCHEMA` at all?** The docs say it needs superuser; D143 and CI record the hosted owner as `nosuperuser` with `BYPASSRLS`. *Best guess: no* — which removes the strongest mechanical argument for schemas. *What would answer it:* one `CREATE PUBLICATION … FOR TABLES IN SCHEMA pgboss` attempt on the staging database as the owner, which needs Martin's OK for a remote target; or Supabase support. Not worth doing until an edge ingest is actually on the table.
2. **Does any query today join `payments` or `guest_events` to a core table beyond an id?** I checked the schema (one FK, `payments.tenant_id → tenants.id`) but did not read all ~470 query sites. *Best guess: no, and `payments.tenant_id` is the only FK that would cross a prospective boundary.* *What would answer it:* writing T85a's check, which is the point.
3. **Whether `restro.enable_tenant_rls(regclass)` keeps working for a table in another schema.** It takes a `regclass` and uses `format('%s')`, so it should. *Best guess: yes.* *What would answer it:* one line in the migration that does the split, proven by the existing `rls-guard` test once that test stops hard-coding `schemaname = 'restro'`.
4. **Whether Martin wants the six schemas for a reason D103 does not record.** D103's reason sentence covers events and money only; `auth`, `jobs` and `bookings` are listed without one. *Best guess: the list was written for tidiness alongside the one real requirement.* *What would answer it:* `revisit-decision` on D103, reading the 10-17 grilling log — worth doing before amending D103 per recommendation 4.
