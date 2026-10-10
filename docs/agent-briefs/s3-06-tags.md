# Brief S3-06: tags in the composer and on the guest menu (D60)

- **Model:** Sonnet 5.5.
- **Branch:** your worktree branch from `s3/guest`, after S3-01b and S3-02 are merged.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/tracker.md` → D47, D60 and the "Publish core (S3-01a)" note (tags are `tg_` ids; badges carry only `new`);
  - `packages/core/src/templates/venue-menu.ts` (the `tags` and `dietary` fields), `field-types/catalog.ts` (`tags` = string array) and `apply/*`;
  - `packages/core/src/snapshot/*` (the `tags` vocabulary in the snapshot);
  - `packages/shell` (the view model's tags and filter list);
  - the composer (`apps/web/src/composer/*`: item list, item row, item sheet details tab, row menus), `apps/web/src/fields/*` (registry; the `tags` editor may be a placeholder);
  - `docs/platform-reference.md` (status badges, empty states).

## Goal
A venue keeps its own list of tags (for example "Signature", "Spicy", "Local"), with names in BG and EN. A manager assigns them to items one by one or in bulk in the composer. Published menus carry them, and guests see them as small labels and can filter by them. Dietary labels stay the fixed list (vegan, vegetarian, gluten-free, …), shown the same way.

## Do
1. **Data:**
   - A table `tags`: `tg_` id, tenant, venue, `label` (LocalizedText), `color` (one of the theme's accent token names, not a raw hex), `sort_key` (fractional, `COLLATE "C"`), `archived_at`, timestamps. Migration + `table-access` + RLS + composite foreign keys, like the other tenant tables.
   - **Writers in `packages/core/src/apply/tags.ts`:** `createTag`, `updateTag` (label, colour), `moveTag` (position hint `'end'` or between, using the existing sort-key helpers), `archiveTag`, `restoreTag`. Readers: `listTags(venue)`.
   - **Item `tags` field values hold tag ids** (`tg_…`), written through `apply()` in the **manual** layer. Validate in `apply()`'s node context that every id exists for the venue and isn't archived; otherwise refuse with `unknown_tag`.
   - **Bulk:** `setItemTags(items[], add[], remove[])` builds one **atomic** change set (one row per item).
2. **Composer UI:**
   - **Tags panel:** a "Тагове / Tags" button above the section tree opens a sheet. It lists the tags in order with drag to reorder (the same `@hello-pangea/dnd` pattern as sections), create (name BG + EN, colour), rename, archive and restore. Archived tags are hidden from pickers but stay readable on old snapshots.
   - **Item sheet, Details tab:** the `tags` row edits as chips: pick from the venue's tags, plus "create a new tag" inline. Register the `tags` field editor in the field registry, once, no switch.
   - **Item list:** each item row shows its tag chips (max 3, then "+N").
     - **Multi-select:** a checkbox per row appears on hover and focus, plus "select all in this section". It brings up a bottom action bar: "Add tag…", "Remove tag…", "Clear selection".
     - **Filter:** a tag filter in the pane header shows only items with the chosen tag(s) in the current section. Keyboard accessible.
   - **Dietary labels:** unchanged editor (EU-style fixed list), now shown as chips in the item row like tags, in a neutral style.
3. **Publish:** the publisher fills the snapshot `tags` vocabulary with the venue's non-archived tags in order (label, colour token). Items carry only ids present in it. Check that S3-01a's builder already takes `tagVocabulary`; feed it from `listTags`.
4. **Guest side:** the shell's view model already exposes tags and the filter list (S3-02). Nothing to draw here; the face (S3-03) draws them.
5. **i18n:** every string in BG + EN; add them to the T44 review list.

## Tests
- **Writers:** create, rename, reorder, archive and restore; RLS (another venue or tenant can't see them).
- **`apply()`:** refuses an unknown or archived tag id; bulk add/remove is atomic.
- **Publish:** a published snapshot carries the vocabulary and item tag ids; archived tags are left out.
- **Components:** chips editor; multi-select bar; filter.
- **Playwright:** create a tag → bulk-assign it to 5 items → filter shows exactly those → publish → the snapshot file contains the tag. Screenshots BG/EN, light/dark, mobile, saved to `.local/screenshots/s3/s3-06-*.png`.

## Done when
The full gate passes with DB tests (`CI=true`; your own database `restro_s3_06` on the running 54329 instance), and the Playwright spec passes.

## Never / scope
- **Scope:** `packages/core/**` (tags writers, apply validation, publisher feed), `packages/db/**` (one migration), `apps/web/src/composer/**`, `apps/web/src/fields/**` (the tags editor), `apps/web/src/server/**` (actions), `messages/*.json`.
- **Not in scope:** no guest face code; no new dependency.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`, with the Platform port table.
