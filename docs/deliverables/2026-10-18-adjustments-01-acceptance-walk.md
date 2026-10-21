# Adjustments 01 acceptance walk (behaviour audit before Martin's acceptance)

> Filed 2026-10-18 by the lead (session "UI/UX skills for workflows"). Made by: audit session (Sonnet). For: #24. Source: the audit session's report and `audit-ad01-notes.md`. Status: see `docs/deliverables.md`.

## The audit session's report (verbatim summary, 2026-10-18)

Walked Pairs A to D and the wave-3 purge rehearsal of `docs/adjustments/adjustments_01-acceptance.md` on `ad/foundation`, as a behaviour audit, in a throw-away database `restro_audit_ad01`, in the built-in browser, both languages, phone width for guest pages. Web server on port 3100 (3000 was held), worker beside it for publish and purge.

| Check | Verdict |
|---|---|
| A: Integrations: picker, instance tab, status, system settings, sync-all button, history | Works with the seed's made-up instance. A real connection check, sync run and history need Martin. |
| A: Remove an instance | Remove works. "Refused while a venue uses it" needs Martin. |
| A: New venue, "from an instance's venue" | Needs Martin (hidden until the connection is verified). By hand works. |
| A: All venues cards | Works for state, address, source and preview link. Instance and till venue name need Martin. |
| A: Menu source card, common and connector parts apart | Needs Martin. |
| B: Settings › General, org and address name | Works. The old address redirects within about 15 s. |
| B: Deleted venues, restore and permanent delete | Works. Restore of a till venue needs Martin. |
| B: Venue tabs, Publish in the header with count and confirm | Works. |
| B: Settings › Publish automation rules | Needs Martin (till venues only). |
| B: Menus, several with one live, deleted menus for 30 days | Works. |
| B: Unpublish | Works, but awkward (S): only on the All venues card. |
| B: Versioning | Works for the live version. |
| C: Tables & QR | Works. |
| C: Till venue renames, reorders and hides | Needs Martin. |
| C: Structure | Works. Section delete confirmation not exercised. |
| C: "Overrides to review" badge | Needs Martin. |
| C: A till venue cannot create or delete till items | Needs Martin. |
| C: Guest page, photo strip and starting layout | Works. |
| D: Design cards, font dropdown, sticky preview | Works. |
| D: Colours | Works. |
| D: Header name "Name at top of menu" | **Broken**: saved, never reached the guest heading (became #27, fixed by PR 28). |
| D: Wording | Works, except the composer badge "От barsy" / "From barsy" (for Martin). |
| Wave 3: purge rehearsal | Works. The guide's "address never reissued" was stricter than D83 (guide corrected). |

**Tap counts (D107 baseline):** hide or show 1; sold out 2; rename a section 2 plus typing; publish 2; unpublish 2; delete a venue 3; restore 1; delete a menu 1; move an item 3; set a menu for an area 2.

**Works but awkward (S):** nine points, filed as #25. **Seed gap:** no real till venue in the dev seed, filed as #26.

## Appendix: the audit's running notes

# Audit ad/foundation acceptance walk: running notes (auditor session)

Env: worktree beautiful-sammet-3f2497 (HEAD f1332d4 = ad/foundation tip). DB restro_audit_ad01 on 54329, 28 migrations, seed:dev ok.
Web dev server on **port 3100** (3000 still held by PID 6932), worker on 8091 (needed: publish + purge jobs). Local-only files created (gitignored): .env.local, .env.worker.local. .claude/launch.json edited temporarily (port 3100 + worker) - revert at the end with `git checkout .claude/launch.json`.
Screenshots land in C:\Users\Martin\.claude\projects\E--Restro--claude-worktrees-beautiful-sammet-3f2497\8e2e5a40-012d-429c-96ef-aadba6cfec96\tool-results\ (file names quoted per finding).
Seed has only ONE account (owner@demo-club.test); no manager/member account. Seed venue "Demo Club Sofia" is a BY-HAND venue (source "На ръка"), plus an unverified barsy instance "barsy – dev-seed.test".

## Findings so far
- A / venues list: card shows Draft badge, address, Source "На ръка", Open, disabled Preview with a reason. mcp-Claude_Browser-blob-1792287674538-owmw3r.jpg
- A / Integrations: instance tab ok (connection, status "Още не е проверено", system settings, sync everything disabled "save credentials first", history empty). mcp-...-1792287689876-8x8evb.jpg
- A / systems picker: "barsy" checkbox is UNCHECKED although an instance exists ("1 връзка") - looks odd, ask.
- A / New venue dialog: only "На ръка" shown because the instance is unverified ("Още не е свързана каса" + link). Instance path => Needs Martin. Radio's accessible name is the raw value "hand".
- Venue created "Rehearsal": name came out "RehearsalRehearsal" (I typed twice because first typing did not show; dev server lag). Not confirmed as a bug - retest with a single type.
- Narrow content width (~590px, 800px window): Composer › Structure menu card overlaps (label "Подредба на менюто" over the menu switcher). Fine at 1440.

## Progress 2 (purge rehearsal + part of B/C done)
- "RehearsalRehearsal" NOT a bug: retest with a single type after the dialog hydrated gave "Rehearsal". My first keystrokes arrived late (dev server lag). Dropped.
- Venue name rename (Settings > General) ok. Venue address rename: old address redirects to new (client-side redirect, ~15 s). Org address-name rename (demo-club -> club-test): old /m/demo-club/rehearsal redirects to /m/club-test/rehearsal. Works.
- Menus: add (works, toast "Менюто е добавено."), delete non-live = 1 tap, no confirm, goes to "Изтрити менюта (1)" with "until 17.11.2026", Върни button. Live menu cannot be deleted (text says so). Works.
- Publish: header button disabled with text "Няма нищо видимо за публикуване: покажете поне един артикул в композитора" although the starter item was shown - real cause: item in "Неподредени" (no section). Hint misleading => Works but awkward (S).
- Publish = 2 taps (Публикувай, confirm dialog with Преглед/Отказ/Публикувай). Version 1 live banner persists across tabs.
- New hand venue starts with a starter item "Лимонада на къщата" (BG+EN, no price, unsorted, "2 проблема") and an empty "Тагове" group.
- Move item into a section = 3 taps (… > Премести в… > section; submenu opens far from the cursor, bottom-left of the menu).
- New section = 2 taps + typing (dialog: where / BG name / EN name optional). New zone+table+codes: zone (type+Enter), "+ Добави маса" (number + Enter), "Създай кодове за всички маси" = ~3 actions. Print sheet works (bilingual card, QR).
- Guest at 375px: /t/<code> opens /m/.../?t=..., chip "Table 1"/"Маса 1", BG/EN switch, section heading, layout radiogroup (Списък/1 колона/2 колони), starts in 2 columns as set. BG fine. Header says "Menu"/"Меню" (generic, not venue name). Item with no price shows no price.
- Delete venue: 3 steps (Изтрий заведението… > type name > confirm), dialog text clear. Deleted venues list shows "Изтрито на 18.10.2026 г., 4:49 · ще бъде изтрито окончателно на 17.11.2026 г." Restore = 1 tap, toast explains Draft + republish needed. While deleted: /t/<code> says "Този код за маса не е активен. / This table code is not active. Ask the staff.", /m/ address says "This menu is not available" (BG when lang=bg). After "Изтрий завинаги" (type name): toast "Rehearsal се изтрива. То напуска този списък сега."; purge-venue job completed within ~10 s; restro.nodes row gone; .local/cdn files for the venue gone; old addresses + table code answer not available. Works.
- Address NOT reserved after purge (D83 only tombstones public and table CODES): creating a new venue named Rehearsal got /m/club-test/rehearsal again. Dialog text says so; the guide says "(never reissued)" about address - guide wording stricter than behaviour (note for Martin).
- Needs Martin: restore "till linked again / says who holds the till venue" (needs a till venue); instance venues pick; sync history; Publish automation rules in Settings (till venue only - hand venue shows only Общи + Версии).

## Progress 3 (Sofia: structure, publish, unpublish, design)
- Seed oddity: Demo Club Sofia is source "На ръка" yet its sections/items carry "От barsy" badges (seed applies till-layer values into a hand venue). So "till venue cannot create/delete" can only be seen partly: till sections have no Delete in their menu, till items have no Delete/Rename in the item menu; "Нов артикул" still offered (hand venue). Real till-venue check => Needs Martin. Also the composer item badge reads "От barsy" (screen outside the barsy tab) - check against the guide's wording line.
- Section rename in place: pencil, type, Enter: works (2 interactions). Section menu: Преименувай / Скрий секцията / Хоризонтален ред / Нова секция вътре / Премести в…
- Publish dialog first time: "Всичко е ново: 19 артикула ще тръгнат на живо с първото публикуване." Version 1 live.
- Guest Sofia 375px: Cocktails (horizontal) = photo strip layout side-by-side cards (no photos in seed); other sections follow "2 колони"; layout radiogroup lives under first non-horizontal section; list/1/2 columns switch works.
- Versioning tab: "Версия 1 на живо ... до 2 по-стари ... по-старите версии се изтриват 30 дни след създаването им (тази на живо никога), а дневникът на промените се пази 61 дни."
- Unpublish lives ONLY on the All-venues card ("Свали от публикация…", 2 taps), not inside the venue. After it: orange banner in the venue "Адресът на менюто е изключен…" (also duplicated in the header text). Guest /m/ answers "Това меню не е налично". Republish with "nothing changed" re-enables the address and does NOT create a new version.
- BUG: Design > "Име най-горе в менюто" saved ("Името е запазено. Гостите го виждат след следващото публикуване.") but (1) Publish says "Нищо ново" / no pending change, (2) after a real publish (v2, design) snapshot menu.title is {} and the guest H1 still reads generic "Меню"/"Menu"; the empty-field promise (use venue name) also not met. Phone preview in Design also shows "Меню". Snapshot files: .local/cdn/snap/sn_258... (v1), sn_4BZ8... (v2).
- Design tab: collapsed template line "Шаблон: Редакционен пазар [Смени]"; cards in order Лого и име / Функции за гостите / Шрифт, ъгли, сянка и екран / Цветове; phone preview sticky beside form (also light/dark toggle, Обнови, "Преглед на услугите за гостите" toggle). Font dropdown draws each of 6 fonts in itself, preview updates live; "Има незапазени промени" bar; Save disabled with "Нищо за запазване".
- Colours: brand hex -> Page/Panels filled (#eaf2ff / #d3e3f9); page #ff2200 gives "Цветът на страницата е много наситен. Спокоен, светъл нюанс обикновено изглежда най-добре…" warning, save still allowed; Advanced lists Text/Secondary/On accent... per light/dark with contrast ratios "Страница 4,5:1 · Панели 13,2:1" and Промени; a failing pair shows red box naming it ("Светъл екран: „Текст“ върху „Страница“ — контраст 1,1:1, трябва 4,5:1") and Save disabled with "Част от текста би се чел трудно. За да запазите, поправете цветовете, отбелязани в червено."; "Върни всички променени цветове" works. Saved: "Запазено. Гостите го виждат след следващото публикуване." Publish then counted "1 промяна" ("Външен вид на менюто (цветове, лого)") and v2 went live; guest shows Playfair + brand blue. 
- Guest functions card says "(етап 4)/(етап 5)" = internal roadmap wording shown to owner.

## Final (cleanup done)
- Servers stopped, launch.json restored (git status clean). Local-only gitignored files remain in the worktree: .env.local, .env.worker.local, .local/ (publish store). DB restro_audit_ad01 left as is (instance removed + re-added system tick, Sofia published v2, Rehearsal #2 draft).
- Tabs & QR (Sofia): zone add, route picker (venue/area/table) lists "Same as the venue / <live menu> (live) / Brunch", saves with toast "Menu saved." and the hint "Not published yet: guests see … for now."; area menu: Hide / Move up / Move down / Delete (hand venue).
- Composer taps: hide item = 1 (switch), badge "Hidden", Publish shows "1 change waiting"; sold out tonight = 2 (… > Sold out tonight), red badge + "Sold out (1)" filter, no publish needed.
- Instance remove: dialog text "It leaves this list and is never synced again. Its credentials and history are kept. A connection that venues still use cannot be removed." (does not say the 30-day purge) ; remove works; picker then reads "No system chosen yet"; ticking barsy + Save systems opens the Add barsy form.
- Wording remarks: "Запиши…" (org/venue name/address) vs "Запази…" (systems, design) inconsistent; deleted-venues time "4:49" unpadded; empty state after purge is a plain line, after restore the full empty state.
