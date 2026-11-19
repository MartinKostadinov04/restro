# Lane 1 (Studio): screen-review ledger

Round 2026-11-18 (D146), lane 1, base `sr/foundation` at `1ae48918`. Scope: Studio › Structure, the item sheet (Details / Translations / Media / History), Tags, Sold out tonight, the Publish dialog and its draft preview, on a POS venue (Demo Bar, simulated POS) and a hand-made venue (Demo Club Sofia). Personas: owner, manager.

Passes: explorer (Sonnet subagent, step 2) S1–S22; code check (`code-review` high, Fable) S23–S26, from `code-check.md`; security check (`security-review` + `audit-security.md`, Fable) S27–S29, from `security-check.md`. A first Fable explorer hit its limit mid-walk and left no rows.

Explorer's walk: 1280, 390 and 320 px; bg dark by default, en light on Demo Bar only; no separate 200 % zoom pass (the pane has no browser zoom; 320 px stands in). Postgres on 54329 crashed for about four minutes mid-walk (every page 500); writes before it were kept. Some 42 px dialog-button sizes were the open-animation scale and were not reported; Radix menus staying mounted after Escape were treated as a pane artefact.

### S1. On a POS venue the Studio page is wider than a phone, so it scrolls sideways
- Kind: bug
- Screen: `/venues/<Demo Bar>` (Studio › Structure, section Коктейли), owner, 390 and 320 px, dark, bg
- Steps: open Demo Bar at 320 or 390 px, look at the section header.
- Expected: no horizontal scroll in a 320 px container (WCAG 1.4.10, `operational-screens.md` → Accessibility).
- Saw: the badge «Липсва име за менюто в test POS: показва се собственото му име» is one unwrapped line, 413 px wide. It pushes the page to 429 px: `documentElement.scrollWidth` 429 with `clientWidth` 320. The Menu picker (right edge 412) and "Нова секция" (right edge 429) sit partly off screen.
- Check: WCAG 1.4.10; screen read 1.
- Evidence: leaf `<span>` with `white-space: nowrap`, text "Липсва име за менюто в test POS…", width 413, right edge 429; on Demo Club (no badge) `scrollWidth` equals 390; screenshot taken.
- Proposal: let the badge wrap (`whitespace-normal`, `min-w-0`) and shorten it. bg «Няма име в test POS: показва се собственото му» / en "No name in test POS: our own name is shown".
- Status: candidate

### S2. Hide, rename, move, row sold-out and delete give no word and no Undo
- Kind: bug
- Screen: Studio › Structure, both venues, owner, 1280 px, dark, bg
- Steps: flip an item's hide switch; rename an item or section; use "Премести в…"; use the row-menu "Изчерпано тази вечер"; delete a hand-made item.
- Expected: a single reversible write saves at once and the Undo toast is the feedback (D107, `operational-screens.md` → Undo, patterns rows 1 and 7); a move says where the item went.
- Saw: no `[data-sonner-toast]` after any of these. A moved item just leaves the list. Deleting a hand-made item asks in a dialog, then no toast. The sheet's sold-out button does toast («Отбелязано като изчерпано тази вечер»), but with no buttons at all, so no Undo. The row-menu sold-out is silent, so one action has two behaviours.
- Check: D107; operational-screens Undo; feedback check 1.
- Evidence: `composer.tsx` `toggleItemHidden`/`renameItem` call `mutate` with no `toast`; DOM had no `[data-sonner-toast]` or `[data-sonner-toaster]` after the clicks; the sold-out toast's `querySelectorAll('button')` returned nothing.
- Proposal: `toast(text, {id:'hide:<id>', action:{label:'Отмяна'/'Undo', onClick}})` for hide/show, sold-out, rename and move. bg «Скрито от гостите» / en "Hidden from guests"; bg «Преместено в Бира» / en "Moved to Beer".
- Status: candidate

### S3. The POS item sheet says two opposite things about sold-out, and a POS venue has no way to mark sold out
- Kind: bug
- Screen: item sheet › Details of Негрони / Аперол Шприц (Demo Bar), owner, 1280 px, dark and light, bg and en
- Steps: open any POS item.
- Expected: one clear instruction that matches the controls.
- Saw: the "Продажба тази вечер" card says «Наличността идва от test POS: отбележете го като изчерпан там.» and has no button. Further down, the field «В продажба» says «Отбележете артикула като изчерпан тази вечер с бутона най-горе в този раздел.» (en: "Mark an item sold out tonight with the control at the top of this tab."). There is no such button. The row menu also has no sold-out entry. `composer-tab.tsx:176` passes `canMarkSoldOut && !hasTill`.
- Check: copy-rules (a note that contradicts the screen); D46/D107.
- Evidence: `[data-testid=item-sheet-sale]` shows `tillStockNote` and no `sale-mark` button; the "В продажба" field note is a different string.
- Proposal: remove the second note on POS venues. The lead should confirm that "no tonight-only sold-out on a POS venue" is intended: rule 5 allows our layer to mark sold out, and the Studio sold-out sheet is missing there.
- Status: candidate

