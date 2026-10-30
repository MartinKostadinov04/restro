# CI retry mining: or/foundation, 2026-10-22 to 2026-10-30 (A2)

List only, no findings. Every row is evidence for A9 (flake runner) and for the lead. Nothing was run locally; every fact comes from GitHub Actions logs read with `gh`.

Coverage: 344 CI runs on `or/foundation` and on PR head branches into `or/foundation` since 2026-10-22 (275 pull_request, 69 push). 245 finished green or red, 96 were cancelled, 3 had no conclusion. **120 logs were read**: all 62 finished `or/foundation` push runs (10-22 to 10-29), the 8 runs that were re-run (attempt 2), and the 50 newest other PR runs (10-29 00:49 UTC to 21:07 UTC). All are one job, "Lint, types, import rules, secrets, tests, build, e2e", so one log holds vitest and Playwright. 109 of the 120 reached Playwright; 10 stopped at vitest and one (cancelled) had no tests.

## 1. Commands

```sh
R=MartinKostadinov04/restro
gh run list -R $R --branch or/foundation --limit 200 --json databaseId,headSha,event,conclusion,createdAt,workflowName,attempt
gh pr list -R $R --state all --base or/foundation --limit 150 --json number,headRefName,mergedAt,headRefOid
gh run list -R $R --workflow CI --limit 1000 --json databaseId,headSha,headBranch,event,conclusion,createdAt,attempt,number
#   keep: headBranch == or/foundation or in the PR head list, createdAt >= 2026-10-22  (344 runs)
gh run view <id> -R $R --log > <id>.log                 # the 120 chosen runs
gh run view <id> -R $R --attempt 1 --log > <id>_a1.log  # re-run commits: what failed before the re-run
# Playwright prints, at the end of the e2e step, "  N flaky" (passed on a retry) and "  N failed" (failed on every try);
# in its failure blocks it prints one "Error Context:" line per failed attempt. Strip ANSI first:
sed 's/\x1b\[[0-9;]*m//g' <id>.log | grep -nE "^\s+[0-9]+ (flaky|failed)|^\s+\[chromium\]|^\s+[0-9]+\) \[chromium\]| FAIL "
```

To top up at the freeze: run the third `gh run list` again, take runs created after 2026-10-29T21:40Z (the newest read here) plus the unread runs of section 4, and apply the same grep. A one-line check per run: `gh run view <id> -R $R --log | grep -aE "^.{0,40}Z +[0-9]+ flaky|^.{0,40}Z +\[chromium\]"`.

How to read the table: Playwright has `retries: 2` on CI (`apps/web/playwright.config.ts:106`). The line reporter does not print which retry passed. The log shows one `Error Context:` line per failed attempt, but the same block can be printed twice, so the count is an upper bound; a test listed here passed on retry #1 or #2 (never on the first try). A9 will see the real number with `--retries=0` repeats. PR numbers are the head branch's latest PR into `or/foundation` (a branch can have had more than one); "push" is a run on `or/foundation` itself.

## 2. Retried-green tests, by recurrence

9 distinct Playwright tests passed on a retry in at least one of the runs read; `tables.spec.ts` lines moved during the window (191 to 194), so the same test can show under two line numbers.

