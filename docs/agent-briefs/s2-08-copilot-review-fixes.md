# Brief S2-08: fix Copilot's three findings on PR #2

- **Model:** Sonnet 5.5. **Branch:** your worktree branch from `s2/composer`.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/tracker.md` → the Stage 2 engineering notes ("Sync jobs", the S2-02 decisions) and decision rule 6;
  - the three spots named below, plus `apps/worker/src/sync/*`, `apps/worker/tests/*` (the MSW fake barsy, `world.ts`, `database.ts`) and `packages/barsy/src/mapping/catalogue.ts`.
- **Why:** Copilot reviewed PR #2 and found three real problems. Fix each exactly as specified. If a spec doesn't fit the code, stop and ask.

## 1. Two pulls of one integration can overlap (high)
- **Where:** `packages/core/src/jobs.ts` (`jobSingletonKey`), `apps/worker/src/sync/data.ts` (`fullPullIsRunning`), and the two pull handlers.
- **Cause:** pg-boss's exclusive policy is per (queue name, singleton key), so `barsy-full-pull` and `barsy-incremental` of the same integration can both be active. The `fullPullIsRunning` check is race-prone.
- **Fix:** an integration-scoped **Postgres advisory lock**, held for the whole pull.
  - Take a dedicated client from the pool and run `select pg_try_advisory_lock(hashtextextended('restro:barsy-pull:' || $1, 0))` with the integration id. Hold the client until the pull ends, then `pg_advisory_unlock` and release the client in `finally`. If the process dies, the closed connection releases the lock.
  - Put this in one small module (e.g. `apps/worker/src/sync/pull-lock.ts`, `withPullLock(env, integrationId, fn, {waitMs})`) and use it in both handlers.
  - **Incremental, lock busy:** return at once. Record the job run as completed with the note "skipped: another pull is running" (or no job run, if the existing skip path writes none; keep it consistent with today's skip).
  - **Full pull, lock busy:** retry `pg_try_advisory_lock` every 2 s for up to 60 s. Still busy: send the same job again with `startAfter: 60` (seconds; use the queue's existing `send` on the job context), and complete this one with a note. "Sync now" is never lost.
  - Remove `fullPullIsRunning` and its use (the lock replaces it).
  - `restro_app` needs no extra privilege for advisory locks. Note in a comment that this works through the Supabase **session** pooler (port 5432), not the transaction pooler.
- **Tests (real Postgres, `CI=true`):**
  - two full pulls of one integration started together: their critical sections never overlap (record enter/exit times through a fake barsy that is slow on one page);
  - an incremental started while a full pull holds the lock: skipped, with no barsy article calls;
  - a full pull requested while an incremental holds the lock: runs after it ends (within the 60 s wait), or is re-queued with `startAfter` (assert the queued job);
  - a different integration is never blocked;
  - the lock is released after an error in the pull.

## 2. A stale photo job can overwrite a newer or cleared photo (high)
- **Where:** `apps/worker/src/sync/photos.ts` (`fetchPhoto`, `articleRecordId`).
- **Fix:**
  - **Read the current record from the link, not by time:** read the article's *current* source record through its link, `source_links.last_hash` → the `source_records` row with that hash for this integration, type and external id. Never "newest by `fetched_at`". This applies the S2-02 decision: recency comes from the link.
  - **When to check:** before downloading, check that this record still names `request.pictureName`, and that its picture URL, built the same way the mapper builds it, equals `request.url`. If either differs, or the article is unlinked or has no picture, return `{ status: 'obsolete' }`: no download, no write, a job run counter `obsolete`.
  - **Check again just before the `apply()` write**, after the download and storage. If it's obsolete now, don't write the field. The stored asset may stay; T53 cleans up unused assets.
- **Tests (MSW + Postgres):**
  - the picture changed in barsy between queueing and running → obsolete, no download request made, `image` unchanged;
  - the picture removed → obsolete;
  - unchanged → stored and written as today;
  - changed between download and write → no write.

## 3. A picture removed in barsy stays in the menu (medium)
- **Where:** `packages/barsy/src/mapping/catalogue.ts` (`pictureRequest` and the item writes).
- **Fix:**
  - When the article response **includes** `picture` (use the existing `provided(...)` helper) and it is null or blank, emit `clearField { node: <article link>, fieldKey: 'image', layer: 'barsy', scope: 'master' }`, exactly like the other barsy clears in this file, and no asset request.
  - When `picture` was not part of the response, write nothing.
  - A manual photo still wins by the template's combinator; don't touch the combinator.
- **Tests (pure, on fixtures):**
  - an article with `picture: ''` or `null` → `clearField` for `image`, no asset request;
  - `picture` absent from the response → no write for `image`;
  - an article with a picture → an asset request as today.
- **Plus an integration test** in the worker: a photo set by an earlier pull, then barsy removes it, then the next full pull → the resolved item has no barsy image, and a manual photo set meanwhile still shows.

## Done when
`pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests (`CI=true`; your own database `restro_s2_08` on the running 54329 instance, per CLAUDE.md "Database tests"). Playwright isn't needed for this task.

## Never / scope
- **Scope:** only the files these three fixes need, plus tests.
- **No new behaviour:** no new dependency, no migration.
- **No real barsy calls:** MSW only. Never read `E:\Restro\.env.local`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** short, in `docs/agent-briefs/_template.md` format, with one line per fix saying exactly what changed. The lead quotes these lines in the replies to Copilot.
