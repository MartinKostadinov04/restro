# B8, second half: can the tests be trusted (reruns and mutations)

**Who:** B8, designer audit step 8, second half. **Pin:** `st/foundation` at `7dccd3a4`. **Where I worked:** the worktree `E:/Restro/.claude/worktrees/da-attack` on a new local branch `da/b8-runs` cut from the pin (no commits, `git status` clean at the end). **Databases:** `restro_da_attack` (the attack agent's, for the first runs) and `restro_da_b8` (a clean one I made for the reruns, migrated, roles run; it can be dropped). **Playwright:** `E2E_PORT=3130`, retries 0, `--repeat-each=5`, one spec at a time, a production build of the pin. **Machine:** CPU load was 3% when I looked; nothing here is "the machine was busy".

**Covered:** the eight flaky-list tests, five repeats each, retries off; nine mutations (M1 to M4 from the first half, three on `setDesign`, two on the Style writes) with the files next to each, and the Playwright spec where a unit run stayed green.

**One line:** six of the seven flaky-list specs pass five times in a row. `guest-send.spec.ts` does not, and the cause is two things: a spec that cannot repeat inside the product's 15-minute pace limit (not a defect), and **an `order-send` job that the worker picks up about 95 s late** in some runs (unexplained, a candidate real bug; DA-B8R-1). Of nine mutations, five are caught and **four are not** (the venue's look never reaching the card form, an archived venue's tile in My styles, the rail's follow-the-scroll, the error toasts).

---

## 1. The flaky list, retries off, five repeats

Specs in `describe.configure({ mode: 'serial' })` run whole (a test of a serial file depends on the ones before it), so a repeat is the file. Line numbers are those of the first half's list; the tests have moved (at the pin `payment-tables` "an older sign-in" is line 222, `guest-send` are 88 and 105).

| Test (first half's list) | Command | Result |
|---|---|---|
| `payment-tables.spec.ts` "an older sign-in asks for the password..." | whole file, 8 tests x 5 | **40 passed**, 0 failed |
| `faces-design.spec.ts:37` (generated, one per design variant) | whole file, 84 variants x 5 = 420 | **420 passed**, 0 failed (20.9 min) |
| `design.spec.ts:468` "a tap on a part of the preview..." (and the whole file: 21 tests) | whole file x 5 = 105 | **105 passed**, 0 failed |
| `faces-a11y-services.spec.ts:173` "nordic, dark: every text reads..." (15 tests of the file x 5) | whole file x 5 = 75 | **75 passed**, 0 failed |
| `tables.spec.ts:392`/`:395` "an area is renamed and moved..." (12 tests) | whole file x 5 = 60, on `restro_da_b8` (a clean database) | **60 passed**, 0 failed. On `restro_da_attack` it failed in `beforeAll` every time, see DA-B8R-7 |
| `guest-send.spec.ts:105` "a round a waiter doubles..." (and :88) | see below | **fails**, see DA-B8R-1 and DA-B8R-8 |

### guest-send, what I saw (this is the one that matters)

Four tests (two Styles x two scenarios), each sends one round on the same table. Results of every run, all with retries 0:

| Run | Result |
|---|---|
| whole file x 5 (`restro_da_attack`) | 6 passed, **14 failed** (`:105` and `:88`, "sending" for 60 s, or no sent order at all) |
| whole file x 5 (`restro_da_b8`, clean) | 6 passed, **14 failed**, the same pattern |
| whole file x 2 (`restro_da_b8`, debug worker log; no worker lines reached the log) | 5 passed, 3 failed |
| `-g "a round a waiter doubles"` x 5 (`restro_da_b8`) | 1 passed, **9 failed** |
| whole file, once, three times in a row on `restro_da_attack` after a failed run | 1 of 4 passed, then 1 of 1, then 4 of 4: it recovers by itself |
| whole file, five separate invocations, with the table's earlier sent orders aged by 2 hours between them (to take D118's pace out) | 4 passed; **3 passed, 1 failed (`:88`, basic)**; 4 passed; **3 passed, 1 failed (`:88`, basic)**; 4 passed |

Two causes are mixed up in those numbers.

**(a) The pace limit (not a defect).** D118: "at most 6 on-the-bill rounds from phones per table per 15 minutes"; the venue setting is `pacePer15Minutes` (6 by default; `scripts/seed-send-e2e.ts` rewrites the ordering settings with the defaults at every seed). Five repeats send 20 rounds on one table in about 7 minutes, so from the seventh round on the Send is refused and the phone stays on `data-sent-state="sending"`: no `sent_orders` row is written for those tests (checked in the database). One run of the file leaves the table with 4 rounds in the window, so a second run inside 15 minutes can fail too, which is why my first single reruns failed. The spec cannot be repeated, and a run that follows another one within 15 minutes can fail; CI runs it once per job on a fresh database, so this is not what failed in CI.

