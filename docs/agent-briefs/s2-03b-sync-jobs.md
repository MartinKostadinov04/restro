# Brief S2-03b: barsy sync jobs (worker) + writers + web job producer

- **Model:** Sonnet 5.5. The hard rules are already done and tested by S2-03a: sealing, `setLinkState`, `onlyIfUnplaced`, `concludeFullPull`. This task wires them together. If something in them looks wrong, **stop and ask**; don't change their semantics.
- **Branch:** your worktree branch from `s2/composer`.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/tracker.md` → D41, D50, D55, D56, D57, research facts "barsy API — verified", and the Stage 2 engineering notes (the worker bullets: one replica, drain);
  - `docs/architecture/data-architecture.md` → "Collection path C" (the full pull, steps 1–9), "Collection path E" (cursor rules), "Link lifecycle", "Failure modes and guarantees";
  - `packages/barsy/src/read/*` and `packages/barsy/src/mapping/*` (S2-02);
  - `packages/core/src/seal/*`, `packages/core/src/sync/*` and `packages/core/src/apply/*` (S2-01, S2-03a, S2-06a/b);
  - `packages/assets` (the asset store, moved out of the web app by S2-03c);
  - `apps/worker/src/*`, especially `registry.ts`, `jobs/*`, `config.ts` and `shutdown.ts`.

## Facts (lead-checked)
- **Incremental filter:** the official guide ([Изтегляне на артикули](https://docs.lukanet.com/barsy.api/integrations/20-articles.html), example 1) sends `filters: { last_update: '>' + 'YYYY-MM-DD HH:mm:ss' }` and stores the time of the last successful run.
  - Timestamps carry no offset, so we assume venue-local time (Q60, open).
  - Our cursor is therefore *previous successful run start (Europe/Sofia) − 65 minutes*. The overlap covers clock skew and DST; unchanged hashes make it free.
  - **Never** use the guide's example 2 (`all_last_update = -1` + `ArticleDetails_setDetailValue`): it writes into barsy (rule 7).
- **Deleted articles** never appear in lists (the `delete_flag` filter defaults to 0). Only a complete full pull concludes absence (rule 6, `concludeFullPull`).
- **Time limit:** 30 s per call. At most **2** concurrent requests per installation, and prefer multi-method requests for supplements.
- **Photos:** `picture_url` is on the integration's own host (`/endpoints/res/files_get?…`).

## Decisions from S2-02's report (binding)
- **Chunking:** never split one node's ops across two chunks; `onlyIfUnplaced` counts only placements that existed before the change set. Keep the dependency order: sections, then items with their placements, then groups, then options. Each chunk gets its own `newId('cs')`; the mapper's change-set id is deterministic and must not be reused per chunk.
- **Source records are content-addressed.** The id hashes the content, so insert with `on conflict do nothing`. **Recency** comes from `source_links.last_hash` (set via `setLinkState` `hash`/`seenAt`), never from `source_records`: an A → B → A change reuses record A.
- **`mapCatalogue` input** needs `menuId` (the menu root node id).
- **`linkStates`** lists every mapped link as `active` (the "seen" set for `concludeFullPull`) plus `deleted` for `delete_flag`.
- **Reuse S2-06a's writers:** `provisionIntegration` and `recordSource` exist in `packages/core/src/apply/sources.ts`. Extend or rename them; never add a second pair.
- **barsy state lives in link state only.** The sync never writes a section's or item's `status`; that belongs to the manager (hide/show in the composer).
- **No TypeScript parameter properties** in code the dev seed or scripts load: Node's type stripping cannot run them.
- **`ARTICLES_ORDER_BY`** uses the object form `{cat_weight_deep: 'asc', article_id: 'asc'}`. The lead confirms it on the next recording.

## Do
1. **Writers in `packages/core/src/apply/`** (the only place allowed the write side of `db`), each with an integration test:
   - `createIntegration` / `updateIntegration` (host, `credentials_sealed`, `config`, status + detail, `last_checked_at`);
   - `appendSourceRecords` (append-only; skips a record whose `(integration, type, external_id, hash)` equals the latest one);
   - `upsertBarsyVenues`;
   - `upsertPlaces` (from `mapPlaces`; absent places use the same rule-6 conclusion);
   - `startJobRun` / `finishJobRun` (status, counters, `error_summary` without query strings or credentials, and the **refused writes** copied from `ApplyResult`);
   - the sync cursor per venue: a column or `config` key, your choice, explained in the report. It advances only after a successful run.
2. **Sync context (worker):** `withIntegration(integrationId, fn)` loads the row and opens the credentials.
   - Uses `openBarsyCredentials` with AAD = tenant, integration and host.
   - Builds the barsy client for **that host only**. The host must be `https:` and match the allowed suffixes in worker config `BARSY_ALLOWED_HOST_SUFFIXES` (default `.barsyonline.com`). Staging (`BARSY_ENV != production`) refuses hosts listed in `BARSY_PRODUCTION_HOSTS` (rule 9).
   - A per-installation concurrency limiter (2).
3. **Jobs** (pg-boss, registered in `registry.ts`; `singletonKey` = integration id so two pulls of one integration never overlap; incremental is skipped while a full pull runs):
   - **`barsy-connect` `{integrationId}`:**
     - `Misc_ping` then `Misc_ping_user`. A 401 sets status `error`, with the detail "Wrong user or password" (from the recorded 401 shape).
     - Then `Barsys_getlist`, `Languages_getlist`, `Currencies_getlist`, `Articledetails_gettree` and the public tree. Store source records, venues, and the cached tree in `config` for the catalogue-root picker (S2-05).
     - Status `connected`.
   - **`barsy-full-pull` `{integrationId, venueId}`** (path C, steps 1–9):
     - **Fetch:** tree (`only_public: 1`), articles paged by the S2-02 wrapper (start `length` 500, **halve on timeout or 30 s error down to 25**, and on the third failure at 25 mark the page failed and continue), supplements for combo articles (multi-method, chunks of 10), modificators (paged at 50).
     - **Map:** `mapCatalogue`, then `apply()` in chunks of ≤ 200 ops, all tagged with the job id.
     - **Record:** source records for changed records only, `setLinkState` with `seenAt`/`hash` for every seen link, then `concludeFullPull` → `setLinkState` changes. Skip the conclusion when any page failed, and say so in the job run.
     - **Then:** queue `asset-fetch` for new or changed pictures, finish the job run with counters (categories/articles seen, created, updated, unchanged, missing, deleted, reactivated, failed pages, refused writes), and update the tree hash.
   - **`barsy-incremental` `{integrationId, venueId}`:**
     - Fetch the public tree and hash it. If the hash differs from the stored one, enqueue a full pull and stop.
     - Otherwise `Articles_getlist` with the same filters plus `last_update` > cursor (add an optional `lastUpdateAfter` to the S2-02 wrapper), then supplements for changed combos, map, and `apply()`.
     - **Never** concludes missing or deleted. Advances the cursor on success.
   - **`asset-fetch` `{integrationId, articleExternalId, pictureName, url}`:**
     - Download only if `new URL(url).origin === integration host origin` (SSRF guard), with Basic auth if the host requires it. Record what you saw in the report.
     - Image only (jpeg/png/webp by magic bytes), ≤ 10 MB, 20 s timeout.
     - Checksum dedupe: the same bytes reuse the existing asset.
     - `put` to the asset store, `createAsset`, then write the item's `image` field in the **barsy** layer `{asset_id}` through `apply()`. The manual photo still wins by the template's combinator; don't change the combinator.
     - Retries: 3, with backoff.
   - **Schedules (pg-boss `schedule`, tz Europe/Sofia):**
     - a tick every 5 min enqueues `barsy-incremental` for every `connected` integration with a venue and catalogue root;
     - the full pull daily at 12:00 local (D50/P31).
     - The tick reads integrations through `withSystem` (check how S1-03 scoped it), never with the owner role.
4. **Web producer** (`apps/web/src/server/jobs.ts`): `enqueueJob(name, data)` via pg-boss `send` (producer only, no `work`), used later by S2-05's "Connect" and "Sync now".
   - `apps/web` never imports `@restro/barsy` (dependency-cruiser already enforces this).
   - Job names and payload Zod schemas live in a small shared module (`packages/core/src/jobs.ts`) so both sides agree.

## Tests
- **MSW + demo fixtures, no network:**
  - connect: success, and 401 → `error`;
  - full pull: fixture counts; a second pull is all no-ops (hashes); one failing page → no missing/deleted, and the job run says "deletion check skipped";
  - absence: remove article 11 from the fixture → its link `missing`, node hidden by the resolver, enrichment kept; put it back → `active`;
  - incremental: a price changed in a fixture copy → the new minor price after one run; the cursor advances only on success; a tree hash change → a full pull is enqueued;
  - asset-fetch: same-origin succeeds; a foreign origin is refused; non-image is refused; duplicate bytes reuse the asset;
  - refused writes appear in `job_runs`.
- **Integration tests** on local Postgres.

## Done when
- The full gate passes with DB tests (`CI=true`).
- One manual run of the worker against local Postgres + MSW is described in the report: which commands, what you saw.

## Allowed dependencies
- `pg-boss` in `apps/web`, at exactly the worker's version.
- Nothing else without asking.

## Never / scope
- **Scope:** `apps/worker/**`, `packages/core/src/apply/**` (writers), `packages/core/src/jobs.ts`, `packages/barsy/src/read/*` (the `lastUpdateAfter` option only), `apps/web/src/server/jobs.ts`, `.env.example`.
- **Not in scope:** no Integration UI (S2-05), no barsy writes, no webhooks.
- **No network:** don't call the real barsy (MSW only), and never read `E:\Restro\.env.local`.
- **Logs:** never put credentials, keys or full URLs with query strings in logs or job runs.
- **Local DB:** `pnpm db:local` on port 54329. If the port is busy, reuse that instance with your own database `restro_s2_03b`. Stop only your own instance.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`.