| # | Spec:line | Test | Runs flaky | Branches | Error Context lines in the log (failed attempts, upper bound) | First seen | Last seen | Error on the failed attempt |
|---|---|---|---|---|---|---|---|---|
| 1 | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), shown again and moved | 18 | 9 | 2 | 2026-10-28 | 2026-10-29 | Error: expect(locator).toBeHidden() failed; Error: page.waitForResponse: Target page, context or browser has been  |
| 2 | `e2e/guest-pay-return.spec.ts:33` | the provider values leave the address before anything else is asked for | 8 | 8 | 1 | 2026-10-29 | 2026-10-29 | Error: expect(received).toBe(expected) // Object.is equality |
| 3 | `e2e/payment-tables.spec.ts:201` | an older sign-in asks for the password, then the mark goes through; the banner is gone | 7 | 4 | 1 | 2026-10-29 | 2026-10-29 | Error: expect(locator).toBeVisible() failed |
| 4 | `e2e/tables.spec.ts:194` | lists the barsy areas as sections and their tables as cards, and creates a code for every one | 5 | 1 | 4 | 2026-10-22 | 2026-10-28 | Error: expect(received).toEqual(expected) // deep equality |
| 5 | `e2e/touch-targets.spec.ts:224` | the composer Structure and Design screens: every control has a 44 px hit area on a phone | 3 | 1 | 1, 2 | 2026-10-25 | 2026-10-28 | Error: Design subtab: controls under 44 x 44 px |
| 6 | `e2e/guest.spec.ts:587` | the table code › an unknown code gets a small page in both languages and no venue data | 1 | 1 | 1 | 2026-10-26 | 2026-10-26 | Error: page.screenshot: Protocol error (Page.captureScreenshot): Unabl |
| 7 | `e2e/owner-paying.spec.ts:79` | seeds the venue and finds it ────────────────────── | 1 | 1 | 1 | 2026-10-29 | 2026-10-29 | Error: ./scripts/seed-paying-e2e.ts failed: |
| 8 | `e2e/tables.spec.ts:191` | lists the barsy areas as sections and their tables as cards, and creates a code for every one | 1 | 1 | 4 | 2026-10-22 | 2026-10-22 | Error: expect(received).toEqual(expected) // deep equality |
| 9 | `e2e/venue-lifecycle.spec.ts:167` | the guest page and the table code work before the venue is deleted | 1 | 1 | 2 | 2026-10-29 | 2026-10-29 | Error: expect(received).toContain(expected) // indexOf |

`tables.spec.ts` "an area is renamed and moved; a table is hidden..." (rows 1) also failed on all three tries in 6 `or/foundation` push runs (it sat at line 334/337 before the file grew, at 392 now); see section 3.

Vitest tests that failed and then passed when the same commit was re-run (attempt 2):

| Test | Commit | Run (attempt 1 failed, attempt 2 passed) | Failure text |
|---|---|---|---|
| `apps/worker/tests/payment-route.test.ts` "the payment route > the model > captures only after a close, never releases after one, shares no line and no table, takes what the till shows" (fast-check property) | 5925abb6, PR or/fix-0038-backfill-rls, 2026-10-29 | 40809311758 | `Property failed after 13 tests`, seed 1085069335, counterexample with a `closeBill` that `landsThenHangs` and a provider capture `server_error`: `expected [ 'captured', 'released', ... ] to include 'unconfirmed'` (`invariants`, payment-route.test.ts:1833 then) |
| same test | 270e548b, PR or/pay-guest-form, 2026-10-29 | 40794604929 | `Property failed after 25 tests`, seed -950485348, counterexample: no fault, provider event `expired` before `payAndClose`, `lateLanding` 20000: `expected [ 'captured', 'released', ... ] to include 'closed'` (payment-route.test.ts:1832 then) |
| `apps/worker/tests/alerts.test.ts` "alerts reach people > a pause > is announced once, reminded to owners and the team, and announced as over" | ccd2efac, PR or/pay-receipt-brought-tonight, 2026-10-29 | 40816729855 | `expected [ { device ... }, ... ] to have a length of 1 but got 2` at alerts.test.ts:523 (a second push at the 61-minute pass). The same test also failed in 40815977059 (push c476d676), 40816015475 (PR pay-settings 61a80831) and 40814715223 (PR pay-receipt-brought-tonight 4d917648): see section 3 |

Playwright re-run rows (attempt 1 failed in the e2e step, attempt 2 green, same commit; `<id>_a1.log`):

