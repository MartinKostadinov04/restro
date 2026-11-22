# Screen round 2026-11-18 · lane 4 · Reservations: findings

Ledger for lane 4 of the 11-18 round (D146, `docs/reviews/2026-11-18-screen-round/round-brief.md`). Commit walked: `1ae48918` on `sr/foundation`. Personas: manager (1280 and 390 px), door host (phone, 390 px). Open issues already filed in this area: #425, #426, #427.

Explorer: Sonnet subagent (screen-review step 2). The first explorer pass stopped part-way when the shared Postgres went into recovery; its rows are below as returned, and the pass resumes from Plan.

## Explorer rows

### S1. On the night list a row says "5 гости · 9" and nothing says that 9 is a spot
- Kind: simplification
- Screen: `?tab=reservations`, manager, 1280, light, bg
- Steps: open the night list and read a seated or upcoming row ("8 гости · 1", "6 гости · 2", "4 гости · 70").
- Expected: a hostess reads where the party sits without learning a code; the glossary's word is "Spot" and `operational-screens.md` screen-read Q2/Q3 asks for a readable state at a glance.
- Saw: a bare number after the party size. The sheet repeats it as "Места 9", and Change tables shows the same spot as "9 · Настанени · 13:45". A walk-in or waiting row shows no number, so the gap is not explained. The row never says "spot".
- Check: `operational-screens.md` screen read 2 and 3; GLOSSARY "Spot".
- Evidence: S1-before.jpg (800 px crop of the list)
- Proposal: "5 гости · маса 9" (BG) / "5 guests · spot 9" (EN), using the spot's kind word where known.
- Reviewer: the row joins the spot names bare (`reservation-row.tsx` `parts`). Use «място 9» / "spot 9", not «маса»: spots include stools and standing places.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «5 гости · място 9» on the list (S1-after.jpg). The guest card still shows a bare spot: R8.
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: yes · Fix: B1

### S2. The row's "…" menu is missing on waiting and cancelled rows, so the row layout shifts
- Kind: simplification
- Screen: `?tab=reservations`, manager, 1280, light, bg
- Steps: compare the rows "Стефан Колев", "Компания на бара" and "Петър Димов".
- Expected: "Same elements behave similarly" (`design-critique 4`). A row's secondary actions sit in "…" (Patterns: "The secondary actions of a row"), and the primary button stays in a fixed place.
- Saw: rows with an action have "Още за …"; waiting rows ("Дай място") and the cancelled row have none. Waiting rows therefore lack Cancel, Delete and Copy from the list, and the "Дай място" button sits at a different x than "Пристигнаха". The DOM exposes "Още за …" for 4 of 7 rows only. Whether a waiting party can be cancelled or deleted at all is not obvious (not tested).
- Check: `design-critique 4`; Patterns row "secondary actions of a row".
- Evidence: S1-before.jpg
- Proposal: show "…" on every row, or on none, and keep the primary button in one column.
- Reviewer: a row with nothing secondary has nothing to put in "…", and the pattern does not ask for an empty menu. The button column is solved by S16's restack, which reserves the "…" slot. A waiting party leaving is handled from its sheet (D137).
- Status: rejected

### S3. The same word «Гости» names three different things in one flow
- Kind: simplification
- Screen: `?tab=reservations`, reservation sheet, manager, 1280, light, bg
- Steps: open any reservation; compare the tab "Гости", the sheet's row "Гости 5 гости" and the sheet's first (dark) button "Гости".
- Expected: "One word per concept" (`GLOSSARY.md`; `copy-rules` rule 8). The tab is the venue's guest list, the row is the party size, the button opens "Колко дойдоха?" (set how many arrived).
- Saw: the button's dark primary weight sits on the least explained action. The dialog shows "Гости" again as the field label. Beside it, "…" holds "Картата на госта", a second entry for the guest list.
- Check: `ux-copy` principle 3; `copy-rules` rule 8.
- Evidence: sheet text and dialog text read in the DOM at 1280 (screenshot cropped)
- Proposal: button «Колко дойдоха» / "How many came" or «Брой гости»; keep "Гости" for the guest list only.
- Reviewer: for a seated party the sheet's primary button is `d_guests` «Гости» (`reservation-sheet.tsx:485-495`) and opens «Колко дойдоха?». Rename to «Брой гости» / "Guest count".
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «Брой гости» (S3-after.jpg).
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: yes · Fix: B1

### S4. The sheet's close "X" is 16 × 16 px
- Kind: bug
- Screen: `?tab=reservations`, reservation sheet, manager, 1280, light, bg
- Steps: open a reservation; measure the corner close control.
- Expected: 44 px floor (D123); on desktop shadcn keeps shared controls at 36 px. There is also a full-width "Затвори" at 48 px.
- Saw: the corner X measures 16 × 16 (the bottom "Затвори" is 351 × 48). Still to check on a 390 px phone.
- Check: Restro 44 px floor; WCAG 2.5.8 (24 px) would also fail.
- Evidence: DOM measurement of `[role=dialog] button`, 16×16
- Proposal: size the X through the shared `tap-area` class.
- Reviewer: the shared Sheet's X is `phone:size-11` (44 px) at phone width; at 390 the sheet is a Drawer with no X; at 1280 the 48 px «Затвори» is the equivalent control (WCAG 2.5.8). A shared `components/ui` change is not this lane's.
- Status: rejected

### S5. In Change tables the spot list is sorted as text ("1, 10, 101, 11 … 2, 22") and "Избрани: 9" reads as spot 9
- Kind: bug
- Screen: `?tab=reservations`, Change tables dialog, manager, 1280, light, bg
- Steps: reservation sheet, "Смени масите"; read the list under the map and the foot.
- Expected: a hostess finds a spot by number in natural order (D134: spot names are venue data; screen read Q3 "one reading order"). The foot says how many are selected.
- Saw: about 130 spots in plain string order: "0" first, "Бар 1 · стол 1" mixed into the same list, "101" before "11", then "25.1", "40/41", "53 А". The foot reads «Избрани: 9» while the party holds spot 9; it is the count of spots, not the spot name.
- Check: `operational-screens.md` screen read 3; `design-critique 2`.
- Evidence: dialog text read in the DOM (the spot list and "Избрани: 9")
- Proposal: natural-order sort (numeric-aware) and the foot "1 място избрано" / "1 spot selected".
- Explorer's correction (host pass): «Избрани: 9» lists the selected spots' names, not a count; the fault is a bare number with no word.
- Reviewer: `plan-read.ts:501` sorts with `orderBy(asc(spots.name))`, text order. «Избрани: 9» is the label plus names, with no noun.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: spots in number order 0…101, then the bar stools (S5-after.jpg). «Избрани места: 3» still reads as a count: R9.
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B2

