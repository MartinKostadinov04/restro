Made by: reviewer (Opus), 10-20, for Martin's check of sections 9–11

# Ordering review: reliability under load and failure

Read: sections 9–11 of `2026-10-20-ordering-what-we-decided.md`, with `2026-10-20-ordering-check-round-1.md` winning where they differ, plus D112, D117, D120, D121 and the guest-API and locking designs. Lens: what breaks with two things at once, or a crash halfway. Test night: 50 tables, 300 phones, 4 bars.

## Findings, most important first

**1. A payment timeout is treated as a "no"** (round 1 on 6.8; 8.4; 6.10). **Must fix before the pilot.**
- Round 1 says the hold is cancelled if the POS refuses *or doesn't answer*. A timeout says nothing: the design already knows this for rounds (5.6).
- Story: at 02:10 Restro closes virtual table QR-2 with a €38 card payment. The answer is lost, so Restro cancels the hold. But the POS did close the bill, the fiscal receipt printed and the bar poured. The venue books €38 of card income it never gets.
- Same loss in 8.4: the bill closed for another amount (a waiter's round came first), and the hold is released while the POS still shows Restro's card payment.
- Fix: capture exactly what the POS shows as Restro's payment on a closed bill. Cancel only when the POS clearly shows none. While unknown, keep the hold (card holds last days; Stripe: 7), mark the payment **Unconfirmed**, alert, keep reading.
- POS fact needed: a pay-first sale opens and closes in one call, so checking it means reading a **closed** bill. New Mistral question: "Can the API read today's closed bills on a table, with their payments?"

**2. The job system resends by default** (11.4; payment queue on pg-boss). **Must fix before the pilot.**
- The installed pg-boss 12 retries a failed job twice (`retryLimit` 2) and only notices a crashed job after 15 minutes (`expireInSeconds` 900).
- Story: a Send job dies mid-call; 15 minutes later it runs again. A second ticket prints, after the table already ordered from the waiter.
- Fix: every job that writes to the POS or the provider gets `retryLimit: 0`, starts by reading what already happened, and expires in about 2 minutes. A recovery sweep checks unfinished orders and payments every 15 s. A test pins these settings.

**3. Locks expire while their owner is still working** (4.5; the virtual-table lock). **Must fix before the pilot.**
- A deadline frees a lock when its owner dies, but also when it is merely slow.
- Story: worker A's close on QR-2 hangs 70 s and its lock expires. Worker B reads QR-2 as empty and moves table 12's lines there. A's close then lands and closes table 12's drinks for table 7's amount.
- Fix: every POS call has a hard time limit well inside the lock (call ≤ 20 s, lock 60 s, renewed while working). Each recorded step checks its lock token is still current (a fencing token). A virtual table is freed only when its payment ends (closed, or moved back and read empty), never by a timer; a timer only starts the undo.

**4. Lines wait on a virtual table before the card is approved** (round 1, 8.1 steps 2–8; 8.5). **Must fix before the pilot.**
- Lines move first, then wait while the guest confirms (2 min) and passes the bank check (up to 10 min). At closing time:
  - 4 virtual tables per bar clear only about 1–2 payments a minute, so at 05:30 most payers hit "busy";
  - every walk-away costs a move out and a move back, each a possible reprinted ticket (unknown) and stranding;
  - at 01:40:05 the deadline moves lines back and frees QR-2; at 01:40:20 the bank approves, and the provider's notice makes Restro close QR-2, now holding the next guest's lines.
- Fix, keeping Martin's aim (pay only what the POS holds): the guest confirms from a fresh reading of the real table; the card is approved (held); then move, read back, close and capture in one worker run of seconds. A lower read-back total is captured as lower (allowed); a higher one moves back and cancels. Before any undo, cancel at the provider first; if it was already approved, finish instead. Store provider notices once by event id (an inbox), and let each step advance only from the state it expects (compare-and-set).

**5. A dead worker is not a named failure** (9.1, 9.2, 9.9). **Must fix before the pilot.**
- The venue pause counts failed POS calls; a dead worker makes none. Every Send shows "Sending…" forever, and a returning worker sends rounds 20 minutes stale.
- Fix: the worker writes a heartbeat every 10 s; older than 30 s, the web shows a Restro-started venue pause. A Waiting order older than 2 minutes becomes Not sent (safe: it never left); an approved pay-first never written to the POS is cancelled. No deploys during service hours.

**6. The read-back trusts the POS's clock** (5.6, 9.6). **Should fix.**
- "Rows entered after the order went out" compares the venue PC's clock with Restro's; venue PCs drift minutes.
- Fix: read the table just before sending; "Added" means new row ids by Restro's user matching the round's items and quantities. Time is only a loose filter (±10 min).

**7. One breaker for the venue, which also blocks recovery** (9.2, 9.4; round 1, 2.10). **Should fix.**
- If each bar is its own Mistral login, one bar's broken login hides behind the others' good calls.
- Fix: one breaker per POS connection; a venue pause is all of them open. While open, stop display readings, but let order read-backs and payment undo steps through, slowly.

**8. The table pause can end in double drinks** (9.6, 5.2). **Should fix.**
- Without "who entered a row", the pause lifts after 15 minutes: exactly when the 15-minute duplicate warning stops covering the Unconfirmed round. Story: a round ends Unconfirmed at 01:15 but did land; at 01:31 it is resent with no warning.
- And "a bill moved" lifts the pause, while Restro's own payment move is a move.
- Fix: the duplicate warning checks the table's Unconfirmed orders for the whole service day; only moves by other users lift a pause. Name what a table pause does to paying (recommend: still allowed, since payments are read back).

**9. Unnamed states when paying at Mistral** (8.3, 3.4, 4.6, 7.2). **Should fix.**
- Paying the whole bill on the real table races the waiter: a round entered between confirm and close leaves the bill closed for the wrong total.
- Fix: route every in-app payment at a one-bill POS through a virtual table, where only Restro writes. While lines are away being paid, the real table still counts as "open" (so friends can Send), and their leaving must not count as "all bills closed" (which clears earlier orders).

**10. Polling load** (3.3, 11.1). **Should fix.**
- 300 phones at 2 s is up to 150 requests a second to one web process, each crossing Amsterdam to Ireland. Two parts turn reads into writes: a request after `next_change_at` runs changes under a row lock, and an old bill view queues a reading.
- Fix: "unchanged" costs one indexed read with no lock; a worker sweep every 2 s does timed changes; a fresh reading is asked once per table per 15 s at most. Load-test 600 phones before the pilot.

**11. POS call budget** (7.1, 9.4). **Should fix.**
- Refreshing 50 tables every 15 s is 3–4 POS reads a second on top of sends and payments, maybe on the venue's own PC and line.
- Fix: one queue per connection, at most 2 calls at once, priority lanes (writes and read-backs, then payments, display readings last and shed first). Ask Mistral its rate limits, where the API runs, and whether one call reads all open bills (as barsy's `Places_getlistwithaccountsonly` does).

**12. One Cloudflare limit per network can pause the whole club** (11.3). **Should fix.**
- All guests on the club Wi-Fi share one address: one trip blocks every phone 10 s, after which phones show "Ordering is paused".
- Fix: set it as a flood stop only, about 1,000 requests per 10 s; the legitimate worst case (50 tables × 60 changes a minute) is about 500.

**13. Money-at-risk alerts are rated like ordinary ones** (9.8, 9.11). **Should fix.**
- Stranded lines, an Unconfirmed payment and a failed capture: grouped, one reminder, silent after hours, on a phone in a loud club.
- Fix: alert at once, repeat every 5 minutes until someone taps "Done", ignore quiet hours, and reach the Restro team on Telegram at once so it can phone the venue.

**14. The watchdog sees only whoever pings it** (9.9). **Should fix.**
- Fix: a worker job each minute calls the web's public health address, checks the database and the oldest waiting job, and pings Healthchecks.io only if all pass. One ping then covers web, worker, database and queue.

**15. The Log is shorter than a card dispute** (9.10, 10.1). **Nice to have.**
- Disputes can come about 120 days later; the payment's steps are the evidence. Copy them into the payment record (18 months), or keep payment entries 180 days.

## What is sound

- Never resending a timed-out round; read-back, then "Show this to your waiter" (as Toast and Square do).
- Locks as database rows: taken in one step, released by token, held milliseconds, never by a phone, always bag first (no deadlock).
- Action ids replaying the first answer, unique-indexed, checked first: Stripe's idempotency pattern.
- The Log written in the same transaction as each change, append-only (Stripe, Shopify).
- The breaker's shape: minimum pause, randomised probes, 3 good probes, a flap guard.
- POS write only after card approval, capture only after the POS confirms: the right order, once a timeout stops counting as "no" (finding 1).
