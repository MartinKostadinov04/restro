# Brief S8: wording and guardrails (the `{source}` pass, BG + EN parity, the baseline, the T44 review list)

- **Model:** Haiku 5.5 (exact, mechanical work; no design choices).
- **Branch:** `ad/s8-wording`, in your own worktree, cut from `ad/foundation` (it holds ad/01–ad/05 and pairs A, B, C and S7). Commit as you go; never push, never merge.
- **Read first (only this):**
  - `CLAUDE.md` (the i18n convention and D67's guardrail rule), then `docs/decisions.md`. Look up by number in `docs/tracker.md` (search `| D82 |`): D82, D67, D81; and the line `T44.` for the review list.
  - `scripts/vendor-words.config.ts` (which folders and message keys may name a POS) and `scripts/vendor-words.baseline.json`.
  - The files you own (below).

## Goal
No interface string names a POS: every sentence that spoke of "barsy" says `{source}` (the instance's name), except under `connectors.<kind>.*`, which is the connector's own. Bulgarian and English carry the same keys. The vendor-word baseline is lowered to what is left. Martin gets one file listing every sentence added since his last review (T44), Bulgarian first, grouped by screen, so he can review the wording in one sitting.

## Do, in this order
1. **Find every vendor word in the messages:** `pnpm vitest run --project scripts scripts/vendor-words.test.ts --reporter=dot` shows the counts; list the keys in `apps/web/messages/en.json` and `bg.json` whose text contains "barsy" (any case) outside `connectors.*`.
2. **Rewrite each with `{source}`** when the component that uses the key already passes a `source` value (grep the key's last segment in `apps/web/src`; the call looks like `t('key', { source })`). If the component does not pass `source`, do not touch the component: list the key, the file and the line in your report under "needs the instance name", and leave the text as it is.
3. **Texts S1 and the lead flagged as wrong:** `tables.empty` (it tells the person to choose the venue's barsy venue in the Menu source card, which no longer exists: say that the tables arrive with the next read from `{source}`, and that a venue without a till adds its own areas and tables); check `settings.deletedVenues.*` and `venues.*` for any sentence that still tells the person to link the till again in Settings › Integrations (the restore does it, V1).
4. **Parity:** every key in `en.json` exists in `bg.json` and the other way round, with the same placeholders (`{name}`, `{source}`, `{count}`…). Fix by adding the missing translation; never delete a key that a component uses (grep first).
5. **The baseline:** run `pnpm vendor-words:baseline`; it only lowers counts (D67). If it refuses because a count would rise, you added a vendor word: undo that.
6. **The review list:** write `docs/i18n-review.md`: a heading per screen (Integrations, Venues, Deleted venues, Settings › General, Venue settings, Publish, Tables & QR, Composer › Structure, Composer › Design, Guest), and under each the Bulgarian sentences added or changed since T44's last entries (every key under the namespaces those screens use that is not in the list T44 already holds), each on one line as `key — Bulgarian — English`. Put the T44 "wording to check" items at the top of each heading. Add one line to T44 in `docs/tracker.md` that points at the file.
7. **Checks:** `pnpm lint && pnpm typecheck`, `pnpm vitest run --project scripts --reporter=dot`, and the component tests of any file whose messages you changed (`pnpm vitest run --project apps/web <the component's test file> --reporter=dot`).

## Never / scope
- Scope: `apps/web/messages/en.json`, `apps/web/messages/bg.json`, `scripts/vendor-words.baseline.json` (down only, through the script), `docs/i18n-review.md` (new), one line in `docs/tracker.md` under T44. No component, no code, no other file.
- Never raise a count in the baseline, never add a key to `allowKeys`, never move a text under `connectors.*` to hide a vendor word.
- Never run the full `pnpm test`, `pnpm build` or Playwright.
- Secrets: never read `.env.local`.
- Report as in `docs/agent-briefs/_template.md`, at most a page, in your final message: the keys rewritten, the keys that need the instance name (file and line), the parity fixes, the baseline before and after.
