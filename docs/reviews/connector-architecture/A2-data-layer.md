# A2: Data layer, readiness for a multi-connector architecture

Reviewer A2 · read-only · 2026-10-11 · `E:\Restro` · paths relative to the repo root. **Fact** = seen in code. **Inference** = my reading.

**Scope change applied (lead, 10-11).** The spreadsheet path is out. Layers become `till`, `manual`, `override`, `edition:*`. I dropped every spreadsheet-only item. Two consequences:
- A1's `integrations.role` is unnecessary, because every connection is a till.
- "One till per venue" and "one till link per node" become plain unique constraints (see A2-P5).

## 1. Scope read

- **Docs:** CLAUDE.md; tracker D38–D64 and T47–T69 (T50, T62, T66–T69 in detail); data-architecture "Collection paths", "Identity and linking", "Layers, ownership and resolution" and "Outbound"; A1, A3 and R0.
- **Database:** `packages/db/src/{schema,table-access,index,write/index}.ts`; migrations 0000–0013 (SQL read; meta snapshots not opened); the `rls-guard` test; `scripts/roles.ts` (listed, not read).
- **Core:** `apply/{barsy-venues,tables,sources,sync-config,job-runs}.ts`, with `provision.ts`, `jobs.ts`, `sync-settings.ts` and parts of `apply.ts` and `publish.ts`.
- **Consumers:** `apps/worker/src/sync/{data,run}.ts`, `jobs/barsy.ts:495-570` and `apps/web/.../integration/service.ts`, read for call patterns. Barsy mapping ids and config are grep-level only.
- **Not done:** I ran nothing and opened no `.env*` file.

## 2. Scorecard

| # | Part | Rating | Evidence |
|---|---|---|---|
| 1 | Own model | 2 | The document tables are neutral. Tables and halls are barsy rows: `places` has no venue and no hall row (`schema.ts:779-825`). |
| 2 | Connector plug (data) | 1 | `integrations_kind in ('barsy')` (`:325`), `host` NOT NULL (`:313`), no capabilities column. |
| 3 | Stages | 2 | Tier 1 is append-only and hashed (`:487-525`). Rejected writes are kept (`valid=false`, `:597`). There is no quarantine and no run or location on `source_records`. |
| 4 | Own ids, theirs as links | 3 menu, 1 tables | `source_links` is neutral (`:528-570`). `bid` and `place_id` sit inside `places` (`:787-789`). |
| 5 | Connections ↔ venues | 2 | Organisation-owned `integrations`; `unique(venue_id)` already says one location, one venue (`:356`). Barsy names; int `bid`; the unmapped state has no lifecycle. |
| 6 | Sync engine (data side) | 1 | State and the tree cache are jsonb keyed by `bid` on the connection row (`sync-config.ts:21-67`). No location unit. |
| 7 | Write-back | 0 | No outbox or inbox table. This is expected before Stage 4. |
| 8 | Contracts | 2 | `mapping_version` per row is enforced (`:639-643`). `config.mapping_version` is declared but never read (`:293`). No extras field on tables. |
| – | Tenancy / RLS | 4 | Every tenant table has FORCE RLS and composite foreign keys. `rls-guard.test.ts` and `TABLE_ACCESS` fail on any omission. |
| – | Secrets | 3 | One sealed envelope per connection (`:314`). |
| – | Observability | 2 | `job_runs` has no location column (`:749`). |
| – | UI by capability | 0 | Nothing stored; the web picks `kind = 'barsy'` (`web/.../service.ts:149`). |

**Classification of every table**
- **Neutral:** tenants, venues, templates, worker_heartbeats, the 7 auth tables, nodes, menus, placements, snapshots, publish_pointers, item_first_published, tags.
- **Mixed (neutral shape, barsy words in checks or columns):**
  - `field_values`, `events` (layer and source checks).
  - `integrations` (kind check, host, config bag).
  - `source_links`, `source_records`: neutral, but they have no location.
  - `job_runs`: no location column, `barsy_*` kinds.
  - `assets`: origin check.
- **Barsy-shaped:** `barsy_venues`, `places`.

## 3. Findings