| Run id | Sha | PR | Spec:line | Test | Ended |
|---|---|---|---|---|---|
| 40697483601 | 93dfa3aa | or/pay-connect-fu | `e2e/touch-targets.spec.ts:224` | the composer Structure and Design screens: every control has a 44 px hit area on a phone | failed attempt 1 (all three tries for :194 and :337), passed on re-run |
| 40655894095 | 7f324f6a | or/pay-recovery | `e2e/tables.spec.ts:194` | lists the barsy areas as sections and their tables as cards, and creates a code for every one | failed attempt 1 (all three tries for :194 and :337), passed on re-run |
| 40655894095 | 7f324f6a | or/pay-recovery | `e2e/tables.spec.ts:337` | an area is renamed and moved; a table is hidden (its file goes), shown again and moved | failed attempt 1 (all three tries for :194 and :337), passed on re-run |
| 40404288604 | 6f7dc4d4 | or/review-fixes | `e2e/tables.spec.ts:194` | lists the barsy areas as sections and their tables as cards, and creates a code for every one | failed attempt 1 (all three tries for :194 and :337), passed on re-run |
| 40404288604 | 6f7dc4d4 | or/review-fixes | `e2e/tables.spec.ts:337` | an area is renamed and moved; ... | failed attempt 1 (all three tries for :194 and :337), passed on re-run |
| 39765578860 | bbc41c43 | or/table-codes | `e2e/tables.spec.ts:194` | lists the barsy areas ... | failed attempt 1 (all three tries for :194 and :337), passed on re-run |
| 39765578860 | bbc41c43 | or/table-codes | `e2e/tables.spec.ts:337` | an area is renamed and moved; ... | failed attempt 1 (all three tries for :194 and :337), passed on re-run |

### Every occurrence of a retried-green Playwright test, run by run