### S4. The menu says «На живо» before anything has been published
- Kind: bug
- Screen: Studio › Structure, owner, 1280 px, dark, bg
- Steps: open either venue before the first publish.
- Expected: the menu badge matches the page banner.
- Saw: the Menu picker shows «Demo Club Sofia [На живо]» while the page says «Още не е публикувано: гостите не виждат нищо…» and «Още нищо не е публикувано.».
- Check: screen read 3; copy rule 1.
- Evidence: `[data-testid=menu-live]` text "На живо"; banner text above it; screenshot taken.
- Proposal: show «Чернова» / "Draft" until the first publish.
- Status: candidate

### S5. The publish state is stated twice, before and after publishing
- Kind: simplification
- Screen: Studio header, owner, 1280 and 390 px, bg and en
- Steps: open an unpublished venue, then publish it.
- Expected: structure is information, remove one thing (Clean rule 2).
- Saw: before: «Още не е публикувано: гостите не виждат нищо, докато не публикувате.» plus «Още нищо не е публикувано.» After publishing: «Актуално: гостите виждат последната версия.» plus a banner «Версия 1 е на живо / Гостите я виждат вече. / Затвори».
- Check: Clean rule 2; patterns row "A state of the whole page".
- Evidence: `main` innerText (both strings).
- Proposal: keep one line next to Publish and keep the banner only after a publish. bg «Нищо не е публикувано» / en "Nothing published yet".
- Status: candidate

### S6. The Publish dialog lists the same change under three headings, with a plural error
- Kind: bug
- Screen: Publish dialog, Demo Bar, owner, 390 px, bg
- Steps: hide Мохито after the first publish, press «Публикувай».
- Expected: names what changes in the owner's words (copy rule 4).
- Saw: «1 промяна чака / 1 скрити или премахнати / Скрити или премахнати от менюто / Мохито». The count and heading repeat, and «1 скрити» is wrong.
- Check: copy-rules (grammar, no repetition); Clean rule 1.
- Evidence: `[role=dialog]` innerText after opening.
- Proposal: «Скрит от менюто: Мохито» (en "Hidden from the menu: Mojito"); one count only («1 скрит» / «2 скрити»).
- Status: candidate

### S7. Rename from a section's "…" menu does not focus the name field
- Kind: bug
- Screen: Studio › Structure, section "…" › Преименувай, owner, 1280 px, bg
- Steps: "…" on Коктейли, Преименувай, type a name, press Enter.
- Expected: Enter saves and Escape cancels (patterns row "Rename", WCAG 3.2.1 / 2.4.3).
- Saw: the field opens, but focus returns to the "…" trigger. Select-all and typing went nowhere, and Enter reopened the menu. The field only works after a click. The item pencil does focus its field.
- Check: patterns row "Rename"; WCAG 2.4.3.
- Evidence: after the click `document.activeElement` is a DIV (the trigger), not `input[aria-label="Заглавие на Коктейли"]`.
- Proposal: focus the input after the dropdown's close auto-focus (`onCloseAutoFocus` preventDefault).
- Status: candidate

### S8. Reorder has only a drag handle: no "…" → Move up / Move down for sections, items or tags
- Kind: bug
- Screen: Studio › Structure, owner, 390 px (phone) and 1280 px, bg
- Steps: open "…" on a section or an item.
- Expected: handle plus "…" → Move up / Move down for one hand on a phone (WCAG 2.5.7, patterns row "Reorder").
- Saw: the section menu has Преименувай, Скрий, Хоризонтален ред, Нова секция вътре, Премести в…, Изтрий. The item menu has Отвори, Премести в…, Премести в „Неподредени". No up or down entry. The keyboard way works and announces in bg ("Вдигнато: Храна. Позиция 5 от 7.").
- Check: WCAG 2.5.7; operational-screens patterns (already listed as a known divergence).
- Evidence: `[role=menuitem]` lists above.
- Proposal: add «Нагоре» / «Надолу» (en "Move up" / "Move down").
- Status: candidate

