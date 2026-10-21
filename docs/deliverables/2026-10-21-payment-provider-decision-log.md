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
| 1.2 | **Restro writes to myPOS** through its contact form, as the software company whose client (the pilot venue) is a myPOS merchant, asking for access to the API documentation and the open questions of Q76. Martin sends it. *Replaced 10-21 (Martin): the first draft was written as the venue.* | The facts that decide the payment flow on myPOS are not public: the sandbox, the embedded form, hold details, key limits, retries. | open | Q76 in `docs/tracker.md`, #49 |
| 1.3 | **What if myPOS can hold the card only on its own page** (its Checkout redirects; its embedded SDK documents no hold, no Apple Pay and no Google Pay, facts §11)? This clashes with the embedded form settled in round 1 (6.6). | Asked in round 2. | open | #49 |
| 1.4 | **What Martin already knows of myPOS** (10-21), taken as given and not asked again: API access is given from the client's own myPOS account, with permissions; a sandbox exists (its details are unknown); authorisations and pre-authorisations are supported; a released hold returns to the card in a few days, depending on the bank; a tip is not a field of a pre-authorisation, but can be taken as a charge of its own. | Martin's knowledge. Tips as a separate charge feeds #53. | firm | #49, #53 |
| 1.5 | **myPOS's first reply** (10-21, its AI assistant): integration through Checkout on the venue's own account; pre-authorisation switched on per merchant on request, completed within 30 days and never above the hold, with a fee if it lapses; no embedded form and no sandbox in its material; no integrator programme; a list of what the merchant's site must show. A follow-up asks for a person at myPOS. Restro always releases a hold itself and never lets one lapse. | The assistant answers from general help pages; the open technical points need a person. | open | Q76, #49, #45, #53, #56, #61 (`2026-10-21-mypos-knowledge.md`) |
| 1.6 | **myPOS's help centre** (read 10-21): holds are offered "predominantly" to hotels and similar, but "food or beverage charges" are an allowed use; the venue asks for them from its registered email and myPOS decides case by case; **cancelling a hold costs the same fee as letting it lapse**, so row 1.5's "never lets one lapse" saves the guest's blocked money, not the venue's fee; Checkout sends the guest to myPOS's page. | A club's eligibility and the fee amount decide whether myPOS holds work for the pilot. | open | #49, #53, #56, #61 (`2026-10-21-mypos-knowledge.md`, open questions 11 and 12) |

## 2. Connecting the venue's account (Martin)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|

## 3. Technical choices (the lead decides and reports)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|

## 4. D98's open line and Q74

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
