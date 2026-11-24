Made by: a lead's subagent (Opus), 11-24. Checked row by row against the decision files by a second Opus agent the same day, and corrected by the lead; the rows marked **(corrected 11-24)** said something the decisions do not. For: the lead and Martin, before answering Mistral Software's WebAPI questions. Read from `origin/or/foundation` as fetched on 11-24. The reply drafted from it: `2026-11-24-mistral-webapi-answers-bg.md`.

# Mistral's WebAPI questions, mapped to our decisions

Mistral Software sent questions about their WebAPI integration (`D:\Downloads\WebAPI-integration-questions.md`, in Bulgarian). They ask us to describe the expected sequence across a bill's whole life. This file takes each question, says whether a binding decision already answers it, and gives that answer. The only new decision made for it is D154, which answers 1.3 and 5.2.

**Numbering.** Their file has no numbers. The rows follow its sections and bullets in order: 3 + 3 + 8 + 6 + 6 = **26 questions**, not 27. Section 3's two "we also need to know" bullets are 3.7 and 3.8.

**"Bill" in their questions** (сметка) is what our GLOSSARY calls a **POS bill**. At the pilot it is the table's only POS bill (D122 §1), so the two coincide.

## Two framing points, checked

- **"Since payment will be done in your system" (section 4): true in part.**
  - The guest pays by card in Restro's page, through Stripe (D126). Stripe is the provider, the venue's own Stripe account is the merchant, and Restro never holds money (D125, D98).
  - The money is only half of it. The chosen lines are moved to a **payment table** in the POS (their "virtual table"). Restro then closes that payment table in the POS with a card payment type, and the POS prints the fiscal receipt (D122 §8, D127).
  - So the POS records the payment and closes the bill; Restro takes the card.
- **Who prints the fiscal receipt (section 5): the POS, on the venue's fiscal device.**
  - The binding text is D122 §8, "The venue issues it, not Restro", with D127. D151 settles a different point: carrying the paper from the till to the guest is the club's work, not Restro's.
  - What Restro needs back: the receipt number, read from the POS and never typed by staff, and the fiscal memory number, which it keeps on the payment record as dispute evidence (D127 4.5). Where the POS can issue an electronic receipt, Restro also needs the device's own file, or the POS sends it itself (D122 §8, D127).

## The questions

Status: **answered** (a firm decision says it), **partly** (it says part of it), **open** (no decision), **theirs** (only Mistral can answer it).

### 1. Tables and bills

| # | Their question | Our answer | Source | Status | Missing |
|---|---|---|---|---|---|
| 1.1 | Who can open a bill on a table: the guest, the waiter, or both? | Staff open a table **for phones** in Restro. That is not a POS bill. The first sent order then opens the POS bill through Restro's POS user, as a waiter would. This happens only where the POS lets outside apps put the first items on. Elsewhere the guest sees "Ask your waiter to put your first item on". A sent order never joins a bill from before the service day: it joins the oldest open POS bill of this service day. | D122 §4, D124 §2, D110; pay-first needs it too, D127 | answered | Theirs: can the WebAPI open a bill with the first items (10-21 Q40)? |
| 1.2 **(corrected 11-24)** | Can a table have several active bills at once? | Restro handles both. At the pilot Mistral keeps one bill per table, and Restro asks for a second **only** where the table's one open bill is from an earlier service day: it never adds to that bill and opens a new one for tonight (D124 §2). A guest paying part of the bill goes through a payment table, not a second bill. A guest sees one bill per table — or, where a hostess has linked tables into one party, that party's cumulative bill, totalled in Restro only, with no common POS bill (D139). | D122 §1, §3, D124 §2, D111, D139 | answered | Theirs: is one bill per table enforced (10-21 Q10)? If it is, a table carrying last night's bill cannot be ordered at until staff close it. |
| 1.3 **(corrected 11-24)** | Can bills be moved or merged between tables? | Restro itself moves **lines** to a payment table and back after a failure (`isolateLines`, `undoIsolate`). A whole bill moved to another real table: where the POS declares `moveBillToTable`, Restro asks for it from Tonight, in one call for the whole bill; where it does not, staff move it in the POS and Tonight holds a to-do until the reading shows it. The move is refused before any call when the destination already has an open bill of this service day, or a payment on either table is not final. Restro never merges two tables' bills, in either direction. | **D154 §1**, D137 (4.22), D139, D122 §8 | answered | Theirs: can the WebAPI move a whole bill to another table, and what does it refuse? |

