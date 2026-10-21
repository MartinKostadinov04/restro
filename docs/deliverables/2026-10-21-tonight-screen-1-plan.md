Made by: Sonnet design agent for #50, 10-21. For: the ordering lead, then Martin.

# Tonight, screen 1: the actions and the tables, on the bar tablet (screen plan, #50)

Prototype beside it: `2026-10-21-tonight-screen-1-prototype.html` (open it in a browser; the bar at the top switches tablet 1180×820 or phone 390, who is signed in, the night, BG or EN, light or dark). It is throwaway: it answers "is this calm, readable at first sight, and few taps?", nothing in it is code to keep.

**Scope.** Only the first screen of Tonight: the actions (what needs a person) and the tables (open for phones). Sent orders, sold out and the Log are other tabs and other screens, not designed here. Bar tablet first; the manager's phone is the same parts in one column.

**What was wrong with the first prototype, and what changed.** It was hard to take in at first sight, bright, and off the admin's system. This one uses the admin's own tokens (`apps/web/app/globals.css`: shadcn zinc, 0.5 rem radius, the `info` blue as the one accent, `destructive` red). Colour appears only where a person is needed: blue for "needs you", red only for money held on a guest's card, and both always with an icon and a word. Everything else is neutral. Removed under Clean rule 2 (an element that does no job):
- the "Phase 2 · not built" payment card, the dashed "Call a waiter · Later" slot (the call is real now) and the "Handled tonight" fold (the Log's job);
- the in-screen role and night switches, the "Needs you" filter and bar filters (two bars fit on one screen; 40 tables scroll);
- the "ordering is on" status line (the "Pause ordering" button already says so; a pause shows as the one banner);
- the Telegram mirror panel (Telegram is another channel to the same answers; its wording is not this screen's);
- the second set of tabs inside the alerts pane.

## 1. Stories and taps

A target is a tap count from how a POS front end or a comparable staff screen does the same job (D115). The comparables are the ones the first prototype's file already cites (Toast, Square, Sunday for staff, kitchen display screens: `2026-10-21-staff-screen-prototype.md`, "Copied from comparable products") plus how a POS front end opens a table. I did not fetch those pages again; a count I state from the product's known behaviour, not from a re-read page, is marked "known behaviour". No Tonight screen exists yet, so there is no "today" column: the nearest thing today is the POS's own front end, where the bar does the same jobs.

A **PIN** is typed on the numeric pad and is not counted as a tap (the prototype counts the digits apart and prints them in its side list). Rule used throughout: a PIN is asked when the signed-in session cannot name the person who may do this (the shared bar tablet, or a staff session facing a manager-only action); on a person's own signed-in phone a manager taps once.

| # | Story (persona, device) | Target taps | Comparable | Measured in the prototype |
|---|---|---|---|---|
| S1 | **Answer a money alert** ("Payment not confirmed": "Receipt printed" or "No receipt"). A bartender on the bar tablet, a manager on the phone. | Tablet: **1 + a manager's PIN**. Manager's own phone: **1**. | A POS front end's manager override: one tap on the action, then a passcode (Toast shared terminals with personal passcodes and manager approval; Square void/comp with a passcode; known behaviour). The PIN sheet names the consequence ("The guest's card will be charged €38.00. This can't be undone."), so it is also the confirmation, and the answer is not an Undo toast (money can't be un-captured). | 1 tap + PIN |
| S2 | **Take a waiter call.** Waiter on a phone, bartender on the tablet. | See it: **0** (it is on the screen). Handle it: **1**, no PIN. | Kitchen display "bump" and a call-staff notification acknowledged in one tap (Sunday for staff, kitchen displays; known behaviour). | 1 tap, Undo toast |
| S3 | **Open a table for phones.** | **1** (tap the closed table). | A POS floor plan: tap the table to open it (known behaviour). | 1 tap, Undo toast |
| S3b | **Open all.** Start of the night. | **1 + PIN** (Undo toast; no confirmation dialog: it is reversible). | No direct comparable for "open all"; Toast's bulk online-ordering switch is one dropdown plus a choice. Set at one tap because it is a single reversible write. | 1 tap + PIN |
| S4 | **Approve a sent order at the bar, where the POS supports it.** | **1**, no PIN. | Toast and Square: accept an online order on the POS screen, one tap (known behaviour). | 1 tap |
| S5 | **Lift a pause.** A pause staff started (a bar or all bars). | **1 + a manager's PIN** (manager's phone: 1). | Square shows the pause and resumes it from the Orders screen in one tap (the first prototype's file). | 1 tap + PIN |
| S5b | **Resume a paused table.** | **1 + own PIN** (own phone: 1). | As S5. | 1 tap + PIN |
| S6 | **"Storno done"** after a refund. Manager or owner. | **1 + a manager's PIN** on the bar tablet; **1** on a manager's phone. | A checklist item ticked: one tap. | 1 tap + PIN, Undo toast |
| S7 | **See which payer needs the paper receipt** ("receipt to bring"), then mark it brought. | See it: **0**. Mark it: **1**, no PIN. | The runner's ticket on a kitchen display: the reference is on the screen, one tap to clear it. | 1 tap, Undo toast |
| S8 | **Answer an unconfirmed sent order** ("Found on the bill" or "Not on the bill"): one answer also resumes the table. | **1 + own PIN**. | As S1, at staff level. | 1 tap + PIN |
| S9 | **Close one table.** | **2** (tap the open table, "Close for phones"), Undo toast. | A POS floor plan: tapping an open table opens its sheet. | 2 taps |
| S10 | **Pause ordering** (all bars or one). | **2** (the button, then the scope), Undo toast, no PIN (pausing only makes the menu more cautious, rule 5). | Toast's snooze dropdown with set choices (the first prototype's file). | 2 taps |
| S11 | **Close all**, and **New guests** at one table. | Close all: **3 + PIN** (menu, item, a dialog that names the consequence). New guests: **3**. | Rare, destructive: a dialog is right (`copy-rules.md` rule 11, Patterns row "Remove for good"). | 3 (+PIN) |
| S12 | **See the evidence** of a card dispute. Manager. | **1** (leaves the screen to the payment's page). | n/a | 1 tap |

Everything on this screen after the first look is one tap, plus a PIN where a person must be named. The first look itself (what needs me) costs no tap.

## 2. Place

A new row for `docs/guides/admin-map.md` (written here, not applied; "Taps" is a wide screen, which is the bar tablet's tab bar, "Taps (phone)" follows the map's rule: +1 for the tab dropdown below 1024 px):

| Screen (BG / EN) | Route | What it is for | Reached by | Taps | Taps (phone) |
|---|---|---|---|---|---|
| Тази вечер › Действия и маси / Tonight › Actions and tables | `/venues/{venue}?tab=tonight` | What needs a person during service (money alerts, waiter calls, sent orders to check, paused tables, to-dos, receipts to bring) and the tables, open or closed for phones, by bar. The bar tablet stays here all night. | Open on the venue's card, then the "Tonight" tab (placed after "Tables & QR", before "Settings"). **For a staff-role sign-in (the bar tablet, a waiter's phone) the sign-in lands here: 0.** | 2 (0 for staff) | 3 (0 for staff) |