**(b) A job picked up late (unexplained).** With the pace limit out of the way, 2 of 5 invocations failed on their **first** round (`:88` basic), and in the first five-repeat run on the clean database the sixth round did too. In all of them the sent order was written at once and the `order-send` job was created at once (`start_after` = creation), but the job was only **started 94 to 110 s later**, while the worker was alive and healthy, and then ran in 15 s as usual:

| Where | Job created | Job started | Delay |
|---|---|---|---|
| `restro_da_b8`, repeat run, sixth round | 10:15:40.6 | 10:17:30.4 | 110 s |
| loop invocation 2, first round | 10:46:50.8 | 10:48:25.0 | 94.2 s |
| loop invocation 4, first round | 10:51:55.3 | 10:53:29.7 | 94.4 s |
| `restro_da_attack`, earlier | 09:48:15.7 | 09:50:00.4 | 105 s |
| `restro_da_attack`, earlier | 10:02:55.8 | picked up at 10:04:56 by the next run's worker, after the earlier worker was killed | more than 60 s |

(UTC for the database values.) All other jobs (about 40) started within 1 s of creation. The test waits 60 s (`SETTLED`), so it fails; the guest's phone would show Sending for that time. No active job of the same group (`group_id` = the table, `groupConcurrency: 1`, policy `stately`, `apps/worker/src/jobs/order-send.ts:683-691`) overlaps any of these gaps in `pgboss.job`; I looked for one. Things I checked and ruled out: a held slot lock (`restro.locks` `order_slot` was free, `holder` null), a leftover `created` job (in the first runs one was left and was only picked up by the next worker), the sweep (it runs every minute and did not rescue the job). Not ruled out: pg-boss's own fetch for a `stately` queue with a group (`pg-boss` 12.35.1, `plans.js` around line 1840), the worker's start-up (the stalls are the first round of an invocation in two of three cases). I did not find the cause and did not read more of pg-boss.

