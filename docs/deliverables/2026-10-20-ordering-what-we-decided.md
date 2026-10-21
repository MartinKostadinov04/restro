# Ordering from the menu: what we decided, in the order it happens

Made by: the lead session (Opus), 10-20, for Martin. For: Martin's ordered check of map #29 "Ordering from the menu", and every agent who builds it.

It joins D110–D121 and the six grilling logs (#35–#40) into one story, in the order the feature is set up and used. It adds no decision of its own. Where the two facts Martin brought on 10-20 change something, the item says so and gives a proposal. No D-file changes until Martin confirms.

Sources:
- the decisions D41, D72, D102, D107, D110–D121;
- the grilling logs `2026-10-18-bill-decision-log.md` (#35), `2026-10-18-table-visit-decision-log.md` (#36), `2026-10-19-order-life-decision-log.md` (#37), `2026-10-19-fake-orders-decision-log.md` (#38), `2026-10-20-failure-pause-decision-log.md` (#39) and `2026-10-20-guest-api-decision-log.md` (#40);
- `2026-10-18-how-bills-work.md`, and the Mistral/Zamboo section of `2026-10-18-bill-in-pos-systems.md`;
- the questions for Mistral in `2026-10-17-pos-integration-requirements.md`, and `docs/connector-questions.md` (C1–C53);
- #33's reading of the NRA list.

## How to read it

- The items are numbered in the order of the feature. Check them one by one.
- The brackets name where the binding text is, e.g. (D115).
- Every item is **firm** unless it says **later**, **on request**, **out** or **open**.
- Four tags mark what the 10-20 facts do:
  - **CONFIRMED**: the fact supports the decision as written.
  - **CHANGED**: the decision needs an adjustment at a POS like the pilot's. The proposal follows and needs Martin's yes.
  - **NEW**: something no decision covers yet. It is a proposal and needs Martin's yes.
  - **QUESTION**: an unknown that only Mistral Software, Lukanet or the pilot venue can answer. Section 15 collects them.

## 0. The two facts of 10-20, and what they do

**Fact 1: the pilot club runs Mistral, with one bill per table.**
- The guests at a table share one bill that grows during their stay.
- Mistral has exactly one bill per table.
- When someone wants to pay part, staff move that part to a free "virtual" table, take the payment and close that bill there.
- Restro will do the same: virtual tables settle part payments and paid-first items.

**Fact 2: every bar prints its own tickets.**
- A club has several bars, and each table belongs to one bar.
- When a waiter enters an order, it goes on the bill and a ticket prints at that table's bar.
- The bar hands the drinks to the waiter for the table and throws the ticket away.

**What they do, in five lines:**
1. **The platform's design holds.** The platform only says "put this order on this table's bill", and each connector does it the safest way its POS allows (D115). The guests' "one bill per table" (D111) is exactly what Mistral has.
2. **Paying changes at Mistral.** A pay-first order and "pay for your own items" both go through Restro's own virtual tables, not a second bill on the table (6.10, 8.1).
3. **The tickets confirm three decisions:** never resend a round (5.6), no cancelling after Send (5.10) and no delivery stages (5.12). They also give "Added to your bill" a concrete meaning: the bar has the ticket (5.8).
4. **One new problem.** A pay-first round on a virtual table may print at the wrong bar, with a table number no waiter knows (6.10).
5. **The largest effect is on the plan, not on any decision.** Mistral has no public API found (T69), and its connector is parked (D79, CLAUDE.md). So nothing in this feature works at the pilot until Mistral Software answers, not even the pilot's menu from its POS. The barsy items (#47, the Lukanet questions) leave the critical path. Section 13 sets this out by degree.

## 1. The ground rules

**1.1 Restro writes into a POS only as a waiter would (D110, D41).**
- Allowed: open a bill, add a round, split or move a bill, take a payment, ask for the bill or a receipt, cancel within the POS's own rules.
- Never back-office work.
- Menu sync stays read-only. No webhooks, no POS registration.
- Tests never run against a live venue's POS.
- **CONFIRMED:** moving part of a bill to a virtual table is what the pilot's waiters already do, so Restro doing it stays inside D110.

**1.2 A POS bill** is one bill as the POS holds it: the items owed plus the payments made. It stays open until settled and closes with a fiscal receipt (D111).

**1.3** The POS is the only truth. Restro never keeps a bill of its own (D111).

**1.4 How bills relate to tables (D111).**
- A table can hold several open POS bills.
- The table is an optional label on a bill, and a POS bill can have no table.
- **CHANGED (as a fact, not a rule):** at the pilot's Mistral, a table has exactly one bill. The rule stays POS-neutral; for the Mistral connector the "several" is always one.

**1.5 A bill, as the guests see it,** is every open POS bill on the table: what is owed, plus anything already paid against them. Closed POS bills drop off. There is one bill per table (D111, D115).
- **CONFIRMED:** Mistral's one bill that grows during the stay is exactly this.

**1.6 There is no visit (D115, D45).**
- Nothing happens at 07:00. The service day stamps each order but doesn't cut the bill.
- A new group sees whatever the POS still has open on the table. A bill left open overnight is staff's to close.

**1.7** Waiters keep every power they had. What they do in the POS is what the bill shows (D111).

**1.8 Where orders come from (D111, D115).**
- Every guest order comes through a table code. There is no ordering without one.
- There is no ordering from the bar: table codes go on tables only.

**1.9** The platform only says "put this order on this table's bill"; each connector does it the safest way its POS allows (D115). This is why the Mistral facts change the connector and the paying steps, not the guest's experience.

**1.10 What Restro keeps (D111, D83).**
- Its own orders: items, quantities, the price shown, the time, the table, and the POS bill each went onto.
- Its own payments, once paying exists: amount, what it paid for, the provider's reference, the receipt reference.
- Rounds a waiter enters and payments taken at the bar are not kept; Restro sees them only in a reading.
- **How long:** orders and payments 18 months, then only totals. No phone, device or IP identifier stays past the service day.
- **Purge:** a venue purge erases them; fee records are kept apart and survive.
- The venue's POS keeps the sale 5 years (Н-18). The payment provider keeps the card record.
- **NEW:** a payment record also names the virtual table it used. The venue's own reports will show sales on, say, table "QR-3", and Restro's records lead back to table 7. This shows on admin screens only (rule 3).

**1.11 Payment mode (D113, D29).**
- Each item is **on the bill** or **pay first**: a venue default, plus an override per item, next to D29's ordering mode.
- Each table has one switch, **"Disable prepayments"**, off by default. When it is on, everything at that table goes on the bill.
- The rule lives only in Restro; the POS sees only POS bills and payments.
- Until paying in the app exists, pay-first items show "ask your waiter".

**1.12 Prices.**
- Prices that change within the night (happy hour) are **on request** (D111).
- A changed price never refuses an order (D116), but it refuses a payment once (D117).

## 2. Setting up a venue for ordering

What the owner and the Restro team set before the first night. Every screen follows D107: plain words, undo, few taps.

**2.1 Restro's POS user.** Restro gets its own POS user per connection per environment (rule 9). On barsy it also gets its own cash desk.
- **QUESTION (Mistral):** what Mistral needs instead (C5, C6, C8, C9).

**2.2 "Orders wait for the bar's approval" (D116).**
- A venue setting, off by default.
- Shown only where the POS lets the bar approve and Restro can read the approval back.
- At setup Restro checks the POS's mode matches the setting and warns the owner if it doesn't.
- **QUESTION (Mistral, tickets):** does Mistral have approval, and does the ticket print before or after it (C53)?

**2.3 The settings box "Ordering on the bill" (D118, D121).**
- Shown:
  - "Only at tables a waiter has opened": on.
  - "Largest round on the bill without paying first": €150, or off.
  - The venue's spot: one tap, or a pin.
- Under **"More"**:
  - "Check guests are in the venue": on. Switching it off shows "Anyone with a photo of a table code could order onto that table's bill".
  - "How far from the spot counts as inside": 150 m, from 100 to 500 m.
  - "Most rounds per table in 15 minutes": 6, from 3 to 20, or off.
  - "Check location again after": 2 hours, from 30 minutes to 6 hours.
- There are no separate settings per area.

**2.4 Payment settings (D112, D117).** The minimum card payment (venue-wide), and the unfinished-payment time (10 minutes by default).

**2.5 Bag settings (D117).** The idle time before a bag moves aside (30 minutes), and how many earlier bags are kept (1).

**2.6 The opening time (D120).** A new venue setting; the pre-opening check runs 2 hours before it.

**2.7 Alerts (D120).**
- The venue ticks which staff accounts get push alerts.
- Whose phone that is at night is the pilot venue's answer: **open** (Q69).

**2.8 NEW (Mistral): Restro's virtual tables.**
- The proposal: the venue sets up in Mistral a few tables reserved for Restro, such as "QR-1" to "QR-4" per bar, which waiters never use.
- In Restro they are listed under Tables & QR as "tables for payments". They have no QR code and no menu, are never shown to a guest, and each is linked to its bar.
- **Why:** the waiters already take "some random available table". If Restro picked one the same way, a waiter and Restro could take the same table in the same minute, and a guest's payment would close a stranger's items.
- **How many:** as many as payments can run at once at that bar. Start with 4 per bar, and check that number against the pilot's busiest night.
- **QUESTION (venue):** how many bars there are, which tables belong to which, and which virtual tables staff use today.

**2.9 NEW:** the pre-opening check (D120) also checks that each of Restro's virtual tables exists and has no open bill. A virtual table found with a bill is an alert that names it.

**2.10 NEW (tickets): which bar serves each table.**
- On-the-bill rounds don't need Restro to know this, because the POS routes the ticket.
- Only the virtual tables need it (2.8). So Restro stores "this table is served by bar X" only at a venue whose connector pays through virtual tables. It is read from the POS if the API gives it, otherwise set at setup.
- **QUESTION (Mistral):** can the API tell which bar a table belongs to?

## 3. A guest arrives at the table

**3.1 The guest page (D102, D121).**
- The guest scans the table code and the guest page opens. It is static files on the CDN, so the menu never goes down.
- The table code travels in a request header: never in the address or a log, and never stored with a bag, an order or a payment.
- The database's single guest lookup turns the code into its venue and tenant. It is the one pinned exception in the RLS guard test, which Martin agreed to.
- A code the venue retired stops working at once: "This table code is no longer in use".

**3.2 What a phone sees (D121, D111, rule 3).**
- The table's label, and whether ordering is on, paused or limited.
- The shared bag, with its notes, and the earlier bags.
- Payment countdowns, without saying who is paying.
- The bill as the last reading shows it, with its age:
  - rounds are marked guest or staff;
  - each line shows the item's name in Restro, its quantity, its total and whether it is paid;
  - a POS row Restro can't match shows "Other item".
- Never: other tables; who added, sent or paid anything; a phone's or a network's identity; waiter names; POS bill numbers or ids; internal names; cost prices.
- "Who ordered what" is not shown: **later**, as an improvement (D111).
- **NEW:** never a virtual table's name either.

**3.3 How often a phone asks (D121).**
- Every 2 seconds on the bag and bill screens, every 10 seconds on the menu.
- Every 2 seconds on any screen while the table has an order on its way or a payment counting down.
- Never while the page is hidden; at once when it shows again. No slow-down for an idle phone.
- Failed requests retry after 4, 8 and 16 seconds, then every 30.
- The server can slow every phone when Restro is under load.
- Push instead of polling: **later**.

**3.4 The open-table rule (D118).**
- An on-the-bill order is accepted only when a waiter has opened the table in the POS.
- On an empty table: the menu shows, pay-first items order as normal, and on-the-bill items say "Ask your waiter to open your table".
- **CONFIRMED (Mistral):** "open" means the table has its one bill.
- **CHANGED (small):** on barsy a pay-first order on an empty table opens its own POS bill there. On Mistral it goes onto a virtual table instead (6.10), so Restro never opens a real table's bill at the pilot.

**3.5 The consent screen (D119, D121).**
- It shows at the first change of an on-the-bill item, once per phone per service day, even if the browser already allows location.
- A browser block counts as a refusal.
- The text: "**[Venue] and Restro check your location so nobody outside can order onto your table's bill.** Never stored. You can stop anytime, or pay first or call a waiter. [Privacy]" with **[Allow]** / [Not now].
- "Stop location check" sits in the "Why?" line and on the bill.
- After a refusal, the phone isn't asked again that service day.

**3.6 The location check (D118, D121).**
- It runs on every action that changes or sends on-the-bill items, at a venue with the check on.
- It passes when the phone's circle of doubt touches the venue's circle (150 m).
- A phone circle wider than about 1 km counts as "can't check".
- It fails closed after about 10 seconds, offering **Call a waiter** (the larger button) and **Cancel**, plus a "Why?" line.
- The server checks the position in memory and drops it. It is never written, logged or sent to error reporting.
- Location adds to the other guards; it replaces none.

**3.7 The location pass (D121).**
- After a passed check, that phone's on-the-bill actions at that table need no new check for 2 hours.
- The phone holds the pass as a sealed note; Restro keeps no copy and no phone identity.
- Another table needs a new check, and a pass never lasts past the service day.
- The accepted cost: a guest who left could keep ordering onto their own table for up to 2 hours.

**3.8** Paying and pay-first items are never located. A guest who refuses location can still add, change and pay pay-first items, and call a waiter (D118, D121).

**3.9** Each on-the-bill order records "location check passed, consent text vN", with no coordinates and no phone identifier (D119).

**3.10 The field test.** Martin ran it on 10-19: decent accuracy inside, so the defaults stand.
- **Open:** whether Safari asks for location again within one night (`docs/open-items.md`).

## 4. The table's shared bag

**4.1** There is one bag per table, kept on Restro's server; every phone opened from the table code sees and edits the same bag. The bag is what the table is preparing to order; the bill is what it ordered (D117).

**4.2 Lines in the bag (D117, D121).**
- No line remembers who added it: **out**.
- Anyone may remove any line, and the bag shows "Removed · Undo" for a few seconds.
- Identical lines merge ("2 × Gin tonic").
- Every phone sees the notes on lines. How long notes are kept on stored orders: **open**, on the privacy list.

**4.3 Edits (D117, D121).**
- Edits show on the phone at once.
- The server applies them in arrival order, each taking about a hundredth of a second, and every phone sees the change within 2–3 seconds.
- No lock is held while a guest edits.
- If the server refuses an edit, a one-line message appears and the number goes back.

**4.4 Limits (D117, D121).**
- 50 lines, a quantity of 50, and 3 orders waiting.
- 60 bag changes a minute per table. Above that the phones see "Slow down a moment"; the trip goes into the Log and alerts the Restro team.

**4.5 Locks (D117).**
- Every action where several people act on one thing is guarded by a lock on Restro's server, with a deadline.
- No phone ever holds a lock, so a dead phone or a crashed server never leaves a table stuck.
- Countdowns come from the server's "seconds left"; phones never use their own clock.

**4.6 How long a bag lives (D117, D121).**
- It ends when it is sent or emptied.
- After 30 minutes idle (every edit and Send restarts the clock), it moves aside as **"Earlier bag · Restore"**, seen by every phone, until all the table's POS bills close. Then it is deleted. The venue keeps 1 earlier bag.
- When all the table's POS bills close, the bag and its earlier bags are cleared.
- It also ends at the end of the service day, and when a new table code is made.
- There is no "this bag clears in 5 minutes" warning.
- The cost: about 200 KB and 6,000–12,000 writes a night for 50 tables.
- **CONFIRMED (Mistral):** "all the table's POS bills close" means its one bill closes.

**4.7** Pranks with a real table code that change pay-first lines are accepted for the pilot and counted. A PIN or expiring codes are **on request** (D121, D118).

## 5. Sending an on-the-bill order

**5.1 Send (D117, D121).**
- The button says "Send 5 items".
- Send moves the on-the-bill lines out of the bag into one order at once; pay-first lines stay in the bag.
- Two Sends at once make one order.
- Send names the lines it saw. It is refused with "Your table's bag changed" only if one of those lines changed in the second before.

**5.2 The duplicate warning (D117).**
- A Send whose items and quantities match one of the table's orders in the last 15 minutes first asks: "Your table ordered the same 4 minutes ago. Send again?"
- The question closes itself after 60 seconds. The same applies to a Pay.
- **CONFIRMED (tickets):** a double order is a double ticket and double drinks.

**5.3 Checks before anything reaches the POS (D116, D118, D119, D121).** Each failed check makes the order **Not sent** with its reason, and the lines stay in the bag:
- an item sold out or no longer orderable;
- ordering paused;
- a code no longer in use;
- the table not open;
- the round above the cap (€150);
- the pace limit (6 rounds per 15 minutes);
- the location check;
- Turnstile, at Send only, in managed mode. It fails open only when Cloudflare itself can't answer, and each such case is counted.

A changed price doesn't refuse an order.

**5.4 One order in flight per table (D115, D117).**
- A second Send waits as "Sending…" until the first ends.
- If the first ends Unconfirmed, the table pauses and the waiting orders become Not sent, with their lines back in the bag.

**5.5 Where the round goes (D115).**
- It goes onto the table's oldest open POS bill, like a waiter's round.
- "Closed" or "locked" is a definite "no": Restro reads again and uses the next open bill, or opens a new one.
- A new POS bill, stamped with Restro's code, opens only when none is open. If no answer comes, that request is resent unchanged for about a minute; barsy refuses the repeat.
- **CHANGED (Mistral):** the table has one bill, so the oldest is always that bill. The rule stays for barsy.
- **QUESTION (Mistral):** how it refuses a round (closed, locked), and whether a round sent to a table with no bill opens one.

**5.6 A timeout is read back, never resent (D115).**
- For about a minute Restro reads the table's open POS bills for rows entered by its own POS user after the order went out.
- Found → Added. Missing → Unconfirmed.
- **CONFIRMED (tickets), and stronger:** a resent round prints a second ticket, and the bar makes the drinks twice.
- **QUESTION (Mistral), critical:** the read-back needs Mistral to say who entered each row and when (C23, C52). It is not yet proven even on barsy (#47). If Mistral can't say, choose before building:
  - (a) use Mistral's own guard against duplicates on rounds, if it has one (C20, C21);
  - (b) otherwise a timed-out round becomes Unconfirmed at once, with "Show this to your waiter".

**5.7 The states of an order and what the guest sees (D116, D121).**

| State | Meaning | The guest sees |
|---|---|---|
| Waiting | stored and checked, waiting for the table's turn | "Sending…" |
| Sending | on its way to the POS | "Sending…" |
| Checking | no answer: a round is read back, a new stamped POS bill is resent unchanged, about a minute | "Sending…" |
| Awaiting approval | only with approval on: the POS has it, the bar hasn't approved | "Waiting for the bar to confirm…" |
| Added | the POS has it | "Added to your bill" |
| Not sent | certainly not in the POS | "We couldn't send your order, please call a waiter" with **Try again**; or, after a decline, "The bar couldn't take your order, please call a waiter" |
| Unconfirmed | still unknown after the minute | the same words, with no Try again, a short reference and a "Show this to your waiter" panel; staff are alerted |

- Only the phone that sent the order sees its progress. The other phones see the lines leave the bag and the round appear on the bill.
- An Unconfirmed reference stays on the sending phone until the guest closes it.
- "Sending…" has no countdown; the template may say "up to 1½ min".

**5.8 Added means the POS has the order (D116).**
- **CONFIRMED + NEW meaning (tickets):** at the pilot, the moment the POS has the order a ticket prints at the table's bar. So "Added" means "the bar has your ticket".
- The proposal: keep the words "Added to your bill". They are true and promise no time.

**5.9** Right after Added the platform reads the table again, so every phone sees the round within seconds. There is no "my orders" list (D116).

**5.10 No cancelling after Send (D116).**
- Before Send the bag is freely editable.
- After Added only a waiter takes something off, in the POS. Restro never removes a row: **later** (C48).
- **CONFIRMED (tickets):** the ticket is already printed and the bar is pouring.

**5.11 Approval at the bar, when the venue switches it on (D116).**
- The seventh state, Awaiting approval: "Waiting for the bar to confirm…", then "Added to your bill".
- A decline shows "The bar couldn't take your order, please call a waiter", and the lines return to the bag.
- On the bill the round shows "waiting for the bar" and can't be paid.
- Restro sets no time limit, and an order awaiting approval doesn't hold the table's turn.
- Approval covers on-the-bill orders only; pay-first goes straight in.
- The venue is committed at Added, or at approval when it is on. Restro adds no confirmation step of its own (supersedes D13).
- How approval and decline read back, and whether approval is per bill or per round, is worked out per connector: **open** (C53).
- **QUESTION (tickets):** if a POS prints the ticket at entry, before approval, the bar is already making the drink. Approval would then mean nothing there, and the setting stays hidden for that POS.

**5.12 No delivery stages** such as "being prepared" or "on its way": **out** (D112).
- **CONFIRMED (tickets):** the bar throws the ticket away when the waiter takes the drinks, and no POS records "served", so there is nothing Restro could show.

**5.13 Who brings it.** The waiter takes it from the bar like any ticket; staff learn of orders inside the POS (D18).
- **NEW check:** the ticket must show the real table, and that it came from Restro (through Restro's POS user, named for example "QR"), so the bar knows where it goes.
- **QUESTION (Mistral):** what a ticket prints (table, operator, a note) and in which language. This is the map's open bar-ticket item (Q52, Q70).
- The ticket prints the POS's own item names, not Restro's renamed text (D87), while the guest's "Show this to your waiter" panel shows Restro's names.
- **Open, for Martin:** should the panel also show the POS's name, in small type, when Restro renamed an item? The recommendation is yes, only where the POS name is a public name and not an internal one (rule 3, D75).

**5.14** Late landings: Restro stops checking once an order is Unconfirmed, and late landings are **out** (D112, D116).

## 6. Pay-first items

**6.1** Pay-first lines stay in the bag, marked "not ordered until paid", until someone pays. Nothing pay-first reaches the POS before it is paid, and anyone at the table may pay (D117, D112).

**6.2** After Send, the "Added to your bill" screen says "2 items are not ordered until paid", with "Pay 24 лв". A bag of only pay-first lines shows "Pay X and order" (D117).

**6.3** One payment covers the ticked selection, with all pay-first lines ticked by default. The Pay button beside a line opens the payment with that line ticked (D117).

**6.4 At Pay, every ticked line is checked again (D117).**
- A sold-out line can't be ticked.
- A changed price refuses the payment once: "The menu changed, check your bag".

**6.5 The minimum card payment (D117).**
- Below the venue's minimum, the payment screen shows "Add 4 лв more to pay by card", with a few pay-first suggestions.
- Which items are suggested and how it looks: **open** (#45).

**6.6 The payment countdown (D117).**
- Paying is a visible countdown lock. Every phone shows "Someone at your table is paying · 1:42", with those lines greyed.
- There are 2 minutes to reach the bank's page, then the unfinished-payment time, with no extension.
- Only the paying phone can cancel ("Pay later"). It carries a random token for the payment's lifetime only.
- If time runs out before the bank's page opens: "Your time ran out. Nothing was charged.", with "Pay again".
- After the bank's page has opened: "Checking…", and no retry.

**6.7** Paying doesn't wait for the table's order turn, so a Send and a Pay can run at the same time. A payment from the bag and a payment of the bill run side by side, one of each at a time (D117).

**6.8 Hold, write, capture (D112).**
- Restro holds the money, writes to the POS, and captures only after the POS's yes. A POS refusal releases the hold.
- With a provider that can't hold, Restro refunds automatically only on a clear "no", never after a timeout.
- The server finishes each payment from the provider's notice. A payment left unfinished is dropped after about 10 minutes.

**6.9 What the guest sees (D117, D112).**
- "Paying…", then "Paid. Your receipt is at the bar". The bar makes the drink from its POS ticket.
- A decline offers **Try again**, **Pay later** or **Call a waiter**.
- When it can't be told yet: about 60 seconds of "Checking…" with no retry, then "Please call a waiter" with a reference.

**6.10 Where a pay-first order goes in the POS.**
- **As decided (barsy):** its own POS bill, labelled with the table, opened, paid and closed in one call (D112, D115).
- **CHANGED (Mistral):** a table has one bill, so a pay-first order can't be a second bill on it. The proposal: it goes onto one of Restro's virtual tables (2.8), where it is opened, paid and closed; then the virtual table is free again.
- **NEW problem (tickets):** the ticket prints at the virtual table's bar and shows the virtual table's number. The bar may be the wrong one, and no waiter knows where to take the drink. Three ways out:
  - **(a) Recommended:** Restro's virtual tables are per bar. Restro uses one that belongs to the guest's bar, and writes "for Table 7 · QR K7Q" on the order, if Mistral prints a note on the ticket. The right bar prints it, and the waiter reads the note. It needs a note on the ticket (**QUESTION**).
  - **(b)** Put the round on the real table first, then move it to a virtual table, pay and close. The right bar and table print with no note needed. The costs:
    - on an empty table it opens the real table's bill, which breaks 3.4;
    - for a few seconds an unpaid round sits on the table's bill, against 6.1, although the hold covers the money;
    - the move might print a second ticket (**QUESTION**).
  - **(c)** The guest collects at the bar, showing the phone. "Your receipt is at the bar" already points there. It is the simplest, but at a club table the waiter serves.
- **QUESTION (Mistral):** which fiscal device prints the receipt for a payment on a virtual table, and where (C42)? That decides whether "Your receipt is at the bar" stays true.

**6.11** A pay-first order on an empty table works (D118). With 6.10 (a), at the pilot it never touches the real table.

## 7. The bill on the phone

**7.1 The reading (D111, D121).**
- The platform keeps one reading of a table's POS bills for minutes, refreshes it a few times a minute at most, serves it to every phone, and shows its age.
- Readings, the knock and sending orders are worker jobs. The web app never calls the POS.

**7.2 What the bill shows.**
- Every open POS bill on the table: what is owed, plus anything paid against it. Rounds are marked guest or staff (D121).
- Closed POS bills drop off: a pay-first order, a paid split, a bill a waiter closed (D115).
- **CHANGED (Mistral):** the bill is the table's one bill. Items moved to a virtual table for payment leave the reading at once. While that payment runs, Restro shows them from its own payment record as "being paid", greyed as in 6.6, so they don't vanish. Once paid they are gone, as a paid split is on barsy.

**7.3 "Your paid orders":** the phone that paid lists its own paid orders and receipt copies for the service day (D115). How it looks belongs to #45.

**7.4 The knock (D111, D121).**
- Before each guest action on the bill, the worker reads the POS.
- It refuses with "Your bill changed" only when a line the action is about changed or went; a friend's new round doesn't refuse it.
- The guest then gets one short message and the fresh bill.

**7.5 When the POS doesn't answer (D111, D120).**
- The phone shows the last reading with its age, plus the guest's own orders sent since.
- Ordering and paying pause. There is never a blank or a made-up total.
- A single failed reading of one bill pauses only that table, until its next good reading.

**7.6** A page left open when the table's bills close shows "your bill changed", then the empty bill (D115).

**7.7 The bill screen** gets its own prototype ticket, #45, covering paid and unpaid, paying from it, group payment, D30, the minimum and tips: **open**.

**7.8** A POS that can't read a bill back: **open** (D111).
- **QUESTION (Mistral):** can Mistral read a table's bill with its rows?

## 8. Paying from the bill

**8.1 Paying for your own items is a split (D112, D14).**
- The chosen lines move onto a new POS bill, which is paid and closed with its own receipt (barsy: `Accounts_divide`).
- This avoids the part-payment form of Н-18 чл. 26а. It is how D14 ("guests can split the bill") is met.
- **CHANGED (Mistral):** at the pilot, the waiter's way is to move the lines to a virtual table, pay and close. The proposed order:
  1. hold the money;
  2. move the chosen lines to a free virtual table of the same bar;
  3. pay and close there, which prints the fiscal receipt;
  4. read back;
  5. capture.
- If the payment write fails after the move, the lines move back and the hold is released. If moving back fails too, the lines are stranded (9.11).
- The fiscal reason still holds: it is a whole sale with its own receipt.
- **QUESTION (tickets):** does moving lines between tables print a ticket again? If it does, the bar would make paid drinks twice. Moving would then be unusable, and paying for your own items would wait for another way.
- **QUESTION (Mistral):** can the API move part of a line's quantity, such as 2 of 5 beers?

**8.2** Paying pays exactly the lines shown; a round that lands meanwhile stays on the bill (D112).

**8.3 Paying the whole bill (D112).**
- Over several POS bills: merge them, then close once; otherwise close each. Staff can merge a table's bills in one action (barsy).
- **CHANGED (Mistral):** this falls away, since there is one bill to close. It stays for barsy.

**8.4** Restro sends the amount shown and closes in the same call, then reads back that the bill is closed with Restro's payment on it. On a mismatch the hold is released and the venue alerted (D112).

**8.5 One payment at a time (D112, D117).** One per bag and one per bill, each a visible countdown lock.
- **NEW (Mistral):** paying also needs a free virtual table at that bar. When all of them are busy, the proposal: refuse before the hold with "Paying in the app is busy for a moment, try again in a minute or call a waiter". Count it and alert the Restro team, so the pool can grow.

**8.6** Declined, and "can't tell yet": as in 6.9.

**8.7 Receipts (D112).**
- A PDF copy in the app; a paper copy from the bar or a waiter.
- Whether an electronic copy counts as handing over the fiscal receipt (Н-18 чл. 25): **open**.

**8.8** Refunds happen at the venue, through the provider's dashboard plus a POS reversal. Restro's payment record carries the provider's reference (D112).

**8.9 Paying an amount off the bill:** **open** (D112, Q82.1, чл. 26а).
- **CHANGED (Mistral):** Zamboo's part payment exists only on a deferred (credit) sale, which the fiscal research could not match with чл. 26а. Moving lines can't split an amount. Expect no paying by amount at the pilot.

**8.10 Group payment** (several cards, the whole bill or a share): **later** (#43).
- It is built once the provider can hold and the POS confirms that one call can close a bill with several card payments.
- The demand test needs no code: count how often the pilot's bills are already paid with two or more cards.
- **CHANGED (Mistral):** paying a share needs paying by amount (8.9). The Zamboo pages promise "mixed payment on every split bill", so several cards on one whole bill may work (**QUESTION**).

**8.11 Later and out.**
- Tips: **later**.
- The time others have to pay their share (D30): **open**, in #45.
- A VIP table's minimum spend: **out**.
- barsy's own payment links: **out**.
- Paying inside Instagram's in-app browser: **out** (D112).

**8.12** Belonging to the payment map: the payment commands and their phases, Turnstile on Pay, and the knock's proceed path: **open** (D121).

## 9. When something goes wrong

**9.1 Three sizes of failure (D120).**
- An **order** can fail alone: Not sent or Unconfirmed.
- A **table pause** stops one table after one of its orders ends Unconfirmed.
- A **venue pause** stops ordering and paying at every table, while the menu and each bill's last reading stay.
- When the venue pauses, orders waiting in line become Not sent ("Ordering is paused, please call a waiter"), with their lines back in the bag. An order already Sending or Checking finishes its minute of read-back.

**9.2 What starts a venue pause (D120).**
- No POS call has succeeded for 60 seconds, with at least 3 attempts.
- The POS refuses Restro outright: Restro's POS user's credentials, its cash desk missing, or its period closed.
- 3 orders at different tables end Unconfirmed within 10 minutes.
- The owner's switch, **"Pause ordering"**: one tap to pause, one to lift, with undo and no confirmation dialog.
- Restro doesn't check its cash desk during the night.

**9.3 The pre-opening check (D120).**
- It runs 2 hours before opening and checks Restro's POS user's credentials, its cash desk, and that the cash desk's approval mode matches the setting.
- If it fails, the owner and the Restro team are alerted at once, with the reason in plain words, and the venue opens in a venue pause until a check passes.
- **NEW:** it also checks Restro's virtual tables (2.9).

**9.4 How a venue pause that Restro started lifts (D120).** The pattern is a circuit breaker:
- The pause lasts at least 60 seconds.
- Restro probes with a cheap POS read, never with a guest's order: after 15 s, then 30, 60 and 120 s apart, randomised. After a refusal the gaps run from 60 s up to 5 minutes.
- 3 good probes in a row lift it, with "Ordering is back".
- For 5 minutes after, one Unconfirmed order or 2 failed calls pause the venue again at once.
- A third automatic pause within 30 minutes holds at least 10 minutes and tells the Restro team the venue is unstable.

**9.5 Who lifts which pause (D120).**
- The owner can't lift a pause Restro started (rule 5), and Restro's probes never lift the owner's own pause.
- A Restro admin account can lift any pause.

**9.6 How a table pause lifts (D120).** At the first of:
- a waiter acts on the table in the POS: a round entered by a staff user other than Restro's, or a bill moved or merged;
- staff tap "Resume table" on the alert;
- all the table's POS bills close;
- 15 minutes pass.

A re-order still meets the duplicate warning (5.2).
- **QUESTION (Mistral):** the first way needs Mistral to say who entered a row (as in 5.6).

**9.7 What the guest sees (D120).**
- **A venue pause:** one calm line, "Ordering is paused right now. Please order from a waiter." Send and Pay are greyed, pay-first included. The bag stays editable. The bill shows its last reading with its age. No cause and no countdown are shown.
- **Restro not answering for about 10 seconds:** the phone pauses itself with the same line, keeps the last bag it saw, and retries quietly. Send and Pay are blocked, never queued.
- **After Send:** "We can't reach Restro right now. If your order isn't on your bill in a few minutes, please call a waiter", with the reference, and never "Try again".
- **An Unconfirmed order:** a "Show this to your waiter" panel with the items, the time and the short reference. The waiter checks the bill for Restro's rows and serves them, or enters the order by hand.

**9.8 Alerts (D120).**
- Staff will have an **operations panel**, but they work in the POS and open it rarely at night.
- **Staff and owners** get push alerts from the panel, installed like an app on a staff phone or the bar's tablet:
  - "Ordering is paused at [venue]";
  - "Ordering is back";
  - for each Unconfirmed order, for example "Table 7: an order couldn't be confirmed – 2 × Gin tonic, ref K7Q. Check the bill in [POS]".
- The **Restro team** gets every alert by Telegram.
- A message inside the POS (a note on the bill, or a message to the hall tablet): **later**, per connector (C51).
- **How often:**
  - Each pause gets one alert when it starts and one when it ends; a pause that returns within 10 minutes counts as the same one.
  - Reminders while a pause lasts: none for staff, one after 60 minutes for owners, hourly and at most 3 for the Restro team.
  - Unconfirmed orders are grouped: the first after 10 s, then at most one push a minute, with one reminder after 10 minutes. The Restro team gets them at most every 10 minutes.
  - Nothing alerts outside service hours, except the pre-opening check and one "still paused" at opening time.

**9.9 The outside watchdog (D120).** Restro pings Healthchecks.io (free) every minute. When the pings stop, it alerts the Restro team by Telegram, and the team calls the venue.

**9.10 The Log (D120).** It replaces A5's "orphaned-orders list".
- One Log per venue, searchable by reference, table, time and kind. It holds orders and their states, payments, table and venue pauses, the owner's switch, alerts and tripped guards.
- An order keeps only where it stands now; each step also adds a Log entry, never changed afterwards: the time, what happened, who, and why.
- Log entries are kept 31 days, then erased by the purge job, which is allowed to erase them (an approved guardrail change).
- Owners and managers see their venue's Log. Only the Restro team sees the POS calls.
- A POS bill's number shows on admin screens only.
- Edits to the bag are not logged; Send is.
- About 1,000–2,500 entries a night at 50 tables.

**9.11 NEW (Mistral): items stranded on a virtual table.**
- A move to a virtual table worked, but the payment, or the move back, failed.
- The proposal: a Log entry and a staff alert, "Table 7: 2 items are on table QR-3 in [POS]. Move them back to table 7".
- That virtual table is not used again until it is empty. Each use checks first, and so does the pre-opening check.

## 10. Privacy, law and paperwork

**10.1 Retention.**
- Orders and payments: 18 months, then totals (D111).
- The Log: 31 days (D120).
- No phone, device or IP identifier past the service day (D111).
- **Open:** the bookkeeping periods, checked against the official text, and whether to keep a 30-day raw log of exchanges with the POS (D111).

**10.2 The location check needs consent (D119).** The "strictly necessary" exemption is arguable but not relied on (ePrivacy Art. 5(3); Bulgaria: ЗЕТ Art. 4а). Refusing may block on-the-bill orders, since paying first or calling a waiter remains.

**10.3 Who enforces (D119).** КЗП enforces Art. 4а ЗЕТ (BGN 500–2,000, repeat 1,000–4,000); КЗЛД enforces GDPR.

**10.4 Roles (D119).** The venue and Restro jointly control the location check (Art. 26). Restro is the venue's processor for orders (Art. 28).

**10.5 Paperwork before the first guest, under T31 (D119):** privacy notice items, a short DPIA, the records of processing, and a venue-terms clause.

**10.6 Turnstile (D119).** Only at Send, in managed mode, with pre-clearance and feedback off. What it stores is inspected on staging, and Cloudflare is asked in writing about reusing its signals.

**10.7 The lawyer: open (Q83).** Five narrow questions of interpretation only:
- the exemption;
- refusal, with the waiter as the alternative;
- Turnstile's reuse of signals;
- joint or independent control;
- the DPIA's finding.

**10.8 The NRA list (#33, 10-18).**
- Neither barsy nor any Mistral/Zamboo product is on it. So Annexes 29, 41 and 42 bind the pilot only if it chose some other listed software.
- **QUESTION (venue):** which software manages its sales, and did it file Annex 32?
- **QUESTION (Mistral):** why "Мистрал v3 по наредба H18" isn't listed.

## 11. The technical shape, for the build

**11.1 Two addresses (D121).**
- `GET /api/guest/state` returns the table's whole state, or "unchanged".
- `POST /api/guest/actions` takes one command with its action id.
- Both use no cookie, use strict schemas, are never cached, and sit behind Cloudflare.

**11.2 Retries (D121).** Every tap carries an id, and a repeat gets the first answer. An action arriving much later than it was tapped is refused.

**11.3 Abuse limits (D121).** Cloudflare's one free rate-limit rule guards the actions address per network, set generously because a club's guests share one Wi-Fi address. The web limits state requests per table code.

**11.4 New storage (D121).**
- Tables for the shared bag, for orders and their attempts, for the table's reading, and later for payments, each with its own id kind.
- All writes go through `core.apply` (rule 1).
- **NEW (Mistral):** Restro's virtual tables, their bar, and a lock per virtual table ("in use by payment X until…").

**11.5 The template's contract (`services.ts`, D72, D121).**
- It gains the table's state, the bag commands, refusal codes and the id of what was made.
- A bill round loses its action id.
- The template still only draws, and the page's guest client is the only code that calls these addresses.

**11.6** The Log is its own table, apart from `events` (D120).

**11.7** Nothing is built yet (D79).

## 12. The POS underneath: barsy and Mistral side by side

| What the platform asks | barsy (known, read signed in) | Mistral at the pilot |
|---|---|---|
| Read the menu | connector built (`packages/barsy`) | parked (D79); **no public API found** (T69) |
| Is the table open? | `Places_getlistwithaccountsonly`: open bills per table | its one bill exists: **QUESTION** how to read it |
| Add a round | `Accounts_place` with `account_id` | **QUESTION**; Zamboo's own Web Menu does it, third parties unknown |
| Guard against duplicates | `uuid` on a new bill only | **QUESTION** (C15–C21) |
| Who entered a row, and when (read-back) | `OrderData.user_name`, `date`; unproven (#47) | **QUESTION** (C23, C52) |
| Approval at the bar | four cash-desk modes | **QUESTION**, and does the ticket print before approval |
| Pay-first order | `Accounts_place` with payment and close in one call | a virtual table (6.10): **QUESTION** |
| Pay for your own items | `Accounts_divide`, then pay and close | move lines to a virtual table, pay, close (8.1): **QUESTION**, and does a move reprint |
| Pay the whole bill | `Payments_create` with the bills; merge with `Accounts_mergebyplaceid` | close the one bill: **QUESTION** |
| Pay an amount | `Payments_create` without closing: Q82.1 | only on a credit sale: likely not |
| Which bar | `stream_id` per row; `outputs` lists printers | tables belong to bars: **QUESTION** whether readable |
| NRA list | not listed | not listed |
| Test installation | asked of Lukanet | **QUESTION** |

## 13. What changes, by degree

**First degree: the facts change how a decision works at the pilot.**

| Item | Decision | Change proposed |
|---|---|---|
| 6.10 | D112, D115: a pay-first order is its own POS bill on the table | at a one-bill POS: a bill on one of Restro's virtual tables of the guest's bar, with a note naming the real table |
| 8.1 | D112: paying for your own items splits onto a new POS bill | at a one-bill POS: move the lines to a virtual table, pay, close; move back on failure |
| 8.3 | D112: merge several POS bills, then close | falls away at a one-bill POS; stays for barsy |
| 5.5 | D115: the oldest open POS bill | trivially the one bill; no change in the rule |
| 1.4 | D111: several POS bills per table | stays POS-neutral; the Mistral case is a set of one |
| 5.8, 5.6, 5.10, 5.12 | D116, D115, D112 | **confirmed** by the tickets, no change |

**Second degree: what the first degree pulls along.**
- **New setup:** Restro's virtual tables per bar, and each table's bar (2.8, 2.10).
- **New checks:** the pre-opening check covers the virtual tables (2.9).
- **New failures:** items stranded on a virtual table (9.11), and all virtual tables busy (8.5). Both go into the Log and alerts.
- **Bill reading:** lines being paid stay visible from Restro's own record (7.2).
- **Records:** a payment names its virtual table (1.10).
- **Paying an amount and paying shares** likely fall away at the pilot (8.9, 8.10).
- **Approval** may be meaningless if the ticket prints before it (5.11).
- **The waiter's panel** may need the POS item name (5.13).
- **The open-table rule** gets stricter in practice: Restro never opens a real table's bill at the pilot (3.4).

**Third degree: the plan.**
- **The pilot's POS is Mistral, and its connector is parked.** CLAUDE.md's scope and D79 put "the connector foundation (CF-05 to CF-08) and the Mistral connector" on hold. The pilot needs a Mistral **menu** connector before any guest sees its menu from the POS, and then a Mistral **ordering** connector. Both wait on T69: Mistral Software answering with an API, documentation, a test installation and terms. **This is the critical path. Only Martin can start it.**
- **barsy work moves off the critical path.**
  - #47 (proving the read-back on barsy) and the Lukanet questions (Q79, Q82) still matter for barsy venues, but not for the pilot.
  - Adjustments 01, built on barsy's clean data, stands as the platform. The pilot's data will come through a second connector.
- **If Mistral has no API, or only Zamboo's own Web Menu path,** ordering at the pilot cannot be built the way D110 requires.
  - The fallbacks are a hand-made menu (D64), with ordering by "call a waiter" only, or a different pilot venue on barsy.
  - That would be a scope decision for Martin, not for an agent.
- **Rule 7 / D110 holds:** moving lines to a virtual table is a waiter's action.
- **The decision log needs one new decision once Martin agrees:** proposed **D122**, "Ordering at a POS with one bill per table: Restro's virtual tables, bars and tickets". It would refine D112, D115, D117 and D120.
- It also brings GLOSSARY entries (virtual table, bar ticket), new connector questions (section 15) and a tracker change that moves T69 ahead of #47.

**What does not change:** the shared bag, the order states, the guards against fake orders, the location check and its law, the failure handling, the Log, the guest API, and the payment mode per item. All of D113, D116 (except the approval question), D117, D118, D119, D120 (apart from two new failure kinds) and D121.

## 14. Everything not firm, and who owns it

| Item | Status | Owner |
|---|---|---|
| Mistral API, documentation, test installation, terms (T69) | open, **critical for the pilot** | Martin sends; Mistral Software answers |
| D122 (virtual tables, bars, tickets), sections 0 and 13 | proposal | Martin |
| The read-back proven on a POS (#47; Mistral C52) | open | an agent, once a test installation exists |
| Restro's own id on a row (Q82.3, C21) | open | Lukanet / Mistral |
| Approval: how it reads back, per bill or per round (C53) | open | per connector |
| What prints on a bar ticket, language (Q52, Q70) | open | Mistral, the venue |
| How options and add-ons map to the POS's modifiers | open | per connector |
| The composer screen for the payment mode | open | design ticket |
| The bill screen, "Your paid orders", D30, minimum suggestions, tips (#45) | open | prototype ticket |
| The operations panel: push alerts, the Log screen, "Resume table", recipients, opening time | open | design ticket |
| Whose phone gets alerts at night (Q69) | open | the pilot venue |
| Paying an amount off the bill (Q82.1, чл. 26а) | open; likely out at the pilot | POS answers |
| Group payment (#43) | later | after the provider and POS confirm |
| Payment commands, phases, Turnstile on Pay, the knock's proceed path | open | the payment map |
| An electronic receipt copy as handing over (Н-18 чл. 25) | open | research agent |
| Bookkeeping retention periods; a 30-day raw POS log | open | research agent |
| How long order notes are kept | open | privacy list |
| Safari asking for location again within a night | open | field test |
| The lawyer's five questions (Q83) | open | lawyer, when engaged |
| The venue's sales software and Annex 32 | open | the pilot venue |
| A message inside the POS for alerts (C51) | later | per connector |
| Push instead of polling | later | after the pilot |
| Restro removing a row (C48) | later | — |
| The waiter-call backend | later | — |
| "Who ordered what" on the bill | later | an improvement |
| Tips | later | — |
| Happy hour within a night | on request | — |
| A PIN or expiring table codes | on request | — |
| Delivery stages, late landings, cancelling after Send, a visit, ordering from the bar, ordering without a code, one phone per table, "who added it" in the bag, VIP minimum spend, barsy payment links, Instagram's in-app browser | out | — |

## 15. The questions to send

**To Mistral Software** (office@mistral.bg). Questions 1–9 are already drafted in `2026-10-17-pos-integration-requirements.md` (the product and version, an API, orders from outside, card payments and the ФБ, Annex 42, part payments, storno, status and webhooks, myPOS). New, from 10-20:

10. Is one bill per table enforced? Can a table hold a second open bill?
11. Can the API move chosen lines, or part of a line's quantity, from one table's bill to another table? Does a move print a ticket again at any bar?
12. How are virtual or buffer tables set up? Can each belong to a bar? Can an outside app order onto one, pay and close it?
13. What does a bar ticket print: the table, the operator (the POS user), a free-text note? In which language? Does a sale that is opened, paid and closed at once print a ticket?
14. Is there approval of outside orders? Does the ticket print when the order is entered, or when it is approved?
15. Does a read of a table's bill give each row with who entered it and when? Is a call all-or-nothing? Can an outside app put its own id on a row and read it back? Does a repeated call with the same id create nothing?
16. Can the API tell which bar a table belongs to?
17. Which fiscal device prints the receipt for a sale closed on a virtual table, and where does the paper come out?
18. For the menu: items, categories, prices, options and add-ons, and what is sold out. Can an outside app read them?

**To the pilot venue:**
- Which Mistral product and version do you run (Zamboo or Мистрал v3)? Which software manages your sales, and did you file Annex 32?
- How many bars do you have, and which tables belong to which? Which virtual tables do you use today, and could Restro have its own few per bar?
- A photo of a bar ticket.
- How often do guests pay their own part, and how often is one bill paid with two or more cards? This is the demand test, and it needs no code.
- Whose phone gets the alerts at night (Q69)?

**To Lukanet (barsy):** Q79, Q82 and a test installation, as before. They still matter for barsy venues, but are no longer on the pilot's critical path.
