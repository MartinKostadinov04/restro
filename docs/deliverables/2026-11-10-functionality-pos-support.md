# Every Restro function, by what happens when a POS or payment provider can't exchange its data

Made by: the independent review agent (Fable), 11-10, read-only on `or/staging-chain-plan` (carries `or/foundation` bb8cfa26; `origin/rv/foundation` at 743ed464 and `origin/st/foundation` were read only where a row needed them). For: Martin and the lead, as the merge of the four parts in `docs/deliverables/2026-11-10-functionality-parts/` (ordering O/N, paying P/S/R, menu-admin rows 1–48, cross-cutting X/G) and the answer to his two questions. Builds on `2026-11-10-connector-architecture-review.md` ("the review"). Informs, never binds (D114). Words follow `GLOSSARY.md`.

**The question is capability only** (Martin, 11-10): can the POS, or the provider, send or receive the data at all? Data quality, rate limits and connection health are a later pass and are left out.

**Levels** (Martin's, 11-10). **DEAL BREAKER:** a key function can't run, or staff can only fill the gap per order or per payment. **SURVIVABLE:** the key functions run and staff fill the gap a few times a night with little effort. **COVERED:** the owner fills it once at setup, no night effort. **NOT POS-RELATED.** Key functions: (1) **Menu**, the venue's real menu from the POS; (2) **Order**, a guest's order lands on the table's bill in the POS; (3) **Pay**, a guest pays in the app and the bill closes in the POS.

How to read: **Fact** = seen in the code or a document at the path given; **Opinion** = my judgement; **planned** = specified, not merged; **[unknown]** = nobody has confirmed it. Source row ids (O7, S3, row 26, X7, G4) are kept so the authors can trace every line. Reservations decisions 134–141 have files only on `rv/foundation` and are written without the letter.

---

## For Martin, in plain words

**What the four lists add up to.** Of about 150 functions, two thirds exchange nothing with a POS or a provider: the design, the Log, roles, reservations, the guest's bag, the limits, the alerts. They run on any POS and on no POS. The rest divide cleanly by the three key functions.

**Menu.** The POS must give one thing: its sellable items with names and prices, through an interface we can sign into. Everything else in the menu (public names, sections, allergens, photos, happy-hour badges) the owner fills once in the composer, with nothing to do at night. That is already how Restro works, and it is the right line. Mistral's documented interface passes this tier today.

**Order.** The POS must give five things: its tables with their ids, the table's open bill with its lines, a way to add a round to it, a refusal that says *why* (so a sold-out drink is not quietly dropped), and the round must print at the bar. Nothing in Restro can stand in for any of these, and nothing should: a round Restro only pretends to place is a second truth beside the till. Two more depend on how the venue works: whether phones may open the first bill on an empty table, and whether an outside app may add to a bill a waiter opened. On a one-bill POS like the pilot's, the second one decides everything. Mistral's documented interface passes none of the five; whether a second interface exists is the open question.

**Pay.** Everything Order needs, plus: spare tables Restro may use, moving lines onto one and back, reading it, and closing it with a card payment that prints the fiscal receipt. On the provider's side: an account per venue, a hold on the card before anything moves, reading a payment back, capture and release, and a card form inside our page. Tips, part quantities, receipt numbers, electronic receipts and wallets are extras that degrade without staff work.

**Where it is not clean.** One decision needs a narrow reopening: on a POS venue the owner's "sold out tonight" switch was removed because "the POS says what ran out" (D124 §6). On a POS that can't say, nobody can mark a drink sold out, and the bar then refuses orders one by one, which is a deal breaker by your definition. Bringing the switch back only where the POS can't say turns it into a few taps a night. Six rows (part quantities, lost close answers, pay-first notes, electronic receipts, options on drinks, timed-out rounds) turn on numbers nobody has: the first pilot nights should count them. And three rows describe things the decisions say and the code does not yet do (the Log of line moves, the pre-opening check of the cash desk, a daily refund list); they are marked.

**Your question A, filling within Restro.** Yes, by design, and only for the menu: every menu field gets a declared chain, POS → owner at setup → staff at night → hidden, written once per POS kind in its declaration, so the composer knows which fields the owner owns outright and the guest page never shows a stale warning for a field the POS never gives. Staff at night may only hide or mark sold out. Nothing on the ordering or paying side is ever filled by Restro; there the chain is POS → waiter → hidden.

**Your question B, the line.** Restro fills what is set once, makes the menu more cautious, and creates no record the POS should hold. It never fills a bill, a round, a payment, a receipt, a price or a stock count. A POS that passes only the Menu tier gets a live menu, Call a waiter and reservations; one that passes Order but not Pay gets "Ask your waiter to pay"; one that passes nothing gets a hand-made venue the owner maintains, with reservations and waiter calls, and a one-page list to hand its POS vendor (the 11-07 Mistral letter is that template). What a POS can't expect is for Restro to pretend: no emulated bill, no order queue of our own, no "paid" the till never saw.

Five questions for you are at the end; each changes a level or a tier.

---

## 1. What was read, spot-checked and corrected

The four parts were read whole. The POS-related claims they rest on were spot-checked on this branch (all **Fact** unless noted):

- `readsFloor(kind)` lists only `sim`; the service connector is bound with an `if` (`apps/worker/src/service-connectors.ts:50-52, 68-77`). O1, O4, S1 and row 31 stand.
- `chooseTargetBill` (`packages/core/src/connectors/service/target-bill.ts:38-55`): with `billOpeningTime` undeclared the opening-time filter is **skipped entirely**; with `addToStaffOpenedBill` undeclared only bills Restro opened are joinable; with `firstItemsOpenBill` undeclared and nothing joinable the answer is `needs_first_item`. O7, O8, O10 stand; G4's "deal breaker" does not (section 2.2).
- Paying is offered only where a POS of the venue declares both `closeWithPaymentType` and `moveLinesToTable` (`packages/core/src/service/payment-connection.ts:232-243`); pay-first only with `firstItemsOpenBill` (`service/pay-first.ts:102-121`). S3, S7, S13 stand.
- `payAndClose` is called with `paymentType: null` (`apps/worker/src/jobs/payments.ts:1674`): S7's note stands.
- `readRefunds` is called only by the notice job (`apps/worker/src/jobs/provider-notices.ts:273`); no daily list job exists. P11 stands: **planned, not built**.
- `openPayCloseInOneCall` is used by no production code. S16 stands.
- The Log has no kind for a line move (`packages/core/src/service/log.ts`, grep). X7 stands: decision text, not code.
- After an `unknown` add, a partial landing reads `ambiguous` → Unconfirmed (`packages/core/src/landing-match.ts:153,165`): safer than O14 says. What stays undefined is a `done` answer with silently dropped rows (section 2.2).
- `createTable` **refuses** a venue that serves a till (`packages/core/src/apply/tables.ts:876-897`, `from_till`); the sold-out mark is for hand-made venues only and the composer hides the switch on a POS venue (`apply/sold-out.ts:19,60`; `apps/web/src/composer/composer-tab.tsx:181`). So menu-admin rows 26 and 31 misread the review's *policy* ("hand-made tables allowed on a floorless POS venue") as built: **today a POS venue whose kind has no floor reader has no tables at all.** Corrected in 2.1.
- The pre-opening check probes the POS like the connection probe (`apps/worker/src/jobs/service-hours.ts:6-12`, `jobs/index.ts:113`); I found no check of the cash desk or the approval mode (grep). G1 describes D120, not the code.
- Stock marks lapse at the next service day where the POS can't be asked (`apps/worker/src/jobs/stock.ts:10,209`). O20 stands.
- X15 is **superseded**: on `origin/rv/foundation`, `packages/core/src/service/permissions.ts:4-7` makes the default roles a preselection a venue may tick and untick (#366, PR #371). The local branch still has the fixed-and-copied text.
- #319, #329 and #331 are open issues (gh, 11-10): N18, N19, O23's code-following and rows 39–41 are **planned**.

---

## 2. The merged list

Columns: merged id and the source rows; the function; the authors' proposed level; **my level**; why, and where I differ. Rows that need a real night's numbers are marked **needs numbers** and collected in 2.5.

### 2.1 Menu (key function 1)

| Id (sources) | Function | Authors | **Mine** | Why / difference |
|---|---|---|---|---|
| M1 (row 1, 12, 13) | Read the venue's sellable items with names and prices through an API Restro can sign into; sync on a schedule | DEAL BREAKER | **DEAL BREAKER** | This *is* the key function. Rows 12 and 13 are the same door and are merged here, not stacked. A POS with no API → hand-made venue at creation (D87, D89), see section 4 |
| M2 (row 2) | A public item name per language, distinct from the till's | COVERED | **COVERED** | D75's fallback shows the till name with a composer warning; the owner renames once (D92) |
| M3 (row 3) | A price, per venue where the POS has several | DEAL BREAKER | **DEAL BREAKER for a missing price; COVERED for "one price for all venues"** | The breaker is "no price": an unpriced item is never orderable and a menu without prices is not a menu. A POS with one price list for every venue is simply read as such; nothing per venue is needed |
| M4 (row 4) | Sections and the venue's menu root | COVERED | **COVERED** | The owner's own sections through the mapper (D92); new POS items land in Unsorted |
| M5 (row 5, O17) | Options and modifiers **with their rules** (required, min, max, default), menu side; and the chosen options on the line, order side | row 5: DEAL BREAKER for items with options; O17: depends on the share | **Menu: COVERED. Order: SURVIVABLE below a share of sent orders, DEAL BREAKER above it (needs numbers)** | On the Menu tier the item still shows; the gap costs nothing at night. On the Order tier an item whose rules Restro can't read is ordered from the waiter (D122 §4; `send-menu.ts:125`, `build.ts:319`): that is a waiter visit per such order, so the level follows the share of sent orders that carry such an item. Today the rule rides on `notesReachTicket`, the wrong flag (review F12). **Disagree with row 5's blanket "deal breaker":** it is one only where such items are a routine part of the night |
| M6 (row 6) | Allergens per item | COVERED | **COVERED** | The owner's own allergens (D89) with a composer notice "your POS gives none". The legal duty stays the venue's either way |
| M7 (row 7) | Item images | COVERED | **COVERED** | |
| M8 (row 8, O19, O20, X4, N12) | Sold out: read a flag at the sync and before a Send; clear the mark when it is back; the renderer hides it | row 8 and O19: SURVIVABLE *if* the owner's switch returns; X4 inherits | **Two outcomes.** With the owner's switch back where no POS source is declared: **SURVIVABLE** (a few taps a night, by whoever holds `sold_out`). As built: **DEAL BREAKER** on any POS that can't say stock | Today only a hand-made venue marks sold out (`apply/sold-out.ts:19`), and a POS venue relies on `itemAvailability` or a refusal naming the line. A POS with neither (Mistral's documented API: `0.0` for an item on sale, no round to refuse) leaves the bar refusing drinks per order, which is Martin's definition of a breaker. Question 1 for Martin. Rule 5 allows the switch: marking sold out only makes the menu more cautious |
| M9 (row 9) | Time-based prices (happy hour) | SURVIVABLE | **SURVIVABLE on Menu; its Order half is O6** | The base price shows; Restro never computes a POS's time rule. Where the POS prices the round itself, the till applies the rule; where it does not, see O6 |
| M10 (row 10, 11) | An item deleted in the POS leaves the menu (after a complete full read); the absence hold | SURVIVABLE; row 11 not POS-related | **SURVIVABLE** | Rule 6 works from absence alone; a delete flag only makes it faster (B1-L5) |
| M11 (row 28) | List the POS's venues or installations so the owner links one | COVERED where an id can be typed; DEAL BREAKER where nothing identifies the venue | **COVERED** | A typed id is a setup step; I know of no POS where a venue can be reached by neither a list nor an id. [unknown] per POS, and the breaker case is theoretical |
| M12 (row 34) | What a sync job reports: counts, warnings, what failed | SURVIVABLE | **SURVIVABLE** | A read that can't say what failed concludes nothing; slower, not broken |
| M13 (rows 26, 31, O1's menu half) | A scanned table code resolves venue → area → table; the menu routed per code (D95) | row 26, 31: SURVIVABLE ("hand-made tables allowed") | **COVERED once owner-made tables are allowed on a floorless POS venue (the review's policy, not built); today the table codes simply do not exist on such a venue** | Correction of fact: `createTable` refuses a venue that serves a till. The Menu key function still runs at the venue's address (D84), so this is not a breaker; table codes, per-table menus and per-table waiter calls are absent until CF-19 builds the policy. Ordering on such tables is impossible either way (O1) |
| M14 (G5, row 13's account half) | Restro's own POS user and credentials, one per connection per environment | COVERED | **COVERED** | Rule 9. Rotation without losing links is review F7, a later pass |
| M15 (G7) | Money rules per POS: currency, rounding grain and direction | COVERED once declared; undefined today | **COVERED once declared (CF-06); undefined today** | One currency and one rounding rule "like barsy" (`money.ts:2,9`). A POS that rounds otherwise would show a total the till disagrees with (D72). Not a night gap, a declaration gap |

### 2.2 Order (key function 2)

| Id (sources) | Function | Authors | **Mine** | Why / difference |
|---|---|---|---|---|
| O1 (+ row 31's ordering half, S2's floor) | Read the floor: tables with the POS's ids, their hall, changes during the night | DEAL BREAKER for Order | **DEAL BREAKER for Order** | A round must name the POS's table. No Restro-made table can stand in: there is nothing on the POS side to add the round to |
| O2 | Which halls belong to this venue | COVERED | **COVERED** | `floor_source`, set once |
| O3 (+ row 32, S17) | Which bar serves a table: per-bar pause, Tonight by bar, payment tables per bar | COVERED | **COVERED** | D124 §1's degraded mode is built: one bar, one queue, "Pause ordering" for the whole venue. Three rows merged |
| O4 (+ S1, G3, G9, X6, X10, X12, N4's end, N13's sheet) | Read the table's open bills with their lines, each line's item id and own amount, total, paid, owed | DEAL BREAKER | **DEAL BREAKER for Order and Pay** | D122 §1's must-have. Everything that reads a bill inherits it: the guest's bill, "Bill before this order", the match after a Send, the sitting's end, Tonight's table sheet, pricing a payment, the Log's landed entries, the night totals' "reached the bill". G3 (lines under the published name) degrades to the POS's text where a line has no item id, which is SURVIVABLE on its own |
| O5 | Add a round to the table's bill | DEAL BREAKER | **DEAL BREAKER** | The function itself |
| O6 (+ S15, row 9's order half, C12) | The POS prices the round itself and its total reads back; Restro sends no price | depends on O4 | **Order: SURVIVABLE where O4 holds, as a venue-acknowledged setting (question 2). Pay and pay-first: DEAL BREAKER without a total read back (S15)** | With O4, the bill shows what was charged, so a price Restro sent (the POS's own published base price, rule 5) is visible and consistent with D72: the guest pays what was shown. What is lost is the POS's own time rule on phone orders, a venue-level trade-off, not a staff gap. Without a total read back, a payment can't be priced from the POS's amounts (D127 3.2), so paying hides. This refines the review's §5.4 question 2, which recommended hiding ordering too; O6's author convinced me the Order half is survivable *with* O4 |
| O7 (+ S13, R12) | First items open a bill on an empty table; pay-first rests on it | depends on how sittings start | **SURVIVABLE where a waiter rings the first round (bottle service, the pilot's workflow); DEAL BREAKER where phones are meant to start a sitting. Pay-first: hidden (COVERED-like) where undeclared** | Not a number, a workflow question per venue, answered once. The refusal is built ("Ask your waiter to put your first item on") |
| O8 (+ O9) | Add to a bill a waiter opened; several bills per table | one-bill POS: DEAL BREAKER; multi-bill: SURVIVABLE | **One-bill POS: DEAL BREAKER. Several bills per table: SURVIVABLE** | Verified in `target-bill.ts:46-47`. On the pilot's one-bill POS this row decides whether phones can order at all once a waiter rang anything |
| O10 (+ G4) | Never yesterday's bill: the bill's opening time | O10: SURVIVABLE; G4: DEAL BREAKER | **SURVIVABLE. Disagree with G4** | Where `billOpeningTime` is undeclared the check is skipped (`target-bill.ts:48-51`) and a round could join a leftover bill. Staff closing leftover bills before opening is a once-a-night habit most venues already have. Recommend one line in the pre-opening alert where undeclared: "Close yesterday's bills before opening" |
| O11, O12, O13 (+ G2, N11) | Did it land: who entered a line, Restro's reference, a repeat creates nothing; the Unconfirmed answer and the pause that lifts on a waiter's act | SURVIVABLE while timeouts are rare | **SURVIVABLE (needs numbers)** | The design never resends (D115). What costs staff is an Unconfirmed sent order; the number is how many per night. Without O11 and O12 the match is by elapsed time and new lines, so more rounds end ambiguous |
| O14 (+ C18, C46, C47) | A round is all or nothing; a refusal names the line and the reason | unknown → likely deal breaker if rows are dropped silently | **SURVIVABLE where the POS refuses whole or names the line. [unknown], and a DEAL BREAKER if confirmed, for a POS that answers "done" and drops a row** | Correction: after an `unknown`, a partial landing is `ambiguous` → Unconfirmed, never Added (`landing-match.ts:153,165`). The undefined case is narrower than O14 says: a `done` answer that is not whole. Recommend a conformance check "done means every line is on the bill" and, for a POS that can't promise it (C18), a connector that reads back after every done, at the cost of one read per Send. Ask the vendor; don't assume |
| O15 | The round prints on the right bar's ticket | DEAL BREAKER if the POS doesn't print; not modelled | **DEAL BREAKER where it doesn't; today undeclared** | Nothing in Restro declares or checks it. Recommend a declared capability `routesToTicket`, set from the vendor's answer (C14) and proven once on the test installation; a kind without it hides Order |
| O16 | A note on a line reaches the ticket | SURVIVABLE | **SURVIVABLE** | "Allergies or special requests? Tell the staff." |
| O18 | Approval at the bar | SURVIVABLE | **COVERED** | Zero night effort: the venue setting is not offered. Small difference of label only |
| O21 (+ S8) | Probe and pre-opening check: reachable, answering correctly; the fiscal device's state | SURVIVABLE | **SURVIVABLE** | Any cheap read gives reachability; a device fault without state shows as a refused close, which the close pause already handles |
| O22 | Training mode detected | SURVIVABLE / unknown | **SURVIVABLE; NOT POS-RELATED for a POS that has no training mode** | Nothing to detect where none exists (D124 §5) |
| O23 (+ N18, #331) | Move a bill when a party changes tables | SURVIVABLE | **SURVIVABLE (planned)** | Staff move it at the till; Restro moves the code (#331 open). No command is invented (D110) |
| G1 | Pre-opening check of credentials, Restro's cash desk and the approval mode | COVERED / SURVIVABLE | **SURVIVABLE; the cash-desk and approval parts are decision text (D120), not code** | The check probes only (`service-hours.ts:6-12`). The first Send fails loudly and pauses the connection. The approval mode is a venue setting (COVERED) where the POS can report it [unknown for both POSs] |
| Rows 39, 40 (#329) | Arrivals open the table for phones; the open-bill warning at arrival and at freeing | 39: SURVIVABLE door / DEAL BREAKER ordering half; 40: SURVIVABLE | **Inherit O1 and O4 (planned)** | Reservations exchange nothing with a POS (134); the two touch points are ordering's seam |
| X7 (+ G6) | The Log records line moves made at the POS, and who moved them | SURVIVABLE | **SURVIVABLE; decision text, not code** | D122 (line 202) says it; `log.ts` has no such kind. A manager asks at the till a few times a night. Whether Restro's staff should ever be linked to the POS's waiters (G6) is a question outside this pass |

### 2.3 Pay (key function 3)

**Provider side**

| Id | Function | Authors | **Mine** | Why / difference |
|---|---|---|---|---|
| P1 | The venue's own account, created and read through the provider | DEAL BREAKER | **DEAL BREAKER** | No account, nothing to charge (D98, D125) |
| P2 | Hold before any line moves | DEAL BREAKER | **DEAL BREAKER** | D124 §4: no holds, no paying |
| P3 | Read a payment back by our id after a timeout | DEAL BREAKER | **DEAL BREAKER** | D125 3.9 |
| P4 | Capture once; release | DEAL BREAKER | **DEAL BREAKER** | |
| P5 | Capture less than the hold | SURVIVABLE | **SURVIVABLE** | A manager answers "Payment unconfirmed" on a rare price drop |
| P6 | Hold window | SURVIVABLE | **SURVIVABLE** | Only unconfirmed payments are at risk |
| P7 | Card form inside the page, 3-D Secure, no redirect | DEAL BREAKER | **DEAL BREAKER** | D126's reason for Stripe; a hosted-page provider has no defined path |
| P8 | Apple Pay and Google Pay | COVERED | **COVERED** | Guests type a card |
| P9 | Smallest payment | COVERED | **COVERED** | A venue setting over the provider's floor |
| P10 | Signed notices | SURVIVABLE | **SURVIVABLE** | The worker's reads carry payments; refunds and disputes have their own rows |
| P11 | See a refund the venue made; the storno to-do | SURVIVABLE if the daily list is built; undefined until then | **SURVIVABLE once built; today undefined for a provider without refund notices (planned, D122 §8)** | Verified: `readRefunds` runs only from a notice. Stripe sends notices, so the pilot is unaffected |
| P12 | See a dispute; the evidence page | SURVIVABLE | **SURVIVABLE** | Rare; the venue's own dashboard has it |
| P13 | A key that cannot refund | open for Martin; recommends DEAL BREAKER | **DEAL BREAKER for that provider, pending question 3** | "Restro never refunds" is a rule (D125 3.5, D132), and the guardrail test only proves our code holds no refund call, not that the key could not |
| P14 | Provider receipt emails off | COVERED | **COVERED** | |

**POS side**

| Id | Function | Authors | **Mine** | Why / difference |
|---|---|---|---|---|
| S1 → O4 | Read the bill's own line amounts to price a payment | DEAL BREAKER | **DEAL BREAKER (merged into O4)** | Same seam, same answer |
| S2 (+ O1) | Payment tables: spare tables Restro may use, marked by a manager | COVERED where the POS lets the owner make spare tables; DEAL BREAKER with no table list | **COVERED; a POS with no table list is O1's breaker** | Whether a venue can add virtual tables is a POS setup fact to ask (the pilot club already uses them) |
| S3 | Move the picked lines onto a payment table | DEAL BREAKER | **DEAL BREAKER** | The only route built for a one-bill POS (D122 §8); verified gate |
| S4 | Move part of a line's quantity | SURVIVABLE if few payments split a line; DEAL BREAKER if routine | **SURVIVABLE (needs numbers)** | Whole lines only, "Ask your waiter to split" otherwise |
| S5 | Read the payment table back | DEAL BREAKER | **DEAL BREAKER** | The last check before close and capture (D127 3.1) |
| S6 | Move the lines back after a failure | DEAL BREAKER in principle | **DEAL BREAKER, in practice it comes with S3** | A POS that moves lines moves them back |
| S7 | Close with a card payment type; the till prints the fiscal receipt | DEAL BREAKER | **DEAL BREAKER** | The defining example. `paymentType` is sent null and the connector picks its card type (#111 open): a small follow-up, not a level |
| S9 | Receipt number on close | SURVIVABLE | **SURVIVABLE** | Capture still happens on a done answer; a "no receipt" line per payment on the night list is noise worth a follow-up |
| S10 | Read a closed bill (third proof of a close) | SURVIVABLE if close timeouts are rare | **SURVIVABLE (needs numbers)** | Each lost close answer is a manager's "Receipt printed / No receipt" |
| S11 | The tip on the same bill and receipt | SURVIVABLE (a business loss, no staff effort) | **SURVIVABLE: the feature is hidden, zero night effort, in-app tips lost** | Martin's levels measure staff effort; a hidden feature with none fits best here. Open with Lukanet, Mistral and the accountant (D127 §Open) |
| S12 (+ R1) | Electronic receipt to the guest's email; else the waiter brings paper and taps "Brought" | SURVIVABLE; turns per-payment as the in-app share grows | **SURVIVABLE (needs numbers; question 5)** | The paper receipt must be handed to the payer by law whether or not Restro exists (Н-18 чл. 25 ал. 6; D122 §8), so the walk is not a gap Restro opened; the extra is one tap without a PIN. If Martin counts that tap as per-payment effort, this row flips by definition |
| S14 | Pay-first: the ticket names the guest's real table | SURVIVABLE with little pay-first; DEAL BREAKER where pay-first is the main way | **SURVIVABLE (needs numbers)** | A lookup on Tonight per pay-first order without the note |
| S15 → O6 | Pay-first: the payment table's total read back | DEAL BREAKER | **DEAL BREAKER (merged into O6)** | |
| S16 | Open, pay and close in one call | NOT POS-RELATED today; drop or explain | **Drop from the capability list, or tie it to a path** | Declared, used by nothing (verified). A list of declarations nothing reads is a list that drifts |
| G7 → M15 | Money rules | | | merged |
| G8 | A test installation of the POS to prove writes before go-live | SURVIVABLE | **A go-live gate, not a night level: no Pay at a POS without one (D124 §5, rule 7); Order too unless Martin accepts a supervised first night (question 4)** | Development and tests never run against a live venue's POS; an unproven write path is not "survivable", it is unproven. D122 §8 lists "the first write at a POS with no training mode" under Later |

### 2.4 Staff and admin rows that touch a POS

Most staff and admin functions exchange nothing (appendix A). These do, or inherit:

| Id | Function | **Mine** | Note |
|---|---|---|---|
| row 30 | Unlink a POS venue; re-link on restore if still free | **SURVIVABLE** | Rare; fails loudly (D90) |
| row 33 | The capability declarations themselves | **NOT POS-RELATED** | Where every other answer is recorded; section 3 extends it |
| X6, X10, X12 | Log entries about what the POS did; night totals' order counts; Send latency | **Inherit O4 and O5** | Zero where ordering is hidden |
| G2 | A pause lifts when a waiter acted at the till | **SURVIVABLE** | Staff tap Resume otherwise |
| G6 | No link between Restro's staff and POS waiters | **SURVIVABLE** | Accountability for POS-side acts stays in the POS; a question for a later pass |
| G9 | The bill's age during a pause | **Inherits O4** | |
| row 37 (137) | The floor plan's spots may be the POS's tables | **SURVIVABLE** | Hand-made spots otherwise; one setup job |

### 2.5 Rows that need a real night's numbers

Nobody has measured these; the parts' "typical night" figures are assumptions. Martin's definition makes the flip precise: a gap filled **per order or per payment** is a breaker; **a few times a night** is survivable. The quantity to count, and the flip, for each:

| Row | Count on pilot nights | Flips to DEAL BREAKER when |
|---|---|---|
| M5 / O17 | Sent orders that carry an item with a required option group, as a share of all sent orders | the share makes a waiter visit routine rather than occasional. *Opinion:* above roughly one in ten; the threshold is Martin's |
| O11–O13 | Sent orders that end Unconfirmed per night | staff answer more than a few a night |
| S4 | Payments that would split one line, as a share of payments | a split is asked on most tables rather than now and then |
| S10 | Closes whose answer was lost per night (each is a manager's answer) | more than a few a night |
| S12 / R1 | Payments in the app per night, and whether Martin counts the "Brought" tap (question 5) | if the tap counts, any routine volume; if not, it never flips |
| S14 | Pay-first orders per night at a venue without `notesReachTicket` | pay-first is the venue's main way of ordering |

D144's night totals already count payments, captured and unconfirmed. They count neither split requests, nor required-option items in sent orders, nor e-receipt requests; the pilot's first nights need those three added, or counted by hand.

### Appendix A: NOT POS-RELATED rows, as the authors classified them (agreed)

Ordering: N1–N3, N5–N10, N14, N16, N17; N4 (its end inherits O4), N7 (per bar inherits O3), N12 (fed by M8), N13 (its sheet inherits O4), N15 (per table inherits O1), N18 and N19 (**planned**, #331, #319). Paying: R1–R12 (R1 is S12's counterpart; R12 rests on O7), P15 (provider health, the later pass). Menu and admin: rows 11, 14–25, 27, 29, 35, 36, 38, 41–48 (rows 39–43 and 45 are **planned**, `rv/*`). Cross-cutting: X1, X2, X3, X5, X8, X9, X11, X13, X14, X15 (**superseded**: default roles are editable, #366), X16–X21.

---

## 3. Answer to (A): filling within Restro, by design

**The principle.** A connector never fakes what the POS can't exchange. It *declares* it, once per kind, and the platform knows for every field who fills it next. That turns today's implicit fallbacks (D75's name, D89's owner enrichment, the waiter sentences) into one declared chain per field, so the composer, the guest page and the conformance suite all read the same answer.

### 3.1 The chain

Every menu field has a source chain with up to four steps, in this fixed order:

1. **POS** — where the kind declares it gives the field.
2. **Owner at setup** — the composer's manual layer (D89, D92): names, descriptions, photos, allergens, sections, the time-price badge. No night effort.
3. **Staff at night** — only two acts, both already permissions in `permissions.ts` (`sold_out`, hide): mark sold out, hide. Nothing else, because nothing else can be done at night without becoming a second truth.
4. **Hidden / "Ask your waiter"** — the item or the feature is not offered.

The chain is **declared per field in the connector's manifest** (CF-06), as data core and the web both read:

```
menu: {
  fields: {
    name:        { pos: 'public_or_internal' },   // or 'public' | 'none'
    price:       { pos: 'per_venue' },            // or 'one' | 'none'
    sections:    { pos: true },
    modifiers:   { pos: 'groups_with_rules' },    // or 'groups' | 'none'
    allergens:   { pos: 'coded' },                // or 'free_text' | 'none'
    image:       { pos: true },
    availability:{ pos: 'flag' },                 // or 'quantity' | 'none'
    timePrices:  { pos: 'current_at_read' },      // or 'schedule' | 'none'
  },
  deleteSignal: 'absence' | 'flag' | 'tombstone',
  delta: 'none' | 'since' | 'ids',
}
```

The platform derives the chain from it: a field with `pos: 'none'` is **owner-owned** on that kind (the composer shows it as the owner's own field, with the notice "your POS gives no allergens", and never a stale-value warning); a field with a POS source keeps today's behaviour (owner value over the POS's, by the field's combinator). `availability: 'none'` is what brings the owner's and staff's sold-out switch back (M8). `modifiers` below `groups_with_rules` makes option-bearing items waiter-only for ordering (M5).

The **service side has a different chain**, and a shorter one: **POS → waiter → hidden.** Restro never fills a bill, a round, a payment or a receipt. The existing capabilities already encode it (O7's sentence, D124 §3's own-bill fallback, "Ask your waiter to pay", no tip row, paper receipt). Three declarations are missing and should join the 21: `readsBill`, `readsFloor` (today implicit in which kinds have a connector, review F1), `routesToTicket` (O15) and `posPricesLines` (O6). `openPayCloseInOneCall` goes, or gets a path (S16).

### 3.2 How it fits the binding rules

- **Rule 5** (our layers only make the menu more cautious): steps 2 and 3 can add text, photos, allergens and sections, and can hide or mark sold out. They can never un-hide, put back on sale, create a POS item or change a price. The chain's fourth step is "hidden", never "shown anyway".
- **D72** (no local success): the chain applies to menu data only. No step of any chain produces a "sent", "paid" or "received" the POS did not confirm. The service chain's fallback is a sentence to the guest, not a state.
- **D87** (source fixed at creation) and **D85** (new venue from a POS, nothing typed): because the kind is known at creation, the whole chain is known at creation. "New venue from a POS" can show the sheet "what this POS gives you, and what you will fill yourself" before the owner confirms, and the composer opens with the owner-owned fields already marked. Nothing is revisited later, which is D87's point.
- **D110 / rule 7**: no step writes into the POS. Owner and staff fills live in Restro's layers; the POS never learns of them (D26's translation push stays its own decision).
- **D122 §3** ("undeclared means not claimed"): a field not in the manifest is `pos: 'none'`, the cautious reading.

### 3.3 What goes into CF-06, and what follows

- **CF-06 (manifest):** the `menu` block above beside the existing service capabilities; the four new service flags; `money`, `api.version`, credentials and host policy as the review proposed. The conformance kit gains one check per declared `pos` field: a kind that declares it must produce it from its fixture read; a kind that declares `none` must never write that field with till provenance.
- **CF-19 (the policy in the product):** the composer's owner-owned marking and notices; the sold-out switch gate becomes "serves a till *that declares an availability source*" (`apply/sold-out.ts:60`); option gating moves from `notesReachTicket` to `modifiers`; owner-made tables on a floorless POS venue for the menu and Call a waiter (`createTable`'s `from_till` refusal becomes "from a till that gives a floor"); the "what this POS gives" sheet on New venue.
- **Not in any CF:** staff filling anything per order or per payment. By Martin's definition that is a breaker, and by D111 it would be a second record of the bill.

---

## 4. Answer to (B): where the line is

### 4.1 Minimum requirements per tier

A POS **passes a tier** when its connector declares every must-have of that tier. The declarations are the manifest's; nobody ticks them per venue.

| Tier | Must-haves (from the POS) | From the provider | Also needed once |
|---|---|---|---|
| **Menu** | M1: sellable items with names and prices, through an API with an account (M14); M11: a way to identify the venue; M15: currency and rounding declared | — | — |
| **Order** | Menu, plus O1 tables with ids; O4 the table's bill with lines and item ids; O5 add a round; O14 a whole refusal that names the line (or a connector that reads back after every done); O15 the round prints at the bar; and **one of** O7 (phones may open the first bill) or O8 (phones may add to a waiter's bill), matching the venue's workflow. O6 as question 2 decides | — | a test installation (G8), unless question 4 says otherwise |
| **Pay** | Order, plus S2 spare tables; S3 move lines; S5 read the payment table; S6 move back; S7 close with a card type that prints the fiscal receipt; a total that reads back (O6/S15) | P1 account; P2 holds; P3 read-back; P4 capture and release; P7 in-page form; P13 a key that cannot refund | a test installation (G8); the owner's four checks (D125 2.3) |

Everything not in the table degrades without staff work (COVERED) or with a few acts a night (SURVIVABLE), as section 2 says, and the night's numbers (2.5) may move six rows.

### 4.2 What Restro does for a POS that passes only some tiers

- **Menu only** (Mistral's documented interface today): a live menu read from the POS, owner-enriched; venue-level and, after CF-19, table-level codes; Call a waiter (it reaches Tonight, no POS needed); reservations and the floor plan (Restro's own, 134–141); the design, the Log, roles. The guest sees the still card "Please order from your waiter" and no bill (D122 §4). Tonight shows waiter calls and reservations, no sent orders.
- **Menu and Order, not Pay:** everything above plus ordering onto the bill and the guest's bill; the pay screen says "Ask your waiter to pay." (D127); pay-first items are not offered; tips and e-receipts don't appear. This is also the state of a venue whose POS passes Pay but whose provider is not connected.
- **All three:** the pilot's full workflow (D122).

The tier a venue sits in is **read from the declarations**, shown in Settings › Integrations and on New venue from a POS, and never switched by hand. A venue cannot be promoted to a tier its POS does not pass; it can only be degraded by a pause (D120).

### 4.3 The line itself

Restro fills within Restro only what satisfies all three:

1. **it is set once** (setup, not service), or it is one of the two night acts (hide, sold out);
2. **it makes the menu more cautious or richer, never less cautious** (rule 5);
3. **it creates no record the POS should hold**: no bill, no round, no payment, no receipt, no price, no stock count, no table the POS doesn't know when ordering is on.

A POS that can't exchange a tier's must-have gets that tier **hidden, not emulated**. Restro does not keep its own order queue for the bar to read off a screen, does not mark a bill "paid" the till never closed, does not print tickets, does not invent a table. Why: every one of those is a second truth beside the till (D111, D144: "never a second answer to the till"), a per-order staff burden (Martin's breaker), and a write path D110 does not know. It also keeps Restro out of the fiscal chain it must not join (D122 §8: the venue issues the receipt, not Restro).

The one place Restro covers everything is the **hand-made venue** (D87, D89): a venue with no POS, or a POS with no API, is created as hand-made and the owner maintains the whole menu. That is allowed because there is no till for Restro to contradict, and the owner, not staff at night, carries the upkeep. D12 (an own waiter view only for venues without barsy, billed separately) is the precedent that what Restro covers may be priced apart.

### 4.4 What we tell a venue whose POS passes none

In plain words, and in writing: "Restro can show your menu, which you maintain yourself in Restro; take your reservations; and let guests call a waiter from the table. Ordering and paying from the phone need your POS to open its interface to us: we need to read a table's bill, add a round to it, and close a bill with a card payment. Here is the one-page list for your POS vendor." The 11-07 letter to Mistral (`2026-11-07-mistral-what-we-need-from-the-api.md`) is that one page; section 4.1's table is its short form. What we do not promise: a bridge, a workaround, a screen the bar reads orders from.

---

## 5. Questions for Martin

Only those that change a level or a tier; each with a recommendation.

1. **Sold out where the POS can't say (M8).** Bring the owner's and staff's "sold out tonight" switch back on POS venues whose connector declares no availability source? *Recommend yes.* It turns a DEAL BREAKER into SURVIVABLE and narrows D124 §6 without breaking its reason ("one source of stock" wherever the POS is one). Rule 5 allows it.
2. **Ordering where the POS doesn't price the round but the bill reads back (O6).** Allow Order with the published price (the POS's own base price), as a setting the venue acknowledges ("your POS doesn't price phone orders; happy-hour rules won't apply to them"), or hide Order? *Recommend allow for Order where O4 holds; hide Pay and pay-first without a total read back (S15).* This refines my review's question 2. It matters only if Mistral's second interface, if any, prices like its delivery one.
3. **A provider whose key can't be kept from refunding (P13).** Deal breaker for that provider? *Recommend yes:* "Restro never refunds" is a rule, and our code guard proves only half of it. The alternative, accepting the code guard alone, should be a decision, not a default.
4. **A POS with no test installation (G8).** Treat it as a go-live gate for Order as well as Pay, or accept a supervised first night for Order (reads are harmless; the first add is the risk)? *Recommend the gate for both until the vendor gives a sandbox;* D124 §5 and rule 7 already say no test on a live POS, and an unproven write path is not survivable, it is unproven.
5. **Does the waiter's receipt walk count (S12 / R1)?** The law requires the paper receipt to be handed to the payer regardless of Restro; Restro adds one tap, no PIN. Is that tap "per-payment staff effort"? *Recommend no:* it exists with or without Restro. If yes, S12 is a breaker by definition and the electronic receipt becomes a Pay must-have, which no POS has confirmed (Q84).

---

## Sources

The four parts in `docs/deliverables/2026-11-10-functionality-parts/` (ordering.md, paying.md, menu-admin.md, cross-cutting.md); `2026-11-10-connector-architecture-review.md`; `2026-11-06-zamboo-api-review.md`; `2026-11-07-mistral-what-we-need-from-the-api.md`; `docs/connector-questions.md`; D12, D46, D72, D75, D84, D85, D87, D89, D90, D91, D92, D95, D98, D110, D111, D114, D115, D116, D118, D120, D122, D124, D125, D126, D127, D132, D144; reservations decisions 134–141 (`rv/foundation`); code paths as cited in section 1 and the tables; GitHub issues #319, #329, #331, #366 (states read 11-10).
