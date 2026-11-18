# Screen review, trial round, 2026-11-18: Tables & QR and the guest menu

Explorer pass (step 2, Sonnet). Worktree `or/screen-review-flow`, dev server on 3300, database `restro_screen_review` seeded with `pnpm db:seed:demo` (Club Biad Sofia). The explorer saw venue `vn_5iAwtVrcSW7xORpkp1K3NO`; ids and the guest address change on reseed. The worker and the simulated POS were not running during this pass. Screenshots are beside this file as `S<n>-before.jpg`. Rows are candidates with no severity. The `/t/<code>` table page could not be reached because only the worker opens codes.

### S1. The print sheet says no table has a code, while the tab says 76 of 76 have one
- Kind: bug
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO/tables/print`, owner, 1280x800, dark, bg
- Steps: open Tables & QR (it reads "76 маси, 76 с код"), then press "Лист за печат".
- Expected: the sheet lists the codes, or says plainly that they cannot be shown now. An owner must not be told to "create the codes first" when they exist (`copy-rules.md` rule 4: an error names the fix).
- Saw: "Още няма маса с код. Първо създайте кодовете в раздел „Маси и QR“." The console shows `table_code_reveal_failed` (TypeError). This is probably caused by the missing worker, but the wrong message could send an owner to press "Създай кодове" again.
- Check: walk (bug); ux-copy: error messages
- Evidence: S1-before.jpg; console `{"level":"error","event":"table_code_reveal_failed","error":"Error","message":"TypeError"}`
- Proposal: when codes exist but cannot be opened, show "Кодовете не могат да се покажат сега. Опитайте пак след малко." / "The codes cannot be shown right now. Try again in a moment." Keep the empty text for "no code exists".
- Status: ticket (#441)
- Verdict: confirmed for the wording only. The empty reveal came from the worker being down (with the worker up, the lead saw 76 codes on 13 pages). But `print/page.tsx` shows `print.empty` ("create the codes first") whenever nothing was revealed, even when `view.coded > 0`, which is wrong whenever the worker really is down. Checked from code
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: A (#441)

### S2. "Кодовете се зареждат…" never ends and the test link stays disabled
- Kind: bug
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, owner, 1280x800, dark, bg (en: "Loading the codes…")
- Steps: open Tables & QR, wait, then reload and wait 5 s.
- Expected: a wait over a second ends in a result, or in a failure that says what to do (`operational-screens.md` feedback 2; ux-copy: loading states).
- Saw: the line stays. "Отвори тестовия линк" stays disabled, and every card shows the dashed QR placeholder. `use-revealed-codes.ts` draws a code the worker does not give "as none", with no failure state. The cause is the same as S1 (worker down).
- Check: operational-screens → feedback 2 (what failed); ux-copy: loading states
- Evidence: S2-before.jpg; `apps/web/src/tables/use-revealed-codes.ts` (failure swallowed)
- Proposal: once the reveal answers with none or fails, replace the line with "Кодовете не се показват. Опитайте пак." / "The codes are not showing. Try again." and add a retry button.
- Status: ticket (#441)
- Verdict: confirmed for the failure state only. `use-revealed-codes.ts` drops a failed or empty reveal silently, and `qr-address-card.tsx` keeps `testLinkLoading` while `coded > 0` and there is no sample. With the worker up the line resolves (the lead saw the test link live)
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: no (operational-screens, feedback 2)
- Fix: A (#441)

### S3. Three paragraphs of explanation come before the first table on a phone
- Kind: simplification
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, manager, 390x844, dark, bg
- Steps: open Tables & QR at 390 px and scroll to the first area.
- Expected: the purpose is clear within two seconds and the job is a few taps away (`operational-screens.md` screen read Q2; Clean rule 2, "remove one thing"; D107).
- Saw: after the title come three paragraphs (how a QR works, where zones come from, which menu is live), two buttons and an "Адрес в кодовете" card. The first area header is about three screens down. The first paragraph explains the UI itself ("действията са в менюто на картата").
- Check: operational-screens → Clean rule 2
- Evidence: S3-before.jpg
- Proposal: keep one line, "Всяка маса може да има QR код; гостът го сканира и вижда менюто." / "Each table can have a QR code; a guest scans it and sees the menu." Move the rest next to the controls it explains.
- Status: confirmed
- Verdict: confirmed. `intro`, `introTill` and `venueMenu`, then two buttons and the address card, come before the first area; `intro` describes the UI itself
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: yes
- Fix: C

### S4. 76 tables are one endless list of cards: 24,900 px on a phone
- Kind: simplification
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, manager, 390x844, dark, bg
- Steps: open at 390 px and read `document.documentElement.scrollHeight`.
- Expected: one reading order with the right thing emphasised. A manager finding one table at 03:00 should not scroll 29 screens (`operational-screens.md` screen read Q3 and Q4; the persona).
- Saw: 79 cards of 276 px each, every one with two full-width Selects (menu, pay first) that almost always read "as the venue". Page height is 24,922 px, with no search, no folded area and no jump to an area.
- Check: operational-screens → screen read Q3
- Evidence: S4-before.jpg; `scrollHeight` 24922 at 390 px; `[data-testid=table-card]` count 79
- Proposal: fold the areas (one open at a time) with the table count in each header, and show the two Selects only where a table differs from its area. "Покажи 18 маси" / "Show 18 tables".
- Status: confirmed
- Verdict: confirmed. `table-card.tsx` draws both pickers on every card; no folding, search or jump to an area
- Severity: Before the pilot
- Effort: M
- Decision: none
- Needs Martin's yes: yes
- Fix: C

### S5. Each card says the same thing three times
- Kind: simplification
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, owner, 390x844 and 1280x800, dark, bg and en
- Steps: look at any table card.
- Expected: a label, border or badge appears only when the content has that structure (`operational-screens.md` Clean rule 1).
- Saw: the name field shows the POS name as a grey placeholder ("2") and the line under it repeats "от test POS: 2". The green "Кодът е активен" badge is on all 76 cards, although only a switched-off code is the exception. The chip "Бар: Бар 2" repeats the bar of the whole area and doubles the word.
- Check: operational-screens → Clean rule 1
- Evidence: S5-before.jpg
- Proposal: show "Кодът е изключен" / "Code off" only when off. Drop "от test POS: N" when the name is not overridden. Show the bar only where it differs from the area's.
- Status: confirmed
- Verdict: partly confirmed: the "code active" badge on every card and the placeholder that repeats "от test POS: 2". Rejected for the bar chip: the table's bar ("Бар 2") differs from the area ("Бар 1 / 2") and shows only when payment tables apply; the doubled word is a nit
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: yes
- Fix: Polish table (folds into C)

### S6. A stray vertical scrollbar sits on the tab strip
- Kind: bug
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, owner, 1280x800, dark, bg (Windows classic scrollbar)
- Steps: open any venue tab at desktop width and look at the right end of the tab strip.
- Expected: the tab strip does not scroll (`operational-screens.md` Clean rule 1: nothing on screen that does no job).
- Saw: `[role=tablist]` is 36 px high with `overflow: auto` and `scrollHeight` 37, so a small up/down scrollbar shows at its right edge.
- Check: walk (bug)
- Evidence: S6-before.jpg; selector `[role=tablist]`, `scrollHeight` 37 > `clientHeight` 36
- Proposal: set `overflow-y: hidden` on the strip, or give it 1 px more height at desktop.
- Status: confirmed
- Verdict: confirmed. `workspace-tabs.tsx` sets `overflow-x-auto`, which makes the y axis `auto` too; 37 > 36 shows a Windows classic scrollbar
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: Polish table

### S7. Areas are not headings: each area name is only a text field
- Kind: bug
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, owner, 1280x800, dark, bg
- Steps: list the headings in the accessibility tree (`h1,h2,h3`).
- Expected: structure is in the markup, so a screen-reader user can jump from area to area (WCAG 2.2 1.3.1; `operational-screens.md` Accessibility).
- Saw: the only headings are H1 venue, H2 "Маси и QR кодове" and H3 "Адрес в кодовете". The six areas and their table counts are inputs with the hidden label "Име на зоната", not headings or labelled groups.
- Check: accessibility-review: 1.3.1
- Evidence: DOM: heading list; `input` with label "Име на зоната"
- Proposal: wrap each area in a `section` with `aria-labelledby` pointing at its name field, or add a visually hidden H3 "Бар 1 / 2, 18 маси" / "Bar 1 / 2, 18 tables".
- Status: rejected
- Verdict: rejected. Each area is a `<section aria-label={hall.name}>` (`area-section.tsx:124`), a named region a screen reader can jump to, so 1.3.1 is met; read-only roles also get an `<h3>`. The explorer missed the named sections

### S8. The "new code" dialog's dismiss button says "Отказ" / "Cancel"
- Kind: bug
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, table "…" menu then "Нов код", owner, 1280x800, dark, bg and en
- Steps: press "…" on a table, then "Нов код".
- Expected: buttons name the action and the way out, never OK / Cancel (`copy-rules.md` rule 11; `operational-screens.md` Patterns, "Remove a thing for good").
- Saw: the title and body are good ("Новият код заменя стария…") and the confirm is "Направи нов код". The other button is "Отказ" (`confirm-dialog.tsx` defaults `cancelLabel` to `t('cancel')`). This is a known divergence in the Patterns table (about 21 strings); it is listed here so the reviewer can merge it.
- Check: ux-copy: confirmation dialogs; operational-screens → Patterns
- Evidence: S8-before.jpg; `apps/web/src/tables/confirm-dialog.tsx`
- Proposal: "Остави стария код" / "Keep the old code".
- Status: confirmed
- Verdict: confirmed; a duplicate of #60 row 7 (every dialog's dismiss says Cancel, about 21 strings)
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: yes (#60 is his pick list)
- Fix: #60 row 7, no new ticket

### S9. The three code dialogs ask in three different voices in Bulgarian
- Kind: simplification
- Screen: table "…" menu dialogs on `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, owner, 1280x800, dark, bg
- Steps: open "Нов код" and "Изключи кода", and read the delete-table string.
- Expected: same terms and same shape for the same job (ux-copy principle 3; `copy-rules.md` rule 3).
- Saw: bg `tables.confirmNew.title` is "Нов код за маса {table}?" (a noun phrase). `confirmOff.title` is "Да изключа ли кода на маса {table}?" and `confirmDeleteTable.title` is "Да изтрия ли маса {table}?" (the app speaks as "I"). The English is "Make a new code…?" and "Turn off the code…?" in one voice.
- Check: ux-copy: principle 3 (consistent)
- Evidence: `apps/web/messages/bg.json` lines 1634-1648; `apps/web/messages/en.json` lines 1635-1646
- Proposal: "Да направя ли нов код за маса {table}?" / "Make a new code for table {table}?", so all three share the "Да … ли …?" form.
- Status: confirmed
- Verdict: confirmed (`bg.json`: "Нов код за маса {table}?" beside "Да изключа ли…" and "Да изтрия ли…")
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: Polish table

