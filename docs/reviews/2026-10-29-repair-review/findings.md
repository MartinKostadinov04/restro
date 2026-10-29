# Repair-review of `or/foundation`: the findings ledger

Plan: `docs/deliverables/2026-10-29-repair-review-plan.md`. **Written only by the lead** (§6); every other agent writes its own file in this folder and the lead copies each candidate in as a row. Pinned commit: _to be set at the freeze_.

Status moves `candidate → verifying → confirmed | dropped | observation → ticket #n → fixed <sha> → re-verified`. Severity: critical (money lost or taken twice, another organisation's data, a POS write outside the waiter's acts), high (a guest or staff path broken, a decision contradicted), medium, low.

## Findings

| Id | From | Area | Severity | File:line | Rule / decision | Failure scenario | Evidence | Status |
|---|---|---|---|---|---|---|---|---|
| RR-1 | Part 2 lead (handover, 10-30) | paying: refunds | tbd | `packages/core/src/service/payment-refunds.ts` (doc comment) | rule 8, D127 (or/) | Refund reconciliation matches by amount, not by the provider's refund id: a failed refund and a new one for the same amount in one reading can be miscounted | none yet: A5 writes the loop, A6 checks the transition | candidate |
| RR-2 | Part 2 lead (handover, 10-30) | guest page: paying state | tbd | guest API / table version | D121, D127 (or/) | An open guest phone doesn't pick up changed paying state or legal details until the table's version moves; a guest can pay under the old state | none yet: A7 and A8 | candidate |
| RR-3 | Part 2 lead (handover, 10-30) | tests: e2e refunds | tbd | the e2e refunds harness | — | The harness only narrows the provider-notice race, it doesn't close it: a retried-green spec can hide a real race | none yet: A2, A9, A11 | candidate |

## Observations

True but not a defect: a smell, a missing test, an awkward screen. Martin picks which become change tickets.

| Id | From | Area | What | Proposal | Effort |
|---|---|---|---|---|---|
| RR-O1 | Part 2 lead (handover, 10-30) | Tonight: paying off | Tonight gives no reason when paying is off because a Paying setup check is incomplete | A8 confirms as the manager; a one-line reason on the banner | S |

## Quorum log

| Id | Tier | Verifier 1 | Verifier 2 | Tie-break | Outcome |
|---|---|---|---|---|---|
