# Brief CF-18: rename and delete venues (D76)

- **Model:** Sonnet 5.5.
- **Branch:** create `cf/18-venue-lifecycle` from `sh/foundation` yourself.
- **Decisions:** **D76** (read it in full in `docs/tracker.md`: search `| D76 |`), D68 (public address), D73 and D74 (settings map, navigation), rules 1, 2, 6 and 7 in CLAUDE.md.
- **Runs beside CF-17** (till-name fallback). CF-17 edits the composer, `packages/barsy/src/mapping/**` and the snapshot leak guard: do not edit those. `apps/web/messages/{bg,en}.json` is shared; the lead resolves conflicts there.

## Why

Martin (10-11): "I should be able to delete venues as well / edit names; ensure proper database operation and middleware handling." Today a venue's address (slug) can be renamed, its name cannot, and nothing deletes a venue. D76 sets the shape: delete = archive, restore by owners, rename by owners and admins.

## Read first

1. `CLAUDE.md`, `docs/decisions.md`, D76 in the tracker.
2. `docs/architecture/data-architecture.md`: only the section that defines `venues` and the one on published files (venue index `v/<code>.json`, table files `t/<token>.json`).
3. `docs/reviews/connector-architecture/cf-16-design.md`, line 11 only (how a section's till link is keyed per venue).
4. Code, as needed:
   - DB: `packages/db/src/schema.ts` (`venues`), `packages/db/src/table-access.ts`, the latest migration `0016_venue_catalogue.sql`.
   - Core: `packages/core/src/apply/provision.ts` (`renameVenueSlug` is the pattern: row lock, `ProvisionError` codes), `apply/barsy-venues.ts` (`mapBarsyVenue`, `venueMustBeUnlinked`), and every core file that reads `venues` (`grep -l "from(venues)" packages/core/src`).
   - Web: `apps/web/src/server/{venues,venues-actions,venues-result,roles,session}.ts`, `apps/web/proxy.ts`, `src/components/admin/{app-sidebar,venue-nav,venue-address,settings-sections}.tsx/ts`, the `VenueSettings` component on the Settings tab of `app/(admin)/venues/[venueId]/page.tsx`, `app/(admin)/venues/page.tsx`, `app/(admin)/settings/**`, `src/server/integration/service.ts` (the "Link to an existing venue" list).
   - Worker: `apps/worker/src/publish/{files,after-sync}.ts`, the table-token publish job, `apps/worker/src/sync/**`, `apps/worker/src/jobs/barsy.ts`.
   - Guest: `apps/web/src/guest/guest-menu.tsx`, `app/t/[token]/route.ts`.
5. `docs/platform-reference.md`: port any matching delete/rename pattern, per the convention.

## What to build

1. **Database.** Migration `0017`: `venues.archived_at timestamptz null` (null = live), plus the Drizzle column with a doc comment. No new privileges: the app role keeps no DELETE on `venues` (D67: guardrails only tighten). Nothing else in the schema changes unless you stop and ask.
2. **Core writers** (`packages/core/src/apply/`, rule 1, each in one `withTenantWrite` transaction, the venue row locked `for update`):
   - `renameVenue(pool, tenantId, venueId, name)`: trimmed, 1–120 characters (the same rule as creating a venue); the same name again writes nothing.
   - `archiveVenue(pool, tenantId, venueId)`: sets `archived_at`, and **in the same transaction** releases the till link (the `barsy_venues` row mapped to it goes back to unassigned). Archiving an archived venue changes nothing.
   - `restoreVenue(pool, tenantId, venueId)`: clears `archived_at`. It does not relink the till or publish.
   - **One shared check for every other writer:** a helper (e.g. `lockLiveVenue(tx, venueId)`, `for share`) that every core writer touching one venue calls first; an archived venue is refused with a new code (`venue_archived`), a missing one keeps `venue_missing`. With `for share` against archive's `for update`, a save and a delete never interleave. This covers `apply()` for a venue's menu, theme, presentation, guest features, publish rules, tables, tags, sold-out, price source, slug rename, `mapBarsyVenue` (never map a till venue to an archived venue) and the publisher.
   - Record each of the three like the other venue-settings writers do (if they write an event, so do these).
3. **Admin reads and pages** (`apps/web`):
   - `listVenues` and `getVenue` return live venues only, so the sidebar, every venue page (`notFound`) and every list (Integrations' "Link to an existing venue", tables, publishing) drop archived ones. Add `listArchivedVenues` for the restore list.
   - Audit every admin read of `venues` (`grep -l "from(venues)" apps/web/src`) and list each in your report: filtered, or not needed and why.
4. **Actions** (`venues-actions.ts`, the shape of `renameVenueSlugAction`: Zod, `requireTenant()`, role, core writer, `revalidatePath('/', 'layout')` so the sidebar updates):
   - `renameVenueAction`: owners and admins.
   - `deleteVenueAction({venueId, confirmName})`: **owners only** (a new `canDeleteVenue` in `roles.ts`); the server also refuses when `confirmName` (trimmed) is not the venue's name. After commit, queue the jobs of step 5; a failure to queue is logged and the answer says so, as the slug rename does.
   - `restoreVenueAction`: owners only; queues the table files job so the table codes come back once the venue is published again.
   - Map `venue_archived` to a clear answer ("This venue was deleted") in these actions; leave other actions' error mapping alone.
5. **Worker:**
   - **Guest files follow the database.** `publish-files` for an archived venue withdraws its venue index, so `/m/<slug>-<code>` shows a calm "This menu is not available" state; the table files job withdraws the venue's table files, so `/t/<token>` says the same. Whichever job runs last must leave what the database says, so a publish that started before the delete can never bring the page back. Withdraw table files **without** retiring the tokens, so a restore brings the same QR codes back. Report whether you removed the files or wrote a marker, and why.
   - A queued sync or publish for an archived (or unlinked) venue ends as skipped with a reason, never as a failure and never with a write.
   - "Sync everything" and the schedule never include an archived venue.
6. **Interface** (BG and EN, next-intl):
   - **Settings tab of the venue:** the name becomes editable next to the address card (owners and admins; others read it). The toast says it reaches guests with the next publish, as the Design tab does.
   - **Danger zone** at the end of the Settings tab (owners only): "Delete venue" opens a dialog that says in plain words what happens (gone from the admin, guest page and QR codes stop working, till link released, nothing erased, restore from Settings › Deleted venues) and needs the venue's name typed. On success: go to `/venues`, toast with a link to the restore list.
   - **Settings › Deleted venues** (a new entry in `settings-sections.ts`, owners only, an empty state when none): name, deleted on (Europe/Sofia), Restore. After restore, say: link its till again in Integrations if it had one, then publish.
   - Zero venues left: the sidebar and `/venues` show the existing "add a venue" path, no crash.
7. **The sign-in gate:** `proxy.ts` stays a cookie check (the Next.js "Authentication" pattern; it must not query the database). Add nothing there; the real checks are steps 2–4. Say so in the report.
8. **Docs:** a short "Venue lifecycle" paragraph next to the `venues` definition in `docs/architecture/data-architecture.md` (the lead mirrors it to the live doc).

## Tests

- **Core (DB, `restro_cf_18`):** rename; archive releases the till link in the same transaction (a failure rolls both back); archive and restore are idempotent; another tenant's venue is `venue_missing`; every guarded writer refuses an archived venue (one table-driven test over the writers); `mapBarsyVenue` refuses an archived venue; **a released till venue linked to another venue builds that venue's own sections and never moves or reuses the archived venue's nodes** (CF-16 keys).
- **Worker:** `publish-files` and the table files job withdraw for an archived venue and restore after restore + publish; a queued sync and a queued publish for an archived venue end as skipped with no write.
- **Web:** actions (owner deletes; admin and member cannot; a wrong `confirmName` is refused; admin renames); `listVenues` / `getVenue` hide archived; component tests for the dialog and the restore list.
- **e2e:** a new `e2e/venue-lifecycle.spec.ts` with its own seed (pattern: `scripts/seed-navigation-e2e.ts`): rename shows in the sidebar; delete removes it, its URL 404s, its guest page says not available; restore brings it back.
- Two tiers per CLAUDE.md.

## Never / scope

- No DELETE of rows anywhere; no hard delete of a venue, menu, node, table or event.
- Never call barsy (rule 7); fixtures only. Never read `.env.local`. No new dependency. Files LF.
- Don't touch the composer, `packages/barsy/src/mapping/**` or the leak guard (CF-17's).
- Commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.

## Report

CLAUDE.md format, at most one page, with: the audit list of `venues` reads (step 3), the guarded writers (step 2), files removed or marker (step 5), and two screenshots (the delete dialog, Settings › Deleted venues) in the scratchpad `shots/cf-18/`.
