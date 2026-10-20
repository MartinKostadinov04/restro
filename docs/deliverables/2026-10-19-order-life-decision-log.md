# Decision log: "The life of an order and what the guest sees" (#37)

Made by: the #37 grilling session (Opus), 10-19, with Martin. For: anyone who needs every decision of #37 at a glance. Map #29 "Ordering from the menu". Built on the #35 log (`2026-10-18-bill-decision-log.md`) and the #36 log (`2026-10-18-table-visit-decision-log.md`); rows of those logs this grilling changed now name D116 or D117 there.

Every decision taken in the grilling, one row each, numbered by topic; the question it answered is in brackets (Q1–Q40). **Status:**
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope, or proposed and rejected;
- **open:** waits on a fact or a ticket.

**Recorded in** says where the binding text lives: a D-number, a ticket, `GLOSSARY.md`, or `docs/connector-questions.md` (CQ). Only D-numbers bind; this log is the index to them.

Sources, filed under D114: two Fable opinions, on one shared bag per table (`2026-10-19-shared-table-bag.md`) and on Martin's pay-first flow (`2026-10-19-pay-first-in-shared-bag.md`); an Opus proposal for locking the shared bag (`2026-10-19-table-bag-locking.md`) and a Fable second opinion on it (`2026-10-19-bag-locks-second-opinion.md`); the earlier process map, race list and use cases (`2026-10-18-ordering-*.md`); barsy's signed-in API reference (`2026-10-18-barsy-api-reference.md`); A5 §5.1 (`docs/reviews/connector-architecture/A5-guest-outbound.md`), the starting design this grilling tested.

**Updated after #39 (10-20):** row 7.3 now names D120, which answered it, in the same way. The #39 log is `2026-10-20-failure-pause-decision-log.md`.

