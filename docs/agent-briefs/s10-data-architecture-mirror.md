# Brief S10: the data-architecture mirror after Adjustments 01 (wave 3)

- **Model:** Sonnet 5.5.
- **Branch:** `ad/s10-docs-mirror`, in your own worktree, cut from `ad/foundation`. Commit as you go; never push, never merge.
- **Read first (only this):**
  - `CLAUDE.md` (the "Read before any task" rule: the mirror follows the live doc, and the live doc wins), then `docs/decisions.md`: D77, D83, D84, D86, D87, D88, D90, D91, D92, D93, D95, D96, D97 (one line each; look up D83, D92, D95 and D96 in `docs/tracker.md` by `| D83 |` etc. for their full text).
  - `docs/tracker.md`: the T79 sub-bullets only (search `T79.` and read its indented bullets, "ad/01 built" to "Pairs C and D merged"): they say what each wave built, file by file.
  - `docs/architecture/data-architecture.md` whole (890 lines; the document you update).
  - The sources of truth for each change, read only where the mirror needs a fact: `packages/db/migrations/0018_*.sql` to `0027_*.sql`; `packages/db/src/schema.ts` for a column's exact name and type; `packages/db/src/table-access.ts` (the app and purge privileges per table); `packages/core/src/snapshot/schema.ts` (`layout`, `hints.layout`, the theme); `packages/core/src/guest-files.ts` (the published files: `o/`, `v/`, `t/`); `packages/core/src/purge.ts` and `apps/worker/src/jobs/purge.ts` (the bins and the versions rule); `packages/core/src/menus.ts` (`MenuSettingsSchema`).

## Goal
`docs/architecture/data-architecture.md` describes the data model as it is after Adjustments 01, so an agent reading it is not misled: several menus per venue with one live, areas and tables as the platform's own with `places` as the till layer, menu routes, venue addresses and their histories, the organisation index files, the purge (role, tombstones, log, bins, versions), per-venue sync settings, the integration instances, and the snapshot's layout fields and theme roles. The report lists, in one place, every statement the live doc (the claude.ai artifact, Martin's) must take over, so the lead can port them.

## Do
1. **Update the existing sections in place** (keep the document's structure, voice and length discipline; add a short subsection only where a new table has no home):
   - **Supporting tables / Identity and linking / Tables:** `integrations` as named instances (`name`, `removed_at`, `tenants.settings` with the chosen systems; D81, D91); `menus` many per venue (`name`, `sort_key`, `settings` = `{layout, layout_switch}`, `deleted_at`), `venues.live_menu_id`, `venues.unpublished_at` (D88, D90, D92, D86); `areas` and `tables` (`ar_`, `tb_`, name, number, sort key, hidden, `qr_token`) with `places` as the barsy mirror (D95); `menu_routes` (one row per area or table; the most specific published menu wins); `venues.slug` unique per organisation, `venue_slug_history`, `organization_slug_history` (D84); `tombstones` and `purge_log` and the purge role `restro_purge` with its DELETE list (D83); `venues.settings.sync`, `settings.publish.auto_paused` and `settings.till_before_delete` (D82, T76, V1).
   - **The published files:** `o/<organisation>.json` (current and old names, the internal code, redirect files), `v/<code>.json` names the live menu only, `t/<token>.json` carries the routed `menu_id` (D84, D88, D95).
   - **Snapshot:** `layout {default, guest_switch}` and a section's `hints.layout` (D92, additive, `menu-snapshot/1` stays); the theme's D93 roles.
   - **Deletion and purge:** the bins (venue 30 days, menu 30 days), the versions rule (D96), what the app role may delete (`placements`, `field_values`, `source_links`, Better Auth session and verification rows) and what only the purge role erases.
   - **Languages:** the one languages function and the connector report (D77); the untagged till text language stays an instance setting.
2. **Say what is unchanged:** do not rewrite sections the adjustments did not touch; a one-line note where a reader might expect a change is enough.
3. **The report** carries the list for the live doc: one line per statement, in the order of the document, each starting with the section name.
4. **Checks:** `pnpm lint` and nothing else; this task has no code.

## Never / scope
- Scope: `docs/architecture/data-architecture.md` only. No code, no other doc, no `stack.md` (say in the report if it needs the same pass).
- Never present an assumption as a fact: a column or rule you cannot find in the sources named above is left out and listed under open questions.
- Never read `.env.local`; never run tests or builds.
- Report as in `docs/agent-briefs/_template.md`, at most a page, in your final message.
