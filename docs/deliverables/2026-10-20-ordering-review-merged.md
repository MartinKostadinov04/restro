# Ordering review of sections 9–11: the three reviews merged

Made by: the lead session (Opus), 10-20, for Martin. It merges three independent reviews of sections 9 (failures), 10 (privacy and law) and 11 (the technical shape) of `2026-10-20-ordering-what-we-decided.md`, read with `2026-10-20-ordering-check-round-1.md`:
- `2026-10-20-ordering-review-reliability.md` (Opus): what breaks under load or a crash. Cited as **Rel n**.
- `2026-10-20-ordering-review-law-money.md` (Opus): fiscal law, GDPR, payments. Cited as **Law n**.
- `2026-10-20-ordering-review-fresh-eyes.md` (Fable): what a one-club pilot can carry. Cited as **Fresh n**.

They didn't see each other's work. Where they agree, the point is strong.

How this file is built:
- **Part 1:** what all three agree on.
- **Part 2:** the four choices that are yours.
- **Part 3:** the fixes the lead adopts as technical tuning. You asked for those to be decided from best practice and not put to you.
- **Part 4:** the new Mistral questions.

Nothing changes in a D-file until you confirm part 2. Part 3 goes into D122 and the D-notes with it.

## Part 1: where all three agree

1. **A POS that doesn't answer is not a "no", for money too** (Rel 1, Law 1; Fresh agrees on rounds).
   - Round 1 said that if the POS refuses *or doesn't answer* the close, the reserved money is released. That is wrong.
   - Story: at 02:10 Restro closes the virtual table "QR-2" with a €38 card payment. The POS closes it, the fiscal receipt prints and the bar pours, but the answer is lost on the way. Restro releases the €38. The venue has a receipt and a sale, and no money.
   - The rule becomes the same as for rounds (5.6): a timeout is read back, never guessed.
2. **Paying in the app carries almost all of the open risk.** Every unknown Mistral fact sits there: whether a move reprints, what prints on a virtual table, which device prints the receipt. So do every money failure and the receipt law (Fresh 1; Rel 1–4; Law 1–6).
3. **What is sound** (all three):
   - never resending a round;
   - "Unconfirmed" with no Try again, and the guest's phone as the channel to the waiter;
   - action ids that replay the first answer;
   - locks as rows in the database;
   - the Log, append-only;
   - the three sizes of failure, and the menu that never goes down;
   - the owner unable to lift Restro's pause;
   - consent before the location check, and nothing stored;
   - Restro never holding money;
   - connector capabilities and invisible deadlines (round 1);
   - the Healthchecks.io watchdog.

## Part 2: four choices for Martin

**Choice A · Open the pilot with ordering on the bill only, and add paying in the app as phase 2.** (Fresh 1, backed by part 1.2)
- Night one would be: the guest taps, a ticket prints at the right bar, the waiter brings the drinks, and the table pays at the end as it does today. Pay-first items say "ask your waiter", as 1.11 already plans.
- Phase 2 starts once Mistral has answered the paying questions (11–13, 17, 24–26).
- This matches your standing rule, "payment is designed now, built later". The design stays; only the build waits.
- **Recommendation: yes.**

**Choice B · The order of steps in "pay for your own items" (8.1).** (Rel 4, Law 8)
- What you approved in round 1:
  1. move the lines to the virtual table;
  2. read them back;
  3. the guest confirms;
  4. the card;
  5. close.
- The reviewer's problem with it: the lines sit on the virtual table for up to 12 minutes while the guest confirms and passes the bank's check. With 4 virtual tables per bar, closing time jams: "busy" for most payers. Every guest who walks away costs two moves (each maybe a reprinted ticket). A late bank approval can close the *next* guest's lines.
- The fix keeps your aim, that the guest pays exactly what the POS holds:
  1. The guest confirms the lines from a **fresh reading of the real table**. That is the same check, and the same total.
  2. The card is approved: the money is reserved.
  3. Then, in a few seconds, Restro moves the lines, reads the virtual table back, closes and captures.
  4. If the read-back total is lower, Restro captures the lower amount. If it is higher, the lines move back and the reservation is cancelled.
- A virtual table is busy for seconds, not minutes, and a walk-away costs nothing in the POS.
- **Recommendation: take the fix.**

