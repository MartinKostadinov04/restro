# Check of Feature 1, "Places and the floor plan": Martin's answers against the binding text and the code

Written 2026-10-30 by an independent Fable agent on `rv/foundation`, for Martin and the Port flow lead. Checked: rows 1.20–1.48 of `2026-10-30-reservations-decision-log.md` against `CLAUDE.md` (the nine rules, the three layers), `GLOSSARY.md`, D9, D38, D71, D95, D98–D101, D110–D113, D115–D122, D124–D127, the service-data log (`2026-10-21-service-data-decision-log.md`), the board-review answers of 10-21, and the code on this branch (`packages/db/src/schema.ts`, `packages/core/src/service/*`, `packages/core/src/connectors/service/*`, `apps/worker/src/jobs/readings.ts`). Rows 1.45 and 1.47 are read only for conflicts. Nothing was run.

This file does not contest Martin's choices. It names what breaks, what he has not been told, and which decision must be amended if he keeps a choice. Line numbers are of this branch at commit `5083288d`.

**How to read the seriousness:** *money* means the venue can lose money or a guest can be charged wrongly; *break* means a binding decision or a rule is contradicted by the row as worded; *gap* means the row works but something it depends on is missing or unsafe; *note* is for the write-up.

---

## Findings, most serious first

### 1. The common bill pointer breaks every per-table thing in ordering, and "the POS still sees separate tables" is not safe for the venue's money (money, break)

**The problem.** Rows 1.41 and 1.43 say a common bill is "a pointer inside Restro, so every member's code shares one order, one bill and one sitting, going to one lead table's POS bill; the POS still sees separate tables, so a round a waiter rings on another member stays on that table's bill". Ordering is built, in decisions and in code, with the table as the unit of everything:

- one open sitting per table, enforced by the database (`packages/db/src/schema.ts:1754-1756`, `sittings_open_table_unique`);
- one order per sitting (`schema.ts:1801`), one bill reading per table (`schema.ts:2043`, primary key tenant + table);
- the worker reads a table's POS bill **only while that table has an open sitting** (`apps/worker/src/jobs/readings.ts:18`, "Only a table with an open sitting is read");
- a sent order carries the table, its sitting and the table's bar (`packages/core/src/service/send.ts:110-116`, `230-257`), and the ticket prints at that bar (D122 §1);
- the sitting ends when "the table's POS bill" reads empty after it held lines (`packages/core/src/service/readings.ts:298-304`), and its end kills every location pass, empties the order and the reading (`packages/core/src/service/sittings.ts:210-247`; `location-pass.ts:94-102`);
- the payment route queues per bar and moves lines from "the real table" under that table's write turn (`pay-route.ts:219-220`, `391-427`).

Under the pointer as worded, a member table has no sitting of its own, so **its POS bill is never read**. Whatever a waiter rings on it is invisible to every phone, cannot be paid from a phone, and does not keep the group's sitting alive.

**A scene.** Saturday. "Georgi, 12 people" is booked on tables 40 and 41, linked, common bill on, lead 40. Both tables are served by Bar 1. At 00:30 the hostess marks them arrived; phones at 40 and 41 open on 40's sitting. At 01:10 the waiter rings two bottles on **table 41** in the POS, as he always has. The phones show 40's bill: the bottles are not on it. At 02:40 Georgi taps "The whole bill" and pays what he sees. Restro moves 40's lines to a payment table, closes them, captures. The next reading shows 40's POS bill empty after it held lines: the sitting ends (`readings.ts:304`), every pass dies, the order is wiped, all twelve phones show "your bill changed" and an empty bill. Georgi has a "Paid" screen with a payment number and the party leaves. Table 41's POS bill, two bottles, is still open in the POS. Nobody told the waiter, Restro's end-of-night page lists one clean payment, and the venue finds the open bill at closing. Nothing broke a rule: the venue simply lost the bottles.

