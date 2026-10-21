# Decision log: "Failure and pause during service" (#39)

Made by: the #39 grilling session (Opus), 10-20, with Martin. For: anyone who needs every decision of #39 at a glance. Map #29 "Ordering from the menu". Built on the #35, #36, #37 and #38 logs (`2026-10-18-bill-decision-log.md`, `2026-10-18-table-visit-decision-log.md`, `2026-10-19-order-life-decision-log.md`, `2026-10-19-fake-orders-decision-log.md`); their firm rows are not re-asked.

Every decision taken in the grilling, one row each, numbered by topic; the question it answered is in brackets (Q1–Q…). **Status:**
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope, or proposed and rejected;
- **open:** waits on a fact or a ticket.

**Recorded in** says where the binding text lives: a D-number, a ticket, `GLOSSARY.md`, or `docs/connector-questions.md` (CQ). Only D-numbers bind; this log is the index to them.

The binding text is D120. Martin confirmed the shared understanding on 10-20.

Sources, filed under D114: how comparable products pause, alert and resume (`2026-10-20-pause-and-failure-elsewhere.md`, research subagent, Sonnet); how to build the venue's Log (`2026-10-20-service-log-design.md`, architecture subagent, Opus); circuit-breaker and alerting practice (`2026-10-20-breaker-and-alerting-practice.md`, research subagent, Sonnet). Martin asked that thresholds, timings and alert rates be set from best practice rather than by him (Q9, Q11).

Already settled before this grilling, so not asked: the menu never goes down (D102); a POS that doesn't answer shows the last reading with its age and pauses ordering and paying (D111); each failure is logged per connector and alerts the Restro team (D111); a timed-out round is read back for about a minute, then Unconfirmed with "please call a waiter" (D115, D116); late landings are out (D112); orders behind an Unconfirmed one become Not sent and the table pauses (D117).

## 1. Sizes of pause

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | Three sizes: an **order** fails alone (Not sent or Unconfirmed); a **table pause** stops one table after an Unconfirmed order; a **venue pause** stops ordering and paying at every table when Restro can't work with the POS, the menu and the last bill readings staying. (Q1) | Each has its own trigger and its own way of lifting; A5's breaker is the venue pause. | firm | D120, GLOSSARY |
| 1.2 | When the venue pauses, orders Waiting in line become Not sent ("Ordering is paused, please call a waiter"), their lines back in the bag; an order already Sending or Checking finishes its minute of read-back. (Q1) | The same as D117's table pause. | firm | D120, D117 |

