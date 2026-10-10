# Brief CF-02: barsy sync safety (no mass hiding, scope changes force a full read, option names, host change)

- **Model:** Sonnet 5.5. **Branch:** your worktree branch, from `cf/foundation`.
- **Read first:**
  - `CLAUDE.md` (rule 6 especially);
  - `docs/tracker.md` → T62, T67, D41, D56;
  - `docs/reviews/connector-architecture/B1-barsy-connector.md` → findings B1-F1, F2, F4, F6, F14 and quick wins Q1, Q2, Q3, Q5;
  - the files named below.
- **Why:** on 10-10 and 10-11 a change of the barsy venue or the menu category hid the whole menu. A complete read that found **0 items** marked all 65 links missing (T62). Sync state is keyed by the barsy venue only, so a changed category or setting is never re-read fully until 12:00. These four fixes stop that before the pilot.
- **Out of scope:**
  - renaming barsy to a neutral till;
  - moving code into a connector package;
  - tables (T66/T67);
  - any UI beyond one error message.

  Keep the code where it is: a later step moves it.

## 1. Never conclude absence from an empty or sharply smaller read (B1-Q1, T62)

**Where:**
- the absence step in `apps/worker/src/sync/catalogue.ts`, `syncFetched` (around lines 451–508, where `concludeFullPull` is called for links);
- the places step in the same file (around 550–607), where `upsertPlaces` is called with `pagesOk: [true]`;
- `upsertPlaces` in `packages/core/src/apply/barsy-venues.ts` (around 219–329).

**What and how:**
- **New pure helper:** add `absenceHold` in `packages/core/src/sync/` (next to `conclude-full-pull.ts`, exported the same way). It takes `{ activeBefore: number, seen: number, wouldGoMissing: number }` and returns `{ hold: false } | { hold: true, reason: 'empty_read' | 'too_many_missing' }`. Rules:
  - `seen === 0 && activeBefore > 0` → hold, `empty_read`;
  - `wouldGoMissing >= ABSENCE_HOLD_MIN && wouldGoMissing / activeBefore > ABSENCE_HOLD_RATIO` → hold, `too_many_missing`;
  - constants in core: `ABSENCE_HOLD_RATIO = 0.3`, `ABSENCE_HOLD_MIN = 5`;
  - otherwise no hold.
- **Links:**
  - after `concludeFullPull` has computed its changes, count the would-be `missing` moves and call `absenceHold` with the number of active article links before the run and the number seen;
  - also hold when the read saw 0 sections while active category links exist (`empty_read`);
  - on a hold, apply **no** `setLinkState` moves, but do apply the seen ops. Set `deletionCheckSkipped = true`, add a note (e.g. "deletion check held: the read would hide 61 of 65 items (94%); nothing was hidden"), and put a structured entry in the run's `details` (`absence_held: { reason, would_hide, active }`). Use the same mechanism that writes `deletion_check_skipped` today (`core/apply/job-runs.ts`).
- **Places:**
  - same rule with the place counts;
  - pass a real `pagesOk` instead of the constant `[true]`;
  - if a hold applies, no place goes `missing` or `deleted`, and no token is retired;
  - do the counting inside `upsertPlaces` (it knows the stored rows): add an optional `hold` callback or the counts to its evidence. Keep it pure-testable.
- **No override yet:** a person will release a hold with the switch preview in a later brief. Leave a `// TODO(T62 preview)` comment where the override would plug in.
- **Rule 6 stays:** absence is still concluded only after a complete read. This only adds cases where we conclude nothing.

## 2. A changed scope or setting forces a full read (B1-Q2)

**Where:**
- `SyncStateSchema` in `packages/core/src/apply/sync-config.ts` (lines 22–35);
- the place where a successful full pull writes `cursor` and `tree_hash`;
- the incremental check in `apps/worker/src/jobs/barsy.ts` (around 367–392: `state.cursor === undefined || state.tree_hash !== treeHashOf(tree)` queues a full pull).