**Choice C · Alerts for the pilot go to one Telegram group per venue, not as push alerts from a staff panel installed on phones.** (Fresh 3, Rel 13, Law 13)
- At 02:00, at 110 dB, nobody reads a phone in a pocket. Web push on an iPhone also needs the panel on the home screen, a permission and luck.
- The person who matters for a stuck order is the waiter at the table, and the guest's phone already reaches them. Alerts are for the owner, the manager and the Restro team.
- One group gets:
  - "paused";
  - "back";
  - each Unconfirmed order, with its table and reference;
  - the money alerts.
- **Money alerts** (stranded lines, an unconfirmed payment, a failed capture) go out at once. They repeat every 5 minutes until someone taps "Done", even outside quiet hours.
- Alerts never carry order notes or anything about a guest: Telegram has no data-processing agreement with Restro.
- Push from the panel stays **later**. This changes D120's alert channels.
- **Recommendation: yes.**

**Choice D · Turnstile never shows a puzzle at a club table.** (Fresh 5)
- D119 chose Cloudflare Turnstile in "managed" mode. That mode can show a challenge to a phone on a VPN, Apple's Private Relay or an unusual browser. A guest who meets a puzzle at 01:00 tells the table the app is broken.
- The fix: the invisible mode (non-interactive), and count the phones that get no result.
- The location check, the open-table rule, the €150 cap and the pace limit already guard a single club.
- **Recommendation: yes.**

**Not a choice, but for you and the venue:**
- **The waiter brings the paper receipt to the guest** (Law 4). The law wants the receipt handed over at the moment of payment (Н-18 чл. 25, ал. 6). A receipt left at the bar risks a fine of 1,000–4,000 лв, and an NRA test purchase through the app would find it.
  - So the screen after paying says "Your waiter brings your receipt".
  - This also makes the virtual tables per bar (6.10 a) a legal need: the receipt prints at the bar that serves the table.
  - The venue must agree to this way of working.
- **A rehearsal at the club before the first guest night** (Fresh 12):
  - three tables, the staff on shift, and a one-page card at each bar: "A guest shows you this screen: if the items are on the table's bill, the drinks are coming; if not, enter them; never twice";
  - rule 7 forbids tests on a live POS, so Mistral is asked for a training mode (question 27);
  - you and the venue decide how it runs.

## Part 3: fixes the lead adopts (technical tuning)

Each line says what changes and where it lands. The reviewers name the source of every value.

**Money (phase 2, designed now)**
1. **Payment unconfirmed** (Rel 1, Law 1): a new state.
   - After a timeout on the close, Restro reads the virtual table back for about a minute. Restro alone uses that table, so "empty after the close" means "closed".
   - If it is still unclear, the payment is Unconfirmed: the money stays reserved (card reservations last about 7 days) and staff are alerted.
   - Staff answer in the panel. "Receipt printed" takes the money; "No receipt" releases it and moves the lines back.
   - On a mismatch, Restro takes what the receipt shows if it is within the reservation, and never just releases.
2. **A capture that fails after the receipt printed** (Law 2): Restro retries it with the same key through the service day and alerts the team after 1 hour. If it is still not taken after 4 days, the venue reverses the receipt (a storno, allowed until the 7th of next month, Н-18 чл. 31, ал. 3–4).
3. **"Download receipt" is the provider's payment confirmation, never a copy of the fiscal receipt** (Law 3).
   - Only one fiscal receipt may exist, and no other document may say "фискален" (Н-18 чл. 25, ал. 9; чл. 7а, ал. 3).
   - The download shows the venue, the time, the amount, the lines and the provider's reference. It is given once, on the paying phone.
4. **Two-step payment is a go/no-go for the provider** (Law 5): "reserve, then take" (authorise, then capture). The fallback "charge, refund on a clear no" can leave money with no receipt, which is the case that can seal a club. myPOS has it, but its support must switch it on.
5. **"Closed" means "the receipt printed"** (Law 6). The receipt number goes on Restro's payment record. A close with no receipt number alerts staff: "Print the receipt for QR-3".
6. **Virtual tables are fiscally clean if** (Law 7):
   - Restro closes with the **card** payment type, never cash;
   - each payment record links the real table, the virtual table, the receipt number and the provider's reference;
   - the venue can match the provider's payouts to its card totals.