### S9. On a phone the section header has two identical unlabeled switches
- Kind: bug
- Screen: Studio › Structure, section header, owner, 390 px, dark, bg
- Steps: open a section at 390 px.
- Expected: every input has a visible label (3.3.2) and the screen read is clear (question 3).
- Saw: next to «Нов артикул» there are two round switches and a "…". The labels «Секцията се показва на гостите» and «Хоризонтален ред» are `display:none` below desktop width. Which switch hides the section and which sets the layout can only be guessed. At 1280 px both labels are visible.
- Check: WCAG 3.3.2, 1.3.1; screen read 3.
- Evidence: span text "Секцията се показва на гостите", computed `display:none`, width 0; screenshot taken.
- Proposal: show short labels on a phone, bg «Видима» / «Ред» (en "Visible" / "Row"), or move the layout switch into the "…" menu where it already is.
- Status: candidate

### S10. The item-sheet help buttons show an internal field key; on a phone there are 14 of them at 16 px
- Kind: bug
- Screen: item sheet › Details, owner, 390 px, bg
- Steps: tap «ⓘ» beside «Име».
- Expected: words the owner knows (GLOSSARY); target 44 px (Restro floor).
- Saw: it opens a hover card with «Ключ на полето: name / Тип: Текст на няколко езика». That is developer vocabulary. The 14 `button[aria-label="За полето …"]` are 16×16 px (`data-slot=hover-card-trigger`).
- Check: copy-rules 8 / GLOSSARY; Restro 44 px floor; D109.
- Evidence: hover-card content "Ключ на полето name"; the 14 triggers at 16×16 with no `::after` hit area.
- Proposal: show only the plain-language help sentence (drop key and type). Give the trigger a `tap-area` of 44 px.
- Status: candidate