**The reverse.** Lead 40's bill is closed by the waiter at 02:00 because the first six left; the other six still sit at 41 with drinks on 41's bill. Restro ends the one sitting and locks out the six phones at 41, although the reservation says "seated" (row 1.44 is right that the reservation is unchanged, but the phones are gone).

**Rule 7** is safe either way: Restro adds rounds and moves lines as a waiter would (D110) and never merges tables in the POS back office. **Money** is not: the guests' "one bill" and the venue's POS bills disagree, which D111 built the whole bill model to avoid ("the POS is the only truth").

**Bars.** Where the members belong to different bars (D122 §1: each table to one bar; a round prints at that table's bar), every round from a phone at a Bar 2 table prints at the lead table's Bar 1. The payment queue is per bar (D122 §8), so a group across bars is paid through one bar's payment table; lines rung on a Bar 2 member would have to be moved across bars, which is Mistral question 11 (does a move print a ticket again?) and is unanswered.

**Recommended answer.** Keep the pointer, change what it means. A common bill is a **group sitting over the member tables**: Restro reads **every member table's POS bills** and shows their union as the one bill; phone rounds go to the lead table (the POS sees one bill grow, the waiter can still ring on any member); paying moves lines from whichever member table holds them, one payment table per bar as today; the sitting ends only when **every** member's POS bills read empty, or staff end it. Rounds from a phone print at the lead's bar: the plan editor warns when a common-bill group spans bars, and the venue decides. Where the POS cannot move lines between tables (`moveLinesToTable` undeclared, `packages/core/src/connectors/service/capabilities.ts:19`) a group pays "ask your waiter". This is a design change to the service write path, not a reservations feature, and it must be designed before the reservations build. Decisions: D111, D115, D117, D121, D122 §2 and §4, D127 (see the list at the end).

### 2. A party's pay rule, set by anyone handling reservations, lets a PIN do what today needs the owner's sign-in, and the "fourth level" has no place in the precedence (money, break)

**The problem.** D113 and D122 §5 make pay-first the venue's gatekeeper: an item's mode is per item, and whether pay-first applies is set at the venue, a group and a table, the most specific winning. On this branch that is a **settings** permission: `pay_first.set` needs `settings.payment_tables` or `settings.connect_payments` (`packages/core/src/service/pay-first-settings.ts:53-59`), and every `settings.*` permission needs the person's own sign-in within 15 minutes; a PIN never unlocks it (`permissions.ts:58-64`; service-data log 4.2: "a 4-digit secret is weak"). Row 1.39 lets "anyone who handles reservations" change the rule from Tonight, where staff work with PINs (D122 §7).

Where the reservation sits in the precedence is undecided. The code resolves table → bar → area → venue (`packages/core/src/pay-first-settings.ts:70-81`; used at Send, `send.ts:133-142`). If the reservation beats the table, a hostess undoes the owner's pinned "VIP tables pay first". If the table beats the reservation, the hostess promises "everything on the bill" and the phone still asks for a card, with no screen saying why.

**What can go wrong for the money.** Pay-first is how a venue keeps bottle service and the expensive items paid before they leave the bar (D118: on-the-bill orders "go into the POS unpaid", so anyone with the code can put drinks on the bill). A hostess who sets "everything on the bill" for a party has moved that party's bottles into the unpaid channel, guarded only by D118's cap per round (€150 by default, the venue may switch it off) and the location check. D118 names "pay first or ask the waiter" as the way bottle service "usually goes anyway".

**A scene.** Friday, "Dimitar, 8" on the VIP booth, which the owner marked "pay first applies" because its menu is bottles. The new hostess, PIN in hand, sets the party's rule to "everything on the bill" because Dimitar asked nicely at the door. At 01:00 the booth's phones send two bottles, €380, on the bill (the venue raised the cap for VIP to €500). At 03:30 the party is gone and the bill is open. The Log names the hostess, which is evidence, not money.

**Also undecided.** What happens to a pay-first payment already started when the rule flips (the earlier race rows G9/G10, `2026-10-18-ordering-race-conditions.md:27`, `2026-10-19-pay-first-in-shared-bag.md:49`: the payment finishes as it started, waiting lines become on-the-bill lines, the phone says so). The build must carry that over to the reservation level. "Pay-first applies" set on a reservation at a venue without paying does nothing (pay-first items say "Order this from your waiter", D122 §4), which is fine but should be shown on the reservation screen.

**Recommended answer.** Keep the fourth level, and decide three things: (1) it is an **operational** permission, `reservations.pay_rule`, PIN-unlockable like Tonight's actions, held by default by Manager and Owner, not Staff (the venue may add it to a hostess role); (2) the reservation beats the venue, bar and hall, but a **table's own** setting still wins, and the reservation screen shows "Table 12 has its own rule" so nothing is promised that the phone will refuse; (3) each change is a `record` Log entry (18 months, like other guard changes, D122 §7), naming the reservation's id and the person, never the guest's name. D118's cap and pace keep applying whatever the rule. Amend D113, D122 §5 and §7, and GLOSSARY "Payment mode".

### 3. "The name and pay rule last across sittings" hands them to the next group at the table (gap, personal data)

**The problem.** Row 1.44: once a party is seated its spots stay reserved until the end of the night unless staff free them, and the name and pay rule last "as long as the reservation, across sittings". A sitting ends on its own when the POS bill closes (`readings.ts:304`), and staff open a new one with one tap or with "Open all" (D122 §4). Nothing in the rows ties the second sitting to the same people.

**A scene.** "Maria, 6" on table 7, arrived 23:30. At 01:30 they pay at the bar and leave; the waiter closes the bill; the sitting ends. The hostess is at the door and does not free the spot. At 01:45 the barman seats a walk-in couple at 7 and taps Open. Their phones pass the location check and read "Welcome, Maria"; their drinks go on the bill under Maria's "everything on the bill" rule. Maria's name was shown to strangers, and the couple ordered under a rule set for someone else.

**Recommended answer.** The name and the pay rule apply to a sitting only while the reservation is **seated** and that table code belongs to it, and a staff "Open" or "New guests" on a table whose reservation's sitting already ended asks "Is this still Maria's party?" (yes: the second sitting inherits; no: the spot is freed, as row 1.48). Freeing a spot (1.48) ends them at once. Write this into the amendment of D122 §4.

### 4. Arrival opens, freeing closes: the hostess may lack the permission, and the two states will drift apart (gap)

**The problem.** Arrival "opens its spots' table codes for phones in one tap" is `table.open` per code, which needs `tables.open_close` (`packages/core/src/service/commands.ts:220-242`); the default Staff role holds it (`permissions.ts:96-102`), but a hostess role a venue makes from scratch may not. Row 1.36 defines the plan-editing permission and no permission for handling reservations at all, so "anyone who handles reservations" (1.39, 1.42, 1.48) names no role. Freeing a spot is `table.close`, which ends the sitting whatever is in flight: a staff close does not keep a table with an unsettled payment, only the closing hour does (`sittings.ts:485-511`, `keepPaying` is passed from `closing-hour.ts:24` alone). "A table already open with another group asks 'New guests?'" calls `table.new_guests` (`sittings.ts:424-441`), which ends the other group's sitting: their passes die and their unsent order is wiped.

The two states, *seated* on the reservation and *open for phones* on the table, are kept by different people. "Close all" at 03:00 by a barman closes the seated party's phones while the reservation still says seated; the closing hour closes every table (D122 §4) while 1.44 keeps the spots reserved to the end of the night (that one is fine, but Tonight must show it).

**A scene.** "Elena, 10" on tables 21 and 22, arrived 00:15. At 02:50 the manager taps "Close all" to stop phone orders at last call. At 02:55 the hostess sees Elena's party still dancing and frees nothing. At 03:05 Elena's phone tries to order: "This table is closed". The hostess looks at reservations: "Seated". Nobody knows who closed what.

**Recommended answer.** Arrival and freeing are shortcuts that run the same commands with the reservation as the Log's reason, under the same permission (`tables.open_close`), and a hostess role without it sees "Arrived" without the tables opening, with one line saying why. Freeing a spot with a payment not yet settled waits like the closing hour does, and warns. "New guests?" at arrival says in plain words that the other group's phones will be cut off (D107). Tonight shows both states side by side ("Seated · closed for phones"). Amend D122 §4 and §7.

### 5. The Owner default role cannot be kept out of a new permission without an exception to a firm row (break)

**The problem.** Row 1.36: editing the plan is held by default only by organisation owners and admins and Restro's admin team; "Staff, Manager and venue Owner get it only through the role settings". On this branch the Owner default role holds **every** permission on the list (`permissions.ts:120`, `owner: PERMISSIONS`), the service-data log 4.5 says the defaults "gain new permissions as features ship", and Restro's admin team holds exactly three named permissions (`permissions.ts:71-75`), none of which is plan editing. Adding `plan.edit` to the list gives it to the venue Owner role at once.

**Recommended answer.** Either accept that the default Owner role holds it too (simplest, and the owner is the venue), or amend D122 §7 and log 4.5: "a permission may be marked *not in the Owner default*", and add `plan.edit` to `OPERATOR_PERMISSIONS`. Row 1.46 (removal only by Restro's team) fits the second.

### 6. Plans and spots are a third kind of data: rule 1 needs a named write path, the shape folder needs a boundary, and stored drawings must not be raw markup (gap)

**The problem.** This branch's rule 1 reads "one write path **per kind of data**": the menu through `apply()`, service rows through `applyService()`; "nothing else writes … service rows". Spots, plans, linked groups and reservations are neither. Rule 2's layer applies to menu values only (D122 §9), so reservation rows carry source, actor and job like service rows. The write-target guard test pins which tables each path writes (D122 §9); new tables mean a declared guardrail change (D67: it may tighten, and naming new tables is allowed, but it is a ticket's own step).

Row 1.24's "folder of shapes and their attributes" is venue data that Restro's team uploads and that staff screens draw. If the shape is an SVG or any markup stored and injected into the admin page, it is a stored-script risk in the screens where PINs and payments live. Zod at every boundary applies to the folder as much as to a POS response.

Row 1.37 puts kinds, legend symbols, filters and default seats in the venue's folder: platform-layer data, no vendor word, which is right. The spot → table-code link (1.40) is platform too (tables are ours; the POS mapping stays in `places`, `schema.ts:1323`).

**A scene.** An agent makes Club X's plan from a photo and a folder with `booth.svg`. A later agent, asked to "make the booths rounder", edits the file with an `onload` handler by copy-paste from a tutorial. The hostess's tablet runs it on the next load, signed in with the shared device's account.

**Recommended answer.** (1) A `reservations.*` command namespace on `applyService` (same provenance, same Log, same RLS pattern), or a third path `applyReservations` named in rule 1; the guard test lists its tables. Ids `sp_` (spot), `fp_` (floor plan), `lg_` (linked group), `rv_` (reservation). (2) Shapes are a **constrained geometry JSON** (polygon, circle, rectangle, label, rotation, kind) checked with Zod and drawn by our own components; no SVG is ever stored or injected; a background photo, if any, goes to the assets bucket as an image (D57). (3) A plan version keeps spot ids, so reservations survive (1.29). Rewrite D101 (see the list).

### 7. A table code shared by two seated reservations has no answer for the name and the pay rule (gap)

**The problem.** Row 1.40 lets a spot name "table code(s)", several spots per reservation (1.43), and kinds like stools (1.37). Nothing says a table code belongs to at most one seated reservation at a time. Two stool spots at Bar 2 may both name the counter's one code; two parties seated at them would both claim the phone's greeting and pay rule.

**A scene.** Stools 3–5 are "Ivan, 3", stools 6–8 are "Petya, 3"; the venue put one code on that stretch of the counter (D115 lets a venue put codes where it likes, "table codes go on tables only" was about ordering from the bar). Both arrived; both set a pay rule. A phone at stool 6 shows "Welcome, Ivan" and gets Ivan's rule, or Petya's, depending on which arrival was tapped last.

**Recommended answer.** A table code is held by at most one seated reservation at a time; a second arrival that would claim it refuses with the first party's name shown to the hostess, not to the guest. Record it with 1.40.

### 8. Joining spots to one bill mid-sitting kills the joined table's phones (gap)

**The problem.** Row 1.43: spots on one reservation "can be put on the same bill at any time, also after booking". If table 12 already has a sitting with an order, a pass and maybe a payment in flight, folding it into 11's sitting means ending 12's sitting (passes die, the order is emptied, `sittings.ts:210-247`); a location pass names its sitting and cannot be re-signed (`location-pass.ts:27-35`). A payment on 12 already past "held" runs to its end whatever the sitting does (`pay-route.ts:34-35`), but its `sittingId` then points at an ended sitting, and D127 keeps "Paid in the app" lines on the bill "until the sitting ends".

**Recommended answer.** Joining is free before the member's first sent order or payment; after it, the join carries the member's order lines over and tells its phones to allow location again (one tap, their consent stands for the night, D119). Un-joining "ends with the party" (1.43) is fine. Part of the D122 §4 amendment.

### 9. The pace limit and the duplicate warning count the group as one table (gap)

**The problem.** The pace limit is 6 on-the-bill sent orders per table per 15 minutes (D118; `send-guards.ts:123-141`), and a trip pauses the table and alerts Restro's team (`send-guards.ts:170-228`). Under one sitting for a party of 20 across three tables, round 7 in a quarter hour trips it for all three. The duplicate check is per sitting (`send-guards.ts:90-117`): two tables ordering the same four beers four minutes apart get "Same as 4 minutes ago. Send another?", which is only a friendly question, but it will ask a lot.

**Recommended answer.** Under a group sitting, the pace counts per member table code (that is where the risk D118 describes lives, "someone inside using another table's code"), and the duplicate warning compares within the code that sends. D118's amendment.

### 10. Conflicts with the "later" rows (note)

- **1.45 minimum spend** "shows spend against it": the spend of a party is the group's bill, which only exists once finding 1 is answered as a union of member tables; the amount goes through the `money` module (rule 8), never a float.
- **1.47 song on the table's bill**: D124 §4 keeps "D98's own fallback" (charge on request, refund on skip) for song requests, and D99 says a skipped request "is refunded", while D125 and D127 give Restro no refund call. The verdict already flagged D99 as out of date; when song requests come back, that row cannot be answered without touching D99, D98 and D124 §4.

---

## Decisions to amend when this is written up

- **D101** (direction): "on Areas and Tables" → a spots layer the venue owns, on one or more floor plans, optionally naming table codes; "tables × date × time window" → spots; "hosted page first" → the staff tool first, the public page later (the verdict, §2); deposits stay as D98 says.
- **D111**: "there is one bill per table on the phone" gains the group sitting: one bill per table **or per common-bill group**, the union of the member tables' open POS bills.
- **D115**: "the bill a table code shows is every open POS bill on that table" → on the code's table, or on every member table of its group; the sitting ends only when all of them read empty.
- **D117**: "one bag per table" and "the duplicate warning … from the same table" → per sitting, where a sitting may span a group; the duplicate compares within the sending code (finding 9).
- **D118**: the pace limit counts per table code even under a group sitting; add that a party's pay rule never lifts the cap or the pace.
- **D113 and D122 §5**: a fourth level, the reservation, above venue, bar and hall and below the table's own setting; set by an operational permission `reservations.pay_rule`; each change a `record` Log entry; GLOSSARY "Payment mode" to match.
- **D121**: the location pass may name a group sitting; "a different table needs a new check" becomes "a table outside the group"; the guest state gains the reservation's greeting (name) behind the pass; `packages/shell/src/services.ts` and `docs/guides/menu-template-functionality.md` gain the entry (D122's template file rule).
- **D122 §2** (words): Sitting → "one group's time at a table or at a common-bill group of tables"; add Spot, Floor plan, Linked group (already in GLOSSARY, uncommitted in the working tree).
- **D122 §4**: arrival and freeing as staff opens and closes with the reservation as reason; "New guests?" at arrival; the name and pay rule bound to the seated reservation's sitting (finding 3); joining mid-sitting (finding 8); freeing waits for an unsettled payment.
- **D122 §7**: new permissions (`reservations.handle`, `reservations.pay_rule`, `plan.edit`); which default roles hold them; the Owner-default exception or its rejection (finding 5); Tonight shows the name beside the table for roles that handle reservations; `OPERATOR_PERMISSIONS` gains `plan.edit`.
- **D122 §8 and D127**: a payment of a group bill may move lines from any member table; one queue per bar stands; a group across bars is paid per bar's payment table or "ask your waiter"; "Paid in the app lines stay until the sitting ends" refers to the group sitting.
- **D122 §9 and rule 1 (CLAUDE.md)**: the reservations write path (a namespace on `applyService` or a third path), its tables in the write-target guard, ids `sp_`, `fp_`, `lg_`, `rv_`; rule 3's id list gains them.
- **D95**: unchanged for POS tables; add one line that reservations hold spots, not Tables, and that a spot may name a table's code.
- **Service-data log 4.5 / D122 §7** only if finding 5's second option is chosen.
- **GLOSSARY**: Sitting, Bill, Order, Open for phones, Payment mode, Table code ("may belong to a spot").

---

## Checked and fine

- **Rule 7 (D110):** reservations never write to the POS (1.34); a common bill as a Restro pointer adds nothing a waiter would not do; no POS merge is needed under finding 1's recommendation.
- **Rule 3:** spots, plans, linked groups and reservation ids never reach the guest page; the greeting is the venue's own text, not a POS field.
- **Rule 4:** the name travels in the service state over `GET /api/guest/state` (D121, `packages/core/src/service/guest.ts:135-138`), never in published files, which matches 1.38's wording.
- **D9:** no account; the greeting comes from the booking, not from a guest login.
- **D38:** a staff-only reservations tool adds no guest channel; the public page stays with D101's later part.
- **D100 and D71:** untouched; the greeting is not a guest feature a guest switches on, it is a venue setting as 1.38 says.
- **1.38 personal data:** a first name behind the location pass, never with a phone number, never in Log entries or pino logs (the service-log design's OWASP line, `2026-10-20-service-log-design.md:22`), is proportionate; the bearer pass (`location-pass.ts:10-12`) means anyone at the table sees it, which the setting's default "yes" accepts. The reservation's own retention is Feature 8's.
- **1.44 "a closed POS bill changes nothing on the reservation":** consistent with D115 (no visit) and the code, where the sitting and the reservation are separate rows.
- **1.22 seats warn and never refuse; 1.32 unique name; 1.28 a spot sits on a plan, not an Area; 1.20 spots are not D95's Tables:** no conflict.
- **1.33 one venue, one set of roles and PINs, one service day, one Log:** consistent with D122 §7 and §9 and D45, provided reservation actions are Tonight-class (PIN) and plan editing is settings-class (sign-in), as findings 2 and 5 say.
- **1.46 removing a spot:** app code deletes no rows (CLAUDE.md "Never"), so a removed spot is a retired flag, which also gives "old reservations keep the spot's name" for free.
- **1.26 every decision is for many venues; 1.37 kinds as venue data:** no vendor word, no POS field; a hand-made venue (D89) gets the same spots layer, where the pay rule and the common bill simply do nothing because there is no bill.
- **D124 §1 bars optional:** a venue whose POS gives no bars is unaffected by finding 1's bar warning.
- **Rule 8:** nothing in Feature 1 touches money except 1.45 (later).
- **GLOSSARY** already carries Spot, Floor plan and Linked group in the working tree, ahead of the rows going firm; harmless, but it should be committed with the write-up, not before.