| Id | Severity | F/I | Where | Why it matters |
|---|---|---|---|---|
| A2-F1 | blocker | Fact | `schema.ts:332-368`, `barsy-venues.ts:35-126` | The only location table has an integer `bid` and `catalogue_root_cat_id integer`. Another till's text ids, or a root of another shape, do not fit. |
| A2-F2 | blocker (till X tables); significant (D64) | Fact | `schema.ts:786-787,807-811`; `tables.ts:121-129,146-153,186-194,218-222,345-352` | `places` has no `venue_id`. A table reaches its venue through a join to `barsy_venues` in 5 queries, so a hand-made table is impossible. A hall is a text `salon_name` (`:791`). `salon_id` and `place_type` are not stored (T66). |
| A2-F3 | blocker | Fact | `schema.ts:313,325`; `sources.ts:19,99-103` | The kind check and `IntegrationKind` are 'barsy'. "One per host" exists only in app code (`createIntegration`, and `host_in_use` in `web/.../service.ts:480`). |
| A2-F4 | significant | Fact | `schema.ts:285-299,318,327`; `sources.ts:122,158-174`; `catalogue.ts:140-151` | `config` is checked only as "is an object". It mixes four concerns: per-kind options (`price_source`, `allergen_detail_key`, `default_locale`), a common schedule, venue-level publish policy, and per-`bid` state plus a cached tree. `updateIntegration` accepts any key. |
| A2-F5 | blocker (T50) | Fact + Inference | `schema.ts:549-552`; `data.ts:85-92`; `catalogue.ts:167` | The link key has no location, and `readLinks` reads every link of the integration. A category link is the bare `cat_id`. **Inference:** two venues on overlapping roots share one section node, and a section has only one `parent_id` (`:383`). Node ids hash (integration, type, external id, parent) (`barsy/mapping/ids.ts`), so rewriting external ids in place orphans nodes. |
| A2-F6 | significant | Fact | `schema.ts:554,602-605` | A node may hold one link per integration, so two tills could both link it. The `field_values` key has no source, so they would overwrite each other. Same as A1-F4. |
| A2-F7 | significant | Fact | `schema.ts:749`; `worker/sync/run.ts:65-70`; `data.ts:182`; `web/.../format.ts:64` | Pulls are per venue (`core/jobs.ts:111-124`) but a run records only its integration. Per-location health cannot be queried. Kinds are an open pattern (`:768`), which is good. |
| A2-F8 | significant | Fact | `sync-config.ts:136-217`; `venues.settings` (`schema.ts:60`) | Publish policy (`after_sync`, `new_items`, `auto_paused`) is stored on the connection. A venue with no till has nowhere to keep it. D59 says "per venue". |
| A2-F9 | minor | Fact + Inference | `barsy-venues.ts:293`; trigger `places_touch_updated_at` (0004) | `updated_at` stands in for the state clock, and the trigger bumps it on any update. **Inference:** renaming a missing table restarts its 7-day grace period (T58). |
| A2-F10 | minor | Fact | `table-access.ts:61`; `schema.ts:326`; `web/.../service.ts:143-150` | The comment says "disable instead" but there is no disabled status. The web loads "the" barsy connection with `limit(1)`. |
| A2-F11 | minor | Fact | `schema.ts:866` | `assets_origin in ('upload','barsy')`. |
| A2-F12 | minor | Fact | `job-runs.ts:107-125`; `schema.ts:487-525` | Translate warnings exist only as text in `job_runs.details`. There is no location or run column on `source_records`, no retention, and no quarantine table. |
| A2-F13 | blocker | Fact | `schema.ts:619,622,627-642,718,721`; 0003 | A1's 7 checks, confirmed. Constraint names also contain "barsy" and need renaming. |

## 4. Walk-throughs

**(a) Second till "X"** (locations, products, per-location prices, availability, tables, webhooks, order API). Objects that change:

