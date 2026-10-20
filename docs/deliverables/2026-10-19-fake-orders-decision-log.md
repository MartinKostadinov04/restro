# Decision log: "Guarding against fake orders on the bill" (#38)

Made by: the #38 grilling session (Opus), 10-19, with Martin. For: anyone who needs every decision of #38 at a glance. Map #29 "Ordering from the menu". Built on the #35 log (`2026-10-18-bill-decision-log.md`) and the #36 log (`2026-10-18-table-visit-decision-log.md`); their firm rows are not re-asked.

Every decision taken in the grilling, one row each. **Status:**
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope, or proposed and rejected;
- **open:** waits on a fact or a ticket.

**Recorded in** says where the binding text lives: a D-number, a ticket, `GLOSSARY.md`, or `docs/connector-questions.md` (CQ). Only D-numbers bind; this log is the index to them.

Sources, filed under D114: how other products guard against fake orders (`2026-10-19-fake-order-guards-elsewhere.md`), what a phone's browser gives for location indoors (`2026-10-19-location-check-indoors.md`) and the location check under the ePrivacy rules (`2026-10-19-location-check-eprivacy.md`), all research subagents (Sonnet).

The binding text is D118. Martin confirmed the shared understanding on 10-20.

## 1. What is guarded, and against whom

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | The guards apply only to on-the-bill orders. Pay-first orders and paying are never blocked, located or limited. | Money coming in is never a risk (D111, D113). | firm | D118 |
| 1.2 | An outsider with a photo or link of a table code (case A) is stopped by the location check. | Martin. | firm | D118 |
| 1.3 | Someone inside the venue using another table's code (case B) is narrowed by whatever cheap guards exist. | Martin: "if we can do something against that". Location can't catch a person who is inside. | firm | D118 |
| 1.4 | A script flooding the order address (case C) is security engineering: the stack doc's Cloudflare proxy, rate limits and Turnstile, not a product guard. | Martin: "that's penetration prevention". | firm | D118 |
| 1.5 | Friends at the same table ordering on the shared bill ("I never ordered that") is not a fake order. | Martin; D111 lets everyone with the table code see and add to the bill. | firm | D118, D111 |

## 2. The open-table rule

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | An on-the-bill order is accepted only when the table already has an open POS bill, opened by a waiter in the POS. On an empty table the code shows the menu, pay-first items still order, on-the-bill items say "Ask your waiter to open your table". On by default for a club night. Narrows D115's "no open POS bill → the order opens one" to pay-first orders. | Shuts the easiest hole (any empty table, any time, after the group has left) at no new tap for staff; GonnaOrder and the pay-at-table products work the same way. The cost: a table's first on-the-bill round always goes through a waiter. | firm | D118 |