## 1. The states of an order and what the guest sees

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | An order moves through six states: **Waiting** (stored and checked, waiting for the table's turn), **Sending**, **Checking** (no answer: a round is read back, a new stamped POS bill is resent unchanged, about a minute), **Added** (the POS has it), **Not sent** (certainly not in the POS: a clear "no", or never sent), **Unconfirmed** (still unknown after the minute). Replaces A5's pending / sending / accepted / rejected / failed / unknown. (Q1) | One name per thing the guest or staff must act on differently; D115's read-back needs its own state. | firm | D116, GLOSSARY |
| 1.2 | The guest sees "Sending…" for Waiting, Sending and Checking; "Added to your bill"; "We couldn't send your order, please call a waiter" for Not sent and Unconfirmed. (Q1) | D112's three messages, unchanged. | firm | D116, D112 |
| 1.3 | "Try again" only after **Not sent**; after **Unconfirmed** only "call a waiter" with a short reference, and staff are alerted. (Q1) | Only a definite "no" makes a resend safe; an unconfirmed round may have landed. | firm | D116 |
| 1.4 | Reading the table's POS bills back to see whether a timed-out round landed is the **read-back**. (Q1) | D115's check needed one word. | firm | GLOSSARY, D115 |
| 1.5 | Before anything goes to the POS, Restro checks every line; a sold-out or no longer orderable item, ordering paused, a code no longer in use (and #38's guards: an unopened table, the round cap, the pace limit) make the order **Not sent** with the specific reason, and the lines stay in the bag. A changed price does not refuse an order. (Q2) | The guest can fix it; price changes within the night stay on request (D111). | firm | D116, #38 |
| 1.6 | Right after an order is Added, the platform reads the table again, so every phone sees the round within seconds. No "my orders" list. (Q7) | D111's shared reading would otherwise lag ~20 s; no "who ordered what" (D111). | firm | D116 |
| 1.7 | Orders that land after "couldn't send" (use case 6): Restro stops checking once an order is Unconfirmed. Settled in #35. | "late orders is not something you can define at this point" (Martin, #35). | out | D112, #39 |

## 2. Cancelling

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | A guest cannot cancel once Send is pressed. Before Send the bag is freely editable. After Added only a waiter takes something off, in the POS, as today; Restro never removes a row (CQ C48 stays later). (Q3) | Restro behaves like a waiter (D110, D115); a half-cancelled round is the worst case. | firm | D116 |
| 2.2 | A payment is cancelled with "Pay later", only by the phone that started it; its lines go back to the bag. (Q23, Q29) | "pay later is the cancel" (Martin). | firm | D117 |

## 3. Approval at the bar and the venue's commitment

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | The venue is committed to an order the moment its POS accepts it (Added), or, with approval on, the moment the bar approves it. Restro adds no confirmation step of its own. A pay-first order's money is captured only after the POS's yes (D112). Replaces D13. (Q6, Q9) | The fiscal research: the guest sees "accepted" only after the POS has it, and the commitment is the venue's acceptance. | firm | D116 |
| 3.2 | Approval at the bar is a venue setting, **"Orders wait for the bar's approval"**, off by default, shown only where the venue's POS lets the bar approve and Restro read approvals and declines back. Off: Restro's cash desk runs without approval; on: with manual approval; Restro checks the POS matches at setup and warns the owner. Brings back #35 row 4.8. (Q6, Q8) | "if the POS allows approvals we have to adjust depending on the desires of the Venue" (Martin). | firm | D116, CQ |
| 3.3 | With approval on, a seventh state, **Awaiting approval**: the POS has the order, the bar hasn't approved. The guest sees "Waiting for the bar to confirm…", then "Added to your bill"; a decline shows "The bar couldn't take your order, please call a waiter" and the lines return to the bag. On the bill the round shows "waiting for the bar" and can't be paid. No time limit from Restro. It no longer holds the table's turn. (Q9) | The POS already has the rows, so the read-back cannot confuse it. | firm | D116 |
| 3.4 | How approval and decline read back, and whether approval is per POS bill or per round, is worked out per connector, for each new POS. (Q9) | "grey area that depends on the workflow of the POS" (Martin). | open | D116, CQ C53 |
| 3.5 | Approval covers on-the-bill orders only; a pay-first order is committed when paid and goes straight in, like barsy's own "directly after payment" mode. (Q10) | No card held while a bartender decides; a paid, closed POS bill awaiting approval may not exist in a POS. | firm | D116 |

## 4. One shared bag per table

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | Each phone has its own bag, and a second phone's order waits a few seconds. Proposed in round 1. (Q4) | Replaced by 4.2 (Martin). | out | D117 |
| 4.2 | One **bag** per table, kept on Restro's server: every phone opened from the table code sees and edits the same bag. The **bill** is the history of what the table ordered; the bag is what the table is preparing to order. (Q4, Q11) | "the session is one - the bag looks the same for every single phone" (Martin); Toast, Wolt, Uber Eats and Mews keep one shared cart (Fable). | firm | D117, GLOSSARY |
| 4.3 | A line in the bag remembers which phone added it, for the bag's lifetime. Proposed by Fable. (Q11) | "I dont see the added value", "We are not keeping the identification of the one who ordered" (Martin). | out | D117 |
| 4.4 | Send moves the on-the-bill lines out of the bag into one order at once; nobody edits an order on its way. Two Sends at once make one order. (Q11) | One bag, one Send, one order in flight (D115). | firm | D117 |
| 4.5 | Edits are small steps (+1, remove, undo) applied on the server in arrival order; the phone shows the server's bag back, as in any ordering app. (Q11) | Martin: good practice, simplicity with robustness. | firm | D117, D72 |
| 4.6 | The Send button says "Send 5 items"; anyone may remove any line, and the bag shows "Removed · Undo" for a few seconds. "Added by others" on the button and a confirm before removing another's line fell away with 4.3. (Q12, Q13, Q18) | "as simple as possible to the end customer" (Martin). | firm | D117 |
| 4.7 | A Send is refused with "Your table's bag changed" only if a line it sends changed in the second before; the phone refreshes and the guest taps again. (Q12, Q32) | Nothing goes out the sender didn't see; a pay-first line added meanwhile doesn't block it. | firm | D117 |
| 4.8 | Identical lines merge ("2 × Gin tonic"). (Q30) | Nothing to keep apart without 4.3. | firm | D117 |
| 4.9 | A Send while the table's previous order is still going in is not refused: its order is Waiting ("Sending…") and goes in when the first ends. If the first ends Unconfirmed, the table's ordering pauses and the waiting order becomes Not sent ("Ordering is paused, please call a waiter"), its lines back in the bag. (Q4, Q16, Q17) | "I would allow orders" (Martin); D115's one order in flight. | firm | D117, D115 |
| 4.10 | A Send whose items and quantities match an order from the same table in the last 15 minutes first asks "Your table ordered the same 4 minutes ago. Send again?"; the same for a Pay. (Q11, Q16, Q17, Q25) | Catches two friends ordering the same round and a re-order after "couldn't send" that may have landed after all (Martin). | firm | D117 |
| 4.11 | Every action where several people act on one thing (editing, adding, removing, sending, paying) is guarded by a lock on Restro's server with a deadline, and every phone refreshes once it is released. No phone ever holds a lock; a dead phone or a crashed server never leaves a table stuck. (Q17) | Martin: "anything that is related to multiple people engaging with one source should be related to locks and refreshes after a lock is released"; designed by an Opus subagent, checked by Fable. | firm | D117 |
| 4.12 | Single edits (add, +1, remove, undo, restore) take the bag for about a hundredth of a second and are put in order; every phone shows the change within 2–3 seconds. No lock is held while a guest edits. (Q33) | A bag has no "done editing" moment; an edit lock could only end by timeout and would block the other phones (Fable); Google Docs, Toast and Wolt merge instantly. | firm | D117 |
| 4.13 | Paying (from the bag or the bill) is a visible countdown lock: every phone shows "Someone at your table is paying · 1:42" with those lines greyed, the paying phone the same clock. 2 minutes to reach the bank's page, then the venue's unfinished-payment time (default 10 minutes, D112); no extension. (Q34, Q35) | Martin's "timeout release synced to the guest screen"; the money step is where products show a countdown (Ticketmaster). | firm | D117, D112 |
| 4.14 | When a payment's time runs out before the bank's page opened, the paying guest is brought back to the payment screen: "Your time ran out. Nothing was charged." with "Pay again". After the bank's page opened: "Checking…" until the provider's notice, no retry. (Q36) | "brings him back the action" (Martin); D112's no retry. | firm | D117, D112 |
| 4.15 | Send shows "Sending…" with no countdown; the template may say "up to 1½ min". (Q37) | A countdown would promise a time the POS doesn't keep. | firm | D117 |
| 4.16 | Questions on screen close by themselves: the duplicate warning (4.10) closes after 60 seconds and returns the guest to the bag. (Q38) | Nothing waits on a guest who walked away. | firm | D117 |
| 4.17 | The paying phone carries a random token for the payment's lifetime only, in its own storage, never on orders, payments or logs, so the server knows who may cancel and whom to bring back. It never marks lines and is never shown. (Q39) | Needed by 2.2 and 4.14; not the "who added it" tag of 4.3. | firm | D117, D111 |
| 4.18 | Countdowns come from the server's "seconds left" in every update; phones never use their own clock. (Q40) | No two phones disagree by more than one refresh. | firm | D117 |

## 5. How long a bag lives

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | A bag ends when it is sent or emptied, after an idle time the venue sets (default 30 minutes, restarted by every edit and by Send), and at the end of the service day. (Q15, Q19, Q26) | "edits should restart the timer" (Martin); a new group shouldn't find the last group's shots. | firm | D117 |
| 5.2 | A bag that times out moves aside as **"Earlier bag · Restore"**, seen by every phone at the table, until all the table's POS bills close; then it is deleted. The venue sets how many earlier bags are kept, default 1 (the latest). (Q19, Q26) | Martin: keep it until the table's bills close; cost: one row per table reused all night, ~200 KB for 50 tables (Opus). | firm | D117 |
| 5.3 | When all the table's open POS bills close, the bag and its earlier bags are cleared, usually because the group paid and left. (Q19) | "The only way we would wipe out something visible to the guest is when the common bag is closed from the POS" (Martin). | firm | D117 |
| 5.4 | Making a new table code clears that table's bag. (Q31) | A new code is issued because the old one leaked; the other rules usually clear it first. | firm | D117 |

## 6. Pay-first items in the shared bag

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 6.1 | A mixed bag is one order with a paid part and a bill part; the bill part waits for the payment. Agreed in round 1, replaced by 6.2. (Q5) | Fable: a declined card or a minute of "Checking…" held back drinks that needed no payment. | out | D117 |
| 6.2 | Send sends the on-the-bill lines at once as a round. Pay-first lines stay in the bag, marked "not ordered until paid", until someone pays them; nothing pay-first reaches the POS before it is paid. Anyone at the table may pay them. Replaces D112's "pay only the pay-first items or the whole bag; the rest waits for the payment" (#35 rows 6.2, 6.3). (Q14, Q20) | Martin's design; Fable: more robust, each half has its own reference and failure path; no product mixes the two in one order. | firm | D117 |
| 6.3 | One payment for the ticked selection, all pay-first lines ticked by default; the Pay button beside a line opens the payment with that line ticked. (Q14, Q21) | Each payment is a fee, a fiscal receipt and a closed POS bill; one fee for the whole selection (Martin). | firm | D117 |
| 6.4 | No yes/no question after Send: the "Added to your bill" screen says "2 items are not ordered until paid" with "Pay 24 лв". A bag of only pay-first lines shows "Pay X and order". (Q22) | One tap fewer, no "No" that reads like cancel. | firm | D117 |
| 6.5 | "Paying…" through the hold and the POS write; "Paid. Your receipt is at the bar" only after the POS's yes; the bar delivers from its own POS ticket. While a payment runs, its lines are greyed on every phone ("someone is paying for these"); a decline offers Try again, Pay later or Call a waiter, and Pay later puts the lines back. "Order the rest without it" is gone. (Q23) | D112's hold, write, capture; D72. | firm | D117, D112 |
| 6.6 | Paying doesn't wait for the table's order turn; a Send and a Pay can run at the same time. A payment from the bag and a payment of the bill run side by side, one of each at a time. (Q24, Q28) | The turn exists only for D115's read-back of rounds; a paid POS bill is new and stamped. | firm | D117, D112 |
| 6.7 | At Pay every ticked line is checked again: a sold-out line can't be ticked; a changed price refuses the payment once with "The menu changed, check your bag". (Q25) | The bag is not a quote. | firm | D117 |
| 6.8 | The venue sets its minimum card payment. Below it, the payment screen shows "Add 4 лв more to pay by card" with a few pay-first suggestions, like Uber Eats' minimum order; Pay unlocks at the minimum. Replaces the proposed warning in the menu editor. (Q21, Q25, Q27) | Martin. | firm | D117, D112 |
| 6.9 | Which items are suggested and how the minimum bar looks. (Q27) | Default: the venue's most-ordered pay-first items near the missing amount. | open | #45 |

## 7. Follow-ups

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 7.1 | The approval question goes into the connector questions, POS-neutral, with a barsy and a Mistral line. (Q6) | Martin. | firm | CQ C53 |
| 7.2 | How the bag, the bill and an order's state reach the phone (one combined call, polling interval or push), the guest commands and refusal codes. | The guest API's ticket. | open | #40 |
| 7.3 | What staff see of Unconfirmed orders, the alert, and how a paused table resumes. | The failure ticket. | open, answered by D120 (the guest's "Show this to your waiter" panel, push alerts, the Log, four ways a table pause lifts) | D120, #39 |
| 7.4 | Song-request bids are frozen while being paid (Martin, in passing). | The DJ queue has its own owner (10-17). | out | D99 |
