Made by: board reviewer (Opus), 10-21, guest perspective

# Board review: the guest's phone

One night at table 7: six friends scan, order together, meet pauses and a weak signal, lose a phone, pay (phase 2), leave; a new group sits down.

How items are cited: a bare number (3.6) is an item of "what we decided"; R1 is round 1; M is the merged review's part 3 (M 23); R2 is round 2. Severity is **must before the pilot**, **should** or **nice**, and each section starts with the most important.

## 1. UX/UI

**U1 · "Call a waiter" is a button with nothing behind it. Must before the pilot.**
- The waiter-call backend is **later** (section 14), and D71 hides a service the platform doesn't support.
- Yet it is the larger button when the location check fails (3.6), an option after a declined card (6.9) and the answer when Turnstile fails (R2 §3).
- A button that sends nothing dead-ends or fakes success (D72). The same instruction also comes in four wordings: call, ask, order from, show this to.
- **Fix:** at the pilot it is text, never a button, with one phrase everywhere: "Please order from your waiter."

**U2 · Phase-1 screens still promise paying. Must before the pilot, if choice A is taken.**
- The consent text offers "or pay first" as the alternative (3.5). The legal reasoning relies on that alternative being real (10.2), and in phase 1 it isn't.
- Other places do the same: "Pay 24 лв" after Send (6.2), "pay first or ask the waiter" at the €150 cap, and "pay-first items order as normal" on an empty table (3.4).
- **Fix:** a phase-1 wording set:
  - consent v1: "…Never stored. You can stop anytime and order from your waiter instead.";
  - pay-first items have no add button and say "Order this from your waiter" (1.11).

**U3 · The rename breaks the words. Must before the pilot.**
- After R1 4.1, "order" means the unsent thing. Yet the messages use it for what was already sent: "We couldn't send your order", "Your table ordered the same…" (5.2), "An order from this table couldn't be confirmed" (M 23).
- M 25's "Your order is saved" will read as "it went to the bar". "Earlier order · Restore" reads like a past round to order again.
- **Fix:** one wording table before any template work, for example:
  - "Weak connection. Nothing was sent yet, we keep trying.";
  - "Items not sent earlier · Put back";
  - prices in €, not "лв" (5.2, 6.2, 6.5; M 12; Bulgaria has used the euro since 1 January 2026).

**U4 · Notes and choices may never reach the bar. Must before the pilot.**
- The template offers choices and a note on each line ("Order from the phone" in the template guide).
- How choices map to the POS is **open**, and Mistral question 13 asks only about a note naming the table.
- A "no ice" or "allergy" note that shows on the phone but never prints is a silent failure.
- **Fix:**
  - a connector capability, "notes and choices print on the ticket";
  - without it, the note field is hidden, and items with choices say "Order this from your waiter";
  - add this to the Mistral questions.

**U5 · "Ask your waiter to open your table" may never clear. Must before the pilot.**
- At Mistral every table's first round needs a waiter's item first (R1 3.4), so every table meets this screen.
- The POS is read only while a phone has the bill open (R1 7.1, M 20). A table opened while everyone looks at the menu stays "not open".
- **Fix:**
  - guests may build the table's order on a table that isn't open;
  - Send triggers a fresh read, and the message shows only after that read says no;
  - while any phone shows "not open", read that table every 15 s.

**U6 · M 23 overrides Martin under "technical tuning". Should.**
- The #40 log (1.1, 1.2) shows progress and the Unconfirmed reference on the sending phone only; M 23 shows them on every phone.
- I agree with M 23, but it is guest-facing: it needs Martin's yes and a note on D121.

**U7 · A table pause has no words. Should.** Only the venue pause has them (9.7). Proposal: "Ordering from phones is paused at this table. Please order from your waiter." No cause, no countdown.

**U8 · One sold-out line refuses the whole round. Should.**
- D116 says "remove it and send again".
- Proposal: mark the line "Sold out" as soon as the live overlay shows it, and let Send offer "Send the other 4" in one tap.

**U9 · Send doesn't name the table. Should.**
- Proposal: "Send 3 items to Table 7", counting on-the-bill lines only. Today's "Send 5 items" may count pay-first lines that stay behind.
- This also catches a moved table card (S4).

**U10 · A wrong Send can't be undone. Should.**
- One tap sends a friend's half-decided lines, with no cancel (5.10).
- Proposal: 5 seconds of "Sending to the bar… Stop" before the round leaves Restro: an undo before the POS, not a cancel after it.

**U11 · A guest who tapped "Not now" is stuck for the night. Should.**
- "Not asked again" (3.5) should mean Restro doesn't ask on its own. The guest's own tap on "Allow location" opens the consent again.
- "Why?" gives iPhone and Android steps for three cases: the browser blocked location, the phone's location is off, "Precise location" is off.

**U12 · Removing a line asks for location. Should.**
- A guest who refused can't remove a line a friend added by mistake (#40 log 3.1).
- Removing only makes the bill smaller, so removing and Undo are never located; adding and Send are.

**U13 · Lines paid in the app vanish from the table's bill. Should (phase 2).**
- At Mistral the paid lines leave the table (7.2). Friends and the waiter see a smaller bill with no reason.
- Proposal: keep them as "Paid in the app", from Restro's own records and without who, until the table's bill closes.

## 2. Security and robustness

**S1 · The location pass outlives the group. Must before the pilot.**
- The pass is tied to the table and 2 hours (3.7), not to the group.
- After the table turns over, a guest who left can order onto the next group's bill from anywhere for up to 2 hours. That is exactly what the check exists to stop.
- **Fix:** a pass is void once all of the table's bills have closed since it was issued. Restro already sees that moment, because it clears the table's order then (4.6). A server-side counter per table is enough, and no POS id reaches the phone.

