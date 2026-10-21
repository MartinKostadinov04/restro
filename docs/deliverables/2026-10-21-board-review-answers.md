Made by: lead session (Opus), 10-21. For: Martin, and whoever writes D122.

# Board review: Martin's answers and the lead's decisions

Martin answered the board review (`2026-10-21-board-review-final.md`) point by point, following the lead's chat summary of the guest, staff and system reviewers. This file records each answer and what it settles. Where Martin left the call to the lead, or didn't follow the point, the lead explains it and decides. Words: the **order** is what the table is still building, a **sent order** is what Send creates (Martin's names; they replace "bag" and "round").

Status marks: **decided** (Martin), **lead decides** (left to the lead or technical), **later** (not now), **open** (still Martin's), **agent** (a subagent is checking it).

## 1. Guest side

| # | Point | Martin's answer | What it settles |
|---|---|---|---|
| G1 | "Call a waiter" has no backend | Yes. The feature is meant for waiters' watches; the waiters' main screen also gets a notifications pane, a role-limited version of the panel | **Decided.** At the pilot it is a still card, "Please order from your waiter", never a button. When the waiter call is built, calls go to the watches and to the staff screen's notifications pane. The prototype draws the pane with a "later" slot for calls |
| G2 | Phase-1 screens promise paying | Left to the lead | **Lead decides:** if paying is phase 2 (choice A), the phase-1 screens never mention paying. Consent v1 drops "or pay first"; pay-first items say "Order this from your waiter"; the composer hides the payment mode until phase 2 |
| G3 | "Order" means two things; лв | "Order" and "sent order" | **Decided.** GLOSSARY: order (unsent, shared by the table), sent order (what Send creates, with its states). In code: `tableOrder`, `sentOrder`; "round" and "bag" retire. Prices in € everywhere |
| G4 | Notes and choices may not print | Options can print; check with Mistral | **Decided.** Mistral question 31 asks. The connector capability "notes and choices reach the ticket" stays as the safety net: without it the note field hides and the allergy line shows |
| G5 | "Ask your waiter to open your table" may never clear | For now staff open QR ordering per table from our screen, since we don't know whether Mistral can tell us | **Decided.** A table takes phone orders to the bill only while staff have it **open for phones** in Restro: one tap per table, or "Open all" at opening; closed by hand or at the venue's set hour. This replaces D118's "a waiter opened a POS bill" as the gate. Still for Mistral: can a sent order start a bill on a POS table with none (5.5)? If not, that first sent order fails cleanly with "Ask your waiter to put your first item on" |
| G6 | Unconfirmed on every phone (M23) against Martin's "sending phone only" | Left to the lead | **Lead decides:** the lines' state shows on every phone, because the shared order loses those lines on every phone and everyone must see where they went ("Being sent", then "On your bill" or "Not confirmed: show K7Q to your waiter", for 15 minutes). The "Sending…" progress stays on the sending phone, as Martin chose. Reason: one bill per table, so a friend who sees nothing re-orders, and a dead sending phone would take the reference with it |
| GS1 | The location pass outlives the group | Drop everything kept for the current visitors once the bill fully clears | **Decided.** Each table has a **sitting**. It ends when the table's POS bill is gone or empty, when staff close the table for phones, or when staff tap "New guests". Then every location pass, the unsent order, the duplicate-warning memory and the phones' saved state for that table stop counting; the next scan starts clean. Restro can't wipe a guest's phone, but the server refuses the old data and the page clears it at its next contact |
| GS2 | A former guest can watch the bill | Check location before viewing? Is that enough? | **Decided, with the lead's yes:** the bill and the table's order show only to a phone with a location pass from the current sitting; the menu needs only the code. With GS1 it is enough: a former guest at home can't pass a new check, and their old pass died with the sitting. Cost: a guest who refuses location sees the menu, not the bill (the waiter tells the total). This reverses #40 row 4.4 by Martin's own choice; the consent text adds "to see and order onto your table's bill" |
| GS3 | One prankster freezes a table | Can prevention be designed? | **Lead decides: yes.** Limits count per phone (a random value made at page load), never per table, so one person can't block friends: 30 adds a minute, one Send per 15 s, 10 Sends in 10 minutes. Every change also needs a location pass inside the venue and the current sitting, and staff can close the table in one tap. Enough for the pilot |
| GS4 | A swapped table card | QR codes are glued to the table | **Decided.** "Send 3 items to Table 7" stays as a cheap second check |
| GF1 | Data in the basement | It works | **Decided.** The signal question to the venue is dropped. A Wi-Fi login page answering is still treated as "no connection" (costs nothing) |
| GF2 | Last orders | Configurable | **Decided:** per weekday open or closed, with opening, last-orders and closing times (the research's model), all venue settings |
| GF3 | Booths | Didn't know the term | **Lead decides.** A booth is a big sofa area; some clubs put two QR codes on it while the POS keeps it as one table. The data lets several codes point at one table, with no screen of its own. Nothing to ask |
| GF4 | The staff card | What is it? | **Lead decides.** A one-page printed cheat sheet for the bar on pilot night: how phone orders look on the POS, what "Show this to your waiter" means, how to open and close tables. Written from the staff screen prototype, later |
| GF5 | Discounts | Waiters apply them in the POS; don't block it | **Decided.** Restro shows discount lines as the POS gives them, and the bill's line types include discounts. Nothing assumes a bill without them. Phase 2 keeps Q15's refusal until Mistral answers 37 |
| GF6 | One of several identical drinks | A dropdown counting down from the line's quantity, default "all" | **Decided (phase 2).** Works only if the POS can move part of a line (Mistral R10). If it can't, Restro keeps each sent order's lines separate in the POS where it can, so the dropdown works per line; otherwise whole lines only |
| GF7 | The receipt from a payment table | A PDF to download or email, plus a printed one at the bar on request, is enough in law | **Agent:** a research agent checks Н-18 for an electronic receipt (see section 5) |

## 2. Staff and owner

| # | Point | Martin's answer | What it settles |
|---|---|---|---|
| T1 | Call a waiter | As G1 | — |
| T2 | Three of Martin's choices overridden | Think how to fix it | **Lead decides:** (a) Unconfirmed: G6. (b) Weak signal: **Martin's choice kept**, D120's calm paused screen: "Weak connection. Nothing new was sent yet, we keep trying." "Your order is saved" is dropped. (c) Waiter panel: see T4 |
| T3 | Three names for the staff screen | An agent proposes a static prototype of what a waiter clicks during the night | **Agent:** the staff screen prototype (section 5). Its name comes from it |
| T4 | "Did this sent order land?" | Isn't that the guest's duplicate warning? | **Lead explains and decides.** A different case. When Restro sends an order and the answer from the POS gets lost (the connection drops mid-send), Restro doesn't know whether it reached the bill. First Restro checks itself: it reads the bill and compares before and after. Only when it still can't tell does the staff screen show an alert: the reference, the items, the time and "Bill before this order: €46.00", so the waiter can check the POS in seconds. The duplicate warning for the guest is separate and stays |
| T5 | Per-bar pause; Restro's own pause not shown | Include | **Decided:** "Pause ordering: all bars / Bar 1 / Bar 2"; the switch also shows when Restro paused by itself (lost connection) |
| T6 | The pre-opening check fails before the POS is on | Configurable time and cadence | **Decided:** a venue setting. Defaults (lead): from 2 hours before opening, every 10 minutes, alert at 30 minutes before opening |
| T7 | One opening time | Include | As GF2 |
| TS1 | No roles for the new powers | Configurable per club: default roles and custom ones, RBAC per venue | **Decided.** Restro ships default roles (staff, manager, owner) and each venue can make its own from a list of permissions. Q4's table becomes the defaults; the table-to-bar row goes (TS6) |
| TS2 | Bar tablet signed in as the owner | The venue's responsibility | **Decided.** Restro offers the roles; which account sits on the bar is the venue's call. The setup guide suggests a staff account |
| TS3 | Staff may know Restro's POS login | Didn't follow | **Lead explains and decides.** Restro works in the POS through its own user, like a waiter named "Restro". Phone orders show under that name, and Restro knows its own lines by it. Someone who knew that user's PIN could enter drinks at the terminal as "Restro", for example a free drink for a friend that later looks like a phone order. Fix: the venue never sees that user's password or PIN (Restro keeps it in its secret store), and Mistral question 34 asks whether the user can be blocked from the terminal. Nothing to ask Martin |
| TS4 | A cash close of a payment table | Can't be settled twice | **Lead explains and decides.** In phase 2 the guest's lines sit for a moment on a payment table while the card is held. The POS can't settle that table twice, true, but the card charge happens outside the POS. If a bartender closed it as cash in that moment, the POS would record cash that never came and the card would still be charged. Fix (already D112's "hold, write, capture"): the card is only held until Restro itself closes the payment table; if someone closed it first, the hold is released, never captured, and an alert goes out |
| TS5 | Payment tables arriving as guest tables | Didn't follow | **Lead explains and decides.** Restro imports the venue's tables from the POS to print QR codes. Mistral's payment tables (QR-1, QR-2…) are tables in the POS too, so they would arrive as places where guests sit. Fix: they are marked as payment tables (by the connector, or by the owner once) and never get a QR code |
| TS6 | Wrong table-to-bar mapping | Set in the POS; Restro only sets pay-first per table, group (bar, hall…) or whole venue | **Decided** for the mapping: Restro reads it from the POS and never edits it. Pay-first: see **open 1** |
| TS7 | The Telegram group outlives the staff | How, if they left it? | **Lead explains and decides.** The case is someone who leaves the job but not the Telegram group. "Done" counts only from a Telegram user linked to an active Restro account, so removing the person in Restro unlinks them at once. Group membership stays the venue's job, and settings list who is linked |
| TS8 | Guard changes leave no trace | Part of the Log | **Decided** |
| TF1 | End of night | Close QR codes by hand on the screen, or automatically at a set hour | **Decided:** "Close all" on the staff screen, plus a venue setting for the hour. Closing ends every sitting (GS1) |
| TF2 | Reconciliation and payment type | Doesn't matter; the real question is how the bill and payment close in the POS, as with a physical terminal | **Lead explains and decides.** With a physical terminal the terminal usually doesn't talk to the POS: the waiter picks "Card" in the POS and the terminal charges separately. In the app, Restro does the waiter's part: once the provider confirms the charge, Restro closes the bill in the POS with a card payment (rule 7). The provider never talks to the POS. The venue picks which card type from its POS list (default "Card"). A separate "Card online" helps the manager match the night's totals, because app payments aren't on the terminal's report. The fiscal questions go to the research agent |
| TF3 | Who brings the receipt | PDF download or email, or ask at the bar, if the law allows | As GF7 |
| TF4 | Refunds at night | Not now | **Later** |
| TF5 | Running out of an item | When needed | **Later** (sold-out marking already exists) |
| TF6 | A dispute pack | Isn't the Log enough? If not, better safe than sorry | **Agent:** checks the dispute rules against D111's 18 months and D120's 31-day Log (section 5) |

## 3. System

| # | Point | Martin's answer | What it settles |
|---|---|---|---|
| S1 | One list of connector capabilities | Agreed | **Decided:** D122 carries it |
| S2 | Three definitions of "open table" | Agreed | **Decided:** replaced by G5's "open for phones", and "closed" = the POS bill is gone or empty (SF1) |
| S3 | Order / round naming | Order and sent order | As G3 |
| S4 | Table-to-bar in phase 1 | Agreed | **Decided:** read from the POS (TS6); needed in phase 1 if each bar logs in separately |
| SS1 | Line-exact check before a payment closes | For sure | **Decided (phase 2)** |
| SS2 | Partial quantities | Not sure it is real | **Lead explains:** it is the same question as GF6's dropdown, which needs the POS to move part of a line. Settled there |
| SS3 | Payment provider's messages signature-checked | For sure | **Decided (phase 2)** |
| SS4 | "Receipt printed" needs the number | Receipts carry their number | **Lead decides:** Restro reads the receipt number from the POS where it can, and it is on the PDF (GF7). Staff never type it |
| SA1 | A second write path for service data | Agreed | **Decided:** D122 says it; rule 1 stays for the menu |
| SA2 | Four neutral paying steps | Agreed | **Decided (phase 2)** |
| SF1 | "Closed" at a one-bill POS | An empty bill doesn't exist; the Log must track what moved where | **Decided:** empty or gone = closed. The Log records every move: which lines, from which table to which, who, when |
| SF2 | Ticket routing | The whole new order prints at the bar | **Decided:** a sent order prints whole at its table's bar. The routing question to the venue is dropped |
| SF3 | Rights of Restro's POS login | Per POS, in connector work | **Decided:** no general rule; each connector's checklist |
| SF4 | Fee on voided orders | Restro is a fixed subscription | **Decided:** no fee per order. D111's fee from orders is amended in D122 |
| SF5 | First write without a training mode | Not now | **Later** |
| SF6 | "From your phones" marking on the bill | Not needed | **Decided:** the guest's bill shows no such marking. Restro still knows its own lines internally, for the Log and the matching in T4 |

## 4. Open: still Martin's

1. **Pay-first: per item, or per table, area or venue?** D113 (10-18) set the payment mode **per item**, with one table switch, "Disable prepayments". Martin then chose that over settings per area. His answer to TS6 names pay-first settings "for each table, group (bar, hall…) or whole venue". Does that replace per-item, or add area and venue levels to it?
2. **Choices A and B** from round 2 are still unanswered: A, paying in phase 2; B, the order of steps in 8.1.

## 5. Agents started 10-21

- **Staff screen prototype** (Opus): a static prototype of what a waiter and bartender tap during the night: notifications, open and close tables for phones, pauses, resume, unconfirmed sent orders, with role-limited versions.
- **Dispute traceability** (Opus): can Restro answer a card dispute and "who did what" from its Log and records, and what is missing.
- **Receipt and payment law** (Opus): may the fiscal receipt reach the guest as a PDF (download or email) with a printed copy at the bar on request; the payment-type questions (a)–(d); ПМС 97/2021 on allergen information.

## 6. What changes in the decisions (for D122)

- D118: the gate is "open for phones" in Restro, not a POS bill (G5).
- D121, D119: the pass belongs to a sitting (GS1); viewing the bill needs the pass (GS2); the consent text changes.
- D117, D116: "order" and "sent order" (G3); the lines' state shows on every phone (G6).
- D120: the weak-signal wording (T2b); the per-bar pause (T5); the pre-opening check settings (T6); guard changes go to the Log (TS8).
- D111: no fee per order (SF4).
- D113: depends on open 1.
- New: roles and permissions per venue (TS1); service hours (GF2); close all, by hand and by hour (TF1); the connector capability list (S1); the service-data write path (SA1).
