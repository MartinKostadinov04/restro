Made by: reviewer (Fable), 10-20, for Martin's check of sections 9–11

# Ordering review, fresh eyes: sections 9 (failures), 10 (privacy and law), 11 (the technical shape)

Read against sections 0–8 and Martin's round-1 answers. Lens: what a one-club pilot can carry on its first real night. Severity: **must fix before the pilot**, **should fix**, **nice to have**.

## Cut or defer

**1. Open the pilot with ordering on the bill only; in-app payment is phase 2.** (6, 8, 8.5, 9.11, the virtual tables in 11.4, the payment queue) · **must fix before the pilot.**
Every unknown Mistral fact sits in paying: does a move reprint a ticket, what prints on a virtual table, which device prints the receipt, can the day close with "QR-3" open. Ordering on the bill needs two facts (see "Which Mistral fact first"). The club already pays one bill per table at the end, so night one is "guest taps, ticket prints at the right bar, waiter brings the drinks". Pay-first items already say "ask your waiter" (1.11). Deferring payment takes the saga, stranded items, the provider and the receipt-law question (8.7) off the first night. Recommendation: ship ordering first; start payment when Mistral has answered questions 11–13 and 17.

**2. Simplify the breaker.** (9.4) · **should fix.**
Keep: pause after 60 s without a good call, probe with a cheap read, lift on good probes, say "Ordering is back". Drop: the 5-minute re-trip window, the "third pause in 30 minutes" rule and the second randomised ladder. Each is a branch nobody will see tested before 01:00 on a Saturday. Practice (Resilience4j, Polly defaults) is one ladder and one count: probe every 30 s, lift on 2 good probes. A flapping venue is the team's to hold by hand (9.5).

**3. One Telegram group per venue instead of push from an installed panel.** (9.8, 2.7) · **should fix.**
At 02:00 under 110 dB nobody reads a phone in a pocket, and web push on an iPhone needs the panel on the home screen, a permission and a live background. The person who matters for an Unconfirmed order is the waiter at the table, and the guest's phone already reaches him (9.7). Alerts are for the owner and the team, afterwards. Recommendation: one group (owner, manager, Restro team) gets paused, back, and Unconfirmed with table and reference; one reminder after 10 minutes instead of three ladders. Push stays later.

**4. Keep the Log table; defer the Log screen and the separate panel.** (9.10, 11.6) · **nice to have.**
The table is the evidence D111 needs and is cheap. The search screen and a separately installed panel can wait: one "Tonight" page in the existing admin, with the night's rounds, the exceptions and "Resume table". Add instead the raw request and answer of every POS call, 31 days, team-only (10.1's open item): nothing personal is in them, and on the first nights every question is "what did we send and what did Mistral say".

**5. Turnstile must never show a puzzle at a club table.** (10.6, 5.3) · **should fix.**
Managed mode can challenge a phone on a VPN, a private relay or an odd browser. A guest who meets a puzzle at 01:00 tells the table "it's broken". Recommendation: the invisible or non-interactive mode for the pilot, and count missing results. Location, the open-table rule, the cap and the pace limit already stand; a bot attack on one club is not the pilot's risk.

## Missing

**6. End-of-night reconciliation for the owner.** (1.10, 9.10, 10.1) · **must fix before the pilot.**
At 07:00 the owner has Mistral's day report and, in phase 2, the provider's payout, and nothing from Restro that lines them up. Even in phase 1 he must know that Restro's rounds are all in the POS. Recommendation: one page per service day, also as CSV: rounds sent, Added, Not sent, Unconfirmed; later payments with amount, bar, virtual table, provider and receipt references, and a mismatch list (captured without a closed bill, closed without a capture, stranded). At the service-day end an automatic check posts totals and mismatches to the Telegram group.

**7. A cheap POS heartbeat during service.** (9.2, 9.4) · **should fix.**
The pause starts after calls fail, and probes run only while paused. On a quiet Tuesday at 02:30 no call may go out for ten minutes, so a dead POS link is found by the next Send, and that guest eats the Unconfirmed and the table pause. Recommendation: the probe's cheap read every 30 s during service hours. Two reads a minute pause the venue before a guest is hurt.

**8. An Unconfirmed order belongs to the table, not to one phone.** (5.7, 9.7, 7.2) · **should fix.**
Ivan sends five drinks, his phone dies at 3 %, the order ends Unconfirmed. His friends saw the lines leave and no round arrive; the reference died with the phone. Recommendation: every phone at the table gets "An order from this table couldn't be confirmed · ref K7Q · show this to your waiter" for 15 minutes, as the table pause is already table-wide. While a round is on its way, its lines show greyed "Being sent" on every phone, the "Being paid" pattern, so nobody rebuilds and resends them.

