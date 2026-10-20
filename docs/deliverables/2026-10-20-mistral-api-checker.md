# Mistral API checker: every action Restro needs from Mistral, and how it could be done

Made by: the lead session (Opus), 10-20, for Martin. For: T69 (the conversation with Mistral Software), the go/no-go on Mistral as the pilot's POS, and the agent who will one day build the Mistral connector.

**The short answer.** Mistral has **no public API**. Its own products, though, already do part of what Restro needs:
- Zamboo **Web Menu** takes orders from a phone at the table into the POS.
- The **e-commerce integration** syncs items, prices and stock into a web shop, and puts the web shop's orders into the POS.
- **Zamboo web** acts on open bills from a browser.

So an interface exists behind those products. Whether Mistral will open it to Restro is the whole question, and only Mistral Software can answer it. Every row below is therefore "unknown", except where Mistral's own pages show the function exists in its products.

## 1. What was found (10-20)

| Source | What it says | Tag |
|---|---|---|
| [mistral.bg, E-commerce интеграция](https://mistral.bg/e-commerce-%D0%B8%D0%BD%D1%82%D0%B5%D0%B3%D1%80%D0%B0%D1%86%D0%B8%D1%8F-3/) | A web shop linked to the POS: items, prices and descriptions are entered only in the POS; "всяка промяна на цена се отразява автоматично"; live stock online; "Направените поръчки се появяват директно в POS системата"; the buyer is told the order's status | [VENDOR PAGE] |
| [zamboo.bg, Web Menu](https://www.zamboo.bg/web-menu.html) and [pricing](https://www.zamboo.bg/pricing-zamboo.html) | "Поръчки през телефон от маса в ресторанта"; "Автоматично зареждане на менюто на ресторанта в Web страница"; "Изпращане на поръчки към POS"; the module is free, plus a build price. Demo at webmenu.zamboo.bg. Nothing on approval, tickets, payment or an API | [VENDOR PAGE] |
| [zamboo.bg, Zamboo web](https://www.zamboo.bg/zamboo-web.html) | The restaurant run from a browser: "Приложи действие към отворена сметка". Open bills are reachable from outside the till | [VENDOR PAGE] |
| [mistral.bg, Управление на поръчките](https://mistral.bg/%d1%83%d0%bf%d1%80%d0%b0%d0%b2%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5-%d0%bd%d0%b0-%d0%bf%d0%be%d1%80%d1%8a%d1%87%d0%ba%d0%b8%d1%82%d0%b5/) | Online ordering platforms integrate, with order status in real time, through the kitchen display | [VENDOR PAGE] |
| mistral.bg, "Портали за поръчки" | "СТРАНИЦАТА Е В РАЗРАБОТКА... СВЪРЖЕТЕ СЕ С НАС" (the integrations page T69 found 10-11, unchanged) | [VENDOR PAGE] |
| [help.zamboo.bg, Ресторант](https://help.zamboo.bg/restaurant) | Staff screens: "РАЗДЕЛИ СМЕТКА" moves chosen items to a new bill and then asks for a "място на обслужване" (a place, so a split can land on another table); "ПРЕМЕСТИ" moves a whole bill to another table; "ОБЕДИНИ" merges; mixed payment with "ДРУГИ"; part payment only on a deferred "Продажба кредит"; storno. Nothing on partial quantities, printers, or whether a move reprints | [DOC] |
| [zamboo.bg, POS](https://www.zamboo.bg/pos.html) | "Интеграция с повечето банкови терминали на пазара"; fast splits, mixed payment per split bill; a bar tab moved to a table | [VENDOR PAGE] |
| Web searches (BG and EN) for a Zamboo or Mistral API, developer pages, partners | Nothing found | [NOT FOUND] |

**One legal point decides the route.** Н-18 чл. 52з, ал. 5 forbids a venue from adding outside modules to its sales software "без оторизация от производителя" (`2026-10-17-pos-integration-requirements.md`). Whatever the technique, Restro needs Mistral's written authorisation. So unofficial routes are ruled out:
- reading Mistral's database directly;
- driving the Zamboo web screens;
- calling the Web Menu's private endpoints.

They are also against rule 7 (only as a waiter, through an API) and CLAUDE.md ("never invent a POS method").

## 2. The possible routes

| Route | What it is | What it would cover | Likelihood |
|---|---|---|---|
| **A. A partner API** | Mistral gives Restro documented access: menu, tables, bills, orders, payments | everything below, if complete | unknown; Mistral 2 asks |
| **B. The Web Menu's back end, opened to Restro** | Restro uses the interface Zamboo Web Menu already uses | menu read and orders in, for certain; bill reading, moves and payments unknown | plausible: the function exists |
| **C. The e-commerce integration** | Restro plugs in as a "web shop" | menu, prices and stock read; orders in, probably not onto a table's bill; nothing on payments | plausible, but a poor fit for tables |
| **D. No integration** | Mistral says no | menu by hand (D64), "call a waiter" only; or a pilot on barsy | the fallback (unified doc, 13) |

The likely real answer is a mix of A and B, priced. Ask for A, and name B as the minimum ("the same access your Web Menu has").

## 3. The checker: each action, in the order of the feature

The columns:
- **Need** says how much the action matters:
  - **must**: no ordering at the pilot without it;
  - **pay**: no paying in the app without it;
  - **should**: a fallback exists but is worse;
  - **later**: not for the pilot.
- **Shown in Mistral's products** says whether one of Mistral's own products does it, which proves the system can.
- **Q** is the Mistral question number: 1–9 from `2026-10-17-pos-integration-requirements.md`, 10–18 from the unified doc's section 15, and 19–23 new, in section 4 below.

| # | Action Restro needs | Doc items | Need | Shown in Mistral's products | Route | If missing | Q |
|---|---|---|---|---|---|---|---|
| R1 | **Read the menu**: items, categories, prices, options and add-ons, what is sold out | 2, 5.3 | must | yes: Web Menu loads the menu; e-commerce syncs prices and stock | A, B, C | hand-made menu (D64), which loses the POS sync | 3, 18 |
| R2 | **List the tables** and which bar each belongs to | 2.8, 2.10 | should | tables yes (UI); bars per table unknown | A, B | tables and bars set by hand at setup | 16 |
| R3 | **Read a table's bill with its rows**: item, quantity, price, paid or not | 1.5, 3.4, 7.1 | **must (go/no-go, 7.8)** | partly: Zamboo web acts on open bills | A, B | **no ordering on Mistral** (Martin, round 1) | 8, 15 |
| R4 | **Who entered each row, and when** | 5.6, 9.6 | should | operators are recorded (reports per user) | A | a timed-out round is Unconfirmed at once (5.6 b); a table pause lifts only by staff, all bills closing, or 15 minutes | 15 |
| R5 | **Is the table open** (its bill has at least one item, or Mistral's own "open") | 3.4 | must | derived from R3 | A, B | as R3 | 10, 22 |
| R6 | **Add a round to a table's bill** as Restro's own POS user | 5.5, 5.8 | **must** | **yes: Web Menu "Изпращане на поръчки към POS"** | A, B | no ordering; "call a waiter" | 3 |
| R7 | **Refuse a duplicate round**: Restro's own id on a round, and a repeat with the same id creates nothing | 5.6 | should | unknown | A | read-back (R4), else Unconfirmed at once | 15 |
| R8 | **A note on a round that prints on the bar ticket** ("for Table 7 · QR K7Q") | 5.13, 6.10 a | should (pay-first) | unknown | A | pay-first rounds use 6.10 (c): the guest collects at the bar | 13 |
| R9 | **Approval at the bar**, and read it back | 5.11 | later | unknown | A, B | the capability is off; the state never shows (round 1, 2.2) | 14 |
| R10 | **Move chosen lines**, including part of a quantity (2 of 5 beers), from a table to another table | 8.1 | pay | **yes (UI): "РАЗДЕЛИ СМЕТКА" to a new bill with a "място на обслужване"**; partial quantity unknown | A | "pay for your own items" waits; whole-bill payment only | 11 |
| R11 | **Enter a round on a virtual table and close it with a card payment in one go** (pay-first) | 6.10 | pay | unknown (needs R6 plus R12) | A | pay-first items stay "ask your waiter" (1.11) | 12 |
| R12 | **Close a bill with a card payment** registered as card ("КАРТА"), which prints the fiscal receipt | 8.1, 8.4 | pay | yes (UI) | A | no paying in the app | 4 |
| R13 | **Read back the closed bill**: closed, the payment on it, the receipt number and УНП, a copy of the receipt | 8.4, 7.3 | pay | unknown | A | "Download receipt" gives the provider's confirmation only; reconciliation by hand | 8, 17 |
| R14 | **Read Restro's virtual tables** and confirm they are empty | 2.9, 9.11 | pay | as R3 | A, B | as R3 | 12 |
| R15 | **A cheap read for health checks**, and whether the fiscal printer is ready (Annex 29 т. 8) | 9.3, 9.4 | should | unknown | A | probes use R3 on one table | 4 |
| R16 | **Sign-in model**: one POS user for all bars, or one per bar; a test installation | 2.1, 2.10 | must | each bar logs in (Martin's recollection) | A, B | one connection per bar (rule 9 allows it) | 2, 19 |
| R17 | **Several card payments on one close** | 8.10 | later | yes (UI): mixed payment "ДРУГИ" | A | one card per payment | 20 |
| R18 | **Pay an amount** off an open bill | 8.9 | out at the pilot | only as a credit sale | — | not offered | 6 |
| R19 | **Storno and refunds** | 8.8 | not needed from the API | yes (UI) | — | done at the venue, as decided | 7 |
| R20 | **Written authorisation** under Н-18 чл. 52з, ал. 5, terms and price | all | **must** | — | A, B, C | no integration (route D) | 21 |

Not needed, and not to be asked for: webhooks and POS registration (rule 7, D41), writing items, prices or settings (back office, rule 7).

**Ticket behaviour.** These are not API calls, but they decide the design (unified doc 6.10, 8.1):
- Does a move (R10) reprint a ticket? If it does, paid drinks are made twice, and R10 is unusable as it stands.
- Does a sale closed at once (R11) print a ticket at the bar?
- What does a ticket show: the table, the operator, a note (R8)?

These are questions 11 and 13.

## 4. New questions for Mistral Software

These add to questions 1–18.
19. Does each bar log in to Mistral separately? Can one outside POS user act on the tables of all bars, or does it need one per bar?
20. Can one close carry several card payments, from several payers? (Group payment, 8.10: to be asked of the payment provider too.)
21. Will you give written authorisation (Н-18 чл. 52з, ал. 5) for Restro to connect, and on what terms and price?
22. Is a table "always live" (a closed bill leaves the table waiting for the next first item), or does staff open a table? How can an outside app read which?
23. Can Restro use the same interface your Zamboo Web Menu uses: menu, orders to a table, order status? Is it documented?

## 5. Go / no-go

Read the result in three steps. Each step is worth doing alone.

| Step | Mistral must give | What the pilot gets |
|---|---|---|
| 1. Menu from the POS | R1, R16, R20 | the guest page shows the venue's real menu and sold-out items; no ordering |
| 2. Ordering on the bill | + R3, R5, R6 (R4 or R7 strongly wanted) | guests send rounds to their table's bill; pay at the bar as today |
| 3. Paying in the app | + R10, R11, R12, R13, R14 (and the ticket answers) | pay-first items and "pay for your own items" |

- **No R3 or no R6:** no ordering on Mistral (Martin's rule, round 1, 7.8). The pilot runs step 1 only, or moves to a barsy venue. That choice is Martin's.
- **No R1:** the pilot's menu is built by hand. Note that D90 fixes a venue's source when it is created, so a venue built by hand can't later switch to Mistral without being made again.

## 6. What to do next

1. **Martin** sends questions 1–23 to office@mistral.bg. Put 21 and 23 first: they decide the route.
2. **Martin** asks the pilot venue:
   - its Mistral product and version;
   - how its bars log in (19);
   - a photo of a bar ticket.
3. **On Mistral's answer:** an agent fills this checker's "Shown" and "Route" columns from the documentation, and the connector is unparked (D79 and the CLAUDE.md scope need Martin's go).
