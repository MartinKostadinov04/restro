# Decision log: "How the guest page talks to the platform" (#40)

Made by: the #40 session (Opus), 10-20, with Martin. For: anyone who needs every decision of #40 at a glance. Map #29 "Ordering from the menu". Built on the logs of #35, #36, #37, #38 and #39; their firm rows are not re-asked.

Every decision taken, one row each. **Status:**
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope, or proposed and rejected;
- **open:** waits on a fact or a ticket.

**Recorded in** says where the binding text lives: a D-number, a ticket, `GLOSSARY.md`, or `docs/connector-questions.md` (CQ). Only D-numbers bind; this log is the index to them.

Sources, filed under D114: the technical design (`2026-10-20-guest-api-design.md`), the Opus second opinion on its draft (`2026-10-20-guest-api-second-opinion.md`) and what ordering apps do on a weak signal (`2026-10-20-weak-signal-in-ordering-apps.md`, a research subagent, Sonnet).

The technical design is the session's own, as the ticket asked. Martin answered the guest-facing points over four rounds and confirmed the whole on 10-20. The binding text is D121.

## 1. What a phone sees

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | An order's progress ("Sending…", "Added to your bill", "We couldn't send your order") shows only on the phone that sent it. The other phones see the lines leave the bag and the round on the bill. Proposed first: every phone sees it for 2 minutes. | Martin: no need to show other phones orders that may not go through. | firm | D121 |
| 1.2 | An Unconfirmed order's reference stays on the sending phone until the guest closes it. Proposed: until the table's bills close, on every phone. | Follows 1.1; whoever talks to the waiter has it. | firm | D121 |
| 1.3 | A phone sees its table's label, whether ordering is on or paused, the shared bag with notes, the earlier bags, "Someone at your table is paying · 1:42", and the table's bill as the last reading shows it, with its age. | D111, D117; the bag is shared, so its notes are too (Martin). | firm | D121 |
| 1.4 | A phone never sees other tables, who added, sent or paid anything, a phone's or a network's identity, waiter names, POS bill numbers or ids, internal names or cost prices. | Rule 3, D111. | firm | D121 |
| 1.5 | A bill line shows the item's name as Restro has it, even if hidden from the menu. "Other item" only for a row Restro can't match. Proposed first: the POS's own text for rows a waiter typed; then "Other item" for anything not on the menu. | Martin: on a POS venue every bill row is a POS item Restro syncs. The reviewer: a waiter's free text could leak staff notes. | firm | D121 |
| 1.6 | A replaced or retired table code stops working at once and shows the existing "This table code is no longer in use" page. Proposed: open pages switch within 30 seconds. | Every action re-checks the code; nothing new to design. | firm | D121 |
| 1.7 | No "this bag clears in 5 min" warning. | A timed-out bag becomes "Earlier bag · Restore" (D117), so a warning is noise. | firm | D121, D117 |

## 2. Taps and the connection

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | Bag edits (add, +1, remove, undo, restore) show at once. If Restro refuses, a one-line message appears and the number goes back. Proposed: wait for Restro's answer. | Martin; ordering apps edit carts optimistically (weak-signal research). | firm | D121 |
| 2.2 | Send and Pay never show success before Restro answers. | D72: no local success. | firm | D121, D72 |
| 2.3 | After about 10 seconds without an answer the phone shows D120's paused screen, keeps the last bag visible and retries quietly. Send is blocked, never queued. Replaces the proposal "No connection · trying again". | Settled by #39 the same afternoon (D120); the research agrees a hidden queue is worse. | firm | D120, D121 |
| 2.4 | Each tap carries its own key, so a retry never counts twice; an action that arrives too late is refused and the phone refreshes. | The reviewer: a phone back from a lost signal must not land a stale Send. | firm | D121 |
| 2.5 | Phones ask every 2 seconds on the bag and bill screens, every 10 on the menu, every 2 anywhere while an order is on its way or a payment counts down; never while hidden; at once on showing again. | D117's 2–3 seconds. | firm | D121 |
| 2.6 | No slow-down for an idle phone. Proposed: every 10 seconds after 2 minutes without a tap. | Martin: keep it simple. Restro can still slow every phone when overloaded. | firm | D121 |
| 2.7 | Push (the server telling phones) instead of polling. | Polling is enough for the pilot; push drops in behind the same interface later. | later | D121 |

