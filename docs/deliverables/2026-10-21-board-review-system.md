# Board review: the whole ordering design, system perspective

Made by: board reviewer (Fable), 10-21, system perspective. For: Martin and the lead, before D122 is written.

Read: the four board files, D110–D121, the six decision logs, the Mistral checker and both round-2 opinions. Item numbers are the unified doc's unless marked (fix n = merged part 3, r1 = round 1, r2 = round 2). Severity: **must** before the pilot (phase 2 items: before paying is switched on), **should**, **nice**.

## 1. UX/UI

1. **Capabilities are named in five places and listed nowhere** (r1 2.2, 3.4, 7.8; fix 16; checker R4–R10; r2 §4.1). The platform branches on them: Awaiting approval, the open-table definition, the payment route, per-connection pauses, which settings show. Propose D122 carries one list (approval; who entered a row; move lines; partial quantity; bar of a table; several bills per table; the POS's own "open"; read closed bills; note on a ticket; receipt number on close; training mode) as a manifest in the integration layer, declared by each connector. **Must.**

2. **Who sees an Unconfirmed round.** 5.7 and D121: only the sending phone sees progress, and its reference stays until the guest closes it. Fix 23: every phone shows it for 15 minutes, and lines show greyed "Being sent" on every phone, while 5.1 says Send moves the lines out of the bag. Both are adopted. Propose: fix 23 wins; "Being sent" lines are a third zone (neither in the table's order nor on the bill), don't count against the 50 lines, and return to the order on Not sent. **Should.**

3. **"Order" will mean two things after the rename** (r1 4.1). The table's order is the pre-send thing; but D111's stored "orders", D116's "order states", "Unconfirmed order", the 18-month "orders and payments" and the Log's "orders" all mean the sent thing. Propose: the record Restro keeps is a **round** (guest round, staff round) with **round states**; "order" alone never appears in code. **Should.**

4. **Table → bar is needed in phase 1 if each bar is a login.** 2.10 says only the virtual tables need it. If Q19 answers "one login per bar" (r1 2.10, R16), every on-the-bill round must pick the table's bar's login, so the mapping is phase 1 and "Restro's POS user" (5.6, 5.13, 9.6, D118) becomes a set. **Should; must if Q19 is yes.**

5. **Three names for the staff screen.** D120 and GLOSSARY: an operations panel with push. Fix 28: one "Tonight" page in the admin. R2 §2: an alerts page in the admin. "Resume table" (9.6), "Receipt printed / No receipt" (fix 1) and "Done" on money alerts (r2 §2) each sit on a different one. Propose one "Tonight" page with alerts on top, and GLOSSARY rewritten to it. "Done" tapped in the admin at 02:00 won't happen: let the Telegram message carry the button through the bot. **Should.**

6. **"Open table" has three definitions.** GLOSSARY/D118: a waiter started a bill. R1 3.4: the bill has at least one line. Fix 7: still open while lines are away being paid. Unstated consequence: after an in-app whole-bill payment at the pilot the real table reads empty, so the next on-the-bill round says "Ask your waiter to open your table". Propose: open = the reading shows ≥1 line, or Restro's own running payment holds lines taken from it; the empty-after-payment case is accepted and written down. **Should.**

7. **Three texts for the receipt line.** D117 "Paid. Your receipt is at the bar"; r1 7.3 "Your paper receipt is at the bar"; merged "Your waiter brings your receipt" (чл. 25 ал. 6). Take the merged one everywhere, 6.9 included. **Should (phase 2).**

8. **D121 and D119 are missing from the amendment list** (merged "What happens on your yes"). R1 removed the countdown and the token (D121's "payment countdowns", D117 4.13–4.17), fix 23 changed D121's "only the sending phone", r2 §3 changed D119's Turnstile mode, r2 §4 replaced D120's breaker. **Should.**

9. **Phase 1 and pay-first items** (choice A, 1.11). If pay-first items can be added to the table's order, Send skips them and they sit marked "ask your waiter" forever. Propose: until phase 2 the composer hides the payment mode and every item is on the bill. **Should.**

10. **Terms the GLOSSARY lacks.** "Bar" is not an Area (where guests sit): define it as who serves a table, one per table. "Virtual table" is the venue's jargon; the platform's name should be POS-neutral ("payment table", as r1 2.8's "tables for payments"), "virtual" only in the connector. "Connection pause" (r2 §4.1) needs an entry beside venue pause. **Nice.**
## 2. Security and robustness

1. **Never close a bill holding lines Restro didn't put there.** R1 8.1 step 4 and choice B check the total. A waiter can move a bill onto QR-3 between the empty check and the move, or the move can apply to some lines only. Choice B's "lower → capture lower" would then pay a part and show "Paid". Propose: a line-exact match of the payment table's read-back against the confirmed lines; any extra or missing line → move back and abort; capture lower only when a fresh read of the real table shows the missing line was voided, not left behind. **Must (phase 2).**

2. **Partial quantities.** If R10 says no (2 of 5 beers), the bill screen may only let whole lines be ticked; the board never says so and #45 will design "2 of 5". Decide now. **Must (phase 2).**

3. **Rule 1 vs service writes.** `core.apply(changeSet)` is a menu pipeline with provenance, `events` and snapshots. Phase 1 adds 6,000–12,000 bag writes a night, atomic lock takes, idempotency answers, readings, round records and a Log "apart from `events`" (11.6); D121 5.4 says all go through the one write path. An agent will stop here on the first ticket. Propose: a second write path in `core` for service state, same provenance columns, the lock take as its one conditional update; D122 says it. **Should (first-ticket blocker).**

4. **The POS-neutral seam of paying is unnamed.** barsy splits to a new bill on the same table (`Accounts_divide`, merge back); Mistral moves lines to another table (move back). Without a neutral vocabulary the saga gets built around Mistral. Propose four connector steps the platform's saga calls: `isolateLines`, `payAndClose`, `readIsolated`, `undoIsolate`; the queue per bar, the deadlines and the Log stay in the platform. **Should.**

5. **Provider notices are webhooks.** D41 and rule 7 forbid webhooks; they mean the POS. Fix 8 stores each notice by id but never says the provider's signature is verified. Write both down: provider webhooks are allowed, every notice is signature-checked, unsigned ones are dropped and counted. **Should (phase 2).**

6. **"Receipt printed" must carry the receipt number** (fix 1). A wrong tap captures a card for a bill the bar later took in cash: a double charge. Require the number, check it against R13's read of the closed bill where the POS gives it, and Log who answered. **Should (phase 2).**

7. **The location pass** (3.7) is a bearer note with no phone identity, so it is transferable: whoever gets the code photo can get the pass too. Accepted cost, but bind it to the code's generation, not the table, so re-issuing a leaked code kills it, and sign it (HMAC, server key) with venue, code and expiry inside. **Should.**

8. **The table-code header at Cloudflare.** Fix 29 strips it from Sentry and the logs, not from Cloudflare's request logging or WAF payload logs. Add it there. State the code's entropy (≥128 random bits, constant-time compare) and a per-network limit on bad codes (20 per 10 minutes). **Should.**

9. **A partial bill read is a failed read** (rule 6's analogue). The board says a failed reading pauses the table, not that a read with a missing page concludes nothing: it must never clear the table's order (4.6), lift a table pause (9.6) or refuse with "Your bill changed". **Should.**

10. **The probe** (r2 §4.3) must reach the venue's POS, not a cloud relay that answers while the PC is off (opinion §5; Q28); its 3-second limit should be a connector constant set from the test installation's p95. **Nice.**

## 3. NB

- NB: Rule 8 applies to readings: Mistral's amounts are parsed losslessly and the bill's total is the POS's number, never a sum Restro makes.
- NB: "Restro's POS user" is a set wherever bars log in separately; the read-back filter, the guest/staff marking, the table-pause lift and the ticket's operator name all take the set.
- NB: Vendor-word guardrail: "payment table", "bar", "one bill per table" are capability names in platform code; "Mistral" lives only in its connector; settings text uses {source}.
- NB: The payment record's fields are scattered over 1.10, r1 2.10, fixes 5, 6 and 10, r2 5.3 and 5.6 (no last 4); D122 lists them once.
- NB: Notes erased at 31 days (fix 30) on a record kept 18 months is a column-level purge through the purge role; the Log and the raw POS log count 31 days by service day.
- NB: A worker restart is a venue pause (fix 15), so every deploy is one; the runbook names deploy windows outside service hours.
- NB: During the 5-minute watch one write per connection (r2 §4.6) makes a venue-wide queue; with fix 15's 2-minute rule a recovery at peak becomes a wave of Not sent. Show "Ordering is back, busy for a moment" rather than "Sending…", and don't count those as Unconfirmed.
- NB: The pre-opening check (2.6, 9.3) at a per-bar-login venue needs every bar logged in 2 hours before opening; otherwise the venue opens paused and lifts connection by connection.
- NB: In phase 1 nothing about payment tables, the bar queue or 2.9's check shows in the pilot's admin; the capability gates it, the schema reserves it.
- NB: Make the reading one venue-wide read every 15 s where the POS allows it (barsy: places with accounts; Mistral Q28), per table only as a fallback; otherwise fix 19's budget of 2 calls sheds display reads at 50 tables.
- NB: A choice-B move can wait up to 90 s behind a Send in Checking (r1 6.7), so a payment table is busy "up to two minutes", not "seconds".
- NB: D110's guardrail test must list "move lines between tables" and "close with a card payment" as declared waiter actions before the Mistral write module exports them.
- NB: At 07:00 the table's order is cleared under the fingers of a group still ordering; clearing only idle orders then is a one-line amendment to D117 (nice).

## 4. Possibly forgotten

1. **Topic: what "closed" means at a one-bill POS.** D117 clears the table's order, D120 lifts a table pause and 7.6 shows the empty bill on "the table's POS bills close". At Mistral a bill may be *emptied* by a move (an in-app whole-bill payment, a waiter's split) and never "closed", or the table may be always live (Q22). Nothing says whether an emptied bill counts. Checked #36 rows 1.2–1.8 and #37 5.3: both assume a close event exists. Not in Q1–29. Propose Q30 and the rule: closed = the connector reports closed, or a complete reading shows the bill gone or empty after a non-empty one. **Should.**

2. **Topic: ticket routing, per table or per item.** Fact 2 says a ticket prints at the table's bar. Many clubs route by item (cocktails at the cocktail bar) or both. If per item, one round prints at two bars, a mixed pay-first round has no single bar for its payment table, and "the bar has your ticket" (5.8) is plural. Checked: not in any log; Q13 asks what prints, not where. Ask the venue with the ticket photo. **Should.**

3. **Topic: the rights of Restro's login.** Adding a round is a waiter right everywhere; moving lines, card payments and closing are manager rights in many POS. A waiter-level login could do phase 1 and be refused phase 2. Checked D110 and the checker: Q12 asks whether an outside app can order, pay and close a virtual table, not which rights the login needs. Add to Q12. **Should (phase 2 go/no-go).**

4. **Topic: Restro's fee on voided rounds.** D111 counts the fee from orders; D118's last line of defence is the waiter voiding a "not ours" round in the POS, which Restro sees only as lines gone from a reading. Checked #35 2.4: not addressed. Propose: the fee comes from fix 27's end-of-night reconciliation, rounds Added whose lines are still on the bill or were paid, with the venue able to dispute a night. **Should.**

5. **Topic: proving the first write at the pilot under rule 7.** If Mistral has no training mode (Q27), the first round a guest sends is the first write ever made on that installation. No fallback is decided. Propose: on opening night the manager, with a staff table code, sends the first round, served and paid as a real sale; that is service, not a test. Checked D110 and the merged rehearsal note. **Should.**

6. **Topic: guest/staff marking of rounds without "who entered a row".** Fix 16 made R4 an improvement; 3.2 and 7.2 still promise the marking, and fix 23 and 9.6 lean on it. Checked #35 1.5 and #40 1.3: the marking is firm, its source never named. Propose: "from your phones" only on rows that match Restro's own round records; no "staff" label by guess. **Should.**
