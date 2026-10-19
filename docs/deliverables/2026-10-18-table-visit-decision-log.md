# Decision log: "What is a table visit, and which bill does a new order join?" (#36)

Made by: the #36 lead session (Opus), 10-18, with Martin. For: anyone who needs every decision of #36 at a glance. Map #29 "Ordering from the menu". Built on the #35 log (`2026-10-18-bill-decision-log.md`); rows of that log this grilling changed now name D115 there.

Every decision taken in the grilling, one row each. **Status:**
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope, or proposed and rejected;
- **open:** waits on a fact or a ticket.

**Recorded in** says where the binding text lives: a D-number, a ticket, `GLOSSARY.md`, or `docs/connector-questions.md` (CQ). Only D-numbers bind; this log is the index to them.

Sources: `2026-10-18-table-visit-in-other-software.md` and `2026-10-18-how-qr-apps-write-orders-into-pos.md` (research subagents, Sonnet), barsy's signed-in `Places_getlist` and `Accounts_getlist` (lead, 10-18).

## 1. The table's bill

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | Restro has no table visit. | No POS keeps one: barsy's table carries only its count of open bills; Toast, Lightspeed and Simphony derive "occupied" from open checks. Martin: "all is in the POS", "when a table is closed it's closed". | firm | D115, GLOSSARY |
| 1.2 | The bill a table code shows is every open POS bill on the table: what is owed plus anything already paid against them. A POS bill that closes drops off: a pay-first order, a paid split, a bill a waiter closed. | The closest copy of what the waiter sees on the floor plan; a closed bill belongs to no one in the waiter's work. | firm | D115, GLOSSARY |
| 1.3 | A visit that ends after 30 quiet minutes, or at 07:00. Proposed in round 1, replaced by 1.1. | Restro would invent an ending the POS doesn't have (Martin). | out | D115 |
| 1.4 | A visit worked out at each reading from the POS bills' opening and closing times. Proposed in round 2, replaced by 1.1. | Same reason; no POS has a visit to read. | out | D115 |
| 1.5 | Whether a pay-first order on an empty table shows on the bill. | The question fell away with 1.1: a closed POS bill never shows. | out | D115 |
| 1.6 | Nothing happens at 07:00: the service day stamps each order but doesn't cut the bill. | A POS bill still open is the POS's truth (Martin: "on staff to figure out in the POS"). | firm | D115, D45 |
| 1.7 | A new group sees whatever the POS still has open on the table; a bill left open overnight is staff's to close. | Restro shows the menu and lets guests act as they would with a waiter (Martin). | firm | D115 |
| 1.8 | A page left open when the table's POS bills close: D111's knock shows "your bill changed", then the empty bill; nothing is blocked. | Already covered by D111. | firm | D115, D111 |
| 1.9 | The phone that paid lists its own paid orders and receipt copies for the service day ("Your paid orders"); how it looks is the bill screen's. | A closed POS bill drops off the table's bill (1.2), but the payer still needs proof. Martin: yes. | firm | D115, #45 |

## 2. How an order joins the table's POS bill

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | An on-the-bill order is added as a round to the table's open POS bill, like a waiter's. Replaces D112's "each guest order opens its own POS bill". | Every QR product that documents it adds to the table's open check (Toast, Qerko, storekit on Lightspeed); none documents a check per order. Martin: "each guest opening their own order doesn't sound right". | firm | D115 |
| 2.2 | When the table holds several open POS bills: the oldest. If the POS says it was just closed or locked, Restro reads again and uses the next open one or opens a new one. | The one barsy keeps when merging and Lightspeed returns; "closed" or "locked" is a definite "no". | firm | D115 |
| 2.3 | Only when the table has no open POS bill does the order open a new one, stamped with Restro's code, resent unchanged for about a minute if no answer comes. | barsy refuses a repeat of the code, so this resend is safe. | firm | D115, D112 |
| 2.4 | A round that times out is never resent. For about a minute Restro reads the table's open POS bills for rows entered by its own POS user after the order went out: found → "Added to your bill"; missing → "We couldn't send your order, please call a waiter" and a staff alert. | barsy documents no guard on adding a round; storekit makes the same choice. Cost: a few more "call a waiter" when the POS is slow; gain: no doubled round. | firm | D115 |
| 2.5 | One order in flight per table; a second phone's order waits a few seconds. | So the read-back cannot confuse two orders. | firm | D115 |
| 2.6 | The read-back is Restro's design, not a barsy feature: proven on barsy's test installation before ordering is built. | barsy's rows carry who and when, but nothing promises a call is all-or-nothing or that no row lands late. | open | D115, CQ C52 |
| 2.7 | If Lukanet confirms Restro may set its own id on a row, the read-back matches that id. A POS with a documented guard on adding (Toast, Simphony, Square) uses it. | Leaves no doubt. | open | D115, CQ C20, C21, Q82 |
| 2.8 | The platform only says "put this order on this table's bill"; each connector does it the safest way its POS allows. | The platform knows no POS. | firm | D115 |
| 2.9 | Unchanged: a pay-first order is its own POS bill, paid and closed at once; paying your own items is a split. | Martin: "everything cumulates on a bill except the immediately paid items". | firm | D112, D115 |
| 2.10 | Moving a bill to another table stays a waiter's action in the POS. | Settled in #35. | firm | D112 |

## 3. Who can order, and from where

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | Before ordering, the phone asks for the guest's location to check they are in the venue. Replaces the proposal "an old page confirms the table again". | Martin. No product researched does this. | firm | D115, #38 |
| 3.2 | When the location is asked, what happens if the guest refuses, and the accuracy in a basement club. | Belongs with the other guards against fake orders. | open | #38 |
| 3.3 | The location is used only for the check and never stored. | D111: nothing about the phone stays past the service day. | firm | D115 |
| 3.4 | No ordering from the bar: the bar stays person to person until proven otherwise; table codes go on tables only. Withdraws D111's bar-counter line. | Martin. A counter never empties, so one code would make one bill for strangers all night. | firm | D115 |
| 3.5 | A "bar mode" where each phone sees only its own orders. Proposed in round 1. | Fell away with 3.4. | out | D115 |

## 4. Way of working

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | Martin asked that our choices be checked against how comparable software is built; both research files are filed. | "find out if our decisions align with the commonly used architecture" (Martin). | firm | D114 |
