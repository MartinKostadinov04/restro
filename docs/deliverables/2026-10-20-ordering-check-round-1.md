# Ordering check, round 1: Martin's answers and what they change

Made by: the lead session (Opus), 10-20, for Martin. For: Martin's ordered check of `2026-10-20-ordering-what-we-decided.md` (the Claude Doc "Ordering: what we decided"), and the three reviewers of its sections 9–11.

Martin went through the doc and sorted his points into five groups. This file answers each one in the doc's order. Every answer starts with a one-line reminder of what the item is about. The numbers are the doc's item numbers.

Nothing here changes a D-file yet. The changes become D122 (and notes on D112, D115, D116, D117, D120) once Martin confirms this round.

Marks:
- ✓ = Martin's reading is correct.
- ✓ + = correct, with one thing to add.
- ✗ = not quite; the answer says why.

## Group 1: Martin checks his reading

**1.6 · There is no "visit"; a bill left open overnight is staff's.**
Martin: all bills have to be closed, and that is staff's work in the POS, not Restro's. Restro is one more member of staff who enters orders.
✓ Correct. Restro closes only the bills it pays itself: a pay-first order, and lines a guest pays for on a virtual table. Every other bill is the waiters'. Restro never closes a table's bill "at the end of the night".

**3.1 · How the guest page opens.** Martin didn't follow it. In simpler words:
- The guest scans the **table code**. The **guest page** opens. The menu comes from published files, not from Restro's database. So if the database stops, the menu still shows.
- Each request from the phone tells Restro which table it is at. The table code goes in a hidden part of the request (a header). It never goes in the web address or in a log, and it is never stored with an order or a payment. Reason: a code that leaks lets a stranger order onto that table's bill.
- Restro has one special database lookup that finds the **venue** from a table code. All other lookups can see one venue's data only (a security rule). This one must look across venues to find the owner of the code. It is the only exception, and you agreed to it.
- When a venue makes a new table code, the old code stops at once and shows "This table code is no longer in use".

Nothing to decide here; 3.1 is firm.

**3.2 · What a phone sees: "payment countdowns".**
Martin: the countdown is only for the person who started paying.
✓ +, and with Martin's answer on 6.6 below, the countdown goes completely. What stays: while someone pays, the other phones see those lines greyed with "Being paid", without who and without a timer. That is needed so two friends don't pay for the same drink.

**3.3 · How often a phone asks.** Rephrased:
A phone can't know by itself that the table's order or bill changed. So every few seconds it asks Restro's server "has anything changed at my table?". The server answers "no change" (tiny) or sends the new state. 3.3 says how often a phone asks: every 2 seconds on the order and bill screens, every 10 seconds on the menu, never while the screen is off. The server, not the phone, asks the POS (see 7.1), so 6 phones at a table never mean 6 calls to the POS.

**4.4 · "3 orders waiting".**
Martin: depends on what "waiting" means. There is no "waiting for delivery", because no system knows when the drinks arrive.
✓ Correct, and "waiting" here never meant delivery. It means **sent from the phone but not yet passed to the POS**: Restro sends one round per table at a time (5.4), so a second Send waits a few seconds for the first. The limit says at most 3 can queue up like that. Delivery has no state at all (5.12). The words change to "**3 rounds queued to send**".

**4.5 · Locks.**
Martin: every action must check that it got the lock first, take it for as short a time as possible, and release it, with no race conditions.
✓ Correct; that is the rule. How it is built, so the reviewers can check it:
- A lock is a row in Restro's database, taken in one atomic step ("take it if it's free or its deadline has passed"). There is no "check, then take" in two steps, which is where races come from.
- Whoever takes it gets a token; only that token can release it, so a late process can't release someone else's lock.
- It is released in a "finally" step, so an error also releases it. If the process dies, the deadline frees it.
- Locks are short: one POS call or one database change. A guest who is thinking or typing never holds a lock.

**5.5 · Where a round goes ("the oldest open POS bill").**
Martin: no clue what this means, and not relevant: there is one bill per table.
✓ Correct for the pilot. The rule exists only because barsy lets a table hold several bills, and the platform must work for both. At Mistral it reads simply: **the round goes onto the table's bill.** The text will say that first and move the barsy detail into a footnote.