**9. The state poll must be cheap, the limits sized from arithmetic, and Restro's own overload must not look like a venue pause.** (11.1, 11.3, 3.3, 9.7) · **must fix before the pilot.**
50 tables × 8 phones ÷ 2 s is 200 requests a second at peak, from one Wi-Fi address and 5 a second per table code, all honest. If each runs a database query, Postgres slows, answers pass 10 seconds, and every phone in the club shows "Ordering is paused" because of Restro, not the POS; a rate limit set by feel blocks the biggest table of the night. Recommendation: "unchanged" answered from a version number per table held in memory; the per-code limit at 20 a second or dropped, the Cloudflare rule at 300 a second per network; a load test at 300 a second on staging before the first night.

**10. The stale-action check must not use the phone's clock.** (11.2, 4.5) · **should fix.**
"Arriving much later than it was tapped" trusts the tap time, but 4.5 rightly says phones never use their own clock. An Android 7 minutes off would have every Send refused, forever. Recommendation: stale means "the order version the phone saw is no longer current" (Send already names the lines it saw, 5.1), or the server stamps the action when it hands out the id.

**11. A weak signal must not read as "the club's system is down".** (9.7, 3.3) · **should fix.**
The phone-side self-pause uses the venue-pause words. A guest in the basement toilet sees "Ordering is paused", comes back and tells the table the app is dead. The #40 research proposed other words; the design didn't take them. Recommendation: "Weak connection. Your order is saved, we keep trying." with Send greyed; the venue-pause line only when the server says so.

**12. A rehearsal at the club, a one-page staff card, and a Mistral training mode.** (9.7, 5.13, 15) · **must fix before the pilot.**
Without a test installation, the first guest night is the first test, and the staff side fails on people, not code. Recommendation: an afternoon dry run with three tables and the staff on shift; a printed card at each bar: "A guest shows you this screen: if the items are on the table's bill, the drinks are on their way; if not, enter them; never twice". Rule 7 forbids tests against a live POS, so ask Mistral for a training mode, and Martin and the venue decide how the rehearsal runs.

## Do differently

**13. Prove "did it land" by comparing the bill's rows, not by asking who entered them.** (5.6, 9.6, 12) · **should fix.**
The read-back and the table pause's first lift wait on "who entered a row, and when", unproven even on barsy (#47). Reading the bill with rows is already the must-have (7.8). Recommendation: read before the send; after a timeout read again; rows present now and absent before mean Added. storekit does this ("resend is blocked if the POS already has it"). The capability becomes an improvement, not a dependency. The weak case, a waiter keying the identical round in the same minute, is rarer than a timeout.

**14. Make the guest's panel the staff surface, because Restro cannot print.** (9.7, 5.13) · **should fix.**
storekit and me&u fall back to paper: a "POS FAILED" ticket on the bar printer, where staff already look. Restro has no printer, so the phone panel is the only thing a waiter will read. Recommendation: the reference in large type, the items in the POS's own public names (5.13's open point: yes), the time, and the two lines of entry 12.

## Which Mistral fact first

1. Can an outside app add a round to a table's bill, and read that bill back with its rows? Without both, no ordering (round 1's go/no-go); with both, phase 1 can be built (entry 13).
2. What a bar ticket prints: the operator and the real table. It decides whether a Restro round reaches the right table at all.
3. Phase 2 only: does a move reprint; can the day close with an open virtual table; which device prints the receipt.

## What is sound

- Three sizes of failure, and the menu that never goes down (9.1, 3.1).
- Never resend a round; Unconfirmed with no Try again; the guest's phone as the channel to the waiter (5.6, 5.7, 9.7). The better products do the same.
- The owner can pause but not lift Restro's pause (9.5).
- No local success, action ids where a repeat gets the first answer, the table code in a header, no cookie (11.1, 11.2, D72).
- The Log as append-only steps apart from `events`, 31 days (9.10, 11.6).
- The retention numbers, no phone or network identifier past the service day, consent not resting on the exemption (10.1–10.7).
- Capabilities per connector; invisible server deadlines; the provider doing the payment work (round 1).
- The Healthchecks.io watchdog: one ping a minute, free, the only thing that tells the team Restro itself is down (9.9).
