# Repair-review of `or/foundation`: the findings ledger

Plan: `docs/deliverables/2026-10-29-repair-review-plan.md`. **Written only by the lead** (§6); every other agent writes its own file in this folder and the lead copies each candidate in as a row. Pinned commit: `16b59a82` (or/foundation, 10-30 morning; read-only worktree `.claude/worktrees/rr-pinned`). Later merges (#235, #236 and anything after) are read as a delta and the pin moves before phase 1.

Status moves `candidate → verifying → confirmed | dropped | observation → ticket #n → fixed <sha> → re-verified`. Severity: critical (money lost or taken twice, another organisation's data, a POS write outside the waiter's acts), high (a guest or staff path broken, a decision contradicted), medium, low.

## Findings

| Id | From | Area | Severity | File:line | Rule / decision | Failure scenario | Evidence | Status |
|---|---|---|---|---|---|---|---|---|
| RR-1 | Part 2 lead (handover, 10-30) | paying: refunds | tbd | `packages/core/src/service/payment-refunds.ts` (doc comment) | rule 8, D127 (or/) | Refund reconciliation matches by amount, not by the provider's refund id: a failed refund and a new one for the same amount in one reading can be miscounted | none yet: A5 writes the loop, A6 checks the transition | candidate |
| RR-2 | Part 2 lead (handover, 10-30) | guest page: paying state | tbd | guest API / table version | D121, D127 (or/) | An open guest phone doesn't pick up changed paying state or legal details until the table's version moves; a guest can pay under the old state | none yet: A7 and A8 | candidate |
| RR-3 | Part 2 lead (handover, 10-30) | tests: e2e refunds | tbd | the e2e refunds harness | — | The harness only narrows the provider-notice race, it doesn't close it: a retried-green spec can hide a real race | none yet: A2, A9, A11 | candidate |
| RR-4 | A2 (RR-A2-1) | paying: the payment route | high (proposed) | `packages/core/src/service/pay-route.ts`, the `payment-route` fast-check property | D127 (or/) route failure rules; rule 8 | The property failed with two counterexamples on 10-29 and passed on re-run: seed 1085069335 breaks "unconfirmed" after a closeBill that lands then hangs plus a capture `server_error`; seed -950485348 breaks "closed" after a hold expires before the close. Either a state hole on the money path or a wrong invariant in the model | CI runs in `flakes.md` §5; replay the two seeds | candidate: **A5 runs the seeds first** |
| RR-5 | A2 (RR-A2-2) | guest page: pay return | medium (proposed) | `apps/web/src/guest/guest-menu.tsx:128` | D127 (or/): the provider values are cleaned from the address "before any request" | The `payment_intent_client_secret` is stripped from the address only in a post-hydration `useEffect`, so it sits in the address bar (and any request fired before hydration) for a moment; `guest-pay-return.spec.ts:49` fails first try in 8 runs | `flakes.md` §5 | candidate: A7 confirms what is sent before hydration |

## Observations

True but not a defect: a smell, a missing test, an awkward screen. Martin picks which become change tickets.

| Id | From | Area | What | Proposal | Effort |
|---|---|---|---|---|---|
| RR-O1 | Part 2 lead (handover, 10-30) | Tonight: paying off | Tonight gives no reason when paying is off because a Paying setup check is incomplete | A8 confirms as the manager; a one-line reason on the banner | S |
| RR-O2 | A2 | CI: retried-green tests | Nine Playwright tests passed only on a retry in the window (41 runs); `tables.spec.ts` "an area is renamed and moved…" 18 runs on 9 branches and six outright failures on `or/foundation` pushes; `guest-pay-return.spec.ts:33` 8 runs; `payment-tables.spec.ts:201` 7 runs. Full list and re-run recipe in `flakes.md` | A9 re-runs each with retries off; a spec that fails once is a finding | — |
| RR-O3 | A2 | CI: skipped tests | 135 of 431 Playwright tests are skipped on every CI run (env-gated: `FACES_VISUAL`, `SCREENSHOT_DIR`); none was seen green in the window | decide which gates CI should open on a nightly run | M |

## Quorum log

| Id | Tier | Verifier 1 | Verifier 2 | Tie-break | Outcome |
|---|---|---|---|---|---|