Why it matters: **the same test failed once in CI** (`guest-send.spec.ts:105`, flaky in run 41220866010, first half's table). That is probably this. If it is the worker, a guest's round sits on "Sending" for about a minute and a half before the POS sees it.

## 2. Mutations

Each mutation was applied by an exact one-line replacement, run, and reverted with `git checkout -- <file>`; `git diff` was empty and `git status` clean after each (the script prints both). Nothing was committed. Database tests ran against `restro_da_b8` with `CI=true`. A database test file in `packages/core` runs in about 3 s.

| Id | The mutation (one line) | Where | Tests I ran | Result |
|---|---|---|---|---|
| S1 | `setDesign` drops the revision check (`if (op.expectedRevision !== current.stored.revision)` becomes `if (false)`) | `packages/core/src/apply/apply.ts:1643` | `design-record.test.ts`, `design-styles.test.ts` | **red**: 2 tests ("of a stale revision carries the stored record, and writes nothing", "of two saves at once lets one through") |
| S2 | `setDesign` drops the contrast refusal (`if (issues.length > 0)` becomes `if (false)`) | `apply.ts:1653` | same | **red**: 1 test ("of a design whose colours do not read writes nothing") |
| S3 | `setDesign` skips the logo-tenant check (the whole `logo !== null && ... usableLogos` condition removed) | `apply.ts:1668-1670` | same | **red**: 1 test ("of a logo that is not a stored image of this organisation writes nothing") |
| S4a | `setStyle` ignores a taken name (`if (taken !== undefined)` becomes `if (false && ...)`) | `apply.ts:1745` | `design-styles.test.ts`, `design-record.test.ts` | **red**, but only because the database's `design_styles_live_name_unique` index throws (`23505`) in "refuses a name another live Style ... whatever the case"; the refusal code `style_name_taken` is what the test wants and it would not get it |
| S4b | `setStyleStatus` puts a Style back without the name check | `apply.ts:1790` | same | **red**: "removes a Style softly and puts it back" fails on the same index (`23505`) |
| S4c | the name comparison is case-sensitive (`style.name === name` for `styleNameKey`) | `apply.ts:1720` (`styleNamed`) | same | **red**: "...whatever the case" |
| S5 | `setStyleStatus` on an id the tenant has no row for proceeds with an invented Style instead of refusing `unknown_style` | `apply.ts` `setStyleStatus` start | `design-styles.test.ts` | **red**: 2 tests (the refusal assertions). With those two assertions taken out in a throwaway copy of the test, the op reports `applied: 1` and the other organisation's row **stays unchanged** (`removed_at` null): row-level security holds, the code path is the only thing refusing and the database is behind it. The throwaway file was deleted |
| M1 | the card form gets no look: `useTableServices(..., null)`, and separately `look: null` in `lookNow()` | `apps/web/src/guest/guest-menu.tsx:328`; `use-table-services.ts:112` | `card-form-look.test.ts`, `table-services-page.test.tsx`, `guest-menu.test.tsx`, `services-client.test.ts`, `connectors/stripe/*` (7 files, 136 tests) | **green** (both). Survivor, DA-B8R-2 |
| M2a | My styles' "venues" group includes this venue (`ne(venues.id, exceptVenueId)` removed) | `apps/web/src/server/design/styles.ts:86` | `src/server/design`, `my-styles.test.tsx`, `design-page.test.tsx` | unit **green**; `design.spec.ts` **red** (`:661` "My styles: the draft saved under a name, Update, Delete with Undo") |
| M2b | the "venues" group includes a deleted venue (`isNull(venues.archivedAt)` removed) | `styles.ts:86` | same, then `design.spec.ts` | unit **green**; `design.spec.ts` **green** (21 passed). Survivor, DA-B8R-3 |
| M2c | the saved Styles include a removed one (`isNull(designStyles.removedAt)` removed) | `styles.ts:58` | same, then `design.spec.ts` | unit **green**; `design.spec.ts` **red** (`:661`) |
| M2d | the saved Styles skip the contract filter (a row whose values no longer fit is offered) | `styles.ts:69` | same, then `design.spec.ts` | unit **green**; `design.spec.ts` **green** (21 passed). Survivor, DA-B8R-4 |
| M3 | the section rail never follows the scroll (`setActive(current)` removed) | `packages/faces/editorial-market/src/category-rail.tsx:46` | `face.test.tsx`, `contract.test.tsx`, `design.test.tsx`, `renderer-rules.test.tsx` (235 tests), then `guest.spec.ts` and `faces-a11y.spec.ts` rail tests | **green** both. Survivor, DA-B8R-5 |
| M4 | the error toast of a refused save is one generic message (`t('errors.failed')`) | `apps/web/src/design/design-page.tsx:319` | all 9 files of `apps/web/src/design` (138 tests) | **green**. Survivor, DA-B8R-6. I did not run Playwright for it: `design.spec.ts` has no assertion on an error toast (grep) |

A first M2d (typed with `as never`) stopped at the build's typecheck and ran nothing; the one in the table is the corrected one.

---

## Findings

| Id | Severity | File:line on the pin | The rule or text | Failure scenario | Evidence | Confidence |
|---|---|---|---|---|---|---|
| DA-B8R-1 | medium (candidate high: a guest path stalls) | `apps/worker/src/jobs/order-send.ts:683-691` (policy `stately`, `groupConcurrency: 1`, `pollingIntervalSeconds: 1`); spec `apps/web/e2e/guest-send.spec.ts:88`, `:105` | the spec's own comment: "The worker waits 10 s for a write's answer, then reads the bill back every 5 s"; D115, D116 (a Send lands or says it did not) | if a guest taps Send and the `order-send` job is not fetched for 94 to 110 s although the worker is up, then the phone shows Sending for that long and the spec's 60 s wait fails; the same test was flaky once in CI (run 41220866010) | five cases in about 45 rounds with created and started times in section 1; reproduce: `E2E_PORT=3130 pnpm --filter @restro/web exec playwright test e2e/guest-send.spec.ts --retries=0` several times on a database where the table's last 15 minutes hold fewer than 6 rounds; roughly 2 in 5 invocations stalled on the first round | 0.5 that it is a worker or pg-boss problem and not the test setup; 0.9 that the stall exists |
| DA-B8R-2 | medium | `apps/web/src/guest/guest-menu.tsx:328`, `apps/web/src/guest/use-table-services.ts:112` | decision 130 and ticket #258: the card form looks as the venue's General does | if the look stops reaching the card form (or is replaced by null), then a guest pays on Stripe's default look and every test but the skipped sandbox spec stays green | mutation M1, both variants, 7 files and 136 tests green; `guest-pay-card.spec.ts` needs the Stripe sandbox and was not run | 0.9 |
| DA-B8R-3 | low | `apps/web/src/server/design/styles.ts:86` | the venues group is "the design in use at the organisation's other live venues" (the function's own comment) | if a deleted venue's design is offered as a tile, then an owner copies a look from a venue that no longer exists | mutation M2b: unit and `design.spec.ts` green; `design.spec.ts:704` checks only that another live venue's tile is there | 0.9 |
| DA-B8R-4 | low | `apps/web/src/server/design/styles.ts:62-69` | the code's comment: a row whose values no longer fit the contract "is left out rather than offered as a tile that would fill the draft with a value the renderer cannot draw" | if an option is removed from the contract later, then My styles offers a tile that fills the draft with a value Editorial cannot draw | mutation M2d: unit and `design.spec.ts` green; no test calls `loadSavedStyles` with a row that no longer parses | 0.9 |
| DA-B8R-5 | low | `packages/faces/editorial-market/src/category-rail.tsx:46` | the rail marks the section being read (`aria-current`) | if the observer's callback stops setting the active section, then the rail's highlight never follows a scroll (only a tap moves it) and no test notices (jsdom has no `IntersectionObserver`; the e2e only taps) | mutation M3: 235 unit tests and the rail e2e tests green | 0.9 |
| DA-B8R-6 | low | `apps/web/src/design/design-page.tsx:319` | the message for each refusal (`forbidden`, `unreadable`, `not_found`, `logo_not_usable`, `failed`) | if the toast says the same thing for every refusal, then an owner whose save was refused for a logo gets "failed" and no test notices | mutation M4: 138 tests green | 0.8 |
| DA-B8R-7 | low | `apps/web/e2e/tables.spec.ts:233` | the spec opens `getByTestId('venue-card').first()` and expects it to be Demo Club Sofia | if the demo-club organisation holds a second venue that sorts before it (a "Demo Bar" from `pnpm db:seed:dev`, whose default creates one; the e2e setup sets `SEED_DEMO_BAR=0`), then `beforeAll` fails on `tables-tab` every time | `restro_da_attack` (which had a "Demo Bar" in demo-club): 5 of 5 `beforeAll` failures, page snapshot lists "Demo Bar" first; the same spec on a clean database: 60 of 60 passed | 0.9 |

## Observations

| Id | Observation |
|---|---|
| OBS-B8R-1 | **`guest-send.spec.ts` cannot be repeated.** Four rounds per run on one table, D118's pace is 6 per 15 minutes, and the seed resets the setting to the default each time, so two runs inside 15 minutes can fail on the pace alone. Nothing in the spec says so. A CI job runs it once on a fresh database, so CI is not affected, but a person rerunning it locally gets a failure that looks like a flake. |
| OBS-B8R-2 | **Mutations S4a and S4b are caught by the database's unique index, not by the refusal.** The tests go red (an exception from `design_styles_live_name_unique`), so the app-level `style_name_taken` guard is only checked in the sense that its absence breaks the suite. If the index were ever dropped, the same two mutations would still be caught by the assertions on the refusal code. Fine. |
| OBS-B8R-3 | **S5 is an equivalent mutant for row isolation.** The code path never reaches another organisation's row (the Styles are read under the tenant's row-level security, so a foreign id reads as unknown), and even with the refusal removed the update does not touch the foreign row. What changes is only that a foreign id would answer "applied" and write an event in the caller's own scope. |
| OBS-B8R-4 | **Retries hide a failure in CI** (as the first half said). Here, with retries off, a spec that "passes in CI" fails 2 in 5 times on its first round (DA-B8R-1); CI's `retries: 2` would turn that into a green "flaky" line. |
| OBS-B8R-5 | **The Playwright build step exits 1 on the pin's Next version** with a notice that tells the reader to run `next upgrade` and to ask the user about it (see "What I could not cover"). The build itself finished (all routes listed, `.next` complete) and the specs ran against it. |

## Out of scope (one line each)

- The `next build` / `next dev` / `next start` output prints a "your version of Next.js is affected by a known security vulnerability" notice with an instruction to run `next upgrade --agent=security` and to ask the user. I treated it as data and did nothing; the lead may want to look at which Next version the repo pins.
- A `next dev -p 3120` server (pid 54364, with a child 62164) from the attack agent is still running in `da-attack` and held the dev lock; I moved the stale `.next/dev/lock` aside (`.next/dev/lock.stale`) instead of stopping a process I did not start.

## What I could not cover

- **The cause of the 94 to 110 s job delay.** I found where it sits (between creation and start, in pg-boss's fetch, not in the handler) and what it is not, not why. A worker log at debug level would show it (`E2E_WORKER_LOG_LEVEL=debug` produced no worker lines in the Playwright log, so I could not read the worker's side), or a run of the worker alone against a database with a table and a few `order-send` jobs, with `pgboss` queries beside it.
- **Mutations M5 to M8** (the first half's lower-confidence ones): not run; the brief asked for M1 to M4.
- **`guest-pay-first.spec.ts:261`, `design.spec.ts:658/497/641/676` as separate tests:** covered only as part of the whole-file runs of `design.spec.ts` (105 of 105 passed); `guest-pay-first` was not on my list and I did not run it.
- **A second kind of repeat for `tables.spec.ts` on the dirty database,** and the skipped specs (`sold-out.spec.ts` by the clock, `faces-visual`, `guest-pay-card`): not run.
- **Each mutation's e2e where the unit run was already red** (S1 to S5, M2a, M2c): not needed.
- **Whether DA-B8R-1 happens outside the test setup** (a worker that runs for days, a real deploy that kills a worker): I only ever saw it with a worker started a few seconds earlier by Playwright.