And the story rows for section 2 of the map ("Taps" = tablet, "Taps (phone)" = manager's phone, own session; counted from the screen being open): Answer a money alert 1 (+PIN on the shared tablet) / 1; Take a waiter call 1 / 1; Open a table for phones 1 / 1; Open all 1 (+PIN) / 1; Lift a pause 1 (+PIN) / 1; Resume a paused table 1 (+PIN) / 1; Storno done 1 (+PIN) / 1; Mark a receipt brought 1 / 1; Close one table 2 / 2; Pause ordering 2 / 2. On the phone the segmented control "Needs you | Tables" is the page's one switch: Needs you is open first, Tables is one more tap, counted when the story needs it (open a table from the phone: 2).

## 3. The pattern for each job

From `docs/guides/operational-screens.md` → Patterns. A job with no row is a question (section 8), never a new pattern.

| Job | Pattern | Note |
|---|---|---|
| Waiter call handled, receipt brought, storno done, open one table, open all | **A single reversible write**: saves at once, the undo toast is the feedback, no Save. 8 s toast with "Undo". | Storno done and Open all also ask the PIN where the rule above says so. |
| Close one table | **Remove a thing that can come back**: no dialog, undo toast. | Reached through the table's sheet, so 2 taps. |
| One table's details (sent orders, bill, close, new guests) | **Everything about one thing**: side sheet on the tablet, bottom drawer on the phone. | |
| Close all, New guests | **Remove for good**: a dialog that names the action and the consequence, buttons say the action ("Close all" / "Keep open"). | Rule 11. |
| A pause (staff's or Restro's) | **A state of the whole page**: one banner at the top; not dismissible. | Restro's pause has no button (nobody at the venue can lift it, D122 §6). A staff pause has "Resume ordering". |
| Nothing waiting, tables not open | **Nothing here yet**: the empty-state block with one button (rule 5). | The button is "Open all". |
| A write failed | **What happened after a write**: the error toast that stays, names the fix, has a close button. | |
| The phone's switch between "Needs you" and "Tables" | **Pick one of a few**: segmented control (two words). | |
| The phone's tab bar | The admin's rule: the tab bar becomes a dropdown below 1024 px (`admin-map.md`). | |
| Choose the scope of a pause (all bars, bar 1, bar 2) | **Pick one of a few**, options with names to read: a **Select**, saving at once. | Prototyped as a button that opens a menu so the choice is also the action: 2 taps. See Q8 (d). |
| An alert row with one or two answers (money, sent order to check, approval, call, to-dos) | **No row.** Closest: "Secondary actions of a row" (the primary visible on the row). | Question Q8 (a). |
| The grid of tables as status tiles | **No row.** | Question Q8 (b). |
| The PIN sheet (shared device) | **No row.** | Question Q8 (c). |

## 4. The one primary action

**Answer the top item of "Needs you".** The list is ordered by what costs most to leave: a money alert, then a sent order to check, an approval, a paused table, a waiter call, and last the to-dos (storno, dispute, receipts to bring). The top row's main action is the only filled button on the screen; every other button is outline. When the top row is a money alert its two answers sit at equal weight, both outline, because neither is a default and a nudge towards "Receipt printed" would nudge towards capturing money; the red row, first in the list, is what the eye lands on. On an empty night (nothing open) the primary action is **"Open all"**, filled.

## 5. States

| State | What the screen does (in the prototype: the "Night" switch) |
|---|---|
| **Empty night, tables not open** | "Tables aren't open yet. Open them for phones to start ordering." with "Open all" as the one filled button. |
| **Empty, tables open, nothing waiting** | "Nothing is waiting." and the line that calls and money alerts show up here. No button. |
| **Loading** | Two grey skeleton blocks (rows and tiles), `aria-busy`, and a "Loading…" line for a screen reader. The pulse is off under reduced motion. No spinner, no text over it. |
| **A write fails** | The error toast stays until closed, with a close button: "Not saved. Check the connection and press it again." The row stays where it was. (Prototype: "Next write fails".) |
| **The POS is unreachable** | A venue pause Restro started: the one banner, "Restro paused ordering because it can't reach {source}. It resumes by itself when the connection is back. You don't need to do anything." No button, because nobody at the venue can lift it. The "Pause ordering" button is hidden (a second pause adds nothing). The alerts and the tables stay readable; the last reading of each bill is what the sheet shows. A pause of one bar's connection (D122 §6) is the same banner naming the bar; not prototyped. |
| **The longest Bulgarian text** | Buttons wrap to two lines, never truncate; long bar names, long item names and long table names wrap in place (`overflow-wrap`); a 44 px reference stays on one line beside the title. Tested with: bar names of 30 and 36 letters, a sent order of two long drinks, a long source name. A tile state word may wrap to two lines on the phone, never mid-word ("Одобрение" at 13 px fits three to a row at 390 px). |
| **Many** | 40 tables over two bars: five or six tiles to a row on the tablet, three on the phone, the tables column scrolls on its own. 12 alerts: the "Needs you" column scrolls on its own and the order is fixed, so the money rows stay at the top. Nothing is paged or collapsed. |
| **A role that may not act** | Never a greyed button. A manager-only answer (money alerts, lifting a pause, "Storno done") on a staff session opens the PIN sheet for "a manager's PIN"; a staff PIN is refused with "This PIN belongs to staff. A manager's PIN is needed." The manager-only to-dos (storno, dispute) are not shown on a staff's own phone; on the shared bar tablet they are shown (D122 §8: "with the PIN on a shared device"). See the matrix below. |
| **A shared device asks for the PIN** | A sheet over the screen: the action as its title, its consequence in one sentence, "Enter your PIN" (or "Enter a manager's PIN"), four dots, a 3×4 pad of 56–60 px keys, "Leave it". It submits on the fourth digit, so no confirm tap; a wrong PIN clears the dots and says what to do. The pad also takes the keyboard. |
| **A POS venue where the control is read-only (D87–D92)** | n/a: nothing on this screen edits the menu or its items. What a POS decides is read-only here by construction: which bar a table belongs to (D122 §7: read from the POS, never edited), a bill and its lines. "Approve" shows only where the connector declares "approval at the bar" (D122 §3). |

**Who sees and does what** (staff, manager; the owner is the manager's row):

| Item | Staff on the bar tablet (a PIN names the person) | Staff on own phone | Manager on own phone |
|---|---|---|---|
| Money alert ("Receipt printed" / "No receipt") | Seen; answered with a **manager's** PIN | Seen; manager's PIN | Seen; 1 tap |
| Sent order to check, resume a table | Seen; own PIN | Own session names the person: 1 tap | 1 tap |
| Waiter call, receipt to bring, open one table, pause | 1 tap, no PIN | 1 tap | 1 tap |
| Open all, close all | PIN | 1 tap | 1 tap |
| Lift a pause | Manager's PIN | Manager's PIN | 1 tap |
| Storno done, card dispute | Seen; manager's PIN | **Not shown** | 1 tap |
| Approve / decline (where supported) | 1 tap | 1 tap | 1 tap |

## 6. Screen read and wayfinding on the tablet, written before the build

Wayfinding: **where am I** (the title "Tonight" and the venue name, both top left); **where can I go** (the four tabs; the phone's dropdown); **what is here** (the count beside "Needs you", "13 of 24 open for phones" under "Tables", a banner when ordering is paused); **how do I get out** (nothing to leave: a bar tablet is not left; a sheet closes with "Close" or Esc, and every dialog has a visible "Leave it" / "Keep" that loses nothing).

Screen read: the eye lands on the red money row at the top left, or, with none, the top row of "Needs you" (and on an empty night the one filled "Open all"). The purpose reads in two seconds from the title and the two columns ("Needs you" and "Tables"). One reading order: needs-you column first, then the tables; top to bottom is urgency. The problem rows (money) are the only thing with a tinted background; everything normal is neutral.

## 7. Draft for the persona paragraph of `docs/guides/operational-screens.md`

*Draft only; the guide is not edited here.*

> **The persona on Tonight and any screen used at the bar:** a bartender at the shared bar tablet, a metre away, wet hands, a guest waiting, mid-service, who glances, taps once and looks away; or a waiter on a phone in one hand who has never read a manual. They have no time to read a sentence. The screen is checked at 1180×820 and at 390 px. The tablet changes these rules:
> - **Undo:** an answer that moves money is confirmed by the PIN sheet, which names the consequence, and gets no Undo toast; every other write keeps the 8-second toast.
> - **Frequency:** nothing moves, a new alert included: it is announced to a screen reader and, if the lead agrees (Q10), by one short sound, never by animation.
> - **Wayfinding, "how do I get out":** a bar tablet stays on this screen all night and has no back button to lean on; sheets and dialogs close with a visible control and Esc and lose nothing.
> - **Accessibility, targets and text:** 44 px stays the floor; answer buttons are 48 px and PIN keys 56–60 px on the tablet; text is 14 px at the least and 16 px for what is read at arm's length; a reference a waiter reads is at least 40 px at 7:1 (D122 §9).
> - **Who did it:** a signed-in personal phone names the person; a shared device asks for a PIN, so the Log names a person (D122 §7).
> - **Patterns:** a role that may not act is sent to a higher PIN, never shown a disabled control.

## 8. Questions for the lead, each with a recommendation

**Q1. Does Martin's "Action screen" mean this actions area?** D122 §4 quotes him: "it will be available in the Action screen we will develop". I read it as Tonight's first tab (the area that holds what needs a person), named "Actions and tables". Recommendation: yes; ask Martin once, with this screen, because the tab's name depends on it ("Actions" alone would hide that the tables are here).

**Q2. Who answers "Receipt printed" and "No receipt"?** D122 §7 says staff "answer alerts"; board Q4 (`2026-10-21-board-review-final.md`) gives this one answer to managers and owners only, because a wrong tap charges a card or loses the venue's money. I followed Q4 and let a bartender start the answer on the tablet with a manager's PIN. Recommendation: keep Q4's rule, and put one sentence in D122 §7 so the two texts agree.

**Q3. Is "a PIN when the session cannot name the person" the rule, and which writes skip it?** The prototype asks no PIN for a waiter call, a receipt brought, opening or closing one table, pausing, and approving; it asks one for money, sent-order answers, resuming a table, lifting a pause, storno done, open all and close all. D122 §7 says "answers ask for the person's own 4-digit PIN". Recommendation: the split above (a PIN where money, a record or the whole venue is involved), because a PIN on every call makes the tablet slower than shouting; the prototype has a checkbox "PIN on waiter calls" to feel the difference.

**Q4. Is "Approve / Decline" a button on Tonight at all?** D116 says approval happens in the POS and Restro reads it back; rule 7 lets Restro write only what a waiter does. If approval is the bar's act in the POS, Tonight can only show "Awaiting approval", not do it. I prototyped the two buttons only because the brief lists the story. Recommendation: do not build the buttons; show the state read-only, and add a button only if a connector declares an approve call (D122 §3 has none).

**Q5. Close one table: two taps through a sheet, or one tap with an Undo toast?** The first prototype closed in one tap. A bar tablet gets leaned on and an open table's tile is also how staff look at it. Recommendation: two taps (the sheet), because closing ends the sitting and clears the phones' unsent order, which Undo cannot bring back once the window closes.

**Q6. Who lifts a pause staff started?** Board Q4 and D122 §7 say a manager; the first prototype recommended any staff PIN for a staff pause. Lifting is the less cautious direction (rule 5's spirit). Recommendation: manager's PIN, as built, and ask Martin once whether a bartender who paused for ice should be able to lift it.

**Q7. Show the manager-only to-dos (storno, dispute) on the shared bar tablet?** They are "for managers and owners" (#54), yet D122 §8 gives "Storno done" a PIN "on a shared device", which presumes the tablet shows it. Recommendation: show them on the tablet, in "Later", answered with a manager's PIN; hide them on a staff's own phone.

**Q8. Four jobs have no pattern row.** Nothing is invented in this plan; each is built from existing parts and named here for a decision. (a) An **alert row** with one or two answers; (b) a **grid of status tiles** (closed, open, needs you, money, with icon and word); (c) the **PIN sheet** on a shared device; (d) the **scope of a pause**, a choice that is also the action. Recommendation: add all four rows to the Patterns table (they will recur on the later Tonight screens), (a) as "a list row: icon, title, meta, the answer buttons under it", (d) as a menu from a button.

**Q9. Is "the one primary action" the top row's answer, even when the top row is a money alert with two outline buttons?** Recommendation: yes; picking a default for a money answer is worse than having no filled button for one moment.

**Q10. A new alert on a device nobody is looking at.** The guide's Frequency rule forbids motion and says nothing about sound. A bartender facing a guest will not see a new row. Recommendation: a short, mutable sound plus the screen-reader announcement, no animation; Martin to confirm, because it is a new behaviour. Telegram carries the same alerts for money (D122 §7).

**Q11. Where Tonight sits and where staff land.** Recommendation: the tab "Tonight" after "Tables & QR"; a sign-in whose only role is staff lands on it (0 taps) so the bar tablet never shows the venues list.

**Q12. Wording that waits for Martin (#54).** The strings for the storno to-do ("Make the storno in {source}", "Storno done"), the dispute to-do ("See the evidence") and the BG terms I chose without a glossary entry: "sitting" = "гостуване", "open for phones" = "отворена за телефони", "sent order" = "изпратена поръчка", "needs you" = "чака вас". Recommendation: Martin reads the table in section 9 in place in the prototype; two terms (sitting, needs you) are the ones to challenge.

**Q13. The storno deadline** (decision log row 1.5, still open for the accountant, #52) is not shown on the row. Recommendation: leave it out until that is answered; add a line "Deadline: 7 Nov" when it is.

**Q14. One name for "done".** Waiter calls say "Handled", receipts "Brought", storno "Storno done" (Martin's words), Telegram says "Done". Recommendation: keep each in its job's own word on this screen, and keep "Done" only for Telegram.

## 9. Strings (BG and EN)

Under `copy-rules.md`: sentence case, plain verbs, one name per action ("Pause ordering" leads to "Ordering at … paused", "Resume ordering" to "Ordering resumed"), errors name the fix, an empty screen invites the next action, numerals for counts, domain words from GLOSSARY ("sent order", "table", "sitting", "bar", "Tonight"), the POS named with `{source}` (D82), confirmations name the action and its consequence with buttons that say the action. Prices show as "38,00 €" in BG and "€38.00" in EN. The prototype also holds fake data (a venue name "Club Luna", the names Maria and Georgi, "Mistral" as `{source}`), which are not interface strings. `{table}` is "Table 7" / "Маса 7". Every string below also goes through next-intl in the build.

| Key | Bulgarian | English |
|---|---|---|
| `venue` | Клуб Луна | Club Luna |
| `title` | Тази вечер | Tonight |
| `tab_act` | Действия и маси | Actions and tables |
| `tab_sent` | Поръчки | Sent orders |
| `tab_sold` | Изчерпано | Sold out |
| `tab_log` | Дневник | Log |
| `stub` | Този екран не е в прототипа. | This screen isn't in the prototype. |
| `pause` | Спри поръчките | Pause ordering |
| `p_all` | Всички барове | All bars |
| `b_staff` | Поръчките на {scope} са спрени от {who} в {time}. Гостите не могат да поръчват от телефоните. | Ordering at {scope} was paused by {who} at {time}. Guests can't order from their phones. |
| `lift` | Пусни поръчките | Resume ordering |
| `lift_b` | Гостите пак могат да поръчват от телефоните. | Guests can order from their phones again. |
| `oa_b` | {k} маси се отварят за поръчки от телефони. | {k} tables open for phone orders. |
| `b_restro` | Restro спря поръчките, защото няма връзка с {source}. Ще ги пусне сам, щом връзката се върне. Не е нужно да правите нищо. | Restro paused ordering because it can't reach {source}. It resumes by itself when the connection is back. You don't need to do anything. |
| `needs` | Чака вас | Needs you |
| `now` | Сега | Now |
| `later` | По-късно | Later |
| `e_open_t` | Нищо не чака | Nothing is waiting |
| `e_open_d` | Обажданията на масите и сигналите за пари се появяват тук. | Table calls and money alerts show up here. |
| `e_night_t` | Масите още не са отворени | Tables aren't open yet |
| `e_night_d` | Отворете ги за телефони, за да започнат поръчките. | Open them for phones to start ordering. |
| `ago` | преди {m} мин | {m} min ago |
| `now0` | току-що | just now |
| `m_t` | Плащане без потвърждение | Payment not confirmed |
| `m_tag` | {amt} са задържани | {amt} on hold |
| `m_q` | Отпечатана ли е касовата бележка? | Was the receipt printed? |
| `m_ok` | Бележката е отпечатана | Receipt printed |
| `m_no` | Няма бележка | No receipt |
| `m_ok_b` | Картата на гостите ще бъде таксувана с {amt}. Това не може да се върне. | The guest's card will be charged {amt}. This can't be undone. |
| `m_no_b` | Задържаните {amt} се освобождават, а редовете се връщат на {table}. | The held {amt} is released and the items go back to {table}. |
| `m_ok_toast` | Картата е таксувана с {amt} · {who} | Card charged {amt} · {who} |
| `m_no_toast` | Парите са освободени · {who} | Money released · {who} |
| `s_t` | Изпратена поръчка без потвърждение | Sent order not confirmed |
| `s_before` | Сметка преди поръчката: {amt} | Bill before this order: {amt} |
| `s_q` | Има ли я в сметката? | Is it on the bill? |
| `s_ok` | Има я в сметката | Found on the bill |
| `s_no` | Няма я в сметката | Not on the bill |
| `s_ok_b` | Поръчката се води добавена и {table} пак може да поръчва. | The order counts as added and {table} can order again. |
| `s_no_b` | Поръчката се води неизпратена и {table} пак може да поръчва. | The order counts as not sent and {table} can order again. |
| `s_ok_toast` | Записано: има я в сметката · {who} | Saved: found on the bill · {who} |
| `s_no_toast` | Записано: няма я в сметката · {who} | Saved: not on the bill · {who} |
| `a_t` | Изпратена поръчка чака одобрение | Sent order awaiting approval |
| `a_ok` | Одобри | Approve |
| `a_no` | Откажи | Decline |
| `a_ok_toast` | Поръчката е одобрена | Order approved |
| `a_no_toast` | Поръчката е отказана | Order declined |
| `c_t` | {table} вика сервитьор | {table} is calling a waiter |
| `c_ok` | Обслужено | Handled |
| `c_toast` | {table}: обслужено | {table}: handled |
| `g_t` | {table} е спряна | {table} is paused |
| `g_d` | Достигнат е лимитът за поръчки. Прегледайте масата и я пуснете. | The order limit was reached. Check the table, then resume it. |
| `g_ok` | Пусни масата | Resume table |
| `g_b` | Гостите на {table} пак могат да поръчват. | Guests at {table} can order again. |
| `g_toast` | {table} е пусната · {who} | {table} resumed · {who} |
| `st_t` | Направете сторно в {source} | Make the storno in {source} |
| `st_d` | Връщане на {amt} за {table} (бележка {rcpt}). | Refund of {amt} for {table} (receipt {rcpt}). |
| `st_ok` | Сторното е направено | Storno done |
| `st_b` | Записваме, че сторното е направено в {source}. Restro не го проверява сама. | We record that the storno is done in {source}. Restro doesn't check it. |
| `st_toast` | Сторното е записано · {who} | Storno recorded · {who} |
| `d_t` | Спор по картово плащане | Card dispute |
| `d_d` | Плащане от {amt} ({table}, {date}). | Payment of {amt} ({table}, {date}). |
| `d_ok` | Виж доказателствата | See the evidence |
| `d_toast` | Тук се отваря страницата на плащането. | The payment's page opens here. |
| `r_t` | Занесете бележката | Bring the receipt |
| `r_d` | {table}: платено от телефона с реф. {ref}, {amt}. | {table}: paid from the phone with ref {ref}, {amt}. |
| `r_ok` | Занесена | Brought |
| `r_toast` | Бележката за {table} е занесена | Receipt for {table} brought |
| `tables` | Маси | Tables |
| `openof` | {o} от {t} са отворени за телефони | {o} of {t} open for phones |
| `openall` | Отвори всички | Open all |
| `closeall` | Затвори всички… | Close all… |
| `ca_t` | Да затворя ли всички маси за телефони? | Close all tables for phones? |
| `ca_b` | Всички гостувания приключват, а неизпратените поръчки на телефоните се изчистват. Сметките в {source} остават. | Every sitting ends and unsent phone orders are cleared. Bills in {source} stay. |
| `ca_ok` | Затвори всички | Close all |
| `ca_keep` | Остави отворени | Keep open |
| `oa_toast` | Отворени са {k} маси за телефони | {k} tables opened for phones |
| `ca_toast` | Затворени са всички маси за телефони · {who} | All tables closed for phones · {who} |
| `w_open` | Отворена | Open |
| `w_closed` | Затворена | Closed |
| `w_paused` | Спряна | Paused |
| `w_pay` | Плащане | Payment |
| `w_order` | Провери | Check |
| `w_appr` | Одобрение | Approval |
| `w_call` | Вика | Calling |
| `t_open` | {table} е отворена за телефони | {table} is open for phones |
| `t_closed` | {table} е затворена за телефони | {table} is closed for phones |
| `sh_sub` | {bar} · отворена от {since} | {bar} · open since {since} |
| `sh_f1` | {k} изпратени поръчки | {k} sent orders |
| `sh_f2` | Сметка: {amt} | Bill: {amt} |
| `sh_close` | Затвори за телефони | Close for phones |
| `sh_new` | Нови гости | New guests |
| `ng_t` | Нови гости на {table}? | New guests at {table}? |
| `ng_b` | Започва ново гостуване: старата поръчка и разрешенията на телефоните се изчистват. Сметката в {source} остава. | A new sitting starts: the old order and the phones’ permissions are cleared. The bill in {source} stays. |
| `ng_ok` | Нови гости | New guests |
| `ng_keep` | Остави | Keep |
| `ng_toast` | {table}: нови гости | {table}: new guests |
| `pin_t` | Въведете своя ПИН | Enter your PIN |
| `pin_tm` | Въведете ПИН на мениджър | Enter a manager's PIN |
| `pin_lb` | ПИН код, 4 цифри | PIN, 4 digits |
| `pin_wrong` | Грешен ПИН. Опитайте отново. | Wrong PIN. Try again. |
| `pin_staff` | Този ПИН е на служител. Нужен е ПИН на мениджър. | This PIN belongs to staff. A manager's PIN is needed. |
| `leave` | Остави | Leave it |
| `del` | Изтрий цифра | Delete digit |
| `p_toast` | Поръчките на {scope} са спрени | Ordering at {scope} paused |
| `lift_toast` | Поръчките са пуснати · {who} | Ordering resumed · {who} |
| `undo` | Върни | Undo |
| `close` | Затвори | Close |
| `err` | Не се записа. Проверете връзката и натиснете отново. | Not saved. Check the connection and press it again. |
| `loading` | Зареждане… | Loading… |
| `bar1` | Главен бар | Main bar |
| `bar2` | Втори бар | Second bar |
| `who_t` | бар таблета | the bar tablet |
| `who_s` | Мария | Maria |
| `who_m` | Георги | Georgi |
| `source` | Mistral | Mistral |
| `tb` | Маса {n} | Table {n} |
| `ph_needs` | Чака вас | Needs you |
| `ph_tables` | Маси | Tables |
| `more` | Още действия | More actions |

Keys that are only for the prototype and not interface strings: `venue`, `stub`, `who_t`, `who_s`, `who_m`, `source`. `who_t` ("the bar tablet") is a real string: it names the actor when a shared tablet pauses ordering without a PIN.

## 10. The lead's answers (10-21)

The lead reviewed the plan and the prototype. Questions that are the lead's are settled here; the others go to Martin with the prototype.

- **Q1, "Action screen":** to Martin.
- **Q2:** board Q4 stands: only a manager or owner answers "Receipt printed" / "No receipt". D122 §7 now says so in one sentence.
- **Q3:** the split stands, a PIN where money, a record or the whole venue is involved. D122 §7 says answers on a shared device ask a PIN, so dropping it for "Handled" (waiter call) and "Brought" (receipt) goes to Martin.
- **Q4:** no Approve or Decline buttons. Approval lives in the POS (D116), so the row is read-only ("Approve or decline it in {source}"). The prototype was changed to match.
- **Q5:** closing one table takes 2 taps, through its sheet.
- **Q6:** a manager lifts a staff pause, as D122 §7 and board Q4 settled. Not asked again.
- **Q7:** the storno and dispute to-dos show on the shared tablet, answered with a manager's PIN, and are hidden on a staff member's own phone.
- **Q8:** the four new Patterns rows and the persona paragraph (§7) go to the session that owns `operational-screens.md`; they land there, not here.
- **Q9:** yes, a money alert has no filled button.
- **Q10, a sound for a new alert:** to Martin.
- **Q11:** "Tonight" sits after "Tables & QR"; a staff-only sign-in lands on it.
- **Q12, wording and the BG terms:** to Martin with the prototype.
- **Q13:** the storno deadline stays off the row until the accountant answers (#52).
- **Q14:** each job keeps its own word; "Done" only in Telegram.
- **Martin 10-21 (#55):** stock lives in the POS, so Tonight has no "Sold out" tab. Its actions instead get a notice when an item runs out in the POS ("Out of stock in {source}: Mojito. Greyed out on the menu."), D122 §4.
