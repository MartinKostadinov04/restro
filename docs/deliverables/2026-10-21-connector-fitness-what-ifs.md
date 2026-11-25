Made by: lead session (Fable), 10-21, at Martin's request. For: Martin and the ordering lead of map #29. It informs and never binds (D114).

# Are the order and payment paradigms fit for other POS systems and payment providers? A what-if check

Martin asked how far the way Restro processes orders and payments, as decided in D111–D122 and D98, would carry to a POS or a payment provider that is not the pilot's. The method is a list of what-if questions, each answered against the decisions in force and the connector interface proposed for #51 (`2026-10-21-test-pos-design.md` §1). Words follow `GLOSSARY.md`.

## In short

- **Ordering is fit.** The platform says only "put these lines on this table's bill" and reads the table's open POS bills back. That sentence holds at a one-bill POS (Mistral), a many-bill POS (barsy, Toast, Lightspeed, Square), a tab-first POS and a POS with approval at the bar. The capability list carries the differences. Nothing here needs a change.
- **Paying is fit in its shape, and leaks in one place.** Hold, then write to the POS, then check, then close and capture, is the right shape for every POS and every provider read so far. But the **payment table** and **one queue per bar** are the pilot POS's mechanism, and the #51 interface takes a payment table as a parameter of three of its four payment steps. On barsy there is no payment table: the same step is a split on the same table. This is cheap to fix before code and expensive after.
- **Two rules collide for a provider without holds.** D112 says a provider that cannot hold is handled by charging and refunding on a clear "no"; D122 §8 says Restro's key never refunds. One has to give. The recommendation is that holds are a must-have for paying on the bill, as reading a table's bill is a must-have for ordering.
- **Two things the platform treats as facts are POS-specific:** every table has one bar, and a bill's "table" is the key to everything (sitting, pass, shared order). Both are right for the pilot, and both should be read as "where the POS has them".

## 1. What-ifs on the POS side