7. **Every in-app payment at a one-bill POS goes through a virtual table**, the whole bill included (Rel 9). Only Restro writes there, so a waiter's round can't slip in between "confirm" and "close". While lines are away being paid, the real table still counts as open.
8. **Steps that can't happen twice** (Rel 4, Law 8):
   - each provider notice is stored once, by its id;
   - each step moves the payment record only from the state it expects;
   - before any undo, Restro cancels at the provider first, and if the provider already approved, it finishes instead;
   - a venue pause stops new payments only, and running ones finish or undo.
9. **Restro's key to the venue's provider account** can create, take and cancel payments only, never refund or pay out (Law 9). A refund the venue makes shows on Restro's record with "Make the storno in the POS now".
10. **The evidence for a card dispute stays 18 months on the payment record** (Rel 15, Law 10): lines, total, times, the 3-D Secure result and the receipt number. The Log goes after 31 days, and disputes come up to 120 days later.
11. **Card data** (Law 14):
    - card fields only in the provider's frame, with a strict content policy on the pay screen;
    - Restro stores no card number, no expiry date and no last four digits;
    - a one-page PCI statement for venues.
12. **Smaller points** (Law 15):
    - Restro's fee is invoiced separately and never taken from guest payments (so Restro needs no payment licence);
    - a tip is added before paying, never at capture;
    - prices show in euro.

**The worker and the POS (phase 1)**

13. **The job system never resends on its own** (Rel 2).
    - pg-boss as installed retries a failed job twice, and notices a crashed one only after 15 minutes. That means a second ticket 15 minutes late.
    - Every job that writes to the POS or the provider gets:
      - no automatic retry;
      - a first step that reads what already happened;
      - a 2-minute expiry;
      - a recovery sweep every 15 seconds.
    - A test pins these settings.
14. **Locks can't be overrun by a slow worker** (Rel 3):
    - every POS call has a hard limit of 20 seconds, inside a 60-second lock that is renewed while the worker works;
    - every write checks the worker still holds the lock (a fencing token);
    - a virtual table is freed only when its payment ends, never by a timer.
15. **A dead worker pauses the venue** (Rel 5, Fresh 7):
    - The worker writes a heartbeat every 10 seconds. One older than 30 seconds shows as a Restro-started venue pause.
    - During service hours, a cheap POS read every 30 seconds finds a dead link before a guest's order does.
    - A queued round older than 2 minutes becomes Not sent. That is safe, because it never left.
    - No deploys during service hours.
16. **"Did it land" compares the bill before and after** (Fresh 13, Rel 6).
    - Restro reads the table just before sending. After a timeout it reads again, and rows that are new and match the round mean Added. Restro's own POS user and the time are extra filters where the POS gives them, with the time only a loose one, because venue PCs' clocks drift.
    - "Who entered a row" becomes an improvement, not a must (checker R4).
17. **One breaker per POS connection, kept simple** (Rel 7, Fresh 2).
    - If each bar is its own Mistral login, one bar's broken login must not hide behind the others.
    - The breaker:
      - pauses after 60 seconds with no good call;
      - probes with a cheap read every 30 seconds;
      - lifts after 2 good probes, with "Ordering is back".
    - Dropped for the pilot: the 5-minute re-trip window and the "third pause in 30 minutes" rule. A flapping venue is held by hand by the Restro team (9.5).
    - While a pause is on, display readings stop, but read-backs and payment undo steps still go through.
18. **The table pause can't end in double drinks** (Rel 8):
    - the duplicate warning (5.2) also covers the table's Unconfirmed orders for the whole service day;
    - only moves by other users, never Restro's own payment move, lift a table pause;
    - paying stays allowed during a table pause, because payments are read back.
19. **POS call budget** (Rel 11): one queue per connection, at most 2 calls at a time, with lanes:
    1. sends and read-backs;
    2. payments;
    3. display readings, which are shed first.
20. **Polling stays cheap** (Rel 10, Fresh 9).
    - At peak that is about 200 requests a second. "Unchanged" is answered from a version number per table, with no lock.
    - Time-driven changes run in a worker sweep every 2 seconds.
    - The POS is read at most once per table every 15 seconds for display.
    - A load test at 600 phones on staging runs before the pilot.