| Object | Change |
|---|---|
| `integrations` | `integrations_kind` becomes a pattern. Add the capabilities column. Add the `disabled` status. `host` becomes nullable only when X needs it (Mistral docs are unknown). |
| `barsy_venues` | Becomes `connection_locations` (text external id, a `scope` jsonb in place of the integer catalogue root). `barsy_venues_pkey`, `_tenant_id_integration_id_bid_unique` and `_integration_fk` are replaced. `unique(venue_id)` stays. |
| `places` | `places_barsy_venue_fk` and `places_integration_id_bid_place_id_unique` are replaced by (`location_id`, `external_id`) plus a direct `venue_id`. |
| `source_links` | Primary key unchanged. `unique(node_id, integration_id)` becomes `unique(node_id)`. Location-wide types prefix the external id (A2-P5). |
| `field_values`, `events` | A1's 7 checks. Per-location prices already work: location → venue is 1:1, and scope is `venue:<vn_>`. |
| `assets`, `job_runs` | `assets_origin` becomes 'upload'\|'connector'. `job_runs` gains `location_id`. |
| Webhooks | New `webhook_inbox`. The URL must carry tenant and connection (`hooks/<tn>/<in>/…`), because RLS hides the connection until a tenant is set. |
| Order API | A new `commands` table at Stage 4. It points at `places` and `connection_locations`. |
| RLS | Each new table gets `restro.enable_tenant_rls`, composite `(tenant_id, x)` foreign keys, and a `TABLE_ACCESS` entry. No existing policy changes. |

**(b) Venue with no till**
- **Works today:** the venue, its menu, and manual items, flags and sold-out (A1).
- **Broken today:** tables and QR (F2), the Publish tab's auto/manual policy and rollback pause (F8), halls.
- **After this plan:**
  - A venue with no till is a venue with zero `connection_locations` rows. Nothing else is needed.
  - Tables are created with `venue_id` and null `location_id`.
  - Publish policy lives on the venue.

## 5. Proposed adjustments

### 5.1 Neutral schema sketch (no SQL)

- **venues:** unchanged. `settings` gains `publish` (`after_sync`, `new_items`, `auto_paused`) and `tables.code_kinds`.
- **integrations** (name kept):
  - Existing columns, with the kind pattern and `host` as above.
  - New: `status` gains `disabled`; `capabilities text[]` (granted, written by the worker at connect); `mapping_version int`; `schedule jsonb` (common to all polling kinds, moved out of `config`).
  - `config jsonb` holds per-kind options only, validated by the kind's Zod on write.
- **connection_locations:**
  - Columns: `id` (`lc_`, new id kind), `tenant_id`, `connection_id`, `external_id text`, `name`, `venue_id null`, `scope jsonb null` (null means "not chosen, not synced"), `state` (active|missing|removed), `last_seen_at`.
  - Constraints: unique (`connection_id`, `external_id`), `unique(venue_id)`, unique (`tenant_id`, `id`).
- **location_sync_state** (1:1, written by the worker only): `cursor text` (opaque), `fingerprint`, four timestamps (full read, changes read, changes queued, full slot), `discovered jsonb` (the reduced category tree).
- **source_links:** unchanged except `unique(node_id)`.
- **source_records:** adds `location_id null`.
- **areas** (`ar_`, new id kind):
  - Columns: venue_id, name, `sort_key` (C collation), `location_id` + `external_id` (both null = hand-made), `state`, `state_changed_at`, `qr_enabled`, `extras jsonb`.
  - Constraints: unique (`location_id`, `external_id`); all-or-none check on the source reference.
- **places** (name, `tb_` ids and tokens kept):
  - New columns: `venue_id NOT NULL`, `area_id`, `location_id`, `external_id` (renamed from `place_id`), `kind` (ours), `state_changed_at`, `extras`.
  - `unique(tenant_id, id)` is added as a target for Stage 4 foreign keys.
  - Dropped: `integration_id`, `bid`, `salon_name`.
- **job_runs:** adds `location_id`. New kinds are neutral (`connect`, `full_read`, `changes`).
- **assets:** origin is 'upload' or 'connector'.
- **Reserved, not built before Stage 4 or the first push connector:** `commands` (outbox), `webhook_inbox`, `source_issues` (quarantine).

**Typed or jsonb**

| Item | Where | Why |
|---|---|---|
| kind, status, host, capabilities, mapping_version | typed columns | The engine and UI filter on them. |
| schedule | `schedule jsonb` | Read as one unit, never filtered in SQL. |
| price_source, allergen_detail_key, default_locale | `config jsonb` | Opaque to the engine. |
| cursor, fingerprint, timestamps | typed columns | The tick queries them. This also removes the `||` jsonb merge SQL. |
| catalogue root | `scope jsonb` | Per kind. |

### 5.2 Adjustments