## 3. The guards on each request

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | The location check runs on every action that changes or sends on-the-bill items: add, change, remove, restore and Send. Refines D118's "at Send". | Martin: any action that has impact checks location. | firm | D121, D118 |
| 3.2 | Paying and pay-first lines are never located; a guest who refused location can still add, change and pay pay-first items. | D118: paying is never blocked. | firm | D121, D118 |
| 3.3 | After a passed check, all of that phone's actions on that table's bill, Send included, need no new check for 2 hours: the **location pass**. Another table needs a new check; the pass never lasts past the service day. Proposed: the pass covers bag changes, Send checks fresh each time. | Martin. The cost accepted: a guest who left could keep ordering onto their own table's bill for up to 2 hours. | firm | D121, GLOSSARY |
| 3.4 | The venue sets the pass under "More" in "Ordering on the bill": "Check location again after", 2 hours, 30 minutes to 6 hours. | Same place as D118's other guard settings. | firm | D121 |
| 3.5 | The phone holds the pass as a sealed note naming the venue, the table and when it ends; Restro stores nothing and no phone identity. | D111 and D118 still hold. | firm | D121 |
| 3.6 | The consent screen: "**[Venue] and Restro check your location so nobody outside can order onto your table's bill.** Never stored. You can stop anytime, or pay first or call a waiter. [Privacy]" with [Allow] / [Not now]. Shown at the first change of an on-the-bill item, once per phone per service day. Replaces D119's text, which said "each time you order to the bill". | Martin: the shortest version with everything the law needs (who and why, never stored, the alternatives, the right to stop). | firm | D121, D119 |
| 3.7 | Turnstile only at Send of on-the-bill orders, as D119 set it. A missing or failed result refuses the Send; it fails open only when Cloudflare can't answer, counted each time. Proposed first: also at Pay. | D119; paying is never blocked (D118). | firm | D121, D119 |
| 3.8 | Turnstile on Pay. | Paying belongs to the payment map. | open | D121, #29 |
| 3.9 | D111's knock refuses a bill action only when a line it acts on changed or went; a friend's new round doesn't refuse it. | The reviewer's question; the narrowest check that keeps the payer safe. | firm | D121, D111 |
| 3.10 | Safari on iPhone may ask for location again on a later visit within the night; added to the field test. | A fact to check, not a decision. | open | open-items |

## 4. Abuse

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | A table may make 60 bag changes a minute; above it the phones see "Slow down a moment". Every trip goes into the venue's Log and alerts the Restro team. A proposal of 120 was dropped. | Martin: 60 for now, with a log and alerts. | firm | D121, D120 |
| 4.2 | Someone outside with a photo of the code changing pay-first lines is accepted for the pilot and counted. A PIN or expiring codes stay on request. | Undo and "Earlier bag · Restore" limit the harm; D118 keeps a PIN and expiring codes on request. | firm | D121, D118 |
| 4.3 | Cloudflare's one free rate-limit rule guards the actions address per network, set generously; the web limits state requests per table code. | A club's guests share one Wi-Fi address. | firm | D121 |
| 4.4 | Notes on bag lines: every phone at the table sees them. How long they are kept on stored orders goes on the privacy list. | Martin; retention is a privacy point. | open | open-items, D121 |

## 5. Technical, with Martin's OK

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | Two addresses on the web app, `GET /api/guest/state` and `POST /api/guest/actions`, same origin, no cookie, strict schemas, never cached. | The session's design; reviewed by Opus. | firm | D121 |
| 5.2 | The table code in a request header, never in an address or a log, never stored. | Logs carry paths, not this header. | firm | D121 |
| 5.3 | One database lookup turns a code into its venue and tenant, the one pinned exception in the RLS guard test (A6 G13). Every action re-checks the code inside its transaction. | Martin OK'd the exception (D67: guardrails only tighten, so it needs his word). | firm | D121, D67 |
| 5.4 | New storage for the build: the table's bag, orders and attempts, the table's reading, later payments, with id kinds for each. | Martin OK'd it; all writes go through the one write path (rule 1). | firm | D121 |
| 5.5 | The web never calls the POS: readings, the knock and sending orders are worker jobs, seen by the phone through the state. | CLAUDE.md; D111. | firm | D121, CLAUDE.md |
| 5.6 | The template contract (`services.ts`) gains the table's state, the bag commands and refusal codes; a bill round loses its action id. | D72's contract, kept pure. | firm | D121 |

## 6. Pulled back to other tickets

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 6.1 | When ordering pauses and how it lifts, alerts, the Log, and the wording when Restro can't be reached. | #39's. | firm | D120 |
| 6.2 | Payment commands, their phases, "Pay later", the minimum card payment, abuse of payment locks from outside. | The payment map's. | open | #29, D121 |
| 6.3 | The waiter-call backend. | Not part of ordering. | later | #29 |
