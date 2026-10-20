# Board review: what the three reviewers found, and the questions left for ordering

Made by: the lead session (Opus), 10-21, for Martin.

**Sources:**
- three independent reviews of the whole ordering board:
  - `2026-10-21-board-review-guest.md` (Opus, the guest's phone);
  - `2026-10-21-board-review-staff.md` (Opus, staff and owner);
  - `2026-10-21-board-review-system.md` (Fable, the system end to end);
- the research on the UX and security questions they raised, `2026-10-21-board-review-research.md` (Opus);
- the lead's check of every "possibly forgotten" point against the six decision logs (#35–#40), D110–D121, the unified doc, rounds 1–2 and the Mistral checker.

**The two pilot facts every point was held against:**
- Mistral keeps **one bill per table**.
- **The table's bar prints a ticket** for every order and throws it away. Nothing records "served".

**How each point is tagged.** Who raised it: **G** guest, **S** staff, **Y** system; "all three" when all did. Severity:
- **must:** before the pilot;
- **must, phase 2:** before paying in the app;
- **should**;
- **nice**.

Part 5 holds the questions for Martin. Part 6 holds what the lead decided from best practice without asking, per Martin's standing rule.

## 1. UX/UI

1. **"Call a waiter" is a button with nothing behind it.** All three, **must.**
   - It is the main way out after a failed location check, a declined card, a Turnstile failure and "can't tell yet".
   - The waiter-call backend is "later" (#40 6.3). A button that sends nothing either dead-ends or fakes success, against D72. → Question 1.
2. **The merged review overrode three of Martin's guest-facing choices** (G, S, Y), **must**:
   - Unconfirmed shown on every phone (fix 23, against #40 1.1–1.2);
   - "Weak connection. Your order is saved" (fix 25, against #40 2.3 and D120);
   - the waiter panel's content (fix 24).

   → Question 2.
3. **"Order" now means two things** (G, Y), **must.** After the rename, "the table's order" is the unsent thing, but "We couldn't send your order", "Unconfirmed order" and D111's stored "orders" all mean what was sent. "Your order is saved" would read as "it went to the bar". → Part 6: what Restro stores is a **round**, plus one wording table.
4. **The staff screen has three names** (S, Y), **must**:
   - "operations panel" (D120, GLOSSARY);
   - a "Tonight" page (fix 28);
   - "an alerts page" (round 2).

   "Resume table", the alert "Done" and the Log sit on different ones. → Question 5.
5. **The receipt line has three texts** (S, Y), **must, phase 2.** "Your receipt is at the bar" (D117), "Your paper receipt is at the bar" (round 1), "Your waiter brings your receipt" (merged, for the law). → Part 6: the last one, everywhere.
6. **Phase-1 screens still promise paying** (G), **must if choice A is taken.** The consent text offers "or pay first" (D121 3.6), and so do "Pay 24 лв" and the €150 cap's "pay first". D113 already says pay-first items show "ask your waiter" until paying exists. → Question 3.
7. **"Ask your waiter to open your table" may never clear** (G), **must.** At Mistral every table's first round needs a waiter. A table is read only while a phone has the bill open, so a waiter's first item can go unseen. → Part 6: Send triggers a fresh read, and that read decides.
8. **The waiter panel can't settle "did it land?" at a busy table** (S), **must.** The bill already holds earlier gin tonics. → Question 2.
9. **A single bar's pause has no switch and no words** (S), **should.** Round 2 pauses each POS connection, but the owner's switch is venue-wide and the guest line covers only "all paused". → Question 13.
10. **Smaller points, all adopted in Part 6:**
    - a table pause has no words (G);
    - one sold-out line refuses the whole round (G);
    - Send doesn't name the table (G);
    - the owner's switch doesn't show Restro's own pause (S);
    - prices still say "лв" (G).

## 2. Security and robustness

1. **The location pass outlives the group** (G, Y), **must.**
   - After the table turns over, a guest who left can order onto the next group's bill from anywhere, for up to 2 hours.
   - #40 3.3 accepted "a guest who left could keep ordering onto **their own** table's bill". The next group's bill was not considered. → Question 6.
2. **New staff powers have no roles** (S), **must.**
   - Nobody is named for Pause, Resume table, the money answers, the Log, guard settings, table-to-bar mapping and alert recipients.
   - D120's "managers" don't exist; `stack.md` has owner, admin, member and a sold-out-only staff role.
   - A bar tablet signed in as the owner could switch off the location check. → Question 4.
3. **Notes and choices may never reach the bar** (G, S), **must.** A "no nuts, allergy" note shows on the phone and may never print on the ticket. Mistral question 13 asks only about a note naming the table. → Question 7.
4. **Staff who know Restro's POS login break the read-back** (S), **must.** A waiter's round would read as Restro's, a table pause wouldn't lift, and a void could be blamed on the app. → Part 6 (a venue rule) and a Mistral question.
5. **The table-to-bar mapping is set by hand and never checked** (S, Y), **must if each bar logs in separately** (Mistral Q19). One wrong row prints a whole area's tickets at the wrong bar every night. → Part 6: a rehearsal round per bar; only the owner changes it, logged.
6. **Paying must never close a bill holding lines Restro didn't put there** (Y), **must, phase 2.** A waiter can park a bill on the payment table, or a move can apply to some lines only. → Part 6: a line-exact match before pay-and-close.
7. **A bartender can close a payment table with cash** (S), **must, phase 2.** It looks like a forgotten table, and then the guest pays twice. → Part 6: read the closed bill's payment type and receipt number; name the tables "APP PAY · do not use".
8. **Payment tables arrive in Restro as guest tables** (S), **must, phase 2.** → Part 6: the connector flags them, and they never get a code.
9. **One prankster can freeze a table** (G): every limit is per table. **Should.** → Part 6, from the research.
10. **Other points adopted in Part 6:**
    - the table code must stay out of Cloudflare's own logs (Y);
    - a partial bill read concludes nothing, like rule 6 (Y);
    - provider notices are signature-checked (Y);
    - "Receipt printed" requires the receipt number (Y);
    - every guard change is logged (S);
    - Telegram group hygiene (S);
    - a captive-portal page is "weak connection", never a refusal (G).

## 3. NB: for whoever designs or builds this

Deduplicated from the three reviews. The lead adds nothing here.

- NB: The "Show this to your waiter" panel is read in the dark at 110 dB. It shows Bulgarian and the POS's item names, a very large reference, light on dark, whatever the guest's language.
- NB: Every staff-facing text is Bulgarian first and uses the POS's item names (D82, D87). Every guest string goes through next-intl, and the consent record "vN" also names the language.
- NB: Start getting the position when the first on-the-bill line is added, so the 10 s wait never lands on a tap.
- NB: Strip the table code from the address bar after reading it, so sharing the page shares the menu, not the table.
- NB: State changes are announced to screen readers and never shown by colour alone. No decision covers accessibility of the service screens yet (D93 is colour only).
- NB: The duplicate warning fires on every honest "same again" round. Word it as a friendly check: "Same as 4 minutes ago. Send another round?"
- NB: A waiter's discount or free item shows as its own line, never as an "Other item" with a minus price.
- NB: An edit made on a weak signal and refused on arrival puts the number back with "Your table's order changed", never silently.
- NB: A Restro round is charged at the POS price (D116). The staff card says "the bill's price wins".
- NB: After an in-app whole-bill payment the real table's bill is empty: "not open", the table's order clears, a table pause lifts. The "Paid" screen says "To order more, ask your waiter".
- NB: The night summary lists rounds a waiter voided apart from Unconfirmed rounds found on a bill. For the owner, the voided list is also a theft signal.
- NB: The Tonight page and "Pause ordering" work on a phone at 390 px.
- NB: The breaker's numbers exist in three versions (D120, fix 17, round 2 §4). D122 carries only round 2 §4.
- NB: Rule 8 applies to readings. The bill's total is the POS's number, never a sum Restro makes.
- NB: "Restro's POS user" is a set wherever bars log in separately. The read-back filter, the marking, the pause lift and the ticket's operator name all take the set.
- NB: Vendor words: "payment table", "bar" and "one bill per table" are capability names in platform code, and "Mistral" lives only in its connector.
- NB: The payment record's fields are scattered over six places (1.10, round 1 2.10, fixes 5, 6 and 10, round 2 5.3 and 5.6). D122 lists them once.
- NB: Notes erased at 31 days on a record kept 18 months is a column purge through the purge role.
- NB: Every deploy is a venue pause, so the runbook names deploy windows outside service hours.
- NB: During the 5-minute watch, one write per connection makes a queue. Show "Ordering is back, busy for a moment" and don't count those rounds as Unconfirmed.
- NB: The pre-opening check at a venue with one login per bar needs every bar logged in.
- NB: Read the whole venue in one call every 15 s where the POS allows it (Mistral Q28), per table only as a fallback.
- NB: A payment move can wait up to 90 s behind a Send in Checking, so a payment table is busy "up to two minutes", not "seconds".
- NB: D110's guardrail test lists "move lines between tables" and "close with a card payment" as declared waiter actions before the Mistral write module exports them.

## 4. Possibly forgotten: each topic checked against the logs

**Verdicts:**
- **new:** no log or decision covers it;
- **partly:** a decision touches it but leaves the pilot's case open;
- **settled:** decided, so not re-asked (see Part 8).

| # | Topic | Raised by | What the logs and decisions say | Verdict | Goes to |
|---|---|---|---|---|---|
| F1 | Notes and choices on the bar ticket | G, S | #40 4.4: every phone sees notes. Fix 30: erased at 31 days. Q13 asks only about a note naming the table. Q18 asks only whether options can be read. Nothing asks whether a line note or a chosen option travels with a round and prints. | new | Q7, Mistral 31 |
| F2 | Where tickets print: per table or per item | Y | Fact 2 assumes per table. #36 and unified 2.10: "the POS routes the ticket". Q16 and Q19 ask about bars and logins, not routing by item. | new | venue, Mistral 32 |
| F3 | Which bar a table belongs to, at the pilot | S, Y | Unified 2.10: needed only for payment tables. Checker R16: each bar may log in separately. If so, every round must pick its bar's login, which makes it phase 1. | partly | Part 6, Mistral Q16/Q19 |
| F4 | What "open" and "closed" mean at one bill per table | G, Y | #38 8.2: open = a waiter started a bill. Round 1 3.4: at least one line. #37 5.3 and #39 2.5 act on "all bills close". Q22 asks "always live or opened by staff". Nobody says whether a bill **emptied by a move** counts as closed. | partly | Part 6, Mistral 30 |
| F5 | The location pass after the group leaves | G, Y | #40 3.3 accepted the cost for the guest's **own** group only. | partly | Q6 |
| F6 | Roles, the shared bar device, signing in at night | S | #39 4.2 (venue ticks accounts for alerts), 5.5 (owners and managers see the Log), 2.7 (Restro team lifts any pause). No role matrix. | new | Q4 |
| F7 | Restro's POS login known to staff | S | Rule 9: one API user per connection. Nothing on keeping it out of staff's hands. | new | Part 6, Mistral 34 |
| F8 | Closing time, last orders, nights the club is shut | G, S | #39 2.4: an opening time only. 4.6: "service hours" for alerts, never defined. D45: the service day ends 07:00. | new | Q8 |
| F9 | Mobile data in the basement | G | #38 9: the field test proved **location** works inside. Data and Wi-Fi were never checked. | new | Part 7 (venue) |
| F10 | Booths with several codes, joined tables | G, S | #38 4.1 mentions multi-table reservations only as an argument. #35 4.7 and 4.11: merging and moving are the waiter's. | new | Q9 |
| F11 | Staff training, the staff card, staff turnover | G, S | The merged review: one rehearsal and one card covering only the Unconfirmed panel. | partly | Part 6 |
| F12 | The first real write with no training mode | Y | Q27 asks for a training mode. Rule 7: tests never run against a live POS. No fallback is decided. | new | Q10 |
| F13 | Restro's fee on rounds a waiter voided | Y | D111 2.4: the fee is counted from orders. D118 6.1: a waiter voids "not ours" rounds. Not connected. | new | Q11 |
| F14 | Service writes vs rule 1 | Y | #40 5.4: "all writes go through the one write path". Rule 1 names menu tables (`field_values`, `events`, documents, snapshots). | partly | Q12 |
| F15 | Discounts, free items, service charges on the bill | G | #35 3.7: happy hour on request only. #40 1.5: unmatched rows show as "Other item". | new | Q15 |
| F16 | Paying for one of several identical drinks | G, Y | #37 4.8: identical lines merge. Q11 asks whether part of a quantity can move. Nobody linked the two. | partly | Q14 |
| F17 | The receipt from a payment table reaching the payer | G, S | Merged Law 4: the waiter brings it. Q17 asks which printer. Nothing on how the receipt finds Table 7 and the right guest. | partly | Q16, Mistral 35 |
| F18 | Reconciliation and the payment type of an app payment | S | Q26: can a close be set to "card". Merged fix 6: card type. Mixing with the venue's own terminal payments isn't addressed. | partly | Q17, Mistral 36 |
| F19 | Refunds during the night | S | #35 8.5: refunds at the venue, through the provider's dashboard plus a storno. Who does it at 02:00 isn't said. | partly | Q18 |
| F20 | The rights of Restro's POS login | Y | D110 lists waiter actions. Q12 asks whether an outside app can pay and close, not which rights it needs. | new | Mistral 33 |
| F21 | Marking rounds "from your phones" | Y | #35 1.5: who ordered what is later. Fix 16 made "who entered a row" an improvement. The marking's source is never named. | partly | Part 6 |
| F22 | Running out at the bar | S | D116: sold-out lines refuse. `stack.md`: the staff role can mark sold out. | settled | — |
| F23 | Disputes evidence pack | S | Round 2 5.3 lists the evidence. | settled; a PDF is nice, later | — |

## 5. The questions for Martin, in order

Phase-1 questions come first, ordered by what blocks the pilot; phase-2 questions follow. Each has the context, the question and the proposal. **A "yes" adopts the proposal.**

### Phase 1: ordering at the pilot

**Q1. What does "Call a waiter" do until the waiter-call exists?**
- Context: four failure screens lean on it, and the backend is "later". A button that sends nothing breaks D72.
- Proposal: until it exists it is **not a button**. A still card reads "Please order from your waiter" with the table's label in large type, and it never says a waiter was called. The same phrase is used everywhere ("call", "ask" and "show this to" become one wording).

**Q2. The merged review changed three of your choices from #40. Keep yours or theirs?**
- Context: these were adopted as "technical", but they are what the guest sees.
- Proposal:
  - **(a) Unconfirmed: theirs.** The "couldn't be confirmed · ref K7Q · show this to your waiter" line shows for 15 minutes on **every** phone at the table. At one bill per table the risk is a friend re-ordering drinks that already landed, and a dead phone must not take the reference with it. "Sending…" progress stays on the sending phone only, as you chose.
  - **(b) Weak signal: yours.** Keep D120's calm paused screen. Drop "Your order is saved", which is untrue for edits not yet received.
  - **(c) Waiter panel: theirs, plus one line.** The reference in large type, the items with the POS's names, the time, and "Bill before this round: €46.00". The waiter compares it with the bill at the terminal. It is a hint, not a rule, because other rounds also raise the total.

**Q3. If paying is phase 2 (choice A), do the phase-1 screens drop every mention of paying?**
- Proposal: yes.
  - Consent text v1: "[Venue] and Restro check your location so nobody outside can order onto your table's bill. Never stored. You can stop anytime and order from your waiter instead."
  - Pay-first items show "Order this from your waiter" (D113 5.4 already says so), and the €150 cap says the same.
  - The composer hides the payment mode until phase 2.

**Q4. Who may do what?**
- Context: the board adds powers without owners, and a bar tablet may stay signed in all night.
- Proposal: three roles, mapped onto the existing ones in `stack.md`. They follow the research's split (Toast, Square), with two changes by the lead, marked *.

| Power | Staff | Manager (today's "admin") | Owner |
|---|---|---|---|
| Mark sold out (already), see the Tonight page | ✓ | ✓ | ✓ |
| Pause ordering (rule 5: pausing only makes things more careful) | ✓ | ✓ | ✓ |
| "Resume table", "Done" on an alert | ✓ with own PIN | ✓ | ✓ |
| Lift the venue's manual pause, the Log, the night summary | | ✓ | ✓ |
| *Phase 2: "Receipt printed / No receipt" (it decides whether a card is charged) | | ✓ | ✓ |
| *Map tables to bars (it routes every ticket) | | | ✓ |
| Guard settings, table codes, payment tables, alert recipients | | | ✓ |

- **The bar device:** a login with the staff role only, which can never hold more.
  - It stays signed in until the service day ends (07:00, at most 12 hours), with no idle lock, so alerts stay visible.
  - "Resume table" and "Done" ask for the person's own 4-digit PIN, as at Toast, so the Log shows a name rather than "bar device".
- **A manager's or owner's own phone:** stays signed in up to 30 days, and asks for the password again before any settings change if the last sign-in was over 15 minutes ago.
- **Ask the venue:** may bartenders resume tables, or only the manager?

**Q5. One name and one place for the staff screen?**
- Proposal: **"Tonight"**, one page in the venue admin:
  1. alerts at the top, with "Resume table" and "Done";
  2. tonight's rounds;
  3. the Log.

  GLOSSARY's "operations panel" is replaced by it.
- **Telegram** carries a "Done" button too, under PagerDuty's rules for Slack:
  - a press counts only from a Telegram user linked once to a staff account whose role may press "Done";
  - anyone else gets "Open the admin to do this";
  - the bot edits the message to "Done by Maria, 02:14", and the Log records "via Telegram".

  "Resume table", pausing and settings stay on the Tonight page, behind a link button. This settles the staff reviewer (read-only) against the system reviewer (a button) in favour of the button: at 02:00 nobody opens the admin to press "Done".

**Q6. Should the location pass end when the table's bills close?**
- Context: you accepted that a guest who left may order onto **their own** table's bill for 2 hours. At one bill per table, once the group pays and leaves, the same table holds the **next** group's bill.
- Proposal: yes, as the research recommends (OWASP: a session ends when what it protects ends).
  - Each table gets a "sitting" number. It goes up by one when all the table's bills close, or when staff tap **"Table cleared"** on the Tonight page.
  - A pass works only while the number is unchanged **and** the pass is under 2 hours old.
  - Restro already sees the close, because it clears the table's order then (D117). "Table cleared" covers a close Restro reads late.
  - This only tightens. The guests at the table never notice.
- No vendor publishes how it handles this, so this is general practice, not a copy.

**Q7. What happens to notes and choices if they may not print on the ticket?**
- Context: an allergy note shown on the phone but never printed is a silent failure. The research covers the allergen law.
- Proposal:
  - The note field and the choices show only where the connector declares "notes and choices reach the ticket".
  - Otherwise there is no note field. A fixed line says "Allergies or special requests? Tell the staff." Items with required choices say "Order this from your waiter".
  - Ask Mistral (question 31).
- The law (research): EU Reg. 1169/2011 Art. 44 obliges the venue to **give** allergen information. It doesn't require a note to reach the bar. The risk is a guest who believes the note was passed on. Toast uses one switch in the same way. A Square bug that lost QR notes shows the failure is real.

**Q8. A closing time, and nights the club is shut?**
- Proposal (the research's model, after Toast):
  - each weekday is open or closed;
  - an open night has an opening, a last-orders and a closing time, which may run past midnight (22:00 / 04:30 / 05:00);
  - last orders are at least 15 minutes before the 07:00 day end;
  - 10 minutes before last orders, phones show "Last orders at 04:30";
  - after it, one message: "Ordering from phones has closed for tonight", and the night summary goes out at closing;
  - no checks and no alerts on closed nights; holiday overrides come later.

  At the pilot, the owner can still tap Pause earlier.

**Q9. Booths: several table codes onto one POS table?**
- Context: a booth may be two codes, while the POS keeps one bill on one table. Guests at the second code would see "Ask your waiter to open your table" all night.
- Proposal: the owner can point several codes at one POS table, with one label. Joined tables stay the waiter's job, with a staff-card line: "Joined tables: guests scan one code."

**Q10. The first real round, if Mistral has no training mode.**
- Context: rule 7 says tests never run against a live POS. Without a training mode, the first guest round is the first write Restro has ever made there.
- Proposal: on opening night the manager sends the first round from a real table, served and paid as a normal sale, with the Restro team on site and 3 tables switched on. It is service, not a test.
- Your call, because it reads rule 7.

**Q11. Does Restro's fee count rounds a waiter later voided?**
- Proposal: the fee counts rounds still on the bill or paid at the night's close (from the night summary). The venue can dispute a night.

**Q12. Is the table's order (the bag) written through `apply()`?**
- Context: rule 1 names the menu tables. D121 5.4 says all new storage goes through "the one write path". Phase 1 makes 6,000–12,000 bag edits a night, and an agent will stop on this at its first ticket.
- Proposal: a second write path in `core`, for service state only, with the same provenance columns. Rule 1 stays as it is, and D122 says so.
- Your OK, because it reads a rule (D67).

**Q13. Pausing one bar.**
- Proposal: with more than one bar, "Pause ordering" offers "All bars / Bar 1 / Bar 2". The guests at a paused bar's tables see the same calm line, and alerts name the bar.

### Phase 2: paying in the app

**Q14. Can a guest pay for one of several identical drinks?**
- Context: identical lines merge (D117), so two friends' gin tonics become one row of 2. Mistral may not move part of a quantity (Q11).
- Proposal: whole lines only, unless the connector declares "moves part of a quantity". Then rounds sent from different Sends are not merged in the POS where the connector can avoid it. Decided now so #45 doesn't design "2 of 5" on hope.

**Q15. Discounts and free items on the bill.**
- Proposal:
  - Phase 1: the bill shows each discount as its own line, with the POS's total.
  - Phase 2: when the bill carries a discount on the whole bill, "pay my items" is refused with "Ask your waiter to split this bill" until Mistral says how a move treats it (question 37).

**Q16. How does the paper receipt find the payer?**
- Proposal:
  - The ticket and receipt carry "Table 7 · ref K7Q" where the POS allows it (Mistral 35).
  - The payer's "Paid" screen shows the same reference in large type, so the waiter hands the receipt to that phone.
  - A staff-card line covers it.

**Q17. Telling app payments apart from the terminal's.**
- Research:
  - Н-18 lets the sales software keep its own list of payment types (Приложение № 29).
  - Card payments print as "дебитна/кредитна карта", and there is no separate fiscal code for a card paid online.
- Proposal:
  - Restro closes on a card type of its own in the POS's list, "Card online (provider)", which counts as card on the fiscal device (Mistral 36).
  - The night page shows Restro's card total per bar, and the provider's expected payout.
- **For the lawyer or the venue's accountant** (interpretation, not plain rules):
  - (a) Is a guest in the venue paying on their own phone a "неприсъствено плащане"?
  - (b) If so, does the e-shop route (Н-18 чл. 3, т. 17, чл. 52о) apply to a venue? The research thinks not.
  - (c) Must the provider's account be declared to the NRA as a virtual POS?
  - (d) Does the fiscal device have only one card register?

**Q18. Refunds at night.**
- Proposal:
  - staff never refund at night: they remake a lost drink;
  - the owner refunds the next day, with its storno;
  - provider dashboard accounts are personal, never shared.

## 6. Decided by the lead from best practice (no question)

Per Martin's rule (technical tuning is researched and decided, then reported). Each is written into D122 once Martin confirms the board.

**Guest page:**
- One wording table before any template work:
  - prices in €;
  - "round" for what was sent;
  - "the table's order" for what wasn't;
  - "Items not sent earlier · Put back" in place of "Earlier order · Restore";
  - "Your waiter brings your receipt" everywhere.
- Send says "Send 3 items to Table 7", counting on-the-bill lines only.
- A sold-out line is marked as soon as the live overlay shows it. Send offers "Send the other 4".
- A table pause says "Ordering from phones is paused at this table. Please order from your waiter."
- **Open at Send:** a fresh read just before sending decides. While any phone shows "not open", that table is read every 15 s.
- **Closed:** the connector reports closed, or a complete reading shows the bill empty after a non-empty one, not counting lines Restro itself moved for a running payment.
- A partial read concludes nothing. It never clears the table's order, never lifts a pause and never refuses with "Your bill changed".
- "From your phones" marks only rows that match Restro's own round records, never a guess.

**Location pass:** signed by the server (HMAC), naming the venue, the table, the table code's version, the sitting number and the end time. Making a new code kills it. (Plus Q6.)

**The table code (research §10, OWASP):**
- 128 random bits (22 characters). The database stores only its SHA-256 hash and looks codes up by hash, so a database leak exposes no codes and there is no timing leak.
- It is never in a query string, which Cloudflare's request logs record by default. If the QR link carries it in the path, the page swaps it out at once and sends `Referrer-Policy: no-referrer`.
- It is never added as a logged header, and it is stripped from Restro's own logs and Sentry.
- To check before the pilot: whether Railway's request logs record headers.
- Wrong codes from one network: after 20 in 10 minutes, a Turnstile check; after 50, code checks from that address are refused for 15 minutes and the Restro team is alerted. At 128 bits guessing can't work, so this is about noise.

**Prankster limits, per page load (research §5):**
- The page makes a random value at load. It is kept only in memory, never stored on the phone, and dropped by the server within an hour.
- Limits per value:
  - 30 bag adds a minute;
  - a round at most every 15 seconds and 10 in 10 minutes;
  - 5 location tries in 10 minutes.
- D118's 6 rounds per table in 15 minutes stays as Martin set it.
- The research's per-network flood guard of 100 requests per 10 seconds is **not** taken. Merged fix 21's arithmetic shows an honest full club reaches about 500 through one Wi-Fi address, so the rule stays at about 1,000.

**Connectivity (research §9):**
- Every API answer carries a fixed header and a valid shape. Anything else, a Wi-Fi login page included, counts as "no connection", never as an answer.
- When the phone is online but Restro's requests fail, the paused screen adds: "If you are on the venue Wi-Fi, open any web page to log in, or switch to mobile data."

**The waiter panel (research §8, WCAG 2.2):**
- 7:1 contrast, light on dark;
- the reference at 40 px or more, bold, with no text under 18 px;
- no flashing;
- the screen kept awake (Screen Wake Lock) while it shows;
- every state with a word and an icon, announced with `role="status"` / `role="alert"`.

**Allergens:** a research agent reads the Bulgarian food-information ordinance (ПМС 97/2021) on how catering gives allergen information, before the note rule (Q7) is built.

**Staff and POS:**
- Restro's POS credentials are known to nobody at the venue (a venue rule), and Mistral is asked whether an API user can be blocked from the terminal.
- The table-to-bar mapping is checked in the rehearsal with one round per bar. Only the owner changes it, and each change is a Log entry.
- Every guard change is a Log entry, with who and the before and after values.
- The pre-opening check retries every 10 minutes and alerts only if it still fails 30 minutes before opening.
- The Telegram group is owned by the Restro team, with single-use invites. Settings shows who gets alerts.
- The staff card is printable from the Tonight page and covers:
  - a table orders from phones only after a waiter puts on its first item;
  - "QR" rows are real orders;
  - never re-enter a round you can see on the bill;
  - two tickets with the same drinks minutes apart: ask before making the second;
  - the bill's price wins;
  - in phase 2: APP PAY tables are being paid in the app.
- The owner ticks "staff briefed" before ordering is switched on.

**Phase 2:**
- A line-exact match of the payment table against the confirmed lines comes before pay-and-close. Any extra or missing line moves everything back and stops.
- After a close, Restro reads the payment type, amount and receipt number, never just "empty".
- Payment tables are flagged by the connector and named "APP PAY n · do not use". They never get a code or a menu.
- "Receipt printed" needs the receipt number and is answered only by managers or owners.
- Provider notices are signature-checked, and unsigned ones are dropped and counted. The POS no-webhook rule (D41) is untouched.

**Architecture:**
- D122 carries one list of **connector capabilities**, declared by each connector in the integration layer:
  - approval;
  - who entered a row;
  - move lines;
  - move part of a quantity;
  - the bar of a table;
  - several bills per table;
  - the POS's own "open";
  - read closed bills;
  - notes and choices on the ticket;
  - receipt number on close;
  - training mode.
- The paying saga calls four POS-neutral steps: set lines apart, pay and close, read them back, undo. barsy splits a bill, and Mistral moves lines to a payment table.
- GLOSSARY:
  - "bar": who serves a table, one per table;
  - "payment table" (staff say "virtual table");
  - "connection pause";
  - "Tonight" replaces "operations panel".

## 7. New questions to send

**To Mistral Software, adding to 1–29:**
30. When all lines are moved off a table, is its bill closed, or empty and still open? How does a read show the difference?
31. Can an order written by an outside app carry a free-text note per line and the chosen options? Do they print on the bar ticket?
32. Does a ticket print at the table's bar, or does each item print at its own bar?
33. Which rights does an outside app's POS user need to add a round, move lines, take a card payment and close a bill?
34. Can an API user be blocked from signing in at a terminal?
35. Can a close or the fiscal receipt carry a note, such as "for Table 7 · ref K7Q"?
36. Can Restro's card payments use their own payment type, so they are counted apart from the venue's terminal?
37. How does a discount on the whole bill show in a read, and what happens to it when some lines are moved?

**To the pilot venue** (and measured by us on a full night):
- Signal on A1, Yettel and Vivacom in each table zone, including the deepest corner.
- Guest Wi-Fi: open or behind a login page? Can Restro's domain be allowed before the login (the "walled garden")? How many phones can it carry? Are the POS and bar printers on their own wired network?
- Does a ticket print at the table's bar, or at the bar that makes each item? A photo of a ticket (already asked).
- Are there booths with more than one table number, and how are tables joined?
- The opening and closing times per weekday, and the closed nights.

## 8. Settled, so not re-asked

Reviewers proposed these, but Martin has already decided them:
- **A 5-second "Stop" after Send:** #37 2.1, no cancelling once Send is pressed.
  - The research would favour it: Gmail's undo send and NN/g's "undo beats confirm". But it found no ordering app that publishes one.
  - It would also delay every round by 5 seconds at the bar.
  - Martin may reopen it. The lead doesn't recommend it for the pilot.
- **Per-table limits that never freeze a table:** the research suggests rounds wait for staff approval above the limit. D118 4.3 decided "ask your waiter", and approval at Mistral is unknown (C53).
- **Removing a line without a location check:** #40 3.1, every action that changes the bill is located.
- **The Restro team lifting the owner's own pause:** #39 2.7, the Restro admin can lift any pause.
- **Notes visible to every phone at the table:** #40 4.4.
- **Pay-first items before phase 2:** D113 5.4, they say "ask your waiter".

One refinement, adopted because it only follows the law (consent as easy to give as to refuse, D119 9.3): after "Not now", Restro never asks again on its own, but the guest's own tap on "Allow location" in the "Why?" line opens the consent again.