### 2. Adding and editing items

| # | Their question | Our answer | Source | Status | Missing |
|---|---|---|---|---|---|
| 2.1 **(corrected 11-24)** | Who can add, edit and remove items? | Guests add and remove lines in the table's order freely before Send. Send only ever **adds** a sent order to the POS bill. Restro never edits or removes a POS row. The only write of this kind it may ask for is a **storno**: where the POS declares a storno capability, Restro asks for it as a waiter would, within the POS's own rules — the POS's own cancel document, not a row Restro deletes (D110 rule 7, D148; see 5.6). | D117, D116, D111, D110, D148 | answered | — |
| 2.2 | How are quantity and extra modifiers set? | The guest picks a quantity per line, and identical lines merge ("2 × Gin tonic"). Prices are the POS's own. Options and notes are offered only where they reach the bar ticket. Elsewhere there is no note field, and items with required options say "Order this from your waiter". | D117, D122 §4, D149 | answered | Theirs: how the WebAPI reads an item's options and carries them on a line (11-07 §9; 10-21 Q31). |
| 2.3 | Until when can a line be edited freely? | Until Send. From Send on, the guest cannot cancel; after that only a waiter changes it in the POS. | D116 | answered | — |

### 3. Confirming and sending to the bar or kitchen

| # | Their question | Our answer | Source | Status | Missing |
|---|---|---|---|---|---|
| 3.1 | Must a waiter approve a guest's items before they go out? | It is a venue setting, "Orders wait for the bar's approval". It is off by default and shown only where the POS supports approval and Restro can read approvals and declines back. Approval happens in the POS; Restro adds no step of its own. It covers on-the-bill orders only. | D116, D122 §3 | answered | Theirs: does the WebAPI have approval (`orderValidationType`, 11-07)? |
| 3.2 **(corrected 11-24)** | How is it ensured that someone is responsible and there is an active bill to charge? | Phones order to the bill only at a table staff have opened for phones, during its sitting. Where the venue keeps the location check on, they also need a location pass from that sitting (D118, D121). A cap per sent order (€150 by default) and a pace limit per table (six rounds per 15 minutes by default) apply, both venue settings. The order goes onto the table's open POS bill of this service day, or opens one only where the POS allows it. The table is responsible, as in the POS; Restro attributes nothing to a person. | D122 §4, D118, D121, D124 §2, D139 | answered | — |
| 3.3 | Are only new and changed lines sent, or the whole order? | Only the new sent order, as one round added to the table's bill. Restro never changes lines after Send, so nothing is resent. | D117, D115 | answered | — |
| 3.4 | Do we need to know that the bar or kitchen accepted the order? | Restro needs the **POS's** acceptance: a sent order is Added only once the POS has it. With approval on, it is Added once the bar approves, read back from the POS. Restro tracks no delivery stages; the POS prints the ticket at the table's bar. | D116, D112, D122 §1 | answered | Theirs: does an API order print at the bar like a waiter's (11-07, "Does an order sent through the API reach the bar?")? |
| 3.5 **(corrected 11-24)** | What happens on a technical error or no confirmation: retry, manual, or cancel? | Restro reads the bill just before sending. After a timeout it reads the bill back for about a minute and matches the new lines; it **never resends**. A clear "no" means Not sent: the lines return to the order with Try again. Still unknown means Unconfirmed: the guest shows a reference to the waiter, staff are alerted and the table pauses. **Restro never cancels a sent order** (the storno of 5.6 is a different thing). Repeated failures pause the connection or the venue. | D115, D132, D116, D120, D122 §4, §6 | answered | Theirs: is a request all-or-nothing, and can a line land after we gave up (11-07)? |
| 3.6 | How is changing or cancelling an item already sent to the bar handled? | No cancel in Restro after Send. Changes and cancellations are a waiter's, in the POS, under its rules; Restro reads the result. A paid line that can't be served: staff mark it undeliverable and Restro refunds (see 5.6). | D116, D111, D148 | answered | — |
| 3.7 | How are simultaneous changes by a guest and a waiter resolved? | Restro never edits POS rows, so a waiter's change is simply read. On Restro's side the table's order is shared, guarded by server locks, with one sent order in flight per table. Before each guest action on the bill — opening it, paying — Restro knocks on the POS and checks it is unchanged ("your bill changed"). If the POS says a bill was just closed or locked, Restro reads the table again. | D111 (the knock), D121, D115, D117 | answered | Theirs: can staff and the API work on the same bill at once (11-07)? |
| 3.8 | How is the same item kept from being added or sent twice on a repeated request? | Every guest action carries an id, and a repeat gets the first answer. A timed-out round or new-bill open is read back, never resent. A Send matching one in the last 15 minutes asks the guest first (D117 calls the 15 minutes a starting value). Where the POS offers it, Restro puts its own reference on each line, and a repeat creates nothing. | D121, D115, D132, D117, D122 §3 | answered | Theirs: the `ExtId` 409 details, and whether a line can carry our reference (11-07). |

