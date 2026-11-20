# Screen round 2026-11-18, lane 5: Setup and settings

Explorer pass (screen-review step 2, Sonnet), walked 2026-11-19 on `claude/sr-setup-78027c` at `1ae48918` (from `sr/foundation`). Environment: database `restro_lane5` (seed:dev + seed:demo), web `http://lane5.localhost:3150`, worker 8151, sim-pos 4750 (scenario club-biad). Venue: Club Biad Sofia (ids change on reseed). Personas: owner (`owner@club-biad.test`, phase A), manager (`manager@club-biad.test`, phase B), a signed-in user with no organisation and a signed-out visitor (phase C). The shared Postgres crashed twice during phase A; pages that failed then were walked again. The browser tool could not save screenshots into this folder, so Evidence is selectors, measurements and page text. Rows are candidates with no severity. Code rows (C1–C3, Opus, `code-review` high) and security rows (X1–X2, Opus, `security-review` + `audit-security.md`) follow the explorer's.

Scope also re-checks the trial's S1, S2 and S19 (`../../2026-11-18-screens-trial/findings.md`, fixed by #447 and #445): see "Trial re-check" at the end once walked.

## Phase A (owner)


### S1. On the phone, the "Live" badge sits on top of the rename pencil in a menu row, and the name wraps to four lines
- Kind: bug
- Screen: `/venues/<id>?tab=settings&section=general`, Menus card, owner, 390 px, dark, bg and en
- Steps: open Settings › General on a phone and look at the menu row. It is worst with a long venue name, as on my 63-character hand-made venue, where the badge also covers "Delete".
- Expected: controls never overlap and each is reachable at 44 px (Restro 44 px floor, `operational-screens.md` Accessibility, D123).
- Saw: the badge spans x 141–208 and the Rename button starts at x 145 (width 44), so they overlap. Move up, Move down and Open are squeezed in beside the wrapped "(името на заведението)" suffix.
- Check: Restro 44 px floor; design-critique 3 (reading order and hierarchy)
- Evidence: JS rects, badge left 141 width 67.5; Rename left 145 width 44, top 386; Move up 193, Move down 241, Open 293
- Proposal: stack the name and badge above the action row below 640 px. Bulgarian: drop the "(името на заведението)" suffix from the row; the heading already says it.
- Status: re-verified (#471, re-check 2026-11-20)

### S2. Every tab bar draws a stray vertical scrollbar next to the tabs
- Kind: bug
- Screen: any venue page (Studio, Tables & QR, Settings tab list, Settings section list, Studio subtabs), owner, 1024 and 1280 px, dark
- Steps: open a venue on a wide screen and look right of the last tab.
- Expected: no scrollbar on a one-row tab list (D107, Clean rule 2: remove the element that does no job).
- Saw: the `role=tablist` element has `overflow:auto`, height 36 and scrollHeight 37, so a scrollbar with two arrows appears.
- Check: design-critique 4 (consistency); Restro Clean rule 2
- Evidence: `document.querySelector('[role=tablist]')`: height 36, scrollHeight 37, overflow auto
- Proposal: `overflow-y: hidden`, or fix the 1 px height mismatch.
- Status: re-verified (#471, re-check 2026-11-20)

### S3. At 1024 px the venue Settings page scrolls sideways, and the last section tab (Versions) is clipped
- Kind: bug
- Screen: `/venues/<id>?tab=settings&section=hours`, owner, 1024 px, dark, en
- Steps: set the viewport to 1024 wide and open any venue Settings section.
- Expected: no horizontal page scroll (WCAG 1.4.10).
- Saw: `scrollWidth` 1039 against `innerWidth` 1024; `MAIN`, `HEADER` and the content wrapper all end at x 1038. The nine section tabs scroll inside their own box.
- Check: WCAG 1.4.10
- Evidence: JS `{w:1024, sw:1039}`, offending elements `MAIN.relative.flex.w-full…`, `HEADER`, `DIV.mx-auto.max-w-7xl`
- Proposal: find what makes the main column 15 px wider than the viewport (a min-width or the section tab list). Below 1280 px the nine section tabs could use the dropdown the phone uses.
- Status: fix in flight (#471: the section tabs still clip at 1024/1280, N1)

### S4. Settings › General says "Not synced yet" and also shows completed syncs
- Kind: bug
- Screen: `?tab=settings&section=general`, Menu source card, owner, 390 px, dark, bg and en
- Steps: scroll to Menu source on the Club Biad Sofia venue.
- Expected: one consistent state (rule 6 spirit: don't state absence you haven't established).
- Saw: "Първо запазете данните за достъп до test POS в Настройки → Интеграции. Още не е синхронизирано." above "Последно изпълнение: Друго · Завършено · 14:51". The connection also reads "Connected" in the organisation's Integrations.
- Check: ux-copy (clear, consistent); operational-screens screen read Q3 (what is here, and its state)
- Evidence: body text of the section; Integrations page shows "Свързано"
- Proposal: derive the sentence from the connection state. Bulgarian "Синхронизирано за последно: 14:51"; show "Първо запазете данните…" only when the connection has none.
- Status: re-verified (#469, re-check 2026-11-20)

### S5. The sync history is twenty identical rows, each "Друго · 0 с · Завършено", one every five minutes
- Kind: simplification
- Screen: `?tab=settings&section=general` → "Покажи последните 20 изпълнения"; same list in `/settings/integrations`, owner, 390 px
- Steps: expand the list.
- Expected: a record the owner can read: what ran and what it did (Patterns: list of records; ux-copy rule 8, plain words).
- Saw: the kind of every row is "Друго / Other", the duration is "0 с / 0 s", and the rows are at 13:06, 13:12, 13:17 … 14:51. There are no counts or outcomes, and the owner cannot tell a real sync from a heartbeat.
- Check: operational-screens Patterns (list of records); ux-copy rule 8
- Evidence: expanded list text
- Proposal: hide kind `other` rows (or name the real kind), and show "N items changed" instead of "0 с".
- Status: re-verified (#469, re-check 2026-11-20)

### S6. The connection page says "Connected" yet "Last checked: Never", and shows no sign of a saved username or password
- Kind: bug
- Screen: `/settings/integrations`, test POS tab, owner, 390 px, dark, bg and en
- Steps: open Integrations › test POS.
- Expected: the status is consistent, and credentials the server holds are visibly present but never shown back (rule 3 spirit: no secrets read back).
- Saw: Status "Свързано" next to "Последна проверка: Никога", and "Синхронизирай всичко сега" disabled under "Първо запазете данните за достъп". The API user field is empty (`value=""`) and the password field is empty (`len0`, no "saved" hint, `autocomplete=new-password`). The owner cannot tell whether anything is saved.
- Check: operational-screens screen read Q3; ux-copy (empty states and errors say state and next step)
- Evidence: input values `[host=localhost:4750, user="", password len0]`
- Proposal: show the user name, and give the password field a placeholder "Запазена — въведете нова, за да я смените" / "Saved — type a new one to replace it". Make Status "Not checked yet" until a check has run.
- Status: re-verified (#469: Connected and Last check agree); the demo's disabled Sync is #486

### S7. The New venue dialog offers "test POS · 1 venue", then step 2 says everything is already linked and Create is dead
- Kind: simplification
- Screen: New venue dialog on `/venues`, owner, 1280 px, dark, bg
- Steps: New venue → "test POS" → Next.
- Expected: no dead ends before the form (operational-screens wayfinding Q4; D64, D87 source fixed at creation).
- Saw: step 1 subtitle "1 заведение"; step 2 "Всяко заведение в test POS вече е свързано със заведение." with a disabled radio and a disabled Create button. The owner learns this only after choosing.
- Check: design-critique 2 (unnecessary steps); ux-copy (empty state: what, why, how to start)
- Evidence: dialog text
- Proposal: on step 1, mark a POS with no free venue as "Няма свободни заведения / No free venues" and disable it, with one line saying where its venues are linked.
- Status: re-verified (#471, re-check 2026-11-20)

### S8. In the hours dialog the "Same hours on" checkboxes are 16 px
- Kind: bug
- Screen: Hours dialog (tap a weekday), owner, 390 px, dark
- Steps: Settings › Hours › Monday.
- Expected: a 44 px hit area through `tap-area`.
- Saw: the six checkboxes are 16×16 and their labels 40–43×16. The other controls in the dialog are 44.
- Check: Restro 44 px floor
- Evidence: dialog `getBoundingClientRect`: `INPUT:checkbox 16x16`, `LABEL:Вт 40x16`
- Proposal: the `tap-area` class on each checkbox plus label, one per row or at least 44 px tall.
- Status: rejected by the reviewer (tap-area gives 44 px)

### S9. The reservation plan editor on a phone draws spots 12 px wide with no zoom
- Kind: bug (in another lane's area, logged for lane 4's reviewer)
- Screen: `?tab=settings&section=reservations`, Plan card, owner, 390 px, dark
- Steps: scroll to "План на залата".
- Expected: a spot is touchable at 44 px; the plan can be zoomed as the Plan view's can (admin-map: zoom and pan).
- Saw: spots are 12–14 px (`0 · Маси 12x7`, `1 · Сепарета 13x13`) and clipped at the right edge. The list below is the real touch route and has 120+ rows.
- Check: Restro 44 px floor; WCAG 2.5.7 (the list is the alternative)
- Evidence: `__small()` list of 120 under-44 controls
- Proposal: let lane 4 decide. For example, on a phone show only the list, or add pinch zoom.
- Status: → lane 4

### S10. Copy says "till / касата" for the POS, which the glossary forbids
- Kind: simplification
- Screen: `?tab=settings&section=general` (Menus: "Менютата идват от касата"; en "The menus come from the till"); hand-made venue Studio empty state (en "connect a till in Settings → Integrations")
- Steps: read the Menus card; create a hand-made venue and open Studio.
- Expected: GLOSSARY "POS" (_Avoid_: till, cash register); ux-copy rule 8.
- Saw: "till" and "касата" used for the POS. The glossary also lists "menu source" as _Avoid_ in favour of "Source", yet the heading "Източник на менюто / Menu source" is used, and "Deleted venues / Изтрити заведения" is used where the glossary says "Archived" while restorable.
- Check: ux-copy rule 8 and GLOSSARY.md
- Evidence: Menus card text; en HTML fetch of `…section=general`
- Proposal: "Менютата идват от POS системата" / "The menus come from the POS". Heading "Източник / Source". Check "Archived" against D-numbers before renaming.
- Status: re-verified (#469, strings); the Deleted-venues rename is #473

### S11. A hand-made venue is told to connect a POS, which cannot be done
- Kind: bug
- Screen: `/venues/vn_25nm…` (Studio › Structure), hand-made venue, owner, 1024 px, en
- Steps: create a hand-made venue and open it.
- Expected: no instruction that contradicts D64/D87/D89 (source fixed at creation).
- Saw: the empty state reads "Create a section, or connect a till in Settings → Integrations."
- Check: D64, D87 (source fixed at creation); ux-copy (empty state)
- Evidence: screenshot of the new venue's Studio, text of the empty state
- Proposal: for a hand-made venue only "Create a section to start your menu." / «Създайте секция, за да започне менюто.»
- Status: re-verified (#469, re-check 2026-11-20)

### S12. "Publishing" is a settings section that holds POS sync scheduling, and it uses "reading" for what other screens call "sync"
- Kind: simplification
- Screen: `?tab=settings&section=publish`, owner, 390 px, bg and en
- Steps: open the Publish section; compare with the top-right Publish button and General's "Sync this venue".
- Expected: one word per thing (ux-copy rule 8; GLOSSARY: Sync, Publish).
- Saw: the section is named "Публикуване" but its heading is "Автоматизация", and it covers how a venue reads the POS ("Четене на менюто от test POS"), not publishing. "Четене / reading" and "синхронизация / sync" name the same thing. Its footer, "Това са настройките, които връзката имаше, преди да преминат към заведението", is jargon.
- Check: ux-copy rule 8
- Evidence: section text
- Proposal: name the section "Синхронизация / Sync", use "Sync" throughout, and cut the footer to "Saving makes these settings this venue's own."
- Status: re-verified (#469, re-check 2026-11-20)

### S13. The venue-legal-details form appears in both Ordering and Paying
- Kind: simplification
- Screen: `?tab=settings&section=ordering` and `?tab=settings&section=paying`, owner, 390 px
- Steps: open both sections and compare the "Данни за заведението за гостите" blocks.
- Expected: one pattern per job (`operational-screens.md` Patterns).
- Saw: the same four fields (company name, ЕИК, registered address, privacy-policy link) and a Save button in each section, with different intro text. I did not confirm that they edit one stored record.
- Check: operational-screens Patterns (one job, one place)
- Evidence: section texts
- Proposal: keep it in one place (Paying) and link to it from Ordering.
- Status: rejected by the reviewer (one component on purpose, #288, RR-O15)

### S14. The tables screen is a wall of 76 near-identical cards on a phone
- Kind: optimisation
- Screen: `?tab=tables`, owner, 390 px
- Steps: open Tables & QR and scroll.
- Expected: few taps and a calm screen (D107); "tables tonight" is a grid (Patterns).
- Saw: each table card is about 330 px tall (QR, name field, "от test POS: 2", "Кодът е активен", a "Бар: Бар 2" chip, and two selects that all read "Като на заведението"). There is no search and no collapse per area, so the page is about 25,000 px long. Three paragraphs of explanation sit above the first table. The Menu select text is clipped ("Club Biad…").
- Check: design-critique 3 (hierarchy); screen-read Q3; B7 (never truncate a name)
- Evidence: 76 `Действия за маса …` buttons; per-card text in the page dump
- Proposal: collapse each area by default, and show the two selects only when they differ from the venue ("Own menu" chip). Cut the intro to one sentence.
- Status: re-verified (#480, re-check 2026-11-20)

### S15. navigation → lane 6: organisation settings use wrapping tabs while a venue uses a dropdown
- Kind: simplification
- Screen: `/settings/*`, owner, 390 px, dark
- Steps: open Settings in the sidebar on a phone.
- Expected: one pattern per job; the baseline counts "+1 per tab on a phone" because tab bars become a dropdown (admin-map).
- Saw: the three organisation tabs wrap to two rows ("Изтрити заведения" on its own row). A venue's tabs and sections become two dropdowns. The page title is "Настройки", the breadcrumb "Настройки › Общи", the first tab "Общи" and the h1 "Общи" again.
- Check: design-critique 4; Patterns
- Evidence: screenshot of `/settings/integrations` at 390
- Proposal: lane 6 decides.
- Status: navigation → lane 6

### S16. navigation → lane 6: nothing links to the QR guide, and the guide describes controls the screen does not have
- Kind: simplification
- Screen: `/guides/qr-links`, owner, 390 px, bg
- Steps: look for a link from Tables & QR; read the guide.
- Expected: the guide is reachable from the card it explains, and its steps match the screen.
- Saw: no link anywhere; Tables says only "Собствен домейн за кодовете ще има по-късно". The guide tells the owner to choose "Нашият линк" in "Адрес в кодовете" and use "Основен адрес", but the live card has only a read-only "Кодовете водят до …". Its first Cloudflare example is long and for the website's maintainer.
- Check: design-critique 2 (obvious path); ux-copy
- Evidence: Tables body text vs guide text
- Proposal: lane 6: a link "Как да използвам собствен линк?" in the address card. Edit the guide to the controls that exist.
- Status: navigation → lane 6

### S17. navigation → lane 6: on a phone a venue's Settings needs two stacked dropdowns, placed above its title
- Kind: simplification
- Screen: `?tab=settings&section=*`, owner, 390 px
- Steps: open any Settings section on a phone.
- Expected: baseline 5 taps to reach a section (admin-map, "Taps (phone)").
- Saw: the "Настройки" dropdown and the section dropdown ("Работно време") sit between the page header and the section's own heading, which repeats the section name. About 360 px of chrome precede the first setting (name, address, two buttons, two dropdowns).
- Check: operational-screens screen read Q2/Q3
- Evidence: screenshots at 390
- Proposal: lane 6 decides.
- Status: navigation → lane 6

### S18. Several tap targets are under 44 px on a phone
- Kind: bug
- Screen: every admin page at 390 px (breadcrumb "Заведения"); Settings › Ordering ("Виж на картата"); QR guide ("Назад към „Маси и QR“"); delete toast link
- Steps: `__small()` on each page.
- Expected: 44×44 px (D123).
- Saw: breadcrumb link 73×20 and 74×20, "Виж на картата" 106×17, guide back link 182×20. Settings › Staff has fifteen "Едно докосване / ПИН" segmented controls only 110×24 each.
- Check: Restro 44 px floor
- Evidence: `a,button…` rect scan on `/venues`, `?section=ordering`, `/guides/qr-links`, `?section=staff`
- Proposal: pad links with `tap-area`; make the PIN segmented controls 44 px tall.
- Status: re-verified (#471, re-check 2026-11-20)

### S19. Long names are cut with an ellipsis in the sidebar
- Kind: bug
- Screen: sidebar, owner, 390 and 1280 px, both themes
- Steps: create a venue with a 63-character name.
- Expected: names wrap everywhere (§7.5; B7).
- Saw: the sidebar item reads "Нощен клуб Свръхдългоименн…" and cannot be read in full anywhere in the sidebar.
- Check: B7 / §7.5 (never truncate a name)
- Evidence: sidebar screenshots, `/venues` and `/venues/<id>` at 390
- Proposal: let sidebar items wrap to two lines.
- Status: re-verified (#471, re-check 2026-11-20)

### S20. Deleting a venue means typing its whole name, although it can be restored for 30 days
- Kind: simplification
- Screen: Delete venue dialog (`?tab=settings&section=general` → "Изтрий заведението…"), owner, 390 px, bg
- Steps: delete my 63-character test venue.
- Expected: "Remove a thing that can come back" is one tap or a bin; a typed name is only for what erases data (Patterns; D107, D83).
- Saw: a four-bullet dialog, then "За потвърждение въведете името…" with the 63-character name to retype on a phone keyboard. The venue stayed recoverable (it appeared under Deleted venues with the right dates and a clear restore toast). The dismiss button says "Отказ / Cancel".
- Check: Patterns (the two Remove rows); copy-rules rule 11 (dismiss wording)
- Evidence: dialog screenshots at 390
- Proposal: since the glossary calls it recoverable ("Archived"), use the one-tap-plus-Undo pattern, or keep the typed name only for "Delete forever". The dialog's dismiss button becomes "Запази заведението / Keep venue".
- Status: re-verified (#471, re-check 2026-11-20)

### S21. Page titles and headings repeat themselves
- Kind: simplification
- Screen: `/venues`, `/settings/*`, owner, 390 px
- Steps: read the screens top to bottom.
- Expected: no element that does no job (Clean rule 2).
- Saw: `/venues`: "Заведения" in the breadcrumb and again as the h1; the card repeats "Club Biad Sofia" as title and as the venue in the POS. `/settings/integrations`: "Състояние" appears twice in a row, as heading and as label. The browser-tab title is just "Общи" / "Интеграции" with no product or organisation. The organisation block in the sidebar footer, "Club Biad · Организация", has no switcher (one organisation) and is a block that does nothing.
- Check: Clean rule 2; ux-copy (concise)
- Evidence: page text
- Proposal: drop the duplicate h1 or breadcrumb; title "Интеграции · Club Biad · Restro".
- Status: re-verified (#469, re-check 2026-11-20)

### S22. The print sheet is 794 px wide on a phone
- Kind: bug
- Screen: `/venues/<id>/tables/print`, owner, 390 px
- Steps: open the sheet on a phone.
- Expected: no horizontal scroll at 320 px (WCAG 1.4.10), or a deliberate print-only layout.
- Saw: `scrollWidth` 794 against 390; the header and "Печат" button are readable, but the cards are cut at the right. The sheet itself reads well on screen: six codes per page, bilingual BG and EN, short URL under each.
- Check: WCAG 1.4.10
- Evidence: JS `{sw:794}`
- Proposal: A4 width only under `@media print`; on a screen let the cards flow to the viewport.
- Status: re-verified (#480, re-check 2026-11-20)

### S23. The "Restore" button is "Върни", right beside "Изтрий завинаги"
- Kind: simplification
- Screen: `/settings/deleted-venues`, owner, 390 px, bg
- Steps: delete a venue, open Deleted venues.
- Expected: a clear verb for the safe action; the destructive one visibly separate (Patterns, Remove for good).
- Saw: "Върни" next to "Изтрий завинаги" at equal size and spacing, with the intro paragraph (5 lines: "Върнете ли заведение в рамките на 30 дни, то се връща като чернова… ако друго заведение не я обслужва сега") above. After Restore the toast says what happened, but has no link to open the venue.
- Check: ux-copy (CTAs, confirmation); Patterns
- Evidence: screenshot
- Proposal: "Възстанови / Restore" as the filled button, and "Изтрий завинаги" as a "…" item. Shorten the intro to two sentences.
- Status: re-verified (#471, re-check 2026-11-20)

### S24. Several copy lines are unclear
- Kind: simplification
- Screen: Settings › Versioning, Alerts, General, organisation settings, owner, 390 px, bg
- Steps: read them.
- Expected: plain words for a night-club owner (ux-copy; copy-rules).
- Saw: Versions: "Публикувана ръчно · системата" ("by hand · the system"). General: "Останалите настройки засега са само за четене. Редактирането им идва със студиото." (a promise, and "Studio" means a tab). Alerts: «Тази вечер» in guillemets beside „Включи“ in low-high quotes, in one sentence. English: "Menu: Venue's (Club Biad Sofia)", "Last run: Other".
- Check: ux-copy; copy-rules rule 8
- Evidence: section texts
- Proposal: Versions "Публикувана ръчно от Мартин" or just "Публикувана ръчно"; one quote style („…“ in Bulgarian); "Menu: venue default (Club Biad Sofia)".
- Status: re-verified (#469, re-check 2026-11-20)

### Works
- **Venues list:** the cards show state, source and address. The long name wraps, and the draft's disabled Preview explains itself. The list refreshes after delete and restore.
- **New venue (hand-made):** the address auto-transliterates from the name, validation messages are plain, and it lands on the new venue after Create.
- **Tables & QR:** the code works (`/t/<code>` redirects to the menu), and the test-link button gives a working URL. The QR dialog is large, has download PNG/SVG and the address, and the "…" menus have labelled 44 px buttons.
- **Print sheet:** six codes per page, bilingual, with a short URL and a clear "13 pages" count.
- **Settings General:** the delete flow, the Danger zone wording, "Open guest page" and the disabled Publish are clear.
- **Settings Hours:** switches have names and 44 px targets, and the weekday dialog is clean.
- **Settings Ordering:** setting rows have labels and the "More" card hides the rare ones.
- **Settings Reservations:** every control is labelled and saves at once.
- **Settings Paying:** the connection state is clear, and the radio cards give whole-card hit areas.
- **Settings Staff:** roles, PIN behind an eye, copy-role.
- **Settings Alerts:** a plain per-person row with an instruction.
- **Settings Publish:** two radio cards with a plain explanation.
- **Settings Versioning:** the live version is listed with its date.
- **Organisation General:** name and address name, with a clear explanation that old links keep working.
- **Integrations:** the password is never shown back.
- **Deleted venues:** the empty state is good. Restore works and the toast explains what happens next.
- **QR guide:** a complete, honest guide (apart from S16).
- **User menu:** language and theme are one tap each inside the menu. English is complete; the only Cyrillic is data (venue names and seed users).
- **Light theme:** renders correctly and consistently.
- **320 px:** no horizontal overflow on Venues, Tables, General, Hours, Staff, Paying, Reservations and Integrations.

### Could not see
- A POS venue creation (the simulated POS has no free venue; S7).
- The organisation switcher (one organisation, so it is not shown).
- A keyboard-only walk. I checked tab order and names via the accessibility tree and rects only.
- Measured contrast in both themes. I read the screenshots only.
- Hover-only actions: none found. The sidebar and "…" menus open on tap.
- 06:59/07:00 and the daylight-saving night, which need a time fixture.
- Device lines for Martin's phone: one-handed reach, the keyboard over the typed-name field, glare, and a screen reader.

Waiting for Phase B.
## Phase B (manager)

### S25. The manager's Tables & QR says codes can be looked at and printed, but the codes never load and the print sheet is empty
- Kind: bug
- Screen: `/venues/<id>?tab=tables` and `/venues/<id>/tables/print`, manager, 390 px, dark, en
- Steps: sign in as the manager, open Tables & QR, wait, then press Print sheet.
- Expected: the page says "You can look at the codes and print them" (Tables intro), so the codes and the sheet work (the owner's do).
- Saw: "Loading the codes…" never goes away after 5 s or more. There are no QR images (`document.images.length` 0), "Open test link" stays disabled, and "Print sheet" opens a page that says only "The codes can't be shown right now." There is no reason given, and the Tables list does not say it either.
- Check: operational-screens feedback 2 (what failed says what to do); ux-copy error messages
- Evidence: JS `imgs=0 loading=true testlink=BUTTON disabled`; the print sheet screenshot text. I found no 4xx or log line.
- Proposal: if a manager is meant to read codes, load them for that role. If not, drop the "look at and print" sentence and the Print button, and say "Only owners and admins can see the codes." / «Само собственици и администратори виждат кодовете.»
- Status: re-verified (#480, re-check 2026-11-20)

### S26. A manager gets a different silent fallback for pages they may not open
- Kind: bug
- Screen: `?tab=settings&section=staff`, `…section=alerts` and `/settings/deleted-venues`, manager, 390 px
- Steps: type the Staff or Alerts section address as the manager, and the Deleted venues address.
- Expected: a hidden section either refuses clearly or lands somewhere said to be allowed ("hidden vs refused", the brief).
- Saw: Staff and Alerts return 200 and render General, with the section dropdown showing "General", so the address in the bar lies about the page. Deleted venues returns 404. Neither says "owners only".
- Check: operational-screens wayfinding Q1 (where am I); ux-copy
- Evidence: `fetch` of the three addresses: staff and alerts → 200 with Menus/Venue settings text; deleted-venues → 404
- Proposal: show a one-line "Only owners and admins can open this" page, or redirect with a toast. «Само собственици и администратори имат достъп до това.»
- Status: re-verified (#471, re-check 2026-11-20)

### S27. The manager gets no explanation for the missing Publish button, and the Publish settings section has six disabled controls with no read-only line
- Kind: simplification
- Screen: venue header on every tab and `?tab=settings&section=publish`, manager, 390 px, dark
- Steps: compare the venue header with the owner's, then open Settings › Publish.
- Expected: the read-only state is shown as such, as it is on General, Hours, Ordering, Paying and Versioning ("Only someone with the right to change settings can change these").
- Saw: the header has no Publish button and no sentence, so the manager cannot tell whether nothing is waiting or he may not publish. The Publish section's six controls are simply disabled with no explanation, unlike the other sections. The three sections that do explain use three different sentences ("Only someone with the right to change settings…", "Only someone allowed to connect payments…", "Only an owner or admin can return…").
- Check: operational-screens "A role that may not act" (never a disabled control without the reason); ux-copy rule 8
- Evidence: header text compared with the owner's (no "Publish", no "Up to date" line); `button[disabled],input[disabled]` count 6 on `…section=publish`
- Proposal: one shared line at the top of each read-only section, «Само собственици и администратори могат да променят това.» / "Only owners and admins can change this." Show the venue state ("Up to date") in the header even without the button.
- Status: re-verified (#471, re-check 2026-11-20)

### Works (manager)
- General: name and address as plain text, with a clear owners-and-admins line for the menu source and sync.
- Hours, Ordering and Paying: each opens with a read-only line.
- Versioning: a read-only line is present.
- Organisation General and Integrations: read-only, with the owner-only wording. The Deleted venues tab is simply not shown.

Waiting for Phase C.
## Phase C (no organisation, signed out)

### S28. A person with no organisation has only "Sign out", and the screen does not say how to get invited
- Kind: simplification
- Screen: `/no-organization` (every admin address redirects here), a user in no organisation, 390 px, light, en
- Steps: open any admin address as `noorg@lane5.test`.
- Expected: a dead end names a next step (operational-screens wayfinding Q4; ux-copy empty state: what, why, how to start).
- Saw: the card reads "No organisation yet. noorg@lane5.test is not a member of any organisation. Ask the Restro team to invite you." The only control is Sign out (104×44). There is no contact (address or link), no language switch (the sign-in page has BG and EN), and no word on whether an invitation already sent will arrive here. `/venues`, `/settings/general` and a venue address all answer 200 and show this same page.
- Check: ux-copy empty states; operational-screens wayfinding Q4
- Evidence: page text; `fetch` of the three admin addresses → final URL `/no-organization`
- Proposal: add a contact line and the BG/EN switch. Bulgarian: «Още нямате организация. Поискайте покана от екипа на Restro: <контакт>.»
- Status: re-verified (#472, language switch); the contact line is #474

### S29. The sign-in error is not tied to the fields it concerns
- Kind: bug
- Screen: `/login`, signed out, 390 px, light, en
- Steps: submit a made-up email and password.
- Expected: WCAG 3.3.1. The error names the problem and the invalid fields expose it (`aria-invalid`, `aria-describedby`).
- Saw: "The email or password is not right." (14 px, `role=alert`, announced) is shown between the password field and the button. Neither input has `aria-invalid` or `aria-describedby`. The password field keeps its typed value (13 dots) and focus. There is no "Forgot your password?" path; the card only says "Access is by invitation only."
- Check: WCAG 3.3.1; ux-copy error messages (what, why, how to fix)
- Evidence: JS: `role="alert"`, `aria-invalid`/`aria-describedby` both null on both inputs
- Proposal: set `aria-invalid` on both fields and `aria-describedby` to the error. Add «Ако сте забравили паролата, поискайте нова от собственика си.» if that is the intended route.
- Status: re-verified (#472, re-check 2026-11-20)

### Works (Phase C)
- **`/no-organization`:** short and calm, names the signed-in account, one 44 px Sign out, and no horizontal scroll at 390 px.
- **Sign out:** lands on `/login` in one tap.
- **`/login`:** BG/EN switch at the top, email and password both 44 px with the right `autocomplete`, and a clear invitation-only line.
- **Wrong password:** the message is plain and the page does not shift much.
- **Signed-out addresses:** `/venues`, a venue's Tables tab and `/settings/general` all redirect to `/login?next=<the address>`, with the whole path and query encoded. `next` is still in the address after a failed sign-in.

### Additions to Could not see
- Whether `next` actually returns the person after a successful sign-in. I did not sign in.
- Whether `next` refuses an off-site address such as `?next=https://…`. I did not try it.
- Password managers, and the keyboard over the sign-in fields on a phone (device lines).

**Environment left for the lead:**
- The pane is signed out, at a 390 px viewport.
- "Lane5 Temp Bar" (`vn_25nmL9qWBldz0jyytqLvVs`) and my restored long-named draft venue remain in Club Biad.
- The owner account's preferences are English and light (the manager's and the no-organisation user's are whatever those accounts had).
## Code check (Opus, Skill code-review high: 10 raw, 3 kept)

### C1. Typing the password again moves a two-organisation person back to their first organisation, so the change being retried fails
- Kind: code
- Screen: `/venues/<id>?tab=settings`, any settings action answering `sign_in_again` (password dialog); owner of two organisations; n/a, n/a, n/a
- Steps: belong to A (first) and B; switch to B; open a B venue's Settings; after 15 min change something; type the password.
- Expected: the fresh sign-in keeps the organisation in use and the change goes through (D122 §7).
- Saw: the dialog calls `authClient.signIn.email` (`src/settings/use-settings-run.tsx:183`), a new session; the create hook sets the first organisation (`src/server/auth.ts:82-89`); the retried action resolves A and answers `venue_missing`; the admin is now in A.
- Check: code-review (high)
- Evidence: `auth.ts:89` `activeOrganizationId: first?.organizationId ?? null`; `use-settings-run.tsx:183`
- Proposal: in `onSignedIn`, `authClient.organization.setActive({ organizationId })` for the page's organisation, then retry.
- Status: fixed, covered by tests (#472)

### C2. The password dialog gets stuck if the connection drops during sign-in
- Kind: code
- Screen: settings password dialog (`PasswordAgain`); owner or manager; n/a, n/a, n/a
- Steps: reach the password dialog, lose the connection, press the button.
- Expected: it says it failed and can be pressed again (as `sign-out.ts` does, RR-88).
- Saw: `submit()` has no try/catch (`use-settings-run.tsx:180-191`); a network throw leaves `busy` true, no message.
- Check: code-review (high)
- Evidence: `use-settings-run.tsx:181-184`; compare `src/components/auth/sign-out.ts:6-11`
- Proposal: try/catch/finally; on a throw show the unknown-error text; always `setBusy(false)`.
- Status: fixed, covered by tests (#472)

### C3. The print sheet and the QR download skip the shared-device guard every other tables path has (RR-84)
- Kind: code
- Screen: `/venues/<id>/tables/print`, `GET /api/tables/<tb>/qr`; shared bar device; n/a, n/a, n/a
- Steps: on a shared device open the print or QR URL directly.
- Expected: refused with the own-sign-in notice, like `perform` and `revealCodesAction` (`src/server/tables/actions.ts:105,144`; D122 §7).
- Saw: neither calls `onSharedDevice` (`app/(print)/venues/[venueId]/tables/print/page.tsx:28-46`, `app/api/tables/[tableId]/qr/route.ts:17-35`); core's grants still refuse the reveal (`pin_required`), so no code leaks, but the print page shows "codes unavailable" and a refused reveal is attempted.
- Check: code-review (high)
- Evidence: `route.ts:24` builds the actor with no shared-device check
- Proposal: add the `onSharedDevice` check to both: 404 from the route, the own-sign-in notice on the print page.
- Status: fixed, covered by tests (#472)

Rejected from the skill: old session not revoked after re-auth (normal Better Auth, D122 §7 doesn't ask); tables actor `operator` flag (unreachable); `addPersonAction` empty id (cannot happen); `startPlanAction` revalidate (correct, idempotent); three efficiency points (sequential reads, double scope, sequential reveal batches) outside the focus.

## Security check (Opus, Skill security-review + audit-security.md)

Threat model: assets — organisation name and slug, venues (delete, purge), POS credentials (sealed with the worker's public key; the web never opens them), table codes and staff PINs (revealed only by the worker), sessions (30 days). Actors — anonymous visitor, plain member, admin trying owner-only actions, owner of organisation B against A's ids, a shared device's account, a stale owner session. Entry points — `/api/auth/*`, `/login?next=`, `proxy.ts`, the area's server actions, `GET /api/tables/[id]/qr`, the print page. Controls — `requireTenant()` from membership, `roles.ts`, `onSharedDevice`, core's `resolveGrants` and `freshSignIn`, RLS as `restro_app`, Zod on every action input.

The skill's false-positive filter scored both rows below 8 (reports nothing); the checklist keeps them as deviations from D122. No critical or high. Database tests could not finish (the shared Postgres went down during both runs); the matrix is from code and existing tests.

### X1. Owner-only and destructive actions never ask for the password again after 15 minutes
- Kind: security
- Screen: Settings › General, Settings › Integrations, venue Settings › General (delete), Settings › Deleted venues (purge), Tables & QR; a person holding an owner's session older than 15 minutes; n/a, n/a, n/a
- Steps: sign in as owner, let the session age past 15 minutes; "Delete permanently" a deleted venue: queued, no password asked. Save Settings › Ordering in the same session: it answers `sign_in_again`.
- Expected: D122 §7, "asks for the password again before a settings change after 15 minutes".
- Saw: only core commands with `freshSignIn: true` (engine.ts:165) and `revealPinAction` (staff-actions.ts:147) check it. Unchecked: `updateOrganizationAction` (organization-actions.ts:130-134); integration actions (integration/actions.ts:88-96, :113-122, `saveConnectionAction` changes POS host and credentials); venues-actions.ts delete :355, purge :519, unpublish :457, slug :244, rename :313; tables actions (tables/actions.ts:103-119; `table_code.reissue` has no `freshSignIn`, commands.ts:515-521).
- Check: audit-security step 4 (security-review filter 2/10)
- Evidence: as in Saw
- Proposal: one guard `isFreshSignIn(signedInAt)` answering `sign_in_again` on these (not create, restore or read-only check/sync); or `freshSignIn: true` on `table_code.reissue`. Tests: a 16-minute-old `signedInAt` gets `sign_in_again` and nothing moves (`organization-actions.test.ts`, `venue-lifecycle-actions.test.ts`).
- Severity guess: medium
- Status: fixed, covered by tests (#472)

### X2. Any signed-in account can rename itself, which changes the name on past Log entries
- Kind: security
- Screen: `POST /api/auth/update-user`; any signed-in account incl. a shared device's; n/a, n/a, n/a
- Steps: signed in, POST `{"name":"<another person's name>"}`; the Log, "published by" and Telegram "Done by" show that name, for old entries too.
- Expected: D122 §7 (the Log names a person); auth.ts:5-7 says HTTP rename endpoints are switched off.
- Saw: `DISABLED_HTTP_PATHS` (auth.ts:28-47) lacks `/update-user`; names are read at display time (night-read.ts:228-234, worker deliver.ts:645-654, publish/load.ts:137); nothing in the app calls `updateUser`.
- Check: audit-security step 7 (security-review filter 3/10)
- Evidence: as in Saw
- Proposal: add `'/update-user'` to `DISABLED_HTTP_PATHS` and to the 404 list in `auth.test.ts:146-151`.
- Severity guess: low
- Status: fixed, covered by tests (#472)

Rejected: RR-75 (already logged, red test on purpose); print/QR shared-device check (core refuses `settings.codes`; test gap only — conflicts with C3, reviewer decides); settings layout on a shared device (readable data only); Better Auth org endpoints (check membership); open redirect via `next` (`safeNextPath` holds); POS credentials (sealed, never returned); POS host SSRF (worker host policy, outside area); purge (worker re-checks, web never uses `restro_purge`).

Tenancy/roles matrix: every action in the area is in `attack-table.ts` (tenancy-actions fails otherwise). Gap: purge never tried as an admin (code checks owner at venues-actions.ts:520).

`pnpm audit --prod`: next 16.4.3 (2 moderate, `'use cache'`, unused), undici < 8.12.2 (4 high, 3 moderate), esbuild (1 moderate) — dependency upgrade outside this lane.

Out of scope: `roles-actions` "plain member › nightEndPreviewAction" changed org data despite `permission_denied` (before the database shutdown; unverified).

## Review (step 4, Opus, blind, fresh database)

The reviewer was started with only this ledger path and commit `9e67d6a1`, after a reset and reseed (venue `vn_4sX6oXRZVgwQrXxlcGCRCh`), worker and simulated POS running, signed in as the owner. It did not switch personas: S25–S29 are confirmed from the code plus the explorer's evidence. Its reply follows as given.


All 34 rows have a verdict: 28 confirmed (eight of them only in part), 2 rejected, 4 handed to other lanes, and I added 8 rows of my own. Nothing contradicts a decision in force, so every row I fix below has "Needs Martin's yes: no". Two points in rows S10 and S28 stay open questions; they are listed in the Fix plan.

I walked as the owner, mainly at 390 px and 1280 px in English. The pane drew pages in light even when I asked for dark, because the owner account is set to light. I did not switch personas. So S25–S29 are confirmed from the code plus the explorer's evidence, not walked again live. If you want them walked live as the manager, the user with no organisation, and a signed-out visitor, the lead needs to switch the pane. I edited no files and committed nothing. The viewport is reset to desktop; the tab was left on the print sheet.

## Blind-walk notes (before reading the ledger)
- **`/venues`:** the card puts "Unpublish…" next to Open and Preview. The Next dev badge says Next.js 16.4.x has a known security vulnerability; that is already issue #202.
- **`/venues/<id>/settings`** is a 404, because Settings is a tab (`?tab=settings`). That is expected, not a finding.
- **Venue Settings › General (1280 px):**
  - Both tab rows draw a stray up/down scroll arrow.
  - The section tabs first draw 6 entries, then 9 once loaded (Paying, Staff and roles, Alerts appear late).
  - Menu source says "Save the test POS credentials first" and "Not synced yet", yet "Last run: Other · Completed".
  - "The menus come from the till".
  - "The other settings are read-only for now. Editing them arrives with the Studio." The Studio already exists.
- **Tables & QR (1280 px):**
  - Three intro paragraphs.
  - Each of the 76 cards repeats "Menu: Venue's (Club Biad Sofia)" and "Pay first: Same as the venue (On)".
  - "Create codes for all tables" is the filled primary button although all 76 tables already have a code.
  - "Loading the codes…" takes several seconds.

## Reviewer lines per row

| Id | Verdict | Severity | Effort | Decision | Needs Martin's yes | Fix |
|---|---|---|---|---|---|---|
| S1 | confirmed — 390 px en: the name wraps one word per line (6 lines); the Live badge ends at x 146 and the Rename button starts at x 145, so they overlap by 1 px, more with a longer name | Before the pilot | S | none | no | A |
| S2 | confirmed — both tablists: clientHeight 36, scrollHeight 37, overflow auto (1024 and 1280 px) | Polish | S | none | no | A |
| S3 | confirmed — 1024 px: page is 1039 px wide; MAIN, HEADER and the content wrapper end at x 1038 | Polish | S | none | no | A |
| S4 | confirmed, merged into S5 — "Not synced yet" sits over a last run that is a floor read labelled "Other". The "Save credentials first" half comes from the seed (see S6) | Before the pilot | S | none | no | B |
| S5 | confirmed — the "Other" runs are the worker's `floor_read` (`apps/worker/src/jobs/floor.ts:66`), which `run-history.tsx` does not name, so it falls back to "Other" | Before the pilot | S | none | no | B |
| S6 | confirmed as a **seed defect**, rejected as a product bug. `seed-demo-club.ts:157-161` sets the connection to `connected` with no credentials and no check time. With credentials saved, `connect-card.tsx` already shows a "saved" state and never shows the password. Today the seeded demo can never press "Sync this venue" | Before the pilot | S | none | no | B |
| S7 | confirmed — step 1 offers "test POS · 1 venue"; step 2 says everything is linked, with the radio and Create venue disabled | Before the pilot | S | none | no | C |
| S8 | **rejected** — every hours checkbox has the `tap-area` class, which gives a 44 px hit area on a phone (`globals.css:25`; operational-screens Accessibility) | — | — | — | — | — |
| S9 | confirmed — 119 controls under 44 px, spots 12–14 px | — | — | — | — | lane 4 |
| S10 | confirmed — "till"/"каса" in about 15 owner-facing strings breaks copy rule 8 and D82 ({source}); the heading "Menu source" is a glossary _Avoid_. The "Deleted venues" → "Archived" part is an open question: D76 and D83 name the page "Deleted venues" | Before the pilot | S | none (rename part: contradicts D76/D83) | no | D |
| S11 | confirmed — `composer…empty.description` (en.json:631) tells a hand-made venue to "connect a till" | Before the pilot | S | none | no | D |
| S12 | confirmed — the section tab says "Publish", the heading says "Automation", it covers "Reading the menu" (= Sync); the footer is jargon | Before the pilot | S | none | no | D |
| S13 | **rejected** — one component (`legal-details-card.tsx`), one record, one action, drawn on purpose in both sections (#288, RR-O15), so ordering can be turned on without leaving the section | — | — | — | — | — |
| S14 | confirmed — the page is 23,700 px tall at 390 px; 76 cards each with two selects at the default; three intro paragraphs | Before the pilot | M | none | no | E |
| S15 | confirmed — the organisation tabs wrap to two rows at 390 px | — | — | — | — | lane 6 |
| S16 | confirmed — no link from Tables to the guide. The guide's wrong content is R3 (lane 5) | — | — | — | — | lane 6 (link); R3 → F |
| S17 | confirmed — two stacked dropdowns before the section heading | — | — | — | — | lane 6 |
| S18 | confirmed in part — under 44 px: "See on a map" 90×17, "Back to Tables & QR" 153×20, the staff One tap / A PIN labels 61×24 and 48×24, and the "Hours" link in Settings › Reservations 40×17. **Rejected:** the breadcrumb, which has `tap-area` | Before the pilot | S | none | no | A |
| S19 | confirmed — `[&>span:last-child]:truncate` in `ui/sidebar.tsx:460`. Not a rule break (never-truncate is for templates only, overrides row 2) | Polish | S | none | no | A |
| S20 | confirmed in part — the dismiss button "Cancel" breaks copy rule 11 (known divergence #60 row 7). **Rejected:** dropping the typed name, which D76 requires ("owners only, after typing its name") | Polish | S | none | no | C |
| S21 | confirmed in part — browser tab titles "General", "Integrations", "Deleted venues" and "Restro" (print) lack "· Restro" while venue pages have it; "Status" appears as both heading and label. **Rejected:** the card repeating the POS venue name (D86 asks for it) and the organisation block (it names the organisation) | Polish | S | none | no | D |
| S22 | confirmed — the 794 px layout is shrunk to fit on a phone | Polish | S | none | no | E |
| S23 | confirmed — "Върни" and "Изтрий завинаги" are both outline buttons of equal weight (`deleted-venues-list.tsx:125-143`) | Polish | S | none | no | C |
| S24 | confirmed — 6 «» strings in bg.json (copy rule 7); "Studio" promise (914); "Published by hand · the system" (982); "Venue's ({menu})" | Polish | S | none | no | D |
| S25 | confirmed from code and the explorer's evidence — Manager lacks `settings.codes` (`permissions.ts`), yet en.json:1537 promises "You can look at the codes and print them" | Before the pilot | S | none (grants stay as D141/#324) | no | E |
| S26 | confirmed from code — `settingsSectionOf` falls back to General without changing the address; Deleted venues uses `notFound()` | Polish | S | none | no | G |
| S27 | confirmed from code — `automation-settings.tsx` has fieldsets disabled with no read-only line; the header shows no state without the right to publish | Before the pilot | S | none | no | G |
| S28 | confirmed in part — no language switch on `app/no-organization/page.tsx`. The contact line is an open question (which contact) | Polish | S | none | no | H |
| S29 | confirmed from code — `login-form.tsx:92` form error has no `aria-describedby` from the inputs, and no `aria-invalid` on a failed sign-in | Polish | S | none | no | H |
| C1 | confirmed — `use-settings-run.tsx:183` starts a new session; `auth.ts:82-89` puts it in the first organisation | Before the pilot | S | none | no | I |
| C2 | confirmed — `submit()` has no try/finally, so a network throw leaves the dialog stuck | Before the pilot | S | none | no | I |
| C3 | confirmed — the QR route (`route.ts:17-24`) and the print page skip `onSharedDevice`. Core still refuses, so no code leaks | Polish | S | none | no | I |
| X1 | confirmed — no fresh sign-in check in venues-actions, organization-actions, integration/actions or the tables actions; D122 §7 asks for one | Before the pilot | M | none (implements D122 §7) | no | I |
| X2 | confirmed — `DISABLED_HTTP_PATHS` (`auth.ts:28-47`) lacks `/update-user` | Before the pilot | S | none | no | I |

## My rows

### R1. "Create codes for all tables" is the filled main button when every table already has a code
- Kind: simplification (reviewer's row)
- Screen: `?tab=tables`, owner, 1280 and 390 px, light, en
- Steps: open Tables & QR on the seed (76 tables, 76 with a code).
- Expected: the primary action is the one the owner needs now (operational-screens: one primary action; Clean rule 2).
- Saw: the button is enabled and filled; pressing it only toasts "createdNone". Print sheet is the outline button.
- Check: design-critique 2; Clean rule 2
- Evidence: `tables-panel.tsx:161-166` shows it whenever `total > 0`; JS `disabled:false` with summary "76 tables, 76 with a code"
- Proposal: show it only when `coded < guestTotal`, as «Създай липсващите N кода» / "Create the N missing codes". When every table has a code, Print sheet becomes the primary button.
- Status: re-verified (#480, re-check 2026-11-20)

### R2. The disabled Print sheet gives its reason only on hover
- Kind: bug (reviewer's row)
- Screen: `?tab=tables`, a venue with no codes, owner, 390 px
- Steps: open Tables & QR before any code exists.
- Expected: nothing appears only on hover (Patterns: secondary actions; a phone has no hover).
- Saw: `disabled` button with `title={t('printNone')}`.
- Check: operational-screens Patterns (nothing hover-only)
- Evidence: `tables-panel.tsx:180-189`
- Proposal: hide the button until a code exists, or show the `printNone` text as a line under it.
- Status: re-verified (#480, re-check 2026-11-20)

### R3. The QR guide describes controls that do not exist and gives developer-only steps
- Kind: bug (reviewer's row)
- Screen: `/guides/qr-links`, owner, 390 px, en
- Steps: read Option 1 and compare it with Tables & QR › Address in the codes.
- Expected: the guide's steps match the screen (design-critique 2; ux-copy).
- Saw: it says to choose "Our link" and use "Base address"; the card has only a read-only "Codes lead to". It also says "While we build the system… type this computer's network address, for example http://192.168.1.20:3000".
- Check: ux-copy (clear, accurate); design-critique 2
- Evidence: page text of `/guides/qr-links`
- Proposal: rewrite Option 1 to the existing card ("Codes lead to …", Create codes, Print sheet). Drop the developer paragraph. Keep Option 2 as "comes later" until a domain setting exists.
- Status: re-verified (#471, re-check 2026-11-20)

### R4. The print sheet's browser tab title is "Restro", so a saved PDF is called Restro.pdf
- Kind: simplification (reviewer's row)
- Screen: `/venues/<id>/tables/print`, owner, any
- Steps: open the print sheet and choose Save as PDF.
- Expected: a file named after what it holds.
- Saw: `document.title` is "Restro".
- Check: ux-copy (clear)
- Evidence: JS `title=Restro`
- Proposal: «QR кодове · Club Biad Sofia» / "QR codes · Club Biad Sofia".
- Status: re-verified (#480, re-check 2026-11-20)

### R5. Lane 5 error messages say "Something went wrong"
- Kind: simplification (reviewer's row)
- Screen: Deleted venues, New venue, Unpublish, venue name/address/delete, organisation, integrations, owner
- Steps: read the `failed` strings.
- Expected: an error names the fix, never "Something went wrong" (copy rule 4; operational-screens Undo).
- Saw: en.json lines 467, 504, 513, 554, 606, 926, 954, 974, 1253 (15 such strings in the file).
- Check: copy-rules rule 4
- Evidence: en.json lines above
- Proposal: «Връзката прекъсна. Нищо не е променено: проверете връзката и опитайте пак.» / "The connection dropped. Nothing was changed: check the connection and try again."
- Status: re-verified (#469, re-check 2026-11-20)

### R6. Venue Settings' section tabs grow from 6 to 9 after the page loads
- Kind: bug (reviewer's row)
- Screen: `?tab=settings`, owner, 1280 px
- Steps: click the Settings tab from the Studio.
- Expected: no layout shift in the navigation.
- Saw: the skeleton row shows General…Versioning (6). Paying, Staff and roles and Alerts appear a moment later and push Publish and Versioning right.
- Check: design-critique 4 (consistency)
- Evidence: blind-walk screenshot during the skeleton vs after load
- Proposal: compute the visible sections before the skeleton draws, or render the skeleton from the same `visibleSettingsSections`.
- Status: re-verified (#471, re-check 2026-11-20)

### R7. "In Settings → Integrations" is plain text, not a link
- Kind: optimisation (reviewer's row)
- Screen: Settings › General, Menu source card, owner, 1280 px
- Steps: read the sync-blocked line.
- Expected: the way out is one tap (wayfinding Q4).
- Saw: the `sync.blocked.*` strings name the path in text only.
- Check: operational-screens wayfinding Q4
- Evidence: en.json:1474-1476
- Proposal: render "Settings → Integrations" as a link to `/settings/integrations`.
- Status: re-verified (#469, re-check 2026-11-20)

### R8. Integrations history names barsy runs "Full sync" / "Quick sync"; the glossary says "Full read"
- Kind: simplification (reviewer's row)
- Screen: `/settings/integrations`, barsy tab, owner
- Steps: read the run kinds.
- Expected: GLOSSARY "Full read" (_Avoid_: full pull, full sync).
- Saw: `connectors.barsy.runKinds` uses "Full sync" and "Quick sync".
- Check: copy rule 8
- Evidence: en.json:1493-1497
- Proposal: «Пълно четене» / "Full read". "Quick sync" becomes "Changes read", if the glossary has no term; add one.
- Status: re-verified (#469, re-check 2026-11-20)

## Fix plan

Each bundle is one ticket in `ship.md` §1's format: model Sonnet unless noted; coded by an agent session; branch `sr/<slug>` from `sr/foundation`; pull request into `sr/foundation`; Menu functionality: none.

**A — `sr/admin-layout` (bug.md): S1, S2, S3, S18, S19, R6.**
- Read: D123, operational-screens Accessibility.
- Screen: none (visual).
- Menu row stacks the name and the badge above the actions below 640 px.
- Tablist gets `overflow-y-hidden` (or the 1 px fix).
- Find the min-content that widens MAIN at 1024 px.
- Add `tap-area` or 44 px height to "See on a map", the guide's back link, the staff segmented control and the Reservations "Hours" link.
- Sidebar venue name wraps instead of being cut.
- Section skeleton built from `visibleSettingsSections`.
- Tests:
  - S18 (D123 floor): `e2e/touch-targets.spec.ts` gains Settings › Staff, Settings › Ordering and `/guides/qr-links` at 390 px.
  - S1: `e2e/venue-phone.spec.ts` asserts the menu row's badge and buttons do not overlap at 390 px.
  - S3: `e2e/owner-settings.spec.ts` asserts `scrollWidth <= innerWidth` at 1024 px.

**B — `sr/sync-state` (bug.md): S4, S5, S6, R7.**
- Read: D82, GLOSSARY Sync.
- Screen: none.
- Name `floor_read` as a neutral run kind, «Прочетени маси» / "Tables read" (as `places_read`), and show its counters.
- The venue card's "Last run" line shows the last menu sync, not a floor read.
- Seed: put the demo connection in a coherent state. Either seal throwaway credentials for the sim through the real save path and record a check time, or seed `status: 'new'`.
- Link to Integrations in the blocked lines.
- Tests: `run-history` test for `floor_read`; `menu-source-card.test.tsx` for the "Last run" line; `seed-demo-bar.test.ts` or the club seed test asserts credentials, or a non-`connected` status.

**C — `sr/venue-lifecycle-copy` (change.md): S7, S20 (dismiss only), S23.**
- Read: D76, D83, D86, copy-rules 11.
- Screen plan (New venue step 1):
  - Story: as an owner I start a POS venue only when the POS has a free venue; 2 taps today.
  - Pattern: radio cards; a POS with no free venue shows «Няма свободни заведения» / "No free venues" and is disabled with that reason in text.
  - States: no free venue; one free venue; the longest Bulgarian text.
- Dialog dismiss buttons in the lane: «Запази заведението» / "Keep venue" (delete, purge, unpublish).
- Deleted venues: «Възстанови» / "Restore" filled; "Delete permanently" stays outline after it.
- Tests (rule 11): `delete-venue-dialog.test.tsx`, `purge-venue-dialog.test.tsx` and `unpublish-venue-dialog` assert the button names; `new-venue-dialog.test.tsx` asserts the disabled POS and its reason.

**D — `sr/settings-words` (change.md): S10 (not the rename), S11, S12, S21, S24, R5, R8.**
- Read: D82, GLOSSARY, copy-rules.
- Screen: none.
- "till"/"каса" becomes `{source}` in the lane's strings (en/bg lines 474, 491, 508, 512, 631, 939, 1183, 1249, 1356).
- Heading «Източник» / "Source".
- Hand-made empty state: «Създайте секция, за да започне менюто.» / "Create a section to start your menu."
- Section «Синхронизиране и публикуване» / "Sync and publish"; "Sync" used throughout; shorter footer.
- Page titles «… · Restro».
- One "Status".
- „…" quotes in bg.
- Drop the Studio promise; "Published by hand".
- R5 and R8 strings.
- Tests (copy rules 4, 7, 8): `src/i18n/messages.test.ts` gains three assertions:
  - no "till" or "каса" outside an explicit allowlist of other lanes' keys;
  - no «» in bg;
  - no "Something went wrong" / "Нещо се обърка" outside a shrinking allowlist.

**E — `sr/tables-qr` (change.md): S14, S22, S25, R1, R2, R4.**
- Read: D103, D122 §7, D141, admin-map lines 20 and 97-106, operational-screens.
- Screen plan:
  - Stories: Set a menu for an area, 2 taps; PF4 and PF5, 2 taps; PF9, 0 taps; Create codes, 1 tap; Print, 3 taps. Every target is kept.
  - Pattern: an area index at the top (jump links), intro cut to one sentence, the "from {source}: N" line only when the name differs, and shorter select texts («Менюто на заведението», «Като зоната»). The selects stay on the card, so PF5 stays 2 taps.
  - Primary action: Create the missing codes, or Print sheet when every table has one.
  - States: no codes; all codes; a role without `settings.codes` («Само собственици и администратори виждат кодовете.» / "Only owners and admins can see the codes.", and no codes or Print); 76 tables; the longest Bulgarian text.
  - Print sheet: A4 width only under `@media print`, the title from R4.
- Tests: `e2e/tables.spec.ts` (the manager state and the R1 button); a tables-panel unit test.

**F — `sr/qr-guide` (change.md): R3.** Rewrite `/guides/qr-links` to the existing card. Test: `src/guides/qr-links-guide.test.ts` asserts that no "Base address", "Our link" or `192.168` text remains.

**G — `sr/role-read-only` (change.md): S26, S27.**
- One read-only line in Publish, «Само собственици и администратори могат да променят това.» / "Only owners and admins can change this."
- The header shows the venue state («Актуално…» / "Up to date…") without the button.
- A section the person may not open redirects to General, so the address matches the page; the same redirect for `/settings/deleted-venues` instead of the 404.
- Screen plan: states for the manager on each section.
- Tests: `automation-settings.test.tsx`, `settings-nav.test.tsx`, `e2e/owner-settings.spec.ts`.

**H — `sr/auth-pages` (bug.md): S28 (language switch), S29.**
- `LocaleToggle` on `/no-organization`.
- `aria-invalid` on both inputs and `aria-describedby="login-error"` after a failed sign-in.
- Tests: `login-form` test (WCAG 3.3.1); a page test for `/no-organization`.

**I — `sr/reauth-guards` (bug.md, Opus: auth and security; `security-review` on the PR): C1, C2, C3, X1, X2.**
- Read: D122 §7, RR-84, RR-88.
- After re-sign-in, `organization.setActive` to the page's organisation before the retry; try/catch/finally in `submit()`.
- `onSharedDevice` on the QR route (404) and on the print page (the own-sign-in notice).
- One `isFreshSignIn` guard answering `sign_in_again`, wired to the existing password dialog, on organisation rename/slug, POS credentials and the systems list, venue rename/slug/delete/purge/unpublish and the tables writes; `freshSignIn: true` on `table_code.reissue`.
- `/update-user` added to `DISABLED_HTTP_PATHS`.
- Tests:
  - X1: `organization-actions.test.ts`, `venue-lifecycle-actions.test.ts`, the integration and tables action tests, each with a 16-minute-old `signedInAt` getting `sign_in_again` and nothing moving.
  - X2: `auth.test.ts`'s 404 list.
  - C3: the shared-device row for the QR route in `src/server/security/attack-table.ts`.

**Other lanes:** lane 6 takes S15, S16 (the link) and S17. Lane 4 takes S9.

**Filed as issues instead of fixed:**
- **S10's "Deleted venues" → "Archived" rename:** an open question, because D76 and D83 name the page and the button "Deleted venues" / "Delete permanently" and the glossary contradicts them. My recommendation is to keep the decisions' words and add a glossary note.
- **S28's contact line:** needs the real contact address or link (a fact Martin holds). My recommendation is a support e-mail from config, with the line hidden until one is set.
- **"till"/"каса" strings outside this lane** (Studio 637, 746, 1108, 1428; Tonight 2332–2413): a note to the lanes that own those screens; Tonight's staff wording may be intended.
- **The Next.js upgrade:** already #202.

## Re-check (D146 step 6, Opus, 2026-11-20)

Branch `sr/lane5-walk` at ab3e1bfc. Fresh `restro_lane5` (migrate, roles, seed:dev, seed:demo); web on lane5.localhost:3150, worker on 8151, sim-pos on 4750 (club-biad). Accounts: owner@club-biad.test, manager@club-biad.test, noorg@lane5.test (created with no organisation by a scratchpad script).

- S1: re-verified. bg at 390 px, hand-made venue with a long name: the badge is at 53,401–121,423; Rename, Move up, Move down and Delete sit at y 431–475 and Open at 479–523, each 44×44. Nothing overlaps and scrollWidth is 390. en at 390 px, Club Biad: name and badge share one line (369–391) and the buttons are at 400–444 with no overlap.
- S2: re-verified. Both tablists have overflowY hidden (venue tablist clientHeight 36, scrollHeight 37), so no vertical scrollbar appears.
- S3: still-open. The page no longer scrolls sideways (1024: scrollWidth 1024), but the venue section tablist still overflows at 1024 and 1280 (details in N1).
- S4: re-verified. A venue that has not synced shows "Още не е синхронизирано" and no "Last run: Other". The history shows "Прочетени маси".
- S5: re-verified. The run is named "Прочетени маси" with counters (Изброени 79, Добавени 79, …). Integrations reads "Последно изпълнение: Прочетени маси · Завършено".
- S6: still-open, then split: the original row is fixed; the disabled Sync is issue #486. /settings/integrations now shows Status "Свързано" and Last check 20.11.2026 13:05, which agree. But the seed still stores no POS credentials: the API user is empty and the password field is empty with no placeholder. Because of that, "Синхронизирай всичко сега" is disabled under "Първо запазете данните за достъп до test POS", and the venue's "Синхронизирай това заведение" is disabled too, so the demo cannot sync.
- S7: re-verified. Step 1 of the new-venue flow shows "test POS / Няма свободни заведения", disabled.
- S10: re-verified (strings). bg reads "Менютата идват от test POS" and en "The menus come from test POS". The headings are "Източник" / "Source", and no walked page says "till". Note: messages key `tables.empty.description` still says till/каса; it is allowlisted in messages.test.ts lines 52 and 67.
- S11: re-verified. A hand-made venue's Studio shows "Още няма секции / Създайте секция, за да започне менюто."
- S12: re-verified. The section is named "Синхронизиране и публикуване", with "Синхронизиране от test POS". Footer: "Запазването прави тези настройки собствени на заведението."
- S14: re-verified (Fix plan E). The area index jump links are 44 px tall. The intro is one sentence and the card is 254 px (it was about 330). The selects read "Менюто на заведението" and "Предварително плащане: Като на заведението (Включено)" and are not clipped; en reads "The venue's menu". Caveat: the page is still 23,048 px tall at 390 px (see also N4).
- S18: re-verified. The staff segmented controls are 110×44 and 44×44. "Виж на картата" and the Reservations „Работно време“ link both have a tap area (::after max(100%, 44px)). The guide's back link is 182×44.
- S19: re-verified. The sidebar item wraps instead of being cut off: at 1280 it is 96 px tall with white-space normal; at 390 it takes 3 lines, 76 px.
- S20: re-verified. The dismiss button reads "Запази заведението" and the typed name is kept (D76).
- S21: re-verified. Page titles: "Общи · Restro", "Интеграции · Restro", "Изтрити заведения · Restro", "QR кодове · Club Biad Sofia · Restro". "Състояние" appears once (the other label is now "Връзка").
- S22: re-verified. The print page at 390 has scrollWidth 390, 76 codes, and reads "76 кода на 13 страници".
- S23: re-verified. "Възстанови" is the filled button (variant default, bg-primary); "Изтрий завинаги" is outline.
- S24: re-verified. Versions reads "Публикувана ръчно". General reads "Останалите настройки не се променят оттук." Alerts uses „…“ (U+201E/U+201C) and no «». en reads "The venue's menu".
- S25: re-verified (manager, en, 390). The page reads "Only owners and admins can see the codes. They also change the areas, tables and menus." It shows no Print or test-link button and 0 QR images. The print page also says "Only owners and admins can see the codes."
- S26: re-verified. The staff and alerts addresses redirect to ?section=general. /settings/deleted-venues redirects to /settings/general (200).
- S27: re-verified (manager). The Publish section shows "Only owners and admins can change this." with 8 disabled controls. The header shows "Up to date: guests see the latest version." with no Publish button.
- S28: re-verified (language switch only). /no-organization has BG/EN buttons at 44×44; switching gives "Още няма организация"; scrollWidth is 390.
- S29: re-verified. After a wrong sign-in both inputs have aria-invalid="true" and aria-describedby="login-error", and p#login-error has role=alert.
- R1: re-verified. With 76 of 76 tables coded there is no Create button, and "Print sheet" is the filled button (variant default).
- R2: re-verified. A hand-made venue with 0 tables shows no Print button.
- R3: re-verified. The guide no longer mentions "Base address", "Our link" or 192.168, and it quotes the existing card.
- R4: re-verified. The print page title is "QR кодове · Club Biad Sofia · Restro".
- R5: re-verified. This lane's error strings now read "Restro couldn't … Nothing changed; try again." The 5 "Something went wrong" strings that remain belong to other lanes' keys (en.json lines 749, 826, 1710, 1752, 1990).
- R6: re-verified. A MutationObserver saw the section tabs go from the Studio subtabs straight to all 9 sections, with no 6-tab skeleton.
- R7: re-verified. The "Настройки → Интеграции" link opens /settings/integrations.
- R8: re-verified (strings only). The run kinds read "Пълно четене / Full read" and "Четене на промените / Changes read". The seed has no barsy connection, so the screen itself could not be walked.
- C3: covered by tests. The seed has no shared-device account to walk with.
- Trial S1: re-verified. With the worker stopped, the print page shows "Кодовете не се показват в момента." instead of "create codes first"; with the worker up it shows 76 codes. Caveat: the print page gives no try-again hint (the card does, see trial S2).
- Trial S2: re-verified. With the worker down, the card shows "Кодовете не се показват в момента.", an "Опитай пак" button and a disabled test link. After the worker restarted, "Опитай пак" brought back 76 QR codes and a working test-link <a>.
- Trial S19: re-verified. A wrong code returns 404 with the "not active" page. After 52 wrong codes, even a valid code returns 429 with Retry-After 900 and "Менюто не може да се отвори в момента. Опитайте пак след минута." (see N3). The 503 case was checked only in code (table-token.ts inactivePage).

### New regressions

- N1 (fix in flight, #471): Venue settings section tablist (all 9 sections), at 1024 and 1280. The tablist has `justify-center` plus `overflow-x-auto`, so when it overflows the first tab is clipped on the left and cannot be scrolled to (scrollLeft cannot go negative). Measurements: bg 1024, "Общи" at 150–207 while the list starts at 288; en 1024, "General" starts at 256 while the list is 288–992; bg 1280, the first tab is at 278 against a list start of 288, scrollWidth 958 vs clientWidth 945. The horizontal scrollbar also squeezes the tabs to 14 px tall (clientHeight 21). The longer "Синхронизиране и публикуване" / "Sync and publish" label from S12 likely tipped it over. Fix: justify-start (or `safe center`) and room for the scrollbar.
- N2 (fix in flight, #471): The delete dialog on a hand-made venue (vn_4bujhu4LTUgY7KUsckJkBL) still lists the bullet about releasing the POS link, which does not apply to a venue with no POS.
- N3 (issue #485): The 429 page on /t/<code> says "Опитайте пак след минута" (try again in a minute), but the block lasts 15 minutes (Retry-After 900, bad-codes.ts blockMs).
- N4 (fix in flight, #480): The Tables area index lists "Каса 0", an empty POS-till area, at the top of the guest-facing area list.
- N5 (another lane, polish; noted on #475): Studio guest-features text says "с следващото"; Bulgarian needs "със следващото".

### Servers

The web server (preview_stop), worker and sim-pos were stopped along with their process trees. Afterwards nothing listened on 3150, 8151 or 4750, and no sr-setup-78027c node process was left.