### S10. The Pay first Select: "On" has no explanation, "Off" has one
- Kind: simplification
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, Pay first Select of a table, manager, 390x844, dark, en
- Steps: open "Pay first: Same as the venue (On)".
- Expected: options whose consequence needs a sentence carry it (`operational-screens.md` Patterns, "Pick one of a few"); the wording is clear (ux-copy principle 1).
- Saw: the options are "Same as the venue (On)", "On" and "Off: everything on the bill". "On" does not say what the guest must do, while "Off" does.
- Check: ux-copy: principle 1 (clear)
- Evidence: S10-before.jpg
- Proposal: "On: guests pay before the order is sent" / "Включено: гостът плаща, преди поръчката да тръгне".
- Status: confirmed
- Verdict: confirmed (`pf_t_on` "On" / `pf_t_off` "Off: everything on the bill"). The explorer's proposal is inaccurate: "On" means pay-first items are paid when sent. Corrected: "Включено: артикулите за предварително плащане се плащат при изпращане" / "On: pay-first items are paid by card when sent"
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: Polish table

### S11. On a phone the area's "…" menu floats alone under the two Selects
- Kind: bug
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, manager, 390x844, dark, bg
- Steps: open at 390 px and look at the first area header.
- Expected: a row's secondary actions sit with the row (`operational-screens.md` Patterns, "The secondary actions of a row"); interactive elements are obvious (design-critique §2).
- Saw: the area name field and "18 маси" come first, then the Menu Select, then the Pay-first Select, then a lone "…" button on its own line, about 100 px away from the name it acts on. The two Selects have different widths.
- Check: design-critique §2: interactive elements obvious
- Evidence: S11-before.jpg
- Proposal: put the "…" on the name line, as at desktop, and give the two Selects the same width.
- Status: confirmed
- Verdict: confirmed. In `area-section.tsx` the actions block wraps below the grid holding both pickers
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no (Patterns: a row's secondary actions sit with the row)
- Fix: Polish table (folds into C)

### S12. Guest dish page: name and price are said twice, with a large empty middle
- Kind: simplification
- Screen: `/m/club-biad/club-biad#item-nd_4CMFjsbjyc7lfgKFuDZEqx`, guest, 390x844, dark, bg
- Steps: tap "ABSOLUT VODKA 0.7".
- Expected: the Style is loud in one place and quiet around it, and whitespace works (`template-review` step 4; design-critique §3).
- Saw: the sheet shows the large name and price, then about 600 px of empty dark, then a bottom bar that repeats "ABSOLUT VODKA 0.7  95,00 €". This seed item has no description or photo, so the sheet looks unfinished. No order control is offered, which is expected without a table.
- Check: design-critique §3: whitespace; template-review step 4
- Evidence: S12-before.jpg
- Proposal: show the bottom bar only when it carries an action ("Добави" / "Add to bag"), and size the sheet to its content.
- Status: confirmed
- Verdict: confirmed as a design opinion. `detail.tsx` shows the bar only when the dish cannot be ordered, so it is deliberate in the Style; it also repeats the name three times for a screen reader
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: yes (a face, D105; template-design flow)
- Fix: Polish table

### S13. The sticky section strip is see-through: content shows above the chips
- Kind: bug
- Screen: `/m/club-biad/club-biad?lang=en`, guest, 390x844, dark, en
- Steps: tap COCKTAILS in the strip.
- Expected: text never sits behind a sticky bar so that it reads as clutter (`template-review` step 4; §7.5 floors).
- Saw: after the jump a dark "12" (an allergen code of the previous item) shows at the top-left edge of the strip, behind "BOTTLES".
- Check: template-review step 4
- Evidence: S13-before.jpg (top-left corner)
- Proposal: make the strip's background opaque, or clip the content at the strip's top edge.
- Status: confirmed
- Verdict: confirmed on screen at 375 px in English; `.rm-sections` is sticky with a background at 0.96 opacity
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: Polish table

### S14. A dead table code is a dead end, shown in two languages at once
- Kind: simplification
- Screen: `/t/abc123` (an unknown code), guest, 390x844, dark and light, bg and en together
- Steps: open any code that is not active.
- Expected: an error says what happened, why, and what to do (ux-copy: error messages), and the guest can still reach the menu (design-critique §2).
- Saw: "Този код за маса не е активен. Попитайте персонала." followed by the same in English. There is no venue name, no link to the venue's menu and no language choice (HTTP 404). Contrast is fine (4.75:1 dark, 5:1 light).
- Check: ux-copy: error messages (the middle part, why); design-critique §2
- Evidence: S14-before.jpg; HTTP 404
- Proposal: add a "Виж менюто" / "See the menu" link to the venue's `/m/...` page where the code belongs to a venue, and show one language chosen by the browser.
- Status: rejected
- Verdict: rejected by design. `table-token.ts` says the page names no venue: an unknown code carries no venue and the page must not help someone guessing codes (#70); both languages are deliberate on a page with no context. The real fault on this page is S19

### S15. The layout switch has three names for two ideas and shows no change
- Kind: simplification
- Screen: `/m/club-biad/club-biad`, guest, 390x844, dark, bg
- Steps: tap "1 колона" next to "Списък", then reload.
- Expected: similar elements behave similarly (design-critique §4), and a control changes what the guest sees.
- Saw: the radios are named "Списък", "1 колона", "2 колони". With no photos in this seed, "Списък" and "1 колона" look identical, so the tap seems to do nothing. The choice persists after reload.
- Check: design-critique §4: similar elements behave similarly
- Evidence: S15-before.jpg (after "1 колона"), against the first guest screenshot with "Списък"
- Proposal: name the options for what they show ("Списък", "Със снимки", "Мрежа" / "List", "With photos", "Grid"), or hide the switch where no item has a photo.
- Status: confirmed
- Verdict: confirmed on screen: "Списък" and "1 колона" look the same with no photos; the switch shows whenever `layout.guestSwitch` is on, with no check for photos
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: yes
- Fix: Polish table

### S16. English: "Menu: Venue's (Club Biad Sofia)"
- Kind: simplification
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, any area or table card, owner, 1280x800, dark, en
- Steps: switch the language to English in the user menu, then read a card.
- Expected: strings read as English and use the glossary's words (`copy-rules.md` rule 9; ux-copy: localization notes).
- Saw: "Menu: Venue's (Club Biad Sofia)" reads as a possessive with nothing after it. The Bulgarian "На заведението" reads clearly as "of the venue".
- Check: ux-copy: localization notes
- Evidence: DOM text of `[role=combobox]`, aria-label "Menu for table 2"
- Proposal: "Menu: Same as the venue (Club Biad Sofia)" / "Меню: Като на заведението (Club Biad Sofia)", matching the Pay first wording.
- Status: confirmed
- Verdict: confirmed. `route.inheritVenue` reads "Venue's ({menu})" / "На заведението" while the pay-first picker on the same card says "Same as the venue" / "Като на заведението"; in both languages
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: Polish table

### S17. The table name field looks like a disabled value
- Kind: simplification
- Screen: `/venues/vn_5iAwtVrcSW7xORpkp1K3NO?tab=tables`, table card, owner, 1280x800, dark, bg
- Steps: look at the card's "Име, което виждат гостите" field.
- Expected: interactive elements are obvious (design-critique §2).
- Saw: the field is empty and shows the POS name ("2") as grey placeholder text next to the line "от test POS: 2". It reads as a read-only value rather than a place to type a different name.
- Check: design-critique §2: interactive elements obvious
- Evidence: S17-before.jpg; input `data-testid=table-name`, `value=""`, `placeholder="2"`
- Proposal: placeholder "Като в test POS (2)" / "Same as in test POS (2)", or show the POS name as the real value with a "Върни" / "Reset" action.
- Status: confirmed
- Verdict: confirmed. `placeholder={row.number}` shows "2" in grey; near #60 row 2 (the rename pattern) but a different fault
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: Polish table (folds into C)

### S18. "Create codes for all tables" stays the main button when every table already has one (reviewer)
- Kind: simplification
- Screen: `/venues/<id>?tab=tables`, owner, 1280x800, dark, bg
- Steps: open Tables & QR on the seeded club (76 of 76 tables have a code) and look at the buttons under the count.
- Expected: the right thing is emphasised (`operational-screens.md` screen read Q4). With every table coded, the job left is printing.
- Saw: "Създай кодове за всички маси" is the filled primary button and "Лист за печат" the outline one. Pressing the primary only answers "Всяка маса вече има код."
- Check: operational-screens → screen read Q4
- Evidence: S6-before.jpg ("76 маси, 76 с код" above the filled button); `apps/web/src/tables/tables-panel.tsx:159` (the button does not depend on `coded < total`)
- Proposal: when every table has a code, make "Лист за печат" / "Print sheet" the primary and the create button outline (or hide it).
- Status: confirmed
- Verdict: confirmed, from code and the explorer's screenshot
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: Polish table (folds into C)

### S19. A guest with a good sticker is told the code is "not active" when the server cannot read codes or the guest's network is blocked (reviewer)
- Kind: bug
- Screen: `/t/<code>`, guest, 375x812, dark, bg+en
- Steps: open a valid code while the publish store cannot be read (503), or from a network the wrong-code guard has blocked (429). A club's Wi-Fi or a carrier's shared address can be blocked by someone else's wrong codes.
- Expected: an error names what happened and what to do (`copy-rules.md` rule 4). "Not active" sends staff to make new codes for a code that works.
- Saw: `inactivePage(503)` and `inactivePage(429)` return the same body as the 404: "Този код за маса не е активен. Попитайте персонала." The 404 was seen on screen; the 503 and 429 are read from code.
- Check: copy-rules rule 4; ux-copy: error messages
- Evidence: `apps/web/src/server/publish/table-token.ts:90-142` (`inactivePage(status)` uses one body for every status; the 429 check runs before the code is looked up); `/t/abc123wrong` seen on screen
- Proposal: a second body for 503 and 429: "Менюто не може да се отвори в момента. Опитайте пак след минута." / "The menu can't open right now. Try again in a minute."
- Status: ticket (#442)
- Verdict: confirmed, from code
- Severity: Before the pilot
- Effort: S
- Decision: none (D122 sets the limits, not the words)
- Needs Martin's yes: no
- Fix: B (#442)

### S20. The allergen sheet tells the guest to "tap a code" while it already lists every code with its meaning (reviewer)
- Kind: simplification
- Screen: `/m/club-biad/club-biad`, guest, 320x700, light, bg
- Steps: tap the "12" chip under Moët & Chandon.
- Expected: an instruction matches what the screen does (ux-copy principle 1, clear).
- Saw: "АЛЕРГЕНИ / Докоснете код, за да видите какво означава." above a plain list (1 Глутен, 7 Мляко, 12 Сулфити, the tapped one marked `aria-current`). Nothing in the sheet can be tapped.
- Check: ux-copy: principle 1 (clear)
- Evidence: DOM of `[role=dialog]` (`li` items, no buttons); `packages/shell/src/strings.ts:446, 807` (`allergensHint`)
- Proposal: "Кодовете при всяка позиция означават:" / "The codes on each item mean:", or drop the line.
- Status: confirmed
- Verdict: confirmed
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: Polish table

## Works

- **Tables & QR (admin):**
  - Bulgarian and English are both complete, in dark and light.
  - Light-theme contrast holds (muted text 6.0:1, badge 6.9:1 at 12 px).
  - There is no horizontal scroll at 390 px.
  - Targets are 44 px on the phone; the breadcrumb link has a `tap-area`.
  - The table "…" menu has Move up / Move down, which covers WCAG 2.5.7.
  - The "Нов код" dialog names its consequence and what happens to printed stickers.
- **Guest menu:**
  - The BG/EN switch works and keeps the page.
  - The section strip scrolls and marks the current section.
  - Targets are 44 px.
  - The focus ring is visible (2.67 px outline).
  - Contrast was checked on the badge (5.1:1), the language switch and the chips.
  - The allergen block sits at the foot.
  - The layout radios have names and `aria-checked`.
  - The dish sheet has a labelled close button at 44 px.
- **Dead code:** `/t/<unknown>` answers 404 with a plain two-language message.

## Could not see

- **Table codes and everything under them:**
  - Codes and QR images are revealed only by the worker (`use-revealed-codes.ts`).
  - So the QR dialog, the print sheet with codes, "Създай кодове за всички маси" and "Отвори тестовия линк" could not be followed.
  - A real `/t/<code>` page was not reached, so Call a waiter, the bag, the bill, Pay and Receipt were not seen.
  - Only `/m/...` and the dead `/t/abc123` were walked.
- **Writes:** "Използвай като маса за плащане", turning a code off, and the Pay-first write were opened but not confirmed, so no write was made.
- **Device lines for Martin's phone:**
  - one-handed reach of the 44 px "…" on cards;
  - a screen reader on the Selects and areas;
  - the keyboard over the name field;
  - glare in a dark room;
  - a real slow connection.
- **Dev server only, not findings:**
  - The guest page first shows a long grey skeleton, and dev timing means nothing.
  - Next's dev badge ("1 Insight") sits over the user menu at the bottom of the sidebar.
- **Not run beyond the 390 px checks:** 320 px, 200 % zoom, and hover-only actions.

## Review (step 4, Opus, fresh database)

**How it ran.** The reviewer was started with only this ledger's path and the commit (`0e3c253f`), after a reset and reseed, with the worker and the simulated POS now running. The browser pane lost its sign-in during its pass (the cause was not found), so it checked the admin rows S1–S11, S16 and S17 against the code, the message files and the explorer's screenshots, not on screen. The guest rows were walked on screen. Afterwards the lead signed in again and saw, with the worker up: the test link live (`/t/<code>`), the print sheet with 76 codes on 13 pages, and a real table page ("Маса 2", add buttons, bill and service icons). That confirms the reviewer's reading of S1 and S2 (wording only). Neither pass walked the service screens under a table (Call a waiter, bag, bill, Pay, Receipt).

**Blind-walk notes (before reading the ledger).** Guest menu at 375 and 320 px, dark and light: no horizontal scroll; chips, radios, BG/EN and allergen buttons at 44 px. Every item carries "НОВО" (seed data). The allergen sheet's hint asks for a tap where nothing can be tapped (S20). The dish sheet without a table repeats the name and price (S12). `/t/<wrong>` is a deliberate venue-less 404; reading `table-token.ts` showed 503 and 429 get the same "not active" text (S19).

**Rule used for "Needs Martin's yes":** a fix that moves a screen onto an existing rule or pattern needs no yes; a new look or a new behaviour does.

## Fix plan

**A (#441). bug: Tables & QR says "no codes" or "loading" forever when the codes cannot be shown (S1, S2), through `bug.md`.**
- When the reveal fails or returns nothing while `coded > 0`, the tab replaces "Кодовете се зареждат…" with "Кодовете не се показват в момента." / "The codes can't be shown right now.", plus "Опитай пак" / "Try again", which asks once more. The print page shows the same sentence instead of `print.empty`.
- Regression tests (D67): `src/tables/tables-panel.test.tsx` (the reveal answers `failed` → the failure line and Retry); a print-page test (`coded > 0`, nothing revealed → the new text, not `print.empty`).
- Restro block: Sonnet; agent session; branch `or/tables-codes-unavailable` from `or/foundation`; read `operational-screens.md` (Wayfinding, screen read and feedback), `copy-rules.md`, the header of `src/server/reveal.ts` (#70); stop and ask if a retry would write more reveal Log entries than #70 intends; menu functionality: none.
- Screen plan: as an owner I want to see my codes or be told why I can't. Pattern: what happened after a write (a failure names the fix). Primary action unchanged. States: failed added; loading ends in a result or the failure. Strings as above.

**B (#442). bug: the table-code page calls a good code "not active" on a 503 or 429 (S19), through `bug.md`.**
- Regression test: `src/server/publish/table-token.test.ts`; the 503 and 429 bodies carry the new text, the 404 body is unchanged.
- Restro block: Sonnet; agent session; branch `or/table-code-unavailable` from `or/foundation`; read D61, D122 §9, `table-token.ts`; stop and ask whether the 429 text should say nothing that helps someone guessing codes (recommendation: the same "try again in a minute" for both); menu functionality: none; screen: none (a wording change on a guest system page).

**C. change: Tables & QR on a phone (S3, S4; S5, S11, S17, S18 if Martin picks them), through `change.md`. Needs Martin's yes.**
- Regression tests: `e2e/tables.spec.ts` at 390 px: with the seed's 76 tables the page stays under a set height with the areas folded; the area "…" sits on the name line; the pickers show only on a card that differs from its area. `e2e/touch-targets.spec.ts` unchanged.
- Restro block: Sonnet; agent session; branch `or/tables-phone` from `or/foundation`; read D107, D123, `operational-screens.md`, `admin-map.md` (Tables & QR); stop and ask about folding (one area open, or all folded); menu functionality: none.
- Screen plan: as a manager I want to find table 33 and change its menu (today about 10 screens of scrolling then 2 taps; target: open its area, then 2 taps). As an owner I want to print all codes (1 tap; target 1, as the primary). Patterns: foldable sections for areas, the "…" menu for a row's secondary actions, a Select for the pickers. Primary action: Print sheet once every table has a code. States: empty; many (76); the longest Bulgarian area name; a read-only role; a POS venue (rename, reorder and hide only). Strings: "Всяка маса може да има QR код; гостът го сканира и вижда менюто." / "Each table can have a QR code; a guest scans it and sees the menu."; "Покажи {count} маси" / "Show {count} tables".

**S8:** a comment on #60 row 7, no new ticket.

### Polish table (for Martin to pick from)

| Row | What | Effort | Where it would go |
|---|---|---|---|
| S5 | Drop the "code active" badge on every card and the doubled "от test POS" line | S | C |
| S6 | Stray scrollbar on the venue tab strip (Windows) | S | `workspace-tabs.tsx` |
| S9 | One voice for the three code dialogs ("Да направя ли нов код…?") | S | messages |
| S10 | Say what "On" means in the pay-first picker | S | messages |
| S11 | Put the area "…" on the name line on a phone | S | C |
| S12 | Dish sheet: no repeated name-and-price bar without an action | S | face (template-design) |
| S13 | Opaque sticky section strip | S | face CSS |
| S15 | Hide or rename the layout switch when no item has a photo | S | face |
| S16 | "Same as the venue" in the menu picker too, in both languages | S | messages |
| S17 | Name-field placeholder "Като в test POS (2)" | S | C |
| S18 | Make Print sheet the primary once every table has a code | S | C |
| S20 | Allergen sheet hint matches the sheet | S | shell strings |

## Trial result: what each vendored skill added (D146, D109's gate)

| Source | Confirmed | Rows | Rejected |
|---|---|---|---|
| design-critique | 4 | S11, S12, S15, S17 | S14 |
| accessibility-review | 0 | none | S7 |
| ux-copy, alone | 4 | S9, S10, S16, S20 | none |
| ux-copy, beside Restro's checks | 2 | S1, S2 | none |
| Restro's own checks | 9 | S3, S4, S5 (part), S6, S8 (already #60), S13, S18, S19, and the Restro half of S1/S2 | none |

- Rows Restro's own checks alone would not have caught: S9, S10, S11, S12, S15, S16, S17, S20, all Polish.
- Every Before-the-pilot row came from Restro's own checks: S1, S2, S3, S4, S8, S19.
- accessibility-review found nothing new in this round (its one row was wrong). Round 1 of 3 toward D109's removal gate for that section; design-critique and ux-copy each found something new.
- Out of scope: the demo seed marks every item "НОВО".