### S6. The menu item "Освободи" does not say what it frees
- Kind: simplification
- Screen: `?tab=reservations`, "…" of a seated party, manager, 1280, light, bg
- Steps: open the sheet of a seated party, "Още".
- Expected: an action names its object; `copy-rules` rules 2/3 (a CTA says the action) and rule 11 for a write with a consequence.
- Saw: «Освободи» sits between "Копирай в друга вечер" and "Изтрий резервацията…". Not pressed, so what it does (end the sitting, free the table, release the hold) is unknown. A hostess working one-handed at 03:00 cannot tell it from Cancel.
- Check: `copy-rules` rules 2-3; GLOSSARY (Seated / Finished).
- Evidence: menu items read in the DOM: "Картата на госта | Копирай в друга вечер | Освободи | Изтрий резервацията…"
- Proposal: «Освободи масата (край на сядането)» / "Free the table (finish)"; the reviewer to press it and confirm what it does.
- Reviewer: `d_free` «Освободи» has no object; per D137 it frees the spots and closes the codes. Rename to «Тръгнаха си» / "They left", mirroring «Пристигнаха».
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: the menu named the action, with one toast and Undo (S6-after.jpg). Its label «Тръгнаха си» claimed the party left, which freeing does not do (R4); renamed «Освободи масата» in #478.
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: yes · Fix: B1

### S7. On the Plan the spots show only a symbol, with no name or number, and the plan sits below four rows of controls
- Kind: simplification
- Screen: `?tab=reservations&view=plan`, manager, 800 (narrow layout), light and dark, bg
- Steps: open Plan and scroll to the drawing at "Show whole plan".
- Expected: "What is here" readable at a glance (screen read 3); a hostess finds spot 9 or "Ivan's table". A state is "a word" (admin-map Plan row).
- Saw: at fit zoom about 130 tiny glyphs with no label; the state shows only as a symbol or outline; the drawing starts about 660 px down, after the view tabs, night button, legend, five filter chips, zoom buttons and a hint sentence. Dark theme is fine.
- Check: `operational-screens.md` screen read 3 and 4; WCAG 1.4.1 (state by symbol only at fit zoom).
- Evidence: S7-before.jpg
- Proposal: label the spots at the zoom where they fit, or open at a zoom where names fit; fold the hint sentence into a "?"; «Покажи целия план» stays.
- Reviewer: at 390 spot buttons are 8–19 px with the name only in the aria-label; the keyboard hint shows on a touch phone. Correction: WCAG 1.4.1 does not fail (the state is a shape, not colour alone).
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: the keyboard hint shows only with a mouse, but spot names clip at middle zoom (S7-after.jpg): R5.
- Status: fixed (partly; the rest is R5) · Severity: Before the pilot · Effort: M · Decision: none · Needs Martin's yes: yes · Fix: B2

### S8. At 390 px not one booking is visible on the night list's first screen
- Kind: optimisation
- Screen: `?tab=reservations`, manager (the host sees the same page), 390, light, bg
- Steps: open Reservations at 390×844; the first row's top is at y = 835.
- Expected: one-handed door use; the list is the job (screen read 1 and 2).
- Saw: before the first row: venue name, slug, "Open guest page", a Select for the tab, the view tabs, the title, two buttons, the day button, the date field, six chips on three rows and the legend sentence. The view tabs also show a thick grey stripe at their right edge (a scroll cue, with arrow glyphs at 800 px).
- Check: screen read 1 and 2; `operational-screens.md` bar-tablet persona; design-critique 3.
- Evidence: S8-before.jpg (the first row at y 835 of an 844 px screen)
- Proposal: chips and "New reservation" / "Add to waiting list" in one compact row; hide the venue header and guest-page link on this tab at phone width (the header part: navigation → lane 6); keep the legend behind the "Late" chip.
- Reviewer: the grey stripe on the view switcher is probably Windows' classic scrollbars; check on a phone.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: the first row moved up from y 835 to about 605 at 390 px (S8-after.jpg). The venue-header part is lane 6's.
- Status: re-verified · Severity: Before the pilot · Effort: M · Decision: none · Needs Martin's yes: yes · Fix: B1 (in-tab part); venue header part: navigation → lane 6

### S9. The Block dialog and the spot sheet name a bare spot number, a missing reason says nothing, and the refusal is gendered wrong
- Kind: bug
- Screen: `?tab=reservations&view=plan`, spot sheet → Block…, manager, 800, light, bg
- Steps: tap spot "1", "Блокирай…", tap "Блокирай мястото" with no reason; then pick "ремонт" and block (spot 1 is booked by a late party).
- Expected: the title names the object; a refusal names the party and the hour (D137); a missing field is named (WCAG 3.3.1); the verb agrees with the guest.
- Saw: title «Да блокираме ли 1?», sheet title «1». Without a reason nothing happens and nothing is said. The refusal toast reads «Стефан Колев е резервирала 1 за 14:00. Първо я премести.»: feminine verb and pronoun for a male guest, and a bare "1".
- Check: WCAG 3.3.1; `copy-rules` rules 4 and 8; D137.
- Evidence: S9-before.jpg (the dialog), toast text from the DOM
- Proposal: «Да блокираме ли място 1?» / "Block spot 1?"; «Избери причина» beside the reason chips; neutral toast «Мястото е резервирано от Стефан Колев за 14:00. Първо премести компанията.» / "Spot 1 is booked by Stefan Kolev for 14:00. Move the party first."
- Reviewer: `p_block_t` names a bare number; the block button is disabled until a reason is picked (`block-dialog.tsx:121`), which Patterns forbids; `p_taken` / `d_taken` hard-code the feminine.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «Да блокираме ли място 1?» and a toast naming the next party (S9-after.jpg).
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B2

### S10. The word «места» means both spots and seats
- Kind: simplification
- Screen: reservation sheet, spot sheet, spot editor, kinds list, manager, 800 and 1280, bg
- Steps: compare the reservation sheet's «Места 9» (the spot), the spot sheet's «Места 6» (seats), the editor's «Брой места» (seats) and the kind row «за 4 · 60 места» (60 spots).
- Expected: one word per concept (`copy-rules` 8; GLOSSARY: Spot, seats).
- Saw: the same word names the spot a party holds, the seats a spot has, and how many spots a kind has.
- Check: `copy-rules` rule 8; GLOSSARY "Spot".
- Evidence: texts read in the DOM; S9-before.jpg shows the spot sheet behind the dialog
- Proposal: spot = «място», seats = «седящи»: «Седящи 6», «за 4 души · 60 места».
- Reviewer: `sh_spots` «Места» and `p_seats` «Места» share one word; EN already separates Spots / Seats.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «Седящи 4», «Брой седящи» (S10-after.jpg). The seat-count error still says «места»: R8.
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B2