**6.6 · The payment countdown and the payment token.**
Martin: not Restro's job. Restro opens the payment provider's embedded payment form and everything happens there. The countdown is useless; paying is enough.
✓ +. Agreed:
- **Out:** the visible countdown, "Someone at your table is paying · 1:42", and Restro's own payment token. The provider's payment form handles the card, the bank's check (3-D Secure) and the payer's session.
- **Stays, invisible:** a deadline on the server. If a guest opens the payment and walks away, the lines must not stay locked, and at Mistral they must not stay on a virtual table. The deadlines are those D117 already set: 2 minutes to confirm, then the provider's own session time (10 minutes at most). Nobody sees them; when one passes, the payment is cancelled and the lines are put back.

**6.8 · Hold, write, capture.**
Martin: not Restro's job either. The money handler does its job; Restro writes to the POS only after the payment is approved. Simple.
✓ +. Agreed: **Restro writes the payment into the POS only after the provider approves it.** The one thing to add is a setting, not work for Restro. Most providers can approve a card payment in two steps: "approved" reserves the money, "capture" takes it. Restro asks for that mode when it opens the payment form, and captures right after the POS confirms. If the POS refuses or doesn't answer, the reservation is cancelled and the guest is never charged. Without it, every POS failure becomes a refund, which costs a fee and takes days to reach the guest's card. With a provider that can't do two steps, Restro refunds automatically on a clear POS "no" (as decided).

**7.1 · The reading of the bill.**
Martin: when someone opens the bill, Restro asks the POS for the latest state; how to do it best is Restro's job.
✓ Correct. That is what 7.1 says. The worker asks the POS for the table's bill when a phone at that table has the bill open, and shares the answer with every phone at the table for a few seconds. So a busy table costs the POS at most a few reads a minute. Before any action that depends on the bill (paying), it asks again (7.4).

**7.4 · The knock.**
Martin: it overlaps with other items and adds little.
✓ Correct. It becomes one line inside 7.1: "Before paying, Restro reads the bill again; it refuses only when a line being paid changed or went".

## Group 2: Martin wants a change

