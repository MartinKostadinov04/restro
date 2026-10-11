# Brief CF-17: barsy's own name stands in for a missing menu name, with a warning (D75)

- **Model:** Sonnet 5.5.
- **Branch:** create `cf/17-till-name-fallback` from `sh/foundation` yourself.
- **Decisions:** **D75** (read it in full in `docs/tracker.md`), D67, rule 3 and the "Never" list in CLAUDE.md (as changed by D75).
- **Runs alone.**

## Why

On the acceptance data, 59 of the Burgers venue's 115 items, 18 of 26 sections and 4 options have no name: barsy's public name (`article_name_public` / `article_name_public_ml`, `cat_name_public` / `cat_name_public_ml`) is empty, and our mapping deliberately never used barsy's own name (`article_name`, `cat_name`). Martin decided (D75): use barsy's own name when the public one is empty, and warn in the composer.

## Read first

1. `CLAUDE.md`, `docs/decisions.md`, D75 in the tracker.
2. `docs/architecture/data-architecture.md`: only "Barsy to canonical mapping".
3. `packages/barsy/src/mapping/{catalogue,sections,text,types}.ts` and their tests; `packages/barsy/src/mapping/test-data.ts` (its `INTERNAL …` names).
4. The snapshot leak guard (`packages/core/src/snapshot/leak-guard.ts` and its tests) and any test that asserts barsy's own names never reach a value or a snapshot.
5. The composer: `apps/web/src/composer/composer-tab.tsx` (how `loadHeldNewItemIds` feeds a badge), `view-model.ts`, the row badges, and the item sheet's details.

## What to build

1. **Mapping (`packages/barsy`):**
   - item `name`, option `name` (an option is an article) and section `title`: when the public text is not provided (missing, null, or every language empty), write barsy's own name (`article_name` / `cat_name`) instead, in the till layer, under the language barsy text without a tag is stored in (`run.text`, as `article_name_public` is);
   - a public name in any language wins as today; never mix the two in one value;
   - keep a mapping warning per fallback (e.g. `item_public_name_missing`), counted in the run;
   - bump the mapping version if the doc's rules ask for it when the output changes, and say so.
2. **Guardrails, per D75 only:** wherever a test or the leak guard forbids barsy's own names, allow exactly this fallback and nothing more. Ids, cost and delivery prices, `internal_note` and every other internal field stay forbidden; add a test that proves the guard still refuses them. In your report, list each guardrail line you changed and why (the lead approves them as D75's).
3. **Composer warning:** an item, option or section whose name comes from the fallback shows a warning badge, BG and EN: "Menu name missing in {source}: its own name is shown" (`{source}` = the till label, as other composer texts do), with a short help line: fill the public name in the till, or type a name here (a Restro name in the manual layer already wins over the till's).
   - Derive it from the stored source records (the public fields empty), loaded server-side like `loadHeldNewItemIds`; no template change, no migration.
   - Show it in the item sheet too. It never blocks publishing.
4. **Existing data:** nothing to migrate; the next full pull writes the names. Say in the report how the lead refreshes the acceptance database (one full pull per venue).

## Tests

- Mapping unit tests: fallback for item, option and section; a public name in one language wins; all-empty `_ml` counts as missing; the warning is counted; the order-independence (determinism) tests stay green.
- The guard: still refuses ids, cost prices and internal fields.
- Composer: the badge appears only for fallback names; a manual name hides it.
- Two tiers per CLAUDE.md; DB tests on `restro_cf_17` (54329). Run the composer e2e spec only if you change its screen markup.

## Never / scope

- Use only data already stored or fixtures; never call the live barsy host; rule 7.
- No new dependency. No other guardrail change beyond D75's exception. Never read `.env.local`. Files LF.
- Commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.

## Report

CLAUDE.md format, at most one page, with the list of changed guardrail lines and one screenshot of the composer warning (scratchpad `shots/cf-17/`).