### S11. Hard-coded masculine verbs on the guest card
- Kind: bug
- Screen: Guests → guest sheet, manager, 800, light, bg
- Steps: add a regular (any name), read the sheet.
- Expected: Bulgarian written for a Bulgarian reader (`copy-rules` rule 9).
- Saw: «Идвал нито веднъж, не е пропускал нито веднъж, в твоя клуб.» is masculine for every guest (S9's toast is feminine for a man).
- Check: `copy-rules` rule 9.
- Evidence: guest sheet text read in the DOM
- Proposal: «Идвания: 0 · Неидвания: 0 (в твоя клуб)» / "Came 0 times, did not come 0 times at your club."
- Reviewer: `g_counts` is masculine for every guest.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «Идвания: 1 · Неявявания: 0 (в този клуб)» (S11-after.jpg).
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B1

### S12. Walk-in and waiting parties appear on Guests as people with a phone
- Kind: bug
- Screen: `?tab=reservations&view=guests`, manager, 800, light, bg
- Steps: open Guests on a fresh seed.
- Expected: a guest list is of people; D140: a guest record is keyed by his phone.
- Saw: «Двама на вратата» and «Компания на бара» sit in the list of 7 with a number, next to real names, each with the same-weight «Архивирай».
- Check: D140; screen read 3.
- Evidence: S12-before.jpg
- Proposal: confirm whether the seed or the waiting form creates the record; a party with no name should not become a guest record.
- Reviewer: follows D140: `findParty` makes a guest record from any phone given (`book.ts:300-332`). The odd names are the seed's (`demo-club.ts:486-487`): a seed observation, not a screen fault.
- Status: rejected

### S13. Settings › Reservations: the spot kinds sit far down, after a ~130-button spot list, and the plan editor has no zoom
- Kind: simplification
- Screen: `?tab=settings&section=reservations`, manager, 800, light, bg
- Steps: scroll the section; open "Ново място"; open a spot.
- Expected: the section's jobs findable in one reading order (screen read 3); "Spot kinds" is a named job of the editor (admin-map).
- Saw: "Видове места" ("Нов вид") comes after roughly 260 lines of spot buttons (the keyboard list, repeating the canvas); the canvas has no zoom control and its labels are unreadable at 800 px. "Ново място" is a Select for four options where a segmented control is the pattern; the spot editor's dismiss «Готово» sits next to «Махни мястото».
- Check: `operational-screens.md` Patterns (pick one of a few); screen read 3; WCAG 2.1.1 (keyboard walk through ~130 buttons).
- Evidence: texts read in the DOM (canvas screenshot not saved)
- Proposal: collapse the spot list into one control; move kinds above it.
- Reviewer: at 390 «Видове места» starts at y 7456 of 7829 px; `plan-editor/*` has no zoom while the shared `plan-zoom.ts` exists.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: the plan editor has zoom − / +, and the long spot list is folded (S13-after.jpg). Its «Покажи целия план» is off-centre at 800 px: R7.
- Status: re-verified · Severity: Before the pilot · Effort: M · Decision: none · Needs Martin's yes: yes · Fix: B2

### S14. Settings: a successful write says only «Запазено», and the hold field keeps an invalid value
- Kind: simplification
- Screen: `?tab=settings&section=reservations`, manager, 800, light, bg
- Steps: turn off "Телефонът е задължителен"; type 0 in the hold minutes.
- Expected: "what happened" in the owner's words (feedback 1).
- Saw: toast «Запазено · Отмяна» says nothing of what was saved; the hold field keeps "0" after its error. The "Add a closed date" and kind dialogs use shared 36 px buttons at 800 px.
- Check: `operational-screens.md` feedback 1.
- Evidence: toast text from the DOM
- Proposal: «Телефонът вече не е задължителен» / "Phone is no longer required".
- Reviewer: `st_saved` / `pe_spot_saved` «Запазено» confirmed. The hold-field part is rejected: keeping a typed invalid value beside its error is standard form behaviour.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «Телефонът вече не е задължителен. | Отмяна» (S14-after.jpg).
- Status: re-verified · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B2

### S15. Mixed forms of address in Bulgarian
- Kind: simplification
- Screen: Reservations › New reservation, manager, 390, light, bg
- Steps: type an invalid date in the new reservation form.
- Expected: one voice (`copy-rules` rules 8 and 9).
- Saw: «Въведете дата като ден.месец.година» (formal plural) while the rest says «Избери», «можеш».
- Check: `copy-rules` rule 9.
- Evidence: dialog text from the DOM
- Proposal: «Въведи дата като ден.месец.година, например 10.11.2026.»
- Reviewer: the fix goes the other way. The app's voice is formal (about 75 formal forms against 20 informal); the outliers are the informal reservation strings `bk_w_closed`, `bk_w_before`, `g_counts`, `g_mine_hint`, `g_mine_saved`, `pe_seats_bad`.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «Все пак можете да резервирате.» (S15-after.jpg). The cancel dialog is still informal: R8.
- Status: re-verified · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B1

### S16. At 390 px the booking row squeezes the name to one letter per line
- Kind: bug
- Screen: `?tab=reservations`, door host, 390 (also 320), light and dark, bg and en
- Steps: open the list; look at "Иван Петров" (badge, chevron, "…" and «Пристигнаха» on the row).
- Expected: the name is the first thing a host reads (screen read 1 and 4); WCAG 1.4.10 at 320 px.
- Saw: at 390 «Иван Петров» wraps letter by letter and «Двама на вратата» takes five lines. At 320 the name column is 65 px wide and «Мария Георгиева» makes a row 562 px high. At 200 % text (html font-size 200 %, 390 px) the page is 397 px wide (horizontal scroll) and 8 rows take 8,500 px. At 390 the "…" sits in a separate column from the primary button.
- Check: WCAG 1.4.10 and 1.4.4; screen read 1 and 3; `design-critique 3`.
- Evidence: S16-before.jpg; row heights from the DOM at 320 (114 px to 562 px); scrollWidth 397 at 200 %
- Proposal: stack the row at phone width: name and party on line one, badge on line two, the primary button full width under them, "…" in the corner; give the name a minimum width and let the badge wrap.
- Reviewer (also found blind): `[overflow-wrap:anywhere]` on a `min-w-0 flex-1` name column beside the badge column, chevron, action button and 44 px "…" (`reservation-row.tsx`).
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: no sideways scroll at 320 px; the name keeps its line (S16-after.jpg).
- Status: re-verified · Severity: Before the pilot · Effort: M · Decision: none · Needs Martin's yes: yes · Fix: B1

### S17. Plan and Change tables at 390 px: tiles are about 14 px with no name, so a host cannot pick a spot by thumb
- Kind: bug
- Screen: `?tab=reservations&view=plan` and "Смени масите", door host, 390, light, bg
- Steps: open Plan; tap a free spot for a walk-in; or open Change tables and pick a spot on the map.
- Expected: Restro 44 px floor; D134 (spots have names); one-handed use at the door.
- Saw: at fit zoom the tiles are about 14 px glyphs with no number; in Change tables the spot buttons are 10 to 19 px high. Zooming means "+" or pinch, then finding the spot among about 130. The "from the list" way in "Дай място" works and its rows are tall, so the list is the usable path.
- Check: Restro 44 px floor; `operational-screens.md` bar-tablet targets; WCAG 2.5.8 (24 px).
- Evidence: S17-before.jpg (Plan at 390); DOM: spot buttons 10 to 19 px high
- Proposal: on a phone open Change tables on the list (as the waiting-list dialog does), with search by number; give plan spots a larger hit area.
- Reviewer (also found blind): spot buttons 8–19 px at 390; the same `SpotPlan` is used in Change tables and Give a spot.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: the phone Plan's spots are 86 px and labelled (S17-after.jpg). It opens too far in: R6.
- Status: re-verified · Severity: Before the pilot · Effort: M · Decision: none · Needs Martin's yes: yes · Fix: B2

### S18. After Change tables then Arrive, the sheet tells the host «Ния промени тази резервация» (her own name)
- Kind: bug
- Screen: reservation sheet, door host, 390, light, bg
- Steps: open «Иван Петров», "Смени масите" (a free spot), Save, then "Пристигнаха" in the same sheet.
- Expected: a stale-edit notice names somebody else; a write answers once (Patterns "What happened after a write").
- Saw: «Ния промени тази резервация. Показваме текущата версия.» above the state, while the account itself is Ния (the host). At the same moment 3 toasts stand: «Масата е отворена за телефони.», «Настанихме Иван Петров.» (Върни), «Масите са сменени.» (Върни).
- Check: `operational-screens.md` feedback 1; Patterns "What happened after a write".
- Evidence: sheet text and toast text read in the DOM
- Proposal: no conflict notice when the writer is the current user; merge the arrival and table toasts into one.
- Reviewer: `reservation-sheet.tsx:379` sets `changedBy` for any newer history line, the person's own included. The three toasts come from `door-actions.tsx:205-208`.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: as door host, Change tables then Arrive gives one toast with Undo and no «Ния промени…» notice (S18-after.jpg).
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B1

### S19. In "Дай място" a checkbox tap seats the party at once, with no confirm
- Kind: bug
- Screen: «Дай място» → «Избери от списъка», door host, 390, light, bg
- Steps: tap the checkbox of a free spot in the list.
- Expected: a checkbox selects and a button confirms; D137's one tap is for arriving, and the picked spot opens the table's menu.
- Saw: the tap closes the dialog; toasts «Настанихме Компания на бара на 101.» and «Масата е отворена за телефони.». An accidental tap while scrolling 118 rows seats a party; the only undo is the toast. The list is sorted as text (0, 1, 10, 101, 11).
- Check: `operational-screens.md` Patterns ("Pick one of a few", a write with a consequence); WCAG 3.2.2 (on input).
- Evidence: toast text in the DOM; the unsorted list in the dialog
- Proposal: radio-style rows with a «Настани тук» / "Seat here" button; natural sort (as S5).
- Reviewer: seating on tap is deliberate (#330, Patterns "A choice that is also the action"). The fault is that the control is a `Checkbox` (`spot-picker.tsx:159`) acting on input (WCAG 3.2.2), plus text order. Fix: each row a button «Настани на {spot}», still one tap with Undo.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: each row is one 61 px «Настани на място N» button (S19-after.jpg).
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: yes · Fix: B2

### S20. The host sees no Cancel, Edit or Delete, and a sentence says why in a way D135 contradicts
- Kind: bug
- Screen: reservation sheet and the row's "…", door host, 390, light, bg
- Steps: open «Иван Петров» or «Мария Георгиева» (taken by the owner); read the sheet; open "…".
- Expected: D135: anyone with the reservations permission cancels, edits and seats a booking whoever made it; only deleting someone else's booking and restoring stay the manager's.
- Saw: «Само който управлява резервациите може да променя или отказва такава.»; the menu holds only «Картата на госта», «Копирай в друга вечер», «Не се яви»: no Edit, no Cancel, no Delete. Same style on the pay rule («Само който задава правилото за плащане, може да го променя.») and the spot sheet («Само управител пази място от резервиране.»).
- Check: D135 "who may work a booking"; D141.
- Evidence: sentence and menu items read in the DOM at 390; the manager pass saw "Редактирай" in the sheet
- Proposal: check whether the seeded host role lacks the permission or the screen hides it; if the role is meant to have it, show Edit and Cancel; otherwise say who («Поискай от управителя»).
- Reviewer: `reservation.edit` / `reservation.cancel` require `reservations.manage` (`commands.ts:373, 384`); the seeded host has the default `staff` role. D135 (Martin, log 13.18, 11-07) says the host on duty edits and cancels a colleague's booking; D141's lead's-call list puts edit and cancel under managing bookings.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: as door host, Edit and Cancel worked on a colleague's booking; no Delete, and the sheet says only a manager deletes or restores (S20-after.jpg). Tests: `booking.test.ts`, `pin-fall.test.ts` (#479).
- Status: re-verified · Severity: Blocking · Effort: S · Decision: lead's call 11-19: follow D135 (Martin's 13.18); edit and cancel take `reservations.tonight` (PIN-class), deleting another's and Restore stay `reservations.manage`; that one line of D141's lead's calls is corrected in B3 · Needs Martin's yes: no (reported in the lead's morning report) · Fix: B3

### S21. Arrival, walk-in and free write several toasts, only some with Undo
- Kind: simplification
- Screen: list and spot sheet, door host, 390, light, bg and en
- Steps: press «Пристигнаха»; seat a walk-in; free a table; mark a no-show.
- Expected: one job, one voice (Patterns "What happened after a write").
- Saw: arrival: «Масата е отворена за телефони.» (no action) and «Настанихме Стефан Колев.» («Върни»); walk-in: «Масата е отворена за телефони.» and «Настанени.» (no object, no Undo); free: «Масата е свободна отново.» («Върни»). «Настанихме…» is first person plural; no-show says «Отбелязано като неявил се.» (masculine, as S11).
- Check: `operational-screens.md` feedback 1; `copy-rules` rule 8.
- Evidence: toast texts in the DOM
- Proposal: one toast per write with the object and Undo: «Стефан Колев е настанен. Масата е отворена.» / "Stefan is seated. The table is open."; walk-in «Настанена компания на 0.» / "Party seated at 0."
- Reviewer: each write stacks `d_open` (no action) with the seat toast; `d_seated_walk_in` «Настанени.» names nothing; `bk_noshow_done` is masculine.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: walk-in, free and no-show each give one toast with Undo (S21-after.jpg).
- Status: re-verified · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B1

### S22. The swap dialog, the row menu and dialog chips at 390 px are 42 px, and the grammar is «с Стефан»
- Kind: bug
- Screen: Change tables swap dialog, row menu, spot list, door host, 390, light, bg
- Steps: in Change tables pick a spot held by another party.
- Expected: Restro 44 px floor; Bulgarian grammar.
- Saw: «Да разменим ли с Стефан Колев?» (should be «със Стефан»); «Не разменяй» and «Размени с Стефан Колев» are 42 px; the row menu items and the filter chips in the waiting-list and copy dialogs are 42 px. The sentence does not say which table each party gets.
- Check: Restro 44 px floor; `copy-rules` rule 9.
- Evidence: S22-before.jpg; DOM heights
- Proposal: «Да сменим ли местата със Стефан Колев? Иван Петров ще седне на 1, Стефан Колев на 10.»; menu items and chips to 44 px.
- Reviewer: `ct_swap_t` / `ct_swap_do` «с {party}». The 42 px part is rejected: the row-menu item measured 44 px (`min-h-11`), kind chips have `min-h-11`, confirm buttons use `WRAPS`.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: at 390 px the swap names both parties and spots, buttons 44 px, «със» (S22-after.jpg).
- Status: re-verified · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B2

### S23. «Тази вечер» is used for any night, and a past night says «Още няма резервации»
- Kind: simplification
- Screen: list on 18.11 and 21.11, door host, 390, light, bg
- Steps: type 18.11.2026, then 21.11.2026 in the date field.
- Expected: the title names the night; a past night says what it is.
- Saw: on a past night «Тази вечер е минала. Може да се чете, но не и да се променя.» (while "Тази вечер" is also the button for today); the empty state «Още няма резервации за тази вечер.» on 18.11, where nothing can come. A past night's chips offer only «Всички 0».
- Check: `copy-rules` rule 5; `operational-screens.md` screen read 2.
- Evidence: S23-before.jpg
- Proposal: «18 ноември е минала. Може да се чете, но не и да се променя.»; empty «Няма резервации за 18 ноември.»
- Reviewer: `b_passed*` and `empty` say «тази вечер» for any date.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «Вечерта на 18 ноември е минала…» (S23-after.jpg).
- Status: re-verified · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B1

### S24. EN uses different words for the same states, and a seated waiting party reads «Walk-in»
- Kind: simplification
- Screen: list, door host, 390, light, en
- Steps: switch to English and read the list.
- Expected: D135 states (Reserved, Waiting, Seated) and GLOSSARY.
- Saw: «Coming» for a reserved booking; a waiting party seated on 101 is labelled «Walk-in» though it came from the waiting list; the unnamed party's aria label is «Още за Без име».
- Check: GLOSSARY "Walk-in", "Waiting list"; D135.
- Evidence: list text read in the DOM in EN
- Proposal: «Reserved» for the state; a «From the waiting list» badge for a seated waiting party.
- Reviewer: «Coming» translates the designed badge «Предстояща» (`2026-11-10-reservations-screens.md` §words); D135's Reserved is the stored status. A party seated from the waiting list had no reservation, so it is a walk-in by GLOSSARY. «Още за Без име» is right for an unnamed party.
- Status: rejected

## Works
- Night list: the per-state chips with counts, the "Закъснява" word and its legend line, and "Пристигнаха" as one visible primary button per upcoming row.
- Reservation sheet: the history names who did what, the phone is a call link, "Затвори" is 48 px.
- "…" menu targets are 44 px.

- Door host: Arrive is one tap from the list (two from a sheet); «Дай място» → «Избери от списъка» has search and rows with kind, seats and state; Change tables works and the swap names the party; a walk-in is two taps from a plan tile with no name asked; no-show is two taps with a working «Върни»; «Освободи» frees a walk-in's table in one tap with Undo; a past night is read-only with a banner; a future night offers both buttons; dark theme readable at 320 px; no console errors.
- Taps per story (host, 390 px): arrive 1 (list) / 2 (sheet); arrive on another spot 6 (row, Change tables, new spot, old spot off, Save, Arrive) against D137 13.7's "one gesture"; give a waiting party a spot 3; walk-in 2; no-show 2; copy 3 to the form.

## Could not see
- A booking's Cancel and Delete refusal for the host (the host gets no such control, S20); a PIN prompt (the host signs in as herself); Copy to another night to the end; the night's end view; Plan, Guests and Settings at 390 px for the manager.
- 200 % text zoom was emulated with `html { font-size: 200% }` at 390 px, not a browser zoom; the language was switched by the NEXT_LOCALE cookie.
- Device lines for Martin: one-handed reach at the door, glare in a dark room, the keyboard over the booking form's fields, a screen reader.

## Code check rows (Opus, `code-review high` on the lane's paths)

The skill run returned 9 findings; 7 confirmed below. Dropped as unreachable from any screen: a block edit leaving old held rows unreleased (`tonight.ts:427-441`, no screen sends `block.save` with a `reservationId`), and the booking form's taken-check with `turnMinutes: null` (`booking-checks.ts:266`).

### C1. Two people can book the same spot at the same time on any night that has no night record yet
- Kind: bug
- Screen: `?tab=reservations` (booking form, block, walk-in), code
- Steps: two staff save a booking on T1 22:00 for a future night at the same moment; neither night has a `reservation_nights` row (written only at the close or an early end, `night.ts:177`).
- Expected: one accepted, the other refused `spot_taken`; `claimSpots` "keeps the overlap rule" (`book.ts:85-95`).
- Saw: `openNight` → `lockNight` runs `SELECT … FOR UPDATE` on a row that does not exist, so it locks nothing (`rows.ts:166-183`); `heldSpotsOfNight` reads unlocked under read committed (`rows.ts:275-332`). Both see no clash and both insert, so T1 is double-booked. No exclusion constraint on `reservation_spots` (0046, 0049).
- Check: code-review (high); the overlap rule (D135 turn time, D137)
- Evidence: `rows.ts:166-183`, `rows.ts:409-415`, `book.ts:405-418`
- Proposal: `pg_advisory_xact_lock` on venue + service date in `openNight` (or upsert the night row before locking it).
- Reviewer: `lockNight` selects `FOR UPDATE` on a row that may not exist (`rows.ts:165-182`); `stx.rows.claim` only checks lock order. Share one advisory-lock helper on venue and service date with #425.
- Re-check: a database test in #479: `booking.test.ts`. Not walkable; the walker checked the tests exist.
- Status: fixed · Severity: Blocking · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B3

### C2. A block with dates over several nights only works on its first night
- Kind: bug
- Screen: `?tab=reservations&view=plan` (Block, from/until), online and staff booking, code
- Steps: block T1 from 11-20 until 11-25 (stored `serviceDate=11-20`, `endsAt` = 11-26 07:00, `actions.ts:179-200`); book T1 for 11-22.
- Expected: refused; the block covers 11-22 (D137: "optional from and until dates").
- Saw: the earlier-nights query takes only blocks with `endsAt IS NULL` and `heldTo IS NULL` (`rows.ts:310-321`), so the dated block is invisible from 11-21; the booking is accepted. The plan read has the same filter (`plan-read.ts:339-344`), so T1 shows free.
- Check: code-review (high); D137
- Evidence: `rows.ts:310-321`, `plan-read.ts:339-344`
- Proposal: take earlier-night blocks whose `endsAt` is null or later than the asked night's start, in both reads.
- Reviewer: both reads need `endsAt IS NULL` (`rows.ts:310-321`, `plan-read.ts:337-347`); a blocked table takes bookings, online ones too.
- Re-check: a database test in #479: `booking.test.ts`, `overlap.test.ts`, `plan-state.test.ts`. Not walkable; the walker checked the tests exist.
- Status: fixed · Severity: Blocking · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B3

### C3. A block cannot be lifted once the night it was made on has passed
- Kind: bug
- Screen: `?tab=reservations&view=plan` (Unblock), code
- Steps: Monday, block T5 with no dates; Tuesday, Unblock. "Edit past nights" at its default, off (`0046_reservations.sql:101`).
- Expected: lifted; D137: a block stays "on until removed".
- Saw: `removeBlock` → `cancelReservation` → `openReservation` → `openNight(Monday)` → `nightWritable` returns `night_passed` (`tonight.ts:465-477`, `book.ts:657`, `rows.ts:393`). The block shows on every later night and nobody can lift it; the night close leaves blocks untouched (`night.ts:6`).
- Check: code-review (high); D137
- Evidence: `tonight.ts:472`, `book.ts:657-659`, `rows.ts:388-394`
- Proposal: for `block.remove`, check writability against today's night, not the block's start night.
- Reviewer: `removeBlock` → `cancelReservation` → `openNight(block's own date)` → `night_passed` (`tonight.ts:465-476`, `book.ts:657`).
- Re-check: a database test in #479: `booking.test.ts` (three). Not walkable; the walker checked the tests exist.
- Status: fixed · Severity: Blocking · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B3

### C4. Restoring a deleted booking claims every spot it has ever held
- Kind: bug
- Screen: `?tab=reservations` (Restore after Delete), code
- Steps: book on T1, edit to T2 (T1 released), delete, Restore.
- Expected: it comes back on T2 only, if T2 is still free.
- Saw: reads every `reservation_spots` row of the booking with no `released_at` filter (`book.ts:763-767`); claims T1 and T2, and if either is taken now the all-or-nothing claim loses both.
- Check: code-review (high)
- Evidence: `book.ts:763-786`
- Proposal: restore only the spots the delete freed (released at the delete's instant, or its Log entry's `freed` list).
- Re-check: a database test in #479: `booking.test.ts`. Not walkable; the walker checked the tests exist.
- Status: fixed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B3

### C5. Undoing an arrival overwrites the booking's own reason with `arrival_undone`
- Kind: bug
- Screen: `?tab=reservations` (Undo after Arrived), code
- Steps: a booking with reason `birthday` is marked Arrived, Undo within 30 s.
- Expected: back to Reserved with its reason kept (D135; `BOOKING_REASONS`).
- Saw: `reason: UNDONE_ARRIVAL_REASON` is written for every outcome, `reserved` included (`arrive.ts:829`). Separately every spot is released (`arrive.ts:826`), so the Reserved booking loses its table; `door.test.ts:540` asserts that release, so it may be meant — to confirm.
- Check: code-review (high); D135
- Evidence: `arrive.ts:826-834`
- Proposal: write `arrival_undone` only when the result is Cancelled; keep `reservation.reason` otherwise.
- Reviewer: `door.test.ts:540` asserts that the undo releases every spot, so an undone arrival comes back Reserved with no table. Recommendation: re-claim the spots held before the arrival when free, as Restore does.
- Re-check: a database test in #479: `door.test.ts` (two, incl. "taken since"). Not walkable; the walker checked the tests exist.
- Status: fixed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B3

### C6. Editing a seated party's tables uses the booking rule, not the seating rule, and opens no table
- Kind: bug
- Screen: `?tab=reservations` booking form on a seated party, code
- Steps: party A sits at T4 past its turn time; edit seated party B with `spotIds: [T4]` (`saveBookingAction` → `reservation.edit`; `editReservation` refuses only end statuses, `book.ts:514`).
- Expected: refused, as Arrive and Change tables would (D137: "a party sitting there now keeps the table until it leaves"); a seated party's spot change runs the table work (#329).
- Saw: `claimSpots` without `seatingAt` (`book.ts:575-586`): A's hold counts as expired, the edit is accepted, two seated parties hold T4, and T4's code is not opened for B.
- Check: code-review (high); D137
- Evidence: `book.ts:514`, `book.ts:575-590`
- Proposal: refuse a spot change on a seated party in `editReservation` (send it through Change tables), or pass `seatingAt: stx.now`.
- Reviewer: the sheet offers Edit on a seated party (`mayEdit`, `reservation-sheet.tsx:407`), and `claimSpots` gets no `seatingAt` (`book.ts:575-586`).
- Re-check: a database test in #479: `change-tables.test.ts`. Not walkable; the walker checked the tests exist.
- Status: fixed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B3

### C7. Adding and removing a closed date at the same time loses one of the changes
- Kind: bug
- Screen: `?tab=settings&section=reservations` (closed dates), code
- Steps: two managers add 12-24 and 12-31 at the same moment (or one adds while another Undoes a removal).
- Expected: both dates end up in the list.
- Saw: `readSettings` has no `FOR UPDATE` (`rows.ts:207-213`); each command writes the whole list back from what it read (`closed-dates.ts:63-68`, `:85-91`), so the last commit wins.
- Check: code-review (high)
- Evidence: `closed-dates.ts:63-68`, `closed-dates.ts:85-91`
- Proposal: lock the settings row before reading, or a `jsonb` append/remove in one `UPDATE`.
- Re-check: a database test in #479: `settings-values.test.ts` (three). Not walkable; the walker checked the tests exist.
- Status: fixed · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B3

## Security check rows (Opus, `security-review` + `audit-security.md`)

`security-review` traced all 30 server actions (`actions.ts`, `reservations-actions.ts`, `plan-actions.ts`), the loaders, the core service and the four migrations: no High or Medium; its one lead (X1) scored 3/10 and was checked by hand. `audit-security.md` items 2–6 run statically plus read-only RLS queries as `restro_app` on `restro_lane4` (items 7 abuse and 8 report not run: read-only lane). `pnpm audit --prod`: 11 advisories (4 high in `undici`, moderate in `next`, `esbuild`), none in reservations code: a dependency ticket, not this lane.

**Passed:** permissions re-checked server-side in `executeCommand` (`engine.ts:157-245`) after strict Zod, `requireTenant` and `getVenue`; a PIN actor is refused `settings.*` (`engine.ts:158`) and erase / private notes / settings need the person's own fresh sign-in (D141); delete-another's, cancel, restore, put back and undo need `reservations.manage` (`book.ts:722`, D135); every write passes `openNight`/`nightWritable` (past nights need the switch plus `reservations.edit_past`); client ids resolved through venue-scoped helpers (`lockReservation`, `readSpot(s)`, `lockGuest`, `tablesOfSpots`, the engine's `tableId` check, the swap partner); all 9 reservation tables have RLS enabled and forced with `tenant_isolation`, `restro_app` has only SELECT/INSERT/UPDATE, no BYPASSRLS, no SECURITY DEFINER; Log entries carry ids, states, spots and times, never name/phone/email/note, `logError` only class/code/message, the only URL parameter is the opaque `?guest=gu_…`, `qrToken` reduced to `hasCode` (`plan-read.ts:555`); no `sql.raw` from input, the suggestion `ilike` escapes wildcards; plan drawing has no `dangerouslySetInnerHTML` and no stored SVG `d`/`points`/`href` (D134).

**Open question (not a finding):** an unattended shared tablet with no PIN session reads with Staff's `reservations.tonight`, so anyone at it can open Guests and read every name, phone and email. D141 puts the PIN on writes, so this looks intended; if not wanted, the guest list and card reads could require `grants.device !== true`. The comment at `book.ts:257-259` is stale (says guest-list access is settings-class; the code gates it on `reservations.tonight`, as #333 specifies).

### X1. The arrival check reads another venue's reservation by id (its pay rule leaks)
- Kind: bug
- Screen: `?tab=reservations` (seat or arrive, plan or list), security
- Steps: a user with `reservations.tonight` at venue A calls `arrivalChecksAction({ venueId: A, reservationId: "rv_<id from venue B, same organisation>" })`.
- Expected: every client-sent id is checked against the caller's venue before it is read (CLAUDE.md conventions; audit-security.md item 3). RLS isolates by `tenant_id` only, not between venues of one organisation.
- Saw: `packages/core/src/service/reservations/arrive-checks.ts:255-259` reads `reservationSpots` by `reservationId` only; `:268-272` reads `reservations.payRule` by `id` only; neither filters on `reserver.venue.id`.
- Check: security-review (3/10, below its bar) / audit-security.md item 3 (tenancy); D135 (pay rule)
- Evidence: the later lookups are venue-scoped (`tablesOfSpots`, `openTables`, `holdsOfNight` take `reader.venue.id`), so the other venue's spots resolve to nothing; what leaks is that party's pay rule, shown in the "same guests?" wording. Needs a known opaque `rv_` id. No contact data. Not reproduced live.
- Proposal: add `eq(reservations.venueId, reader.venue.id)` to the read and filter `reservationSpots` through the venue's reservations; one integration test with two venues in one organisation.
- Re-check: a database test in #479: `door.test.ts`. Not walkable; the walker checked the tests exist.
- Status: fixed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B3

## Reviewer (Opus, screen-review step 4)

Blind walk first (List, Plan, Guests, Settings › Reservations at 390 px as manager), then the ledger. Its blind findings that duplicate explorer rows are merged there (S16; S7, S17, S8). It reproduced S18–S24 from the code, the message files and the seeded roles (`apps/web/scripts/lib/demo-club.ts`) rather than signing in as the door host, and checked the C and X rows in the code. Verdicts: 30 of 35 confirmed, 5 rejected (S2, S4, S12, S24, and R3, a duplicate of S8).

### R1. On Guests, every row's only button is «Архивирай» (reviewer)
- Kind: simplification
- Screen: `?tab=reservations&view=guests`, manager, 390, light, bg
- Steps: open Guests and look at any row.
- Expected: a row's secondary actions sit under "…" and its main action is opening it (`operational-screens.md` Patterns: "The secondary actions of a row"), as on the night list.
- Saw: a full-weight outline «Архивирай» on every row, as heavy as the name, and no chevron. One job ("a list of records") is drawn two ways in one tab.
- Check: Patterns "The secondary actions of a row"; design-critique 4
- Evidence: `guests-view.tsx:266-278`; all 7 rows at 390
- Proposal: «Архивирай» / «Върни от архива» under a "…" per row, like `ReservationRow`, with the chevron; the archive keeps its undo toast.
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «Архивирай» sits under "…" (R1-after.jpg).
- Status: re-verified · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: yes · Fix: B1

### R2. Under "Всички", a waiting party shows a clock time in the booking-hour column (reviewer)
- Kind: simplification
- Screen: `?tab=reservations`, manager, 390, light, bg
- Steps: open the list on "Всички" and read «15:09 Компания на бара 4 гости Чака място».
- Expected: the hour column means "expected at" for every row (screen read 3).
- Saw: for a waiting party, 15:09 is when it was added; it reads like a booking for 15:09.
- Check: `operational-screens.md` screen read 3
- Evidence: list text at 390 (DOM)
- Proposal: a waiting row shows «от 15:09» / "since 15:09".
- Re-check: Opus re-check walker, stacked tip `ac1b42ae`: «от 18:54» (R2-after.jpg).
- Status: re-verified · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: yes · Fix: B1

## Re-check (Opus, a session that wrote none of the fixes)

Walked on the stacked tip of #483 (`ac1b42ae`: #479, then #478, then #483) on `restro_lane4`, freshly seeded, as manager (1280, 800, 390 px) and as the door host Ния (390 px). 21 rows re-verified, S7 partly; C1–C7 and X1 each have a test in #479. Six new rows:

### R4. «Тръгнаха си» only frees the spots, and the party stays «Настанена» with none (re-check)
- Kind: bug
- Screen: `?tab=reservations`, door host, 390, light, bg
- Steps: on a seated party, "…" → «Тръгнаха си».
- Expected: the action does what its label says. Freeing returns the spots and does not end the party (D134 "staff may free them earlier"; `releaseReservationSpots` in `arrive.ts`), so the label must not say the party left.
- Saw: the party stays «Настанена» with no spot on the list, the guest card and «Настанени 1», and "…" still offers «Тръгнаха си».
- Check: D134, D137 1.48
- Evidence: walker's DOM read at 390
- Proposal: name the action for what it does, «Освободи масата» / "Free the table"; the toast «Масата на {party} е свободна отново.»; offer it only while the party holds a spot.
- Status: fixed (in #478, commit `feca5786`; unit test `reservation-sheet.test.tsx`; not re-walked) · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: B1

### R5. At middle zoom a tile shows «1.» for spots 15 and 16 (re-check)
- Kind: simplification
- Screen: `?tab=reservations&view=plan`, manager, 1280, light, bg
- Saw: on tiles of about 38 px the name is cut to «1.», so they read as spot 1.
- Proposal: count the icon's width before choosing to show the name; show the name or nothing.
- Status: confirmed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: issue #492

### R6. The phone Plan opens at 8.4×, with 3 of 118 spots on screen (re-check)
- Kind: simplification
- Screen: `?tab=reservations&view=plan`, door host, 390, light, bg
- Saw: the 44 px opening zoom is set by the smallest spot (a bar stool), so the Plan opens on three spots; the full plan flashes first.
- Proposal: open on the whole plan, or zoom so the median table meets 44 px; no flash. Open question for the lead (below).
- Status: confirmed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: yes · Fix: issue #493

### R7. «Покажи целия план» leaves the plan editor off-centre at 800 px (re-check)
- Kind: bug
- Screen: Settings › Reservations, plan editor, manager, 800, light, bg
- Saw: the left third is empty and the right edge is clipped.
- Proposal: fit the editor's plan the way the night Plan does.
- Status: confirmed · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: issue #494

### R8. S1, S10 and S15 left three places behind (re-check)
- Kind: simplification
- Screen: guest card, booking form, cancel dialog; manager, 1280, bg
- Saw: the guest card's visit line «5 гости · 9»; the seat-count error says «места»; the cancel dialog says «вземи нова или копирай тази» (informal).
- Proposal: «място 9»; «седящи»; the formal voice.
- Status: confirmed · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: issue #495

### R9. «Избрани места: 3» reads as a count when one spot named 3 is ticked (re-check)
- Kind: simplification
- Screen: Change tables, manager, 390, light, bg
- Saw: the S5 confusion again, in the selection line.
- Proposal: «Избрано място: 3» for one, «Избрани места: 3, 7» for several.
- Status: confirmed · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: issue #496

### Re-check follow-ups (not rows of this round's fixes)
Filed together as issue #497: «Си тръгнаха» on a cancelled booking's history (grammar, and wrong for a cancellation); «Правоъгълник» overflows its button in the spot editor; an unnamed walk-in shows in a spot's sheet but not on the night list; list and plan swap places between Change tables and Give a spot on a phone; «с компанията на Компания на бара»; the open-bill title passes a raw spot name (`d_free_t`), as do the booking form, the copy dialog and `d_bill_t`.

## Fix plan

Polish rows are bundled too (round rule). S8's venue-header part is navigation → lane 6. Every bundle is a pull request into `sr/foundation`, coded by Opus.

- **B1. The door's list, sheet and guests on a phone** (`sr/l4-door-list`): S16, S8 (in-tab), S1, S3, S6, S18, S21, S23, S11, S15, R1, R2. Restack the row at 320–390 px (name and party, badges, the action full width, "…" in the corner); «място 9»; «Брой гости»; «Тръгнаха си»; one toast per door write naming the party, with Undo; no "changed by" notice for one's own write; past-night strings name the date; neutral counts; reservation strings in the app's formal voice; Guests rows get "…" for Archive; a waiting row's hour reads «от 15:09». Tests: reflow at 320 and 390 in `e2e/reservations-door.spec.ts`; the list, sheet and Guests at 390 in `e2e/touch-targets.spec.ts`; one's own write raises no `rv-stale`.
- **B2. Plan, spot pickers, Change tables, Block, plan editor** (`sr/l4-plan-pickers`): S7, S17, S5, S19, S9, S10, S13, S14, S22. Natural spot order (numeric collation, in code); on a phone Change tables and Give a spot open on the list, Give a spot's rows are buttons; Plan spots labelled once large enough and the phone Plan opens at a zoom meeting 44 px; keyboard hint for fine pointers only; Block names «място {spot}» and an unchosen reason says «Изберете причина.» instead of a disabled button; neutral refusal toasts; «Седящи» for seats; the plan editor gets `plan-zoom.ts` and «Видове места» moves above a collapsed spot list; Settings toasts say what changed; the swap sentence names both tables and says «със». Tests: 44 px at 390 for the list pickers and the Plan's opening zoom; Block with no reason; no checkbox in Give a spot; natural order unit test.
- **B3. The reservation engine** (`sr/l4-engine`): C1, C2, C3, C4, C5, C6, C7, X1, and S20 once settled. C1 an advisory transaction lock on venue and service date (one helper #425 can reuse); C2 dated blocks read on every night they cover; C3 lifting a block checks writability against today's night; C4 Restore re-claims only the spots the delete freed; C5 undoing an arrival keeps the reason and re-claims the spots held before when free; C6 `editReservation` refuses a spot change on a seated party (that is Change tables); C7 lock the settings row before reading; X1 scope both reads in `arrive-checks.ts` to the venue. Each with a database test in its existing home.

## Open questions (reviewer)
1. **S20 against D141:** follow D135 (Martin's own answer 13.18) and correct the lead's-call permission list in D141? Recommendation: yes; code it in B3 (edit and cancel take `reservations.tonight`, stay PIN-class on a shared device; deleting another's and Restore stay `reservations.manage`) and amend that one line of D141 (lane 6 writes decisions).
2. **C5 undo semantics:** should an undone arrival get its tables back? Recommendation: yes, re-claim when free, as Restore does; today's test asserts the opposite.

## Lead's calls (11-19, made on Martin's behalf, in the lead's morning report)
1. **S20:** yes, follow D135 13.18. Edit and cancel take `reservations.tonight` and stay PIN-class; deleting another's booking and Restore stay `reservations.manage`. B3 amends that one line of D141 ("corrected 11-19 in the screen round, S20").
2. **C5:** yes. Undoing an arrival puts the booking back as it was: it re-claims the spots it held when they are still free; if one was taken since, it comes back Reserved without it and the host is told in one line.

## Out-of-scope observations (reviewer)
- The seed's waiting parties carry descriptions as names («Двама на вратата»), so Guests looks wrong; give them person names in `demo-club.ts`.
- #426 (a walk-in created as reserved) touches the same `book.ts` block as B3.