### 4. Settling and paying

| # | Their question | Our answer | Source | Status | Missing |
|---|---|---|---|---|---|
| 4.1 | How does our system request the start of a payment? | The POS doesn't start it; the guest does, on the phone. The order of steps: <br>1. The guest picks lines from a fresh reading. <br>2. Stripe holds the card. <br>3. Restro moves the lines to a payment table of the table's bar and reads it back. <br>4. Restro closes it in the POS with a card payment. <br>5. Restro captures. <br>There is one queue per bar and one payment per payment table at a time. | D122 §8, D127 (3.1), D126 | answered | — |
| 4.2 **(corrected 11-24)** | Is the bill locked while a payment is in progress? | **In the POS, Restro locks nothing.** The lines sit on a payment table only Restro uses, and Restro reads it once more before closing. An extra line, a missing line or an earlier close means the hold is released, the lines go back and staff are alerted. In Restro the bill is not locked to guests, but lines under a payment show as being paid to the other phones, with no payer, amount or timer. | D117, D122 §8, D127 (3.11) | answered | How many payments may be open at one table is stated twice and differently: D112 ("one payment at a time per bag and per bill") and D127 5.2 ("per table: three open payments"). Nothing reconciles them; the letter avoids the number. |
| 4.3 | How do we receive the result: success, declined, interrupted, timed out? | By our design the POS gets no status messages; it sees only Restro's writes. On success, the close with a card payment. If the card is declined, abandoned or times out before the move, nothing reaches the POS. If it fails after the move, the lines are moved back. Once a close was attempted, Restro never undoes it. | D122 §8, D127 (3.10), D117 (our design, not a decision of its own) | answered | — |
| 4.4 **(corrected 11-24)** | Are part payment, paying by items, or several payers allowed? | **Offered:** paying the lines the guest ticks, each payment closing a payment table with its own fiscal receipt and leaving the rest of the table's bill owed; part of a line's quantity where the POS can move it; several payers one after another, anyone at the table paying any lines they tick (Restro attributes no line to a person, D117, D139). **Not offered:** paying an *amount* against a bill that stays open — the part payment of Н-18 чл. 26а — until the POS's receipt behaviour and that form are confirmed; several cards closing one bill together (later). With a whole-bill discount, the guest is told "Ask your waiter to split this bill". | D112, D122 §8, D127, D117, D139 | partly | The "no" to an amount part payment is conditional. Theirs: what document the POS issues for a чл. 26а part payment, and what a moved line does to a whole-bill discount (10-21 Q37). |
| 4.5 | Which system decides that the bill is fully paid? | The POS. Restro keeps no bill of its own. A bill is paid when the POS closes it with the fiscal receipt, and Restro captures only on proof of that close. | D111, D127 (3.10), D122 §6 | answered | — |
| 4.6 | What if the payment succeeds but the confirmation to our system is not delivered? | The card is only held until the POS close is proven. A lost close answer is read back, never guessed. Restro captures on a done answer, on the POS's "already done", or on a closed bill carrying Restro's reference or a receipt number. An empty payment table alone is no proof. Otherwise it keeps the hold as "Payment unconfirmed" and a manager or owner answers "Receipt printed" / "No receipt". | D127 (3.5, 3.10), D122 §7, §8 | answered | Theirs: can the close carry our reference, refuse a repeat, and be read back (11-07)? |

