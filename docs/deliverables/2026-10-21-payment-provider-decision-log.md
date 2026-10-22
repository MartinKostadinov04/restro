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
| 1.7 | **A person at myPOS answered** (10-22). Its Embedded SDK can't hold a card, so with myPOS the guest always pays on myPOS's own page; this answers row 1.3's fact, and the choice stays Martin's (round 2, Q3). A lower completion releases the rest at once on myPOS's side, and the bank decides when the guest sees it. myPOS emails the guest nothing. There's a free sandbox with dummy data and a demo environment with real statuses, and neither runs 3-D Secure. It didn't understand the key-permission question. | Settles questions 2, 3 and 6 of the knowledge file. | open | #49, #45, #53, #56 (`2026-10-21-mypos-knowledge.md`, M22) |
| 1.8 | **myPOS's second answer** (10-22, Petar, support). Everything is set per store, and pre-authorisation is switched on by myPOS once it's told a store exists, in the demo and in production. There's no limited key: the store's credentials can do what the store can, and an API refund happens only if Restro builds one. Notices are checked with myPOS's public certificate for the store. A failed card is retried only by the guest entering it again. myPOS's partnership is with Take A NAP; it knows of none with Mistral. | Connecting a venue means holding its store credentials; the owner's connect steps (round 3) can be drafted from this. | open | #49, #53, #56, #61 (`2026-10-21-mypos-knowledge.md`, M22b, D22) |

## 2. Connecting the venue's account (Martin)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|

## 3. Technical choices (the lead decides and reports)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | **Restro tests against myPOS's demo environment (demo.mypos.eu), registered by Restro.** The public sandbox is used only for a first quick check. 3-D Secure, which neither runs, is checked once with a small real payment on the venue's live account before the pilot. | The paying steps rely on real statuses: a timeout is read back, never guessed (D122 §8). The sandbox returns dummy data. Restro's own demo account keeps tests off the venue's account (rule 7). | firm | #49 (D-file at the end of the grilling), #56 |
| 3.2 | **Restro's own code keeps D122 §8's "create, capture, cancel only" for myPOS.** The myPOS provider package has no refund or reversal call. A guardrail test fails if it ever sends `IPCRefund` or `IPCReversal`. The store's credentials are secrets, kept server-side and never logged. | myPOS has no key limited to holds (M22b): the venue's store credentials can refund. | firm | #49 (D-file at the end of the grilling) |

## 4. D98's open line and Q74

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