## 2. What starts a pause, and what lifts it

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | Restro starts a venue pause when no POS call has succeeded for 60 seconds with at least 3 attempts; when the POS refuses Restro outright (its POS user's credentials, its cash desk); or when 3 orders at different tables end Unconfirmed within 10 minutes. A single failed reading of one bill pauses only that table until its next good reading (D111). (Q8) | D102's "paused within a minute"; Toast is the one product that pauses by itself (after up to five minutes); Uber Eats pauses after missed orders. | firm | D120, D111 |
| 2.2 | A venue pause Restro started lifts by itself, timed by circuit-breaker practice: paused at least 60 s; probes are a cheap POS read that also checks the credentials and the cash desk, never a guest's order; the first after 15 s, then 30, 60 and 120 s apart (randomised), from 60 s up to 5 min for a refusal; 3 good probes in a row lift it and send "Ordering is back"; for 5 min after, one Unconfirmed order or 2 failed calls pause it again at once; a third automatic pause within 30 min holds at least 10 min and tells the Restro team the venue is unstable; the Unconfirmed count restarts when a pause lifts. Never lifts the owner's own pause. (Q9) | Martin: "I want to follow best practices here". Nygard and Fowler's circuit breaker, Azure's pattern, Resilience4j and Polly; the exact numbers are the subagent's judgement within them (`2026-10-20-breaker-and-alerting-practice.md`). | firm | D120 |
| 2.3 | Restro doesn't check its cash desk during the night: in the POS only the venue's admin can change it, and nobody does so mid-service (Martin). A refusal because of the cash desk (missing, its period closed) is trigger 2.1. Replaces the proposal to check every few minutes. (Q5) | Martin: "I dont see a case where sb wants to change the cash desk mid work". | firm | D120 |
| 2.4 | A **pre-opening check** of everything Restro needs from the POS (its POS user's credentials, its cash desk, that the cash desk's approval mode matches "Orders wait for the bar's approval", D116) runs 2 hours before the venue's opening time, a new venue setting. If it fails, the owner and the Restro team are alerted at once with the reason in plain words, and the venue opens in a venue pause until a check passes. (Q5) | Martin. Two hours leaves time to fix a setting before guests arrive. | firm | D120, D116 |
| 2.5 | A table pause lifts at the first of: a waiter acts on the table in the POS (a round entered by a staff user other than Restro, a POS bill moved or merged); a staff member taps "Resume table" on its alert; all the table's POS bills close; 15 minutes pass. A re-order of the same items still meets D117's duplicate warning. (Q10) | The pause exists so the guests call a waiter; a waiter's own action shows one came, with no new tap. | firm | D120, D117 |
| 2.6 | The owner has one switch in the admin, **"Pause ordering"**: one tap pauses the venue, one tap lifts it, with undo and no confirmation dialog. (Q4) | A bar that is swamped or a POS acting up; Square, Lightspeed and storekit offer only this manual pause. | firm | D120, D107 |
| 2.7 | The owner can't lift a pause Restro started; it lifts when its cause clears. A Restro admin account (the Restro team) can lift any pause. (Q4) | Rule 5: a venue may make the menu more careful, never less. Martin: the Restro admin can turn off any pause. | firm | D120 |

## 3. What the guest sees

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | Every venue pause, whatever its cause, shows one calm line on the menu: "Ordering is paused right now. Please order from a waiter." Send and Pay are greyed, pay-first items too; the bag stays editable; the bill shows its last reading with its age; no cause and no countdown. (Q13) | The POS is needed for paying as well; Lightspeed and Toast keep the menu browsable with ordering closed. | firm | D120, D111 |
| 3.2 | When the guest API doesn't answer in about 10 seconds, the phone pauses itself: Send and Pay give way to "Ordering is paused right now, please order from a waiter", the last bag it saw stays visible, and it keeps retrying quietly. (Q6) | The guest page is static files on the CDN (D102), so nothing else can tell the phone. | firm | D120, D102 |
| 3.3 | After Send, the phone says "We can't reach Restro right now. If your order isn't on your bill in a few minutes, please call a waiter" with the reference, and never "Try again". (Q6) | The order may already be in the POS (D116). | firm | D120, D116 |
| 3.4 | An Unconfirmed order's screen carries a "Show this to your waiter" panel: the items, the time and the short reference, so the waiter checks the table's POS bill for Restro's rows and serves them or enters the order by hand. (Q2) | Staff key the order in first and look into it afterwards, as in the products researched. | firm | D120, D116 |

## 4. Alerts

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | Staff will have an operations panel in Restro, but they work in the POS as today and open it rarely during the night; alerts reach everyone. (Q2) | Martin. D18 (staff learn of orders inside the POS) stands for orders. | firm | D120, D18 |
| 4.2 | Staff and owners get **push alerts** from the operations panel, installed on a staff phone or the bar's tablet like an app: "Ordering is paused at [venue]", "Ordering is back", and per Unconfirmed order "Table 7: an order couldn't be confirmed – items, reference. Check the bill in the POS"; a tap opens it in the Log. The venue ticks in settings which staff accounts get them. (Q7) | Martin: alerts reach everyone in some form. | firm | D120 |
| 4.3 | The Restro team gets every alert by Telegram (D102). (Q7) | Already the stack's channel. | firm | D120, D102 |
| 4.4 | A message inside the POS (a note on the POS bill, or a message to the hall tablet) where a connector can do it. (Q2, Q7) | Waits on CQ C51 (barsy: Q48). | later | D120, CQ C51 |
| 4.5 | Whose phone receives the venue's alerts at night. (Q7) | The pilot venue's answer. | open | Q69 in tracker, D120 |
| 4.6 | Every receiver gets one alert when a venue pause starts and one when it ends, keyed per pause so a pause that comes back within 10 min is the same one; reminders of a pause still on: none for staff, one after 60 min for owners, every 60 min (at most 3) for the Restro team. Unconfirmed orders reach the ticked venue accounts grouped (the first after 10 s, then at most one push a minute), with one reminder after 10 min if no one acted; the Restro team gets them grouped at most every 10 min. Nothing alerts outside service hours except one "still paused" at opening time. (Q11) | Martin: decided from best practice, not by him. Alertmanager's grouping and repeat settings, PagerDuty's one incident per problem, the Google SRE rule that every alert must be actionable (`2026-10-20-breaker-and-alerting-practice.md`). | firm | D120 |
| 4.7 | An outside watchdog, **Healthchecks.io** (free), which Restro pings every minute; when the pings stop it alerts the Restro team by Telegram, and the team calls the venue. (Q12) | When Restro itself is down its own checks and push alerts are down too; a "dead man's switch" is the common fix, and it adds no code library. | firm | D120 |

## 5. The Log

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | Restro keeps a **Log** of everything that happens in service, one per venue, searchable inside the venue by the guest's reference, table, time and kind: orders and every step of them, payments, table and venue pauses, the owner's switch, alerts and D118's guard trips. Replaces A5's "orphaned-orders list". (Q3, Q14) | Martin: an order log with all its actions, in a place called the Log. | firm | D120, GLOSSARY |
| 5.2 | Each order keeps only where it stands now; every step also adds a Log entry, written in the same moment and never changed (time, what happened, who: a guest phone, staff, the owner or Restro, and why). (Q14) | Stripe and Shopify do this. Rejected: current state only (loses the evidence D111 needs), rebuilding from events (too heavy, clashes with the purge), a JSON of stages with yes/no (a step can repeat, no room for who or why, a venue pause has no order). | firm | D120 |
| 5.3 | Log entries are kept 31 days by service day, then erased by the purge job; orders and payments stay 18 months (D111), so an older dispute is answered from the order's final state, times and references. (Q15) | Martin: a month back. Stripe keeps events 30 days and payments for years. | firm | D120, D111 |
| 5.4 | The Log is its own table, and the purge role (D83) may erase from it: a guardrail change Martin approved. (Q15) | The existing `events` table is the menu's change log and needs a menu item on every row. | firm | D120, D83 |
| 5.5 | Owners and managers see all of their venue's Log; only the Restro team sees the POS calls and the team's own alerts; a POS bill's number shows on admin screens only, never on a guest page or in a link (rule 3); edits to the bag are not logged, only Send. (Q16) | Rule 3; the bag is edited many times a night. | firm | D120 |