21. **Abuse limits sized from arithmetic** (Rel 12, Fresh 9).
    - The whole club shares one Wi-Fi address. Cloudflare's rule on the actions address is a flood stop at about 1,000 requests per 10 seconds; the honest worst case is about 500.
    - The web's limit per table code is 20 requests a second.
22. **The watchdog checks everything** (Rel 14). Each minute a worker job:
    - calls the web's health address;
    - checks the database and the oldest waiting job;
    - pings Healthchecks.io only if all pass.

**The guest and staff screens (phase 1)**

23. **An Unconfirmed order belongs to the table** (Fresh 8).
    - For 15 minutes every phone at the table shows "An order from this table couldn't be confirmed · ref K7Q · show this to your waiter". A dead phone no longer takes the reference with it.
    - While a round is on its way, its lines show greyed "Being sent" on every phone, so nobody rebuilds and resends them.
24. **The guest's panel is the staff's screen** (Fresh 14).
    - Restro can't print, so the waiter reads the panel. It shows:
      - the reference in large type;
      - the items, with the POS's public names;
      - the time;
      - the two lines of the staff card.
    - This answers 5.13's open point with the recommended yes.
25. **A weak signal doesn't look like "the club's system is down"** (Fresh 11). It shows "Weak connection. Your order is saved, we keep trying." with Send greyed. "Ordering is paused" shows only when the server says so.
26. **The stale-action check doesn't use the phone's clock** (Fresh 10). "Stale" means the table's order changed since the phone saw it, or the server stamps the action id when it hands it out.
27. **End-of-night reconciliation** (Fresh 6).
    - One page per service day, also as CSV, lists:
      - rounds sent, Added, Not sent and Unconfirmed;
      - in phase 2, payments with amount, bar, virtual table, provider and receipt references;
      - a mismatch list.
    - At the service day's end, the totals and the mismatches go to the Telegram group.
28. **The Log, trimmed for the pilot** (Fresh 4).
    - Kept: the Log as stored entries.
    - Instead of a separate panel and a search screen: one "Tonight" page in the existing admin, with the night's rounds, the exceptions and "Resume table".
    - Added: the raw request and answer of every POS call, 31 days, seen by the Restro team only. It holds nothing personal. This closes 10.1's open item.

**Privacy (phase 1)**

29. **Error reports and logs never catch the table code or a position** (Law 12). Restro strips request bodies and the table-code header in Sentry and in the logs, writes down Railway's log retention, and says in the privacy notice that backups keep erased rows for 30 days.
30. **Order notes are erased after 31 days** (Law 13). "No nuts, allergy" is health data. Notes never go into an alert. This closes "How long order notes are kept".
31. **Restro's own uses of orders** (Law 11).
    - Restro's fee and its insights use totals only, with no payment reference. Otherwise Restro becomes a controller for them, and the privacy notice must say so.
    - Before a purge, the venue gets an export of its payments.
32. **A correction to round 1:** the guest's duty to take the receipt is in ЗДДС чл. 118, ал. 1, second sentence. Ал. 1а is the guest's right not to pay when no receipt is issued.

## Part 4: new questions for Mistral Software

These add to the checker's questions 1–23.
24. Can the API read today's **closed** bills on a table, with their payments? A pay-first sale opens and closes in one call, so checking it means reading a closed bill.
25. Does a close return the fiscal receipt's number? Can a close succeed while the fiscal printer fails?
26. Which payment type does a close from an outside app use? Can it be set to "card"?
27. Is there a **training mode** or a test installation for a rehearsal at the venue?
28. What are the API's rate limits? Where does it run (the venue's PC or a server)? Can one call read every open bill of the venue?
29. (Phase 2) Can the day be closed while a virtual table still has an open bill?

## What happens on your yes

Once you confirm part 2, the lead:
- writes D122 (one bill per table, virtual tables, bars, tickets, phases, payment unconfirmed) and the notes on D112, D115, D116, D117, D119 and D120;
- updates GLOSSARY ("the table's order", "round", "virtual table", "bar ticket", "payment unconfirmed");
- adds questions 19–29 to `docs/connector-questions.md`;
- moves T69 ahead of #47 in the tracker.