## 3. The location check

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | A field test in the pilot club comes before the check is built: iPhone and Android, Wi-Fi on and off, precise location on and off, spots inside including the deepest corner, and the street 50, 100 and 200 m away. The radius (3.4) and the "can't check" width (3.3) are set from it. Martin runs it on 10-19. | No public measurement exists for a basement club; indoor positions are off by tens to hundreds of metres. | open | D118, open-items |
| 3.2 | The phone asks at the first Send of an on-the-bill order, not when the menu opens. One line from Restro first ("We check you're in [venue] so nobody can order onto your table from outside. Your location is used once and not stored."), then the phone's own prompt (final wording: 3.10). Every later on-the-bill order checks again without a prompt. | A refusal can't be asked again by the page, so the reason comes first; a guest who left must not keep ordering onto the table from home. | firm | D118 |
| 3.3 | The check passes when the phone's circle of doubt touches the venue's circle. A circle wider than about 1 km (approximate location) counts as "can't check". | Fails only guests who are clearly elsewhere; a km-wide circle proves nothing. | firm | D118 |
| 3.4 | The owner sets the venue's point once ("I'm at the venue – use this spot", or a pin on a map). The radius is 150 m to start, then what the field test shows. Round 2 made the radius Restro's; replaced in round 3 by a venue setting from 100 to 500 m (7.1). | Android's own guidance puts 100 m as the smallest useful circle; below it real guests in a basement are refused. Martin: it's the venue's floor and its risk. | firm | D118 |
| 3.5 | Refused, blocked, "can't check" or no answer in about 10 s: no on-the-bill order from that phone. The menu, the bill and paying are never blocked. | Fails closed; revisited only if the field test shows real guests often can't be located inside. | firm | D118 |
| 3.6 | The screen in 3.5 offers **Call a waiter** and **Cancel** (back to the bag). Call a waiter takes visually more space than Cancel: not huge, and Cancel never looks hidden or shady. Pay-first items in the bag still pay and send as normal. A small "Why?" line says the venue couldn't be confirmed and how to allow location next time. Replaces the proposal "How to allow location / Pay now instead / Ask your waiter". | Martin: pay-first already guards with prepayment; calling a waiter is what to prioritise. A guest who refused by mistake must be able to learn the fix. | firm | D118 |
| 3.7 | Location adds to the other guards; it replaces none. | Each guard stops a different case. | firm | D118 |
| 3.8 | The phone sends its position with the order; the server checks it in memory and drops it, never writing it anywhere, logs included. | A tinkerer must fake coordinates, not flip one "yes"; the rule stays in one place; D115's "never stored". | firm | D118 |
| 3.9 | The ePrivacy question (does the phone's prompt suffice, or is a separate consent needed) is researched by an agent before a lawyer is engaged. | Martin: research first. | firm | D118 |
| 3.10 | Restro's line before the phone's prompt is the consent: it names who checks (the venue and Restro) and why, and its button reads "Allow and continue"; then the phone's own prompt. The privacy notice (T31) covers the check. | The location read falls under ePrivacy Art. 5(3) (Bulgaria: Art. 4а ЗЕТ); the "strictly necessary" exemption probably doesn't fit; the phone's prompt names neither who nor why (`2026-10-19-location-check-eprivacy.md`). | firm | D118 |
| 3.11 | Six narrow questions go to the lawyer (T33): the exemption, whether the prompt plus Restro's line is valid consent, whether refusing may block on-the-bill orders, Turnstile, who is controller and whether a DPIA is needed, who enforces Art. 4а ЗЕТ. Until then the build follows 3.10. | Plain rules researched; only interpretation is left (Martin 10-18). | open | D118, open-items (Q83, T33) |

## 4. Someone inside using another table's code (case B)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | One phone, one table per night for on-the-bill orders. Proposed in round 2. | Martin: a reservation can span several tables; clubs already face this without Restro. Set aside. | out | D118 |
| 4.2 | A cap per on-the-bill round from a phone, €150 by default; above it, pay first or ask the waiter. The venue sets the amount or switches the cap off. | Limits what one fake round puts on a stranger's bill; bottle service usually goes through the waiter anyway. | firm | D118 |
| 4.3 | At most 6 on-the-bill rounds from phones per table per 15 minutes; beyond, the phones see "ask your waiter" until the pace drops. Round 2 fixed it by Restro; replaced in round 3 by a venue setting from 3 to 20, or off (7.1). | Stops a shared code flooding one table (the 2023 Kunming case); no real table orders every 2½ minutes for a quarter of an hour. | firm | D118 |
| 4.4 | A PIN on the back of the table card, or codes that expire. | Inside a club anyone can turn the card; a step for every guest; location already covers outsiders; expiring codes need screens or staff work. Built if abuse shows up anyway. | on request | D118 |

## 5. What staff see

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | Staff get no live signal and no new screen when a guard trips; the guest sees why. Restro counts every trip per venue and table; a table that hits the pace limit (4.3) alerts the Restro team. | D107; Restro's rounds already show in the POS under its own user. | firm | D118, #39 |

## 6. When something slips through

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 6.1 | The last line of defence is the waiter's existing reversal: the table says "not ours", the waiter reverses it in the POS. No new Restro screen for it. | Same as a misheard order today; Restro's rounds are entered by its own POS user (rule 9), so staff can tell them apart. | firm | D118 |

## 7. What a venue can change

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 7.1 | One box in venue settings, **"Ordering on the bill"**. Shown: "Only at tables a waiter has opened" (on); "Largest round on the bill without paying first" (€150, or off); the venue's spot (one tap, or a pin). Under a small **"More"**: "Check guests are in the venue" (on; switching it off shows "Anyone with a photo of a table code could order onto that table's bill"); "How far from the spot counts as inside" (150 m, then the field test's number; 100–500 m); "Most rounds per table in 15 minutes" (6; 3–20, or off). Replaces round 3's proposal that the location check, the radius and the pace limit are Restro's. | Martin: they should be the venue's. Defaults and limits keep a venue from refusing its own guests by mistake; "More" keeps the box grandma-simple (D107). | firm | D118 |
| 7.2 | No choices per area. | Same simplicity as D113's one switch per table. | firm | D118 |

## 8. Words

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 8.1 | **Location check**: checking, before an on-the-bill order, that the phone is at the venue. | A new concept, named once for code, docs and screens. | firm | GLOSSARY, D118 |
| 8.2 | **Open table**: a table with at least one open POS bill, which a waiter has started. The rule in 2.1 is "only at open tables". | Martin: ok. | firm | GLOSSARY, D118 |

## 9. After the ticket: the law (10-20)

Martin 10-20: move on without a lawyer for now; an Opus deep-research agent gave the working answers (`2026-10-20-location-check-law-deep-research.md`). Martin also ran the field test: coverage inside with decent accuracy, so 3.1's defaults stand (`docs/open-items.md`).

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 9.1 | Consent stays the basis: the "strictly necessary" exemption is arguable but not relied on. Replaces 3.10's "probably doesn't fit". | Regulators split (DSK and AEPD for, CNIL and WP29 Opinion 9/2014 against). | firm | D119 |
| 9.2 | The consent screen: "[Venue] and Restro check your location each time you order to the bill, so nobody outside can add to it. It's never stored. You can stop anytime, or pay first or call a waiter instead. [Privacy]" with [Allow] / [Not now]. Replaces 3.10's line and the research's longer draft. | The law needs who, why, not stored, the alternatives and the right to stop before consent; Martin: the long one was too long. | firm | D119 |
| 9.3 | A "Stop location check" control in the "Why?" line and on the bill; after a refusal the phone isn't asked again that service day. | Withdrawal must be as easy as giving consent. | firm | D119 |
| 9.4 | The screen shows once per phone per service day, even if the browser already allows location; a browser block counts as a refusal. | The consent is to the venue and Restro, not to the browser. | firm | D119 |
| 9.5 | Each on-the-bill order records "location check passed, consent text vN", with no coordinates and no phone identifier. | The controller must be able to show consent; the order record is kept anyway (D111). | firm | D119 |
| 9.6 | An agent drafts the privacy notice items, a short DPIA, the records of processing and a venue-terms clause (Art. 26 for the check, Art. 28 for orders) under T31, before the first guest. | Joint control of the check, processing of orders; location is a DPIA criterion. | firm | D119 |
| 9.7 | Turnstile runs only at Send, in managed mode, with pre-clearance and feedback off; what it stores is inspected on staging; Cloudflare is asked in writing about reusing the signals. No home-made alternative now. | Keeps it within "strictly necessary" as far as Restro can; a home-made check would be a new dependency. | firm | D119 |
| 9.8 | Five narrow questions stay for the lawyer (the exemption, refusal and the waiter as alternative, Turnstile's reuse, joint or independent control, the DPIA's finding). | Interpretation only (Martin 10-18). | open | open-items (Q83), D119 |