**What and how:**
- **Write it:**
  - add `scope_hash` (Sha256, optional) to `SyncStateSchema`;
  - compute it in the worker as SHA-256 over a stable JSON of `{ bid, catalogueRootCatId, priceSource, allergenKey, defaultLocale, includeServices, mappingVersion }`, taking the values the pull actually used (from `mappingConfig()` / the `VenueTarget`);
  - write it together with `cursor`/`tree_hash` after a **successful complete** full pull.
- **Check it:**
  - in the incremental, treat `state.scope_hash !== currentScopeHash` like a changed tree: queue a full pull, respecting `FULL_PULL_COOLDOWN_MS`;
  - note: "the menu category or sync settings changed: a full pull was queued";
  - a missing `scope_hash` (old state) counts as changed, so one extra full pull happens after rollout. That is intended.
- **Why it matters:** switching the root, the barsy venue, or price source/allergen key/language now re-reads everything within a minute instead of at 12:00. Switching back (A→B→A) no longer reuses a stale cursor. Combined with part 1, a wrong root can no longer hide the menu.

## 3. An incremental run never clears option names (B1-Q3)

**Where:** `packages/barsy/src/mapping/catalogue.ts` around lines 390–397 and 540–548 (option names come from option articles in the same run).

**What and how:**
- Write an option's name only when its option article is in this run's article list.
- Never emit `clearField` for an option name because the option article is absent from the batch, in either mode. A name is cleared only through the normal "the option itself is gone" path.
- If the mapping has no notion of mode, the rule above needs none.

## 4. Refuse a host change while the connection has a menu (B1-Q5)

**Where:** `apps/web/src/server/integration/service.ts` around lines 456–512 (`hostChanged` → `clearBarsyVenueChoices` + config reset).

**What and how:**
- When the host changes and the integration already has any `source_links` rows, refuse with a new failure code `host_change_blocked`. Do it before any write. Use a read through `withTenant`; add a small read helper if none exists.
- **Why:** barsy ids are unique only per installation, so another installation's article 11 would land on our old node.
- Same host with new credentials stays allowed.
- **Messages (BG and EN):** "This connection already holds a menu from another barsy installation. Changing the address would mix the two menus." Add the key next to the existing integration error messages, and show it where the connect card shows its other errors.

## Tests

- **Core unit and property** (fast-check):
  - `absenceHold`: an empty read never hides;
  - hiding more than 30% (and at least 5) always holds;
  - a small drop passes;
  - never holds when `wouldGoMissing === 0`.
- **Worker database tests** (`CI=true`, your own database `restro_cf_02` on the running 54329 instance; see CLAUDE.md "Database tests"), on the existing fake barsy (`apps/worker/tests/fake-barsy.ts`):
  1. a complete full pull returning 0 articles over a menu with active links → nothing goes missing, run notes and `details.absence_held` say why;
  2. a pull that would hide 61 of 65 → held;
  3. a pull that drops 2 of 65 → those 2 go missing as before;
  4. an empty places list over 92 stored places → none missing, no token retired;
  5. after a root change (`setCatalogueRoot`) the next incremental queues a full pull;
  6. with unchanged scope the incremental runs as before;
  7. an incremental containing a combo whose option articles are not in the batch → no option name is cleared.
- **Web:** host change refused when links exist; allowed when there are none; same host with new credentials allowed.
- **Keep green:** every existing rule-6 test.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests, plus the Playwright suite.
- **Report:** in the CLAUDE.md format, including the exact note texts you used.

## Never / scope

- **Dependencies:** none new.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Barsy:** never call it for real.
- **Scope:** don't rename barsy to till and don't move code between packages.
- **Scratch files:** `<your scratchpad>/cf-02/`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Stop and ask:** if a rule here conflicts with a test or with rule 6, stop and ask in your report.