| What if the POS… | What the decisions say today | Fit | Note |
|---|---|---|---|
| keeps **several open bills on one table** (barsy, Toast, Lightspeed, Square, Microinvest) | The guests' bill is every open POS bill on the table (D115); a sent order joins the oldest; a capability "several bills on one table" exists (D122 §3) | fits | Paying **the whole bill** then means several closes and several receipts under one hold (D112 names it; the #51 interface returns one `receiptNo` and one close). The saga needs "N closes under one hold", with the rule for a close that fails midway. |
| keeps **separate bills per group** on a shared table, by the waiter's choice | All of them show as one bill, and anyone at the table may pay any line (D111) | fits the model, questionable as a product | Strangers' drinks on a phone. A later venue setting, "show only lines the phones sent", is possible without a model change because Restro keeps its own sent orders. Not for the pilot. |
| allows **bills with no table** (bar tabs, named tickets: Toast, Square, Simphony, Zamboo's bar tab) | Every order comes through a table code; no ordering from the bar (D111, D115). A tab moved onto a table appears there. | fits by scope | The whole platform keys on the table: sitting, location pass, shared order, open for phones, limits. A future "open a tab at the bar with a card hold" is a second seam, not a tweak. Fine to leave. |
| **requires** a table on every bill (Mistral, Microinvest) | Payment tables exist for exactly this | fits | — |
| has **no open bills at all** (every sale paid at once, counter service) | "First items open a bill" is off, so on-the-bill orders are refused; pay-first works through "open, pay and close in one call" | fits as the degenerate case | Menu plus pay-first only. The screens already fall back by capability (D122 §4). |
| puts a **seat or cover count** on bills (Simphony, Toast) | Nothing reads or writes seats | fits | The connector defaults a seat; the capability "first items open a bill" covers a POS that insists on a cover count. |
| **splits a bill into a new bill** instead of moving lines to a table (barsy `Accounts_divide`) | D122 §8 scopes the payment table to "a one-bill POS"; the #51 design notes barsy "isolates by divide on the same table" | leaks in the interface | `isolateLines(t, picks, pt)`, `readIsolated(pt)` and `payAndClose(pt, …)` all take a payment table. A connector that has none has nothing to put there. See §3. |
| limits **parallel payments** differently (Mistral: one per payment table; barsy: per bill, unlimited tables) | "One queue per bar, one payment per payment table at a time" (D122 §8) | leaks | The limit is a resource the connector should declare, not a rule the platform knows. See §3. |
| has **no bars**, or cannot say which bar a table belongs to | "Each table belongs to one bar, read from the POS and never edited in Restro" (D122 §7); the #51 switch `readsTableBar` off is called unknown territory | gap, small | Bar should be optional in the platform: a venue with no readable bars has one implicit bar (the venue), so pauses, payment queues and "pause one bar" collapse to the venue. Decide it in #51 or #55. |
| supports **part payment by amount on an open bill** natively (Toast, Lightspeed; barsy `Payments_create`) | Deferred on the POS's receipt behaviour and Н-18 чл. 26а (D112) | fits as a later capability | Same saga shape (hold, write, check, capture); only the write differs. |
| **merges or moves bills between tables** (joined tables) | A waiter's action; the sitting at the emptied table ends on a complete reading (D122 §4) | fits | The phones at the emptied table lose their order and pass, and rescanning shows nothing. Expected; worth one line in the staff guide. |
| gives **no "who entered a line" and no reference on a line** | Capabilities; "did it land" falls back to matching by article and quantity (D115, #51) | fits | More Unconfirmed orders, which D122 accepts. |
| **renumbers bills** on split or merge (barsy's divide makes a new id; merge keeps the oldest) | Restro's records keep "the POS bill each sent order went onto" (D111) | fits, with one care | Store that POS bill id as a fact of the moment, never as a live link; matching and evidence must not depend on it still existing. |
| **pushes events** (webhooks: Toast, Square) | Polling only (D41, rule 7) | fits | A pushing POS is simply polled. No loss. |
| takes the **card itself** through its own payment link (barsy's link, Mistral's myPOS partnership; D19 pending) | No route: `payAndClose` assumes Restro took the money | not covered, by choice | A capability "the POS takes the payment" would collapse steps 2–4 of the route into "ask the POS for a link, read until closed". Leave it until D19 is settled; the saga shape allows it. |
| has **several logins** (one per bar) or several installations | Pauses per POS login (D122 §6); one source per venue (D87) | fits | Two different POS vendors in one venue are unsupported, which is right. |

## 2. What-ifs on the payment side

| What if the provider… | What the decisions say today | Fit | Note |
|---|---|---|---|
| **cannot hold** | D98: a declared fallback, charge on request and refund on skip; D112: refund automatically only on a clear "no" from the POS; D122 §8: Restro's key never refunds | **conflict** | See §3. |
| holds only on **its own page** (myPOS Checkout redirects) | The embedded form was settled in round 1; #49 row 1.3 asks the question | open, not structural | The lock of 2 minutes to reach the bank's page, the "only the paying phone may cancel" token and "the server finishes each payment from the provider's notice" (D112, D117) all survive a redirect. The return URL must carry the payment's lifetime token. |
| cannot **capture less than held** | D122 §8 captures less only after a voided line; the #51 flag `partialCapture` off releases and asks to pay again | fits | — |
| cannot **capture more than held** (tips) | Tip fixed before the hold (#51 flag); myPOS takes a tip as a charge of its own (#49 row 1.4) | fits | #53 decides which. |
| charges a **fee to cancel a hold** (myPOS help centre) | The route always holds first, so every declined POS write costs the venue a fee | fits, with a cost | A venue setting could skip the hold where the POS write never fails in practice. Not now; count it in #56's pilot numbers. |
| sends **no notices** (no refund or dispute notice) | A daily 30-day status check (D122 §8) | fits | — |
| offers only a **platform model** (Stripe Connect, Adyen) | The venue is the merchant, one account per venue (D98) | fits | Direct charges on a connected account keep the venue as merchant. |
| **expires holds early** or needs capture within a short window | Capture follows close within seconds (D122 §8); plan for 7 days | fits | — |
| can **split one charge** between cards | Group payment is designed in and built later (D112, #43) | fits | — |

**A wording point.** CLAUDE.md's rule 7 says "no webhooks", and D41 says the same for barsy. D122 §8 relies on the provider's signed notices, which are webhooks. The rule means POS webhooks; the handover already notes the line may need new wording (#53). Changing CLAUDE.md is Martin's go-ahead.

## 3. The three findings worth acting on

1. **Replace the payment table in the interface with an opaque handle.** `isolateLines` should return what the POS made (a payment table, a split-off bill, or the bill itself when the picks are a whole POS bill), and `readIsolated`, `payAndClose` and `undoIsolate` should take that handle. The connector also declares its concurrency resource: Mistral "one per payment table, N payment tables per bar", barsy "per bill". The platform's queue then keys on whatever the connector names, and payment tables become a connector setting shown only where the capability is declared, as the three-layer rule asks. D122 §8's words already scope the payment table to "a one-bill POS", so this touches the #51 proposal, GLOSSARY's "payment table" line and D122 §7's "the owner sets … payment tables", not the decision's substance.
2. **Make holds a must-have for paying on the bill.** A provider that cannot hold gets no paying, the way a POS that cannot read a table's bill gets no ordering (D122 §1). This keeps "Restro's key never refunds" and drops D98's and D112's charge-and-refund fallback for the bill route. Song requests (D99) keep their own fallback, because that money never passes through a POS. One line in D98 and D112.
3. **Make the bar optional.** Where a POS reports no bars, the venue is one bar: one payment queue, one pause, one "pause ordering". Decide it with #51 (switch `readsTableBar`) and record it in D122 §7.

Two smaller ones: `payAndClose` returns a list of receipts, not one, so a whole-bill payment over several POS bills is one capture; and the POS bill id on a sent order or payment record is stored as a fact of the moment.

## 4. What was checked and found sound

- The connector interface is small (eight operations) and the behaviour stays in the platform (saga, locks, queue, Log), which is what lets a third connector be written from its POS's own docs.
- "A timeout is unknown, never refused" and "a partial reading concludes nothing" are stated as rules of the interface, not of one connector.
- Every POS-specific difference met so far already has a capability or a cautious switch in #51's table, and every switch is tied to a Mistral question.
- Money stays in integer minor units through the `money` module, and the capture equals the close exactly, which is a property test in #51.
- The payment provider interface (hold, capture, release, notices, flags) matches what Stripe, Borica, ePay.bg, SumUp and myPOS document (`2026-10-17-payment-providers-feasibility.md` §9).

## Sources

D98, D111, D112, D113, D115, D117, D122; `2026-10-21-test-pos-design.md`; `2026-10-18-bill-in-pos-systems.md`; `2026-10-17-payment-providers-feasibility.md`; `2026-10-21-payment-provider-decision-log.md`; `2026-10-21-ordering-handover-2.md`; `GLOSSARY.md`.
