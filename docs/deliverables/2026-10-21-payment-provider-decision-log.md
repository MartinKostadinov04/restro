# Decision log: "Which payment provider runs the pilot, and how a venue connects it" (#49)

Made by: the ordering lead session (Opus), 10-21, with Martin. For: anyone who needs every decision of #49 at a glance. Map #29 "Ordering from the menu".

Every decision taken in the grilling, one row each. **Status:**
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope;
- **open:** waits on a fact or a ticket.

**Recorded in** says where the binding text lives:
- a D-number;
- a ticket;
- `GLOSSARY.md`;
- `docs/connector-questions.md` (CQ).

Only D-numbers bind; this log is the index to them.

**Read before the grilling:**
- D98 and D122 (§8 paying, §9 platform);
- `2026-10-17-payment-providers-feasibility.md` (Stripe first, myPOS second);
- `2026-10-21-receipt-and-payment-law.md` (in-venue payment is not remote; the e-shop route does not apply).

**Settled before #49, not asked again:**
- the provider's embedded form (Martin, round 1, 6.6);
- Restro's key creates, captures and cancels only, never refunds (D122 §8);
- tips are in the pilot (D122);
- the receipt rules (D122 §8);
- Restro's fee is a fixed subscription (D122 §9, closes Q77).

## 1. The provider (Martin)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | **myPOS is the first payment provider** (Martin 10-21, round 1). It replaces the lead's recommendation of Stripe. | Martin's choice. myPOS is common in Bulgaria, and Mistral names a myPOS partnership (Mistral question 9). | firm | #49 (D-file at the end of the grilling) |
| 1.2 | **The pilot venue writes to myPOS** through its contact form, asking for the full API documentation and a technical contact, with the questions of Q76 widened by `2026-10-21-payment-provider-facts.md` §11. Martin sends it. | The facts that decide the payment flow on myPOS are not public: holds in an embedded form, partial completion, how a platform connects to a venue's account, key limits, retries, the sandbox. | open | Q76 in `docs/tracker.md`, #49 |
| 1.3 | **What if myPOS can hold the card only on its own page** (its Checkout redirects; its embedded SDK documents no hold, no Apple Pay and no Google Pay, facts §11)? This clashes with the embedded form settled in round 1 (6.6). | Asked in round 2. | open | #49 |

## 2. Connecting the venue's account (Martin)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|

## 3. Technical choices (the lead decides and reports)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|

## 4. D98's open line and Q74

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