| Id | What | Why | Size | Risk | Migr. | Depends | Tier | When |
|---|---|---|---|---|---|---|---|---|
| A2-P1 | Till rename (A1-P1), without the `import` layer: 7 checks, constraint names, `events` rewrite | F13 | L | rules 2, 5, 6 | y | none | Opus | First, before Stage 4 |
| A2-P2 | `integrations` expand: kind pattern, `disabled`, capabilities, mapping_version, `schedule` column. Strict per-kind Zod in `updateIntegration` | F3, F4, F10 | M | low | y (small) | P1 | Sonnet | Before |
| A2-P3 | `connection_locations` + `location_sync_state`. Rewrite `barsy-venues.ts` as `connection-locations.ts` (reuse `mapBarsyVenue`, `upsertBarsyVenues`) and `sync-config.ts` as `location-sync-state.ts` | F1, F4, F5 | L | rule 6, RLS | y | P2 | Opus | Before |
| A2-P4 | `areas`, direct `venue_id`, hand-made tables, `state_changed_at`. `tables.ts` loses its 5 joins; `upsertPlaces` gets an area step | F2, F9, T66 | L | tokens and stickers | y | P3 | Opus (migration), Sonnet (writers) | Before |
| A2-P5 | T50 at the data level: `unique(node_id)`; location-wide link types prefix the external id; conformance test of the prefix rule | F5, F6 | M | needs a re-sync | y (re-sync) | P3, A3-P4 | Opus | Before |
| A2-P6 | Publish policy to `venues.settings.publish`; reuse the atomic `storedPublish()` merge pattern | F8 | M | the Publish tab | y | none | Sonnet | Before |
| A2-P7 | `job_runs.location_id`, neutral run kinds, `assets.origin` | F7, F11 | S | the web `KNOWN_RUN_KINDS` | y | P3 | Sonnet | Before |
| A2-P8 | Contract migration: drop `barsy_venues`, old `places` columns and config keys | cleanup | S | lossy | y | after a soak | Sonnet | After P2–P7 |
| A2-P9 | Invariant tests (below) | part 8 | S | low | n | P4 | Sonnet | With P4 |
| A2-P10 | Design `commands`, `webhook_inbox`, `source_issues` | parts 3, 7 | S (design only) | none | n | none | Opus | At Stage 4 |

### 5.3 Migration plan (test data only: local DBs and Supabase staging)

**Rule:** expand, then backfill, then switch code, then contract. The additive steps are safe while old code runs. P1 and the code switch need the worker stopped and pg-boss drained. Staging needs Martin's OK (`RESTRO_DB_ALLOW_REMOTE=1`).

1. **0014, till rename (P1).**
   - Pre-check: no `import` rows exist (`layer='import'` or `source like 'import:%'` returns 0).
   - Take a `pg_dump`. Record the baseline counts.
   - Reverse: `0014_reverse`, tested on a copy of `restro_accept`.