### S11. Translations says a POS name is read-only; Details lets the owner rename it
- Kind: bug
- Screen: item sheet › Translations versus Details, POS item, owner, 1280 px, bg and en
- Steps: open Негрони › Преводи, then Детайли › pencil on «Име».
- Expected: one rule for renaming over a POS name (D90: Restro may rename over the POS's text).
- Saw: Translations shows both name fields locked («Води се от test POS», lock icon) under «Езиците, които test POS вече има, са само за четене». Details opens the name editor (BG and EN, Save) for the same field.
- Check: D90; patterns (one pattern per job); design-critique 4.
- Evidence: Translations `Име` region has two lock rows; Details `button[aria-label="Редактирай Име"]` exists and opens «Редакция: Име».
- Proposal: say in Translations «Преименувайте в Детайли» (en "Rename it in Details"), or make both behave the same.
- Status: candidate

### S12. "Demo Club Sofia" is described as hand-made, but its items say «От barsy» and behave as POS items
- Kind: bug
- Screen: `/venues/<Demo Club Sofia>` Structure, owner, 1280 px, dark, bg
- Steps: look at the section header and item rows; open an item's "…" menu.
- Expected: a hand-made venue shows no POS source and gives full control (D64/D87); the vendor name stays out of interface text (vendor-words).
- Saw: the section badge and every item row show «От barsy». Imported-looking items offer no Преименувай and no Изтрий; only items «Създадено тук» do. The same page offers «Нов артикул». The POS venue shows the neutral «От test POS».
- Check: D64, D87; vendor-words baseline.
- Evidence: `<span>От barsy</span>` per row; the «Дайкири» menu lists Отвори, Изчерпано, Премести в…, Премести в „Неподредени"; the «Тест коктейл» menu also has Преименувай and Изтрий артикула….
- Proposal: lead to check whether this is seed data; if so fix the seed, otherwise the label should read «От POS» or hide for hand-made values.
- Status: candidate

### S13. The keyboard focus ring is a 3 px, 50 %-opacity grey
- Kind: bug
- Screen: Studio › Structure (drag handle, switches, buttons), owner, 1280 px, light and dark
- Steps: Tab to «Плъзни Храна».
- Expected: a visible, 3:1 focus indicator (WCAG 2.4.7; 1.4.11).
- Saw: `:focus-visible` is true, outline none, and box-shadow is `0 0 0 3px oklab(0.705 …/0.5)`. On white this is about 1.5:1; it is barely visible in the zoomed screenshot.
- Check: WCAG 2.4.7, 1.4.11.
- Evidence: `getComputedStyle(activeElement).boxShadow` as above; zoom screenshot taken.
- Proposal: use a solid ring colour with at least 3:1 against both themes (for example `ring-ring` at full opacity).
- Status: candidate

### S14. A Restro-made item on a POS venue sits in "Неподредени" with no price and no way out
- Kind: bug
- Screen: `?section=unsorted`, Demo Bar, owner, 1280 px, bg
- Steps: open «Неподредени».
- Expected: a POS venue never creates items (D87, D89, D90); anything it holds can be reached.
- Saw: «Лимонада на къщата — Създадено тук — 2 проблема — Без цена». Its menu offers only Отвори and Премести в…. No Преименувай, no Изтрий. The row has no pencil.
- Check: D87/D89/D90; operational-screens screen-read 3.
- Evidence: row text above; `[role=menuitem]` list is Отвори, Премести в….
- Proposal: lead to confirm whether this item is seed data; if so remove it from the seed, otherwise allow deleting what Restro itself created.
- Status: candidate

### S15. The "missing POS name" warning disappears after a rename and comes back after the next write
- Kind: bug
- Screen: Studio › Structure, Demo Bar, owner, 1280 px, bg
- Steps: rename the section Коктейли over the POS text; then hide an item.
- Expected: the warning state is the same before and after the page refreshes.
- Saw: right after the rename the warning badge and the "8" triangle on the section are gone; after the next write both are back. Then they stay for the rest of the session.
- Check: screen read 3 (what is here); D75.
- Evidence: screenshot taken after the rename (badge absent), then after the hide (badge present).
- Proposal: decide whether a renamed section should keep the D75 warning, and show the same in both states.
- Status: candidate

### S16. Hand-made items show «Няма зададена стойност» for "В продажба" and "Видим"
- Kind: simplification
- Screen: item sheet › Details, newly created item, owner, 1280 px, bg
- Steps: create «Тест коктейл», open its sheet.
- Expected: a status field shows a state (copy rule on empty states); one name per concept.
- Saw: «Видим: Няма зададена стойност» and «В продажба: Няма зададена стойност», where a POS item shows «Да». The en label for «График» is "Availability" next to "For sale". The sold-out note appears here too.
- Check: copy-rules (empty-state wording); GLOSSARY.
- Evidence: dialog innerText of the new item.
- Proposal: show the default («Да» / "Yes"); in en call «График» "Schedule".
- Status: candidate

### S17. Dialogs dismiss with «Отказ» (no verb for the way out)
- Kind: simplification
- Screen: Нова секция, Нов артикул, Нов таг, Изтрий секцията/артикула, Публикувай, owner, 1280 px, bg
- Steps: open each.
- Expected: buttons that name the action and the way out (copy rule 11; already listed as a divergence in the patterns table).
- Saw: «Отказ» in all of them; the delete dialogs do name the consequence well («Историята пази запис»).
- Check: copy-rules 11.
- Evidence: dialog button lists («Отказ», «Създай», «Изтрий артикула»).
- Proposal: «Остави я» / "Keep it" for deletes; «Не публикувай» / "Don't publish" for Publish.
- Status: candidate

### S18. On a phone the first item is 1023 px down a 3015 px page
- Kind: optimisation
- Screen: Studio › Structure, Demo Club, owner, 390 px, dark, bg
- Steps: open the venue at 390 px and scroll to the first item.
- Expected: the persona reaches the job in few taps and little scrolling (D123; audit-behaviour step 4).
- Saw: above the first row there are the venue name, the address chip, two buttons, the Студио picker, the Структура picker, the Меню card, «Секции / Нова секция», «Тагове» and the section picker, so the first item starts at y=1023. The Guest functions card comes after about 3000 px.
- Check: D123 (phone is a supported admin device); screen read 3.
- Evidence: `li` for «Негрони» `top+scrollY` = 1023, `scrollHeight` 3015.
- Proposal: merge the Menu card into the header and put the Студио/Структура pickers on one line.
- Status: candidate

### S19. The price hint uses a decimal point in a Bulgarian screen
- Kind: bug
- Screen: «Нов артикул» dialog, owner, 1280 px, bg
- Steps: open «Нов артикул».
- Expected: the interface text uses Bulgarian number format like the list («10,50 €»).
- Saw: «Например 4.50.» The field is `inputMode=decimal`. Not verified whether «4,50» is accepted (the attempt went into the name field).
- Check: copy rule 9 (localisation).
- Evidence: dialog text above.
- Proposal: bg «Например 4,50»; check the parser accepts the comma.
- Status: candidate

### S20. History describes changes in field-key words
- Kind: simplification
- Screen: item sheet › История, POS item, owner, 1280 px, bg
- Steps: hide, show and describe an item, then open История.
- Expected: words the persona would know (GLOSSARY).
- Saw: «Demo Owner премахна Видим (беше Не)», «зададе Видим: Не», «зададе Описание».
- Check: copy rule 8 / GLOSSARY.
- Evidence: screenshot taken of the History list.
- Proposal: «скри артикула» / «показа артикула» (en "hid the item" / "showed the item").
- Status: candidate

### S21. Desktop tap targets under 24 px
- Kind: bug
- Screen: Publish and tag dialogs, item sheet, owner, 1280 px, bg
- Steps: measure the «Затвори» (×) button and the ⓘ icons.
- Expected: Restro 44 px floor (phone) and WCAG 2.5.8 at least 24 px on a laptop.
- Saw: the dialog × is 16×16; the ⓘ triggers are 16×16; the row drag handle is 32×32 on the item list and 28×28 on the section list; the pencil is 28×28. On a phone the row targets are all 44 px.
- Check: WCAG 2.5.8; Restro 44 px floor.
- Evidence: Publish dialog `Затвори:16`; row buttons "Плъзни …:32x32", "Преименувай…:28x28".
- Proposal: pad the small icons with `tap-area` to 24 px or more.
- Status: candidate

### S22. A React "script tag" error is logged on every page load
- Kind: bug
- Screen: any Studio page, owner, 1280 px
- Steps: load a Studio page and read the console.
- Expected: no console errors.
- Saw: "Encountered a script tag while rendering React component. Scripts inside React components are never executed…", once per load (14 so far). Dev server only, so it may not appear in CI's production build.
- Check: console errors count (SKILL step 2); dev-only?
- Evidence: `read_console_messages` pattern "script tag": 14 matches.
- Proposal: find the inline `<script>` in the layout/theme setup and move it out of React's render.
- Status: candidate

### S23. A member sees every edit control, then gets a wrong refusal (code check)
- Kind: bug
- Screen: Studio › Structure and item sheet, member, any viewport
- Steps: as a plain member, open an item, edit the description, press Save.
- Expected: a member reads Studio but changes nothing, and is not offered controls that will fail (D72: no local success); refusal wording names the real rule.
- Saw: the server returns `not_allowed` and the toast reads "Only an owner or admin can mark items sold out." The composer gates only `canCreateItem`, `canDelete`, `canMarkSoldOut` by role; drag, hide, rename and tag controls are drawn for members (optimistic, then fail).
- Check: D72; copy rule (a message that names the wrong action).
- Evidence: `apps/web/src/composer/composer-tab.tsx:176-179`; `apps/web/src/server/item-sheet/actions.ts:92,121`; `apps/web/messages/en.json:205`, `bg.json:205`.
- Proposal: one `canEdit` (`canEditMenu(role)`) into the composer and the sheet, read-only without it; message en "Only an owner or admin can change the menu." / bg «Само собственик или администратор може да променя менюто.»
- Status: candidate

### S24. Payment mode can be set on another venue's unplaced item (code check)
- Kind: bug
- Screen: server action `setItemPaymentModeAction`, owner/admin
- Steps: forge the action from venue A with an unplaced item id of venue B (same organisation).
- Expected: an item id outside the named venue is refused, as the item sheet and sold-out actions do (RR-72).
- Saw: `assertActiveItems` refuses only items placed in another venue's menu; an unplaced item of venue B gets `payment_mode` written at master scope.
- Check: tenancy / venue scoping (RR-72).
- Evidence: `packages/core/src/apply/payment-mode.ts:115-153`; `apps/web/src/composer/payment-mode-actions.ts:48`.
- Proposal: check with `itemsOfVenue` in the action and drop the duplicate SQL.
- Status: candidate

### S25. On a POS venue a manual sold-out mark cannot be taken off (code check)
- Kind: bug
- Screen: item sheet › Details and Sold out tonight, POS venue, owner
- Steps: an item on a POS venue carries a manual sold-out mark (from before the venue had a till, or seeded); try to put it back on sale.
- Expected: core allows unmarking on a POS venue (`sold-out.ts:105` refuses only marking); unmarking only makes the menu less cautious within what the POS allows.
- Saw: the web sets `canMarkSoldOut` false for both mark and unmark on a till venue, so "Back on sale" is hidden and the server returns `not_allowed`.
- Check: D46; rule 5 (not at risk: errs cautious).
- Evidence: `apps/web/src/server/item-sheet/actions.ts:103`; `apps/web/src/composer/composer-tab.tsx:176`; `apps/web/src/composer/composer.tsx:525`; `apps/web/src/server/sold-out/service.ts:76`.
- Proposal: split the flag into mark (role and no till) and unmark (role only).
- Status: candidate

### S26. A POS stock mark never lapses once the item's link is no longer active (code check)
- Kind: bug
- Screen: worker stock pass (affects Studio's sold-out state), POS venue
- Steps: the POS marks an item run out; a sync sets the item's link non-active; later the item is listed again.
- Expected: the lapse pass clears the mark at the end of the service day.
- Saw: `readSlots` builds slots only for active links, so `lapseStockMarks` clears nothing on every tick; a relisted item returns off sale until a later stock pass.
- Check: D46 (sold out lasts the service day).
- Evidence: `packages/core/src/apply/stock.ts:104-117`, used at `:308`.
- Proposal: for the lapse pass, build slots from the stored till rows whatever the link state.
- Status: candidate

### S27. Reorder keys carry unchecked item and section ids (security check, low)
- Kind: bug
- Screen: server actions `placeItemAction`, `moveSectionAction`, owner/admin
- Steps: forge `keys[]` with the real item plus item ids from another venue of the same organisation.
- Expected: every id the action writes belongs to this venue (RR-72).
- Saw: only `itemId` goes through `ofVenue()`; the other `keys[]` ids become `setPlacement`s into `toSectionId` unchecked, so another venue's items land in this menu at the next publish. `moveSectionAction` has the same gap for section keys.
- Check: tenancy / venue scoping (RR-72).
- Evidence: `apps/web/src/composer/actions.ts:232-252`; `apps/web/src/composer/ops.ts:27-34`.
- Proposal: every key id through `itemsOfVenue()` (items) or `inMenu` (sections), else `not_found`.
- Status: candidate

### S28. `createSectionAction` accepts an existing node id (security check, low)
- Kind: bug
- Screen: server action `createSectionAction`, owner/admin
- Steps: send the id of an existing section (also a POS-mirrored one) with its current parent.
- Expected: a new section never overwrites an existing node, as `createItemAction` guards (line 287).
- Saw: `apply()` treats the repeated `createNode` as unchanged, then the `setField title` overwrites the title whole in the manual layer, dropping languages not sent and bypassing `renamePlan`'s override routing (D90).
- Check: D90; rule 1 integrity.
- Evidence: `apps/web/src/composer/actions.ts:255-269`.
- Proposal: refuse when `getNodeBasics(tenantId, id)` finds a node.
- Status: candidate

### S29. `setItemTagsAction` does not check items belong to the venue (security check, low)
- Kind: bug
- Screen: server action `setItemTagsAction`, owner/admin
- Steps: forge the action with item ids of another venue (same organisation).
- Expected: as `sold-out-actions.ts`, refuse ids outside the venue (RR-72).
- Saw: an unplaced item of any venue accepts the tag; clear/remove runs on any tenant node id.
- Check: tenancy / venue scoping (RR-72).
- Evidence: `apps/web/src/composer/tag-actions.ts:149-171`; `packages/core/src/apply/tags.ts:432-480`.
- Proposal: `itemsOfVenue(pool, tenantId, venueId, itemIds)` in the action.
- Status: candidate

## Works
- **Studio › Structure (hand-made, Demo Club)**: on desktop the screen shows where you are, the section tree, items with state chips and a hide switch per row; creating a section and an item with validation, the delete dialog naming its consequence, Tags (empty state, create, add to several, selection bar), Sold-out sheet and Publish (diff, preview, banner) all work.
- **Studio › Structure (POS, Demo Bar)**: no «Нов артикул», no delete or price edit on POS items, price shown as «Заключено / Променете това в test POS», own sections are creatable and deletable, items can be moved, hidden, renamed and enriched.
- **Item sheet**: the Details/Translations/Media/History tabs, the phone bottom drawer for field edits («Промяната се записва веднага…»), and the History log with source «Въведено тук» are readable and close with Esc.
- **Publish dialog and draft preview**: the diff, Преглед (phone frame, light/dark, BG/EN), the disabled button with «Актуално…» and publishing to «Версия 1» work.
- **Keyboard reorder**: Space, arrows and Space move a section and announce the result in bg.
- **Phone**: at 390 px every item-row control is 44×44 and Demo Club has no horizontal overflow.
- **A failed write**: an error toast and the optimistic section rolling back worked while the database was down.
- **Contrast**: checked text and badges on the light theme pass 4.5:1 (lowest 5.33).
- **Security** (`security-check.md`): tenancy from the session, role checks plus shared-device refusal on every write, no RLS bypass, no POS ids in composer, sheet, history or draft preview (rule 3), upload hardened, no XSS sink, redirects only to own paths, all writes through `apply()`.

## Could not see
- `device`: screen reader (VoiceOver, NVDA), one-handed reach, glare in a dark room, the keyboard over a field, a real slow connection.
- Real 200 % zoom (the pane has no browser zoom); 320 px only.
- Tag filter and tag colour swatches; photo upload (Media tab) and its failure copy; Unsorted drag with the mouse; horizontal-row layout on a guest page.
- Dark-theme contrast numbers (light only measured).
- 06:59 / 07:00 rows (no time-dependent UI in scope beyond the sold-out expiry).
- Select value flash on first load (pane lag or real: undecided).

## Manager checks to walk
From `apps/web/src/server/roles.ts` and the composer/publish actions: the org roles are owner, admin and member; "manager" in code means owner or admin (`canEditMenu`, `canPublishMenu`, `canMarkSoldOut`, `canManageIntegration`); owner-only: `canDeleteVenue`, `canManageOrganization`. No venue-level role exists (RR-70). A plain member reads Studio and changes nothing. Walk as a member: which controls are hidden or disabled (hide switches, pencils, drag handles, «Нов артикул», «Нова секция», Tags edit, Publish, Guest features «Запази», the sheet's Sold-out button), the wording of a forced refusal (D72), Publish absent or inert. As an admin: as owner, minus venue delete and organisation name.

## Manager walk (lane lead, Opus, before the reset)
Signed in as manager@club-biad.test (staff role Мениджър; organisation role member) on Club Biad Sofia (POS venue), 1280 px, dark, bg. Studio › Structure offers «Нова секция», «Тагове», every drag handle, the rename pencils, the section and item visibility switches and the "…" menus; no «Публикувай» button and the Guest features panel is disabled with «Само собственици и администратори могат да ги променят.». Flipping «Показва се на гостите: Absolut Vodka 0.7» showed the refusal toast «Само собственик или администратор може да направи това.» and the switch rolled back. This confirms S23 from the screen: the venue's manager, as the seed makes one, can change nothing in Studio but is offered every control.

## Review (step 4: Opus subagent, blind, on a fresh database, commit 2747bb79)

The reviewer walked Demo Bar's Structure, a POS item's sheet and Demo Club's Structure blind, then reproduced each screen row in the pane; S23–S29 by reading the code. Its writes: published Demo Bar (version 1), hid Мохито, renamed Коктейли to «Коктейли на бара», moved «Лимонада на къщата» into Безалкохолни and back. 34 of 35 rows confirmed (S1–S35; none rejected; the explorer's rows all hold, some with corrected causes).

| Row | Verdict and reason | Severity | Effort | Decision | Martin's yes | Fix |
|---|---|---|---|---|---|---|
| S1 | confirmed: 320 px page 429 wide, D75 badge `nowrap` 413 px | Before the pilot | S | none | no | L1-F |
| S2 | confirmed: no toast after hide or move (also in #60) | Before the pilot | M | none | yes | L1-D |
| S3 | confirmed: (a) sheet contradicts itself, fixed here; (b) the missing POS-venue mark is allowed by D147 (narrows D124 §6) and built in #437 | Before the pilot | S | none for (a) | no | L1-E (a); #437 (b) |
| S4 | confirmed: «На живо» means default menu (GLOSSARY "Live menu") but reads as "published" | Before the pilot | S | none | yes | L1-E |
| S5 | confirmed, worse: «1 промяна чака» next to «Версия 1 е на живо / Гостите я виждат вече.» | Before the pilot | S | none | yes | L1-E |
| S6 | confirmed | Before the pilot | S | none | no | L1-E |
| S7 | confirmed by code: `row-menus.tsx:186-191` no `onCloseAutoFocus` | Before the pilot | S | none | no | L1-D |
| S8 | confirmed (also in the patterns table and #60) | Before the pilot | M | none | yes | L1-D |
| S9 | confirmed at 320 px | Before the pilot | S | none | yes | L1-F |
| S10 | confirmed by code: `fields/field-row.tsx:66-81`; `size-4`, no `tap-area`; HoverCard never opens on touch; `touch-targets.spec.ts` never opens the sheet | Before the pilot | S | none | yes | L1-F target, L1-E text |
| S11 | confirmed as wording: D90 allows the rename in Details; Translations (D24) intro says «само за четене» | Polish | S | none | no | L1-E |
| S12 | confirmed, seed data: `seed-dev.ts` makes a hand-made venue, `seed-demo-menu.ts` attaches an invented barsy integration | Before the pilot | L | contradicts D87/D89 (seed only) | no | L1-H; Q1 |
| S13 | confirmed: shadcn `ring-ring/50` in `components/ui/button.tsx:7`, `switch.tsx:23` | Before the pilot | S | none | no | L1-G |
| S14 | confirmed, worse: the reviewer moved «Лимонада на къщата» into a POS section through the UI (5→6 items, Publish 29→30). `core/apply/unplaced.ts` lists unplaced hand-made items on POS venues; `placeItemAction` has no POS-venue check | **Blocking** (CLAUDE.md POS venue rule) | M | none | no | L1-A, seed L1-H |
| S15 | confirmed: an English name still from the POS keeps the D75 warning; the optimistic view clears it | Polish | S | none | no | L1-E |
| S16 | confirmed | Polish | S | none | no | L1-E |
| S17 | confirmed (app-wide divergence; Studio's five dialogs here) | Polish | S | none | yes | L1-E |
| S18 | confirmed; pickers are tab structure | Polish | M | none | yes | → lane 6 |
| S19 | confirmed: `bg.json` «Например 4.50.»; `moneyToInput` shows «12.50» in bg | Polish | S | none | no | L1-E |
| S20 | confirmed: template «{who} премахна {field} (беше {value})» | Polish | S | none | no | L1-E |
| S21 | confirmed: Publish dialog «Затвори» 15×15 | Polish | S | none | no | L1-F |
| S22 | confirmed, dev-only?: `app/layout.tsx:32` theme script | Polish | S | none | no | L1-G |
| S23 | confirmed: offering the controls is the bug; menu writes stay owner/admin (RR-70, Martin 10-31; `menu-editors.test.ts`) | Before the pilot | M | none | yes | L1-B |
| S24 | confirmed: an unplaced item yields no row in the walk | Polish | S | none | no | L1-A |
| S25 | confirmed in code; D147 leaves open who unmarks | Polish | S | none | yes | → #437; Q2 |
| S26 | confirmed | Before the pilot | S | none | no | L1-I |
| S27 | confirmed; same hole S14 reaches through the UI | Before the pilot | S | none | no | L1-A |
| S28 | confirmed | Polish | S | none | no | L1-A |
| S29 | confirmed | Polish | S | none | no | L1-A |

### Reviewer's rows (full format in the reviewer's report; summarised)
- **S30 (reviewer).** The Manager role's «Маркира изчерпани артикули» (`permissions.ts` `sold_out`) is read nowhere except `settings/staff-roles.tsx:67`; Studio asks only the organisation role (`roles.ts canMarkSoldOut`). D46, D122 §7, D147. Before the pilot, M → #437; Q3.
- **S31 (reviewer).** Both tab bars show a vertical scrollbar on Windows (`scrollHeight` 37 vs 36 with `overflow-x-auto`). Polish, S → lane 6.
- **S32 (reviewer).** «1 проблем» on the row vs «1 нещо за проверка» in the sheet; «Създадено тук» vs «Създаден тук». Polish, S → L1-E.
- **S33 (reviewer).** «с следващото» (→ «със следващото»), «ПОС терминал» (→ «POS терминал»), `bg.json` guest features. Polish, S → L1-E.
- **S34 (reviewer).** «Изчаква публикуващата част…» / "Waiting for the publisher…" while publishing → «Публикува се…» / "Publishing…". Polish, S → L1-E.
- **S35 (reviewer).** Menu and section pickers blank for seconds after load (Radix `SelectValue` without children). dev-only?, Polish, S → L1-G.

### Fix plan (reviewer)
- **L1-A** composer writes stay inside the venue; a POS venue gets no Restro-made item: S14, S27, S28, S24, S29. `core/apply/unplaced.ts`, `composer/actions.ts`, `tag-actions.ts`, `payment-mode-actions.ts`, `core/apply/payment-mode.ts`. Tests: core unplaced read; `server/security/roles-actions.test.ts` RR-72 block; `structure-actions.test.ts`.
- **L1-B** read-only Studio without `canEditMenu`: S23. `composer-tab.tsx`, `composer.tsx`, row and pane components, item sheet; a menu `not_allowed` message. Test: `structure-ui.test.tsx`.
- **L1-D** feedback, undo and keyboard: S2, S7, S8 (Undo toasts through an inverse change set, focus after "…" › Преименувай, Move up/down).
- **L1-E** Studio words: S3(a), S4, S5, S6, S10 text, S11, S15, S16, S17, S19, S20, S32, S33, S34.
- **L1-F** phone layout and targets: S1, S9, S10 target, S21; `touch-targets.spec.ts` opens the sheet and the Publish dialog.
- **L1-G** shared UI (cross-lane, lead): S13, S22, S35.
- **L1-H** seed: S12 and the seed part of S14 (Q1).
- **L1-I** stock-mark lapse: S26, `core/apply/stock.ts`, `stock.test.ts`.
- Elsewhere: → lane 6 S18, S31; → #437 S3(b), S25, S30.

### Open questions (reviewer's recommendations)
- **Q1 (S12):** rewrite Demo Club Sofia as a truly hand-made venue (Demo Bar covers the POS case); L effort, three e2e specs move.
- **Q2 (S25, D147):** whoever may mark may unmark, every unmark in the Log; Martin confirms through #437.
- **Q3 (S30):** #437 gates the mark on the venue permission `sold_out` in Tonight and Studio alike; needs Martin's yes (RR-70 kept menu writes to owners and admins).

Out of scope: «Функции за гостите» on Structure vs D129 (designer pages) → lanes 2/6; Demo Bar's «Поръчка от телефона» note depends on the floor read (not checked).