**S2 · Anyone who once held the code can watch the table all night. Should, Martin's call.**
- Viewing needs only the code (3.2), and the code is printed on the table.
- A former guest at home sees the next group's bill and their table's order, with its notes ("allergy").
- **Recommendation:**
  - accept bill viewing for the pilot;
  - show the notes only to phones with a location pass;
  - put "Everyone at your table sees this note" in the note field.

**S3 · One prankster freezes a table. Should.**
- Every limit is per table or per code: 60 changes a minute (4.4), 20 requests a second (M 21), and 6 rounds in 15 minutes.
- One photo of the code is enough to trip them, and the honest guests get "Slow down a moment".
- **Fix:** a per-phone limit of 20 changes a minute, keyed by a random value the page makes at load and held in server memory for minutes only (D111).

**S4 · A swapped table card. Should.**
- A card carried to another table sends that table's rounds, and drinks, to the wrong place.
- **Fix:** QR stickers fixed to the table, with the printed number matching the label on screen, plus U9.

**S5 · The open check can use a stale reading. Should.**
- Send uses the latest reading (D121), which can be 15 s old.
- If a waiter moves the bill away in that window and Mistral opens a bill for a round sent to an empty table (5.5 question), the rule in 3.4 is bypassed.
- **Fix:** M 16 already reads the table just before sending; that read decides "open".

**S6 · The bill and the panel can contradict each other. Should.**
- An Unconfirmed round that lands late shows on the bill while the panel says "couldn't be confirmed" (5.14). That invites a re-order.
- **Fix:** during the table pause, each display reading runs M 16's before-and-after match. A match turns the panel into "Found on your bill" and lifts the pause. This narrowly reopens "late landings out".

**S7 · A reload forgets the round. Should.**
- iOS kills background tabs, and only the sending phone tracks its round (5.7).
- The order id, the consent and the pass go in the phone's storage. In private mode, where storage fails, the page asks for consent again and still works.

## 3. NB

- NB: The "Show this to your waiter" panel is read in the dark at 110 dB: Bulgarian, the POS names, a huge reference, high contrast, whatever the guest's language.
- NB: Every guest string goes through next-intl (BG and EN). The consent record "vN" also names the language.
- NB: Start getting the position while the first on-the-bill line is added, so the 10 s wait never lands on a tap.
- NB: After reading the table code from the scanned link, the page strips it from the address bar, so sharing the page shares the menu, not the table.
- NB: A round's outcome shows the moment a locked phone wakes; test hidden-page polling on iOS Safari.
- NB: State changes are announced to screen readers and never shown by colour alone, greyed lines included. No decision covers accessibility of the service screens (D93 is colour only).
- NB: The duplicate warning fires on every honest "same again" round. Word it as a friendly check: "Same as 4 minutes ago. Send another round?"
- NB: A waiter's discount or free item shows as its own line, never as an "Other item" with a minus price.
- NB: A captive-portal login page answering the API means "weak connection", never a refusal.
- NB: An edit made on a weak signal that is refused on arrival (M 26) puts the number back with "Your table's order changed", never silently.

## 4. Possibly forgotten

For each item I checked all six decision logs, D110–D121 and the four board files.

**F1 · Data in the basement (topic: venue network). Must before the pilot.**
- The field test proved location accuracy (3.10), not that data works there.
- With 2-second polling and a self-pause after 10 s, a club with no signal is "paused" all night.
- **Ask the venue:** is there guest Wi-Fi, does it have a login page, and does mobile data work in the deepest corner?
- Logs: #38's field test covers location only.

**F2 · Last orders (topic: service hours). Should.**
- Only an opening time exists (2.6). After the bar closes, rounds still print into an empty bar, and the owner's pause text, "paused right now", is wrong at closing.
- **Proposal:** a "Last orders" time per venue, then "Ordering from phones has closed for tonight". At the pilot the owner taps Pause.
- Logs: #39 has the opening time only.

**F3 · Booths with several codes (topic: table codes). Should.**
- A booth may be two POS tables with the one bill on one of them. Guests at the other code see "Ask your waiter to open your table".
- **Proposal:** the venue can point several codes at one POS table, under one label.
- Logs: #38 row 4.1 mentions tables a reservation spans only as an argument.

**F4 · The staff card (topic: staff training). Should.**
- The rehearsal card (merged review, part 2) covers only the Unconfirmed panel. Add:
  - a table orders from phones only after you put its first item on;
  - "QR" rows are real orders;
  - never re-enter a round you can see on the bill;
  - phase 2: bring the receipt from QR-n to its table, and move stranded items back.
- Logs: none.

**F5 · Discounts, free items and service charges (topic: the bill). Should; must for phase 2.**
- How does a waiter's 10% or a free bottle show on the bill?
- What is moved and charged when a guest pays their own lines from a discounted bill?
- Logs: #35 has only happy hour (3.7).

**F6 · Paying for one of several identical drinks (topic: virtual tables). Should (phase 2).**
- Identical lines merge (4.2), so two friends' gin tonics become one row of 2.
- 8.1 asks whether Mistral can move part of a quantity. Nobody noted that merging makes the commonest club split impossible if it can't.
- If it can't, send lines from different taps as separate rows, after asking whether that changes the ticket.

**F7 · The receipt from a virtual table (topic: receipts). Must for phase 2.**
- The waiter must bring the receipt (merged review, Law 4), but it prints under "QR-3".
- The note "for Table 7" (6.10 a) is asked for the ticket, not for the fiscal receipt. Add a Mistral question.