2. **0015, expand (P2, P3, P4, P7).**
   - All additive.
   - Backfill `connection_locations` from `barsy_venues`: external_id = `bid::text`; scope = `{catalogue_root…}`; id = `lc_` plus 22 hex characters from `md5` (valid under the core's `isId`).
   - Backfill `location_sync_state` from `config.sync` and `config.catalogue_trees`. Move `config.schedule` to the new column.
   - Backfill `places`: `venue_id` from the join, `location_id` and `external_id` from `(integration_id, bid, place_id)`, `state_changed_at` = `updated_at`, `kind` = 'table', `area_id` left null (`salon_id` was never stored; the next full pull fills it).
   - Pre-flight: abort and list any `places` whose location has no venue; they cannot satisfy NOT NULL.
   - Reverse: drop the added objects.
3. **Code switch.** Web, worker and core move to the new tables in one release. `places.id` and `qr_token` are never rewritten, so the published `t/<token>.json` files stay valid.
4. **0016, T50 (P5) and publish policy (P6).**
   - Copy `config.publish` to each mapped venue's `settings.publish`.
   - Replace `unique(node_id, integration_id)` with `unique(node_id)`.
   - Barsy links change to the prefixed form through a mapping-version bump and a clean re-sync on a reset DB, not an in-place `UPDATE`.
5. **0017, contract (P8).** Drop the old objects. This is lossy, so take a dump immediately before.
   - Rollback: revert the code and restore the dump.

**Verification**
- Compare `md5(string_agg(id||qr_token order by id))` before and after, and the row counts.
- `places` with null `venue_id` returns 0.
- Locations match `barsy_venues` one for one.
- `config` has no moved keys left.
- A manual `publishMenu` returns `unchanged` for every menu.
- `/t/<token>` resolves for 3 sampled tokens.
- Full suite with `CI=true`; `rls-guard` and `app-role` pass.

**Invariants to test (P9)**
- A source-fed table's venue equals its location's venue.
- At most one link per node.
- At most one location per venue.

## 6. Keep as is

- The `restro.enable_tenant_rls` helper, `TABLE_ACCESS`, and the rls-guard and app-role tests. They are why tenancy rates 4.
- Composite `(tenant_id, x)` foreign keys, `FORCE RLS`, the read-only transaction split, and `@restro/db/write` reachable only from `core/apply`.
- Append-only `source_records` with content-hash ids. The `source_links` key and lifecycle. The `field_values` key and its provenance checks.
- `unique(venue_id)` on locations: it already means "one location → one venue, one till per venue".
- `places.qr_token` (globally unique, with format check), `tb_` ids, and `upsertPlaces`' scoping by location plus `concludeFullPull`.
- The snapshot immutability trigger and the touch-updated-at triggers.
- The table name `integrations` (see O2).
- Open-pattern `job_runs.kind`. Atomic jsonb merge, which survives for `venues.settings`.

## 7. Open questions

1. **Link scope for articles.**
   - Gap in A3's proposal: with connection-wide article links, one location's complete read never lists articles that only another location lists, so it cannot conclude absence per location. That needs a membership table with a row per article per location.
   - **Recommend:** make all till link types location-wide in v1 (one node per location and product). This is the simplest correct rule 6. It costs duplicated enrichment between venues on one installation.
   - Martin should confirm that cost.
2. **Rename `integrations` to `connections`?**
   - **Recommend: no.** R0's `venue_source_links` is already `connection_locations.venue_id`. Only one till per venue exists, so a separate link table adds nothing.
   - The rename would touch 5 foreign-key columns and the `in_` prefix, which is baked into the sealed-credential AAD and into stored `till:in_…` sources. It brings no user benefit; "connection" stays UI wording.
3. **Publish policy.** I side with A1 and D59 ("per venue"): all three keys on the venue. A3 keeps `new_items` on the connection, which would be wrong when one connection feeds several venues.
4. **Unmapping a location.** **Recommend:** keep its tables frozen and active, so stickers keep working. Refuse re-linking to a different venue while source-fed tables exist.
5. **`host` nullable and rotating secrets.** Defer both until Mistral documents exist. The AAD includes host, so use an empty value when null. Add a `connection_secrets` table only when a connector must rotate tokens.
6. **Schedule.** **Recommend:** keep it per connection (shared rate budget), interpreted in each venue's time zone (as `dueSyncs` does now).
7. **Retention of `source_records`.** No policy exists. Add "keep the last N versions per object" before staging grows.
8. **Wiping staging.** Does Martin allow it for the T50 re-sync, or should we rewrite in place?

## 8. Rules for the connector guide (data layer)

1. A connection is one tenant-owned `integrations` row with one sealed envelope. Per-kind options go in `config`, validated by the kind's schema on write.
2. Report locations with stable text ids. A person links each location to a venue. One location serves one venue.
3. Declare a link scope per external type. Location-wide types prefix the external id with the location, within 128 characters. Never rewrite the external id of an existing link: node ids derive from it.
4. Return tables and halls as descriptors (external id, number, hall reference, kind, public flag, extras). The engine owns the lifecycle and the tokens; a connector never generates a token.
5. The cursor is opaque text in `location_sync_state`. No other state goes in `config`.
6. No connector-specific tables or columns. Quirks go in the raw record or `extras`. Every new tenant table needs `tenant_id`, composite foreign keys, `enable_tenant_rls` and a `TABLE_ACCESS` entry.
7. External ids stay in links, source records, and the source reference on `places` and `areas`. They never appear in snapshots, `venues.settings` or run notes.
8. Run kinds are neutral. Every run records the connection and the location.

### Critical Files for Implementation
- E:\Restro\packages\db\src\schema.ts
- E:\Restro\packages\db\src\table-access.ts
- E:\Restro\packages\core\src\apply\barsy-venues.ts
- E:\Restro\packages\core\src\apply\tables.ts
- E:\Restro\packages\core\src\apply\sync-config.ts
