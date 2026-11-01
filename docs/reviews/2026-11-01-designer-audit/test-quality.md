# B8: can the tests be trusted (read-only half)

**Who:** B8, designer audit step 8. **Pin:** `st/foundation` at `7dccd3a4` (CI run 41255336162, green). **Mode:** read-only; I ran no test, no server, wrote no test and no branch. Everything below is from the worktree `E:/Restro/.claude/worktrees/da-pinned`, the pin's CI log and the CI logs of the 70 `st/` runs since 10-30 10:00 UTC (70 runs fetched into my scratchpad: `b8-logs/`, parsed in `b8-parsed.txt`).

**Covered:** the 113 "renderings" and what compares them; every skip, `skipIf`, todo and filter on tests the wave added or changed; retries and every flaky or failed spec in the `st/` runs since 10-30; about 24 test files read against their code (list under "Do the new tests test the code"); the CI duration.

**One line:** the renderings are compared in CI and the comparison ran at the pin, but they are markup and stylesheet text, not pictures; nothing in CI compares what the browser paints. One e2e test the wave changed is silently skipped by the wall clock (it was skipped at the pin). CI is at 73% to 100% of its 60-minute limit.

---

## 1. The renderings: what compares them

**What the files are** (109 `.snap` under `packages/faces/editorial-market/src/__renderings__/`, plus 3 migration snapshots and a few others that make up the 113):
- `<style>/<fixture>.html.snap`: 5 Styles (basic, editorial, soft, classic, club) x 17 fixture menus, the server-rendered browsing page with the `<style>` tag removed and the markup split one tag per line. `big-menu` is stored as a 16-hex-digit hash, not whole.
- `<style>.css.snap` (5) and `today/today.css.snap`: the stylesheet as that Style draws it (`resolvedCss`: the rules for the root's attributes, tokens worked out). These are the 1,300 to 2,458-line files.
- `today/<fixture>.html.snap` (17): the face's markup from before it became the renderer, to hold Editorial to today's look.
- `options.snap`: one line per value of every option, with a hash of the markup and a hash of the stylesheet.

**What compares them:** `packages/faces/editorial-market/src/design.test.tsx` (114 tests), using `toMatchFileSnapshot` and `import.meta.glob(?raw)`. It is a plain Vitest file, picked up by the root `vitest.config.ts` (one project per package), so `pnpm test` in `ci.yml` ("Test" step) runs it. No skip, no env gate, no project filter, no `grep`. The CI environment sets `CI=true`, so Vitest does not write a missing snapshot and a mismatch fails (I did not run it to confirm that Vitest's CI default applies to `toMatchFileSnapshot`; I read it from Vitest's documented behaviour).

**It ran at the pin.** From the pin's log: `✓ packages/faces/editorial-market src/design.test.tsx (114 tests) 47751ms`, and the run totals `Test Files 572 passed | 2 skipped`, `Tests 9197 passed | 22 expected fail | 7 skipped | 9 todo`. The 2 skipped files are `return-address.red.test.ts` and `sandbox-checks.test.ts`; neither is the wave's.

**It can see.** The same file proves its comparison can fail: `does show when the option leaves its first value: the comparison can see` (design.test.tsx:264), and the sweep is guarded against checking nothing (`report.cases >= 84`, five Styles, `report.renders === cases x fixtures`).

**`faces-visual` is the switched-off spec (RR-O3), still switched off, and it never was a comparison.** `apps/web/e2e/faces-visual.spec.ts:69`: `test.skip(process.env.FACES_VISUAL !== '1', ...)`. Its own header says "pictures for people to look at, not a pixel comparison": it writes PNGs into `test-results/faces-visual/` for a person. At the pin it is part of the 138 skipped Playwright tests (about 130 of them: the matrix comment says "there are 130 of these tests"). The wave changed it (+25 lines in `faces-visual.spec.ts`, +71 in `visual-fixtures.ts`), so it still works, but nothing runs it.

**What does run in a browser in CI** (all ran at the pin, 430 passed, 0 flaky, 0 failed): `faces-design.spec.ts` (each Style on a light and a dark screen and each value of each option on a light one, at 320, 390, 820 and 1280 px) and `faces-design-screens.spec.ts` (the five guest-feature screens, at 320 and 390), both through `faces-floors.ts`; `faces-a11y.spec.ts`, `faces-a11y-services.spec.ts`, `touch-targets.spec.ts`. They measure **floors only**: touch target at least 44 px, nothing past the screen edge, no sideways scroll, no ellipsis or line clamp on a name, text at least 12 px (16 px in an input), contrast 4.5:1 (3:1 large). They say nothing about how the page looks.

### Which change on the guest page passes CI unseen

A change reaches `main` with CI green and nobody having been shown the page, when it is any of:

1. **A re-recorded look.** The only guard on a look is that the stored text differs. `design.test.tsx:11` tells the author that `vitest -u` "rewrites the files and the diff shows what moved". A pull request that changes CSS and runs `-u` is green by construction; the only thing that sees it is a person reading a diff of up to 110 files and 50,000 lines. (Moving a look that way is by design; the point is that CI adds nothing there.)
2. **The markup of the service screens.** `renderBrowsing` is `<EditorialMarketFace view={view} />` with no services, so no stored rendering holds the bag, the bill, Call a waiter, Pay or the receipt. Their markup is held only by selector assertions in `bag.test.tsx`, `pay-first.test.tsx`, `screen-options.test.tsx` and friends (specific slots, strings, amounts) and by the floors. Moving a row, changing an icon, or reordering the sections of the Pay sheet while keeping the slots passes. Their stylesheet is in the stored CSS (`SERVICES_CSS` is part of `CSS`), so a CSS change there does turn the snapshot red.
3. **The dish page, the filter sheet, the allergen sheet.** Opened by a tap, so not in a static render. Held only by `face.test.tsx` assertions and by the floors on the dish page and the allergen sheet.
4. **What the browser paints that the text does not say:** whether the body or heading font file actually loads (a failed load falls back silently; the floors do not read font families; I did not look for a separate font-loading test), photo cropping against a real image, stacking and sticky positions, safe-area, animation. Only the floors are measured.
5. **A menu shape outside the 17 fixtures.** The `scheduled` fixture is excluded from the sweep on purpose (`neverListFixtures()`, `design-contract.ts:147`), so an item with a schedule label is not in any stored rendering; `today/scheduled.html.snap` is an orphan nothing reads.
6. **The venue's look reaching Stripe's card form** (see section 2): not compared anywhere in CI.

So: something does compare, and it ran. What nothing compares is the painted page. I record this as an observation, not a defect (OBS-B8-1).

---

## 2. Skips

Every skip I found on a test the wave added or changed, and whether CI meets it.

| Test | Condition | Does CI meet it | What is then unproven |
|---|---|---|---|
| `apps/web/e2e/guest-pay-card.spec.ts:42` (4 tests: 2 Styles x 3-D Secure and declined) | `test.skip(!SANDBOX)`: needs `STRIPE_SANDBOX_E2E=1`, the Stripe sandbox keys and a connected account | **Always skipped in CI** (header: "skipped everywhere else (CI included)"). 4 of the 138 | The real Payment Element in the real page: that it mounts with the venue's Appearance options (`connectors/stripe/appearance.ts`), 3-D Secure completes inside the page with no redirect, a decline shows Stripe's text and the page never says Paid. It is the **only** browser proof of the card form; the only other real-Stripe check is the server-side `packages/payments/stripe/src/testing/sandbox-checks.test.ts` (3 tests, `describe.skipIf(!RUN)`, also skipped in CI). Everything else about the card form runs against a fake Stripe (`card-form.test.ts`) or the simulated provider (`guest-pay.spec.ts`). Confirmed: `guest-pay-card.spec.ts` is the only one. |
| `apps/web/e2e/sold-out.spec.ts:417` "the mark lapses with the service day: the real worker's tick remakes live.json without it" (the wave changed this file: -64/+, the assertion now `'gone'`/`'available'` per the decision 131) | `test.skip(localHour >= 23 \|\| localHour < 7)`, the hour in Europe/Sofia at the moment the test runs | **Half the day, by the wall clock.** The Playwright skip count is 138 for runs whose e2e step ended between about 21:30 and 04:50 UTC and 137 otherwise (see the table in `b8-parsed.txt` data; the pin's run, e2e 00:17 to 00:51 UTC, is 02:17 to 02:51 in Sofia, reported `138 skipped`). The merge run for #282 (21:08 UTC) and the pin's own run were both in the skipped window | That a sold-out mark made tonight lapses at the end of the service day, the real worker rewrites `live.json` without it, and the guest sees the item back on the menu. At the pin this is unproven by e2e. See DA-B8-1. |
| `apps/web/e2e/faces-visual.spec.ts:69` | `FACES_VISUAL !== '1'` | Always | the screenshot matrix (about 130 tests); see section 1 |
| `apps/web/e2e/composer.spec.ts:483`, `integration.spec.ts:526`, `tags.spec.ts:333` | no `SCREENSHOT_DIR` | Always | only the screenshot steps; the wave edited `composer.spec.ts` but not these tests' purpose |
| `apps/web/e2e/faces-a11y-services.spec.ts:38`, `faces-design-screens.spec.ts:38` | `FACE_ID !== 'editorial-market'` | **No**: `FACE_ID` defaults to `editorial-market`, both ran in CI (`faces-design-screens` appears in the failure lists) | none |
| 12 files `describe.skipIf(!hasDatabase)` (`design-record`, `design-styles`, `design-migration`, `design-styles-table`, `actions.test.ts` of the Design page, `guest-features-actions`, `menus-actions`, `shared-device-admin`, `shared-device-menu`, and others) | `DATABASE_URL_OWNER` unset | **No**: `test-database.ts` throws when `CI` is set and the variable is missing, and the pin's log shows them run with their test counts (`design-record 15`, `design-migration 13`, `design-styles 11`, `design-styles-table 7`, `server/design/actions 13`) | none in CI; on a PC without a database they skip with a stderr note |
| Vitest: 7 skipped, 9 todo, 22 expected-fail at the pin | `it.fails`, `describe.skipIf(RUN)`, `it.todo` in `return-address.red.test.ts`, `sandbox-checks.test.ts`, `conformance.test.ts` (stripe, barsy), `kit.test.ts` | Yes, all of them | None are the wave's. I found no `.skip`, `.todo`, `.fixme`, `.only` or `test.fail` added by the wave in a Vitest or Playwright file other than the rows above (grep over the 121 changed test and e2e files) |

**Playwright filters:** `testIgnore: /item-sheet\.spec\.ts/` on the `chromium` project, and a second project `item-sheet-dev` for that spec only. No other filter. `forbidOnly` is on in CI.

---

## 3. Retries and flakiness

**Setting:** `apps/web/playwright.config.ts`: `retries: process.env.CI ? 2 : 0`, `workers: 1`, `fullyParallel: false`, `trace: 'on-first-retry'`, reporter `github` + `html` in CI. A test that fails twice and passes on the third attempt is reported "flaky" and **the check is green**. `design.spec.ts:34`, `composer.spec.ts`, `admin.spec.ts`, `integration.spec.ts`, `navigation.spec.ts`, `item-sheet.spec.ts`, `guest-features.spec.ts` are `describe.configure({ mode: 'serial' })`: a failure in one test skips the rest of that file ("3 did not run" in run 41246990550) and a retry reruns the whole file from the top.

**At the pin:** 568 tests, 430 passed, 138 skipped, 0 flaky, 0 failed. No retry was used.

**The `st/` runs since 10-30** (70 runs read; 50 reached the e2e summary, 13 failed or were cancelled before e2e, 7 were cancelled during it). Every spec that failed on a first attempt and passed on a retry ("flaky" in the summary), with run ids, for the later rerun:

| Spec (line at that time) | Flaky in | Runs (examples) | Note |
|---|---|---|---|
| `payment-tables.spec.ts:201` "an older sign-in asks for the password, then the mark goes through; the banner is gone" | 28 runs, 10-30 10:46 to 10-31 08:43 UTC (last: 41185756797) | 41043218898, 41079939537, 41101280774, 41131960557, 41159992720, 41176595574, 41185756797 | not the wave's spec; stopped after `or/foundation f1f37abb` (the RR-3 flake fixes) was merged in at 08:43 |
| `faces-design.spec.ts:37` (every design variant "holds every floor at 320, 390, 820, 1280 px") | 11 runs, 10-31 06:26 to 11:43 UTC, 66 to 75 of the 76 variants flaky per run | 41176595574, 41180177885, 41181792493, 41182745620, 41185756797, 41185771463, 41186634138, 41189919836, 41190246389, 41193889897, 41194145145 | the wave's spec. Cause (from the fix, #280 "the floors wait for a sheet to be drawn and fade in"): the dish page was measured before it had faded in, every text read 1:1. Three of these runs went red anyway (37, 45 failed). Zero since 41198401321 / #280. Four of them were green with 74 flaky: the check did not say so |
| `tables.spec.ts:392` / `:395` "an area is renamed and moved; a table is hidden (its file goes), shown again and moved" | 5 runs | 41080681271, 41088994498, 41180177885 (392); 41220866010, **41242190424** (395) | **still flaky after the flake fixes**: it flaked in the #282 push run (21:08 UTC 10-31) and passed on retry. Not the wave's spec |
| `design.spec.ts:468` "a tap on a part of the preview opens its page; in Simple it says the part is styled in Advanced" | 1 run | 41220866010 | the wave's spec. It also failed outright (all 3 attempts) as `:463` on 41203980591 and 41211385054, and `:497` on 41215499151, before it settled |
| `faces-a11y-services.spec.ts:173` "nordic, dark: every text reads, and the edge of every input and choice shows at 3:1" | 1 run | 41220866010 | the wave's spec |
| `guest-send.spec.ts:105` "in editorial: a round a waiter doubles while the answer never comes ends Unconfirmed" | 1 run | 41220866010 | the wave's spec |
| `owner-paying.spec.ts:293` "a role without the right sees everything read-only" | 1 run | 41151130616 | not the wave's |

**Specs that failed on all three attempts (red) and were then fixed in the same pull request,** worth a look for fragility at the rerun: `design.spec.ts` `:221`, `:463`, `:497`, `:641`, `:658` (My styles: 120 s timeouts on 41246990550, `getByTestId('design-save-style-name')` never appeared; fixed by `69235bde` "the Style writes are not a React transition"), `:676`; `guest-pay-first.spec.ts:261` (both Styles, runs 41182745620, 41186634138, 41190246389); `faces-design-screens.spec.ts:123` and `:129` (41159992720, 41163203245); `composer.spec.ts:165` and `:276` (41178184941, 41181792493, 41185756797); `touch-targets.spec.ts:231`; `guest.spec.ts:644`.

**Vitest failures on `st/` runs that cost a run, for the record** (none is a flake of the same test twice; each was fixed): `design-styles.test.ts` "removes a Style softly and puts it back" (41245979700: expected 4 events, got 3) and `structure.test.ts` `events.op` list (same run); `floor.test.ts` "writes nothing for a reading that is not complete" (41220285894: ordering of ids by the CI database's collation); `server/design/actions.test.ts` "appends one event ..." (41177343625: counted the events of earlier tests, "length 2 but got 3"); `sold-out-rule5.test.ts` (41119991080: the property failed deterministically because decision 131 moved a sold-out item off the menu; the test was then tightened, see below).

---

## 4. Do the new tests test the code

About 24 files read, weighted as asked. For each: could it go red, and the negative case.

| File | Verdict |
|---|---|
| `packages/core/src/apply/design-record.test.ts` (Postgres, restro_app) | **Strong.** Stored record equals expected with provenance (:218), one event with old and new value, revision counts up, `stale_revision` with the stored design for revisions 0, 2, 99 (:292), two saves at once let one through (:308), unreadable colours (:319), archived venue (:332), a logo from another organisation or a made-up id (:338), another organisation's venue gives `unknown_venue` with no `storedDesign` (:352) and its events are hidden, publish refuses an off-contract stored design and a later save repairs it (:386), fast-check round trip through apply and the snapshot (numRuns 15, low). Mutations that would go red: drop the revision check, drop the readability check, drop the logo check, drop tenant scoping, write provenance wrong. |
| `packages/core/src/apply/design-styles.test.ts` | **Strong.** Name uniqueness whatever the case and spacing, soft removal, restore refused while the name is taken (:219), RLS on read, on write (the same id from another tenant throws) and on status, a venue's design untouched by Style writes. |
| `packages/core/src/apply/design-migration.test.ts` (scratch database, migrates to 0044 then 0045, 9 hand-built venues) | **Strong** for 0045 (record schema-valid, theme carried over, radius 0 to 32 and shadow 0 to 5 mapped). It does not cover 0046 (drops `menus.settings`) or 0047 beyond `packages/db/tests/design-styles-table.test.ts`; 0046 has no test. |
| `packages/core/src/design/record.test.ts` | **Strong.** Includes the negative: a till source and an `integration:` actor cannot carry `setDesign` (:246), a bad revision, an off-contract value. |
| `packages/core/src/design/saved-style.test.ts` | Good: body font never travels with a Style, names compared without case in Bulgarian, refuses design values. |
| `apps/web/src/server/design/actions.test.ts` (real Postgres; only the session is faked) | **Strong.** Writes the whole design, 13 malformed inputs each `invalid` with nothing written (:223), stale with the stored view, unreadable naming every failing pair, a logo that is not this organisation's, role `member`, `viewer` and `''` give `forbidden` with nothing written (:272), another organisation's venue and a made-up one give `not_found`. Shared tablet: not here but in `shared-device-admin.test.ts` and `shared-device-menu.test.ts` through the attack table, which now lists `saveDesignAction`, `saveStyleAction` and `setStyleStatusAction` (`attack-table.ts:274-298`). **Gap:** `saveStyleAction` and `setStyleStatusAction` have no test of their own for malformed input or for a plain member beyond the attack table; they are covered at the apply level and by e2e. |
| `packages/faces/editorial-market/src/design.test.tsx` | **Strong** for what it holds (section 1). Weakness: `toMatchFileSnapshot`, so a `-u` makes it green; and the `options.snap` rows are hashes, so a failure there says only that a value moved. |
| `packages/faces/editorial-market/src/renderer-rules.test.tsx` | Good: reads the stylesheet and the markup together, the price a step under the name for three sizes in a list and one column, etc. It uses the test harness's own cascade model (`resolvedCss`, `valuesOf`), not a browser; the real width is `faces-design.spec.ts`. Mutation that would survive: a rule whose effect is only in a media query the model flattens (`flat` drops every `@` line, :87). |
| `packages/faces/editorial-market/src/services/pay-first.test.tsx` (445 lines) | **Strong, exact.** Button text `Send and pay €10.00`, the one `order.send` carries lines, pay-first lines, tip percent or minor but never both, amounts `€11.00` and `€12.50`, greys the button for a tip over the lines and sends nothing (`host.calls` is 0), no tip row where the till cannot record one. Uses a fake host (the real binding is covered by `guest-pay-first.spec.ts`, which failed and was fixed). |
| `packages/faces/editorial-market/src/services/screen-options.test.tsx` (666 lines) | Good: for every Style and value, the texts Basic draws are all still drawn (decisions 72 and 122 stay untouched), what an option adds is there. |
| `packages/shell/src/pay-first.test.ts` | Strong: half-up rounding through `money`, the same sums as Pay, no tip where the till cannot record one. |
| `apps/web/src/design/design-page.test.tsx` | Good UI test with the server actions mocked (acceptable: the actions have their own test). Done sends the whole design from the loaded revision (`expectedRevision: 3`), stale shows the stored one, a thrown error keeps the edits, read-only role has no bar. **Gap:** the refusals `forbidden`, `unreadable`, `logo_not_usable`, `not_found`, `failed` are never returned by the mock, so `design-page.tsx:319` (`toast.error(t('errors.' + result.error))`) is untested for them. |
| `apps/web/src/design/my-styles.test.tsx`, `advanced.test.tsx`, `design-draft.test.ts` | Good happy paths and Undo bursts. `my-styles.test.tsx` has the name-taken case but no failed save, no failed delete, no Undo that is refused. |
| `apps/web/src/connectors/stripe/appearance.test.ts` and `card-form.test.ts` | Fine, but both test against what the author believes Stripe accepts: a fake Stripe takes any option. `card-form.test.ts:193-290` does prove the look reaches `stripe.elements`. They cannot prove Stripe accepts the variable names (for example `buttonExpressCheckoutBorderRadius`, `appearance.ts`); I did not check that name against Stripe's docs. |
| `apps/web/src/guest/bound-template-attack.test.tsx` (44 tests) | Strong: eight hostile payloads through every text the guest API can send, rendered with the real Editorial face, nothing becomes markup; table code in a header, our ids in the body. |
| `apps/web/src/guest/table-services-page.test.tsx`, `card-form-look.test.ts` | Good gating tests (which venues are asked the guest API, what the page tells the shell is supported). The line that hands the look to the card form (`guest-menu.tsx:325`, `use-table-services.ts:112`) has no test; see mutation M1. |
| `scripts/design-contract.test.ts`, `scripts/design-writers.test.ts`, `packages/shell/testing/design-contract.test.ts` | Strong guards, each with a "fails on" case proving it can fail (a value moved, an option renamed, a writer added). `design-writers.test.ts` is regex over source text: it cannot see a writer that builds the JSON path from a variable. |
| `apps/web/e2e/design.spec.ts` (serial, 21 tests) | Strong end to end: Done appends exactly one event and survives a reload (:340), two sessions on one revision, the second is refused and shown the stored design and the next save goes through (:366), after Publish the real guest page carries the design in its CSS custom properties and attributes (:541), a member sees it read-only (:571). One Style (Editorial plus a brand colour) goes all the way to a published guest page; Soft, Classic and Club are only exercised in the preview and by the floors. Contains `waitForTimeout(9_000)` at :403 (a fixed wait for a toast to "stay"). |
| `apps/web/e2e/faces-design.spec.ts` + `faces-floors.ts` | Real measurement in a real browser; non-vacuous (it waits for the root to be visible; the fix for the 1:1 race added the wait). Measures floors only. |
| Deleted tests: `apps/web/src/guest/face.test.tsx`, `design-panel.test.tsx` (223 expects), `qr-phone` (3 files, 336 expects), `venue-theme.test.ts` | The ones that carried a behaviour the new tests do not: `guest/face.test.tsx:47` "highlights the section being read while the page scrolls" (qr-phone's rail) was **not ported** to Editorial: no test in `editorial-market/src` scrolls (grep: none), and the e2e `guest.spec.ts:152` only taps a link. The other deleted guest behaviours (filters, allergen sheet, language switch, schedule text) are in Editorial's `face.test.tsx` or `contract.test.tsx`. `sold-out-rule5.test.ts` was **tightened, not weakened**, for decision 131 (an item not available must now be absent from the guest view, `toBeUndefined`). |

### Mutation candidates for the later runner

Cases where I could not find a test that goes red. Each is a mutation to try; the first three are the likeliest to survive.

| # | Mutation | File:line (pin) | Why I expect it to survive |
|---|---|---|---|
| M1 | pass `null` instead of `cardLook` to `useTableServices`, or `look: null` in `lookNow()` | `apps/web/src/guest/guest-menu.tsx:325`; `apps/web/src/guest/use-table-services.ts:112` | `card-form.test.ts` passes `look` in directly; `card-form-look.test.ts` tests the pure function; no test renders the guest page through to the card form with a look. Only the skipped `guest-pay-card.spec.ts` would see it |
| M2 | remove the `ne(venues.id, exceptVenueId)` or `isNull(venues.archivedAt)` in `loadVenueStyles`; remove `isNull(designStyles.removedAt)` or the `SavedStyleContentSchema.safeParse` filter in `loadSavedStyles` | `apps/web/src/server/design/styles.ts:49-90` | no unit test calls `loadSavedStyles`, `loadVenueStyles` or `loadMyStyles` (grep: only `page.tsx`); `design.spec.ts:704` checks one other venue's tile is there, not that the venue's own, an archived venue's or a removed Style's is absent |
| M3 | delete `setActive(current)` in the IntersectionObserver callback of the section rail | `packages/faces/editorial-market/src/category-rail.tsx:41-44` | jsdom has no `IntersectionObserver` (the effect returns at :28), and the e2e only clicks a link, which sets the section itself |
| M4 | replace `t('errors.' + result.error)` with one generic message | `apps/web/src/design/design-page.tsx:319` | the mocked action never returns `forbidden`, `unreadable`, `not_found`, `logo_not_usable` or `failed` |
| M5 | remove the `source !== 'manual'` guards inside the ops | `packages/core/src/apply/apply.ts:1633`, `:1737`, `:1779` | an equivalent mutant while `change-set.ts:553-566` refuses the same sets at parse (tested in `record.test.ts:246` for `setDesign`, `design-styles.test.ts:290` for Styles). Both would have to go for a test to see it; listed so the runner does not count it a survivor |
| M6 | in `StyleInput` change `strictObject` to `object` or drop `PremadeStyleIdSchema` | `apps/web/src/server/design/actions.ts:92-104` | no malformed-input test for the two Style actions; `apply`'s own op schema re-validates, so likely equivalent at the database but a different answer (`invalid` vs `failed`) |
| M7 | flip the `design-writers` `KEY_WRITTEN` or one `WRITES` pattern | `scripts/design-writers.test.ts:62-110` | the test has fixtures for the allowed writers but I did not find a "fails on" case per pattern, unlike `design-contract.test.ts` |
| M8 | lower `numRuns: 15` or drop one option from `anyDesign` | `design-record.test.ts` property | the property still passes; small number of runs |

---

## 5. CI duration

| Run | Job | Test step | Build | Playwright install | E2E step |
|---|---|---|---|---|---|
| **Pin** 41255336162 (push, merge of #284) | **43 m 45 s** (00:07:23 to 00:51:08) | 7 m 34 s | 35 s | 36 s | **33 m 19 s** (33.3 m by Playwright) |
| 41251637716 (#177's pull request run, the one #285 quotes) | **51 m 10 s** (23:13:53 to 00:05:03) | 10 m 40 s | 48 s | 1 m 55 s | **35 m 43 s** |
| 41246990550 (#177, red) | 57 m 46 s | 10 m 42 s | 50 s | 26 s | 43 m 39 s |
| 41225716168 (#176, **cancelled at the 60-minute limit**) | 60 m 15 s | 10 m 13 s | 48 s | 16 s | 46 m 55 s, cancelled |

**#285 confirmed, with a correction of which run:** its 51 m 10 s and 35 m 43 s are #177's pull-request run 41251637716 exactly; the pin's own push run is 43 m 45 s and 33 m 19 s (73% of the limit). Across the 30 `st/` runs since 10-31 06:00 UTC that lasted more than 30 minutes: 16 took 50 minutes or more, 7 took 55 or more, one reached 60 and was cancelled; the range is 37 to 60 minutes. The e2e step is 76% of the job. The spread is the runner's speed, not the test set: the same suite took 22 minutes at 296 tests (10-30 morning) and 28 to 46 minutes at 380 to 430.

---

## Findings

| Id | Severity | file:line (pin) | Rule or ticket text | Failure scenario | Evidence | Confidence |
|---|---|---|---|---|---|---|
| DA-B8-1 | medium | `apps/web/e2e/sold-out.spec.ts:417-424` | the file's own comment: "Only true between 07:00 and 23:00 Sofia time ... Skip." CLAUDE.md "Done = ... CI green" | If a merge to `st/foundation` or `main` runs the e2e step between 23:00 and 07:00 Sofia (21:00 to 05:00 UTC), "the mark lapses with the service day" is skipped and CI is green with that behaviour unproven: a sold-out mark that survives the service day (the guest never sees the item back) or one that rewrites `live.json` wrongly would pass. The pin's run (e2e 00:17 to 00:51 UTC = 02:17 to 02:51 Sofia) is in the window | the pin's log: `138 skipped`; the runs table in section 2: 138 for every run ending 21:30 to 04:50 UTC and 137 for those ending 05:31 to 21:07; the merge run for #282 at 21:08 UTC and the pin's run both in the window. The only other e2e that exercises the lapse is this one; the property test `sold-out-rule5.test.ts` covers marks and forged writes, not the worker's tick rolling the day | 0.85 |
| DA-B8-2 | medium | `.github/workflows/ci.yml` (`timeout-minutes: 60`), `apps/web/playwright.config.ts` (`workers: 1`) | #285: "A run that reaches the limit is cancelled and proves nothing, which already happened once on #172" | If an `st/` or `main` run reaches 60 minutes it is cancelled and produces no verdict; it already happened to `41225716168` (#176, 60 m 15 s) and, at the earlier 40-minute limit, to `41146874546` and `41140490231` (both `st/04-browsing-options`, the run #285 calls #172). 7 of 30 runs since 10-31 06:00 were at 55 minutes or more | job and step timings above (API), cancelled runs in `b8-runs.json` | 0.95 |

I have no critical or high finding in the tests. Neither of these two says a wrong behaviour is in the product; both say a green check proves less than it appears to.

## Observations

| Id | Observation |
|---|---|
| OBS-B8-1 | **Nothing compares the painted page.** The 109 stored renderings are markup and stylesheet text, compared in CI (`design.test.tsx`, 114 tests, ran at the pin). `faces-visual` writes pictures for a person and is skipped unless `FACES_VISUAL=1`; it was never a pixel comparison. Section 1 lists what passes unseen. A pull request that changes a look and re-records with `vitest -u` is green; the diff review is the only guard. |
| OBS-B8-2 | **Retries make a first-attempt failure invisible in the check.** On 10-31 between 06:26 and 11:43 UTC, 66 to 75 of the 76 `faces-design.spec.ts` variants failed their first attempt in 11 runs; four of those runs were green (74 flaky, "success"). The cause was a real measurement race (fixed by #280) but the check said green. `payment-tables.spec.ts:201` was flaky in 28 runs the same way. Whether "flaky" is ever read is not something CI enforces. |
| OBS-B8-3 | **A serial spec retried reruns the whole file.** `design.spec.ts` is `mode: 'serial'` (:34): one failure skips the rest ("3 did not run") and each retry replays all earlier tests, so a single slow step costs up to three runs of a 21-test file; this contributes to the CI time. |
| OBS-B8-4 | **The venue's look reaching the real Stripe form is proven only in the sandbox spec.** `appearance.ts` and `card-form.ts` are unit-tested against a fake Stripe, and `guest-menu.tsx:325` to `use-table-services.ts:112` to the card form is not tested at all (M1). If Stripe ignores or rejects an Appearance variable name, nothing in CI sees it. |
| OBS-B8-5 | **`scheduled` is outside the sweep.** `neverListFixtures()` drops it, so an item with a schedule label is in no stored rendering and not in the never-list; `today/scheduled.html.snap` is an orphan. The label text is checked by `contract.test.tsx` for fixtures it does cover; I did not confirm it covers `scheduled`. |
| OBS-B8-6 | **Two guard assertions lost with the deletions, one ported.** The rail's scroll-follow test was deleted with qr-phone and not rewritten for Editorial (M3). The rest of the deleted guest tests have an Editorial equivalent. |
| OBS-B8-7 | `design.spec.ts:403` waits a fixed 9 seconds to prove a toast "stays until it is read"; it adds time and could pass on a toast that disappears at 10 s. `design.spec.ts` has two more `waitForTimeout` (:72 10 s, :224 1 s). |
| OBS-B8-8 | Migration 0046 (drops `menus.settings`) has no test of its own; 0045's test migrates through 0045 only; 0047 has `design-styles-table.test.ts`. |
| OBS-B8-9 | `packages/faces/editorial-market/src/preview/demo-services.ts:167`: `mineMinor` is declared and never used (Biome `noUnusedVariables`, shown as a warning in the pin's lint step: 42 warnings and 133 infos tolerated). Product code, not mine to fix; one line for the lead. |
| OBS-B8-10 | The pin's Playwright suite is 568 tests, 138 of them skipped (24%); nearly all of the skips are one matrix (`faces-visual`), so "430 passed" is the whole real suite. |

## For the later rerun (read-only half hands over)

1. **Specs to rerun more than once** (flaky list above): `tables.spec.ts` ("an area is renamed and moved ...", still flaky at 21:08 UTC 10-31), `design.spec.ts` (`:468` tap-on-a-part, `:658` My styles, `:497`, `:641`, `:676`), `faces-a11y-services.spec.ts:173`, `guest-send.spec.ts:105`, `guest-pay-first.spec.ts:261`, `faces-design.spec.ts` (all variants, once, after #280).
2. **Skipped tests worth running by hand once:** `sold-out.spec.ts` "the mark lapses with the service day" between 07:00 and 23:00 Sofia time; `faces-visual.spec.ts` with `FACES_VISUAL=1 FACES_VISUAL_FACE=editorial-market` for a person to look at the five Styles. `guest-pay-card.spec.ts` needs the Stripe sandbox, which Martin has not cleared for this audit.
3. **Mutation runner:** M1 to M4 first (section 4).
4. **Out of scope, one line each:** `demo-services.ts:167` unused `mineMinor` (OBS-B8-9); `sold-out.spec.ts:417` uses `new Date()` with no clock control, which is why it depends on the hour.

## What I could not cover

- I did not run anything, so every "would go red" is by reading; the mutation candidates are untested guesses (confidence high for M1 to M3, lower for M4 to M8).
- I read about 24 test files, some only by title and head (`renderer-rules`, `screen-options`, `design-migration`, `advanced`, `my-styles`, `frame-stage`, `look-state`, `preview-snapshot` by test titles). I did not read `bag.test.tsx`, `staged-options.test.tsx`, `design-parts.test.tsx`, `guest-order.spec.ts`, `guest-pay-first.spec.ts` or `faces-a11y*.spec.ts` in full; I judged `guest-pay-first` by its history (it failed three times for real, which shows it bites).
- I did not verify that Vitest's CI mode refuses to write a missing `toMatchFileSnapshot` file (read from its documented behaviour only).
- Whether Stripe's Appearance API accepts every variable name `appearance.ts` sets (for example `buttonExpressCheckoutBorderRadius`) is unchecked; it needs the docs or the sandbox.
- The 136-skip runs (three `st/07-studio-simple` pull-request runs) differ from 137 by one test; I assume a branch difference, not a second wall-clock skip. I did not diff those branches.
- Run logs before 10-30 10:00 and the `or/` runs were not read; "flaky since 10-30" covers `st/` runs only.
