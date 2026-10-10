# Brief S3-10: fix Copilot's three findings on PR #3

- **Model:** Sonnet 5.5. **Branch:** your worktree branch from `s3/guest`.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/tracker.md` → T61, D59, and the notes "Guest phone page (S3-03)", "Publish files and jobs (S3-01b)" and "Sold out tonight (S3-08)";
  - the files named below.
- **Why:** Copilot reviewed PR #3 and found three problems. Fix each exactly as written. If a spec doesn't fit the code, stop and ask.

## 1. Two venues can share a public address (high; closes T61)
- **Where:** `packages/db/src/schema.ts` (`venues.slug`), `packages/core/src/apply/provision.ts` (`provisionVenue`), `apps/worker/src/publish/files.ts` (`writePublishFiles`, the `v/<slug>.json` guard).
- **Cause:** slugs are unique per tenant only, but `/m/<slug>`, `v/<slug>.json` and the table QR links are global.
- **Fix:**
  - **Migration:** a **global** unique index on `venues (slug)`. Slugs are already lower-case by the slug pattern; check that, and add `lower(slug)` only if they aren't.
  - **`provisionVenue`:** a taken slug becomes a typed error `slug_taken` (not a raw database error), with a test.
  - **`writePublishFiles`:** keep the existing "never overwrite another venue's `v/<slug>.json`" guard as defence in depth, but make it **fail the job** (throw a typed error the run records as failed) instead of only adding a note. The pointer is already moved by then; that's acceptable because the database index now prevents the case. Say so in a code comment.
  - **Check seeds and e2e:** every seed and e2e script must create distinct slugs, so `demo-club`, the Publish e2e venue, etc. never collide in one database.
- **Tests:** two tenants can't both have `demo-club` (database error mapped to `slug_taken`); the publish job fails loudly if `v/<slug>.json` names another venue.

## 2. Saving the sync settings can undo or revive the rollback pause (medium)
- **Where:** `apps/web/src/server/integration/service.ts` (`saveSyncSettings`, around line 625), `packages/core/src/apply/sources.ts` (`updateIntegration`), `packages/core/src/apply/sync-config.ts` (`setAutoPublishPaused`).
- **Cause:** `saveSyncSettings` reads `config.publish`, copies `auto_paused` from that read, and replaces the whole `publish` object. A rollback or a manual publish between the read and the write is lost or undone.
- **Fix:**
  - Add a core writer `saveSyncSettingsConfig(pool, tenantId, integrationId, {schedule, publish: {after_sync, new_items}})` that does **one atomic UPDATE**:
    - `config = config || jsonb_build_object('schedule', $schedule::jsonb, 'publish', coalesce(config->'publish', '{}'::jsonb) || $publishPatch::jsonb)`, minus the legacy flat `publish_after_sync` key;
    - so `publish.auto_paused` is never read or written by this path.
  - `saveSyncSettings` uses it instead of `updateIntegration`, and no longer reads or copies `auto_paused`.
- **Tests (DB):**
  - pause set between "load the form" and "save" → still set after the save;
  - pause cleared in between → still cleared;
  - the saved schedule and publish keys are as sent.

## 3. The sold-out list can be older than the menu version a guest has (low; a different fix than Copilot's)
- **Where:** `apps/web/src/guest/load.ts` and `guest-menu.tsx` (the loader and polling), `packages/shell/src/build.ts` (around line 384, overlay use).
- **Decision (lead):** keep applying the overlay even when its `version` differs from the snapshot's. Sold-out marks belong to the service day, not to a version, so ignoring a mismatched overlay would briefly show sold-out items as available (the less cautious error). The shell already never adds an item or makes one *more* available from the overlay.
- **Fix:**
  - **Refetch on mismatch:** when the loaded `live.json` `version` ≠ `snapshot.snapshot.version`, the loader immediately refetches `live.json` with a cache-busting query (`?v=<snapshot version>`), up to 3 times with 2 s apart, then falls back to the normal 15 s polling.
  - **Comments:** add a code comment in the shell at the overlay use, stating the rule ("a mismatched overlay still applies; it can only add caution").
  - **The `/cdn` route:** check it serves `live.json` with the query string ignored for the file lookup. The cache key differs, so the CDN refetches.
- **Tests:**
  - loader: mismatched overlay → a refetch with `?v=` happens; matched → none;
  - shell: a mismatched overlay still marks items sold out, and never adds or un-sells one (existing property; extend it with a mismatched version).

## Done when
- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests (`CI=true`; your own database `restro_s3_10` on the running 54329 instance), plus the Playwright suite.
- **Report:** one plain sentence per fix. The lead uses them to reply to Copilot.

## Never / scope
- **Scope:** only what these three fixes need.
- **No new dependency.**
- **Secrets:** never read `E:\Restro\.env.local`.
- **Scratch files:** put them in your own scratchpad folder (`<scratchpad>/s3-10/`).
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
