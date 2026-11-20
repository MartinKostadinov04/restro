# Screen round 2026-11-18, lane 3: Service night

Scope: the guest's bag, Call a waiter, Bill, Pay and Receipt on `/t/<code>` (390 px, bg and en), and Tonight: Actions and tables, Sent orders, Log, End of night. Personas: guest, waiter (shared device with PIN), manager. Commit: `sr/foundation` at 1ae48918. Environment: database `restro_lane3`, web `http://lane3.localhost:3130`, worker 8131, sim-pos 4730, simulated payment provider. Setup, not a finding: Thursday's service hours were set to open at 08:00 so phone ordering was open during the walk.

Passes: explorer (Sonnet, `screen-review` step 2), code check (Opus, `code-review high` on the lane's paths), security check (Fable, `security-review` and `audit-security.md`). Screen rows are `S<n>`, code rows `C<n>`, security rows `X<n>`.

Open PR #451 (Not served refunds a paid line) is in flight: rows that touch it are notes.

## Screen rows (explorer)

### S1. Pay on an empty bill opens a full form with a dead "Pay €0.00" button
- Kind: bug
- Screen: /t/4tPkqpjSBjlJJvmfhW9SkS (table 32) → Pay sheet, guest, 390 px, dark, bg and en
- Steps: open the table link, tap "Плащане" in the header with nothing on the bill.
- Expected: when nothing is owed, say so and offer the way back to the menu (copy-rules rule 5, an empty screen invites the next action; D72, no fake state). The sheet should not ask "What are you paying for?".
- Saw: "Какво плащате?" / "What are you paying for?" with one option "Цялата сметка", then "За плащане 0,00 € / Избрано 0,00 € / Общо 0,00 €", a disabled "Плати 0,00 €" and the line "Изберете поне един ред." / "Choose at least one line." There are no lines to choose. The same sheet in Bulgarian also reads "Simulated payments" (that is the sim provider's name).
- Check: copy-rules rule 5; copy-rules rule 4; design-critique 2 (a dead end)
- Evidence: S1-before.jpg; the sheet text and a disabled button 350×48
- Proposal: if the bill is empty, replace the form with "Няма какво да се плати" / "Nothing to pay yet" and a "Към менюто" / "Back to the menu" button. Alternatively hide the Pay entry while nothing is owed.
- Status: re-verified (11-20, sr/lane3-walk): empty bill (table 33) opens "Няма какво да се плати" + "Към менюто", no form; from the bill's "Плати" the whole bill comes pre-ticked (see S14)

### S2. On a phone, Tonight names the same screen three times and stacks two dropdowns above the content
- Kind: simplification
- Screen: /venues/vn_1grlsfZeGpc2GTtpMciPdL?tab=tonight, waiter or manager, 390 px, dark, bg
- Steps: open Tonight at 390 px.
- Expected: Where am I? is answered once and the first thing the eye lands on is what needs the waiter (operational-screens, Clean rule 2, "remove one thing"; screen read 1 and 3).
- Saw: above the first alert there are two full-width 44 px dropdowns ("Тази вечер", then "Действия и маси"), then a heading "Тази вечер Действия и маси", then the "Чака вас 1 / Маси" switch, then the heading "Чака вас 1". The first alert starts at about y 480 of 844. The two dropdowns hold the same words as the heading under them.
- Check: operational-screens.md Clean rule 2; screen read 3
- Evidence: S2-before.jpg
- Proposal: at 390 px keep only the heading and drop one of the dropdowns, or move the section switch into the heading row. Alerts then sit about 120 px higher.
- Status: still open (11-20): the section switch now sits in the heading row, but the "Чака вас 1" heading still repeats the "Чака вас 1 / Маси" switch right above it; first alert at y≈440 (was 480)

### S3. The table sheet on Tonight has no visible close control
- Kind: bug
- Screen: Tonight → "Маси" → tap a tile (for example "Маса 32"), waiter or manager, 390 px, dark, bg
- Steps: tap the tile "Маса 32, Вика".
- Expected: "How do I get out: a sheet or dialog closes with a visible control and Esc and loses nothing" (operational-screens, persona on Tonight; screen-read way-out question).
- Saw: a bottom drawer with a drag handle, "Затвори за телефони" and "Нови гости". There is no X or "Back" control. Esc works. The sheet's only buttons are the two actions, and one of them ("Нови гости") ends the sitting.
- Check: operational-screens.md, "How do I get out" on Tonight; WCAG 2.5.7 (the drawer is dismissed only by drag or tap outside)
- Evidence: S3-before.jpg; the sheet's buttons are 358×44 each and none is a close control
- Proposal: add a "Затвори" / "Close" 44 px control in the sheet's top-right corner, as the guest's sheets have.
- Status: re-verified (11-20, sr/lane3-walk): at 390 px the table drawer has a 358×44 "Затвори" button under its two actions; Esc still closes it

### S4. A table can be "Отворена" for phones while phones cannot order, and Tonight does not say so
- Kind: bug
- Screen: Tonight → "Маси" (Маса 32 sheet "отворена от 09:45") against the guest bag at /t/4tPkqpjSBjlJJvmfhW9SkS, waiter and guest, 390 px, dark, bg
- Steps: before the venue's service hours open, the guest taps "+" on two items and opens "Виж поръчката". The waiter looks at table 32 on Tonight.
- Expected: the waiter sees that guests at an open table cannot send yet; or a table opened for phones is also ready to order (glossary "Open for phones": staff let phones order to the bill).
- Saw: at 14:44 the guest bag shows two lines, "Общо (прибл.) 205,00 €" and the notice "Поръчките от телефон започват в 22:00", with no send button at all. Tonight shows "10 от 76 са отворени за телефони" and the sheet says "отворена от 09:45", with nothing about the 22:00 start. The guest can fill a bag they cannot send, and the waiter cannot tell why a table that is open is silent.
- Check: operational-screens.md screen read 4 (state over normal); copy-rules rule 4 (no fix named); D72
- Evidence: guest bag text (dialog innerText); Tonight sheet text "Бар 2 · отворена от 09:45"
- Proposal: on Tonight's header and on each open tile or sheet add a line "Поръчките от телефон започват в 22:00" / "Phone orders start at 22:00". In the guest bag, put the start time on the bar's "Виж поръчката" line instead of "прибл. 205,00 €".
- Status: re-verified (11-20, sr/lane3-walk), from the code plus a short look: Tonight's header and the table sheet show "Поръчките от телефон започват в {time}" from the venue's hours (server/tonight/load.ts phoneOrdersOf; tonight-panel.tsx:394; table-sheet.tsx:156); not seen live because hours open at 08:00, and nothing shows while ordering runs

### S5. The Pay sheet names the same three figures differently in Bulgarian and English
- Kind: bug
- Screen: /t/<code> → Pay, guest, 390 px, dark, bg against en
- Steps: open Pay in BG, switch to EN, open Pay.
- Expected: one name per concept, the same in both languages (copy-rules rules 3, 8 and 9; GLOSSARY).
- Saw: BG "За плащане / Избрано / Общо"; EN "Left to pay / Your items / Total". "Избрано" means chosen; "Your items" means the guest's own, which is a different thing (all the lines versus a selection).
- Check: copy-rules rules 3, 8 and 9
- Evidence: Pay sheet text in both languages (see S1)
- Proposal: "Selected" / "Избрано" for the second row in both languages, or a matching pair of words.
- Status: re-verified (11-20, sr/lane3-walk): BG Pay sheet reads "За плащане / Избрано / Общо" live; EN "Selected" from packages/shell/src/strings.ts:691 (EN Pay not opened live)

### S6. Call a waiter: the first option repeats the dialog's title, and the confirmation is about "it"
- Kind: simplification
- Screen: /t/<code> → "Повикай сервитьор", guest, 390 px, dark, bg
- Steps: tap the bell in the bottom bar.
- Expected: one name per action (copy-rules rule 3); an error or confirmation names what is meant (rules 4 and 5).
- Saw: the sheet title is "ПОВИКАЙ СЕРВИТЬОР" and the first of seven reason tiles is also "Повикай сервитьор" (EN: "CALL A WAITER" and "Call a waiter"). After "Лед" is sent, the confirmation reads "Сервитьорът е повикан / Чакаме екипът да я потвърди." (EN "Waiter called / We are waiting for the team to confirm it."). The title says a waiter was called although the guest asked for ice. "я" and "it" have no noun to point to. "Лед" and "Вода" use the same drop icon.
- Check: copy-rules rules 3 and 9; design-critique 4
- Evidence: Call sheet text in BG and EN (buttons "Повикай сервитьор", "Сметката, моля", "Лед", "Вода", "Чаши", "Почистване на масата", "ПОС терминал")
- Proposal: rename the first tile "Друго" / "Something else" (or "Просто повикай" / "Just call"). Confirm with "Заявката е изпратена" / "Request sent" and "Чакаме сервитьорът да я потвърди." / "Waiting for a waiter to confirm."
- Status: re-verified (11-20, sr/lane3-walk): first tile "Друго"; after "Лед" the sheet says "Заявката е изпратена / Чакаме сервитьор да я потвърди." with "Лед" under it; Ice has its own icon; EN "Something else" / "Request sent" (strings.ts:548, 554)

### S7. Bill sheet has no way to refresh and shows an age that only grows
- Kind: optimisation
- Screen: /t/<code> → "Сметката на масата", guest, 390 px, dark, bg
- Steps: open the bill, wait.
- Expected: a Reading is shown with its age (glossary "Reading"); a guest who sees "Обновено преди 71 сек." wants to refresh or sees it refresh.
- Saw: "Обновено преди 71 сек." (EN "Updated 31 s ago") with the only control being "Затвори". The explorer did not stay long enough to see whether it refreshes by itself.
- Check: design-critique 2 (is it obvious?); operational-screens feedback 1
- Evidence: Bill dialog text (no refresh button in its button list)
- Proposal: add "Обнови" / "Refresh" next to the age, or say "Обновява се само" / "Refreshes by itself" if it does. A reviewer should confirm the polling first.
- Status: re-verified (11-20, sr/lane3-walk): the age label ticks every second (17 → 29 s) and resets on a new reading (→ 15 s); once it showed "Последната поръчка още влиза в сметката" in its place

### S8. Dev-only: the guest table page showed an empty skeleton for several seconds on first load
- Kind: optimisation
- Screen: /t/<code>, guest, 390 px, dark, bg
- Steps: open /t/4tPkqpjSBjlJJvmfhW9SkS from Tonight's link.
- Expected: the menu (or a visible loading state with words) within a second after the redirect to /m/…#t=…
- Saw: about 8 seconds of grey skeleton blocks with no text and then the menu. The page title was "Menu" until it finished. Dev server only; not a finding about the production build.
- Check: operational-screens feedback 1 ("set expectations"); dev server
- Evidence: first screenshot of the load (skeleton, 293×633), dev server
- Proposal: none before CI's production build is measured.
- Status: rejected (see Review)

### S9. In the bag the "Remove" link and the stepper sit in a different place on each line, and rows have uneven backgrounds
- Kind: bug
- Screen: /t/4tPkqpjSBjlJJvmfhW9SkS → "Your bag" with four lines, guest, 390 px, dark, en
- Steps: add four items, open "View bag".
- Expected: one pattern per job (design-critique 4: similar elements behave similarly); a line reads the same on every row.
- Saw: on the 1st and 4th line "Remove" sits under the name, on the 2nd and 3rd it sits to the right of the name. The stepper overlaps the price row. Lines 1 and 3 have a lighter band behind them and lines 2 and 4 do not. The longer name "Moët & Chandon Brut 0.75" wraps and pushes "Remove" down.
- Check: design-critique 4 (consistency); design-critique 3 (hierarchy)
- Evidence: S9-before.jpg
- Proposal: one fixed layout per line: name and price on the first row, then "Remove" on the left and the stepper on the right on the second row, with no alternating band.
- Status: re-verified (11-20, sr/lane3-walk): four lines in EN, each with name and price, then Remove on the left and the stepper on the right; no bands

### S10. A €525 Send is refused as "Ordering is paused" and stops table 32 for everyone, and the guest is not told it was the amount
- Kind: bug
- Screen: /t/4tPkqpjSBjlJJvmfhW9SkS → bag → "Send 4 items" (Absolut, Jack Daniel's, Grey Goose, Moët: €525.00), guest, 390 px, dark, en; Tonight alert, waiter
- Steps: with the table open, put four bottles in the bag and tap "Send 4 items". Then look at Tonight.
- Expected: the guest is told what happened and what to do (copy-rules rule 4); a refusal because of the order's size is not worded as a pause of the whole venue's ordering. D72: no local success, and there is none here.
- Saw: "Sending…" for about 4 s, then two stacked notices, "Ordering is paused right now, please order from a waiter." and "Ask your waiter to take this order.", and the button greyed. Tonight shows the alert "Маса 32 е спряна: Достигнат е лимитът за поръчки. Прегледайте масата и я пуснете." and the Log shows "Защита спря поръчка над лимита". Neither the guest nor the alert names the limit or the amount. The waiter's "Пусни масата" released the table ("Маса 32 е пусната", with Undo). The guest bag still held the four lines. A €110 order sent right after went through ("Added to your bill").
- Check: copy-rules rule 4; operational-screens.md screen read 4; D118 (cap at Send)
- Evidence: S10-before.jpg; Log rows 14:54
- Proposal: guest: "This order is too large to send from a phone. Send fewer items or ask your waiter." / "Тази поръчка е твърде голяма за телефон. Изпратете по-малко или повикайте сервитьор." Waiter alert: add the amount and the limit: "Маса 32: поръчка за 525,00 € над лимита …. Прегледайте и пуснете масата."
- Status: re-verified (11-20, sr/lane3-walk): the €525 Send shows "This order is over the limit for phone orders. Your waiter will take it."; the Tonight alert reads "Поръчка за 525,00 € над лимита от 150,00 €. Прегледайте масата и я пуснете."; the old "Ordering is paused right now…" notice still sits above the new line

### S11. On Tonight at tablet width, the section tabs, the sheet close and the menu items are under the 44 px floor
- Kind: bug
- Screen: /venues/vn_1grlsfZeGpc2GTtpMciPdL?tab=tonight, waiter or manager, 1180 × 820, dark, bg
- Steps: open Tonight, measure the tab row and the controls; open a sent order (Поръчки → V96) and the "…" menu on "Маси".
- Expected: "44 px stays the floor" on Tonight and any bar screen, checked at 1180 × 820 (operational-screens.md, the persona on Tonight; D123).
- Saw: the section tabs "Действия и маси / Поръчки / Дневник / Край на вечерта" and the venue tabs are 29 px high; "Отвори страницата за гости" is 37 px; the "Затвори" X of the order sheet is 16 × 16 px; the items of the "…" menu ("Затвори всички…", "Приключи вечерта") are 42 px; the sidebar toggle is 28 px.
- Check: Restro 44 px floor; operational-screens.md "Targets and text"
- Evidence: S11-before.jpg; measured heights in the DOM
- Proposal: on Tonight, give the section tabs, the sheet X (a 44 px hit area) and the menu items 44 px; the venue tabs and the sidebar toggle are the admin shell (navigation → lane 6).
- Status: still open (11-20): section tabs 128×44, order-sheet X 44×44, "…" items 44 laid out (41.8 measured = the menu's 0.95 open animation frozen in the hidden pane), end-night X 44×44; but "Отвори страницата за гости" is 244×37: publish-bar.tsx:39 defines its own WRAPS "h-auto min-h-9" that shadows lib/wrapping's min-h-12, so .min-h-9 (36px) wins and phone:h-11 applies only under 48rem or a coarse pointer

### S12. "Край на вечерта" is a report tab; the action that ends the night is hidden in a "…" menu on another tab
- Kind: simplification
- Screen: Tonight → "Край на вечерта" against "Действия и маси" → "…" → "Приключи вечерта", manager, 1180 × 820, dark, bg
- Steps: a manager who wants to end the night opens the tab named "Край на вечерта".
- Expected: one name per action (copy-rules rule 3); the next step is a visible control (screen-read 1, wayfinding 2).
- Saw: the tab "Край на вечерта" holds only the night's figures (for fixing, orders, payments, reservations, totals) and a CSV. The action is "Приключи вечерта" in the "…" menu beside "Отвори всички" on the first tab, behind two taps and a menu of two items.
- Check: copy-rules rule 3; operational-screens.md wayfinding 2 and Patterns ("secondary actions of a row")
- Evidence: End of night text and the "…" menu items "Затвори всички…", "Приключи вечерта" (DOM text; no screenshot)
- Proposal: put a "Приключи вечерта" / "End the night" button on the "Край на вечерта" tab, and call the report "Вечерта в числа" / "The night in numbers" (or the reverse).
- Status: re-verified (11-20, sr/lane3-walk): a "Приключи вечерта" button (165×48) heads the "Край на вечерта" tab; the tab keeps its name; once the night ended the button is gone

### S13. The End-the-night dialog is a wall of reservation jargon
- Kind: bug
- Screen: Tonight → "…" → "Приключи вечерта", manager, 1180 × 820, dark, bg
- Steps: open the menu and choose "Приключи вечерта".
- Expected: the dialog names the action and its consequence in a sentence a person reads at a glance (copy-rules rule 11); the glossary words for reservations.
- Saw: "1 компания става „приключена“, 3 — „не се явили“, и 10 кода на маси се затварят. След това нито един телефон не може да поръчва. 2 компании от чакащите стават „не бяха настанени“." Then a warning "Клубът затваря в 06:00. Сега е 15:02." and "3 сметки са още отворени.". The buttons are good ("Остави вечерта отворена" / "Приключи вечерта по-рано"), but the body mixes parties, statuses and table codes in one sentence. The X is 15 px. After the confirmation the page shows "Тази вечер е приключена. 3 сметки са още отворени." and an alert with the same sentence, and "Отвори всички" stays active.
- Check: copy-rules rules 4, 8, 11; GLOSSARY ("Party"/reservation words); operational-screens.md Clean rule 1
- Evidence: S13-before.jpg
- Proposal: list as lines: "10 маси се затварят за телефони", "3 сметки остават отворени в POS", "3 резервации стават „не дошли“". Show the banner or the alert for open bills, not both.
- Status: re-verified (11-20, sr/lane3-walk): the dialog lists "9 маси се затварят за телефони", "3 сметки остават отворени в test POS", "Приключени: 1 / Не дошли: 3 / Неседнали: 2"; X 44×44; after confirming only the alert "3 сметки са още отворени" shows (no banner), and "Отвори всички" and "Спри поръчките" are disabled

### S14. The bill's "Pay €110.00" button opens the Pay sheet at "€0.00" and "Choose at least one line", then a second Pay
- Kind: simplification
- Screen: /t/4tPkqpjSBjlJJvmfhW9SkS → bill sheet → "Pay €110.00" → Pay sheet, guest, 1180 × 820, dark, en
- Steps: order one item, open "Your table's bill", tap "Pay €110.00".
- Expected: taps per story against the baseline: from a bill of one line to a paid table in as few taps as the provider needs; the button's figure is the amount that will be paid.
- Saw: bill → "Pay €110.00" → Pay sheet shows "Left to pay €110.00 / Your items €0.00 / Total €0.00" and a disabled "Pay €0.00" with "Choose at least one line." → tick "The whole bill" → "Pay €110.00" → a second step with "Tip €0.00 / Total / Pay €110.00 / Pay later / Call a waiter" (the Tip row has no control) → "Pay €110.00" again → "Processing your payment…" → "Paid". That is five taps and two buttons that both say "Pay €110.00" before anything is charged.
- Check: design-critique 2 (unnecessary steps); copy-rules rule 3
- Evidence: Pay sheet text at each step
- Proposal: pre-select the lines the bill's button spoke of, so the Pay sheet opens with "Pay €110.00" ready; show the Tip row only if a tip can be set; the confirmation button says "Confirm €110.00" / "Потвърди 110,00 €".
- Status: re-verified (11-20, sr/lane3-walk): bill "Плати 95,00 €" → Pay sheet with "Цялата сметка" pre-ticked and "Плати 95,00 €" ready → "Потвърди 95,00 €" (no Tip row) → "Платено" M7HPK; 3 taps, sim-pay

### S15. Log: one phone order is three rows, and one row says only "настройка"
- Kind: simplification
- Screen: Tonight → "Дневник", manager, 1180 × 820, dark, bg
- Steps: send one order from a phone, open the Log.
- Expected: one line per fact; a person reading it at 03:00 sees what happened (operational-screens.md Clean rule 1; copy-rules rule 4).
- Saw: order V96 gives "Чака", "Изпраща се" and "Добавена" at 14:58, each as a 66 px row, so a normal order takes three rows. A change the owner made reads "Променени настройки: настройка" (the same word twice, and nothing about what changed: the service hours). Calls expiring after a quarter of an hour ("Повикването от Маса 45 изтече (Сервитьор)") are logged but nothing on Tonight warned the waiter before. The explorer's own unanswered "Лед" request left the alert list without a Log row saying it had expired.
- Check: operational-screens.md Clean rule 1; copy-rules rule 4
- Evidence: Log text at 14:58, 14:53 and 09:54
- Proposal: collapse an order's steps into one row that shows its latest state ("Поръчка V96: Добавена · 3 стъпки") that opens the steps; say what the setting is: "Променено: часове за поръчки".
- Status: re-verified (11-20, sr/lane3-walk): order VQH is one row "Поръчка VQH: Добавена · 3 стъпки" that expands; the hours change reads "Променени настройки: часове за поръчки"

### S16. Tapping a closed table's tile opens it for phones at once, though the tile says "closed"
- Kind: bug
- Screen: Tonight → "Маси", tile "Маса 32 е затворена за телефони", manager, 1180 × 820, dark, bg
- Steps: after the table's bill was paid and the table closed, tap its tile.
- Expected: a glance-and-tap screen (operational-screens.md, the Tonight persona): a tap on a status tile opens the thing, or its accessible name says what the tap does (WCAG 4.1.2).
- Saw: no sheet opened. The table at once became open for phones with the toast "Маса 32 е отворена за телефони" and Undo. The tile's accessible name, "Маса 32 е затворена за телефони", announces a state and not the action.
- Check: WCAG 2.2 4.1.2; operational-screens.md screen read 4
- Evidence: tile aria-label before and the toast after
- Proposal: name the control by its action ("Отвори маса 32 за телефони") and keep the Undo. Alternatively always open the sheet first, as with an open table.
- Status: re-verified (11-20, sr/lane3-walk): tapping the closed tile "Маса 32" opens its sheet with "Отвори за телефони" and a 44 px close; that button opens the table with the toast "Маса 32 е отворена за телефони | Върни"

### S17. All "Add" buttons stay live on a table that is closed for phones, and the reason comes only after a tap
- Kind: bug
- Screen: /t/4tPkqpjSBjlJJvmfhW9SkS after the night was ended, guest, 1180 × 820, dark, en
- Steps: end the night, open the table link, tap "Add" on any item.
- Expected: Add controls do not suggest an action the table cannot take (design-critique 2); a refusal says what to do (copy-rules rule 4).
- Saw: 29 "Add …" buttons are active, "Pay" and "Your table's bill" too. A tap shows the toast "This table is not taking orders from phones right now." with no next step. The same happened at 14:44 (S4): the bag could be filled while phone ordering was closed.
- Check: copy-rules rule 4; design-critique 2; D72 (no local success)
- Evidence: toast text; 29 active Add buttons in the DOM
- Proposal: one calm line at the top of the page, "Тази маса не приема поръчки от телефон. Повикайте сервитьор." / "This table is not taking phone orders. Call a waiter.", and the Add buttons replaced by the waiter call.
- Status: re-verified (11-20, sr/lane3-walk): table 33 closed from its sheet; the guest page at 1180 EN has 0 Add buttons and no waiter bell, and shows "This table isn't open for phone orders. Ask a waiter."

## Code rows (code check, Opus, `code-review high`)

### C1. On a shared tablet, push subscribe and revoke run as the remembered PIN person, so core refuses them and the tablet's alerts stay off
- Kind: bug
- Where: apps/web/src/server/tonight/actions.ts:95-108 (perform), :636-655 (subscribePushAction, revokePushAction); packages/core/src/service/alerts.ts:396
- Failure: after a waiter's PIN on the tablet, for about 3 minutes perform() swaps the actor to `{kind:'staff'}` for every action with no PIN and no `asOperator`, including `push.subscribe` (the visibility re-read or a "Turn on" tap). `pushSubscribe` returns `account_required`; `push-control.tsx:104` stores `refused.current = endpoint` and shows push as off, so the tablet's alert subscription is never renewed. The docstring says it should run as the device's own account, with no PIN.
- Rule: D122 §7, D141 12.11
- Proposal: the push actions skip the remembered person and keep the device account (an `asDevice` option on perform() that skips `personAtSharedDevice`).
- Status: confirmed (see Review)
- Note: the file is also changed by PR #451 (a different region).

### C2. A refused Pay keeps spending the phone's `payGap` and `pays` limits; a refused Send gives the same limits back
- Kind: bug
- Where: packages/core/src/service/guest.ts:1532 (payAct); compare :1150-1190 (guestAct gives back `SEND_SPENDS`, which includes `payGap` and `pays`)
- Failure: a guest taps Pay and is refused by Turnstile (an expired token), by `stale_action` (the bill changed) or by the engine. Each retry starts the 15 s `payGap` and uses one of the 5 `pays` per 10 minutes, and nothing is given back. After a few refusals the phone gets 429 and cannot pay for up to 10 minutes, though no payment was made.
- Rule: RR-26 / D122 §4 (the refused-try rule that applies to Send)
- Proposal: record `takenAt`; when the Turnstile check, the open-payment check or `applyService` does not accept, call `limits.giveBack(subject, ['payGap','pays'], takenAt)`. A thrown request keeps the hits, as Send does.
- Status: confirmed (see Review)

### C3. A 429 answer to Send or Pay makes the phone look offline and blocks Send and Pay with the offline code
- Kind: bug
- Where: apps/web/src/guest/services-client.ts:976-979 (with :553, :598-601)
- Failure: `request()` sets `awaitingSince` and arms the 10 s watch. The 429 branch never calls `answered()` and reschedules the poll by Retry-After (15 s for `payGap`). At 10 s `offline()` turns true: the phone shows the offline line, and `dispatch` refuses every Send or Pay with `OFFLINE_CODE` until the next poll answers, although the server did answer. `backoff()` also counts a failure for a request that got an answer.
- Rule: D121 (offline means no answer)
- Proposal: call `answered()` before scheduling on 429, and on the other non-5xx statuses that are not OK.
- Status: confirmed (see Review)

### C4. One failing listing query in the minute tick stops waiter-call lapses and the unconfirmed-pause sweep for every venue
- Kind: bug
- Where: apps/worker/src/jobs/order-tidy.ts:153-160 (handler); :46-54 and :97-115 (per-organisation listings outside any try)
- Failure: one organisation's `idleOrders` query throws (a statement timeout or an RLS error); the handler throws before `lapseWaiterCalls` and `sweepUnconfirmedPauses` run. With `retryLimit: 0` that minute is lost; if the error persists, no venue's waiter calls lapse and no Unconfirmed table pause is lifted.
- Rule: none
- Proposal: each pass in its own try/catch with a log line; each organisation's listing in a try so that one tenant is skipped, not all.
- Status: confirmed (see Review)

### C5. Guest events placed back by `ageMs` are filed under the service day and sitting of the moment they reach the server
- Kind: bug
- Where: packages/core/src/service/guest.ts:1928 vs :1950-1951 (reportGuestEvents)
- Failure: a phone holds `menu.opened` from 06:55 and flushes it at 07:05. The event's `at` is 06:55, but `serviceDate` comes from `now`, so the event lands on the next service day, under whichever sitting is open now. This skews D142's per-night and per-sitting counts (analytics only; no service row is affected).
- Rule: CLAUDE.md conventions (time: the venue's service day)
- Proposal: work out `serviceDate` from each event's `at`; drop the `sittingId` of events older than the current sitting's start, or from another day.
- Status: confirmed (see Review)

### C6. `scopeOf` and `answer` are copied between the two Tonight read-action files
- Kind: simplification
- Where: apps/web/src/server/tonight/payment-actions.ts:37-70; apps/web/src/server/tonight/night-actions.ts:49-80
- Failure: the tenant, venue and actor scoping (`rememberedAtSharedDevice`, the digest rethrow, the FAILED shape) lives in two copies; a fix to one silently misses the other.
- Rule: none
- Proposal: one shared `scopeOf` and `answer`, imported by both.
- Status: confirmed (see Review)

Rejected by the code check itself: `pin_required` on PIN-less undo and receipt actions (every default role holds `alerts.answer`); per-tenant tick round trips (scale only); the duplicated `reject` builder, `sleepFor` helper and `command()` alias (trivial).

## Security rows (security check, Fable, `security-review` + `audit-security.md`)

### X1. Any staff member's own PIN resets the shared tablet's wrong-PIN counter, so a waiter can guess a manager's PIN without ever tripping the guard
- Kind: bug
- Where: packages/core/src/pin-guard.ts:75-77 (`succeed` deletes the device's whole state), called at packages/core/src/service/identify.ts:84; the trip threshold at pin-guard.ts:65
- Attack: a waiter with a valid PIN, at the venue's shared tablet, sends four wrong guesses and then their own PIN, and repeats. Any PIN-taking action works (`perform` in apps/web/src/server/tonight/actions.ts:80, or `paymentEvidenceAction`). The counter never reaches five, so there is no wait and no `guard.tripped` Log entry, and wrong PINs under the trip are not logged at all. The 10,000 four-digit PINs are covered in at most 2,500 cycles. A PIN match is organisation-wide (identify.ts:73-82), so a hit names whoever holds that PIN: the waiter gets a manager's non-settings rights at the venue (lift pauses, storno done, payment answers, end the night, dispute evidence), and the Log names the manager.
- Rule: D122 §7 (the wrong-PIN guard); audit-security item 7
- Proposal: a correct PIN clears only the trip escalation, never the window's wrong PINs; log wrong PINs, or at least a count per device.
- Status: confirmed (see Review)

Security notes (not rows): a repeated `pay.start` with the same action id replaces the handle hash and skips Turnstile (pay.ts:414-426), not exploitable because no guest answer carries another phone's action id (a regression test is worth adding); `pnpm audit --prod` lists 11 advisories in `undici`, `next` and `esbuild` (an upkeep ticket, not traced). Found sound: the guest table binding, the guest payment handle, rule 3's forbidden-values walk, the notice route and worker, Tonight's venue scoping, the shared device's rights, the simulated onboarding gate, SQL parameters.

## Review (Opus, `screen-review` step 4, blind walk first, fresh database)

The reviewer walked blind, then reproduced every row on a fresh seed (venue `vn_7K3agoUxiDeHzGVOZivmVI`). The staff PIN sheet was not reachable in the pane (it needs a device account), so X1 and C1 are confirmed from the code. Tonight's "Зареждане…" in a hidden pane is the browser not drawing frames, not a finding. Martin will not pick tonight (round brief): every confirmed row is fixed, Polish included; "Needs Martin's yes" is informational.

| Row | Verdict | Severity | Effort | Decision | Needs Martin's yes | Fix |
|---|---|---|---|---|---|---|
| S1 | confirmed on table 33 (empty bill): "Цялата сметка", disabled "Плати 0,00 €", "Изберете поне един ред."; "Simulated payments" is the simulated provider's name and not part of the row | Before the pilot | S | none | yes | F1 |
| S2 | confirmed at 390 px; the first dropdown is the venue-tab switcher (navigation → lane 6), the section part is ours | Before the pilot | S | none | yes | F5 |
| S3 | confirmed: at 390 px the drawer has no close control; at 1180 px the side sheet's X is 16×16 (two patterns for one job) | Before the pilot | S | none | yes | F5 |
| S4 | confirmed from the code: Tonight never reads the service hours (only `settings/hours*` and `ordering-view.ts` do); not reproduced live because the round opened at 08:00 | Before the pilot | M | none | yes | F6 |
| S5 | confirmed: EN "Left to pay / Your items / Total", BG "За плащане / Избрано / Общо" | Before the pilot | S | none | yes | F2 |
| S6 | confirmed, plus: "Чакаме екипът да я потвърди" is wrong grammar ("екипа"); Ice and Water share one SVG path; EN's first tile reads "Call the waiter" under "CALL A WAITER" | Before the pilot | S | none | yes | F2 |
| S7 | confirmed with another cause: the bill refreshes by itself (2 s polling backing off to 15 s, a new POS reading when the last is over 15 s old), but the age label freezes at the last changed answer ("Updated 56 s ago" for 25 s+). No Refresh button: the label should tick | Before the pilot | S | none | yes | F3 |
| S8 | **rejected**: a dev-server timing with no proposal; re-check on CI's production build | — | — | — | — | — |
| S9 | confirmed on table 33 in EN | Polish | S | none | yes | F4 |
| S10 | confirmed both sides; the pause itself follows D122 (the table stays paused until staff resume it), but D118 says the guest's phone says why, and it does not. The proposed "send fewer items" would fail too: the guest text must not suggest it | Before the pilot | M | none (the pause stays) | yes | F2 + F6 |
| S11 | confirmed at 1180×820: section tabs 29 px, "Отвори страницата за гости" 37 px, sheet X 16 px, "…" menu items 42 px, end-night dialog X 15 px; venue tabs and sidebar toggle → lane 6 | Before the pilot | S | none | no | F5 |
| S12 | confirmed; renaming the report would contradict D122 ("End of night" is the page's name), so only the button is added | Before the pilot | S | none for the button; the rename contradicts D122 and is dropped | yes | F7 |
| S13 | confirmed, plus: the dialog's words differ from the report's ("не се явили" vs "Не дошли", "не бяха настанени" vs "Неседнали"; copy rule 8); after confirming, banner and alert both say "3 сметки са още отворени" and "Отвори всички" / "Спри поръчките" stay active | Before the pilot | M | none | yes | F7 |
| S14 | confirmed: four taps from the bill; the second step is the bill being prepared, which the flow needs, so it stays but is renamed | Before the pilot | M | none | yes | F1 |
| S15 | confirmed: one order makes three rows, "Променени настройки: настройка" comes from `lg_w_setting`, one payment makes seven rows (S20) | Before the pilot | M | none | yes | F8 |
| S16 | confirmed: a tap on a closed tile opened it for phones with no sheet; breaks "a tap opens the thing"; same tiles as #419 | Before the pilot | S | none | yes | F5 |
| S17 | confirmed: closed tables' "+" buttons look live; the glossary says a table that is not open shows the menu only. The proposed waiter-call replacement fails (calls are refused on a closed table too, `waiter-call.ts:128`): show a read-only menu | Before the pilot | M | none | yes | F4 |
| C1 | confirmed, smaller effect: the existing subscription is not revoked, so alerts still arrive; the harm is a false "off" and a changed push address not registered until a later open | Before the pilot | S | none | no | F9 |
| C2 | confirmed; the same gap as RR-O27 of the 10-29 repair review (deferred then): merged | Before the pilot | S | none | no | F10 |
| C3 | confirmed and worse: the Retry-After reschedule replaces the poll timer, so a Pay-limit 429 can hold "offline" for up to 600 s and block Send; polls and other 4xx answers also skip `answered()` | Before the pilot | S | none | no | F10 |
| C4 | confirmed; `waiter-call-lapse.ts:37-58` has the same pattern | Before the pilot | S | none | no | F11 |
| C5 | confirmed; analytics only, related to #358 | Polish | S (day) / M (sitting) | none | no | F10 |
| C6 | confirmed: `scopeOf` identical, `answer` differs only in types | Polish | S | none | no | F9 |
| X1 | confirmed: `succeed()` clears the whole device state; PINs are 4 digits matched organisation-wide; wrong PINs below the trip leave no Log entry; no other limit on this path, and counters are per process | **Blocking** | S–M | none | no | F12 |

### S18. After Send, the bag says the table's order is empty right above "Added to your bill" (reviewer)
- Kind: bug
- Screen: /t/3rkwT7KevDf6UU0XgHuODW (table 32) → bag after Send, guest, 390 px, dark, bg
- Steps: add one item, open the bag, tap "Изпрати 1 артикул".
- Expected: one state at a time; a just-confirmed send is not followed by an empty-state line (copy-rules rule 5; D72).
- Saw: "В поръчката на масата още няма нищо." directly above "1 × Absolut Vodka 0.7 / Добавено към сметката ви / Покажете това на сервитьора". EN: "Nothing on the table order yet."
- Check: copy-rules rule 5; design-critique 2
- Evidence: S18-review.jpg; dialog innerText
- Proposal: while a sent card is shown, replace the empty line with "Добавете още от менюто." / "Add more from the menu."
- Status: re-verified (11-20, sr/lane3-walk): after "Изпрати 1 артикул" the bag shows "Добавете още от менюто." above the "Добавено към сметката ви" card
- Verdict: confirmed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: yes · Fix: F4

### S19. Call a waiter on a closed table: the bell and Send are offered, and the refusal talks about orders (reviewer)
- Kind: bug
- Screen: /t/3rkwT7KevDf6UU0XgHuODW (table 32, just after paying the whole bill by phone), guest, 390 px, dark, en
- Steps: pay the whole bill (the table closes for phones at once), tap the bell, choose "Ice", tap "Send".
- Expected: a control the table cannot use is not offered (design-critique 2), and a refusal names the thing tried (copy-rules rule 4).
- Saw: "The team could not take this request / This table is not taking orders from phones right now." The guest asked for ice, not an order. A guest who has just paid can no longer call anyone (`waiter-call.ts:128` refuses `table_not_open`).
- Check: copy-rules rule 4; design-critique 2
- Evidence: dialog innerText; `packages/shell/src/strings.ts:625` (`table_not_open` is shared by Send and Call)
- Proposal: hide the bell when the table is not open for phones; give calls their own refusal: "Тази маса не е отворена за телефони. Махнете на сервитьор." / "This table isn't open for phones. Wave to a waiter." Whether calls should outlive the bill is a question for Martin.
- Status: re-verified (11-20, sr/lane3-walk): closed table 33 at 390 BG has no bell and no Add, with "Тази маса не е отворена за поръчки от телефон. Попитайте сервитьор."; calls have their own refusal (strings.ts:611); paying the whole bill did not close the table this time, so it was closed from the sheet
- Verdict: confirmed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: yes · Fix: F2 + F4

### S20. The Log shows "таксувано" (charged) twice for one payment (reviewer)
- Kind: bug
- Screen: Tonight → Дневник, manager, 1180×820, dark, bg
- Steps: pay a bill from a phone, open the Log.
- Expected: one line per fact (operational-screens Clean rule 1); a money Log never reads as a second charge.
- Saw: at 15:20, "Плащане за Маса 32, 95,00 €: таксувано" twice among seven payment rows. The second is the payment table being freed (`pay-route.ts:507`, reason `table_freed`); `log-sentence.ts:197-201` drops the reason.
- Check: operational-screens Clean rule 1; copy-rules rule 4
- Evidence: Log text at 15:20; the code above
- Proposal: render `table_freed` as "Плащане за Маса 32: масата за плащане е освободена" / "Payment for Table 32: payment table freed"; `release_refused` likewise.
- Status: re-verified (11-20, sr/lane3-walk): one payment shows "таксувано" once; the freed row reads "Плащане за Маса 33: масата за плащане е освободена" (one payment is still seven rows)
- Verdict: confirmed · Severity: Before the pilot (a manager could refund a "duplicate") · Effort: S · Decision: none · Needs Martin's yes: no · Fix: F8

## Fix plan (reviewer)

Every ticket branches from `sr/foundation` and its pull request goes into `sr/foundation`. Tonight the lane's lead (Opus) codes them, bundled into fewer pull requests by area.

| Bundle | Rows | Brief | Test home |
|---|---|---|---|
| F1 Guest Pay sheet opens ready to pay | S1, S14 | Empty bill → "Няма какво да се плати" / "Nothing to pay yet" + "Към менюто" / "Back to the menu"; opened from the bill's "Pay N" the whole bill is pre-ticked; the Tip row only when a tip can be set; the second step's button "Потвърди N" / "Confirm N". Template flow; D72, D127 | the face's pay tests; tap count in the guest pay e2e |
| F2 Guest service words | S5, S6, S10 (guest), S19 | "Selected" / "Избрано"; first call tile "Друго" / "Something else"; "Заявката е изпратена / Чакаме сервитьор да я потвърди." / "Request sent / Waiting for a waiter to confirm."; Ice its own icon; a cap trip says the order is over the phone limit and the waiter takes it (the reason must reach the phone); a separate call refusal | `packages/shell` strings tests |
| F3 Bill age label ticks | S7 | the age of the reading ticks on the phone, or resets on each reading; D121 | `apps/web/src/guest/services-client.test.ts` |
| F4 Bag and closed-table menu | S9, S17, S18, S19 (bell) | one bag line layout, no bands; a closed table shows the menu only (no Add, no bell) with "Тази маса не е отворена за поръчки от телефон. Попитайте сервитьор." / "This table isn't open for phone orders. Ask a waiter."; no empty line beside a sent card. Template flow | the face's contract tests; e2e: closed table → 0 Add buttons |
| F5 Tonight tables and sheets | S2, S3, S11, S16 | 390 px: section switch in the heading row, the repeated "Чака вас" heading goes; the drawer gets a 44 px "Затвори" / "Close"; the side sheet's X a 44 px hit area; section tabs, "Отвори страницата за гости" and menu items ≥ 44 px; a tile tap opens the sheet, which holds "Отвори за телефони" / "Open for phones" with Undo. D107, D123 | `apps/web/e2e/touch-targets.spec.ts` (Tonight at 390 and 1180×820); Tonight e2e |
| F6 Tonight says why | S4, S10 (waiter) | before opening, the Tables header and open sheets say "Поръчките от телефон започват в 22:00" / "Phone orders start at 22:00"; the cap alert names the amount and the limit | `pause-banners.test.tsx`; Tonight e2e |
| F7 End of night | S12, S13 | a "Приключи вечерта" / "End the night" button on the tab (the menu item and the tab's name stay, D122); the dialog body as lines with the report's words; after confirming, banner or alert, not both; "Отвори всички" and "Спри поръчките" disabled once the night is closed. D122, D138, D144 | Tonight e2e |
| F8 Log lines | S15, S20 | one row per order with its latest state, expanding to the steps; name the setting that changed; `table_freed` / `release_refused` rows name their reason | `apps/web/src/tonight/log-sentence.test.ts` |
| F9 Tonight server actions | C1, C6 | push subscribe and revoke run as the device's account; one shared `scopeOf` / `answer` | `apps/web/src/server/tonight` tests |
| F10 Guest limits and client | C2, C3, C5 | a refused Pay gives back `payGap` and `pays` (closes RR-O27); a 429 or other non-5xx answer calls `answered()`; a guest event's service day from its own time, no sitting for events older than the sitting | core pay / guest-events tests; `services-client.test.ts` |
| F11 Worker tick isolation | C4 | each pass and each organisation's listing in its own try with a log line; `waiter-call-lapse.ts` too | `apps/worker/tests/order-tidy.test.ts` |
| F12 PIN guard (Blocking) | X1 | a correct PIN clears only the trip escalation, never the window's wrong PINs; a per-organisation wrong-PIN limit; a logged count of wrong PINs per device. Stop and ask if a shared counter needs a schema change | `packages/core/src/pin-guard.test.ts`; `identify` test (4 wrong + 1 right, repeated, still trips) |

Polish rows (S9, C5, C6) sit inside F4, F10 and F9; there is no separate Polish table.

## Works

- Guest menu header at 390 px: every header control, tab and add button is 44 px or more.
- Guest bag: adding items, the "−/+" steppers, "Remove" with an inline "Undo", and a total.
- Guest Send of €110: "Sending…" then "Added to your bill" with a "Show this to your waiter" card; the sent order showed on Tonight within seconds as V96, "Добавена".
- Call a waiter: one tap to choose, "Изпрати" enables only once a reason is chosen, no local success (D72), and the call reached Tonight within seconds.
- Bill sheet: the empty state reads "Все още няма нищо в сметката"; with a line it lists the item and the amount left to pay.
- Pay and Receipt: "Processing your payment…" then "Paid" with payment number HC7M7 and "Show this number to your waiter. Your waiter brings your receipt."; the "Payment confirmation" page says "This is not your receipt." and offers "Save".
- Tonight "Действия и маси": alert rows carry their answers ("Обслужено", "Занесена"); the receipt alert is written for a waiter; the 76-table grid has a state word on every tile; toasts carry "Върни" (Undo).
- Tonight "Поръчки": the sent-order row and sheet show the steps, the time, the POS bill number and who did each step.
- Tonight "Дневник": rows carry time, actor and table, with "Вид", search, date picker and "Изтегли".
- Tonight "Край на вечерта": figures laid out in sections; the confirmation buttons are named for the action and the way out.

## Could not see

- The waiter PIN sheet, the shared-device sign-in and the manager-PIN steps: they need a staff-only device account signed in, and the explorer neither signed out nor typed a password.
- Tonight's Sent orders, Log and End of night at 390 px (walked at 1180 only).
- The guest receipt and the Bill in Bulgarian with real lines.
- The refund and "Not served" paths (PR #451, notes only).
- Contrast, 200 % zoom and 320 px on Tonight.
- Whether the ice call's disappearance from the alert list at about 15 minutes was an expiry or a cleanup.
- "Нови гости" and "Затвори всички…" were not tapped.
- `device`: one-handed reach of the bottom bar, glare in a dark room, the keyboard over a PIN, a screen reader, a real slow connection (Martin's phone).
- Dev-only, not findings: the Next dev badge overlaps the guest's bottom bar; first Tonight loads took about 15 s; one 500 on each first load after the database restart.
