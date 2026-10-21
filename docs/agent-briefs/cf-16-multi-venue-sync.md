# Brief CF-16: several venues on one barsy account, read the way barsy keeps its data

- **Model:** Opus 5.5 (the sync rules are the delicate part of the product: rule 5 and rule 6).
- **Branch:** create `cf/16-multi-venue-sync` from `sh/foundation` yourself.
- **Tasks and decisions:** T50, T67, T71 (its "Verified in the official docs" and "Refined after the docs" parts are the facts you build on), T62, D64, D66, D67, D73. Read their full text in `docs/tracker.md` by number.
- **Runs in parallel with:** CF-09a (sidebar and an empty Settings page in `apps/web`). Do not touch `apps/web/src/components/admin/**`, `apps/web/app/(admin)/layout.tsx` or `apps/web/app/(admin)/settings/**`.

## Why

Martin (10-11): Integration is organisation-wide, and barsy venues become Restro venues of their own (D73, CF-09b next). Today the sync assumes one linked venue:
- the pull jobs are keyed per integration, so a second venue's pull can be dropped while the first is queued (T50);
- absence (rule 6) is concluded only when exactly one venue is mapped (`sync/data.ts` `mappedVenues`, `sync/catalogue.ts` ~579), so with two venues deletions are never noticed;
- sections come one per barsy category per integration, so two venues on the same catalogue would share sections (T50);
- a venue's tables are read only by a full pull, which waits for a catalogue root (T67).

barsy itself (T71, verified in barsy's docs): items live in **catalogues** (`menu_id`); each barsy venue points at one catalogue and venues **can share** one; every item has a per-venue for-sale exception map (`is_for_sale_barsys`, already read right in `packages/barsy/src/mapping/catalogue.ts`); prices can differ **per venue** and by time (price rules); article ids are unique per installation.

## Read first

1. `CLAUDE.md`, `docs/decisions.md`.
2. `docs/architecture/data-architecture.md`: only "Collection path C: Barsy onboarding and the full pull" (with "The full pull, per venue"), "Collection path E: Barsy reconciliation" (with "Prices that change by time"), "Barsy to canonical mapping", "Identity and linking" (with "Link lifecycle", "Tables").
3. `docs/reviews/connector-architecture/readiness.md`: "barsy's own item structure (T71)" and the CF-05 / CF-07 rows of the roadmap (you do a focused part of them; do not do the whole engine extraction).
4. Code: `apps/worker/src/sync/**`, `apps/worker/src/jobs/barsy.ts`, `apps/worker/src/publish/after-sync.ts`, `packages/barsy/src/mapping/**`, `packages/barsy/src/read/**`, `packages/db/src/schema.ts` (`integrations`, `barsy_venues`, `places`, `source_links`), `apps/web/src/server/integration/service.ts` (only where it reads or writes what you change).
5. Fixtures `packages/barsy/fixtures/**`: `barsys.json` (venues and their `menu_id`), `articles-bid10-menu72.json` and `articles-bid102-menu72.json` (two venues on catalogue 72), `places-bid*.json`.

## What to build

**First, a design note** (at most one page) in `docs/reviews/connector-architecture/cf-16-design.md`: the sync units, the job keys and locks, where each state lives, what a complete read is, how absence is concluded, and what changes in stored data. Commit it before the code, and keep it true to what you build.

1. **The catalogue on the link.** Store each barsy venue's catalogue (`Barsys_getlist.menu_id`) on `barsy_venues`, refreshed whenever the venue list is read. Migration 0016, expand only (nullable columns, no rename of existing ones).
2. **The price per venue (D73).** Which barsy price a venue's menu shows (`actual_price` or `current_price`) becomes a per-venue setting on its link row, backfilled from today's `integrations.config.price_source`. The worker reads it per venue, and reads prices and for-sale **in that venue's own context**, as today. Until CF-09b moves the control, make the existing Mapping card's price choice write the setting of the venue it is shown in (smallest change in `server/integration/service.ts`). Document in the design note how time-based price rules relate (the architecture doc's "Prices that change by time"); do not solve happy hours here.
3. **Units of reading:**
   - **Items** stay one per barsy article for the whole installation (article links installation-wide); sale state and price are written venue-scoped (the till layer's venue scope, as today).
   - **Sections** become per venue: two venues on one catalogue each get their own sections from the categories under their own root (T50). Existing single-venue data must keep its sections and their ids (no churn for the demo venue): design the link keys so today's links stay valid.
   - **Jobs:** keyed so that two venues' pulls never drop each other (per venue, or per catalogue for the catalogue-wide read). Keep one pull at a time per installation if barsy's limits need it, and say why.
4. **Absence per catalogue (rule 6, T71).**
   - Items are concluded absent only from a **complete read of the whole catalogue** (`menu_id`), not of a chosen root: an item outside venue A's root but still in the catalogue is not deleted.
   - Sections are concluded absent per venue, from a complete read of that venue's root.
   - CF-02's holds (an empty read, or one that would hide more than 30% / 5 items) apply per catalogue and per venue.
   - Remove the "exactly one mapped venue" limit.
5. **Tables at mapping time (T67).** Read `Places_getlist` for a mapped barsy venue as soon as it is mapped, independent of the catalogue root: the worker's tick finds mapped venues whose places were never read and reads them. No web change.
6. **Schedule.** One schedule per integration (D73: organisation-wide), its daily full read in `Europe/Sofia` unless the integration says otherwise. Keep today's stored settings working; the new screens come in CF-09b.

## Tests

- **Property tests (fast-check):**
  - rule 6 per catalogue: never conclude absence from an incomplete catalogue read, nor for an item outside the read catalogue;
  - two venues on one catalogue with different roots: no item of the catalogue is deleted because one venue's root does not hold it;
  - rule 5 stays: our layers never put back on sale or reprice.
- **Integration tests on Postgres:** two venues mapped to bids 10 and 102 on catalogue 72 (the recordings); per-venue sale state and price; separate sections; neither pull drops the other; a recreated or deleted item is concluded once per catalogue.
- The demo venue's existing data: a migration test that the demo's links, sections and published snapshot hash are unchanged after 0016 and one sync.
- Follow CLAUDE.md's two tiers. DB tests on your own database `restro_cf_16` (54329). Known slow worker tests: run alone once if they time out (T75).

## Never / scope

- Only barsy read methods that already exist and are doc-checked in `packages/barsy` (`Barsys_getlist`, `Articles_getlist`, `Places_getlist`, the category tree and the others there). Need anything new, or a barsy behaviour the docs do not state: stop and ask. Rule 7: no writes to barsy.
- No UI work beyond the price write above; no engine extraction into `packages/connectors` (CF-07 later).
- Guardrails only tighten (D67): no weakened rule-5/6 test, dependency rule or vendor-word baseline. Never read `.env.local`. Files LF.
- Commit as you go (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push.

## Report

CLAUDE.md format, at most one page, plus the path of the design note, the migration's name, and what CF-09b must know (the settings it will move and where they now live).
