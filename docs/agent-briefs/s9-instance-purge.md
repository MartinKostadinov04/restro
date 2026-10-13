# Brief S9: the purge of a removed POS instance (D91 point 2, D83)

- **Model:** Opus 5.5 (it erases data: the purge rules).
- **Branch:** `ad/s9-instance-purge`, in your own worktree, cut from `ad/foundation`. Commit as you go; never push, never merge.
- **Read first (only this):**
  - `CLAUDE.md`, then `docs/decisions.md`. Look up by number in `docs/tracker.md` (search `| D83 |`): D83, D91 (point 2), D81, D76.
  - `apps/worker/src/jobs/purge.ts` whole (the module you extend: `purgeVenue`, `purgeMenu`, `deleteNodes`, `logPurge`, `dueIn`, the tick job) and `apps/worker/tests/purge.test.ts` (the harness you copy).
  - `packages/db/src/table-access.ts` (the purge role's privileges: `integrations`, `barsy_venues`, `source_records`, `source_links`, `nodes`, `places`, `job_runs` already carry `purge: PURGED`).
  - `packages/core/src/apply/sources.ts`: the comment and body of `removeIntegration` only (removal sets `removed_at`; refused while a venue links to the instance; a deleted venue has released its link, D76).
  - `packages/db/src/schema.ts`: the tables with an `integration_id` column (search `integration_id`): `barsy_venues`, `source_records`, `source_links`, `job_runs` (nullable), `places`, and `till_venue_links` (how a venue links to an instance).

## Goal
A removed POS instance (`integrations.removed_at` set, D81) is erased by the purge job 30 days later, as D91 point 2 asks: its synced data, and the items and sections that came from it and no venue uses any more. Data another venue still uses stays. Nothing but the purge role deletes.

## Do
1. **`purgeInstance(tx, { tenantId, integrationId })`** in `apps/worker/src/jobs/purge.ts`, in the style of `purgeVenue`, through the purge transaction only. Refuse (return a result with `skipped: 'has_venues'`, no deletion, no log row) when any `till_venue_links` row with a `venue_id` still names the instance. Otherwise erase, in this order, counting rows per table as `purgeVenue` does:
   - the instance's till layer: `places`, `barsy_venues`, `till_venue_links` (its rows without a venue), `job_runs` with its `integration_id`;
   - the nodes that came only from this instance and that no venue uses: a node whose `source_links` all name this instance and that has no `placements` row in any menu (a section: no live child either). Delete them with `deleteNodes` (it takes their `field_values`, `events`, `placements` and links with them; read it before you rely on it). A node that is placed in a menu, or that also links to another instance, stays; only its `source_links` rows for this instance go;
   - the rest of the instance's `source_links` and all its `source_records`;
   - the `integrations` row itself (credentials go with it).
   One `logPurge` row of kind `'instance'` with the counts; no content (no host, no names) in it.
2. **The tick:** `dueIn` also returns the removed instances due (`removed_at` older than `INSTANCE_BIN_DAYS = 30`, a new constant next to `VENUE_BIN_DAYS`); the tick calls `purgeInstance` for each, after the venues and menus (a venue purged in the same tick releases its link first).
3. **Tests** in a new `apps/worker/tests/purge-instance.test.ts` with the existing purge harness (database tests: `CI=true`, your own database `restro_s9` on the running Postgres 54329, `pnpm db:migrate` and `pnpm db:roles` with the `DATABASE_URL*` variables below): an instance with records, links, a till venue mirror and two items, one placed in a live venue's menu, one unplaced. Expected: the placed item stays with no link to the instance, the unplaced one goes, the instance row goes, the log row has kind `instance` and counts, a second run changes nothing; an instance a venue still links to is skipped; the tick picks an instance removed 31 days ago and not one removed yesterday.
4. **Checks:** `pnpm lint && pnpm typecheck && pnpm deps:check`, `pnpm vitest run --project apps/worker tests/purge.test.ts tests/purge-instance.test.ts --reporter=dot`, `pnpm vitest run --project packages/db --reporter=dot` (the role guardrails must stay green untouched).

## Never / scope
- Scope: `apps/worker/src/jobs/purge.ts`, `apps/worker/tests/purge-instance.test.ts` (new), one line in `docs/tracker.md` (under T79: "D91 point 2 built") and nothing else. If a grant or a table is missing from the purge role, or a rule is unclear, stop and put it in your report with your recommendation (D67: guardrails only tighten; never edit `table-access.ts`, the role tests or a migration).
- Never delete through the app role or `apply()`; never touch `restro_accept`; never read `.env.local`; never run the full `pnpm test`, `pnpm build` or Playwright.
- Database variables: `DATABASE_URL_OWNER=postgres://postgres:postgres@localhost:54329/restro_s9`, `DATABASE_URL=postgres://restro_app:local-only-not-a-secret@localhost:54329/restro_s9`, `DATABASE_APP_PASSWORD=local-only-not-a-secret`, `DATABASE_PURGE_PASSWORD=local-only-purge-not-a-secret`, `DATABASE_URL_PURGE=postgres://restro_purge:local-only-purge-not-a-secret@localhost:54329/restro_s9`.
- Report as in `docs/agent-briefs/_template.md`, at most a page, in your final message.