| Run id | Date (UTC) | Sha | PR (branch) | Spec:line | Test | Ended |
|---|---|---|---|---|---|---|
| 40959770064 | 2026-10-29 21:40 | 45225f8a | push (or/foundation) | `e2e/payment-tables.spec.ts:201` | an older sign-in asks for the password, then the mark goes through; t… | passed on a retry (1 Error Context line) |
| 40959770064 | 2026-10-29 21:40 | 45225f8a | push (or/foundation) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40955020532 | 2026-10-29 21:07 | a17166c5 | #232 (or/pay-legal-details) | `e2e/payment-tables.spec.ts:201` | an older sign-in asks for the password, then the mark goes through; t… | passed on a retry (1 Error Context line) |
| 40927139660 | 2026-10-29 18:03 | 557a5dc9 | #232 (or/pay-legal-details) | `e2e/payment-tables.spec.ts:201` | an older sign-in asks for the password, then the mark goes through; t… | passed on a retry (1 Error Context line); run red for another test |
| 40927139660 | 2026-10-29 18:03 | 557a5dc9 | #232 (or/pay-legal-details) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines); run red for another test |
| 40926783200 | 2026-10-29 18:00 | a5e9616c | push (or/foundation) | `e2e/payment-tables.spec.ts:201` | an older sign-in asks for the password, then the mark goes through; t… | passed on a retry (1 Error Context line) |
| 40922202794 | 2026-10-29 17:31 | cbc09f57 | #231 (or/pay-refunds-disputes) | `e2e/payment-tables.spec.ts:201` | an older sign-in asks for the password, then the mark goes through; t… | passed on a retry (1 Error Context line) |
| 40922202794 | 2026-10-29 17:31 | cbc09f57 | #231 (or/pay-refunds-disputes) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40915792722 | 2026-10-29 16:52 | f54ac852 | push (or/foundation) | `e2e/payment-tables.spec.ts:201` | an older sign-in asks for the password, then the mark goes through; t… | passed on a retry (1 Error Context line) |
| 40909236856 | 2026-10-29 16:12 | 442aac83 | #229 (or/pay-first-items) | `e2e/payment-tables.spec.ts:201` | an older sign-in asks for the password, then the mark goes through; t… | passed on a retry (1 Error Context line) |
| 40909236856 | 2026-10-29 16:12 | 442aac83 | #229 (or/pay-first-items) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40896115918 | 2026-10-29 14:54 | 4973421a | #229 (or/pay-first-items) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines); run red for another test |
| 40878629364 | 2026-10-29 13:04 | 307172b0 | #228 (or/pay-first-tables) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40876795103 | 2026-10-29 12:51 | 810f3aa4 | push (or/foundation) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40874979020 | 2026-10-29 12:38 | 41e75762 | #228 (or/pay-first-tables) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40864776580 | 2026-10-29 11:21 | c62321d8 | push (or/foundation) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40860809589 | 2026-10-29 10:51 | 64d92e88 | #224 (or/pay-e-receipt-email) | `e2e/guest-pay-return.spec.ts:33` | the provider values leave the address before anything else is asked f… | passed on a retry (1 Error Context line) |
| 40860568374 | 2026-10-29 10:49 | bbb4d07b | push (or/foundation) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40858015219 | 2026-10-29 10:29 | ba89458d | #226 (or/pay-first-settings) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines); run red for another test |
| 40822933759 | 2026-10-29 05:21 | 3d71dbf3 | push (or/foundation) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40820674466 | 2026-10-29 04:58 | d297c2f5 | push (or/foundation) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40816729855 | 2026-10-29 04:15 | ccd2efac | #213 (or/pay-receipt-brought-tonight) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40816522433 | 2026-10-29 04:13 | 387c87fb | #214 (or/fix-alerts-test-clock) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40813691595 | 2026-10-29 03:42 | bf4b6c1e | #211 (or/fix-0038-backfill-rls) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40808931199 | 2026-10-29 02:52 | c305d9b6 | #209 (or/pay-paid-lines) | `e2e/guest-pay-return.spec.ts:33` | the provider values leave the address before anything else is asked f… | passed on a retry (1 Error Context line) |
| 40808781620 | 2026-10-29 02:51 | 3bc69b8e | push (or/foundation) | `e2e/guest-pay-return.spec.ts:33` | the provider values leave the address before anything else is asked f… | passed on a retry (1 Error Context line) |
| 40807186554 | 2026-10-29 02:34 | 27588187 | #211 (or/fix-0038-backfill-rls) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40805887599 | 2026-10-29 02:21 | 90c836ae | #205 (or/pay-e-receipt) | `e2e/venue-lifecycle.spec.ts:167` | the guest page and the table code work before the venue is deleted | passed on a retry (2 Error Context lines) |
| 40805703591 | 2026-10-29 02:19 | 31858c63 | #210 (or/pay-tonight) | `e2e/guest-pay-return.spec.ts:33` | the provider values leave the address before anything else is asked f… | passed on a retry (1 Error Context line); run red for another test |
| 40802305809 | 2026-10-29 01:45 | b52dc27e | #206 (or/pay-sandbox-checks) | `e2e/guest-pay-return.spec.ts:33` | the provider values leave the address before anything else is asked f… | passed on a retry (1 Error Context line) |
| 40800420705 | 2026-10-29 01:26 | 469818a4 | #205 (or/pay-e-receipt) | `e2e/guest-pay-return.spec.ts:33` | the provider values leave the address before anything else is asked f… | passed on a retry (1 Error Context line) |
| 40799473480 | 2026-10-29 01:17 | de6ab167 | #208 (or/pay-receipt-brought) | `e2e/guest-pay-return.spec.ts:33` | the provider values leave the address before anything else is asked f… | passed on a retry (1 Error Context line) |
| 40797782237 | 2026-10-29 01:01 | b46cd02c | #207 (or/pay-settings) | `e2e/owner-paying.spec.ts:79` | seeds the venue and finds it ────────────────────── | passed on a retry (1 Error Context line); run red for another test |
| 40794604929 | 2026-10-29 00:31 | 270e548b | #195 (or/pay-guest-form) | `e2e/guest-pay-return.spec.ts:33` | the provider values leave the address before anything else is asked f… | passed on a retry (1 Error Context line) |
| 40787231757 | 2026-10-28 23:25 | 76833e4f | push (or/foundation) | `e2e/tables.spec.ts:392` | an area is renamed and moved; a table is hidden (its file goes), show… | passed on a retry (2 Error Context lines) |
| 40723742700 | 2026-10-28 16:12 | 3393c7d7 | push (or/foundation) | `e2e/tables.spec.ts:194` | lists the barsy areas as sections and their tables as cards, and crea… | passed on a retry (4 Error Context lines); run red for another test |
| 40706088118 | 2026-10-28 14:27 | ae2034db | push (or/foundation) | `e2e/touch-targets.spec.ts:224` | the composer Structure and Design screens: every control has a 44 px … | passed on a retry (2 Error Context lines) |
| 40498044478 | 2026-10-27 11:41 | efe41c9c | push (or/foundation) | `e2e/touch-targets.spec.ts:224` | the composer Structure and Design screens: every control has a 44 px … | passed on a retry (1 Error Context line) |
| 40410191879 | 2026-10-26 22:09 | d37888bd | push (or/foundation) | `e2e/tables.spec.ts:194` | lists the barsy areas as sections and their tables as cards, and crea… | passed on a retry (4 Error Context lines); run red for another test |
| 40378740437 | 2026-10-26 18:33 | e71514a0 | push (or/foundation) | `e2e/tables.spec.ts:194` | lists the barsy areas as sections and their tables as cards, and crea… | passed on a retry (4 Error Context lines); run red for another test |
| 40358286310 | 2026-10-26 16:21 | e5d81538 | push (or/foundation) | `e2e/guest.spec.ts:587` | the table code › an unknown code gets a small page in both languages … | passed on a retry (1 Error Context line) |
| 40334942331 | 2026-10-26 13:55 | c18675b6 | push (or/foundation) | `e2e/tables.spec.ts:194` | lists the barsy areas as sections and their tables as cards, and crea… | passed on a retry (4 Error Context lines); run red for another test |
| 40195543574 | 2026-10-25 12:59 | 2671621a | push (or/foundation) | `e2e/touch-targets.spec.ts:224` | the composer Structure and Design screens: every control has a 44 px … | passed on a retry (1 Error Context line) |
| 39778846340 | 2026-10-22 12:30 | 36fa8fc0 | push (or/foundation) | `e2e/tables.spec.ts:194` | lists the barsy areas as sections and their tables as cards, and crea… | passed on a retry (4 Error Context lines); run red for another test |
| 39746738740 | 2026-10-22 08:18 | 3256266b | push (or/foundation) | `e2e/tables.spec.ts:191` | lists the barsy areas as sections and their tables as cards, and crea… | passed on a retry (4 Error Context lines); run red for another test |