### 5. Documents and final close

| # | Their question | Our answer | Source | Status | Missing |
|---|---|---|---|---|---|
| 5.1 | Which system creates and prints the payment or fiscal document? | The POS, on the venue's fiscal device. Restro never draws a receipt; its "Payment confirmation" is marked as not a receipt. How the paper reaches the guest is the club's. | D122 §8, D127, D151 | answered | Theirs: which device prints for a payment table (10-21 Q17). |
| 5.2 **(corrected 11-24)** | What data must we be given to issue it? | The lines are already on the payment table at the POS's own prices. On top, D154 §2 fixes the payload: a card payment type (a separate "Card online" type counted as card is allowed); the amount as the POS's own line amounts plus the tip where `recordTipOnClose` is declared; **Restro's own reference always, where the POS keeps a field for it and returns it on a read** (D127 3.10's third proof of a close); a short human-readable note — the real table's name and "Restro" — only where the POS shows or prints it; the guest's email only under `electronicReceipt`. **Never sent:** the provider's payment id, anything about the card, the guest's name, phone or handle, or which phone paid. | **D154 §2**, D122 §8, D127 (3.2, 3.10) | answered | The tip's own route still waits on Mistral (D127 Open). |
| 5.3 **(corrected 11-24)** | How do we receive the number, the status and an electronic copy of the document? | Restro reads the **receipt number** from the POS; staff never type it. The **fiscal memory number** is kept on the payment record as dispute evidence, so the API must return it too. The electronic copy is the device's own file: the POS sends it, or returns it and Restro sends it unchanged through its own email service. | D122 §8, D127 (4.5 for storing the two numbers; the electronic-receipt section for the copy) | theirs | Our need is fixed; how the WebAPI returns them is Mistral's (11-07 §5; 10-21 Q25, Q39). |
| 5.4 | When is the bill considered finally closed? | When the POS closes it with the fiscal receipt. For Restro, "closed" means a complete reading shows the bill gone or empty; a reading with one failed page concludes nothing. | D111, D122 §4, §6 | answered | Theirs: is an emptied bill closed, or still open (10-21 Q30)? |
| 5.5 | How is it ensured that lines and amounts can't change after a payment starts or a document is issued? | Before the close: the lines sit on a payment table only Restro uses, and Restro reads it once more. It closes only if it holds exactly the confirmed lines. The payment owns that payment table until it is final and the table reads empty. After the receipt, a change is a storno in the POS. | D122 §8 (the last check), D127 (3.10, 3.11) | answered | Theirs: can a payment table be kept from waiters' edits, and is a closed bill read-only? |
| 5.6 **(corrected 11-24)** | How are a storno, a refund and a correction after closing handled? | Refund: staff mark a paid line undeliverable and confirm, and Restro sends the money back through Stripe — only a payment Restro itself captured, once per line, for the amount the POS closed that line for. Tips are untouched, and a whole-payment refund stays in the venue's Stripe dashboard, which Restro reads. Storno: where the POS declares a storno capability, Restro asks for it as a waiter would, before any money moves. Elsewhere staff get a "Make the storno in the POS now" to-do until "Storno done". Other corrections after a close stay the venue's, in the POS and its dashboard (D154). | D148, D122 §8, D132, D154 | partly | Open for the accountant and the lawyer (D148, #52): must the storno come before the refund, and may Restro's POS user issue a storno through an API? |

## Open points

Three of the five are now settled by **D154** (the lead, 11-24), which was written to answer them.

1. ~~**The bill move (1.3).**~~ **Settled: D154 §1.** Restro asks the POS to move the bill from Tonight where the POS declares it, with a staff to-do as the fallback — the opposite of this file's first recommendation. The reason is the end-of-night mismatch list: Restro's sent orders point at the old table, so a bill it did not move, and was not told about, reads as a settled bill plus a stranger's.
2. ~~**What the close carries (5.2).**~~ **Settled: D154 §2.** Our reference always where the POS has a field for it; the table's name as a note where the POS prints it; the provider's payment id never sent.
3. **Storno before refund, and a storno through the API (5.6).** Still open. This is fiscal law, open in D148 and #52. Mistral is asked anyway whether the WebAPI can storno a paid line, so the capability is known when the law answer comes.
4. ~~**Corrections after close other than an undeliverable line (5.6).**~~ **Settled: D154**, "What this does not decide": they stay the venue's, in the POS and its provider dashboard, until a real case appears.
5. **Not among their questions, but part of any reply:**
   - D150: no POS is connected before it is tested in a test environment, and that includes the pilot club. A test installation is part of what we ask them for.
   - Authorisation under Н-18 чл. 52з, ал. 5 (10-21 Q21) is still unanswered, and is asked of them.

**One conflict found while checking, not about their questions:** how many payments may be open at one table is stated twice and differently — D112 ("one payment at a time per bag and per bill") and D127 5.2 ("per table: three open payments"). Filed as [#517](https://github.com/MartinKostadinov04/restro/issues/517); the letter avoids the number.

## What we already sent them (the 11-07 letter), and where it now needs care

The 11-07 letter (`2026-11-07-mistral-what-we-need-from-the-api.md`, with its `-bg` twin) was written against the documented Zamboo api v1. Their questions now name a "WebAPI", which may be the second interface the letter asks about.

**Where the letter already covers a question:**

| Question | Covered in the 11-07 letter |
|---|---|
| 1.1, 3.7 | "Can staff and the API work on the same bill?"; §3 (opening a bill with the first lines) |
| 1.2, 5.3 | §5 (several bills behind one table; what the close returns) |
| 1.3, 4.4 | §6 (splitting; "merging and moving stay the staff's work") |
| 2.2 | §9 (options); "Does an order sent through the API reach the bar?" (options and notes on the ticket) |
| 3.1 | `orderValidationType` as approval at the bar |
| 3.2 | §1 (tables and bars), §2 (the opening time, never yesterday's bill) |
| 3.3 | §3 (adding lines to an open bill) |
| 3.4 | "Does an order sent through the API reach the bar?" |
| 3.5, 3.8, 4.6 | "Is an order all-or-nothing…"; "Can anything be paid twice…" (`ExtId`, a reference on the close); "What happens when the fiscal device fails mid-close?" |
| 4.1, 4.5, 5.1, 5.4 | §5 (closing with a payment and a fiscal receipt) |
| 5.2 | the tip question; the electronic receipt question |
| 3.6, 5.6 | §7 (refusing a line), **but see below** |

The letter does not cover 2.1, 2.3, 4.2, 4.3 or 5.5.

**Two places where the letter is now out of date, and the reply corrects both:**

- **§7's last sentence:** "Storno on a closed bill and giving money back stay the work of staff at the till — we want only to read that it happened, never to do it."
  - D148 (11-18) reverses the refund half. Restro now refunds a paid line staff mark undeliverable, and asks for a storno itself where the POS declares one.
- **§7's "It has to be cancelled without a waiter deleting lines by hand"** can be read as Restro cancelling lines through the API.
  - D116 says Restro never removes a POS row. The refusal we meant is staff's, made in the POS with a reason, and Restro reads it.

Everything else in the letter agrees with the answers above. That covers: never adding to yesterday's bill, telling our lines from the waiter's, never telling a guest "paid" before the POS returns a receipt reference, and splitting being the guest's need.
