# Adjustments 01: the work-package plan (approved by Martin, 10-12)

## Context
Martin's 10-11/10-12 feedback became decisions D83–D97 and `docs/adjustments/adjustments_01.md`. The lead reviewed that file against CLAUDE.md, the tracker and the code on 10-12: the framework is sound; stale facts were corrected and CI now runs on `ad/**` (branch `ad/foundation`, commit ae19727, not pushed). Martin then settled two rule questions and five design refinements (below). This plan says what gets built, in which order, by whom, and which migrations it needs. After Martin's OK the lead writes briefs, builds the foundations itself, and runs at most two agents at a time.

## Settled on 10-12 (written down in wave 0)
- **DELETE rule, precise.** The app role may DELETE only `placements`, `field_values` and `source_links`, through `apply()`, plus Better Auth's session and verification rows. Erasing venue data, or anything in bulk, is only the purge job's, through its dedicated role `restro_purge`. D83 and CLAUDE.md's never-list are corrected to say exactly this (Martin approved the CLAUDE.md edit); `packages/db/src/table-access.ts` gets the same sentence.
- **Untagged till text.** Its language stays a barsy instance setting (`integrations.config.default_locale`, default `bg_BG`, shown only in the barsy tab, D82). D77 is corrected: only the venue's main language moves to the venue. barsy's `lang_id` is revisited once its docs are read (new tracker item).
- **Design refinements:** (1) one published index per organisation, `o/<organisation>.json`, with current names, old names and the internal code, plus redirect files for renamed organisations; CDN cache delay on renames is documented. (3) the live menu is `venues.live_menu_id`, not a flag on menus; the venue's design is copied into every menu's snapshot at publish. (4) a POS venue in manual sync mode still receives shared item changes from other venues' reads of the same catalogue; only its own reads, venue-scoped values and publishing are manual. (5) never purge a snapshot a kept rollback row points to, nor the live one; keep a content-free purge log; a purged venue's address name may be reused inside its organisation, its public code and table tokens never.

## Waves and packages

### Wave 0: housekeeping (lead, Fable, branch `ad/foundation`)
Tracker: task T79 "Adjustments 01" listing the packages; D83 and D77 amended; the DELETE sentence in CLAUDE.md; one-line changes in `docs/decisions.md`; new "not decided" item for `lang_id`. Nothing else.

### Wave 1: foundations (lead codes them, Fable; one task branch each, CI green, merged into `ad/foundation`)
Invisible to Martin except through migrations; no acceptance round until wave 2.

**ad/01 schema and roles** (owns `packages/db/**`): migrations 0018–0023 below, `table-access.ts` with a new `purge` privilege list per table, `scripts/roles.ts` creating `restro_purge`, tests `app-role`, `rls-guard` and a new `purge-role` test pinning both roles. Worker config gains `DATABASE_URL_PURGE`, used by the purge job alone.

**ad/02 menus, languages, barsy roots** (owns `packages/core/src/apply/menus.ts` new, `provision.ts`, `languages.ts` new, `packages/barsy/src/mapping/**`, `apps/worker/src/sync/**`): several menus per venue with `live_menu_id`; add, rename, order, delete to the bin, restore, set live (publishes it, D90), import copy between hand-made venues; the one languages function (D77) with the connector report counted from barsy's `_ml` fields during a full pull; a guardrail test that lists the only files allowed to read `enabled_locales` (today 27 files read it; the test starts from that list and only shrinks). barsy: a venue's menus are its two roots, `public_cat_id` (live by default) and `cat_id`; the root picker and `catalogue_root_cat_id` are retired (column left null, dropped later). Demo Club Sofia in `restro_accept` is recreated after this merges.