**2.2 · "Restro checks at setup that the POS's approval mode matches the setting".** (I read Martin's first point as this item; if he meant 2.9, the same answer applies.)
Martin: Restro can't really check this. Instead, name it as a possible action, build it inside the connector, and show it in the venue settings only where the connector has it.
**Changed.** Each connector declares a list of **capabilities**: what its POS lets Restro do and read. A venue setting appears only when the venue's connector declares the matching capability; otherwise it is never shown. Restro checks nothing at setup. If approval is on, Restro shows whatever state the POS reports. The capabilities in this feature:
- approval at the bar (5.11);
- reading who entered a row (5.6, 9.6);
- moving lines to another table (8.1);
- knowing which bar a table belongs to (2.10);
- several bills on one table (barsy yes, Mistral no).
The pre-opening check (9.3) drops "the approval mode matches the setting". It keeps "Restro's POS user can sign in" and, at Mistral, "the virtual tables are empty" (2.9), which is an ordinary read of those tables.

**4.1 · The name "bag".**
Martin: call it an order, not a bag.
**Changed.** The proposal:
- What the table builds together on the phones is **the table's order** ("Your table's order", button "Send").
- What one Send puts into the POS is a **round**. It goes through the states Sending → Added (or Not sent / Unconfirmed).
- "Earlier bag" becomes "**Earlier order**".
GLOSSARY.md and the decisions change the word once Martin confirms; the code doesn't exist yet. Below, the old word is used only in quotes.

**4.2 · "Removed · Undo".**
Martin: things like the undo show only to the person who did it.
**Changed.** The "Removed · Undo" message shows only on the phone that removed the line. The other phones just see the line go.

**5.7 and 5.11 · The state "Awaiting approval".**
Martin: it follows from his point on 2.2.
**Changed.** "Awaiting approval" exists only at a venue whose connector declares approval at the bar and has it switched on. Everywhere else, the states are Sending → Added / Not sent / Unconfirmed. At Mistral it is unknown until Mistral answers (questions 13 and 14).

**7.3 · "Your paid orders".**
Martin: not needed. After each payment, ask whether the guest wants to download the receipt; otherwise they ask at the bar. Is that all the law needs?
**Changed:** no "Your paid orders" list. After paying: "**Paid.** [Download receipt]", plus "Your paper receipt is at the bar".
**The law, as far as the filed research goes:**
- The fiscal receipt must be issued at the moment of payment and handed to the payer (Н-18 чл. 25, ал. 1 и 6). The guest is also obliged to take it (ЗДДС чл. 118, ал. 1а).
- The POS prints it on the venue's fiscal printer when Restro closes the bill. So it exists, at the bar.
- What is not settled is whether a downloaded copy counts as "handing it over" (item 8.7, open).
- **Recommendation:** have a research agent settle 8.7 before the pilot (offered as a separate session). Until then: "Download receipt" plus the paper at the bar.
- Which file the download is depends on the POS. Either a copy of the fiscal receipt (if Mistral can give one: checker, row R13), or the provider's payment confirmation, which is not a fiscal receipt.

## Group 3: Martin's answers to the doc's questions

**2.8 · Restro's virtual tables, one set per bar.**
Martin: Mistral most likely groups tables like barsy's halls, or has something else that shows which tables belong to which bar.
Recorded as the working assumption. The connector reads the grouping if the API gives it (capability "which bar a table belongs to"). If it doesn't, it is set by hand at setup. Mistral question 16 stays to confirm it.

**2.10 · Which bar serves each table.**
Martin: Restro will open virtual tables per bar. As he recalls, each bar has its own Mistral account that staff log into. Restro must know which real table it sent to which virtual table, and keep that in its Log.
Recorded:
- Each payment record names the real table, the virtual table and the bar. Each step (moved, paid, moved back) is a Log entry.
- **New question:** if each bar is a separate Mistral login, does Restro's connector need one login per bar, or can one POS user act on all bars? Rule 9 allows one POS user per connection, so "one connection per bar" may be the answer. This becomes Mistral question 19 and the venue question "how do your bars log in".

**3.4 · The open-table rule.**
Martin: we don't know whether a table has to be opened in Mistral, or is always live, with closing the bill just leaving it waiting for the first item of a new bill. If it's the latter, what is a good approach?
**The approach, for either case:** the rule's purpose is that a stranger with a photo of a table code can't put rounds on a table nobody is sitting at. So "open" is defined by what Restro can read: **the table's current bill has at least one item on it.**
- If Mistral tables are always live, an empty or just-closed bill counts as "not open". The guest sees "Ask your waiter to open your table" for on-the-bill items until a waiter puts the first item on. Pay-first items work as normal.
- If Mistral has an explicit "open table", Restro reads that instead.
- The venue switch "Only at tables a waiter has opened" stays. If the venue turns it off, Restro's first round may start the bill, as a waiter's would.
- The connector declares which of the two it reads (a capability).

**6.7 · Paying and sending side by side.**
Martin: yes, because paid items are queued for processing on the bar's virtual payment tables.
✓ Recorded. One detail for the build: at Mistral, the step that **moves** lines off the real table is a write on that table's bill. So it takes the table's write turn for those few seconds, like a round does. A Send and a move never write to the same table's bill at the same moment. Only the waiting for the payment runs side by side.

**7.8 · A POS that can't read a bill back.**
Martin: assume Mistral can read. If it can't, Restro doesn't work with that POS.
**Decided:** reading a table's bill with its rows is a **must-have** for ordering on any POS. A POS without it gets no ordering (menu only). It is the first go/no-go line in the Mistral checker.

**8.10 · Group payment.**
Martin: it has to be discussed with both the POS and the payment provider.
Recorded: stays **later**. It goes on both question lists: Mistral (can one close take several card payments?) and the payment provider (several cards towards one amount).

## Group 4: approved for now

**8.1 · Paying for your own items, at Mistral.**
Martin: yes, move the lines to another table. The bill confirmation on the guest's screen is, for Restro, the moment the lines are on the virtual table and Restro has read them back from it. That is the whole point of the guest's confirmation. Then the process goes on to the payment provider as usual.
The flow, in that order:
1. The guest ticks lines on the bill and taps **Pay**.
2. The payment joins the queue of the table's bar (group 4.2 below). When one of that bar's virtual tables is free, it is reserved for this payment.
3. Restro moves the ticked lines from the real table to the virtual table (it takes the table's write turn for this, see 6.7).
4. Restro reads the virtual table back.
5. The guest sees **the bill to confirm**: exactly those lines and the total, as the POS now holds them. → **Confirm and pay.**
6. The provider's payment form opens. The guest pays; the provider approves (money reserved).
7. Restro closes the virtual table's bill with the card payment. The fiscal receipt prints at the bar.
8. Restro reads back that the bill is closed, then captures the money.
9. "Paid. [Download receipt]". The virtual table is free for the next payment.

If anything stops it (the guest doesn't confirm within 2 minutes, the payment is declined or abandoned, or the POS refuses the close): the lines move back to the real table and the reservation is cancelled. If moving back fails, staff get the "stranded items" alert (9.11).

**Pay-first items at Mistral (6.10)** use the same queue, without steps 3–5, because nothing pay-first is in the POS before it is paid (6.1). After approval, Restro enters the round on a free virtual table of the guest's bar with the note "for Table 7", and closes it with the payment in one go. Then it captures.

**The payment queue (Martin: each bill must be processed down to its closing before a new bill goes on that virtual table; there are good practices for this).**
Agreed. The design follows the standard pattern for a multi-step process that crosses two outside systems, the POS and the provider. Each step is written down before and after it runs, and each step has a defined way to undo it (in the trade, a "saga" with compensations).
- **One queue per bar,** first in, first out. A worker takes the next payment when one of the bar's virtual tables is free.
- **One payment per virtual table** from the first move (or entry) to the close or the move back. The table is reserved with a lock that has a deadline (4.5).
- **Every step is recorded** (moved, confirmed, approved, closed, captured, moved back) before Restro goes on. If the server restarts mid-way, a recovery job reads the record and either finishes the payment or undoes it. A virtual table is never left in an unknown state.
- **Before using a virtual table,** Restro reads it and checks it is empty. A table that isn't empty is skipped and reported (9.11).
- **When all of a bar's virtual tables are busy,** the payment waits in the queue, and the payer sees "Preparing your bill…". After 60 seconds of waiting it stops: "Paying in the app is busy, try again in a minute or call a waiter". This replaces 8.5's immediate refusal. Every wait over 10 seconds is counted, so the Restro team knows when a bar needs more virtual tables.
- The queue runs on the job system the worker already has (pg-boss).

## Group 5: sections 9–11 go to three reviewers

Three independent agents (one Fable, two Opus) review sections 9 (failures), 10 (privacy and law) and 11 (the technical shape). They review them together with this round's changes. Each looks for problems, missed cases and improvements. Each files its own deliverable, and the lead merges them into one answer for Martin.

## The new to-do: the Mistral API checker

`2026-10-20-mistral-api-checker.md` lists every action Restro needs from Mistral and how each could be done, if at all.

## What this round changes, in one list

| Item | Change |
|---|---|
| 2.2, 5.7, 5.11, 9.3 | Connector **capabilities**: a setting shows only where the connector has it; no check at setup; "Awaiting approval" only with that capability |
| 3.2, 6.6 | No visible countdown and no payment token; lines being paid are greyed "Being paid"; invisible deadlines stay (2 min, then the provider's session) |
| 3.4 | "Open" = the table's current bill has at least one item (or the POS's own "open", if it has one) |
| 4.1 | "Bag" becomes **the table's order**; what Send puts in is a **round**; "Earlier order" |
| 4.2 | "Removed · Undo" only on the phone that removed it |
| 4.4 | "3 orders waiting" becomes "3 rounds queued to send" |
| 5.5 | At one bill per table: "the round goes onto the table's bill"; barsy detail in a footnote |
| 6.8 | Write to the POS only after the provider approves; capture after the POS confirms (a setting, where the provider has it) |
| 6.10, 8.1, 8.5 | Payment queue per bar; the guest confirms the bill as read back from the virtual table; waiting instead of an immediate refusal |
| 6.7 | The move takes the table's write turn; only the waiting runs side by side |
| 7.1, 7.4 | The knock folds into the reading |
| 7.3 | No "Your paid orders"; "Download receipt" after paying; 8.7 settled by research |
| 7.8 | Reading a table's bill with rows is a must-have for ordering on any POS |
| 2.10 | Records name real table, virtual table and bar; new question: one Mistral login per bar? |
| 8.10 | Group payment: ask both the POS and the provider |
