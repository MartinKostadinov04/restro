# Brief S2-02: barsy read wrappers + mapping v1

- **Model:** Sonnet 5.5 · **Branch:** your worktree branch from `s2/composer`
- **Read first:** `CLAUDE.md`; `docs/architecture/data-architecture.md` → "Collection path C", "Barsy to canonical mapping" (+ "Corrections from the official docs"), "Identity and linking"; `docs/tracker.md` → D20, D24, D41, D42, D52, D55, D56, research facts "barsy API — verified"; `packages/barsy/src/read-methods.ts` (doc-checked notes per method — authoritative); the recorded fixtures in `packages/barsy/fixtures/demo/` (real responses; your schemas must accept them); `packages/core` change sets, `VENUE_MENU_TEMPLATE`, money, locales, allergens.

## Goal
Typed, Zod-validated wrappers for the nine allow-listed read methods, and **pure** mapping functions that turn barsy responses into (a) source-record descriptors and (b) a `ChangeSet` for `apply()`. No database, no jobs (S2-03 calls these), no network in tests (MSW + fixtures).

## Facts (from the lead's doc check + demo recordings, 10-09)
- Requests always carry `?bid=<venue>` for venue-dependent data. `Categories_getalltree` **only with `only_public: 1`** (0 needs a registered till). `Articles_getlist` requires `filters` (send `{}` at least); use `order_by: "cat_weight_deep asc, article_id asc"` with `filters.cat_id_deep = <catalogue root>` for barsy's own order and stable paging; extra properties as an object of `"1"` flags incl. `limits_by_barsys`, `ml_data`, `description_public`, `picture_url`, `article_details`, `categories`, `has_supplements`, `current_price`, `actual_price`. `Modificators_getlist` pages at 50 by default. Some responses have no `BARSY_REQUEST_ID` (cached) — fine.
- Prices arrive as JSON floats → the client's `parseBarsyJson` gives `DecimalString`; convert with core `decimalToMinor` (half-up). Store the price chosen by `config.priceSource` (`actual_price` default, P52 open); both raw prices stay in the source record.
- Names: `article_name_public_ml` per locale (empty string = missing) → else `article_name_public` for the default locale; **never** the internal `article_name` / `cat_name`. Section titles from `cat_name_public_ml` (`cat_name` is internal). Supplement options in `Articlesupplements_get` carry only the internal name → take the option's public name from the article list by `article_id`; none → leave the name unset (the resolver flags V3).
- Language keys: map barsy keys to core `LOCALES`; `sr_RS@latin` → `sr_RS`; drop unknown keys.
- Allergens: find the characteristic key whose name is "Алергени" (or "Allergens", case-insensitive) in `Articledetails_gettree` (demo: `k102`); parse its free text with a BG+EN synonym table → EU-14 codes (`gluten`, `milk`, …); unknown words → a warning (never guessed); no key/empty → no allergen write.
- `is_public` → `visible` (barsy layer); `is_for_sale` + `is_for_sale_barsys[<bid>]` (exception wins) → `for_sale` with **venue scope**; `delete_flag` = 1 → a link-state intent `deleted`; `is_service` = 1 → skipped (config flag `includeServices` default false).
- Pictures: `picture` + `picture_url` → an **asset request** `{articleExternalId, pictureName, url}` for S2-03's fetch job (the mapper never downloads, never writes a URL into a field).

## Interfaces (`packages/barsy/src/read/` wrappers, `packages/barsy/src/mapping/` pure mapper, exported from `@restro/barsy`)
- Wrappers: `getVenues()`, `getLanguages()`, `getCurrencies()`, `getCategoryTree(bid)`, `getArticlesPage(bid, {rootCatId, offset, length})`, `getSupplements(bid, articleId)`, `getModificatorsPage(bid, {offset, length})`, `getArticleDetailsTree()`, `getPlaces(bid)` — each returns `{ data, raw, requestId }` (raw text for source records) with Zod schemas built from the fixtures (`.passthrough()` for fields we don't use; strict on fields we do).
- `mapCatalogue(input, config) → { changeSet, sourceRecords, assetRequests, linkStates, warnings }` where `input = { venueId, bid, tree, articles, supplementsByArticle, detailsTree, languages }` and `config = { integrationId, catalogueRootCatId, priceSource, mappingVersion: 1, includeServices, jobId, actor, observedAt }`:
  - sections = the catalogue root's subtree (root itself = the menu root; children → sections, max depth 3, deeper categories flattened into their depth-3 ancestor with a warning), link type `category`;
  - items = articles, link type `article`, placed in every mapped category they belong to (mirror mode) with `setPlacement { sortKey: 'end', onlyIfUnplaced: true }` (S2-03 adds `onlyIfUnplaced` to `apply()` — so a re-sync never reorders the manager's arrangement; put the flag in the change-set schema now if missing, as an optional boolean);
  - modifier groups from `supplement_group_id` (min = `required ? 1 : 0` unless the response says otherwise, max = `max_selected`), options with link type `supplement` and `price_delta` from `supplement_price`;
  - all barsy-layer writes carry `sourceRecordId` (descriptor id) and `mappingVersion`; venue-scoped where the doc says (price, for_sale);
  - deterministic: same input → deep-equal output.
- `mapPlaces(places, ctx) → place descriptors` (stored by S2-03).
- Modificators (kitchen requests): map to source-record descriptors only in v1 (no nodes; shown later only if the builder enables them).

## Tests
Wrappers against MSW with every demo fixture; mapper tests on the real fixtures (bid 10): counts, a known item (e.g. "Кафе", article 11: `actual_price` 0.97 → 97 minor, `current_price` 0.63 → 63 when `priceSource = current_price`), names per locale with empty-string handling, `sr_RS@latin`, placements per category, the burger combo (article 7183) → one modifier group with options and deltas, allergen parsing incl. an unknown word warning, `is_for_sale_barsys` exception, `delete_flag`, determinism (fast-check: shuffled input arrays except tree order → same change set).

## Never / scope
Scope: `packages/barsy/**` (+ the optional `onlyIfUnplaced` flag in core's change-set schema). No DB, no worker, no network calls (do not run the recorder; do not read `E:\Restro\.env.local`). Commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push. Report as in `docs/agent-briefs/_template.md`.
