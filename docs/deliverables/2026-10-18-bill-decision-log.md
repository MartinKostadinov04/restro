# Decision log: "What is a bill in Restro?" (#35)

Made by: the #35 lead session (Opus), 10-18, with Martin. For: anyone who needs every decision of #35 at a glance. Map #29 "Ordering from the menu".

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

## 1. What a bill is

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | A **POS bill** is one bill as the venue's POS holds it: items owed plus payments, open until settled, closed with a fiscal receipt. | Same in barsy and every POS read. | firm | D111, GLOSSARY |
| 1.2 | The POS is the only truth. Restro never keeps a bill of its own. | A copy disagrees the moment a waiter acts. | firm | D111 |
| 1.3 | A table can hold several open POS bills; the table is an optional label; a POS bill can have no table. | barsy and POS systems in general work this way. | firm | D111, GLOSSARY |
| 1.4 | A **bill** is what guests see: everything ordered at a table in one visit, by one guest or several, with what is paid and what is owed. One per table, however many POS bills sit behind it. | "I don't really care how many bills you open as long as the customer sees the full bill" (Martin). | firm | D111, GLOSSARY |
| 1.5 | The bill shows no "who ordered what". | Separate bills are tiring; attribution costs development without much value. | later (improvement) | D111 |
| 1.6 | Everyone who opens the guest page from the table code sees the table's bill. | The friend who pays often didn't order. | firm | D111 |
| 1.7 | Anyone who sees the bill may pay it. | Otherwise it becomes very complex; money coming in is never a risk. | firm | D111 |
| 1.8 | In this map every guest order comes through a table code; ordering at the bar means table codes on the bar counter. | Keeps the bill tied to a table. | firm | D111 |
| 1.9 | Ordering with no table code. | | out | D111 |
| 1.10 | Waiters keep every power they had; whatever they do in the POS is what the bill shows. | Restro is one more party that reads the bill and acts on it. | firm | D111, D112 |
| 1.11 | When a visit starts and ends, and which POS bills belong to a bill. | | open | #36 |

## 2. What Restro keeps

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | Restro keeps its own **orders**: items, quantities, price shown, time, table, the POS bill each went onto. | | firm | D111 |
| 2.2 | Restro keeps its own **payments** (once paying exists): amount, what it paid for, provider reference, receipt reference. | | firm | D111 |
| 2.3 | Rounds a waiter enters and payments taken at the bar are not kept; Restro sees them only in a reading. | | firm | D111 |
| 2.4 | The reasons for keeping: knowing what was already sent; evidence ("never came", "paid twice"); refunds, disputes, bookkeeping and Restro's fee (D98); insights (D32). | A Fable session tested them; Martin delegated the verdict. | firm | D111 |
| 2.5 | The venue's POS keeps the sale 5 years (Н-18); the provider keeps the card record (PSD2); Restro's only legal duty is its fee invoices. | Research, `2026-10-18-records-and-bill-closing.md`. | firm | D111 |
| 2.6 | Orders and payments are kept 18 months, then only totals. | Covers the longest card-dispute window (540 days). | firm | D111 |
| 2.7 | No phone, device or IP identifier stays past the service day. | Guests stay anonymous. | firm | D111 |
| 2.8 | Orders and payments are erased when the venue is purged (D83); fee records are kept apart and survive. | | firm | D111 |
| 2.9 | Bookkeeping retention periods, checked against the official text. | | open | D111 |
| 2.10 | A 30-day raw log of Restro's exchanges with the POS. | | open | D111 |

