# Brief CF-12: small hardening (guest overlay parsing, referrer policy, held-sync warning, picker hints, currency check)

- **Model:** Sonnet 5.5. **Branch:** your worktree branch, from `cf/foundation`.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/tracker.md` → T62, T70, T71;
  - `docs/reviews/connector-architecture/A5-guest-outbound.md` (F2, F5; P1, P3);
  - `B1-barsy-connector.md` (F5, F19, F21; Q6, Q10);
  - the CF-02 merge (`git log --oneline -12 cf/foundation`): the held absence check writes `job_runs.details.absence_held = { reason, would_hide, active }`.
- **Why:** five small, independent fixes the review found. Each is safe on its own.
- **Not here:**
  - renaming barsy to till (CF-03 runs in parallel and touches core types, the composer and messages; stay out of `packages/core/src/{change-set,validate-write,field-definition,resolve}`, `apps/web/src/composer`, `apps/web/src/server/item-sheet`, and the composer/item-sheet message keys);
  - migrations.

## 1. The phone tolerates newer overlay files (A5-P1, A5-F2)

**Where:**
- `LiveOverlaySchema` in `packages/core/src/snapshot/schema.ts` (~line 380, `z.strictObject` today);
- the loader in `apps/web/src/guest/load.ts` (~215: a failed overlay parse becomes "no overlay", which drops sold-out marks, the less cautious error).

**What:**
- The top level becomes tolerant of **unknown keys** (`z.looseObject` or an equivalent that keeps `version` and `items` strict). The `items` entries stay strict (`{ sold_out: true }`).
- Add a test: an overlay file with an extra top-level key (e.g. `"ordering": { "state": "on" }`) parses, and its sold-out marks still apply on the guest page.
- Write the rule as a comment above the schema: "Published files change parser-first: loosen the reader, deploy it, then let the producer emit the new field. Inside `menu-snapshot/1` and `live.json` v1, new fields are optional forever."
- **Snapshots stay strict;** don't touch `MenuSnapshotSchema`.

## 2. Referrer policy and a confirmed table token (A5-P3, A5-F5)

**Where:** `apps/web/next.config.ts` (`headers()`); `apps/web/src/guest/guest-menu.tsx` (~114–127, ~214) and `apps/web/src/guest/context.ts` (`readTableToken`).

**What:**
- Send `Referrer-Policy: no-referrer` on `/m/:path*` and `/t/:path*`. Read the Next.js 16 headers guide in `apps/web/node_modules/next/dist/docs/` first.
- The guest page passes a table token to the shell only after `loadTableLabel` found a token file for this venue (it does the lookup already). A well-formed but unknown `?t=` behaves like no token.
- **Tests:** the header is present on both routes (test the config function or a route test); an unknown token gives no table context.

## 3. A held sync is visible in the Integration tab (CF-02 open question 2)

**Where:** the run view, `apps/web/src/server/integration/*` (where `job_runs` rows become the run view: `toRunView` or similar); the sync card in `apps/web/src/integration/`.

**What:**
- Pass `details.absence_held` through to the view.
- When the latest **complete full pull** was held, the sync card shows a warning:
  - EN: "The last full sync found {count, plural, ...} fewer items than the menu has and hid nothing. Check the menu category and the barsy venue." Use `would_hide` and `active` naturally, e.g. "would have hidden 61 of 65 items".
  - BG: the same meaning.
  - `reason: 'empty_read'` says the sync found no items at all.
- The run history row shows a short "held" badge.
- No action button yet: the release comes with the switch preview (CF-11).
- **Messages:** BG and EN under the existing `integration.*` keys.

## 4. Picker hints (B1-Q6, B1-F5, B1-F21)

**Where:** the barsy venue picker and the menu-category picker in `apps/web/src/integration/` (`barsy-venue-card.tsx`, `catalogue-root-card.tsx`) and the service that builds their view (`apps/web/src/server/integration/{service,view,tree}.ts`).

**What:**
- **Venue picker:** next to each barsy venue, show what the stored `Barsys_getlist` source record says:
  - its public address, if any;
  - a "Public menu set up" hint when `public_cat_id` is set.

  The record is in `source_records` (find how `service.ts` reads stored records for characteristics around lines 183–192 and reuse that pattern).
- **Category picker:**
  - mark the category whose id equals the venue's `public_cat_id` as "Suggested (the venue's public menu in barsy)";
  - if the cached tree keeps `child_articles_cnt`, show the item count next to each category. If the cache drops it, say so in your report and don't change the cache format.
- **Hints only:** never choose anything automatically.
- **No barsy ids on screen** (rule 3): ids stay as hidden form values, as today.

## 5. Currency check at connect (B1-Q10)

**Where:** the connect job in `apps/worker/src/jobs/barsy.ts` (it reads `Currencies_getlist`) and the status detail codes (S3-09 made the worker emit status *codes*, rendered by the web).

**What:**
- Find barsy's system or default currency in the stored response. If it is not EUR, connect still succeeds, but with a status detail code `currency_not_eur`, shown as a warning on the status card: "The till's main currency is not EUR; Restro shows prices in EUR only."
- If the recorded fixture (`packages/barsy/fixtures/demo/currencies.json`) doesn't show which currency is the system one, stop and report instead of guessing.

## Tests

One test per item above, at the level that fits:
- unit for schemas and pure functions;
- component tests for the cards;
- a DB test for the run view if it reads `job_runs`.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests on your own database `restro_cf_12` (54329), plus the Playwright suite.
- **Vendor words:** the vendor-word test stays green. Your new strings live under the integration keys and may name barsy (it is the barsy setup screen). If a count goes up, say so in the report (the lead approves); don't raise the baseline yourself.
- **Report:** in the CLAUDE.md format.

## Never / scope

- **Dependencies:** none new.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Barsy:** don't call it.
- **Files:** LF line endings.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