**ad/03 routing and addresses** (owns `packages/core/src/guest-files.ts`, `menu-address.ts`, `apply/menu-routes.ts` new, `apply/venue-address.ts` new, `apps/worker/src/publish/**`, `apps/web/app/m/**`, `apps/web/app/t/**`, `apps/web/src/guest/**`, `apps/web/src/server/publish/**`): `menu_routes` (venue → area → table, most specific published menu wins, resolved by the publisher into `t/<token>.json` and `v/<code>.json`); the organisation index `o/<organisation>.json` and its redirect files; `/m/<organisation>/<venue>` reads only published files; old `/m/<slug>-<code>` and old names redirect; Unpublish (`venues.unpublished_at`) withdraws files; venue state Draft / Live / Archived computed in one core function. The guest page keeps `menu-snapshot/1`; new keys are optional.

**ad/04 purge and versions** (owns `packages/core/src/purge/**` new, `apps/worker/src/jobs/purge.ts` new, `apply/publish.ts` for versions): daily purge job plus "Delete permanently" on demand; tombstones for public codes and table tokens, checked by `provisionVenue` and the token generator; the content-free purge log; versions per D96 (live + up to 2, non-live purged after 30 days, never one a kept rollback row points to; change log 2 months); deleted menus purged after 30 days; a removed POS instance's data and unused items; custom-domain hooks left as a no-op until DM1.

**ad/05 per-venue sync and the colour engine** (owns `packages/core/src/sync-settings.ts`, `sync-schedule.ts`, `apply/venue-publish-rules.ts`, `apps/worker/src/jobs/barsy.ts`, `packages/core/src/theme/**`, `packages/shell/src/**` contract test): sync mode, interval and full-read time per venue in `venues.settings.sync`, scheduled per venue and coalesced per catalogue; the rollback pause per venue (T76); `new_items` rule removed. D93's new theme roles (status, disabled, selected, focus, backdrop, strong border), 3:1 control contrast, the rendered-pair contract test in the face harness; additive, old snapshots still valid.