## 3. Failed outright, then green on a later commit (context)

One row per run. "Later green" is the first later green run on the same branch in the run list (not every one was read).

| Run id | Date | Sha | PR (branch) | What failed (error) | Later green run on the branch |
|---|---|---|---|---|---|
| 40953490630 | 2026-10-29 20:56 | 664ccb1d | #232 (or/pay-legal-details) | vitest packages/faces/qr-phone  src/face.test.tsx > the stylesheet > holds no colour of its own (R13): only variables and CSS system colo | 40955020532 (a17166c5, 2026-10-29) |
| 40927139660 | 2026-10-29 18:03 | 557a5dc9 | #232 (or/pay-legal-details) | `e2e/faces-a11y-services.spec.ts:63` the touch targets › every button and radio of the header, t… (Error: expect(received).toEqual(expected) // deep equality) | 40955020532 (a17166c5, 2026-10-29) |
| 40921468512 | 2026-10-29 17:27 | 8570a79a | #232 (or/pay-legal-details) | vitest apps/worker  tests/payment-connection.test.ts > connecting a venue’s payment account (simulated provider) > turns card payments on; vitest packages/core  src/write-targets.test.ts > the write-target guard > core/apply imports no service table from the db package | 40955020532 (a17166c5, 2026-10-29) |
| 40919747418 | 2026-10-29 17:16 | ae7c4d49 | #232 (or/pay-legal-details) | vitest apps/worker  tests/payment-connection.test.ts > connecting a venue’s payment account (simulated provider) > turns card payments on | 40955020532 (a17166c5, 2026-10-29) |
| 40896115918 | 2026-10-29 14:54 | 4973421a | #229 (or/pay-first-items) | `e2e/pay-first-items.spec.ts:130` PF6 and PF7: one item paid first, and back to the venue, in… (Error: expect(locator).toBeChecked() failed) | 40909236856 (442aac83, 2026-10-29) |
| 40866178558 | 2026-10-29 11:32 | d1d1e019 | #227 (or/night-staff-amounts) | `e2e/tonight-pay.spec.ts:117` a waiter's own phone sees the questions and who answers the… (Error: expect(locator).toContainText(expected) failed); `e2e/tonight-receipt.spec.ts:104` a captured payment shows "Bring the receipt" with the numbe… (Error: expect(locator).toContainText(expected) failed) | 40872441352 (2ebd0fa4, 2026-10-29) |
| 40861862048 | 2026-10-29 10:59 | b5853382 | #226 (or/pay-first-settings) | `e2e/owner-paying.spec.ts:213` pay first: hidden while card payments are off, 2 taps with … (Error: expect(locator).toBeChecked() failed) | 40866312033 (c354d1c0, 2026-10-29) |
| 40858252494 | 2026-10-29 10:31 | a761558d | #224 (or/pay-e-receipt-email) | vitest packages/core  src/service/paid-lines.test.ts > paid lines are what the POS closed (as the restro_app role) > does not show an on- | 40860809589 (64d92e88, 2026-10-29) |
| 40858015219 | 2026-10-29 10:29 | ba89458d | #226 (or/pay-first-settings) | `e2e/owner-paying.spec.ts:213` pay first: hidden while card payments are off, 2 taps with … (Error: locator.check: Clicking the checkbox did not change i) | 40866312033 (c354d1c0, 2026-10-29) |
| 40856384554 | 2026-10-29 10:17 | 9dab2fda | #224 (or/pay-e-receipt-email) | vitest apps/worker  tests/sync-queue.test.ts > buildJobs > without the sealing keys it registers the heartbeat and the publish jobs, and  | 40860809589 (64d92e88, 2026-10-29) |
| 40816015475 | 2026-10-29 04:08 | 61a80831 | #207 (or/pay-settings) | vitest apps/worker  tests/alerts.test.ts > alerts reach people > a pause > is announced once, reminded to owners and the team, and announ | 40820689293 (4b0afe27, 2026-10-29) |
| 40815977059 | 2026-10-29 04:07 | c476d676 | push (or/foundation) | vitest apps/worker  tests/alerts.test.ts > alerts reach people > a pause > is announced once, reminded to owners and the team, and announ | 40820674466 (d297c2f5, 2026-10-29) |
| 40814715223 | 2026-10-29 03:54 | 4d917648 | #213 (or/pay-receipt-brought-tonight) | vitest apps/worker  tests/alerts.test.ts > alerts reach people > a pause > is announced once, reminded to owners and the team, and announ; vitest apps/worker  tests/alerts.test.ts > alerts reach people > in Bulgarian, for a venue whose default language is bg_BG > words a paus | 40816729855 (ccd2efac, 2026-10-29) |
| 40805703591 | 2026-10-29 02:19 | 31858c63 | #210 (or/pay-tonight) | `e2e/tonight-pay.spec.ts:233` the end of the night lists the payment to fix and answers i… (Error: expect(locator).toHaveCount(expected) failed) | 40808284155 (24f36bc2, 2026-10-29) |
| 40803194013 | 2026-10-29 01:54 | 352ecdb3 | #210 (or/pay-tonight) | `e2e/tonight-pay.spec.ts:138` on the tablet a manager's PIN answers: receipt printed / no… (Error: locator.click: Error: strict mode violation: getByTes) | 40808284155 (24f36bc2, 2026-10-29) |
| 40800440129 | 2026-10-29 01:26 | 3eb2dd55 | #210 (or/pay-tonight) | `e2e/tonight-pay.spec.ts:138` on the tablet a manager's PIN answers: receipt printed / no… (Error: expect(locator).toContainText(expected) failed) | 40808284155 (24f36bc2, 2026-10-29) |
| 40798040991 | 2026-10-29 01:03 | b9631d6d | #208 (or/pay-receipt-brought) | vitest apps/worker  tests/pay-first.test.ts > pay-first items on the payment route > a POS total above the hold: unconfirmed for a manage; vitest apps/worker  tests/pay-first.test.ts > pay-first items on the payment route > a timeout after the round may be on the POS: capture | 40799473480 (de6ab167, 2026-10-29) |
| 40797782237 | 2026-10-29 01:01 | b46cd02c | #207 (or/pay-settings) | `e2e/owner-paying.spec.ts:93` connect leaves for the provider’s form, and coming back say… (Error: expect(locator).toBeVisible() failed) | 40800826588 (31c1e88c, 2026-10-29) |
| 40796585258 | 2026-10-29 00:49 | e18dfacb | #210 (or/pay-tonight) | `e2e/tonight-more.spec.ts:404` the end of the night › puts what to fix first, then the sen… (Error: expect(received).toEqual(expected) // deep equality); `e2e/tonight-pay.spec.ts:117` a waiter's own phone sees the questions and who answers the… (Error: expect(locator).toContainText(expected) failed) | 40808284155 (24f36bc2, 2026-10-29) |
| 40723742700 | 2026-10-28 16:12 | 3393c7d7 | push (or/foundation) | `e2e/tables.spec.ts:337` an area is renamed and moved; a table is hidden (its file g… (Error: page.waitForResponse: Target page, context or browser) | 40782951942 (78064664, 2026-10-28) |
| 40410191879 | 2026-10-26 22:09 | d37888bd | push (or/foundation) | `e2e/tables.spec.ts:337` an area is renamed and moved; a table is hidden (its file g… (Error: page.waitForResponse: Target page, context or browser) | 40420123970 (c6d5c597, 2026-10-26) |
| 40378740437 | 2026-10-26 18:33 | e71514a0 | push (or/foundation) | `e2e/tables.spec.ts:337` an area is renamed and moved; a table is hidden (its file g… (Error: page.waitForResponse: Target page, context or browser) | 40391937706 (ccf8706a, 2026-10-26) |
| 40334942331 | 2026-10-26 13:55 | c18675b6 | push (or/foundation) | `e2e/tables.spec.ts:337` an area is renamed and moved; a table is hidden (its file g… (Error: page.waitForResponse: Target page, context or browser) | 40339656016 (7bd98e14, 2026-10-26) |
| 40179883577 | 2026-10-25 09:15 | 9f53134b | push (or/foundation) | vitest apps/web  src/server/publish/load.test.ts > the Publish tab (as the restro_app role) > a held publish (V11) > goes out of date whe; vitest apps/web  src/server/publish/load.test.ts > the Publish tab (as the restro_app role) > a held publish (V11) > shows what it would  | 40184948752 (137e2152, 2026-10-25) |
| 39778846340 | 2026-10-22 12:30 | 36fa8fc0 | push (or/foundation) | `e2e/tables.spec.ts:337` an area is renamed and moved; a table is hidden (its file g… (Error: page.waitForResponse: Target page, context or browser) | 39809536238 (c7c6d638, 2026-10-22) |
| 39746738740 | 2026-10-22 08:18 | 3256266b | push (or/foundation) | `e2e/tables.spec.ts:334` an area is renamed and moved; a table is hidden (its file g… (Error: page.waitForResponse: Target page, context or browser) | 39751133436 (45711716, 2026-10-22) |

Note: 6 of the 8 `or/foundation` push failures (39746738740, 39778846340, 40334942331, 40378740437, 40410191879, 40723742700) are one test, `tables.spec.ts` "an area is renamed and moved; ...", failing on all three tries with `page.waitForResponse: Target page, context or browser has been closed` (the test ran out of its time). Pushes after them are green only where it passed on a retry: it was not fixed.

## 4. Runs not read, and why

- 126 finished PR runs, mostly 2026-10-22 to 2026-10-29 00:49 UTC: not read, to stay within the ~120-log bound. Their commits are mostly the ones whose later push runs were read. Re-run `gh run list` for the CI workflow, drop the 120 read, read the rest.
- 96 cancelled runs and 3 with no conclusion: no test output (a newer push cancelled them). One cancelled re-run (40697411982) was read and has none.
- 10 of the 120 read runs stopped at vitest and never ran Playwright, so they say nothing about e2e flakes.
- Attempt-1 logs were read only for the 7 finished re-run commits; `gh run list` shows the latest attempt only, so earlier attempts of other commits are invisible without `gh api repos/$R/actions/runs/<id>/attempts/1`.
- All 120 logs were readable; no `gh` permission or expiry problem.
- Observation: 135 to 136 of 431 Playwright tests are skipped on every CI run (env-gated: `SCREENSHOT_DIR`, `FACES_VISUAL=1`, and others in `composer`, `faces-a11y-services`, `guest-pay-card`, `integration`, `sold-out`, `tags`). They were not seen green in this window.

## 5. Candidate rows

| id | severity | file:line | failure text | scenario | evidence | confidence |
|---|---|---|---|---|---|---|
| RR-A2-1 | high | apps/worker/tests/payment-route.test.ts (the model property; `invariants`, around line 1936 on or/foundation) | `Property failed after 13 tests ... closeBill landsThenHangs ... capture server_error`, then `expected [ 'captured', 'released', ...(2) ] to include 'unconfirmed'`; second run: `... to include 'closed'` | The payment-route property test found counterexamples in two PRs on the same day. Each repeats from its seed (1085069335, -950485348), so it is not noise: a close that lands on the POS but hangs, followed by a failing provider capture, or a hold that expires before the close, ends in a state the invariant forbids. It passed on re-run only because fast-check draws a new seed. Either the route has a state hole in the money path, or the model's invariant is wrong; that needs A9's seeded run. | runs 40809311758 and 40794604929 (`gh run view <id> --attempt 1 --log`) | medium |
| RR-A2-2 | medium | apps/web/e2e/guest-pay-return.spec.ts:49 (production side: apps/web/src/guest/guest-menu.tsx:128, `cleanAddressBar` inside a mount `useEffect`) | `Expected: "?lang=en"  Received: "?lang=en&payment_intent=pi_return_test&payment_intent_client_secret=pi_return_test_secret_x&redirect_status=succeeded"` | Fails on the first try in 8 runs on 8 branches and passes on retry #1. The page strips the provider's `payment_intent_client_secret` from the address only in a post-hydration effect, while the spec reads `page.url()` as soon as the face is visible. In that window the client secret sits in the address bar and history entry, and any same-origin request made before the effect carries it in the Referer. D127's "cleaned before any request" is not strictly held. | e.g. 40808781620 (2026-10-29); the 8 runs are in the occurrence table | low-medium |
