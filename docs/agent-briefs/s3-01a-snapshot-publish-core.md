# Brief S3-01a: snapshot schema, builder, leak guard, publish records (core)

- **Model:** Opus 5.5. Rules 3 and 5, and the published contract every face depends on. Kept to core and db; the files, jobs and photo variants are S3-01b (Sonnet).
- **Branch:** your worktree branch from `s3/guest`.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/architecture/data-architecture.md` → "Publishing and the snapshot contract" (publish policy, files, **snapshot shape**, "What a snapshot never contains"), "Validation and quality gates" (V9–V12), "The visualization shell" (only to see what the shell will need);
  - `docs/tracker.md` → D20, D24, D42, D45, D46, D59, D60 and the Stage 2 engineering notes;
  - `packages/core/src/resolve/*`, especially `types.ts`: `resolve()`, `ResolvedMenu`, `ComputedItemFields.badges`, `ResolveContext.firstPublishedAt`/`edition`, and `compareVisibility`;
  - `packages/core/src/field-definition.ts` (`VISIBILITIES`: `internal` fields never reach a snapshot) and `templates/venue-menu.ts`;
  - `packages/core/src/apply/*` (writers, `load-document`), `hash.ts`, `money.ts`, `locales.ts`;
  - `packages/db/src/schema.ts` and `table-access.ts`.

## Goal
A pure, deterministic `buildSnapshot()` that turns one resolved menu for one venue into the doc's `menu-snapshot/1` JSON. Strict allowlist schemas make it impossible to leak anything a guest must not see. Plus the database records of what was published (versions, current pointer, first-published dates, held publishes) and the writers that move them. No files, no jobs, no UI.

## Do
1. **Schema (`packages/core/src/snapshot/schema.ts`):** the doc's shape, written as Zod **strict** objects at every level (an unknown key fails).
   - **Ids:** every id is a prefixed id of the right kind (`sn_`, `nd_`, `vn_`, `as_`, `tg_`). No other id-like strings are allowed anywhere as keys.
   - **Contents:**
     - `schema`, `snapshot` {id, version, hash, published_at, menu_id, venue_id, edition}, `locales`, `currency`, `theme`;
     - `assets` {w, h, focal, alt, variants: {thumb, card, full}}, where the variant paths have the form `/a/<as_id>/w<n>.webp`;
     - `field_types` (public custom fields only), `menu`, `sections`, `items`, `modifier_groups`, `options`;
     - `tags` (the vocabulary `{tg_id: {label: LocalizedText}}`; empty until S3-06).
   - **Items:**
     - name, description, price `{amount_minor, currency}`, price_from, image, allergens, dietary, tags (tag ids only, those present in `tags`), portion, badges, availability, `order_mode`, `orderable`, modifier_groups, and `fields` (public custom fields by key);
     - **hidden items are left out**, and so are hidden sections, groups and options.
   - **Export:** `MenuSnapshot` type plus a JSON Schema export for faces.
2. **Builder (`buildSnapshot(resolved, ctx)`)**, pure.
   - **Context:** `{snapshotId, version, publishedAt, menuId, venueId, edition, locales, currency, theme, assets, tagVocabulary}`.
   - **What it reads:**
     - order exactly as the resolver gives it (sections tree, `itemIds`);
     - only fields whose definition is `public`;
     - money through `money`;
     - no provenance, issues, layers, override bases, review state or source info.
   - **Theme:** `theme` comes from the venue's settings when present, otherwise a fixed default (brand colour → palette is S3-03's; here only the token object passes through, validated).
   - **Hash:** SHA-256 over the canonical JSON of the snapshot **without** the `snapshot` header, so identical content gives the identical hash.
3. **Leak guard:** `assertSnapshotSafe(snapshot)` = strict parse plus a walk that refuses any string equal to a value from a provided `forbidden` set. The publisher passes every external id, internal field value and override basis of the document. Publishing refuses on any hit, with a precise error (path, without echoing the value).
4. **Database** (one migration, `table-access` privileges declared, RLS like the other tenant tables, composite foreign keys):
   - `snapshots`: `sn_` id, tenant, menu, venue, version (per menu + venue, increasing), hash, body jsonb, status `published` / `held` / `rejected`, reason `manual` / `auto_sync` / `rollback`, actor, created_at, published_at, `held_reason`.
   - `publish_pointers`: tenant, menu, venue, `current_snapshot_id`, updated_at; one row per menu + venue.
   - `item_first_published`: tenant, node, menu, venue, first_published_at; feeds `ResolveContext.firstPublishedAt` for the "New" badge.
   - Append-only where it should be: snapshot bodies never change; only `status` moves from held to published or rejected.
5. **Writers in `packages/core/src/apply/publish.ts`** (rule 1: only core/apply writes snapshots):
   - `publishMenu(pool, tenantId, {menuId, venueId, reason, actor, approveHold?})`:
     - load the document, then resolve it with today's service edition (the `edition` list per D45; S3-08 adds the writes) and `firstPublishedAt`;
     - build, then guard;
     - **V10:** no visible item → refused, with nothing written;
     - **same hash as current → no-op** (returns the current one);
     - **V11:** for `auto_sync` only, if `compareVisibility(current, next)` hides more than 30% of the visible items, insert as `held` with the reason and leave the pointer alone; a manual publish with `approveHold` publishes it;
     - otherwise insert `published`, move the pointer and record first-published dates for newly visible items;
     - **one transaction**, serialised per menu + venue (row lock on the pointer, or an advisory lock);
     - returns `{status, snapshot, previous}`.
   - `rollbackTo(pool, tenantId, {menuId, venueId, snapshotId, actor})`: the pointer moves to an earlier published snapshot of the same menu + venue; a row with reason `rollback` records it (no new body).
   - `rejectHeld(...)`.
   - Readers: `loadCurrentSnapshot`, `listSnapshots` (paged), `loadSnapshot`.
6. **Live overlay (pure):** `buildLiveOverlay(resolvedWithServiceEdition, current)` gives `{version, items: {nd_x: {sold_out: true}}}` for items in the current snapshot that the service edition takes off sale (`for_sale` false), and nothing else. S3-01b writes it to `live.json`; S3-08 adds the toggle.

## Tests
- **Unit:**
  - builder on fixtures (order, languages, money, hidden left out, internal field left out, public custom field in `fields`);
  - the hash ignores the header;
  - the strict schema refuses an extra key.
- **fast-check properties:**
  - **Leak:** generate documents whose external ids, internal field values and override bases are unique sentinel strings, and assert that no sentinel ever appears in `JSON.stringify(snapshot)` (rule 3).
  - **Rule 5:** no combination of our layers makes an item barsy hides or takes off sale appear, or appear orderable, in the snapshot.
  - **Determinism:** same document → same hash; shuffled input arrays (other than ordered ones) → same snapshot.
- **Integration (Postgres, `CI=true`):**
  - publish → version 1 and the pointer;
  - republish unchanged → no-op;
  - change a price → version 2;
  - rollback → the pointer back to 1;
  - V10 empty menu refused;
  - V11 auto publish hiding 40% held, then approved;
  - first-published dates recorded once;
  - RLS: another tenant sees nothing;
  - concurrent publishes of one menu → versions never collide.

## Done when
The full gate passes with DB tests (`CI=true`; your own database `restro_s3_01a` on the running 54329 instance, CLAUDE.md "Database tests").

## Never / scope
- **Scope:** `packages/core/**`, `packages/db/**` (one migration).
- **Not in scope:** no files, jobs, web, worker or shell code; no new dependency.
- **Rule 3:** never put a barsy id, internal name or internal field in a snapshot. If the doc's shape seems to require one, stop and ask.
- **Git:** commit as you go (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`.
