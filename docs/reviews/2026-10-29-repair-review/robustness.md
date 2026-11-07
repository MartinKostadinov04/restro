# Robustness run (A5): repair-review of `or/foundation`

Pin `700bd081`, worktree `E:\Restro\.claude\worktrees\rr-a5`, branch `or/rr-loops` at `dc00bf90`.

## 1. Database and commands

- Own database `restro_rr_a5` on the local Postgres at 54329, migrated at the pin. Nothing remote, no staging, no live POS, no Stripe live mode.
- Each loop: `pnpm vitest run --project <package dir> <path> -t "<name>" --reporter=dot`.
- Mutations: applied to production files, run, restored (`git status` showed only tests before each commit). Runner baselines each test set and counts only new failures.
- Not run: full `pnpm test`, `pnpm build`, Playwright.
- `pnpm lint` 0 errors, `pnpm typecheck` passes, `pnpm deps:check` no violations.
- Touched test files at `dc00bf90`: 18 red (all listed in section 3), every other test green. Web and stripe green.

## 2. Hot spots, in the brief's order

| # | Hot spot | Invariant | Loop | Mutation | Verdict |
|---|---|---|---|---|---|
| 1 | RR-4 | A payment captures only after a close | `payment-route.test.ts` "captures only after a close", seeds -950485348 and 1085069335 as examples | gone branch disabled: red as in CI | **Not reproduced at the pin.** Same hole, closed by c41f412c and 8f9a9053. flakes.md's "no fault" for -950485348 is wrong: it is `provider capture server_error` + `expired` before payAndClose |
| 2 | RR-11 / hot spot 8 | A bill with a discount line is checked or released, never left `isolated` | `pay-route.test.ts` "discount line" property; `payment-route.test.ts` "a discount line on the isolated bill" | none needed; a temporary `sumSignedMinor` fix turned it green | **Red: finding A5-2** |
| 3 | RR-37 / M5 | The tip reaches the close and the capture | `payment-route.test.ts` "signed POS amounts and tips" | `tipMinor: 0` at `payments.ts:1524`: red. `:1432` tip left out of `found`: survives, one extra read, no money effect | **Kept green** |
| 4a | Hot spot 5 | A close is sent once; capture only on proof; nothing released after an attempted close | `payment-route.test.ts` "after the close landed, with only attempting recorded" | close re-sent: red | **Kept green** |
| 4b | Hot spot 3 | A hold is asked for once; one with no state is found and released | existing `payments.test.ts` "the hold, after %s %s" | `payment.hold_unknown` branch removed: red | **Covered**, no new test |
| 5 | RR-1 / hot spot 10 | Active refund rows add up to the provider's total | `payment-refunds.test.ts` "active refund rows" | none | **Red: finding A5-10** |
| 6 | RR-14 | A line in an unfinished payment can not be paid again | `payment-route.test.ts` "an unconfirmed payment's lines" (2) | none | **Red: finding A5-1** |
| 7 | RR-12 / hot spot 4 | Only the payment's own bill is ever moved back | `payment-route.test.ts` "a waiter's bill on the payment table" | none | **Red: finding A5-5** |
| 8a | Hot spot 1 | A bag's lines go exactly once | `send.test.ts` "sends the lines of one bag exactly once" | `.for('update')` removed in `#lockOrderOf`: red | **Kept green** |
| 8b | Hot spot 2 | A round is added at most once; a landed add is matched or settled, never re-sent | `order-send.test.ts` "a worker killed around the add" (3) | `sent_order.expire` treating `sending` as waiting: red; moving to `not_sent`: red | **Kept green** |
| 8c | RR-24 | Certainly-not-in-the-POS is Not sent | `order-send.test.ts` "a read inside the add" | none | **Red: finding A5-9** |
| 9 | RR-16 / hot spot 6 | A send during a run queues, never dropped, never beside it | `apps/worker/tests/payment-queue.test.ts` (real `startWorker` and job options) | policy `exclusive`: red | **Not reproduced: kept green.** stately keeps one waiting and one active per key |
| 9b | Found there | One table's long run does not stop another's | same file, "long run does not hold up" (2) | none | **Red: finding A5-4** |
| 10 | Hot spot 7 + DST | The night holds across clock changes; a hold keeps the table until it ends, then it closes | `service-hours.test.ts` walks; `closing-hour.test.ts` | `nextDay = 0`: red; `keepPaying: false`: red. `settled !== offset` survives my walk (existing named tests may hold it; not checked) | **Kept green, three reds: A5-12, A5-14, A5-15** |
| 11a | RR-29 | A failed reading pauses that table until its next good one | `send-guards.test.ts` "a failed reading pauses" | none | **Red: finding A5-6** |
| 11b | RR-27 | New guests on a still-open bill are not asked for a first item | `send-guards.test.ts` "new guests on a table" | none | **Red: finding A5-11** |
| 11c | RR-33 | A waiter's identical round is never Added | `order-send.test.ts` "identical round alone" | none | **Red: finding A5-13, stop-and-ask** |
| 12a | RR-18 | A hold the provider stops showing tells someone | `payment-route.test.ts` "a hold the provider stops showing" | none | **Red: finding A5-3** |
| 12b | RR-38 (brief's M5 is M8) | Disconnect waits while a guest is mid-payment | `payment-connection.test.ts` "refuses Disconnect while a payment is %s" (9 states) | M8 as written is **killed** by `pay.test.ts:607`, whose payment is `requested`: the reading was partly wrong. Narrowed to `eq(state,'requested')`: 8 states red | **Kept green; unconfirmed red: finding A5-8** |
| 12c | RR-39 / hot spot 9 (brief's M3 is M6) | One holder per table; first come first served; no holder on an unmarked table; an expired wait goes | `payment-table-race.test.ts` "payment.claim_table itself" (5) | M6: 3 red (skip a held table, FIFO, expired). Mark no longer checking the holder: the unmark invariant red | **Proven gap, now kept green; deadlock red: finding A5-7** |
| 13 | M1 to M19 | see section 4 | | | Survivors killed by new tests, except the harmless `:1432` of M5 |

## 3. Finding rows

| Id | Sev | Where | Rule | Failure | Evidence | Conf |
|---|---|---|---|---|---|---|
| RR-A5-1 (RR-14) | **critical** | `pay.ts` being-paid check (lines go back to free once read back) | D112: "One payment at a time per bag and per bill … so two people never pay for the same drinks" | A payment goes `unconfirmed` with its lines read back on the guest table; `beingPaid` is false; a second Pay on the same line is accepted. A manager's "Receipt printed" on the first and the second's capture take two cards for one line | `pnpm vitest run --project apps/worker apps/worker/tests/payment-route.test.ts -t "unconfirmed payment’s lines" --reporter=dot` → `expected false to be true`; `expected 2 to be less than or equal to 1` | medium: the second close lands in the sim; on a real POS it depends on the lines' true place |
| RR-A5-2 (RR-11) | high | `pay-route.ts:678`, `payments.ts:1432,1455,1457` (`addMinor`) | D122: "It shows discount and free lines as the POS gives them, and nothing in the design assumes a bill without discounts" | A negative line on the isolated bill throws `MoneyError` in the last check; the payment stays `isolated` with the card held and the lines on the payment table | `pnpm vitest run --project packages/core packages/core/src/service/pay-route.test.ts -t "discount line" --reporter=dot` → `MoneyError: minor units must be a non-neg…`; `pnpm vitest run --project apps/worker apps/worker/tests/payment-route.test.ts -t "a discount line on the isolated bill" --reporter=dot` → `state: isolated`, not `released` | high on the code. Unknown: whether the pilot's POS gives discounts as lines (the sim has none; a Proxy injects them) |
| RR-A5-3 (RR-18) | high | `pay-route.ts:1255` `STUCK_STATES` = requested, priced, cancelling | D127 3.5/3.10: "Once a close has been attempted, Restro never undoes or releases..." (a stop must reach a person) | Provider refuses reads on an `isolated` payment: 30 minutes on it is still `isolated`, lines on the payment table, no alert | `pnpm vitest run --project apps/worker apps/worker/tests/payment-route.test.ts -t "a hold the provider stops showing" --reporter=dot` → `expected [] to not deeply equal []` | medium: rests on Stripe refusing reads (A7 checks) |
| RR-A5-4 (new) | high | `apps/worker/src/registry.ts:125`, `payments.ts:~2208`, `order-send.ts:597` (no `localConcurrency`) | D115: "One order in flight per table" (per table, not per worker) | Default concurrency 1. One long run (hung POS: about a minute of read-back; a payment run: up to 2 minutes) holds every other table's Send and every guest's payment, all venues and organisations of the worker | `pnpm vitest run --project apps/worker apps/worker/tests/payment-queue.test.ts -t "long run does not hold up" --reporter=dot` → `waited 8000 ms for the other payment-prepare job`; same for `order-send` | high. Fix candidate: `localConcurrency` above 1 (one process, so "a close is sent once" still holds) |
| RR-A5-5 (RR-12) | medium to high | payment route's undo step | D122 §2: "Payment table: a POS table that only Restro uses to take payments" (a foreign bill must not land on a guest's table) | A move that never landed, then a waiter's bill on the payment table: the undo moves the waiter's bill to the guest's table | `pnpm vitest run --project apps/worker apps/worker/tests/payment-route.test.ts -t "a waiter’s bill on the payment table" --reporter=dot` → `expected [ '2003' ] to deeply equal []` | high |
| RR-A5-6 (RR-29) | medium to high | `readings.ts`, `send-guards.ts` | D120: "A single failed reading of one bill only pauses that table until its next good reading (D111)." | After an incomplete reading a Send is accepted: no pause starts | `pnpm vitest run --project packages/core packages/core/src/service/send-guards.test.ts -t "a failed reading pauses the table" --reporter=dot` → `status: 'accepted'` | high |
| RR-A5-7 (new, via RR-39) | medium | `sittings.ts:556-563` (table row, then lease) against `pay-route.ts:366` + `payment_table_id` foreign key (lease, then FOR KEY SHARE on the table row) | `lock-order.ts`: "so two writers can never deadlock" | An owner unmarks a payment table as a run claims it: Postgres aborts one after its deadlock timeout. 34 of 40 rounds in one run, either side. No wrong state (the invariant loop is green), but the owner's action errors or the run throws. `LOCK_RANKS` has no table row, so the ledger can not see it; 40P01 is not retried in the service path. The old race test used its own copy of the claim and could not see this | `pnpm vitest run --project packages/core packages/core/src/service/payment-table-race.test.ts -t "no deadlock" --reporter=dot` → `"round 0, unmark: error: deadlock detected"` … | high |
| RR-A5-8 (new, via RR-38) | medium | `payment-connection.ts:463` + `payments_settled` (`unconfirmed`, `capture_failed` count as settled) | D125: "An owner's own "Disconnect" waits until no guest is mid-payment." | A card is held on an unanswered `unconfirmed` payment; Disconnect is accepted; "Receipt printed" still runs `captureStep`, which does not read the account's state | `pnpm vitest run --project packages/core packages/core/src/service/payment-connection.test.ts -t "unconfirmed payment nobody has answered" --reporter=dot` → `status: 'accepted'` | high on the code; whether capture still works after Stripe's disconnect is unknown |
| RR-A5-9 (RR-24) | medium | `packages/connectors/sim-pos/src/connector.ts:362-369`, `order-send.ts` (unknown = maybe landed) | D116: "Not sent \| Certainly not in the POS: a clear "no", a decline at the bar, or it never went out" | A read inside the add fails before anything is written: `unconfirmed/check_timed_out`, not `not_sent/pos_unreachable`. Table pauses, lines lost to the guest, no Try again. Fix is on the connector seam (a refusal, not unknown) | `pnpm vitest run --project apps/worker apps/worker/tests/order-send.test.ts -t "a read inside the add" --reporter=dot` | high |
| RR-A5-10 (RR-1) | medium | `payment-observe.ts` refund rows | D122 §8: "Each refund the provider reports is a refund row on the payment, and each row is its own storno to-do" | A 500 refund fails and a new 100 comes before the next reading: to-do stays 500, provider's total 100. Fix needs provider refund ids (Stripe knowledge file, open item 12). I did not write a "two rows" test: existing tests pin the limit | `pnpm vitest run --project packages/core packages/core/src/service/payment-refunds.test.ts -t "active refund rows" --reporter=dot` → `expected 200 to be 100` | high |
| RR-A5-11 (RR-27) | medium | `sittings.ts:234-237`, `send-guards.ts:147-163` | D122 §2: "ask your waiter to put your first item on" (only for a table with no bill) | New guests on a table whose bill stays open get `needs_first_item`, from a reading `endSitting` emptied | `pnpm vitest run --project packages/core packages/core/src/service/send-guards.test.ts -t "new guests on a table" --reporter=dot` | high |
| RR-A5-12 | medium to low | `closing-hour.ts:15-25`, `sittings.ts:479-483` | D122: "the closing time closes every table for phones" | A table kept for a payment that ends after 07:00 never closes by the hour: `tablesClosed` is false for the new service day. The comment says "bounded by the payment's own deadlines", `unconfirmed` has no bound | `pnpm vitest run --project packages/core packages/core/src/service/closing-hour.test.ts -t "only ends after 07:00" --reporter=dot` → `closed: 0` | medium |
| RR-A5-13 (RR-33) | low, **stop and ask** | `order-send.ts` read-back | Spec #64 line 164: "a waiter's identical round in that window makes it Unconfirmed, never Added." | On the pilot profile a lone identical round is Added. See section 7 | `pnpm vitest run --project apps/worker apps/worker/tests/order-send.test.ts -t "identical round alone" --reporter=dot` | high |
| RR-A5-14 | low | `service-day.ts:166-185` `localInstant` | closing time and last orders | A night of 03:30/04:00 on 28 Mar 2027: the skipped 03:30 becomes 04:30, last orders after closing | `pnpm vitest run --project packages/core packages/core/src/service-hours.test.ts -t "keeps last orders before closing" --reporter=dot` | high |
| RR-A5-15 | low | `service-day.ts:78-88` `serviceDate` | service day ends at `dayEndsAt` | A `dayEndsAt` inside the repeated hour takes the service day back on 25 Oct. Not settable in today's UI (`venue-settings.tsx:57` read-only, default 07:00) | `pnpm vitest run --project packages/core packages/core/src/service-hours.test.ts -t "never takes the service day back" --reporter=dot` → `2026-10-24 after 2026-10-25` | high |

Ledger candidates: RR-4 not reproduced. RR-16 not reproduced. RR-1, 11, 12, 14, 18, 24, 27, 29, 33 proven red. RR-37 kept green. RR-38 partly: M8 killed, new finding A5-8. RR-39 proven gap, closed by the new loop, new finding A5-7. RR-40 branches now pinned.

## 4. Mutations

Before my loops: M1, M2, M3, M4 (both), M6, M7 (`pay.ts`), M9, M10, M11, M12, M13, M14, M15, M16, M17, M18, M19 survived. Killed: M7 (`pay-route.ts`, by `receipt-brought.test.ts`), M8.

Each survivor now dies to a new test on the branch, re-run after adding it. **M5's `:1432` is the one survivor left**, with no money effect. M9's first result ran while I reverted its file by mistake; it was re-run cleanly and is killed.

## 5. Branch

`or/rr-loops`, pushed, no pull request. Tests only (19 files, plus 10 removed lines: three helper parameters and imports; no assertion weakened). Commits from `700bd081`: `b20fce9f`, `50bf7782`, `b8e29207`, `a2f354b0`, `291fb93e`, `e3ec683d`, `20adee7d`, `7d617cd6`, `9300828e`, `4c484b31`, `0fdc5685`, `9d8e9fae`, `89d9f335`, `3bc2db56`, `dc00bf90`.

The 18 red tests are normal failing tests, so this branch's CI is red until the fixes land.

## 6. What I could not cover

- **Hold across 07:00 with a pinned clock at worker level:** route commands use the real clock. Covered at core level only (existing `service-day-close.test.ts`, the closing-hour loops). Observation: an alert raised after 07:00 gets the new service day (`pay.ts:517`, `pay-route.ts:296,1280`).
- **Location pass and per-phone limits under bursts:** no new loop. `GuestLimiter.take` is synchronous and well tested, but `guest.ts:311` keeps it in the process, so with several web instances each has its own count. Unknown whether production runs more than one.
- **POS partial data on readings:** only the failed reading (RR-29) and the add's own read (RR-24).
- **pg-boss duplicates and retries per job:** only the two payment queues and order-send. Not looped for the others.
- **Breaker's 60-second window across a clock change:** not reached.
- **Rule 8 odd prices:** `money.test.ts` already has BigInt reference properties; added only 15 % of 4.50 through the real command.
- **Real Stripe behaviour:** RR-18 and A5-8 depend on it.

## 7. Stop and ask

**RR-33.** Spec #64 line 164 says a waiter's identical round in the window is "Unconfirmed, never Added". Review note #16 and the existing test "reads back a round that landed and then hung, finds it Added" say a match of exactly the sent lines with nothing else changed is Added. On the pilot profile (no reference, no who-entered) a lone identical round and Restro's own landed round are the same evidence, so both can not hold. **Recommendation:** the lead decides. I lean to accepting the residual risk, as making every hung write Unconfirmed sends each one to staff. If accepted, the red test should change with the decision.
