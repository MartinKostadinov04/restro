Made by: board reviewer (Opus), 10-21, staff and owner perspective

# Board review: the ordering decisions, seen by staff and the owner

Read: the four board files in order, D107, D120, the six grilling logs (#35–#40), the login row of `stack.md`, GLOSSARY.
Citations: a plain number is an item of `2026-10-20-ordering-what-we-decided.md`; **R1** is round 1; **M1–M32** are the merged review's part 3; **R2** is round 2.
Phase 2 marks a finding that matters only once paying in the app ships (choice A).

## 1. UX/UI

**1.1 "Call a waiter" leads nowhere.** Must before the pilot.
3.6, 6.9, 9.7 and R1 make **Call a waiter** the main way out: on a failed location check, a declined card and "can't tell yet". But the waiter-call backend is **later** (14; #40 log 6.3), and D71/D72 forbid showing success locally. At the pilot, the largest button on the screen does nothing.
Proposal: until the backend exists, the button opens a still card: "Wave to a waiter or go to your bar", with the table's label in large type. It must never say a waiter was called.

**1.2 The merged review reverses three things Martin decided.** Must before the pilot.
- M23 shows an Unconfirmed reference on every phone for 15 minutes, and greys lines as "Being sent" on every phone. D121 (#40 log 1.1, 1.2) says progress shows only on the sending phone, and R1 4.2 says the same of undo.
- M25 brings back "Weak connection… we keep trying", which #40 log 2.3 replaced with D120's paused screen.
- M24 settles 5.13's point, which was marked "open, for Martin".

These are guest-facing choices, not technical tuning, so they need Martin's yes. Also, "Your order is saved" is false offline: edits are optimistic (D121 2.1) and may never have reached the server.

**1.3 Three names for one staff screen.** Must before the pilot.
D120 and GLOSSARY say "operations panel". M28 says a "Tonight" page in the admin. R2 2 says "an alerts page in the venue admin".
"Resume table", the "Done" on money alerts, the payment answers (M1), the Log and the night summary (M27) need one place with one name.
Proposal: one **Tonight** page: alerts at the top, then tonight's rounds, then the Log. Point the GLOSSARY entry to it.

**1.4 Three wordings for the receipt.** Must, phase 2.
- 6.9: "Your receipt is at the bar".
- R1 7.3: "Your paper receipt is at the bar".
- Merged part 2: "Your waiter brings your receipt".

Keep the last one, for the legal reason the merged review gives, and delete the others. It needs a staff flow (4.3).

**1.5 The waiter panel doesn't let the waiter decide.** Must before the pilot.
9.7, M24 and the staff card say: "if the items are on the table's bill, the drinks are coming". At a club the bill already holds earlier gin tonics, so the waiter can't tell whether *these two* landed. Mistral's terminal may also not show who entered a row (C23, open).
Proposal: Restro already reads the bill just before sending (M16), so the panel can say: "Bill before this order: 46.00 €. If the bill now shows 62.00 € or more, it went in." That is one number to compare at the terminal.

**1.6 A single bar's pause has no switch and no words.** Should.
R2 4.1 pauses each POS login (each bar) on its own. But the owner's switch (9.2) is venue-wide, and the guest's line (9.7) covers only "all connections paused". A swamped bar is the main reason to pause by hand.
Proposals:
- tables of a paused bar get the same calm line;
- with more than one bar, "Pause ordering" offers "All bars / Bar 1 / Bar 2";
- alerts name the bar: "Ordering is paused at Bar 2".

**1.7 The pause switch has no state for Restro's own pause.** Should.
The owner can't lift a pause Restro started (9.5), and both pauses can be on at once. Next to the owner's switch, show a greyed line: "Paused by Restro: [POS] isn't answering. It lifts by itself." Otherwise the owner taps a switch that seems to do nothing.

**1.8 "Payment unconfirmed" asks bar staff a fiscal question.** Must, phase 2.
M1 has staff tap "Receipt printed" (the money is taken) or "No receipt" (the money is released). A wrong tap either loses the venue its money or charges a guest with no receipt.
Proposal:
- Restro first reads the closed bills (Mistral Q24) and prefills the answer;
- the question names exactly what to look for: "Is there a receipt for 38.00 € on APP PAY 3 at 02:10?";
- only the manager and owner roles may answer (2.1).

**1.9 Telegram has no place for a tap.** Should.
R2 2 repeats money alerts "until someone taps Done", and D120 puts "Resume table" "on its alert". But Telegram is only a supplementary channel.
Proposal: Telegram messages are read-only, with a link to the Tonight page. Every tap happens there, signed in, so the Log records who did it.

**1.10 The pre-opening check fails if the POS isn't switched on yet.** Should.
The check runs 2 hours before opening (2.6, 9.3). If Mistral runs on the venue's PC (Q28) and staff switch it on an hour before opening, the check fails and alerts the owner every evening.
Proposal: re-run the check every 10 minutes until opening. Alert the owner only if it still fails 30 minutes before opening.

**1.11 There is one opening time, but clubs open on some nights only.** Should.
2.6. Proposal: an opening and a closing time per weekday, or "closed". No check and no alerts on closed nights. "Service hours" for alerts run from opening to closing, not to 07:00.

**1.12 The dispute evidence names something nobody keeps.** Nice.
R2 5.3 lists "the bar ticket's printing". Restro can't see a ticket print, and the bar throws its tickets away. The evidence is the POS row under Restro's user, with its time.

## 2. Security and robustness

**2.1 The new staff powers have no roles.** Must before the pilot.
`stack.md` has owner, admin and member, plus a staff role that can only mark items sold out. The board adds many powers without saying who holds them:
- Pause ordering and Resume table;
- the money answers and "Done";
- the Log, which D120 gives to "managers", a role that doesn't exist;
- the night summary and its CSV;
- alert recipients;
- the guard settings, the virtual tables, table codes and "Disable prepayments".

Proposal for D122:
- **staff:** sold out, Resume table, reading the Tonight page;
- **manager** (the existing admin role): also Pause ordering, the money answers, the Log and the night summary;
- **owner:** also the settings, guards, virtual tables, bars, table codes and alert recipients.

**2.2 The bar's tablet stays signed in all night.** Must before the pilot.
D120 suggests putting the panel on "the bar's tablet". If it is signed in as the owner, anyone at the bar can switch off the location check, retire table codes or archive the venue.
Proposal: a shared bar device signs in only with a staff account. A staff session lasts until the service day ends.

**2.3 Staff must not be able to use Restro's POS user at a terminal.** Must before the pilot.
Rule 9, 5.13, 9.6 and the read-back (5.6, M16) tell Restro's rows apart from the waiters' by the POS user ("QR"). Mistral operators often sign in with a PIN or card. If staff know QR's PIN, three things break:
- a waiter's round reads as Restro's, so a lost order shows as Added;
- a table pause doesn't lift;
- a voided or free drink can be blamed on the app.

Mistral question: can an API user be blocked from signing in at a terminal? Venue rule: nobody but Restro knows its credentials.

**2.4 "Only Restro uses that table" is an assumption staff can break.** Must, phase 2.
M1 reads "empty after the close" as "closed", because only Restro uses a virtual table. But QR-3 holds items on the floor plan (for minutes, in Martin's order of choice B). Two things can happen:
- a bartender tidies up "a forgotten table" and closes it with cash;
- a waiter parks a part payment there out of habit (2.8: they take "some random available table").

Restro then also takes the card payment: the guest pays twice, and the cash drawer is short.
Proposals:
- the check after a close reads the closed bill's payment type, amount and receipt number (Mistral Q24, Q25), never just "empty";
- name the tables "APP PAY 1–4 · do not use", and put the same line on the staff card;
- choice B's fix keeps lines on the table for seconds, not minutes, which shrinks this window.

**2.5 Virtual tables arrive as guest tables.** Must, phase 2.
Tables are mirrored from the POS into Tables & QR (`places`). QR-1 to QR-4 would arrive as ordinary tables, with codes, a menu and a print button.
Proposal: the sync marks them "tables for payments" (2.8). They can never get a code or a menu, and the guest lookup refuses any code made for one.

**2.6 The table-to-bar mapping is set by hand and never checked.** Must before the pilot.
See 2.10, R1 2.10 and Q19. If each bar has its own Mistral login, one wrong mapping prints a whole area's tickets at the wrong bar, every night, silently. The pre-opening check can't see a printer.
Proposals:
- in the rehearsal, send one round per bar's tables and have each bar confirm its ticket;
- only the owner may change the mapping later, and each change is a Log entry.

**2.7 A Telegram group outlives the staff.** Should.
People who left keep getting the venue's alerts.
Proposals:
- the Restro team owns the group;
- invite links are single-use;
- Settings lists who gets alerts and reminds the owner monthly to check it.

**2.8 The Restro team can lift the owner's own pause.** Should.
9.5 lets a Restro admin lift any pause. The owner may have paused because a bar is swamped, and lifting that goes against rule 5's spirit.
Proposal: the Restro team lifts only the pauses Restro started. It lifts the owner's pause only after a call to the venue, logged.

**2.9 Loosening a guard leaves no trace.** Should.
2.3, 9.10: the Log records the owner's pause switch, but not switching off the location check, the €150 cap or the open-table rule.
Proposal: every guard change is a Log entry, with who and the before and after values.

**2.10 An Unconfirmed round can become double drinks at the bar.** Should.
9.7, 5.14: the waiter enters the order by hand, and the original may have landed. Restro no longer looks, but the bartender holds both tickets.
Staff card line: "Two tickets for the same table and the same drinks, minutes apart: ask the waiter before making the second."

**2.11 An allergy note may never reach the bar.** Must before the pilot.
Guests write notes on lines (4.2, M30), for example "no nuts, allergy". Nothing says the note prints on the ticket: Mistral question 13 asks only about a note naming the table.
Proposal: a capability, "line notes print on the ticket". Without it, the note field is hidden.

## 3. NB

- NB: Every staff-facing text (the staff card, alerts, the Tonight page, the guest's waiter panel) is in Bulgarian first and uses the POS's item names (D82, D87).
- NB: The waiter panel is read in the dark at 110 dB. Show the reference in very large type, light on dark, and raise the screen brightness where the browser allows.
- NB: A Restro round is charged at the POS price, not the menu price (D116). The staff card says "the bill's price wins", so waiters don't argue over a stale menu.
- NB: Lines moved to a virtual table vanish from table 7 at the terminal. The staff card says "items on APP PAY tables are being paid in the app: don't re-enter them".
- NB: After a whole-bill payment through a virtual table (M7), the real table's bill is empty. At Mistral that means "not open" (R1 3.4) and "all bills closed": the table's order clears (4.6) and a table pause lifts (9.6). A group that pays and stays needs a waiter to order again. The "Paid" screen should say: "To order more, ask your waiter".
- NB: The night summary (M27) will count Restro rounds a waiter voided as mismatches. List them apart from "Unconfirmed rounds found on a bill". For the owner, the voided list is also a theft signal.
- NB: The Tonight page and "Pause ordering" must work on a manager's phone at 390 px (D109's open question; yes).
- NB: The breaker's numbers exist in three versions (D120, M17, R2 4). D122 must carry only R2 4.
- NB: A new table code made mid-night stops that table until the new code is printed (3.1). The screen says so and offers to print at once.
- NB: A swamped bar has two levers, "Pause ordering" and "sold out". Both should be two taps from the Tonight page.

## 4. Possibly forgotten

**4.1 Topic: end of night.** Should; must, phase 2. Checked: D115, D120 and the #35–#40 logs.
Restro never closes tables (R1 1.6), but nothing defines the owner's close.
- If the POS PC is shut down before 07:00, M15's 30-second link check pauses the venue and alerts every night.
- At one bill per table, a virtual table left with a bill may block closing the Mistral day (Q29).

Proposal: at the closing time (1.11), ordering stops quietly and the night summary is sent. Any APP PAY table still holding a bill becomes a money alert.

**4.2 Topic: reconciling the POS, Restro and the provider.** Must, phase 2. Checked: M6, M27.
If Restro closes bills with the same "card" type as the venue's terminal, the POS's card total mixes both. The owner then can't match the provider's payout (net of fees, paid days later) to anything.
Proposals:
- Mistral question: can Restro use its own payment type, such as "Card – app"?
- research question: which Н-18 payment type an online card payment needs;
- the night page shows Restro's card total per bar and the expected payout date.

**4.3 Topic: who brings the receipt, and to whom.** Must, phase 2. Checked: merged part 2, 6.10.
The receipt prints at the bar, for QR-3. With several payments at once, the bartender holds receipts for QR-1 to QR-4 without knowing the tables. At the table, the waiter doesn't know which of eight guests paid.
Proposal: the ticket or receipt shows "Table 7 · ref K7Q" (Mistral Q13, Q17). The payer's "Paid" screen shows the same reference in large type, so the waiter hands the receipt to the matching phone.

**4.4 Topic: refunds during the night.** Should. Checked: D112, #35 log 8.5, M9.
"At the venue, through the provider's dashboard plus a POS storno" doesn't say who does it at 02:00. The likely case is a pay-first drink lost at the wrong bar.
Proposals:
- staff rule: remake the drink, never refund at night;
- the owner makes refunds the next day, each with its storno;
- provider dashboard accounts are personal, never shared.

**4.5 Topic: staff training and turnover.** Must before the pilot. Checked: merged part 2 (one rehearsal, one card).
Club staff change often.
Proposals:
- the staff card can be printed from the Tonight page;
- a 2-minute guide for each new waiter;
- the owner ticks "staff briefed" before ordering is switched on.

If Mistral has no training mode (Q27), the first night runs with 3 tables and the Restro team on site.

**4.6 Topic: running out at the bar.** Should. Checked: D116, #35 log 4.10.
A ticket arrives for something the bar has just run out of. Who marks it sold out so the next table can't order it? Proposal: the bartender, in two taps, with the staff role. If Mistral exposes stock (question 18), nothing more is needed.

**4.7 Topic: signing in at night.** Should. Checked: `stack.md` (email and password).
A manager signed out at 02:00 must not depend on an email link.
Proposal: long staff sessions on the bar device. Only the owner resets a staff password, in the admin.

**4.8 Topic: joined tables.** Nice. Checked: #38 log 4.1, #35 log 4.11.
When a waiter merges table 8's bill into table 7, guests at table 8 see "Ask your waiter to open your table". Staff card line: "Joined tables: guests scan one code".

**4.9 Topic: disputes.** Nice. Checked: R2 5.3.
Proposal: a "dispute pack" on each payment record: a PDF of its evidence that the owner uploads to the provider.
