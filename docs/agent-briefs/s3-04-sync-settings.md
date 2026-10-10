# Brief S3-04: every sync setting adjustable, publish as a sync setting (D59)

- **Model:** Sonnet 5.5.
- **Branch:** your worktree branch from `s3/guest`, after S3-01b is merged.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/tracker.md` → D41, D45, D50 (P31), D59 and the Stage 2 "Sync jobs" and "Copilot review fixes" notes;
  - `docs/architecture/data-architecture.md` → "Publish policy" and "Collection path E" (cursor rules);
  - `apps/worker/src/jobs/barsy.ts` (the two ticks: `*/5 * * * *` and `0 12 * * *`), `apps/worker/src/sync/*` (cursor, `pull-lock.ts`, `catalogue.ts`), `packages/core/src/apply/sync-config.ts`;
  - S3-01b's after-sync publish trigger (`publish_after_sync`);
  - the Integration tab (`apps/web/src/integration/*`, `apps/web/src/server/integration/*`, especially `mapping-card` and `sync-card`).

## Goal
A manager controls *when* barsy is read and *whether* a sync goes live by itself, from the Integration tab. The worker follows those settings exactly. **Defaults stay what runs today.**

## Settings
Stored in the integration's `config.schedule` and `config.publish` (one venue per integration for now, T50):

| Setting | Values | Default |
|---|---|---|
| `schedule.incremental_enabled` | on/off | on |
| `schedule.incremental_minutes` | 1, 5, 10, 15, 30 | 5 |
| `schedule.full_pull_enabled` | on/off | on |
| `schedule.full_pull_time` | `HH:mm`, venue local time | `12:00` |
| `publish.after_sync` | `auto` (publish automatically) / `manual` (wait for "Publish") | `auto` |
| `publish.new_items` | `show` / `hold` (new barsy items stay hidden until a manager shows them) | `show` |

Zod schemas for them live in `packages/core` (config parsing), shared by web and worker. Unknown or missing values fall back to the defaults.

## Do
1. **Worker scheduling:**
   - Replace the two fixed schedules with **one tick every minute** (`* * * * *`, Europe/Sofia). Unschedule the old two names on start.
   - The tick calls a **pure** `dueSyncs(now, tz, settings, state)`, where state is `last_incremental_at`, `last_full_pull_at` and the last scheduled full-pull slot from `config.sync.<bid>`:
     - an incremental is due when enabled and at least `incremental_minutes` have passed since the last one;
     - a full pull is due when enabled and today's `full_pull_time` (venue local) has passed with no full pull since that moment.
   - It enqueues what is due (existing jobs, existing singleton keys); the pull lock still prevents overlap.
   - Test DST days (the last Sundays of March and October) and midnight edges.
2. **Publish policy:** S3-01b's after-sync trigger reads `publish.after_sync`. It currently reads the flat key `publish_after_sync`; migrate the reads to `publish.after_sync`, keeping the old key as a fallback (`auto` sends `publish-menu` reason `auto_sync`; `manual` sends nothing). The Publish tab (S3-05) shows "changes waiting to be published".
3. **New items held:**
   - When `publish.new_items = hold`, after a pull applies, every item node **created by this run** gets `visible = false` in the **manual** layer, through `apply()` with actor `system` and source `manual`. This is only more cautious, so rule 5 holds. Use the node ids that `apply()` reports as created; if it doesn't report them, add that to `ApplyResult` (small additive change) and say so in the report.
   - The composer shows those items with a "New from barsy, hidden until you show it" badge (one string, BG/EN). Showing one clears the manual value, as hide/show does today.
4. **Publish when photos arrive** (gap found by S3-01b). The sync's publish runs about 30 s after a pull, usually before the photos and their webp variants are ready, so the first snapshot has no images.
   - When `asset-variants` stores variants, queue `publish-menu` (reason `auto_sync`) for every menu + venue of the tenant whose document references that asset id (an `image` field value in any layer). This respects `publish.after_sync` (`manual` → nothing) and the rollback pause (S3-05).
   - The 30 s merge window keeps a burst of photos to one publish.
   - Put the asset → menus lookup in a small core reader.
   - Test: pull → publish without images → variants land → one more publish with images.
5. **UI** (Integration tab, owner/admin only; others read-only):
   - The existing "Synchronisation" card gains:
     - the change check on/off + interval;
     - the daily full pull on/off + time picker (venue time);
     - **"After a sync: publish automatically / wait for Publish"**;
     - "New items from barsy: show / keep hidden until reviewed".
   - Each control carries a one-line explanation. Save goes through a server action → `updateIntegration` (config merge).
   - The card shows the next planned runs ("Next change check ~02:35, next full pull 12:00").
   - All strings in BG + EN; add them to the T44 review list.

## Tests
- **Unit:** `dueSyncs` table tests incl. DST; config defaults; the action's role check.
- **Worker integration:**
  - interval 1 min → an incremental each minute tick;
  - disabled → none;
  - `after_sync = manual` → no publish job;
  - `new_items = hold` → created items get manual `visible = false`; existing items are untouched.
- **Component tests** for the new controls.
- **Playwright:** change the settings, reload, and see them kept.

## Done when
The full gate passes with DB tests (`CI=true`; your own database `restro_s3_04` on the running 54329 instance) and the e2e passes.

## Never / scope
- **Scope:** `apps/worker/**`, `apps/web/src/integration/**`, `apps/web/src/server/integration/**`, `apps/web/src/composer/**` (only the badge), `packages/core/**` (settings schema, the optional `ApplyResult` addition), `messages/*.json`.
- **No new dependency.** Never read `E:\Restro\.env.local`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`.
