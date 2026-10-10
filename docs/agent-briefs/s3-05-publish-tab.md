# Brief S3-05: the Publish tab

- **Model:** Sonnet 5.5.
- **Branch:** your worktree branch from `s3/guest`, after S3-01b and S3-03 are merged.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/architecture/data-architecture.md` → "Publish policy", "Files on the CDN", "Validation and quality gates" (V9–V12);
  - `docs/tracker.md` → D59, D62 and the "Publish core (S3-01a)" note;
  - `packages/core/src/apply/publish.ts` (`publishMenu`, `rollbackTo`, `rejectHeld`, `listSnapshots`, held reasons with hidden item ids), `packages/core/src/resolve/compare-visibility.ts`;
  - S3-01b's web actions (`publishNowAction`, `rollbackAction`) and jobs;
  - S3-03's guest route (`/m/<venue>`) and face, for the preview;
  - the Integration tab's live-refresh pattern (`apps/web/src/integration/live-refresh*`).

## Goal
The venue's **Публикуване / Publish** tab, replacing the placeholder, shows:
- what guests see now;
- what changed since;
- the controls to publish, approve a held publish, preview, and roll back.

## Do
1. **Live card:** the current version (number, when, by whom or "barsy sync", reason) and an "Open guest page" link to `/m/<venue>`. When nothing has been published yet: "Nothing published yet", plus the Publish button.
2. **Changes waiting:**
   - Compare the current draft (resolve now) with the live snapshot: items added, removed or hidden, prices changed, names changed. Show counts and an expandable list, using `compareVisibility` plus a small pure diff of the snapshot items. Show "Up to date" when there are no changes.
   - **V12 warnings:** stale overrides waiting for review are listed with a link to the item in the composer.
3. **Publish button** (owner/admin) → `publishNowAction`.
   - A pending state, with live refresh until the job's run finishes.
   - **V10** refusal shown as "Nothing visible to publish".
   - **On success:** "Version N is live".
4. **Held publish (V11):** a banner shows "An automatic publish was held: it would hide X of Y items (Z%)", with the item names (from the held reason), **Approve** (→ `publishMenu` with `approveHold`; on `held_outdated`, say the menu changed since and offer Publish) and **Reject** (→ `rejectHeld`).
5. **Preview:** "Preview" opens a phone-frame dialog with the guest face rendering the **draft**, built in memory with S3-01a's builder plus the S3-02 shell, never written as files. Use a server action that returns the draft snapshot (after the leak guard) to a client component that renders the face.
6. **History:** published versions, newest first, paged by 20: version, time (venue time zone), reason, actor and change counts. Each older version has **"Return to this version"** (confirm dialog) → `rollbackAction`.
   - **After a rollback, automatic publishing pauses.** Set `publish.auto_paused = true` in the integration config through the writer. Show a banner: "Automatic publishing is paused because you returned to an older version. Publish to resume."
   - The worker's after-sync trigger skips while it is paused, and a manual Publish clears the pause. Add the worker check and its test.
7. **Permissions:** owner/admin act; others read only.
8. **i18n:** every string in BG + EN; add them to the T44 review list.

## Tests
- **Unit:** the diff and its counts; action role checks.
- **Components:** each card.
- **DB integration:** rollback pauses auto-publish, a manual publish resumes it, and the worker skips while paused.
- **Playwright:** publish → "Version 1 is live" → open the guest page and see the menu → change a price in the composer data through the writer → "1 change waiting" → publish → version 2 → return to version 1 → paused banner → publish → resumed. Screenshots BG/EN, light/dark, mobile, saved to `.local/screenshots/s3/s3-05-*.png`.

## Done when
The full gate passes with DB tests (`CI=true`; your own database `restro_s3_05` on the running 54329 instance), and the Playwright spec passes.

## Never / scope
- **Scope:** `apps/web/**` (tab, actions, preview), `apps/worker/**` (the pause check only), `packages/core/**` (only the small diff helper if it belongs there), `messages/*.json`.
- **No new dependency.** Never read `E:\Restro\.env.local`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`.