### Wave 2: screens (agents, two at a time, each with a brief pinning wave-1 interfaces; lead reviews every diff)
| Package | Builds | Model | Owns | Pair |
|---|---|---|---|---|
| S1 Integrations (I1, I2, B6, B2 label) | systems picker, named instances, per-instance tab with connection/status/system settings/sync everything/history; Till venues card removed; venue Menu source card split into common part + connector part; refusals | Sonnet | `apps/web/src/integration/**`, `apps/web/src/connectors/**`, `app/(admin)/settings/integrations/**`, `apps/web/src/server/integration/**` | A |
| S2 Venues (V2, V4) | New venue in two steps (instance's venue or by hand), All venues card with state, instance, POS name, preview link; Unpublish | Sonnet | `apps/web/src/components/admin/new-venue-dialog.tsx`, `venue-card.tsx`, `app/(admin)/venues/page.tsx`, `apps/web/src/server/venues-actions.ts` | A |
| S3 Organisation and bins (V5, V3 forms, V1 UI, M1 bins) | Organisation › General (name, address slug through the Better Auth server API), venue address editor, Deleted venues with Delete permanently (typed name), Deleted menus in venue settings | Sonnet | `app/(admin)/settings/**`, `apps/web/src/components/admin/settings-sections.ts`, `venue-address.tsx`, `apps/web/src/server/auth.ts` (action only) | B |
| S4 Venue settings and publishing (P1, D97, M1 lists) | tabs Composer / Tables & QR / Settings (General, Publish, Versioning); Publish button top right with change count, confirmation, dropdown per menu with areas and counts; warnings under the header; Automation settings for POS venues; Publishing tab removed | Sonnet | `apps/web/src/publish/**`, `apps/web/src/components/admin/workspace-tab*.ts(x)`, `venue-settings.tsx`, `app/(admin)/venues/[venueId]/page.tsx`, `apps/web/src/server/publish/**` (reads) | B |
| S5 Tables & QR (T1, B5 UI) | read-only address card, areas as sections with table cards (name, number, code status, menu shown), rename/reorder/hide for POS venues, create/rename/delete for hand-made, routing picker per venue/area/table | Sonnet | `apps/web/src/tables/**`, `apps/web/src/server/tables/**`, `app/(print)/**` | C |
| S6 Composer › Structure (C1) | Structure/Design subtabs; hand-made full create/edit/delete; POS mapper (own sections, move items, order) and dictionary; vertical/horizontal sections; menu layout default + guest switch; "Overrides to review" badge; Guest features panel moved out | Opus | `apps/web/src/composer/**`, `apps/web/src/server/composer/**`, `packages/faces/editorial-market/src/section.tsx`, `manifest.ts` (options removed) | C |
| S7 Composer › Design (D1) | collapsed template chooser with phone pop-up; cards in order (logo + header name, guest functions, font dropdown/corners/shadow/screen, brand-first colours with collapsed Advanced); sticky phone preview | Sonnet | `apps/web/src/design/**`, `apps/web/src/server/design/**` | D |
| S8 Wording and guardrails | every settings text names the POS with `{source}`; BG + EN keys; vendor-word baseline lowered; i18n review list for T44 | Haiku | `apps/web/messages/*.json`, `scripts/vendor-words.baseline.json` | D |

Pairs run in order A → B → C → D; Martin accepts each pair on port 3000 against `restro_accept` before the next starts.

### Wave 3: end to end
Purge rehearsal on a throw-away venue in `restro_accept` (delete, restore with the till link refused when taken, Delete permanently, tombstoned code and tokens), version purge, instance removal refusal, the test-data recreation, the data-architecture mirror updated, final acceptance.

### Parked, as the adjustments file says
DM1 custom domains (provider), P-01, P-02, P-05's storing of `Languages_getlist`, P-06, P-07 (time zone, closing time), APCA licence, Q43, Mistral.

## Migrations (ad/01, in this order; `restro_accept` migrated locally, staging only with Martin's OK)
| # | Name | What |
|---|---|---|
| 0018 | integration_instances | `integrations.name` (backfilled "barsy – <host>"); `tenants.settings` jsonb with the chosen systems (backfilled from existing rows) |
| 0019 | menus_many | drop `menus_venue_id_unique`; `menus.name` (header, null = venue name), `sort_key`, `settings` jsonb (layout default, guest switch), `deleted_at`; `venues.live_menu_id` (backfilled from the one menu), `venues.unpublished_at`; app role UPDATE on `menus` |
| 0020 | areas_tables | new platform tables `areas` (`ar_`) and `tables` (`tb_`, name, number, sort key, hidden, `qr_token`); `places` becomes the barsy mirror with `salon_id`, `salon_weight`, `table_id`; existing places copied into areas (per salon) and tables, tokens moved so printed codes keep working |
| 0021 | menu_routes | one row per area or table with its menu; exactly one target per row |
| 0022 | venue_addresses | `venues.slug` unique per organisation (duplicates get a suffix), `venue_slug_history`, `organization_slug_history` |
| 0023 | purge | `tombstones` (kind, value; platform-wide unique), `purge_log`; role `restro_purge` with DELETE on venue-scoped tables only |

Settings that need no migration: `venues.settings.sync`, `venues.settings.publish.auto_paused`; `integrations.config.default_locale` keeps its key.

## Verification
- Each task branch: `pnpm lint && pnpm typecheck && pnpm deps:check`, the touched packages' vitest projects with `--reporter=dot`, database tests on a branch-named database on port 54329, then CI green before merge.
- Guardrails added, never loosened: purge-role test, app-role DELETE list test, `enabled_locales` reader list, vendor-word baseline only lowered, face contract test with the new colour pairs.
- Playwright specs updated by the package that changes the screen: `admin`, `venue-lifecycle`, `integration`, `publish`, `tables`, `composer`, `design`, `guest`, `navigation`, `no-till`.
- Acceptance per pair on port 3000: A new venue from barsy and by hand, Integrations; B Settings, Publish button, versions; C Tables & QR routing, composer structure; D Design; wave 3 purge rehearsal.
- Risks watched: CDN cache on renames (short cache on index files); the `places` → `tables` token move; recreating Demo Club Sofia after ad/02.