## 3. Reading the bill

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | The platform keeps one **reading** of a table's POS bills for minutes, refreshes it a few times a minute at most, serves it to every phone, and shows when it was read. | 8 phones polling would be ~50 POS calls a minute per table. | firm | D111 |
| 3.2 | When the POS does not answer: the last reading with its age, plus the guest's own orders sent since; ordering and paying pause; never a blank or a made-up total. | | firm | D111 |
| 3.3 | Each POS failure goes into an error log per connector and alerts the Restro team. | Martin. | firm | D111 |
| 3.4 | How the team is alerted at night. | | open | #39 |
| 3.5 | Before each guest action on the bill, the platform asks the POS: is the bill still open, and is it the same as this phone was shown? The phone carries what it was shown. | Martin's "knock on the door": cheaper than storing anything per guest. | firm | D111 |
| 3.6 | If the bill changed: one short message and the fresh bill. No line-by-line list. | A list means storing what each phone saw: load and development for little value. | firm | D111 |
| 3.7 | Prices that change within the night (happy hour). | No venue has asked; day-long discounts are a separate menu. | on request | D111 |
| 3.8 | A POS that cannot read a bill back. | No workaround until we know. | open | D111, CQ |

## 4. Sending an order

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | Each guest order opens its own POS bill on the table, stamped with Restro's code. Replaces the charting decision "orders add rounds to the table's open bill". | A timeout tells nothing; barsy refuses a duplicate only for a new bill (re-read signed in 10-18), so a retry can't double the drinks. | firm | D112 |
| 4.2 | Adding rounds to an open POS bill. | Waits until a POS confirms a duplicate guard. | open | D112, CQ, Q82 |
| 4.3 | Restro never sends a second order, **for now** ("until we see this issue being real"). | | firm, revisitable | D112 |
| 4.4 | With no answer, Restro resends the identical stamped request for about a minute; then "please call a waiter" and a staff alert. | The same letter with the same seal, never a new order. | firm | D112 |
| 4.5 | The phone shows "Sending…", "Added to your bill" (only once the POS has it), or "We couldn't send your order, please call a waiter". | No moment where the bar and the guest disagree. | firm | D112 |
| 4.6 | No delivery-style stages ("being prepared"). | Extra steps for waiters, load on our systems. | out | D112 |
| 4.7 | Staff see several POS bills on a table and can merge them in one action. | barsy's own QR menu works so. | firm | D112 |
| 4.8 | Approval of orders at the bar. | | out (now) | D112, #38 |
| 4.9 | Orders that arrive late. | | out (now) | D112, #37 |
| 4.10 | An item the bar refuses after it is on the bill. | An item is either on the menu or not. | out | D112 |
| 4.11 | Moving a bill to another table; a guest at the wrong table. | Done by a waiter in the POS. | out | D112, #36 |

## 5. Payment mode

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | Each item is **on the bill** or **pay first**: a venue default plus an item override, next to D29's ordering mode. | | firm | D113, GLOSSARY |
| 5.2 | Each table has one switch, **"Disable prepayments"**, off by default; on → everything at that table goes on the bill. Replaces three settings per area. | Simpler (Martin). | firm | D113 |
| 5.3 | The rule lives only in Restro, as a gatekeeper; the POS sees only POS bills and payments. | "upstream bill is bill and payment is payment" (Martin). | firm | D113 |
| 5.4 | Until paying in the app exists, pay-first items show "ask your waiter". | | firm | D113, D112 |

## 6. Paying first

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 6.1 | A pay-first order is paid before it reaches the POS, then becomes its own POS bill, opened, paid and closed in one call, labelled with the table. | Nothing in the POS can change under it. | firm | D112 |
| 6.2 | The guest chooses: pay only the pay-first items, or the whole bag. Replaces the charting decision "a bag with any pay-first item is paid first as a whole". | Martin. | firm | D112 |
| 6.3 | The on-the-bill items wait until the payment settles, then go to the POS right after the paid POS bill. | | firm | D112 |
| 6.4 | "Card declined": try again, order the rest without it, call a waiter, and a small way back. | Cancel is not a priority action (Martin). | firm | D112 |
| 6.5 | "Can't tell yet": about 60 s of "Checking…" with no retry button, then "Please call a waiter" with a reference. | A retry there risks paying twice. | firm | D112 |

