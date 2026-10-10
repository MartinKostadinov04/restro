# Brief S3-08: sold out tonight (D46)

- **Model:** Sonnet 5.5, with a strict brief: this touches rule 5.
- **Branch:** your worktree branch from `s3/guest`, after S3-05 and S3-06 are merged.
- **Read first:**
  - `CLAUDE.md` (rule 5: our layers only make the menu more cautious);
  - `docs/tracker.md` → D45 (service day ends 07:00), D46, and the notes "Publish core (S3-01a)" (service edition `edition:service:<YYYY-MM-DD>`; the live overlay marks items whose resolved `for_sale` is false) and "Publish files and jobs (S3-01b)";
  - `docs/architecture/data-architecture.md` → "Files on the CDN" (`live.json`) and the publish policy;
  - `packages/core/src/apply/apply.ts` and `validate-write.ts` (edition layers: only `all_true` flags, only `false`), `packages/core/src/service-day.ts`, `packages/core/src/apply/publish.ts` (`resolveForVenue`, `publishMenu`, `loadLiveOverlay`), `packages/core/src/snapshot/build.ts` (availability state);
  - `apps/worker/src/jobs/publish.ts` (`publish-live`) and `src/jobs/barsy.ts` (the minute tick);
  - the composer (`apps/web/src/composer/*`) and the item sheet.

## Goal
During service a manager marks an item **"Изчерпано тази вечер" (sold out tonight)** in the composer. Guests see it within about 15 s, with no new menu version. At the end of the service day (07:00 venue time) the mark lapses by itself. A manager can never use this to put back on sale an item that barsy has off sale.

## Do
1. **Write path:**
   - **Mark:** a server action writes `for_sale = false` in layer `edition:service:<serviceDate(now, venue tz, end 07:00)>`, master scope, source `manual`, actor `user:<id>`, through `apply()`.
   - **Unmark:** a `clearField` on that same edition layer. **Never write `true`.** Confirm `validateWrite` refuses `true` on an edition layer, and add the test if it is missing.
   - Then enqueue `publish-live` for the menu + venue.
   - Both actions are owner/admin only (managers; D46 corrected: waiters don't use our admin).
2. **Snapshot vs overlay:** sold-out marks belong in `live.json`, not in a snapshot, so they lapse without a republish.
   - Make `publishMenu` resolve the snapshot **without** the service edition (venue edition only).
   - Keep the service edition in `loadLiveOverlay`.
   - Barsy's own off-sale (`for_sale` false in the barsy layer) still shows in the snapshot, as today.
   - Update S3-01a's tests that expect service-edition sold-out inside the snapshot, and **say so explicitly in your report**. Reason: a snapshot built at 23:00 must not still say "sold out" at 08:00.
3. **Rollover:**
   - The minute tick (S3-04) also queues `publish-live` for every venue whose service date changed since its last `live.json`. Track `last_live_service_date` in the venue's publish state or the overlay itself; the cheapest correct way is fine, but explain it.
   - After 07:00, `live.json` holds no marks from the previous day.
4. **Composer UI:**
   - Each item row has a sold-out toggle in its menu. Marked rows show an "Изчерпано тази вечер" badge.
   - A pane-header chip "Изчерпани (N)" opens a quick list to unmark.
   - The item sheet's Details tab shows the state, with "Mark sold out tonight" / "Back on sale" buttons.
   - Items that barsy has off sale show "Не се продава в barsy" (not on sale in barsy) and **no "Back on sale" button**. Our toggle can only add caution.
5. **Guest page:** nothing new to build. The shell already applies the overlay (`sold_out` wins over available) and the face shows "Изчерпано". Verify it end to end.
6. **i18n:** BG + EN; add the strings to the T44 review list.

## Tests
- **fast-check, rule 5:** for any sequence of mark and unmark operations by managers, an item barsy has off sale is never `available` in the snapshot, the overlay or the view model; unmarking never makes an item more available than barsy says.
- **Integration:**
  - mark → `live.json` lists the item, and the snapshot version does not change;
  - unmark → it is removed;
  - simulated 07:00 rollover (inject `now`) → the next tick publishes `live.json` without the item;
  - the snapshot never contains service-edition marks.
- **Components:** the toggle, the badge and the quick list.
- **Playwright:** mark an item → open `/m/<slug>` → within 20 s the card shows "Изчерпано" (poll) → unmark → back to normal. Screenshots to `.local/screenshots/s3/s3-08-*.png`.

## Done when
The full gate passes with DB tests (`CI=true`; your own database `restro_s3_08` on the running 54329 instance), and the Playwright spec passes.

## Never / scope
- **Scope:** `packages/core/**` (publisher editions, any missing validation), `apps/worker/**` (rollover), `apps/web/src/composer/**`, `apps/web/src/server/**` (actions), `messages/*.json`.
- **No dependency** and no migration unless unavoidable (ask first).
- **Secrets:** never read `E:\Restro\.env.local`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`.
