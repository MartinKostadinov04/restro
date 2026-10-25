# Restro — MVP tracker
_Last updated: 2026-10-08 (v15, kickoff with the lead coding agent)_

**Architecture source of truth:** [Menu Engine Data Architecture](https://claude.ai/code/artifact/2f2ab8b4-61ce-45a3-986b-bf675d8b472a) (doc) with tabs: **Data architecture** (data model, core rules, Barsy mapping, outbound outline, decisions checklist), **Stack** (runtime design, costs, repo, CI rule enforcement, jobs, environments, monitoring) and **Stage plan**. Repo mirrors: `docs/architecture/`. Precedence: official barsy docs > that doc > this tracker. This tracker (`docs/tracker.md` in the repo `E:\Restro`, GitHub `MartinKostadinov04/restro`, private) keeps decisions, conflicts, open questions and tasks.

## Current scope (10-08, kickoff)
- **10-21: ordering is open** (Martin, gate 2 of map #29; D79). The ordering and paying backend may now be built, on the stage branch `or/foundation`, from map #29's POS-neutral spec and tickets (D122). Code starts once those exist (gate 3). Until Mistral and myPOS answer, it is built and tested against the simulated POS and payment provider (#51). Still out: webhooks and POS registration (D41), any write to a live venue's POS (rule 7), and the Mistral connector itself until its answers arrive (#48).
- **Channel: QR → phone only** (D38). Two surfaces: **guest phone app** (menu now, ordering and payment later) and **venue admin** (composer, enrichment, tables & QR, publishing, settings, later stats and money).
- **Proof of concept on one venue**, built in stages (D39). Now: **Stage 1 — set up the ground** (repo, tooling, CLAUDE.md, document-model foundation, DB with RLS, admin shell, worker shell, barsy read client skeleton).
- Own waiter view — pending (only for venues without barsy, billed as a separate feature).

## Kickoff with the lead coding agent, 10-08
- Review of the doc against the **official barsy docs** (signed in): eight corrections, listed under Research facts → "barsy API — verified 10-08". Biggest: per-venue for-sale needs `limits_by_barsys`; full-pull paging must be sorted; deletions never appear in normal lists.
- Martin's direction: QR → phone only; one venue; barsy tables get generated QR codes; the barsy menu lands pre-mapped in a **composer** where things can be moved and enriched (images, description, attributes); basic PoC menu with the model's full flexibility; the Synex Platform repo is the reference for document → view engine, management and navigation; coding by Sonnet 5.5 subagents (Opus 5.5 for complex parts) with detailed briefs, questions flowing back to the lead and then to Martin.
- Platform review: the Platform has **no composer or layout document** (the ontology is the layout, frozen after creation), no QR generation, no draft/publish. Patterns to port and pitfalls to avoid: `docs/platform-reference.md`.

## Final review, 10-08 (independent second-agent review + own check)
- **Verdict:** the menu side is thorough (more than v0 needs); the ordering and money side is only an outline. Stack choices hold, with corrections now applied on the Stack tab (see D36).
- **Blockers before any ordering code:** (B1) no orders/payments data model or state machines → T29; (B2) the preferred payment route (barsy link) creates the bill *before* payment, which contradicts "prepaid" and lets a photographed QR code flood the POS with unpaid bills → Q55, P41; (B3) no live-night safety plan (menu-only fallback, alerts on stuck money, orphaned-order list) → T29, partly in the Stack tab already.
- **Major gaps:** service day past midnight (→ D45); table sessions/tab boundaries (in T29); split rules (P42); writes to live barsy needed for webhooks/POS registration vs rule 7 and D33 (P43, deferred by D41); abuse limits (now in the Stack tab); allergens on drinks and the V4 "food" scope (Q42; V4 now a warning, D42); sold-out source vs "no separate device" (→ D46); privacy roles, notices and retention (T31, Q67).
- Doc fixes applied: `account.uuid` = our server-generated order id (not the client's); `order_mode`/`ask_waiter` added to the snapshot and rule R11; outbound and failure-mode sections marked as outline with a pointer to T29; nine new items on the doc's decisions checklist.

## Decisions
Moved on 10-17: each decision is a file in `docs/decisions/D<n>.md` (full text, status, what it refines or supersedes); `docs/decisions.md` is the index. The rows that stood here until then are in the git history of this file.

## Engineering notes for Stage 2 (from Stage 1 agent reports, accepted by the lead 10-08)
- `apply()` passes node context to `validateWrite`: manual/import prices allowed only on items **not** linked to barsy (hand-made wine list); unlink copies barsy values into the manual layer.
- Add a `clearField {node, fieldKey, layer, scope}` op (revert override, take barsy's value, undo a builder hide).
- Placement ops accept a position hint `'end'`; adapters never compute sort keys themselves.
- The resolver hides nodes whose barsy link is `missing` or `deleted`, whatever their own status (rules 5, 6).
- Edition layers write only `all_true` flags for now (hide here, sold out tonight = `for_sale = false`).
- Add id kinds `jb` (job), `in` (integration), `us` (user), `sr` (source record).
- Casing: stored values and snapshots use snake_case (`amount_minor`); code-level config objects (field definitions, change sets) use camelCase.
- `placements.sort_key` needs `COLLATE "C"`; `value_hash` is SHA-256 (64 hex chars), not the doc's 8.
- Check real barsy `supplement_price` data for negative option deltas before allowing them.
- Specials: no fields in `venue-menu@1` yet; added when needed. Modifier-group `min ≤ max` checked at node level in the resolver.
- barsy client: record the real wrong-password response to learn the auth-error shape; one failing method inside a multi-method call is undocumented — record a real case.
- Database (from S1-03): the read side is a READ ONLY transaction, so every write goes through `core/apply` by construction; the app role has no DELETE on tenants/venues (archive instead); with the first Stage 2 child table add `unique (tenant_id, id)` and composite foreign keys `(tenant_id, venue_id)` (foreign-key checks bypass RLS).
- Worker (from S1-06): run exactly **one** worker replica until the heartbeat is per replica; Railway shutdown grace ≥ 30 s (pg-boss drains for 20 s); Railway healthcheck must tolerate ~2 s of 503 at start; check on `restro-staging` that the session pooler accepts `statement_timeout`/`idle_in_transaction_session_timeout` as startup parameters (else set them with `ALTER ROLE restro_app SET …` in `db:roles`). Small cleanup: declare `pg`, `@types/pg`, `drizzle-orm` as worker dependencies (drop the tsup `require` shim) and parse worker config with Zod.
- Admin (from S1-05): Inter font (Cyrillic; the Platform's Instrument Sans has none), self-hosted at build time; next-intl wired without its build plugin (its native `@swc/core` fails on this Windows build); sign-up, org create/delete, invite and member removal are disabled (operator tasks); Stage 2: self-heal a missing tenant row in `requireTenant`; later hardening: a separate DB role for the `auth_*` tables (the app role can read password hashes today); add date-fns + @date-fns/tz with the date editors. **Bulgarian interface wording needs Martin's review** (`apps/web/messages/bg.json`: "Композитор", "Заведения", "Начин на поръчка", allergen names such as "Ядки", "Мекотели").
- Resolver (from S2-04, merged 10-09): "visible" = active node, no missing/deleted link, `visible` not false, `order_mode` not hidden, no blocking issue, shown parents, placed in a shown section; `orderable` needs a **venue-scoped** barsy price, barsy `for_sale` = true, an active `article` link, `order_mode` orderable and satisfiable required modifier groups; allergen conflicts show the **union** of all layers' claims (cautious for guests); a missing barsy `for_sale` = not orderable. Open for Stage 3: badges (dietary labels + tags vs only "new"; "new" needs the publisher's first-published date) — ask Martin; D24 translation-review needs an acknowledgement in the review queue; edition id naming (`edition:venue:<id>`, `edition:service:<date>`).
- Document tables + `apply()` (from S2-01, merged 10-09): rule 2 enforced by database check constraints; `events` and `source_records` append-only; identity via `source_links`; unlink copies barsy values to `manual`, deletes the barsy rows and the link (overrides stay); menu id = its root node id. For S2-03: `apply()` returns refused writes in `ApplyResult` only → jobs must copy them into `job_runs`; add `setLinkState` (missing/deleted/active) and writers for integrations, source records, job runs, places. For S2-06: structural events (`op` column), `moveNode`, unplaced-items query, `createAsset` writer. Staging needs migrations 0003–0004 applied before the app runs there.
- Composer (from S2-06a/b, merged 10-09):
  - Hiding an item writes `visible = false` in the **manual** layer (master scope); showing clears that value. Sections have no `visible` field: hiding a section sets its node `status`. The sync never writes node status; barsy's hiding lives in link state and barsy-layer values only.
  - `apply()` gained `moveNode`, structural events (`events.op`) and `atomic` (one refused op refuses the whole set, used by drag moves).
  - The item sheet routes saves: builder-owned field → `manual`; barsy-owned overridable field → `override` with `basis`; a language barsy lacks → per-locale `manual` (D24); a linked item's price is refused ("Change this in barsy").
  - Photos: asset store local or R2 (`ASSET_STORE`), magic-byte checks, ≤ 10 MB, fields hold asset ids only; admin sees signed or presigned links.
  - Staging needs migration 0005 too.
- Sync jobs (from S2-03b, merged 10-09):
  - Jobs `barsy-connect`, `barsy-full-pull`, `barsy-incremental` and `asset-fetch`, plus pg-boss schedules: the incremental tick every 5 min and the full pull daily at 12:00, Europe/Sofia. Queues are exclusive per integration; payloads carry `tenantId` for RLS.
  - The cursor and tree hash live in the integration's `config.sync.<bid>`, and the cached trees in `config.catalogue_trees.<bid>`. The cursor is the previous complete run's start in venue time − 65 min.
  - Without SEAL keys the worker runs the heartbeat only. The web enqueues through `enqueueJob` (producer only).
  - Refused writes are in `job_runs` counters and `error_summary` text; S2-05 adds structured details.
  - **Demo catalogue:** the categories under root 1091 have no public titles, so the resolver blocks those sections. Use root **1171** for the acceptance run.
  - The ticks list tenants from `auth_organization` (organisation id = tenant id).
- Copilot review fixes (S2-08, merged 10-10):
  - **Pull lock:** a full pull and an incremental of one integration never overlap. A Postgres advisory lock per integration (`tryAdvisoryLock` in `@restro/db`, session pooler only) is held for the whole pull. A busy incremental is skipped; a busy full pull waits 60 s, then re-queues under a deferred key (pg-boss drops a same-key send from inside the running job).
  - **Pool cap:** a worker process holds at most `APP_POOL_MAX − 1` pull locks (1 today), so with two integrations an incremental of one skips while the other runs a full pull. Raise the connection budget when several integrations sync.
  - **Hung pull:** it keeps its lock until the process restarts (pg-boss expiry doesn't abort a handler). Watch it with the start-up sweep (T58).
  - **Photos:** a photo job re-checks the article's current record (via `source_links.last_hash`) before download and before write (else `obsolete`). A picture removed in barsy clears the barsy `image`.
- Publish core (S3-01a, merged 10-10):
  - **Snapshot schema:** strict `menu-snapshot/1` with cross-reference checks; tables `snapshots` (bodies immutable; only held → published/rejected), `publish_pointers` and `item_first_published`.
  - **Leak guard:** external ids and asset storage keys are always refused. An internal value or override basis is refused unless the same string is public anyway (e.g. allergen codes), which keeps real publishes possible.
  - **Badges** carry only `new` (lead, 10-10); dietary labels and tags have their own slots.
  - **Tags** are `tg_` ids from the venue vocabulary (S3-06).
  - **Sold out:** the service edition is `edition:service:<YYYY-MM-DD>` (S3-08 writes there). The live overlay marks every item whose resolved `for_sale` is false.
  - **Rollback** lasts until the next publish whose content differs: S3-05 pauses automatic publishing after a rollback.
- Publish files and jobs (S3-01b, merged 10-10):
  - **Store:** a publish store (local `.local/cdn` / R2 public bucket later) accepts only four path shapes. `/cdn/...` serves it with cache rules (immutable `snap/` and `a/`, 30 s `current.json`, 15 s `live.json`).
  - **Jobs:** `publish-menu` (auto publishes merged within 30 s; manual and auto on separate keys), `publish-files`, `publish-live` and `asset-variants`. The publish jobs are registered even without seal keys.
  - **Variants:** `sharp` 0.35.4 webp, named by real width (`w320`/`w640`/`w1280`, or the photo's own width when smaller).
  - **Holds:** older held publishes are superseded on success.
  - **Deploy:** `PUBLISH_STORE` is required in production, and the worker image needs sharp's platform binary.
- Sync settings (S3-04, merged 10-10):
  - **Tick:** one `barsy-sync-tick` every minute with a pure, DST-safe `dueSyncs`. The tick also records queued marks, so failed runs are not re-queued every minute.
  - **Settings:** `config.schedule` and `config.publish` (the old flat `publish_after_sync` is a fallback). "Hold new items" hides only items created by that run (manual `visible = false`, actor `system`, badge "Нов от barsy").
  - **Photos:** photos that arrive re-publish automatically **only for barsy photos** (a manager's upload waits for "Publish", per the publish policy).
  - **Missed daily pull:** the daily full pull is today's slot only; a pull missed while the worker was down is not caught up.
  - No date-fns in the repo: scheduling uses `Intl` like the rest of core.
- Guest phone page (S3-03, merged 10-10):
  - **Face and route:** the `qr-phone` face (passes the face contract on all fixtures) and `/m/<venue slug>`, which reads only `/cdn` files (`v/<slug>.json` → `current.json` → snapshot → `live.json`); a dependency rule forbids the database there.
  - **Table links:** `/t/<token>` redirects through `t/<token>.json` (no database) or shows "code not active".
  - **Venue theme:** brand colour + logo in Settings → Appearance (`venues.settings`, migration 0010; since SH-05a this is the Design tab). The palette is derived at publish time (`core/theme.ts`, no chroma-js) and reaches guests with the next publish.
  - **Slugs** were globally unique from S3-10 (T61) until CF-14. Since 10-11 the address is `/m/<slug>-<code>` (D68): the random code finds the venue, slugs are free and renamable. The snapshot carries no time zone or `sold_out_display` yet (shell defaults). `NEXT_PUBLIC_CDN_BASE_URL` must be absolute on staging.
- Tables and QR (S3-07, D61):
  - **Tab:** barsy tables by hall, an editable name per table (else barsy's number, shown as "Маса N"), "Create codes for all tables" (active tables, hidden ones included; a table with neither number nor name is skipped), "Create code" / "New code" / "Turn off code" (the last two ask first), PNG and SVG downloads (`/api/tables/<tb_>/qr`), and an A4 print sheet (`/venues/<id>/tables/print`, 2x3 cards, the browser's "Save as PDF").
  - **Tokens:** 22 base62 characters from `crypto`, no input, unique in the database; `places.label` and two checks (migration 0012). A table barsy concludes `deleted` loses its token in `upsertPlaces` (`retiredTokens`); `missing` keeps it.
  - **Files:** one worker job `publish-table-tokens {tenantId, venueId, retired}` (stately; key = venue + hash of the retired tokens) writes `t/<token>.json` for every active code and removes the retired ones; the web never writes the publish store. `PublishStore` has `delete` (local and R2). The sync queues the job after a full pull that renamed or deleted a table.
  - **Address:** `venues.settings.qr` = `{mode: ours|own, base_url?, own_pattern?}`; the default base is `PUBLIC_BASE_URL`, else `BETTER_AUTH_URL`. The venue's own link is only checked for its shape and opened by the manager's browser; the server never fetches it. The guide is shown in the admin at `/guides/qr-links` from the project's `docs/guides` folder (a deployment that does not ship `docs/` shows a notice).
  - **Open:** if the job cannot be queued after a change, the change is saved and the admin is warned ("queued: false"); a retired token whose job was lost keeps its file until the next full cleanup (no list operation on the store yet).
- Tags (S3-06, merged 10-10):
  - **Tag list:** a venue table `tags` (`tg_`, BG/EN label, colour token from `accent|accent_text|muted|text|border`, fractional order, archive not delete), migration 0011.
  - **In the composer:** a Tags panel with drag reorder, chips in the item sheet, multi-select bulk add/remove (one atomic change set), and a filter ("any of").
  - **Validation:** `apply()` refuses newly added unknown or archived tag ids (`unknown_tag`); ids already on an item are kept.
  - **Publishing:** the snapshot carries the vocabulary `{label, color?}`.
- Sold out tonight (S3-08):
  - **Write path:** owner/admin only. Marking is one atomic change set (`setSoldOutTonight` in core/apply) that sets `for_sale = false` in `edition:service:<service date>` (master scope, source `manual`, actor `user:<id>`); "Back on sale" is a `clearField` of that row, never a write of `true` (`validateWrite` refuses `true` on an edition layer: `less_cautious`). It can only remove OUR mark, so an item barsy has off sale stays off sale.
  - **Snapshots never hold marks:** `publishMenu` resolves the snapshot with the venue edition only (header `edition` is `["master", "venue:<vn>"]`, no `service:<date>`); only `live.json` is resolved with the service edition. A snapshot built at 23:00 has the same hash as one built at 08:00. Barsy's own off-sale flag is a base layer and stays in the snapshot. Doc fix: the header example in "Publishing and the snapshot contract" still lists `service:2026-10-08`.
  - **Rollover:** a mark lapses by itself (its layer is out of the resolver's edition list once the service day changes; the row stays as history). A new job `publish-live-tick` (every minute, Europe/Sofia, registered without sealing keys) remakes `live.json` for each published menu whose venue's service date changed since the tick last asked (memory per process: `last_live_service_date`; empty after a restart, so a restart asks once for every menu). It also asks every 10 minutes as a repair (a lost or failed `publish-live`). The barsy sync tick is not used because it only exists with the sealing keys. Marks need at most about a minute after 07:00 to leave `live.json`.
  - **Admin:** the composer and the item sheet now resolve with the live editions (tonight's marks count, earlier evenings' do not). Rows show "Изчерпано тази вечер" or "Не се продава в barsy"; the row menu, the "Изчерпани (N)" chip list and the sheet's sale card mark and unmark; an item barsy has off sale has no control anywhere.
  - **Open (small):** old `edition:service:<date>` rows are never deleted (one per marked item per evening; they are inert). A cleanup job can come later.
- Tables and QR (S3-07, merged 10-10):
  - **Codes:** opaque table codes (22 chars, never derived from barsy ids) and an optional label (migration 0012). Token files `t/<token>.json` have one writer, the worker job `publish-table-tokens`; `PublishStore.delete` was added.
  - **QR address:** our link (`PUBLIC_BASE_URL`, editable per venue) or the venue's own pattern with `{token}`, tested in the browser only.
  - **Printing:** an A4 print sheet (2×3, browser PDF); `qrcode` 1.5.4.
  - **Guide:** `docs/guides/qr-links.md`, also shown in the app.
- Sold out tonight (S3-08, merged 10-10):
  - **Marking:** `setSoldOutTonight` writes `for_sale = false` in `edition:service:<service date>` (never `true`; unmark = `clearField`) and queues `publish-live`.
  - **Snapshots** resolve with the venue edition only, so marks live only in `live.json`. A `publish-live-tick` (every minute, runs without seal keys) remakes `live.json` after the 07:00 rollover and repairs every 10 min.
  - **barsy off-sale items** get no "back on sale" anywhere.
  - **Doc fix to make:** the snapshot header example no longer lists `service:<date>`.
- **Staging (10-10, Martin's OK):**
  - Stage 2 migrations applied to Supabase `restro-staging` (8 migrations, 23 tables, forced RLS on all 15 tenant tables; `anon`/`authenticated` have no access to `restro`) and `restro_app` privileges synced.
  - Supabase's security advisor flags only its own `public.rls_auto_enable()` (an event-trigger function from the project's auto-RLS option, not ours; event-trigger functions cannot be called through the API). Hardening option: revoke `EXECUTE` from `anon`/`authenticated`.
- Dependencies approved by Martin 10-10: `sharp` (worker, photo variants), `qrcode` (QR images); the palette function is written in-house instead of `chroma-js`.
- Staging migrations: run by the deploy pipeline (Railway pre-deploy) once Railway exists; the one-off bootstrap of Supabase `restro-staging` runs from the lead's machine only with Martin's explicit OK (`RESTRO_DB_ALLOW_REMOTE=1`, runbook `docs/runbooks/supabase-setup.md`).
- **Doc fixes to apply in one pass at the end of Stage 1:** specials sit under the menu only (series never under many); Section hints are two fields `hint_color`/`hint_icon`; trace 4 writes `for_sale = false` (no `sold_out` field); price = `locked` + `never_when_orderable`; mapping-only fields (`slug`, Option `description`) to add to the template; scopes use our `vn_` ids, never a barsy `bid`; `value_hash` is SHA-256; refresh `docs/architecture/` mirrors from the live doc.

## Stage 2 acceptance run (local, real barsy demo, 10-10 ~02:45)
- **Setup:** local Postgres database `restro_accept` (seeded with `SEED_DEMO_MENU=0`), production build of the web app, the worker with a fresh sealing key pair (private key only in `.env.worker.local`), and photos stored in R2 `restro-assets-staging`.
- **1. Connect (pass):** the demo was connected through the Integration tab and showed "Connected" after 2 s; the connect run found 5 barsy venues and 11 languages. The web cannot open sealed credentials (tests + dependency rule).
- **2. Venue, catalogue, sync (pass):** "Bar & Dinner" + "Публично меню" → Sync now → run completed in 2 s: 54 articles, 8 categories, 54 created, 0 failed pages, 92 places, 52 photos queued.
- **3. Composer (pass):**
  - 8 sections in barsy order, BG names, € prices; BG + EN names and descriptions from barsy.
  - All 52 photos fetched into R2 and shown through presigned links.
  - Price locked ("Change this in barsy").
  - Allergens: the demo has no allergen text, so every item shows "Allergens not entered". Parsing of real allergen text is untested on data (unit tests only; T48).
- **4–5. Arrange and enrich:** covered by Playwright on the merged branch (23 passed); not repeated by hand on the demo data.
- **6. A barsy price change arrives within ~6 min:** the automatic incremental check ran on its own at 02:45 (tree unchanged, 0 changed articles). The price change itself needs Martin's demo admin login.
- **7–8. Deletion rule, tenant isolation, rule 5:** covered by tests (1,589 passing).

## Stage 3 acceptance run (local, real barsy demo, 10-10 ~18:15; Martin chose local now, staging at first deploy)
- **Setup:** acceptance database with the real demo menu (Публично меню, 51 visible items, photos in R2 with webp variants in the local publish folder); worker and production web build on the latest `s3/guest`.
- **Tags (pass):** created "Сезонно / Seasonal" and bulk-assigned it to the 8 "Летни предложения" items.
- **Sold out tonight (pass):** marked the eggplant dish from its row menu; no new version was made.
- **Publish (pass):** the Publish tab showed 9 waiting changes, and Publish made version 2 live in a few seconds.
- **Guest page on a phone viewport (pass):** sections in barsy order, the language from the browser (EN), € prices, photos, the "Seasonal" filter chip, the "Sold out" item greyed out, and "New" badges.
- **QR codes (pass):** created codes for all 92 barsy demo tables; `/t/<code>` redirected to the menu with the "Table 0" banner. The base address is this PC's network address (`http://192.168.50.113:3000`), so a phone on the same Wi-Fi can scan (the Windows firewall may need to allow port 3000).
- **Covered by automated tests only:** settings (interval, daily time, auto/manual publish, hold new items), rollback and pause, V10/V11 gates, the 07:00 rollover, rule 5 properties. 2,593 unit/integration tests and 83 browser tests pass.
- **Seen:** `/t/<code>` does not pass `?lang=` through to the menu (the browser language decides) — minor, T65.

## Conflicts between the Menu Engine doc and earlier decisions
- **C1. Build order vs D4/D2** — **resolved by D39.**
- **C2. Open-account rounds vs D5** — resolved on the product side (D5). barsy side open (Q21, Q47); recommendation P41.
- **C3. "For confirmation" vs D13** — replaced by D18 + research (Q38, Q49).
- **C4. barsy payment link vs Stripe Connect** — D19 (preference), pending Q39/Q55/Q58. Strategic notes: (a) if confirmation and payment both run through barsy's flows, Restro is a nicer front end on what barsy already sells (Q29); (b) barsy's link presumably pays the venue directly, so Restro could not take a per-transaction fee; only Stripe Connect allows one (P50).
- **C5. Commercial gate missing from the doc** — open (Q25, Q41).
- **C6. Allergen gate vs club menus** — eased by D42 (attribute, warning only) pending the Bulgarian legal check (D25, Q42).

## Proposals (pending Martin)
**Still open**
- P52. **Display price:** barsy's base price (`actual_price`) or the live current price. **Kept open (Martin, 10-08).** Both prices are stored raw; the mapping has a `price_source` switch (default `actual_price`), so deciding later costs a config change and a replay.
- P53. **Permanent QR short domain** (`/t/<token>` on a permanent domain). **Kept open (Martin, 10-08); refined by D61 (ours or the venue's own link)** — QR codes already resolve through `/t/<token>`; the domain must be chosen before any sticker is printed.
- P41. **Barsy bill model:** one barsy account per paid order (recommended) rather than rounds on one table account (Q21). Docs now show `Accounts_place` can create, pay and close in one call (payments accepted only on close).
- P42. **Split rules:** split by item / equal / custom, leftover cent, window expiry, and whether an order reaches the bar only when fully paid (recommended: yes).
- P43. **Writes to live barsy** allowlist — deferred to ordering by D41.
- P46. **Call waiter / request bill in v0:** only if barsy's API can message staff (Q48). `Messages_create` exists in the API; delivery to the hall team unverified.
- P48. **Deploy freeze:** no production deploys Thu–Sun 18:00–08:00 except fixes Martin approves (applied in the Stack tab; veto possible).
- P49. **What "EU hosting" means:** EU regions with data processing agreements (current: Railway Amsterdam, Supabase Frankfurt, Cloudflare, Sentry EU) or EU-headquartered vendors only.
- P-09. **barsy's per-venue `lang_id`** (`Barsys_getlist`, null in the demo) as the language of untagged till text, once the docs say what it means; until then that language is a barsy instance setting (D77, corrected 10-12). The P-0x items live in `docs/adjustments/adjustments_01.md` §4.
- P50. **Post-pilot revenue model:** SaaS fee billed to venues (works with barsy's link) or a per-transaction fee (needs Stripe Connect).

**Decided at kickoff:** P40 → D45; P44 → D46; P51/P30 → D39; P45, P47, P38, P39, P31 → D50 defaults (veto possible).

**Waiting on answers**
- P32. Idempotency for later rounds (only if rounds are used, Q21/Q40).
- P33. Price under pay-first with Stripe: authorise → `Accounts_place` → check `Accounts_get` total → capture; void on any failure (only if Stripe — D19).
- P37. Order identification on the bar ticket: `Accounts_place` offers `account_alias` (shown in account lists), `description` (printed on the receipt) and `notes` (not printed) — proposal: alias = "Restro #<short order no> <first name>"; what prints on the bar ticket still to confirm (Q52).
- P10. Pilot: Restro reimburses the barsy resource fee, or negotiates a waiver — once the price is known.

## Superseded / resolved proposals
- P13 → D23/D36. P34 → D33. P35/P36 → D24. P14–P16, P18–P20, P22–P29 → adopted into or replaced by the Menu Engine doc. P21 → P30/P51 → D39. P17 → D36 (pg-boss). P40 → D45. P44 → D46.
- Stack options not adopted: Clerk, Inngest as the main queue, Vercel, Bun runtime (cost, D35); PostHog (replaced by first-party events). Supabase was not adopted on 10-01 but **is adopted as the database only** at kickoff (D43).

## Open proposals carried over
- Payments P4–P9 (09-27): hold → post → capture; saga steps; Stripe Connect direct charges; "you were not charged" copy; nightly reconciliation; capture-on-delivered in reserve. **Apply only if Stripe is used (D19 fallback).** Saga/idempotent steps (P5) and nightly reconciliation (P8) apply either way.
- P11–P12 (10-01): per-venue credentials encrypted server-side (→ D50/P38); docs first, one paid hour last (gap list = T9).

## UI and front-end details (library choices made: Tailwind, shadcn/ui, react-hook-form + Zod, TanStack Table, Recharts, next-intl)
- U1. Visual design: guest phone flow (menu, item, modifiers, cart, checkout, split, order status, ask-your-waiter) and venue admin (composer, item sheet, translations, tables & QR, publishing, settings, later stats and money). Admin follows the Platform patterns (`docs/platform-reference.md`); Martin brings phone shells.
- U2. Font list for venue themes: Cyrillic-capable, self-hosted via next/font (no Google Fonts CDN — EU privacy); load only fonts in use.
- U3. Icons: lucide (ships with shadcn) + a set for the 14 EU allergens.
- U4. **Data fetching convention (D50):** admin = server components for reads, server actions that call `apply()` for writes; guest = static shell reading snapshots from the CDN (no database); TanStack Query only for ordering later (order-status polling).
- U5. QR print sheets (PDF) per table; the domain waits for P53.
- U6. Email templates (React Email with Resend).
- U7. Images: plain `<img>` with our R2 variants; no Next.js image optimizer (saves Railway CPU).
- U8. Optional: service worker caching the guest shell and last snapshot for weak basement signal.
- U9. Theme tokens: semantic tokens mapped onto shadcn's CSS variables (readable text-on-colour pairs, R13); not the Platform's palette-by-index.

## Exploring (not decided)
- E7. Modular pricing: features billed separately (e.g. own waiter view for non-barsy venues)
- E8. Collect-at-bar for standing guests (after v0, D28)
- E9. Loyalty accounts (after v0, D34)

## Diagrams
- **Restro FigJam board** (figma.com/board/16TH17t585SNM9nN16OkGz): v2 of guest order & group checkout flow, system sequence, order lifecycle (09-27). Needs a pass with T29.
- Menu Engine doc: data pipeline diagram (Data architecture tab) and runtime map (Stack tab).
- Superseded v1 boards in "Martin Kostadinov's team" (09-26) — to delete (Martin)

## Research facts
### barsy API — verified against the official docs, 10-08 (signed in; corrects the Menu Engine doc)
- **Test access:** a test environment is requested by email to helpme@lukanet.com describing plans and goals ([Как да започна](https://docs.lukanet.com/barsy.api/integrations/10-begin.html)). A public **demo installation** is used in every example: host `demo.barsyonline.com`, user `demo`, password requested through the form at [barsy.bg/demo](https://www.barsy.bg/demo/) (company, contact, phone, email, anti-bot check — Martin submits).
- **Per-venue for-sale:** `is_for_sale_barsys` is returned only with extra property **`limits_by_barsys`** — the doc's full-pull list lacks it. ([Articles_getlist](https://docs.lukanet.com/barsy.api/methods/articles/getlist.html))
- **Paging:** without `order_by` the list "is not reordered" → offset paging can skip or repeat. Full pull uses `order_by: {article_id: "asc"}`; `ref_date` ordering exists for incremental sync.
- **Deletions:** filter `delete_flag` defaults to 0 → deleted articles never appear in lists; only D-webhooks and the full-pull absence check (rule 6) see them.
- **Tree checksum:** `Categories_getalltree` parameters are `cat_id`, `only_public`, `picture_content`, `articles_lazy_load_mode`; the description mentions checksums but no parameter is documented → we hash the tree ourselves (Q71). The tree also returns modifiers.
- **Prices are JSON floats** (`"actual_price": 2.40`); `actual_price` (base) vs `current_price` (after price rules) vs `original_price` (in currency). Parse losslessly, decimal string → minor units, half-up (rule 8).
- **Timestamps** in examples carry no offset (`"2012-09-27 17:12:29"`) → Q60 likely "no offset"; keep the 65-minute overlap.
- **Languages:** `MultiLanguageData` has 11 keys: bg_BG, en_US, de_DE, es_ES, fr_FR, it_IT, ro_RO, ru_RU, sr_RS, el_GR, tr_TR.
- **Allergens** live in article characteristics ("характеристики (включително алергенти)"); `article_details` extra property; `ArticleDetails_getTree` lists keys.
- Other useful filters: `search_article_ids` (batch refetch), `menu_id` (catalogue), `is_public`, `is_service`, `parent_cat_id`/`cat_id_deep`. Extra properties: `common` (min/common/all/public), `article_name_ml`, `ml_data`, `description_public`, `picture_url`, `categories`, `supplements`, `has_supplements`, `slug`, `current_price`, `actual_price`.
- **Webhooks** (for later): types 1 articles, 2 accounts, 3 client orders, 4 clients, 5 orders, 6 categories, 7 reservations, 8 modifiers; HEAD test accepted on 200–299/401/403/405/500/501; `X-Signature` = sha256 HMAC of body with the subscription secret; `X-Webhook-ID`; retries 1, 2, 4, 8… min up to 1 h; email every 5th failure; deactivated after 14 days; one subscription per user per type; rights: "Абонамент за webhook" + view right per type. ([Webhooks](https://docs.lukanet.com/barsy.api/integrations/40-webhooks.html))
- **Accounts_place** (for T29): `account_id` (continue) or new; `orders` rows with `article_id`, `amount`, optional `original_current_price`, `modificators`, `supplements`; **`payments` accepted only when closing**; `flag_close_account`; `print_receipt` (local print); `account.uuid` dedup; `account_alias` (shown in account lists), `description` (printed on the receipt), `notes` (not printed); `external_source`; **`lang_id` prints item names on the fiscal receipt in that language** (Q70). Recommended by barsy over Accounts_create/close for new integrations. ([Accounts_place](https://docs.lukanet.com/barsy.api/methods/accounts/place.html))
- **Messages:** `Messages_create` exists (Q48 partly answered; delivery to the hall tablet unverified).
- **Reports:** a "Справки" group with 10 methods exists (T21).

### barsy help — public pages, read 10-08 (undated)
- **"For confirmation":** accounts from external systems that need approval appear in POSX under Сметки → За потвърждение, only to the user assigned to the place's zone; if the place has no zone, or that user has no active session, all users see it. Example given: barsy's own QR-menu orders. No popup or sound is described. [Zones](https://docs.lukanet.com/barsy.help/120-posx/110-zones.html)
- **Verification setting:** "Задължителна верификация на поръчки" — mandatory check of orders before an account is created from a client request → configurable at least for client requests. [Settings](https://docs.lukanet.com/barsy.help/extra/settings.html)
- **Web-order scenarios (via API):** (1) client request — staff review, then convert; (2) open account — staff review/edit, close manually; (3) **closed account — created and closed automatically, no staff review**; (4) stock transfer. Option 3 maps naturally to pay per order (D5). [Web orders](https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html)
- **Account closing:** payments must balance; the fiscal receipt is issued when the account closes; a closed account changes only via storno. [Account](https://docs.lukanet.com/barsy.help/210-dictionary/account.html)
- **Order rows:** each row has a flow (bar/kitchen) and statuses ordered → ready → served; rows with a flow go to bar/kitchen printers or screens. [Account order](https://docs.lukanet.com/barsy.help/210-dictionary/account-order.html), [Order flows](https://docs.lukanet.com/barsy.help/110-admin/180-settings/orderflows/index.html)
- **Order identification:** POSX staff work by table. Client requests carry their own number (example "№ESHOP-2025-1148"). What a bar ticket prints is not in the public help. [Sale](https://docs.lukanet.com/barsy.help/120-posx/020-sale.html), [Client order](https://docs.lukanet.com/barsy.help/210-dictionary/client-order.html)
- **Messages:** barsy's internal mail; in barsy's own QR menu, "call a waiter" makes the POS send an automatic message to the hall team (tablet). [Messages](https://docs.lukanet.com/barsy.help/210-dictionary/message.html)
- **Payment links:** a setting sets how many hours a payment link stays active; invoices can be created and sent automatically after payment. Listed payment integrations: SumUp (card terminal), SelfiPay (biometric) — no online PSP named publicly. [Settings](https://docs.lukanet.com/barsy.help/extra/settings.html), [Integrations](https://docs.lukanet.com/barsy.help/110-admin/180-settings/230-integrations/index.html)
- **Reports barsy has (admin UI):** sales by period, article, category, venue, terminal, flow, user/waiter, client, visitors, bills, orders, reversals, payment method, place/hall, VAT group; order reports: refusals, modifiers used, staff actions, processed. API exposure unknown (T21). [Reports](https://docs.lukanet.com/barsy.help/110-admin/170-reports/index.html)

### Synex Platform review (10-08) — see `docs/platform-reference.md`
- Ontology (schema tree, singular/series/many nodes, ordered typed properties) → passport documents (materialised path) → `Passport/Render.jsx` view engine; Design = team theme tokens only. No composer/layout document, no QR, no draft/publish. Ten pitfalls listed in the reference doc.

### Supabase (checked 10-08)
- Free plan: two active free projects per user (paused ones don't count); paused after low activity over 7 days (our 5-minute polling keeps it active); no downloadable backups on free. Pro: $25/month per organisation incl. $10 compute credits (one Micro project), extra projects ~$10/month each, no pausing, daily backups. Martin's account: org "Personal Finance" (free), project MyFin paused.

### Allergen rules in Bulgaria — first pass 10-08 (full legal text not yet read)
- Ordinance on the provision of food information to consumers, Decree No 97 of 19 March 2021, State Gazette 25/2021. [FAOLEX](https://leap.unep.org/en/countries/bg/national-legislation/decree-no-97-19-march-2021-adoption-ordinance-provision). Full text not fetched (lex.bg blocks automated access).
- bTV (03.04.2024): catering establishments must indicate allergen-causing products **in their menus**; no prescribed format. Dnes.bg (2015, updated 2025): same requirements apply to food offered via websites. Schoenherr (2016): BFSA required allergen information for non-prepacked foods in writing.
- Reading so far: our QR menu likely needs allergens per item; drinks are food under EU law. To confirm (Q42).

### Euro changeover (checked 10-08)
- Dual BGN/EUR price display ran 08.08.2025–08.08.2026 per Счетоводство, данъци и право (3 Jul 2026); a related one-year extension concerns the ban on unjustified price increases (to 09.08.2027), not the display rule. Treat dual display as ended — accountant to confirm (Q65). [trudipravo.bg](https://trudipravo.bg/izbrani-statii/izbrani-statii-ot-epi-schetovodstvo-i-danatsi/otnosno-srokovete-za-bezplatna-obmyana-na-levovete-v-evro-i-dvojnoto-oboznachavane-na-tsenite/)

### Platform prices and versions — checked 10-08 (details in the Stack tab)
- Railway: Hobby $5/month incl. $5 usage; Pro $20/month incl. $20 usage; RAM $10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB; Hobby volume cap 5 GB; EU West = Amsterdam; volume backups daily/weekly/monthly (lost with the volume).
- Cloudflare R2 free tier: 10 GB-month, 1M Class A, 10M Class B ops/month; egress free.
- pg-boss 12 (12.37.0): Node 22.12+, Postgres 13+; cron/RRULE, retries with backoff, dead-letter queues, debounce, send inside an existing transaction (Drizzle adapter), dashboard.
- Next.js: 16.x is Active LTS for the whole major (support policy); 16.4 released 2026-10-06; the 2026-09-30 security release patched the then-newest minor (16.3.8). Node 24 LTS; Node 26 Current.
- Free tiers: Sentry 5k errors/1 user; Resend 3,000 emails/month, 100/day.
- GitHub Free: branch protection is not enforced on private repositories (needs GitHub Pro, $4/month) → protection by convention + CLAUDE.md.

### Lukanet (barsy) written reply (by 10-01)
- Docs need a free account (Martin has one). Paid consultations €130/h excl. VAT. Per-venue access: host + username + password. Writes need a "software resource" billed to the venue's barsy subscription; price only via the venue. barsy also sells its own QR ordering add-on.

### Payments, failures, refunds (09-27)
- Uber Eats / Uber rides / Wolt hold-then-capture patterns; DoorDash state machine of idempotent steps (~1% of orders saved daily); Stripe manual capture (holds ~7 days, partial capture releases the rest); Stripe Connect direct vs separate charges; saga pattern; idempotency keys + reconciliation. Sources: help.uber.com, uber.com blog, explore.wolt.com, careersatdoordash.com, docs.stripe.com, microservices.io, temporal.io.

### Earlier
- N-18: card payments are not an exemption from fiscal receipt → receipt from the venue's barsy/fiscal device, delivered electronically. Confirm with accountant. The review notes that taking money without a fiscal receipt can lead to sanctions up to sealing the venue (ЗДДС art. 186) — accountant to confirm.
- Stripe Connect available in Bulgaria (stripe.com/en-bg/connect/pricing); Stripe balances treated like a bank account (t8gconsulting.com).
- sunday: layers on POS + processor, split by item/seat/people/custom. me&u Pay: ~50% guest adoption, ~15 min faster turns, more tips.

## Open questions
**Answered 10-08:** Q5/Q7 read side, Q18 (→ D29), Q19 (→ D30), Q20 (→ D27), Q23 (account level), Q30, Q31, Q32 (→ D23/D36), Q34–Q37, Q44 (→ D24), Q50 approach (→ D31), Q51 (→ D32). **Partly answered from the official docs (10-08):** Q26 (test env is requested via helpme@lukanet.com), Q47 (one call can create, pay and close), Q48 (`Messages_create` exists), Q52 (alias/description/notes fields exist), Q60 (examples carry no offset).

**Payment provider and the lawyer, for song requests, deposits and ordering (T80; research `docs/research/2026-10-17-mypos-and-fiscal-receipts.md`)**
- Q74. Lawyer: does a guest's card payment made inside the venue through the app (an order, a song request) need a receipt from the venue's fiscal device, or can it run under the alternative regime of Н-18 чл. 3, ал. 17 (the law defines remote payment as delivery away from the merchant's premises; our reading says in-venue may not qualify)? What are the conditions if it can (e-shop registration, money into the venue's own account, monthly audit file, QR on the document)?
- Q75. Lawyer: reservation deposits and paid song requests as the venue's sales: which document is issued, when is VAT due (ЗДДС чл. 25, ал. 7 on advances), and who issues it when the money lands in the venue's payment account.
- Q76. myPOS (Martin): pre-authorisation must be switched on per merchant account (how, for which business types, hold duration beyond "typically up to 30 days"); partial capture and partial refund; Apple Pay and Google Pay in the hosted checkout (Google Pay unconfirmed); the notification retry schedule; a partner or split model for a platform fee (none documented); what a Bulgarian venue needs to open an account. Widened 10-21 (#49, myPOS chosen as the first provider): whether the embedded SDK can hold a card with 3-D Secure, Apple Pay and Google Pay, or only the redirecting Checkout can; how a software platform connects to a venue's account for Checkout calls; whether its key can be limited to hold, completion, cancel and status, with no refunds; the hold length for a bar or club; tips inside the held amount; holds and 3-D Secure in the sandbox; turning off the payer's emailed receipt; the myPOS link with Mistral's Zamboo. Also: whether the €0.30 "myPOS Online" fee applies to card payments on top of 1.30% + €0.10, and whether the custom offer above €5,000 a month changes the online rate (`2026-10-21-mypos-vs-stripe-cost.md`). Known already (Martin 10-21): API access comes from the client's account with permissions; pre-authorisation exists; a released hold returns in a few days, by the bank; a tip is a charge of its own. Sent by Restro, as the software company, through myPOS's contact form (`2026-10-21-payment-provider-decision-log.md` row 1.2). First reply 10-21 (its AI assistant, `docs/deliverables/2026-10-21-mypos-knowledge.md`, the one living myPOS file): pre-authorisation switched on per merchant on request, completed within 30 days and never above the hold; no embedded form or sandbox in its material; no integrator programme. A follow-up asking for a person at myPOS is drafted for Martin to send. A person answered 10-22 (same file, M22):
- holds work only on myPOS's redirecting page, not in the Embedded SDK;
- a lower completion releases the rest, and the bank sets when the guest sees it;
- myPOS emails the payer nothing;
- there's a free sandbox with dummy data and a demo environment with real statuses (Restro uses the demo, log row 3.1), and neither runs 3-D Secure.

Still open: the key's permissions (re-asked), the notice signature, retries and duplicates, the Mistral link, and whether a club gets pre-authorisation.

Second answer 10-22 (M22b):
- everything is per store, and myPOS switches pre-authorisation on once told a store exists (demo and production);
- there's no limited key, so Restro's code enforces "no refunds" (log row 3.2);
- notices are checked with the store's myPOS certificate;
- myPOS knows of no Mistral partnership.

Left: notice retries and duplicates (re-asked with a concrete case), whether a store can have refunds switched off, and the club's eligibility.

Third answer 10-22 (M22c):
- a club is eligible;
- a cancel within seconds is free;
- the tip goes inside the hold;
- a notice is never resent, and an unconfirmed one reverses the payment;
- one `OrderID` survives failed attempts;
- turning refunds off would block the venue's own refunds;
- Apple Pay and Google Pay come only with an immediate charge, never with a hold (log row 1.10, Martin's call).

Left: the Checkout page in Bulgarian, to try in the demo.
- Q77. Martin: the charging model for song requests and deposits: a fixed monthly fee, a percentage of captures invoiced monthly, or both (D98 keeps it open; no split inside the payment until a provider offers one).
- Q78. Martin + Claude: the DJ request queue in templates (D99, D105): which slot and contract a template draws it with, and whether every template must draw it; settled when the song-request port (T82) reaches the face contract; until then the functionality file lists it as "decided, not in the contract yet".
- Q79. Lukanet (Martin sends): is barsy on the NRA list of sales software (СУПТО), and can it accept an outside order as an Annex 42 import before the venue accepts it? The fiscal research of 10-17 (`docs/deliverables/2026-10-17-fiscal-rules-in-app-payments.md`, Q5 and L11) reads ЗДДС чл. 118, ал. 18 and Н-18 чл. 52з as: a venue on listed software may take Restro's orders only as an import, at the latest when it accepts the order. Decides how ordering from the menu enters the POS (T83 and the ordering phase); asked with Q8 and Q24.
- Q80. Martin, after the lawyer (L3, L7, L8): a fiscal receipt per captured payment with no guest email or account (D99) means paper receipts from the venue's device for every accepted song request and every backer, which a guest without a table may never collect. Weigh against D99's "no accounts, no email"; options once the lawyer answers: an optional email at payment, an electronic receipt in the anonymous session if L3 allows it, or accepting paper at the bar.
- Q81. Martin, after the lawyer (L9): if an app screen showing the running bill with a Pay button is a "document with information on the current amount" (Н-18 чл. 7а, чл. 26, ал. 6), the template's bill screen must follow Annex 39 and say "НЕ СЕ ДЪЛЖИ ПЛАЩАНЕ". Until the lawyer answers, the lead's safe reading for every template: the bill screen never resembles a receipt and no Restro screen uses "фискален", "бон" or "касова бележка"; to be written into `docs/guides/menu-template-functionality.md` (See the bill, Get the receipt) on Martin's OK.
- Q82. Lukanet, from the signed-in API reading of 10-18 (`docs/deliverables/2026-10-18-barsy-api-reference.md`, map #29; the POS questions the bill grilling surfaced, C8 first, are kept in `docs/connector-questions.md`): (1) does `Payments_create` linked to an open bill print a fiscal receipt, leave the bill open, and count as a partial payment under Н-18 чл. 26а; (2) how is one row refused on an open bill through the API (a negative row with `reason_id`?) and what does the bar get; (3) can an integrator set `ref_id` / `order_ref_id` so a bill or row is found by our id; (4) which `service_status_id` an API bill gets under each approval mode, and whether approval or decline shows in it; (5) does `Accounts_place` with a `place_id` honour the cash desk's approval mode; (6) what `external_source`, `client_order_id` and `additional_data` accept; (7) can integrators get the API reference offline (file or OpenAPI), since the docs sign-in does not persist. Send with Q79.

**Ask Lukanet / pilot owners before building ordering (T9, T13)**
- Q47. Does an `Accounts_place` call with payments and `flag_close_account = 1` issue exactly one fiscal receipt, and do the order rows still go to bar printers/screens when the account closes automatically?
- Q55. If the payment link needs the bill first: can an unpaid bill be kept from printing and from "For confirmation" until it is paid, and cancelled automatically if it is not?
- Q58. Payment link: which provider; Apple/Google Pay; partial amounts / several payers; authorise-then-capture; refunds through the API; a payment webhook or callback; tips; fees; exactly one fiscal receipt. (extends Q39)
- Q49 / Q38. Popup or sound for new "For confirmation" accounts; can confirmation be switched off or auto-accepted for paid API accounts?
- Q48. Does a message created with `Messages_create` reach the hall team's tablet (call waiter, request bill, ask-your-waiter items)?
- Q52. What prints on the bar ticket for an API account — does `account_alias` or `description` appear?
- Q56. Can an account be looked up by our `uuid` (needed after barsy refuses a retry as a duplicate)?
- Q57. Can we get barsy's price for a cart without creating an account?
- Q59. What exactly does `Poses_register` affect — can it disturb the venue's own POS?
- Q60. Confirm: `last_update` timestamps are venue-local without offset? (DST ends 25 Oct 2026)
- Q71. `Categories_getalltree` mentions checksum support but documents no parameter — is there one?
- Q21. Each paid order = its own barsy account, or rounds on one table account? (recommendation P41)
- Q40. Order-level dedup for later rounds (only if rounds)
- Q26. Test installation, ideally with a test fiscal printer (D33) — request per the docs (T39)
- Q41 / Q28. Is the "software resource" the registered POS; **does read-only API access need it?**
- Q25. Monthly price of the "software resource" — flat or per volume/device?
- Q24. Partial refund (storno of one item) via API, with fiscal storno receipt?
- Q29. Resource price vs barsy's own QR ordering add-on.
- Q46. Can translations be written into barsy articles via the API (`ml_data`); rights/cost? (D26)
- Q53. Which sales/report data can the API return ("Справки" methods); extra rights or cost? (D31)
- Q6-remainder. Contractual restrictions on third-party integrators? Q3-fallback: what if the price kills the pilot economics, or Lukanet declines?

**Lawyer / accountant (T33)**
- Q8. Fiscal receipt for online-paid orders via barsy; electronic delivery.
- Q62. Who issues the fiscal receipt on each payment route, and when (Наредба Н-18)?
- Q63. Does Restro count as sales software under Н-18?
- Q64. Must guests get a paper receipt, or is an electronic one enough?
- Q65. Does dual BGN/EUR price display still apply (we read: ended 8 Aug 2026)?
- Q66. Any duty to check age for alcohol ordered in the app inside the venue (D11)?
- Q67. GDPR: who is controller and who is processor (venue vs Restro); the data processing agreement; retention periods; guest privacy notice and terms.
- Q42. Allergen rules for food and drinks in catering and online menus: per item? digital menu enough? Then: do pilots hold allergens in barsy?
- Q10. Online tips accounting treatment.
- Q70. `Accounts_place` `lang_id` prints item names on the fiscal receipt in that language — may a Bulgarian fiscal receipt carry English item names when the guest orders in English? (Default until answered: always `bg_BG`.)

**Martin**
- ~~Q72. Is reusing code and patterns from the Synex Platform in Restro fine IP-wise?~~ Answered 10-08: yes (D51).

**Pilot venues (T3)**
- Q43. Time-based price lists (happy hour)? Q45. EN names in barsy? Q54. Which stats do owners want (after T21)?
- Q68. How do staff mark items sold out today, and where?
- Q69. Who on the venue side answers an alert at night?
- Q12. Wi-Fi and mobile signal on the floor.
- Q73. Which pilot venue goes first, and who is its barsy admin (to create the read-only API users)?

**Product design**
- Q22. barsy post retry window before voiding (only if Stripe holds)
- Q11. Disputes: "drink never arrived" / unauthorised use
- Q15. Fixed per-transaction fee impact on small tickets

**Field**
- Q1–Q4. Why barsy clubs don't use barsy's QR add-on; lost orders; owner/waiter appetite; table vs. bar revenue share

## Tasks

Since 10-17 a new task is a GitHub issue from the moment it exists (`docs/agents/issue-tracker.md`); this section takes no new T entries. The open T-numbers below stay until they close.
**Stage 1 — set up the ground (in progress)**
- [x] T35. Platform reference map (`docs/platform-reference.md`) — Claude, 10-08
- [x] T36. Repo `E:\Restro` initialised; research moved to `docs/research/`; doc mirrors in `docs/architecture/`; agent brief template — Claude, 10-08
- [x] T26. Scaffold the repo (pnpm monorepo, CLAUDE.md, CI gates, import rules, fixtures harness), document-model foundation, DB with RLS, admin and worker shells, barsy read client skeleton — Claude + subagents, merged on `s1/ground` 10-09 (662 tests + 6 browser tests green); pull request to `main` for Martin
- [x] T42. First real barsy recording (`pnpm barsy:record -- --method Misc_ping_user`, plus a wrong-password recording) — done 10-09: Misc_ping and Misc_ping_user return 1; a wrong password returns HTTP 401 with plain-text body "Проблем с автентикацията: Грешен потребител или парола"
- [x] T43. Bootstrap Supabase `restro-staging` (migrations + `restro_app` role) — done 10-09 with Martin's OK: 3 migrations, `restro_app` safe, RLS forced on tenant tables, `anon`/`authenticated`/`service_role`/`authenticator` have no access to `restro` or `pgboss`, app login through the session pooler with a verified certificate
- [x] T46. (done 10-09: `db:roles` sets the timeouts on the role; verified on restro-staging through the pooler: 30s / 1min. Also: `db:roles` now keeps an existing password unless `DATABASE_APP_PASSWORD_ROTATE=1`, because re-setting it broke pooled logins until Supavisor refreshed its cache) The Supabase session pooler ignores startup `options` (statement_timeout came back as Supabase's 2min default): set `statement_timeout=30s` and `idle_in_transaction_session_timeout=60s` with `ALTER ROLE restro_app SET …` in `db:roles` before the app runs on staging — Claude
- [ ] T45. Production deploy pipeline (Stage 3, with Railway) re-runs `scripts/freeze-window.mjs` at deploy time and refuses to deploy inside the freeze window; the PR check is only an early warning — Claude
- [ ] T44. Review Bulgarian interface wording in `apps/web/messages/bg.json` — Martin. Added in S3-03: the namespaces `appearance` (Settings tab card; replaced by `design`, the Design tab, in SH-05a) and `tablePage` (the "table code not active" page); the guest page's own words are in `packages/shell/src/strings.ts` (`guest`, BG and EN). Added in S3-06 (tags): `composer.tags` (the Tags panel), `composer.toolbar` (select all, tag filter), `composer.selection` (the bulk bar), `composer.chips`, `composer.empty.noMatches`, `fields.tags` (the tags editor and the new-tag form, including the five colour names), and the `composer.errors.rejected` sentence. Wording to check: "Тагове" / "таг" for tags (the field label was already "Тагове"), "Филтър по таг", "Архивирани", "Върни" (restore), "Цвят на марката" / "Контур" for the colour names. Added in S3-05: the namespace `publish` (the Publish tab: live version, changes waiting, held publish, pause banner, versions, preview) Added in S3-07 (tables and QR): the namespace `tables` (the Tables & QR tab, the print sheet and the guide page) and `docs/guides/qr-links.md` (BG first, then EN). Wording to check: "Нашият линк" / "Собствен линк на заведението", "Шаблон на линка", "Основен адрес", "Изключи кода", "Нов код", "Лист за печат", "Без салон" (no hall), "Скрита" / "Публична" for hidden / public tables, and the card text "Сканирайте за менюто" Added in S3-08 (sold out tonight): `composer.soldOut` (the row menu entry, the "Изчерпани (N)" chip and its list), `composer.badges.soldOutTonight` / `offSaleBarsy` / `offSaleOther`, `composer.errors.not_allowed`, `itemSheet.details.sale` (the sale card), `itemSheet.soldOutSaved` / `backOnSale`, and `itemSheet.details.readOnly.sold_out_control`. Wording to check: "Изчерпано тази вечер" (badge, chip title), "Върни в продажба" (the button that takes our mark off), "Не се продава в barsy" (barsy has it off sale; no button), "Маркирай като изчерпано тази вечер" (sheet button). Added in SH-05a/SH-05b and the lead's preview switch (10-11): `design` (the Design tab: gallery, colours and roles, fonts, look options, live preview with "Преглед на услугите за гостите") and `composer.guestFeatures` (the Guest features panel, „Функции за гостите“); the guest service screens' words are in `packages/shell/src/strings.ts`
  - S8 (ad/s8-wording): the review list of every sentence added or changed since this entry, Bulgarian first and grouped by screen, is in `docs/i18n-review.md`.
- [ ] T47. Unlink vs re-sync: after a manager unlinks an item, the next sync must not re-link or duplicate it. Mapper node ids are derived from the barsy object, so a "dismissed link" marker is needed before unlink is offered in the UI. Same for a manager who unplaces an item everywhere (the next sync places it again) — Claude, before the unlink UI
- [ ] T48. Record one demo article with allergen text (the demo has `article_details: {}` everywhere) to confirm the value shape; confirm `order_by` `cat_weight_deep` on the next recording — Claude
- [ ] T49. Map `portion` (`amount_unit` + type; needs `Amounttypes_getlist` doc-checked and allow-listed) and category pictures (`cat_picture`) — Claude, Stage 3
- [ ] T51. D24 translation-review flag: add an "acknowledge" op so a manager can confirm a translation without editing it — Claude, with the review queue (Stage 3)
- [ ] T52. Save conflicts: the change set carries the node's expected revision and `apply()` refuses a stale save (the doc's rule); today saves are last-write-wins — Claude, before two managers edit at once
- [ ] T53. Clean up abandoned uploads: a worker job removes asset files and `assets` rows no field points at, after a grace period — Claude, with the worker asset jobs
- [ ] T54. Drag a section *into* another section (today: "Move to…" menu; drag only reorders siblings — `@hello-pangea/dnd` cannot drop into nested lists). Needs `@dnd-kit` if wanted — Martin to decide after trying the composer
- [ ] T55. `next dev` evaluates workspace packages more than once (module singletons such as the DB pool broke; two fixed with `globalThis`); `next dev` font loading fails inside agent worktrees — watch for more — Claude
- [x] T56. (done 10-09: the photo row no longer prints the asset id; the thumbnail uses the sheet's signed link; why the e2e screenshot showed a blank square is not yet confirmed — recheck during Stage 2 acceptance) Item sheet polish: the Details tab's photo row shows a blank thumbnail and the raw asset id (`as_…`) instead of the photo; show the thumbnail (signed link, as the Media tab does) and never an internal id — Claude (Haiku task)
- [ ] T60. Photo variants: store EXIF-oriented width/height in `assets` (portrait phone photos would get a swapped aspect box); `variants:backfill --force` to rebuild variant files after a wiped publish folder; CORS headers when `/cdn` moves to the real CDN — Claude
- [x] T61. (**replaced by D68 / CF-14 on 10-11**: the address carries a random code, slugs are no longer unique; done 10-10, S3-10: global unique index on `venues.slug`, typed `slug_taken`, the publish job fails on a `v/<slug>.json` clash) Globally unique public venue slugs (or a tenant-qualified path) before a second tenant goes live — `v/<slug>.json` is global today — Claude
- [ ] T62. Catalogue-root safety (seen on the local acceptance setup 10-10: the root was switched to a sub-category, and the 12:00 full pull then marked 66 links missing, hiding the menu in the composer; V11 would have held the guest publish):
  - the Integration tab warns before changing the root or the barsy venue, and shows what the next full pull will hide;
  - the absence conclusion is skipped when a pull sees 0 categories under the root;
  - a pull that would mark more than 30% missing holds the conclusion for a person (like V11).
  - seen again 10-11 (Martin trying other demo venues): Bar & Dinner → Магазин 1 with root "Блузи" → the full pull saw 0 articles and marked all 65 Bar & Dinner items missing; switching to a barsy venue without a root then stopped all syncs. Switching the barsy venue replaces the whole menu: warn and confirm, and say what happens to the old items.
  — Claude, before the pilot
- [ ] T67. Tables of a newly chosen barsy venue: today they are read only by a full pull, which runs only once a catalogue root is chosen, so the Tables tab stays empty after a switch (seen 10-11 with "Burgers"). Read `Places_getlist` as soon as a barsy venue is mapped (tables do not depend on the menu root), and show why the tab is empty when no pull has run — Claude (Sonnet, with T66)
- [ ] T68. **Integration moves to the organisation's Settings** (Martin, 10-11: "integration should be in settings"; barsy venues should appear as venues of their own). **Confirmed 10-11 (D73, D74); work: CF-09a navigation, CF-16 multi-venue sync, then CF-09b Settings → Integrations.** **CF-09a merged 10-11:** the sidebar lists the venues (sorted by name, the open one lit, the current tab kept when swapping), "All venues", "New venue" for owners and admins, and an Organisation group with Settings; the footer has an organisation switcher only with several organisations; `/settings/integrations` exists with a note that CF-09b replaces. Open from CF-09a: a future venue rename must `revalidatePath` the layout so the sidebar shows the new name.
  - **CF-16 merged 10-11** (Opus; design note `docs/reviews/connector-architecture/cf-16-design.md`; migration 0016, expand only, applied to the local acceptance database). Several venues on one barsy account (T50, T67, T71):
    - each link row knows its catalogue (`catalogue_id`) and its own price choice (`price_source`, backfilled);
    - items are concluded absent per **catalogue** from a complete read of the whole catalogue, sections per venue from its root; CF-02's holds apply per scope; the "exactly one mapped venue" limit is gone;
    - pulls are keyed per venue (never dropped for another venue); one pull at a time per installation stays (barsy allows 2 concurrent requests and one pull uses both);
    - a venue reads its catalogue in its own context; an item that leaves a venue's root is hidden in that venue only (rule 5: more cautious);
    - tables are read as soon as a venue is mapped (`places-read`, T67); the schedule runs in the integration's time zone (default Europe/Sofia);
    - **bug fixed:** barsy sends the per-venue for-sale flags as text ("0"/"1"); the schema refused them (a whole page failed) and a venue's "0" was ignored.
  - **CF-09b merged 10-11.** T68 is built:
    - **Settings → Integrations** (organisation): connection, status with warnings (a held pull names its venue), the barsy venues (Linked to «venue» / **Add as venue** / **Link to an existing venue** / **Not used**), how data is read (allergen field, text language), automatic sync in Sofia time with **Sync everything now**, the history of all runs with a venue column;
    - **a venue's Settings:** the **Menu source** card (its barsy venue read-only with a warned "Change…", its menu category, the price it shows, last sync, held warning, "Sync this venue"); without a link it offers one, without an integration it points to Settings;
    - **a venue's Publishing tab:** a **Rules** card; `venues.settings.publish` (`after_sync`, `new_items`) per venue, falling back to the integration's old value, so nothing changed for the demo venue; the worker follows each venue's own rule;
    - the venue Integration tab is gone (`?tab=integration` opens Settings).
    
    Stored without migrations: the "Not used" set in `integrations.config.not_used`; a run's venue in `job_runs.details.venue_id` (older runs show "—"; the lead accepts this small touch of the worker's run tracking). Add as venue makes the venue, its menu and the link in one transaction.
  - **Open from CF-09b:** (a) → T76; (b) old briefs in `docs/agent-briefs/` still say "Integration tab" (history, leave them).
  - **Open from CF-16:** (a) the architecture doc's "Deletions" step and "per venue" wording need the per-catalogue rule (CF-13); (b) the incremental still reads barsy timestamps in the venue's zone, not the installation's; (c) the connect end-to-end test has a race between status and run finish (T75 family); (d) on deploy, each mapped venue gets one extra tables read on the first tick. The data is organisation-level already (`integrations` per tenant, `barsy_venues` maps a barsy venue to one of ours); only the screens are venue-level, from the one-venue proof of concept (D39). Proposed:
  - **Settings → Integrations → barsy:** connect, status and runs, the check interval and daily full pull, and the list of barsy venues found, each "Add as venue" / "Linked to …" / "Not used" (not every barsy venue is a guest venue: the demo has a shop, a catering unit and "Services");
  - **Venue:** its linked barsy venue (read-only there), the menu category, the default language and the publish behaviour; changing the link is a deliberate action with the T62 warning;
  - several linked venues need T50 first (sections, job key and absence check per venue, not per integration).
  - **Audit 10-11 (multi-connector readiness):** neutral already: raw records, links, change sets/`apply()`, provenance, rule-6 conclusion, pull lock, publishing, snapshots, shell and faces (0 barsy mentions), dependency rules. barsy-named in core: the till layer (`layer 'barsy'`, source `barsy:<in_>`, template owner `barsy`, resolver `linkedToBarsy`, orderable = active barsy `article` link; ~436 mentions in `packages/core`, stored values too). barsy-shaped: `barsy_venues`, `places`, the worker's sync (generic lock/chunk/paging/limiter/cursor code lives inside the barsy sync; no connector interface; job names `barsy-*`), the Integration UI, composer labels. Missing: a connector contract, capabilities, shared connector contract tests. Proposed "connector foundation" before Stage 4: neutral till layer + data migration (Opus), connector contract + generic sync engine with barsy as connector 1, neutral locations/areas/tables, Settings → Integrations. (Spreadsheet import as connector 2 was proposed, then dropped by D65; the contract is proven with barsy plus an in-memory test connector.) Full review: `docs/reviews/connector-architecture/`.
  — Martin to confirm the shape and timing, then Claude
- [ ] T70. **Connector foundation (CF)**, the fixes from the 10-11 review (`docs/reviews/connector-architecture/`; Martin 10-11: "review them and launch fixer agents"). Branch `cf/foundation` (from `s3/guest` + review docs). Started 10-11:
  - CF-01 New venue + New item in the admin (A4-F1/F2; brief `cf-01-new-venue-and-item.md`) — Sonnet;
  - CF-02 barsy sync safety: no absence from an empty or >30% read, scope fingerprint forces a full read, option names never cleared by an incremental, host change refused while links exist (B1-Q1/Q2/Q3/Q5, T62; brief `cf-02-barsy-sync-safety.md`) — Sonnet.
  **Status 10-11 (late):**
  - **Merged into `cf/foundation`:**
    - CF-01, with D66 and D68 applied;
    - CF-02: on a hold, every link move is dropped, `scope_hash` is still written, and only article links count toward the share;
    - CF-08a: workspace guard, vendor-word test (baseline 915 words, wall on the published surface), PR template;
    - lead fixes: sold-out rollover e2e skips before 07:00; baseline raised twice, approved and noted in the commits.
  - **Known limit until CF-11:** a deliberate switch to another barsy venue on a venue that has a menu is always held (100% of the old items would go). The old menu stays until a person releases the hold, so for now a switch needs the lead.
  - **Merged 10-11 (later):** CF-12 small hardening.
    - What it did:
      - phones read newer `live.json` files;
      - `Referrer-Policy: no-referrer` on `/m` and `/t`;
      - the shell gets a table code only once the table file confirmed it;
      - a "held" warning and badge in the Integration tab, from the latest complete full pull;
      - picker hints: public address, "public menu set up", and the suggested catalogue category;
      - the `currency_not_eur` status text.
    - Open:
      - **(a) The currency check in the worker.** Which `Currencies_getlist` field marks the till's main currency? The demo fixture has one row, so the docs must say. The docs session had expired. The web text is ready; the worker check is not wired.
      - **(b) Warnings are wiped.** A successful pull resets `statusDetail` to null, which would clear a currency warning at the next sync. Keep warning codes across pulls (CF-09).
      - **(c) Wording.** The new Integration strings say "the till" to keep the vendor-word wall. Move them under `connectors.barsy.*` if Martin wants "barsy" on that screen.
      - **(d) Item counts.** The cached category tree drops `child_articles_cnt`, so the picker shows no counts.
  - **Merged 10-11 (later):** CF-03 neutral till role.
    - **Core:** layer `till`, sources `till:<in_>`, owner `till`; the `import` layer is gone.
    - **Connectors:** `packages/core/src/connectors/` holds the link types per kind; a node takes one till link only.
    - **Migration 0014:**
      - checks rewritten;
      - stored values renamed, including link-event JSON;
      - a pre-check (no `import` rows) and a post-check (no `barsy` left);
      - RLS force and the `updated_at` triggers lifted only inside its own transaction;
      - a tested reverse script.
    - **Checks:** the published snapshot hash is unchanged after the migration; the rule-5 property tests now run over a till menu and a no-till menu; vendor words fell from 919 to 487.
    - **Open:**
      - applying 0014 to staging needs Martin's OK, with the worker stopped and the queue drained;
      - the architecture mirror still names the `barsy` and `import` layers (CF-13).
  - **Merged 10-11 (later):** CF-14 public menu address.
    - **Address:** `/m/<slug>-<12-character code>`.
    - **The code:** `venues.public_id`, random with no bias, unique and permanent. Migration 0015 backfills existing venues and checks none was missed.
    - **Files:** keyed by the code (`v/<code>.json`).
    - **Slugs:** no longer unique, and renamable in Settings. A rename queues the file jobs; old links keep working, and the page corrects the address bar.
    - **`/t/<token>`:** redirects to the canonical address.
    - **Lead's approval (D67):** CF-14 changed `till-role-migration.test.ts` to migrate only through 0014. Every check stays, so it is not a weakening.
  - **Open (CF-14):**
    - **(a) Before the pilot venue goes live,** run `publish-files` and `publish-table-tokens` once for every venue. Older token files lack the code, and `v/<code>.json` appears only on a publish.
    - **(b) A database trigger refusing changes to `venues.public_id`.** Today it is permanent only because no writer touches it.
    - **(c) A database check on the slug format.** Today only code checks it.
    - **(d) No reverse script for 0015.** Recommended: none.
  - **Setback, 10-11:** while the lead planned T74 in plan mode, CF-03 and CF-12 were put into plan mode too and stopped editing. Both were resumed with their context and finished. Lesson saved: no plan mode while agents run.
  - **Remaining roadmap** (`readiness.md`). Each runs in a free slot next to T74:
    - CF-04 publish policy on the venue;
    - CF-05 connections, locations, areas and tables data (waits for SH-04, which touches the guest table context);
    - CF-06 connector contract, kit and conformance skeleton;
    - CF-07 engine extraction;
    - CF-08 the rest of the guardrails;
    - CF-09 Settings → Integrations;
    - CF-10 tables (T66/T67);
    - CF-11 switch preview and hold release;
    - CF-13 docs and the CLAUDE.md rewrite.

  — Claude
- [ ] T74. **First gallery template "Editorial Market"** (D69–D72). Martin's Lovable delivery of 10-11 is stored in `docs/design/faces/editorial-market/2026-10-11/`. Plan approved 10-11. Branch `sh/foundation` (from `cf/foundation`; the CF merges flow in). Briefs `docs/agent-briefs/sh-*.md`:
  - SH-01 theme engine and presentation contract in core: OKLCH roles from 3 colours, presets, fonts, settings v2, snapshot `theme.roles`/`scheme`/`presentation`/`features` — Opus, after CF-03;
  - SH-02 face port, browsing: `packages/faces/editorial-market` — Sonnet;
  - SH-03 shell: R13 roles, new R15 features (fail-closed), manifest `features`/`options`, harness checks — Sonnet;
  - SH-04 template registry, guest page and draft preview render the chosen face, six self-hosted fonts — Sonnet;
  - SH-05a Design tab: gallery, theme panel, live preview; Appearance leaves Settings — Sonnet;
  - SH-05b composer "Guest features" panel — Haiku;
  - SH-06 service screens (bag, bill, call a waiter, pay, receipt) and the services contract (D72) — Sonnet;
  - SH-07 accessibility and visual audit with fixes, screenshots for Martin — Sonnet;
  - SH-08 docs and the designer guide v2 — Sonnet.

  Order: SH-02 now; SH-01 after CF-03; then SH-03 + SH-04; then SH-05a + SH-05b + SH-06; then SH-07 + SH-08. At most 2 agents at once since Martin approved the lean workflow on 10-11 (it was 3), one Opus.

  **Status 10-11:** SH-02 merged into `sh/foundation`.
  - **What it is:** `@restro/editorial-market`, browsing only. Zero contract failures on every fixture, no libraries, no literal colours, 90 tests.
  - **Open points, handed on:**
    - tap targets below 44 px on the layout and language buttons, and `h3`/`h4` heading levels → SH-07;
    - Next's history patch for the `#item-` route, and the page-wide `html:has(.rm)` rule → SH-04 and SH-05a;
    - the ordering CSS sits in the delivery's `ORDER_CSS` → SH-06.
  - **After CF-12 and CF-03 were merged into `cf/foundation` and then into `sh/foundation`:** SH-01 (Opus) was launched, in parallel with CF-14.
  - **SH-01 merged.** `packages/core/src/theme/` holds:
    - OKLCH maths;
    - `deriveRoles` (every required pair at 4.5:1 or better for any three colours, pinned by property tests);
    - `suggestHarmony`;
    - the 4 presets, exactly as the designer delivered them (all pass; Midnight light's tightest pair is 4.51:1);
    - 6 fonts, all with Cyrillic;
    - settings v2 and the `presentation` and `guest_features` writers;
    - the snapshot's `theme.roles`/`scheme`, `presentation` and `features`.

    **Two choices to show Martin:**
    - **(1)** When the page colour and the panel colour sit on opposite sides of mid-grey, no text colour reads on both. Only then is the panel colour's lightness moved, keeping its hue and colour.
    - **(2)** After deploy, every venue's next publish makes a new snapshot once, because the new look fields are always written.
  - **Next:** SH-03 (shell rules) now; SH-04 after CF-14.
  - **SH-03 merged:**
    - **R13:** uses the published roles, re-checked; a failing role is repaired, and a scheme that still fails falls back to the derived colours.
    - **R15 Features:** fail-closed. A service shows only when the venue switched it on, the platform supports it (context `capabilities`, all off in Stage 3), the channel is interactive and a confirmed table token is present.
    - **Manifest:** `features` and `options`, with `group: 'feature' | 'look'`, and `resolveOptions`.
    - **Harness:** `faceContractSuite`, `assertThemeOnlyCss`, and feature-slot checks both ways; three new fixtures.
    - **Proof:** mutation-tested; the property test runs 500 times.
  - **Running:** SH-04 (registry, guest page, fonts) and SH-06 (service screens; it starts early, since it needs nothing from SH-04).
  - **SH-04 merged.**
    - **Registry:** Editorial Market is the default and qr-phone is hidden. The guest page and the publish preview render the chosen template, loaded lazily.
    - **Fonts:** six self-hosted Cyrillic fonts; guests load them only from our own origin.
    - **New dependency rule:** faces import only react, react-dom and `@restro/shell`.
    - **History:** Back and shared `#item-` links work on the real page.
    - **Size:** the first-load JS is unchanged; the template is a 12 KB gzip chunk loaded on demand.
  - **Lead fix (937dc75):** templates never style the page around them.
    - The Editorial `html:has(.rm)` rules and qr-phone's smooth-scroll rule moved to the guest page (`html[data-guest-page]`).
    - `faceContractSuite` now refuses `html`, `body` and `:root` selectors.
    - This had to land before the Design tab, which shows the template inside the admin.
  - **SH-06:**
    - It was cut off by a session limit, after 5 commits (money helpers, services contract, screens, tests, a fix).
    - It was resumed to merge `sh/foundation` properly, bind the test stub in the registry test, and run the gate.
  - **Running:** SH-06 (finishing), SH-05a (Design tab), SH-05b (composer Guest features panel, Haiku).
  - **SH-06 merged.**
    - **What it built:**
      - the bag, bill, call-a-waiter, pay and receipt screens in Editorial Market;
      - the services contract in the shell (`GuestCommand`, `CommandResult`, `ServiceState`, `ServiceBinding`, strict Zod);
      - the bag estimate through core money (new `multiplyMinor`, `percentOfMinor`, `subtractMinor`, `ratioOfMinor`, property-tested);
      - the demo adapter `@restro/editorial-market/preview`, admin only;
      - two dependency rules: guest pages never import `/preview`, and money arithmetic stays inside a face's `preview/`.
    - **D72 holds:**
      - the bag clears only on the host's acceptance;
      - a rejection or timeout keeps it, and a retry reuses the same `actionId`;
      - "on the way" and "paid" come from the host's state only.
    - **Not done:** the visual check (→ SH-07).
  - **Open from SH-06:**
    - **UX, to decide with Martin at acceptance:**
      - (a) the bag's place in the bottom bar stays empty until the bag has lines;
      - (b) pay is a header icon.
    - **Stage 4 design notes:**
      - (c) a host that answers `pending` is reconciled by the bill round's `actionId` within 15 s, then a retry;
      - (d) the host must issue a fresh receipt id per settlement;
      - (e) `PayQuote` should list the allowed pay scopes;
      - (f) keep the bag across a reload (`sessionStorage`).
  - **SH-05b merged** (Haiku). The composer's "Guest features" panel:
    - filters;
    - call a waiter, with its request kinds;
    - bill, ordering, pay, each with a Stage 4/5 note;
    - the template's feature options;
    - the fixed allergen line;
    - owners and admins only.

    The two save actions keep each other's keys.
  - **Open from SH-05b:**
    - **(a) Two lists of templates.** Server code cannot import the registry (it breaks the build), so `feature-face.ts` keeps a second list of the manifests. SH-05a is asked to make one server-safe `faces/manifests.ts`. **Done in SH-05a.**
    - **(b) The first save pins the template.** The first feature-option save stores the default face for a venue that never chose one.
    - **(c) Call a waiter with no request kind** can be saved; guests then see no control. Block it or hint. **Done (lead, 10-11):** Save is blocked and the panel says to tick a request or switch it off.
    - **(d) The "other" request kind.** Its wording promises a note; the core schema has none yet (Stage 4).
    - **(e) Bulgarian copy** of the panel: draft, for Martin's review.
  - **Open from SH-04, for SH-07:**
    - the Editorial language and layout buttons are under 44 px;
    - the table label is hidden at 350 px width or less;
    - the dish name sits inside a `<button>` (invalid markup).
  - **SH-05a merged** (10-11). The new **Design** tab, after Publishing:
    - a gallery of the visible templates;
    - the look: 4 presets or Custom, the three colours with the 60/30/10 bar, colour-theory suggestions, the 8 roles for light and dark with their contrast and per-role overrides, font, corners, shadow, logo, light/dark policy;
    - the chosen template's look options;
    - a live phone preview of the unsaved look.

    Unreadable pairs block Save. Appearance left Settings. One server-safe list of templates (`apps/web/src/faces/manifests.ts`) replaced SH-05b's second list, which closes SH-05b (a). Template and feature options keep each other's keys (tested).
  - **Lead:** the "Preview guest services" switch in the Design preview. It shows the services the venue switched on in the composer, at a demo table with the demo host and its "Preview" marker; nothing is sent.
  - **Open from SH-05a:**
    - **(a) Words for option values.** The manifest names an enum's values (`list`, `one`, `two`) but gives no words; the web keeps them in `design.lookOptions.values.*`. Recommendation: add `valueLabels {bg, en}` to manifest enum options (shell).
    - **(b) Two admins saving options at the same moment** can overwrite each other (the merge reads outside the row lock). Recommendation: a core `mergePresentationOptions` that merges under the lock, before more than one admin per venue.
    - **(c) Members see the Design tab read-only** rather than not at all. Martin to confirm.
    - **(d) The corner slider stops at 24** (core allows 32). Keep.
    - **(e) A venue on an unknown template name** gets the note written for the hidden test template. Wording fix later.
    - **(f) A newly uploaded logo shows in the preview only after saving** (its photo sizes do not exist before). The tab says so.
  - **SH-08 merged** (10-11). Designer guide v2 (`docs/guides/shell-handoff/visualization-shell.md`: the gallery, theme roles, R15, manifest features and options, host props, the services contract with its four flows, "Delivering an update to a template", "A new template" with a brief skeleton), the architecture mirror's shell sections, README's face-package layout, and CLAUDE.md (layout, import line, the `manifests.ts` / `registry.ts` rule, `FACES_VISUAL=1`).
  - **Open from SH-08:**
    - **(a)** The demo view models `barsy-demo-view-model.*.json` lack `features` and `theme.scheme`; regenerate them (the guide's §6.2 explains the gap meanwhile).
    - **(b)** `docs/architecture/stack.md` still says R1–R14 and lists no `packages/faces`; fix with the live doc's Stack tab.
    - **(c)** The comment atop `packages/shell/src/theme.ts` says "the publisher refuses" unreadable themes; it is `setVenueTheme` at save.
    - **(d)** Mapping the face's `actionId` to A5's `client_ref` / `commands.id` is for Stage 4.
  - **SH-07 merged** (10-11). Accessibility and visual audit of the Editorial Market, fixed in the face's CSS and markup:
    - every button and link of the page, the 3 sheets and the 5 service screens is at least 44 × 44 px (the look kept with negative margins; the language and layout switches are 24 px wider);
    - item names are `h3` / `h4` with the button inside the heading (no block inside a button); photo `sizes` follow the layout;
    - the allergen sheet marks the dish's allergens with `aria-current`; the table label stays visible at 320 px; 14 allergen codes wrap;
    - all 8 dialogs: focus in, Tab trapped, Escape closes, focus returns (the bag and waiter bar buttons were fixed);
    - reduced motion covers pseudo-elements; text 4.5:1 and control edges 3:1 in the 4 presets plus a custom theme, light and dark (sold-out cards keep their words at full strength and fade only the photo; status pills outlined; the chosen option gets a ring).
    
    New gate specs `faces-a11y.spec.ts` (36 checks) and `faces-a11y-services.spec.ts` (16, in the Design preview); the screenshot matrix `faces-visual.spec.ts` runs with `FACES_VISUAL=1` (1140 pictures). `guest.spec.ts`'s tap-size note is now an assertion.
  - **Open from SH-07:**
    - **(a) A hidden-text allergen cue.** Today it is `aria-current` only; visually hidden words need a shell `GuestStrings` key (`allergenPresent`). Recommendation: a small shell task.
    - **(b) Muted text on the inverse bands** is a 65–75% mix. It reads 5.7–8.3:1 in the five audited themes, but core only guarantees 4.5:1 for the text/background pair; at 70% the mix needs about 7.2:1 (light) or 8.2:1 (dark). Recommendation: core checks the mixes too (lead's call; not changed).
    - **(c) The Botanical preset's dark accent (lime) on the cream sheet** reads 1.06:1 as a fill; the chosen-option ring carries the state. The designer's values; Martin to decide at acceptance.
    - **(d)** A 60-character name with no spaces hyphenates every two letters in two columns at 320 px (never cut; real words are fine). The list layout's arrow can wrap to its own line. With a logo, the filter button wraps to a second row below about 370 px.
    - **(e) A manual-only menu cannot preview ordering.** Items with no till link get no "+", so the Design preview shows no bag for them.
  - **Lead, after comparing the port with the designer's original (10-11):**
    - **The section rail did not stay at the top** on the guest page. `overflow-x: hidden` on both `<html>` and `<body>` (the designer's page rule, carried into `globals.css`) made `<body>` a scroll box of its own, and the sticky rail scrolled away with the menu. Fixed with `overflow-x: clip` (and `hidden` on `<html>` alone for browsers without `clip`); an e2e test now scrolls the guest page and checks the rail stays at the top.
    - **The pay entry dropped to a row of its own** at 390–439 px and pushed the title down (SH-06 open point (b)). With the pay entry beside it, the bill now keeps to its icon and total up to 440 px, so both share one row; at 320–359 px the venue bar still wraps, as SH-07 chose.
- [ ] T92. **Motion audit and worst-case data pass** (D106; due diligence 10-17 on emilkowalski/skills, MIT): vendor `review-animations` (with its STANDARDS.md) under `template-review/references/` and `break-ui` (with its CATALOG.md) under `restro-flow/references/`, each verbatim at a pinned commit with the licence and a provenance README, each with a Restro overrides file read first (twelve overrides for the motion audit: off under reduced motion, motion only after a tap, plain CSS, colour transitions allowed, the reviewer's list format, faces only; eleven for the worst-case pass: no toggle, route or fixture file in the repo, data through a seeded hand-made venue via `apply()`, no fix mode, Cyrillic cases, POS limits only from the official docs, never into a POS account). Wire them: `template-review` step 4b, only when the package CSS has motion; `audit-behaviour.md` step 4, operational screens only. Trial (D106): the motion audit on Editorial Market, whose CSS has image fades on load, ungated hover motion and an ease-in exit curve to judge, and the worst-case pass on the composer. `mobile-native` skipped: its one new rule is T91. Sonnet; Upkeep — Claude
- [ ] T91. **Guest page viewport: `viewport-fit=cover` and a status-bar colour** (found 10-17): both templates pad their bottom bars with `env(safe-area-inset-bottom)`, but the web app exports no viewport, so the inset is always 0 and the padding does nothing; the Next.js default viewport lacks `viewport-fit=cover`. Set it on the guest page (the `m/[...address]` route) with a `themeColor` per colour scheme, and check on a real iPhone that the header does not slide under the notch (Martin's device; a human step). D109 refines three points: the status-bar colour comes from the venue's published `background` roles for the light and dark scheme, never a constant; the viewport also sets `interactive-widget=resizes-content`, so the keyboard shrinks the layout and the bottom bar stays above it; and the page keeps the pinned, narrower `overscroll-behavior` rule (`none` on `<html>` only inside `@media (pointer: fine)`, so a phone keeps pull-to-refresh), not the page-wide `none` of the vendor skill `mobile-native`, which was rejected. Small, Sonnet, after T90 — Claude, then Martin
- [ ] T90. **Contract markers for the audits** (D105, found by T89): the face contract (designer guide §7.3, §5.5) has no marker for the control that puts a dish in the bag, the control that opens the dish page, the pay sheet's controls or the language switch, so the screenshot matrix and the services accessibility spec drive those through Editorial Market's class names and skip them for every other template. Add the markers to the contract and its tests (`@restro/shell/testing`; guardrails only tighten, D67), to both faces, and to the guide; then the two specs use them for any template. Small; before T87, so the first template's bag and receipt pictures exist. Sonnet — Claude
- [ ] T89. **Screenshot matrix for any template** (D105): `apps/web/e2e/faces-visual.spec.ts` and `faces-preview.ts` select Editorial Market by name and by its class prefixes; make them take the template from `FACES_VISUAL_FACE`, address the face through the contract markers (`data-slot`, `data-item`, `data-state`, the `menu.*` slots) and write one folder per template; proven on `editorial-market` and `qr-phone`. Blocks T87. Sonnet — Claude
- [ ] T88. **Admin defects from the design-skills trial** (10-17, found by the pinned Vercel rules on the Design tab): the tab never warns before leaving with unsaved edits; the sticky Save bar can cover the focused field (no `scroll-padding` anywhere in the web app); no `prefers-reduced-motion` handling in the admin; dynamic colour warnings are not announced to screen readers. D109 adds two items from `docs/guides/operational-screens.md`: the admin honours reduced motion with one global rule that sets animation and transition durations to near zero (off, never "gentler"), and the one Toaster (`apps/web/src/components/ui/sonner.tsx`) sets a single 8-second duration for every toast, with error toasts that stay until closed and show a close button. Sonnet. **Backlog for when ordering opens (D79):** six findings in the ordering and payment sheets of Editorial Market: a missing required choice only recolours a label; service dialogs start at `h3`; the promo field allows spellcheck, auto-capitalisation and autofill; the placeholder `0,00` is hard-coded for every language; removing a bag line has no undo; amounts without tabular numerals — Claude
- [ ] T87. **First template through the pipeline** (D105): a dark club-night face, as different from Editorial Market as the contract allows; Martin brings material or picks one of three one-screen prototype directions from the lead; Opus designs, a Sonnet subagent reviews and wires; Martin accepts on a local preview before merge. After T86 — Claude
- [ ] T86. **Template pipeline** (D105, D106, D107): `docs/guides/menu-template-functionality.md` with its guardrail test; the `template-design` and `template-review` skills, with the vendored frontend-design reference and Restro's overrides; the pinned Vercel rules with Restro's overrides and copy rules; the `template.md` flow and the functionality-file step in build, change, decide and ship; the designer guide's "who" column. Sonnet, lead reviews — Claude
- [ ] T85. **Portability groundwork** (D103): a container image for web and worker; object storage behind one S3-compatible module; Postgres schemas for core, auth, jobs, guest events, money and bookings (expand-migrate-contract, no behaviour change); a dependency or SQL check that events and money never join core tables except by id; a restore drill from the R2 dumps, written up as a runbook. After Martin accepts Adjustments 01, before the song-requests port (T82), so both prototypes land in their own schemas. Migrations are the lead's; the rest on Sonnet with the lead reviewing — Claude
- [ ] T84. **Analytics questions and the guest event model** (Martin 10-17: quality analytics, with the measurement designed from now). Martin writes the questions the analytics must answer per club and per night; the lead designs the append-only, personal-data-free guest event model in its own schema (D103) before the song-requests and reservations prototypes are ported, so both emit events from day one — Martin + Claude
- [ ] T83. **Port the reservations prototype** into the platform on Areas and Tables (D101): hosted reservation page per venue as the first channel, staff list and floor plan, optional deposit through the venue's payment account; embed, API and webhooks later. After ordering from the menu — Martin brings the prototype; Claude ports
- [ ] T82. **Port the song-requests prototype** into the platform (D99, D100): request queue, lock window, holds and captures through the payment connector, YouTube song search, the guest's queue view, the DJ page and role. Starts with a grilling round on what the prototype does today versus D99 — Martin brings the prototype; Claude ports
- [ ] T81. **Grill table-less access to song requests** (D100): a hyperlink from the menu for guests with a table, a QR code the club shows on its screens, a share-as-QR button in the guest page; what a request without a table looks like to the DJ; abuse limits if any. Run when T82 starts — Martin + Claude
- [ ] T80. **Payment-provider feasibility research** before the payments interface is built (D98): can Restro integrate as a software partner with myPOS and with the other providers Bulgarian venues use (Borica, ePay, Stripe, SumUp…): onboarding of a venue's own account, holds and their duration, refunds, wallets, notifications, fees, a platform fee or split, test environments. Starting point: `docs/research/2026-10-17-mypos-and-fiscal-receipts.md`; findings in `docs/research/` with citations — Claude (research agent)
- [x] T79. **Adjustments 01** (`docs/adjustments/adjustments_01.md`; the plan Martin approved on 10-12 is `docs/adjustments/adjustments_01-plan.md`). Branch `ad/foundation` from `sh/foundation`; CI runs on `ad/**`. Waves: 0 housekeeping (done 10-12); 1 foundations by the lead: ad/01 schema and roles (migrations 0018–0023, role `restro_purge`), ad/02 menus, languages and barsy roots, ad/03 routing and addresses, ad/04 purge and versions, ad/05 per-venue sync and the colour engine; 2 screens by agents in pairs, Martin accepting each pair on port 3000: A Integrations (S1) + Venues (S2), B Organisation and bins (S3) + Venue settings and publishing (S4), C Tables & QR (S5) + Composer Structure (S6, Opus), D Composer Design (S7) + wording (S8, Haiku); 3 purge rehearsal, test data, doc mirrors. Settled at the plan review (Martin 10-12): (1) one published index per organisation, `o/<organisation>.json`, with current names, old names and the internal code, plus redirect files for renamed organisations; the CDN cache delay on renames is documented; (2) the live menu is `venues.live_menu_id`, not a flag on menus; the venue's design is copied into every menu's snapshot at publish; (3) a POS venue in manual sync mode still receives shared item changes from other venues' reads of the same catalogue; only its own reads, venue-scoped values and publishing are manual; (4) never purge a snapshot a kept rollback row points to, nor the live one; keep a content-free purge log; a purged venue's address name may be reused inside its organisation, its public code and table tokens never — Claude **Accepted by Martin on 10-18** on `restro_accept`, after the behaviour audit (#24) and the header-name fix (#27, PR 28); the composer's "От barsy" / "From barsy" badge accepted as worded; the stage pull request into `main` follows.
  - **ad/01 built 10-12** (`ad/01-schema-roles`): migrations 0018–0023 (instance names and chosen systems; several menus per venue with `venues.live_menu_id` and `unpublished_at`, the menu guard trigger; `areas`, `tables` and `places` as the till layer; `menu_routes`; one address name per organisation and the slug histories; `tombstones`, `purge_log`), the role `restro_purge` with its `purge` privileges in `table-access.ts`, the entry `@restro/db/purge` (worker purge job only), worker `DATABASE_URL_PURGE`; the composite keys to menus say `ON DELETE SET NULL (<column>)` by hand (a plain SET NULL would null the venue's own id). CI follow-ups: a taken address name is refused as `taken` (web); the 0016 backfill test moved to `packages/db/tests`.
  - **ad/02 built 10-12** (`ad/02-menus-languages`): core `venueLanguages()` and the connector report (D77; `apply/languages.ts`, the barsy mapping counts the texts, the worker records after a complete full read) with the guardrail `scripts/enabled-locales.test.ts` (23 readers from before, to be moved by the screen packages); the menu writers (`apply/menus.ts`: add, rename, order, settings, bin, restore, set live, import copy; till venues keep the till's menus); barsy roots (D88, migration 0024 `barsy_venues.public_cat_id` / `tree_cat_id` from the venue list): one menu per root tied by a `menu_root` link on its root node (`apply/till-menus.ts`), sections keyed per menu (`<cat>@<nd_…>`; venue-qualified keys from before are kept), items shared, absence concluded over all of a venue's menus; a venue mapped before keeps its menu for the root the picker chose; a root the till changes re-points that menu (old sections go missing by the usual rules; the unlink goes in a manual change set by the system, since a till never unlinks). Lead's notes: a root change at the till is noticed at the next full read (the venue list is read then); `setLiveMenu` moves the pointer only, the caller publishes (D90, S4); `importMenu` leaves `tags` out (a venue's own vocabulary); the picker column `catalogue_root_cat_id` stays until S1 drops the picker.
  - **ad/03a built 10-12** (`ad/03-routing-addresses`, on ad/02): the platform's areas and tables (D95). Core `apply/tables.ts` now works on `areas` and `tables`: list, find, issue / new code / turn off, name, hide, move, reorder areas; on a venue with no till the owner creates, renumbers and deletes areas and tables (`from_till` otherwise); a hidden table or area gets no code and no `t/<token>.json` (the token is kept for when it is shown). The till mirror `apply/till-tables.ts` turns a till venue's stored places into its venue's areas (keyed by the till's hall id, in its weight order, places in no hall in an area called "Tables", last) and tables (the place's number; hidden by default when non-public, a `--` placeholder or numberless; a deleted place archives its table and retires its code; a table no place of the till venue points to is archived); the manager's name, order and hidden flag survive reads, the number and hall follow the till. `upsertPlaces`, `mapBarsyVenue` and `addVenueFromTillVenue` run the mirror in their transaction and `places.table_id` points back; migration 0025 moves tokens and names from `places` to `tables` one last time and drops those columns. Menu routes (`apply/menu-routes.ts`, D95/D91): one entry per area or table, the most specific published menu wins, an unpublished one falls back, a binned one is refused; `resolveRoutes` gives one menu per table and the token files carry it (`menu_id`). `archiveVenue` reports the tokens from the tables (a restored venue's files come back at once). The Tables & QR tab reads areas now with the smallest change (S5 rebuilds it; the e2e expects 7 codes for 8 tables, the hidden one has none). Rest of ad/03 (organisation index, `/m/<organisation>/<venue>`, Unpublish, venue state, slug histories) follows as ad/03b.
  - **ad/03b built 10-12** (`ad/03-routing-addresses`): guest addresses and venue states (D84, D86, D95). Files: `o/<organisation slug>.json` (the organisation's live venues by address name with each venue's code and live menu, and its venues' old names) or `{redirect_to}` under an old organisation slug; `v/<code>.json` gains `organization`; `t/<token>.json` gains `organization_slug`. Core: `guestMenuPath` (`/m/<organisation>/<venue>`), `venueStateOf` (Draft / Live / Archived), `unpublishVenue` (`venues.unpublished_at`; any publish of the venue, even an unchanged one, clears it), `renameVenueSlug` remembers the old name in `venue_slug_history` and refuses a name another venue has or had (so does `provisionVenue`; a venue may take its own old name back), `apply/organization.ts` (`organizationAddress`, `recordOrganizationSlug` for the Organisation › General action after Better Auth saved the new slug, `organizationSlugIsFree`), job `publish-organization-index`. Worker: `publish/organization-index.ts` written after every publish and by the new job; an unpublished venue's files are withdrawn like a deleted one's. Web: route `/m/[organization]/[venue]` (static shell; the loader follows the organisation's file, old names and redirects, and corrects the address bar); the old `/m/<slug>-<code>` keeps working and moves to the new address when its file names the organisation; `/t/<token>` leads to the new address; a table's file may name the menu it opens (D95), so the page waits for it; `unpublishVenueAction` for S2's button. Not done here: the Organisation › General screen (S3), the venue card states (S2), the custom-domain path parts (DM1). A flaky core test (`load-item-document`, a random id ending in `a1`) was tightened.
  - **ad/04 built 10-13** (`ad/04-purge-versions`, on ad/03): the purge and the versions rule (D83, D96, D91). Core `purge.ts` (pure): the bins' 30 days, `versionsToPurge` (the live version never; the two newest earlier published ones while younger than 30 days; every other row of the history, held, rejected and rollback records included, once 30 days old; a kept rollback record keeps its target), the change log kept 61 days; `provisionVenue` and the token writers draw again on a tombstoned code or token. Worker `jobs/purge.ts` (the only importer of `@restro/db/purge`): `purge-venue` (on demand, "Delete permanently": a venue in the bin loses its areas, tables, routes, menus with their sections, the items only its menus placed, its venue-scoped values and change log, tags, versions, address names and the row; its public code and table tokens are tombstoned; its files go and the organisation's index is written again; a live or still-linked venue is refused) and `purge-tick` (daily 04:30 Europe/Sofia, per organisation: venues 30 days in the bin, binned menus, deleted areas and tables after 30 days, versions by the rule, events past 61 days); each purge is one transaction on the purge role plus a content-free `purge_log` row and a job run; the purge pool is opened per run; registered only with `DATABASE_URL_PURGE`. Migration 0026: `places.table_id` is set to null when its table is purged (column-list SET NULL). Archived tables keep their token until the purge (the file goes at deletion; a reactivated till place comes back without a code). Web: `purgeVenueAction` (owners, typed name, venue in the bin) queues `purge-venue`; S3 builds the button. Not done: a removed POS instance's data (D91(2)) waits for S1's remove-instance flow, which decides what "removed" is.
  - **ad/05 built 10-13** (`ad/05-sync-colours`, on ad/04): per-venue sync and the colour engine (D82, D96, T76, D93). Sync: `venues.settings.sync` = {mode auto|manual, incremental_minutes, full_pull_time} (`VenueSyncSettingsSchema`, writer `setVenueSyncSettings`); the worker's tick asks `venueSyncSchedule` per venue (its own, else the integration's schedule of before) in the VENUE's time zone; the rollback pause is the venue's (`settings.publish.auto_paused`, writer `setVenueAutoPublishPaused`; the integration's old flag counts until the venue has its own); the `new_items` rule is retired (read and ignored; nothing is held). The one-read-at-a-time-per-connection lock is what coalesces venues of one catalogue; no per-catalogue scheduling was added. Colours: ten extended roles (`EXTENDED_ROLE_NAMES`: error, error_text, success, success_text, disabled_text, selected, selected_text, focus, backdrop, border_strong) derived by `deriveRoles` around the eight of D70 and checked by `validateRoles` (`EXTENDED_PAIRS`: text 4.5:1, controls 3:1), optional in the snapshot schema (old snapshots valid); the shell passes them to faces (`SemanticColours` optional fields, a failing extended role is dropped rather than repaired); a face manifest declares `colour_pairs` and the contract harness checks each pair in both schemes of every fixture and refuses raw inline colours (R13); the Editorial Market declares its eight pairs; the face's own mixes move to the new roles in S7 (D1). Not done (D93 should): dark-screen chroma loss, APCA, `prefers-contrast: more`; the brand-first colour card is S7's.
  - **V1's restore relink built 10-13** (`ad/05-sync-colours`): deleting a venue remembers the till venue it served (`venues.settings.till_before_delete`); a restore links it again when it is still free (its tables and codes come back with the next publish, D86) and is refused with `till_taken`, naming the venue that holds it, when another venue serves it now; nothing changes on a refusal. The restore queues no file job any more: the venue comes back unpublished and the publish brings its files back. `ProvisionError` carries `details` (the holder's name) for the screen's wording. Deleted venues' texts in BG and EN say so.
  - **Pair B briefs written 10-13**: `docs/agent-briefs/s3-organisation.md` (Organisation › General with the name and the address name through Better Auth's server API, the venue address row on the `/m/<organisation>/<venue>` form, Deleted venues with the erase date and Delete permanently) and `s4-venue-settings-publishing.md` (the three tabs, the Publish bar with the count, the confirmation and the per-menu dropdown, the warnings under the header, Settings General / Publish / Versioning, the Menus list with its bin; Opus, the widest screen package). The deleted-menus bin moved from S3 to S4 so one agent owns the menu actions; Design stays a tab until S6.
  - **Pair C and D briefs written 10-13**: `s5-tables-qr.md` (Sonnet: areas as sections with table cards, hand-made create/rename/delete, the route picker per area and table over `setMenuRoute` + the token job, the read-only address card of D94), `s6-composer-structure.md` (Opus: Structure/Design subtabs and `?menu=`, the section `layout` field published as `hints.layout`, the menu layout and guest switch in the snapshot replacing the three template options, hand-made full edit, POS mapper rules, the stale-override badge), `s7-composer-design.md` (Sonnet: collapsed template chooser, the cards in Martin's order, brand-first colours with Advanced, sticky preview), `s8-wording.md` (Haiku: the `{source}` pass, BG/EN parity, the baseline lowered, `docs/i18n-review.md` for T44). D93 points 4–6 stay the lead's.
  - **Pair A merged 10-13** into `ad/foundation` (ad/05 at 9e4fa13, then `ad/s1-integrations` 6a48628, then `ad/s2-venues` c4b5484; each green on CI on its own branch first). Lead's fixes on the way: the V1 restore relink, Unpublish withdraws the table files (D86), the publish spec reads the venue's pause flag, the reported table codes are sorted in code (the collation trap), S2's two instance reads leave removed instances out (D81). For Martin's acceptance on port 3000: `restro_accept` needs migration 0027 (his), then New venue from the instance and by hand, the cards' states, Unpublish, Settings › Integrations with the systems picker, instance panel and the Menu source card.
  - **Pair B merged 10-13** (`ad/s3-organisation` 2492a9b, `ad/s4-venue-settings` 89064aa, each green first; foundation 6281e3c), then the lead's `ad/06-publish-fixes` (09a9d33: the venue index follows the live menu only, D88; saving the publish rules keeps the pause, T76) at d17557d. CI's job timeout raised 25 → 40 minutes (the Playwright suite is 303 tests, ~24 minutes).
  - **Pairs C and D merged 10-13** (`ad/s5-tables-qr` 05b2418 green at foundation 90eefe5; `ad/s6-composer`, `ad/s7-design` and `ad/s8-wording` stacked and merged together at 1dca042 from S8's green run e54e784). Lead's decisions on the way: a menu that set no layout publishes as before D92 (two columns, guest switch on; `DEFAULT_MENU_LAYOUT`); the item sheet reads the menu the composer has open; the panels and the page are tints of the brand colour (`suggestHarmony` monochrome); the "strong outline" clause of the pale-highlight note waits for a face that draws `border_strong` (D93 point 2); the first section's first three photos load eagerly whatever its layout. Vendor words in the messages down to one per language (`publish.actor.sync`: the actor view needs the instance label). E2E hardening: the keyboard reorder (T75) settles after reloads and the composer group restores the demo order, so its failure no longer cascades into the guest spec; the guest spec lays the page out whole before measuring; the faces preview sets a look through the three colour boxes. Follow-ups for wave 3: `RoleOverridesSchema` accepts the D93 roles (Advanced shows them read-only); `menus.name` in the snapshot (the header name); the web queues the purge before the worker made its queue (`venue_purge_not_queued` in the e2e log); "Guest features" → Martin's "guest functions" (T44); `server/item-sheet` and the composer share `?section=`; hand-made items placed nowhere appear in every menu's Unsorted.
  - **D91 point 2 built 10-13** (`ad/s9-instance-purge`, S9): the purge tick erases a POS instance 30 days after its removal (`INSTANCE_BIN_DAYS`; worker `purgeInstance`): its places, till venues and job runs, the items that came only from it and no menu places, its sections that sit in no menu any more, its links and records, then the instance row with its credentials; a placed item and any section in a menu (binned ones too) stay without their link; a venue linked to it skips it; a record a kept item's till value cites keeps the record and the row until no menu uses the item (foreign key). A restore never relinks a removed instance (`relinkTillVenue` answers `missing`).
  - **Wave 3 closed 10-13** (foundation 30b6926): the mirror `docs/architecture/data-architecture.md` updated (S10; its report lists the statements the live doc takes over), the acceptance guide `docs/adjustments/adjustments_01-acceptance.md` for Martin, the e2e worker runs the real purge in CI, the demo's first section is the strip, scratch databases and agent worktrees cleaned up. **Open after acceptance, lead items:** (a) `RoleOverridesSchema` accepts the ten D93 roles, so Advanced can adjust them; (b) `menus.name` in the snapshot and the face header; (c) `publish.actor.sync` names the instance (the actor view carries the label; the last vendor word in the messages); (d) photos of purged items (T53); (e) the restore/removal race (a removal whose venue check runs just before a restore commits can leave a link; the purge then skips the instance); (f) a removed instance's sealed credentials stay while a venue still uses its items (the purge role cannot update the row; clear them at removal instead, D81 to amend); (g) `stack.md` needs S10's pass (purge role, retention, P38 wording); (h) stale comments: `venues.slug` "not unique" in `schema.ts`, `purge_log.subject_id` for versions, the doc's `barsy:<integration>` source prefix (the code says `till:`); (i) "Guest features" → "guest functions" (T44); (j) the composer and Settings share `?section=`; (k) hand-made items placed nowhere show in every menu's Unsorted.
- [ ] T78. **D75 follow-ups** (D75 built by CF-17, merged into `sh/foundation` 10-11; mapping version 2, so the next pull of every venue is a full one and writes the names). Open:
  - **(a) A name typed in the manual layer on a till item ranks below the till's stand-in.** `name` is `source_first` (override, then till, then manual), so a manual bg_BG name typed while the till had none is hidden once the till's own name arrives. Typing in the item sheet writes an override, which wins, so the normal path works; Martin's acceptance data has no such names (checked 10-11). Decide whether a stand-in should rank below the manual layer (a resolver or marker change) before a pilot venue has typed names.
  - **(b) Sections cannot be renamed in the composer,** so a section's warning can only say "fill in the public name in the till".
  - **(c) A public name only in a language the installation does not hold** gets the stand-in from the mapping but no composer warning (the loader cannot see the installation's languages) — Claude
- [ ] T77. **Rename and delete venues** (Martin 10-11: "I should be able to delete venues as well / edit names; ensure proper database operation and middleware handling"). Built by CF-18 to D76: a venue's name becomes editable next to its address; deleting archives the venue (migration 0017 `venues.archived_at`), releases its till link, withdraws its guest page and table files, and stops sync and publishing for it; owners restore it from Settings › Deleted venues. Every admin read, core writer and worker job treats an archived venue as gone; the sign-in gate (`proxy.ts`) stays a cookie check, the venue checks run on the server — Claude
  - **Built by CF-18, merged 10-11** (migration 0017; core `renameVenue`, `archiveVenue`, `restoreVenue`, and `lockLiveVenue` in every writer of one venue; `apply()` locks the tenant's venue rows `FOR SHARE` and refuses a deleted venue's scope and menu nodes; the worker removes `v/<code>.json` and the venue's `t/<token>.json` files, re-checking after each write so the last run matches the database, and skips syncs and publishes of a deleted or unlinked venue; `restro_accept` migrated to 0017). Lead accepted two additions: the Publish tab stays enabled with an "address is switched off" notice when the venue index is missing (a restored venue's menu equals the live one); the guest page's unknown-venue text is now "This menu is not available".
  - **Open (a): a delete while the queue is down** leaves the guest files online until the owner restores and deletes again; give the deleted-venues list (or a periodic check) a way to withdraw them again.
- [ ] T76. **The rollback pause is per integration, not per venue** (found by CF-09b, 10-11). `publish.auto_paused` still lives in `integrations.config`, so a rollback in one venue pauses automatic publishing for every venue on the account. Move it to `venues.settings.publish` like `after_sync` (D73), with the same fallback — Claude
- [ ] T75. **Worker queue tests time out when the machine is busy.** `apps/worker/tests/worker.integration.test.ts` (`afterAll`, 60 s) and `sync-queue.test.ts` ("a job travels the queue end to end") failed a few times on 10-11 while 2–3 agents ran gates at once. Alone they pass in about 16 s. Check CI. If it shows the same, give these suites more time or a pool of their own. This is not a weakening: the assertions stay — Claude
  - Gate on `sh/foundation` after the merge: green. The worker integration suite's teardown once timed out (60 s) while three agents loaded the same local Postgres. Alone it passes in 19 s. Watch for it in CI.

  — Claude
- [x] T72. (done 10-11 by the lead, after Martin saw a new venue list Demo Club Sofia's 115 till items, nameless and priceless, in its Unsorted: `loadUnplacedItems` now lists an unplaced item only when the till read it for this venue (a value scoped to the venue) or when it is hand-made and placed nowhere yet; on the acceptance data the new venue's Unsorted went 115 → 0 and Demo Club's stayed 11. Left as is: a hand-made item placed nowhere shows in every no-till venue's Unsorted until one places it.) **Hand-made items need a venue** (found by CF-01, 10-11): items belong to the organisation, and "Unsorted" lists items placed in none of *this* menu's sections, so a hand-made item of venue A appears in venue B's Unsorted and can be dragged there. Invisible with one venue; real now that venues can be created. Fix with the neutral-tables work (CF-05): a hand-made item records its menu (or Unsorted = placed nowhere in the tenant), plus a test — Claude
- [ ] T73. Composer role gates are uneven: creating items and menus is owner/admin only (CF-01), creating sections and other composer writes are not gated. Decide one rule (recommend: all composer writes owner/admin, like publishing) — Claude, with CF-09
- [ ] T71. **How barsy shares items between venues** (Martin 10-11: "has to be checked with the architecture that barsy builds by itself… if the structure is flipped (item{venues:2,3}) that's a different story"). Recorded 10-11 (`fixtures/demo/articles-bid102-page1.json`, `articles-bid102-menu72.json`, `articles-bid10-menu72.json`):
  - items live in **catalogues** (`menu_id`); each barsy venue points at one catalogue (`Barsys_getlist.menu_id`: Bar & Dinner 1, Burgers 72, others 70/10/40);
  - different catalogues hold different items (catalogue 72 = ids 7403…, no overlap with catalogue 1), and an unfiltered list returns the same items with the same prices whichever venue asks;
  - every item carries a per-venue "for sale" map (`is_for_sale_barsys`), e.g. `{"1":"1","10":"1","70":"1","102":"1"}` on catalogue-72 items. That is barsy's own "item → venues" structure, and our mapping already reads it correctly (`catalogue.ts:307`).

  **Verified in the official docs, 10-11** (Martin signed in; the lead read the pages):
  - [Търговски обект](https://docs.lukanet.com/barsy.help/210-dictionary/barsy.html): a venue's catalogue is "a shared or individual set of articles". Example given: a restaurant and a bar with their own tills and stores that "may share one catalogue". **So two venues can share a catalogue.**
  - [Articles_getlist](https://docs.lukanet.com/barsy.api/methods/articles/getlist.html):
    - `menu_id` is "the catalogue the article belongs to";
    - `article_name` is unique within a catalogue;
    - `is_for_sale_barsys` = "exceptions per venue from the base `is_for_sale` flag (0 cannot be sold, 1 can)". Our reading "the venue exception wins" (`catalogue.ts:307`) is right; B1-F7 is closed;
    - `actual_price` = base price from the catalogue, with no discounts or promotions;
    - `current_price` = price after price rules, "in the context of a specific till/client" (filters `pos_id`, `client_id`, `client_group_id`, `delivery_type_id`, `currency_id`);
    - `delete_flag` is a filter (default 0), so deleted articles *can* be listed with `delete_flag: 1` (B1-F8/L5);
    - `order_by: cat_weight_deep` = the article's weight in its category, limited to the `cat_id_deep` subtree (B1-L8).
  - [Ценово правило](https://docs.lukanet.com/barsy.help/210-dictionary/pricelist.html): a rule applies by what (article, category, whole catalogue), when (dates, weekdays, hours), **where (venue)** and for whom (client, client group, country, delivery type); the more specific rule wins. **So prices can differ per venue and by time of day.**

  Proposal: follow barsy:
  - one Restro item per barsy item;
  - per-venue sale state and price stored per venue (the till layer already does this);
  - read and "deleted" checks per catalogue, not per venue (fixes A2's rule-6 concern).

  Refined after the docs:
  - article links are installation-wide, because article ids are unique per installation;
  - each venue's pull reads prices and for-sale in that venue's context and writes them venue-scoped (as today);
  - absence is concluded per catalogue (`menu_id`) from a complete read of it;
  - open design point for CF-05/CF-07 (Opus): venues sharing a catalogue may pick different category roots, so the "complete read" unit must be the catalogue, not the chosen root;
  - `current_price` depends on the till (`pos_id`) and the time. Which till context we read in, and how time-based rules ("happy hour") reach the menu, is part of the architecture doc's "Prices that change by time" — re-check it in CF-07.

  Martin's direction 10-11: follow barsy's own structure. Decides the sync unit in CF-05/CF-07 — Claude
- [ ] T69. **Mistral Software (mistral.bg, Zamboo) as a second till** (Martin asked 10-11). *10-21: now tracked as #48 (the single Mistral list); the connector gets its own spec when Mistral answers (D122).* Desk research 10-11: no integration hub found that covers barsy or Mistral (Deliverect, HubRise, GetOrder, Bitebell list neither); barsy has public API docs, Mistral has none online (its integrations page is "under construction"); TabL.bg (Bulgarian QR menu) integrates "where the POS provides an API" but names no tills; Digital Box groups barsy, Mistral, Microinvest and TabL as members, with no shared integration layer found. Next: ask Mistral (office@mistral.bg) for API documentation, a test installation and terms, as with barsy (T39) — Martin
- [ ] T63. Tags follow-ups: the shell passes a tag's colour and the venue's tag order to the face (snapshot tag entry gets an optional `order`; `ViewTag` gets `color`); make the colour required at `menu-snapshot/2` — Claude (small task)
- [x] T64. (10-10: keyboard and mouse drags wait for the save response; web component tests get 15 s and Testing Library waits 5 s; the tables e2e works beside the real worker; `worker.integration` db:roles race still seen once — reopen if it recurs) Test flakes: `worker.integration.test.ts` fails now and then in the full run (concurrent `db:roles`, "tuple concurrently updated"); keyboard drags in `composer.spec.ts` now wait for the save response (fixed 10-10) — Claude
- [ ] T65. `/t/<token>` keeps an optional `lang` (and any future guest parameter) when it redirects to `/m/<slug>` — Claude (Haiku)
- [ ] T66. Tables tab grouping and which places get a QR code (Martin asked 10-11). Today the tab groups by barsy's hall *name* (`salon_name` from `Places_getlist`) and codes every non-deleted place of the mapped barsy venue. Seen on the demo ("Bar & Dinner", 92 places, 11 halls):
  - five different halls are all called "Нов салон" and merge into one group → group by `salon_id` (kept in `places`), show the name;
  - every hall has a `--` place numbered 0 (`place_type` 1, 11 in all) — the "Table 0" seen in acceptance; what barsy uses it for is not documented in what we read → ask Lukanet (T39), hide from the tab until known;
  - not every place is a table: `type_name` Маса 30, Бар стол 28, Клиентски пейджър 10, Билярд 8, Стая 5 → store `place_type`/`type_name`, and the venue picks which types get codes (default: tables and bar stools);
  - the type is not reliable alone: the demo's "Burgers" venue has a hall "Пейджъри" whose 10 places are typed Маса → the venue can also switch off a whole hall;
  - non-public places (`is_public` 0) are listed and coded too → no code unless public;
  - all 5 demo venues have halls (recorded 10-11: `fixtures/demo/places-bid{10,102,70,1,40}.json`); every hall of every venue has exactly one `--` place 0, so it looks automatic;
  - sort halls by barsy's `salon_weight` if the docs confirm it is the hall order.

  **Docs, read 10-11:**
  - [Places_getlist](https://docs.lukanet.com/barsy.api/methods/places/getlist.html): places are "tables, bar stools, rooms, courts, billiard tables, booths — any physical object that can be occupied or reserved"; `length` defaults to 10000 (effectively unpaged); there are filters `salon_id`, `place_type`, `is_public` and `salon_delete_flag` (deleted halls exist).
  - [Настройки на места](https://docs.lukanet.com/barsy.help/110-admin/180-settings/places/scheme_editor.html):
    - a hall's **weight is the hall order** (`salon_weight`, confirmed);
    - **every hall gets one default place automatically**, editable. That is the `--` place 0, so hide it by default;
    - **place types are defined by each venue** (example "Сепаре" = booth, with seats). So "which types get codes" must be chosen per venue from that venue's own type list, not a fixed list. Defaults: types named like table or bar stool pre-selected, everything else off.

  — Claude (Sonnet), in CF-10
- [ ] T50. One section per barsy category per integration: two of our venues on the same catalogue root would share sections — revisit when a second venue joins. Same for the job queue key (per integration: a second venue's pull is dropped while the first is queued) and the absence check (runs only with exactly one mapped venue) — Claude
- [ ] T57. Photos hosted outside the barsy host (demo: 3 of 53 on `imagedelivery.net`) are refused today. Lead's recommendation: a `BARSY_PHOTO_HOSTS` allowlist, fetched **anonymously only** (credentials only ever go to the integration's own origin) — Claude, after checking real venue data
- [ ] T58. Worker housekeeping: README "The worker" env table (BARSY_*, ASSET_STORE, R2_*, `.env.worker.local`); a start-up sweep that fails job runs stuck in `running`; `places.state_changed_at` (today `updated_at` stands in); decide whether the worker declares the AWS SDK instead of tsup bundling it; date-fns/@date-fns/tz vs the `Intl` code the sync uses (CLAUDE.md says date-fns) — Claude (Haiku/Sonnet tasks)
- [ ] T59. (photos: done 10-10, all 52 demo photos fetched from `files_get` into R2; which auth path was used is not logged) Verify on the real demo: whether `files_get` photos need Basic auth (the job tries anonymous first), multi-method requests with two calls of the same method (supplements go one call each today), `order_by` `cat_weight_deep` — Claude
- [ ] T40. Doc updates: "Core rules" section; QR-phone-only scope; polling; Supabase; trace 4 manager-only; barsy corrections; new "Stage plan" tab — Claude
- [x] T37. Supabase organisation "Restro" + project `restro-staging` (created in West EU/Ireland, D54) — Martin, 10-09; Data API toggle not found in his dashboard: not critical (no API role can reach our schemas, verified)
- [x] T38. barsy demo credentials received — Martin, 10-09 (in `.env.local`)
- [ ] T39. Send the Lukanet test-environment request (draft by Claude, includes Q41, Q60, Q71) — Martin
- [x] T41. Answer Q72 (Synex code reuse) — Martin, 10-08: yes

**Before Stage 2 / 3**
- [ ] T25. Platform accounts by stage: before Stage 2 the pilot venue's read-only API users (Q73); before Stage 3 Railway (EU West), main domain, Cloudflare (R2 with EU jurisdiction, `cdn.` domain, token), Sentry (EU region), Resend, Telegram bot, Supabase `restro-prod`; the short QR domain waits for P53 — Martin (click-by-click guide from Claude)

**Carried over**
- [ ] T9. Send Lukanet the consolidated questions (Q47, Q55, Q58, Q49/Q38, Q48, Q52, Q56, Q57, Q59, Q60, Q71, Q21, Q41/Q28, Q24, Q46, Q53) — the test-environment request goes first and separately (T39); one paid hour (€130 + VAT) only for what stays open — Martin
- [ ] T13. Ask one pilot-club owner to request the "software resource" price from Lukanet (Q25, Q29, Q41) — Martin
- [ ] T33. Send the lawyer/accountant questions (Q8, Q62–Q67, Q42, Q10, Q70) — Martin
- [ ] T29. Write the orders and payments spec into the doc: table sessions, orders, order lines (price shown vs billed), shares, payments, refunds, payment inbox, money events, state machines, failure table per route, live-night safety kit, receipt delivery — Claude; skeleton before Stage 4, details after T9/T33
- [ ] T31. Guest privacy notice and terms; data processing agreement with each venue — Martin + lawyer, before the first guest
- [ ] T17. Martin's remaining decisions: P41–P43, P46, P48–P50, P52, P53, fee reimbursement (P10, after Q25); veto window on D50 defaults
- [ ] T20. Read the 2021 food-information ordinance (lex.bg, needs a browser) or ask the lawyer (Q42) — Claude can read it in the built-in browser
- [ ] T21. Research what data barsy can provide for venue stats (logged-in API docs, "Справки") — Claude + Martin
- [ ] T23. Research whether translations can be written into barsy articles (D26, Q46) — with T21
- [ ] T24. `Accounts_place` note/name fields found (alias/description/notes); what prints on bar tickets still open (P37, Q52)
- [ ] T3. Pilot-club interviews: owners + waiters (Q1–Q4, Q12, Q43, Q45, Q54, Q68, Q69, allergens in barsy, reaction to waiter confirmation and the resource fee) — Martin
- [ ] T34. Visual design (U1) for the guest flow and venue admin — guest templates are designed in the repo (D105, first one T87); admin follows the Platform patterns and D107
- [ ] T27. Monthly restore drill from the backups — once live
- [ ] T4. Test barsy's QR menu + one other BG QR app live; document UX failures (tests H3)
- [ ] T6. Accountant check (Q8) — folded into T33; ask Happy Bar & Grill / its POS vendor how their phone-payment receipt is issued
- [ ] T10. Design group checkout / split flow in detail — inside T29, after P42
- [ ] T12. Delete the 3 superseded v1 FigJam boards — Martin
- [x] T28. Design the stack and add it to the knowledge base — done 10-08; amended at kickoff (D43)
- [x] T18. Fold Martin's 10-08 decisions into the Menu Engine doc — done 10-08
- [x] T14, T1, T15, T16, T8, T11 — done
- [~] T2. Lukanet contact — written reply 10-01; next contact = T39, then T9

## Hypotheses (unvalidated)
- H1. Clubs lose orders on busy nights waiting for waiters
- H2. Waiting for the bill to pay by card is a major pain
- H3. Most BG ordering apps are badly designed, which may explain low adoption (caveat: owners buy, guests use)