## 7. Paying on the bill

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 7.1 | Paying for your own items is a **split**: the lines move to a new POS bill, paid and closed with its own receipt. | Avoids the part-payment form of Н-18 чл. 26а. | firm | D112, GLOSSARY |
| 7.2 | Paying pays exactly the lines shown; a round landing meanwhile stays on the bill. | | firm | D112 |
| 7.3 | The whole bill over several POS bills: merge, then close once; else close each. | One receipt where possible. | firm | D112, CQ |
| 7.4 | Restro sends the amount shown and closes in the same call, then reads back that the bill is closed with Restro's payment on it; on a mismatch the hold is released and the venue alerted. | barsy never closes a paid bill by itself; no POS reliably refuses a wrong amount. | firm | D112 |
| 7.5 | **Part payment** of an amount on a POS bill that stays open. | Waits on the POS's receipt behaviour and Н-18 чл. 26а. | open | D112, CQ |
| 7.6 | **Group payment** (several cards, the bill or a share) is designed into this map and built once the provider has holds and the POS confirms one call can close a bill with several card payments. | Martin: "if you manage to figure everything out, we do it in this feature set". | later | D112, #43 |
| 7.7 | Demand test for group payment: count how often the pilot venue's bills are already paid with two or more cards. | Needs no code. | firm | D112 |
| 7.8 | D14 ("guests can split the bill") is met by splitting by items until group payment exists. | | firm | D112, D14 |

## 8. Money

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 8.1 | Every guest payment: hold, write to the POS, then capture; a POS refusal releases the hold. | The guest is never charged for what the POS didn't record. | firm | D112 |
| 8.2 | With a provider that cannot hold, Restro refunds automatically only on a clear POS "no", never after a timeout. | | firm | D112 |
| 8.3 | The server finishes each payment from the provider's notice; an unfinished payment is dropped after about 10 minutes (a venue setting). | Closing the phone changes nothing. | firm | D112 |
| 8.4 | One payment at a time per bag and per bill; others see "someone is paying". | Two people never pay for the same drinks. | firm | D112 |
| 8.5 | Refunds happen at the venue (provider dashboard plus a POS reversal); Restro's payment record carries the provider's reference. | | firm | D112 |
| 8.6 | A minimum amount for card payments is a venue-wide setting. | | firm | D112 |
| 8.7 | A table's minimum spend for the night (VIP tables). | | out | D112 |
| 8.8 | Receipts: a PDF copy in the app; a paper copy from the bar or a waiter. | | firm | D112 |
| 8.9 | Whether an electronic copy counts as handing over the fiscal receipt (Н-18 чл. 25). | A plain-rules question for research. | open | D112 |
| 8.10 | Tips. | After ordering. | later | D112 |
| 8.11 | The time others have to pay their share (D30). | Too short for a group; decided with the bill screen. | open | D30, D112, #45 |
| 8.12 | barsy's own payment links. | They would bypass the venue's payment provider. | out | CQ |
| 8.13 | The Instagram in-app browser. | Guests scan with the camera, which opens their normal browser. | out | D112 |

## 9. Follow-ups and way of working

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 9.1 | The bill screen gets its own prototype ticket: paid and unpaid, paying from it, group payment, D30, the minimum, tips. | Martin asked to mark it for design. | open | #45 |
| 9.2 | One living list of POS questions, POS-neutral, with a barsy and a Mistral line each; it is also the Mistral checklist. | Martin: figure out each POS. | firm | CQ |
| 9.3 | Agents' deliverables are filed in `docs/deliverables/` with an index, informing and never binding. | Martin. | firm | D114, CLAUDE.md |
| 9.4 | Plain legal rules are researched by agents; a lawyer only for interpretation. | Martin. | firm | restro-flow `upkeep.md` |
| 9.5 | D5 ("an order is paid when placed") is superseded; D14 and D29 refined; D30 reopened. | | firm | D111–D113 |
