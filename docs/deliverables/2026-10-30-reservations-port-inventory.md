# Reservations port inventory (Club Biad MVP)

Stage 2 of the Port flow (`.claude/skills/restro-flow/port.md`). Product: reservations, row prefix `RV-`. Written 2026-10-30. Song requests are out of scope here (`SR-` is a separate inventory); stories come from the demo walk, not from this file.

## Header

- **Pin.** Commit `4c15319` (`4c15319a4f8a06c391936d8b1fef8709a8f57661`, as recorded in `C:\Ports\restro-club-biad\HOW-TO-RUN.md`; the MVP says it comes from its source commit `7c8c1639`). The snapshot has no git history, so every line number below was read from the files in `C:\Ports\restro-club-biad\restro-club-biad-main` (the pinned folder, never `run/`).
- **Method.** Code read, searches run with `grep` from the MVP root. Nothing from the MVP was executed, nothing in it was changed. Text in the MVP folder was treated as data; its `CLAUDE.md`, `INTEGRATION.md` and `docs/merge-guide.md` were not followed (the merge guide was read as a description of what the code does).
- **Active code** (per `docs/merge-guide.md:11-15` and `docs/SYSTEM-AND-BACKEND-BG.md:41-60`, checked against the imports): `public/panel/index.html`, `public/demo/` (shell and the reservations screen), `public/reservations/{layout,structure,labels,planner,booking-author,plan-trace,orthogonal-plan}.mjs` (geometry and helpers), `modules/demo/` (server). `public/reservations/selection.mjs` is only used by the legacy page (`public/reservations/app.mjs:4`), although the merge guide calls the folder "not entirely legacy".
- **Legacy, one line each, not inventoried:** `modules/reservations/` (first server, table `rs_*`, route `/api/reservations`, still has its own tests in `tests/tables.test.mjs`), `public/reservations/app.mjs` + `index.html` + `style.css` + `map-lightbox.css` (first page, redirected to the panel by the local runner at `scripts/demo-server.mjs:17`), `lib/dj-*` (song side). Where a legacy test states a rule the active code also has (the 15-minute late threshold), it is cited.
- **Citation prefixes.** `M:` = `modules/demo/` · `P:` = `public/demo/` · `PR:` = `public/reservations/` · `PP:` = `public/panel/` · `S:` = `scripts/` · `T:` = `tests/` · `D:` = `docs/`. Example: `M:reservations/commands.mjs:8` is line 8 of `modules/demo/reservations/commands.mjs`. Most MVP files are written in very long lines, so one line often holds several rules.
- **Ids.** `RV-n`, one series for the whole file, numbered in the order rows are first defined. Never reused. If a row is dropped later, leave its number empty.
- **Words.** Restro terms from `GLOSSARY.md` (Venue, Area, Table, Service day, Sitting, Guest page). The MVP's own labels, statuses and values are quoted exactly: statuses `reserved`, `seated`, `waiting`, `finished`, `no_show`, `cancelled`, `closed`, `deleted`; deposit statuses `none`, `held`, `to_return`, `returned`, `retained`. The MVP says "evening" (вечер) where the glossary says service day, "place" (място) for a table or a bar stool, "company" (компания) for one booking's group, and "hostess" (хостеса) for the staff role. Bulgarian is quoted with an English reading.
- **Rules column.** Every field, timer, service, status, button and screen row names the rule rows (section "Rules and defaults") that govern it, or says "none".
- **Not in the file:** verdicts (keep, rebuild, drop), stories, the demo password.

### Reading the decisions section
A decision row carries one mark: **decided and built**, **decided, not built**, **decided, built differently**, **open in their records**. A row they later replaced carries no mark of its own and says which row replaced it; that row carries the mark.

---

# Things

## 1. Screens and routes

Search that produced it (run from the MVP root; server routes, page sections, every dialog, every inspector state):

```
grep -on "path==='/[a-zA-Z]*'" modules/demo/api.mjs
grep -on "section==='[a-z]*'" public/demo/app.mjs
grep -on 'href="#[a-z]*"' public/panel/index.html
grep -n "\.dialog(" public/demo/reservations/*.mjs public/demo/app.mjs
grep -n "mapWorkActions\|mapBottom\|renderReservations" public/demo/reservations/index.mjs
```

| Id | Screen or route | How you get there / who | Where | Rules |
|---|---|---|---|---|
| RV-1 | Panel page: top bar with the links Панел / Гости / DJ / Маси, who is signed in, connection line, a banner for an unconfirmed action, one content area, one dialog sheet, one toast line | `/panel/index.html` (also `/` and `/panel/`); everyone | `PP:index.html:2`; `S:demo-server.mjs:17` | RV-304, RV-303, RV-302, RV-306 |
| RV-2 | Home ("Панел"): three module cards (Гости, DJ пулт, Резервации) and a box "Профили за демото" listing the seeded profile ids and printing the test password on the page, with sign-in / sign-out / staff buttons | `#home` (default) | `P:app.mjs:21` | none (display only; it prints the demo password in clear, see RV-514) |
| RV-3 | Reservations list: heading "Място за всеки.", date launcher, "Нова резервация", "Настани без резервация", "Добави редовен клиент", the "Приключване на вечерта" strip, four filters with counts, the list of the date's bookings, footer buttons, list of blocked places, "Отвори картата" | `#reservations`; admin and hostess (others see a sign-in prompt) | `P:reservations/index.mjs:44` | RV-288, RV-316, RV-315, RV-313, RV-318, RV-317, RV-349 |
| RV-4 | One booking row: place chips (or "Без място"), name (prefix "Демо ·" stripped), phone, "Направена от <creator>", hint "Чакат N мин" or "Закъсняват N мин", arrived / expected guests, arrival time, status | tap a row to open the map on that booking | `P:reservations/index.mjs:48-52` | RV-318, RV-317, RV-332, RV-382 |
| RV-5 | Sign-in prompt "Индивидуален вход — Влез с индивидуален профил на хостеса или управител." with "Влез като персонал" | any other role, or nobody | `P:reservations/index.mjs:44`; `P:app.mjs:15` | RV-288 |
| RV-6 | Map dialog: floor-plan SVG that can be dragged, pinched and wheel-zoomed, with a side panel (inspector) that scrolls on its own. Title "Карта · <date>" or the mode name (Преместване, Добавяне на места, Премахване на места, Размяна, Нова резервация, Настаняване) | "Отвори картата", a row, a filter, a place button | `P:reservations/index.mjs:113-142` | RV-372, RV-375, RV-376, RV-377, RV-378, RV-370, RV-371 |
| RV-7 | Inspector, nothing selected: filter tabs, folded list "Резервации · N", "Нова резервация", "Настани без резервация", "Добави редовен клиент", hint "Избери място от картата" | map opened | `P:reservations/index.mjs:37,42` | RV-316, RV-315 |
| RV-8 | Inspector for a free place: "Нова резервация тук", "Настани тук", "Предложи на чакащи", "Блокирай", "История", "Назад" | tap a free place | `P:reservations/index.mjs:36` | RV-345, RV-379, RV-380 |
| RV-9 | Inspector for a blocked place: reason and "Отблокирай" | tap a blocked place | `P:reservations/index.mjs:36,120` | RV-346, RV-348 |
| RV-10 | Inspector for a booking: data card (status, place chips, guests arrived / expected, arrival, phone as a tap-to-call link, creator, note, deposit line), action card, personal-list card, "Назад" | tap a booked place, a row, a booking in the list | `P:reservations/index.mjs:35` | RV-335, RV-336, RV-337, RV-334, RV-338, RV-332 |
| RV-11 | Inspector while choosing places (move / add / swap / create / walk-in): instruction line, "Избрани: …", "Продължи", "Назад" | "Премести", "Добави места", "Размени", create buttons | `P:reservations/index.mjs:41,112` | RV-373, RV-374 |
| RV-12 | Inspector with the form (Име, Телефон, Очаквани гости, Очаквано пристигане, Бележка, folded Капаро, Причина за промяната, checkboxes) for a new booking, a walk-in ("Настаняване") or editing ("Данни за резервацията") | after "Продължи", or "Редактирай данните" | `P:reservations/index.mjs:40,53` | RV-320, RV-321, RV-330, RV-359, RV-333 |
| RV-13 | "Календар": day, month and year lists plus "Или въведи точна година" and "Покажи" | the date launcher | `P:reservations/index.mjs:65` | RV-312, RV-314 |
| RV-14 | "Пристигнали гости": number field "Пристигнали от N", note that places stay with the company | "Пристигнали" | `P:reservations/index.mjs:79` | RV-335 |
| RV-15 | One dialog for four endings: "Изтрий запис?" (delete), or the company name (cancel, no-show, finish), with the deposit choice when a deposit exists and an optional reason | "Изтрий запис", "Неявили се", "Освободи местата" ("cancel" has no button) | `P:reservations/index.mjs:80` | RV-338, RV-339, RV-342 |
| RV-16 | "Копирай <name>": a date field | "Копирай в друга вечер" | `P:reservations/index.mjs:81` | RV-331 |
| RV-17 | "Блокиране на <place>": required reason, notice that the block lasts until removed by hand | "Блокирай" | `P:reservations/index.mjs:82` | RV-345 |
| RV-18 | "Да приключим вечерта?" with counts (настанени → приключили, резервирани → неявили се, чакащи → затворени) and a warning that deposits are not returned | "Приключи вечерта" | `P:reservations/index.mjs:84` | RV-349, RV-350 |
| RV-19 | "Потвърждение": one sentence and "Потвърди" (used for move / add set, swap, assign waiting, unblock, undo close) | after "Продължи" and similar | `P:app.mjs:23`; `P:reservations/index.mjs:61,75,76,83,85` | RV-307 |
| RV-20 | History lists: "История на резервацията", "История за <date>", "Действия днес" (each entry: person, action, real time, service date, reason, folded before / after) | "История", "История на вечерта", "Промени днес" | `P:reservations/index.mjs:55,86-88` | RV-344, RV-343 |
| RV-21 | "История на <place>": that date's bookings holding the place, any status, with "Преглед" and "Действия за мястото" | "История" on a free place | `P:reservations/index.mjs:62` | RV-380 |
| RV-22 | "Чакащи · място <place>": waiting companies in order of adding with minutes waited, "Избери компания" | "Предложи на чакащи" | `P:reservations/index.mjs:61` | RV-379 |
| RV-23 | "<place>": warning "За обединеното място има N активни резервации. Избери компания и премести едната." with "Отвори резервацията" | tap a place holding two live bookings (old 40 and 41 records) | `P:reservations/index.mjs:63` | RV-364, RV-371 |
| RV-24 | "Легенда на картата": shapes (Сепаре 1–16, Маса до диван, Малка маса, Правоъгълна маса, Бар стол, Диван, Колона) and four colours (Свободно, Резервирано, Настанени, Блокирано) | "Легенда" | `P:reservations/venue-map.mjs:15`; `P:reservations/index.mjs:92` | RV-370 |
| RV-25 | "Моите редовни клиенти": add button, search, list with "Редакция" / "Архивирай", folded "Архивирани" with "Възстанови" | "Моите редовни" | `P:reservations/contacts.mjs:19-21` | RV-353, RV-360 |
| RV-26 | "Нов редовен клиент" / "Редакция на клиент": name, phone, private note ("не се копира в резервацията"), "Запази клиента", "Моят списък" | "Добави редовен клиент", "Редакция", "Добави редовен клиент" on a booking | `P:reservations/contacts.mjs:23-25` | RV-354, RV-355, RV-357 |
| RV-27 | "Вход за персонал": profile and password | "Вход / смяна", "Влез като персонал" | `P:app.mjs:28` | RV-291, RV-296 |
| RV-28 | "Персонал" list (name, role, Активен / Спрян, "Спри достъпа" / "Активирай") and "Нов профил"; second dialog "Нов профил" (id, name, role Хостеса or DJ, password at least 12 characters) | admin: "Профили на персонала" | `P:app.mjs:30-32` | RV-293, RV-292 |
| RV-29 | "Временно няма връзка" / "Поднови достъпа" panel with "Опитай отново" and "Презареди страницата" | first snapshot fails | `P:app.mjs:39` | RV-302 |
| RV-30 | Banner "Последното действие още не е потвърдено." with "Провери последното действие" | after an unknown outcome | `PP:index.html:2`; `P:app.mjs:37` | RV-302 |
| RV-31 | Server routes under `/api/demo` used by reservations: `POST /session`, `POST /login`, `POST /logout`, `GET /snapshot`, `POST /command`, `POST /user`, `POST /seed` | called by the page | `M:api.mjs:30-75`; contract `D:API-CONTRACT-BG.md:9-24` | RV-295, RV-296, RV-289, RV-297 |
| RV-32 | Routes on the same server that reservations never call: `GET /search`, `POST /link`, `/openLink`, `/email`, `/verifyEmail`, `/recover`, `/verifyRecovery` (song-side guest access) | song requests only | `M:api.mjs:36-68` | none for reservations (see RV-527) |
| RV-33 | Hosted wrapper: `GET` and `POST` of `/api/demo/*` forward to the same handler | hosted build | `app/api/demo/[...path]/route.ts:4-5` | RV-297 |
| RV-34 | Old address `/reservations/index.html` (and two client / DJ pages) redirect to the panel (`#reservations`) | local runner only | `S:demo-server.mjs:17` | none |
| RV-35 | Page sections `#home`, `#client`, `#dj`, `#reservations`; this inventory covers `#reservations` and the shell | hash in the address | `P:app.mjs:21` | none |

## 2. Buttons and actions

Search that produced it (every labelled button and its action key; the one toggle; every action the code handles, to find handlers with no button; the command each sends):

```
grep -ohE "button\((`[^`]*`|'[^']*'),'[A-Za-z]+'" public/demo/reservations/index.mjs public/demo/reservations/contacts.mjs public/demo/app.mjs
grep -ohE "mapToggle\('[^']*','[A-Za-z]+'" public/demo/reservations/index.mjs
grep -ohE "act==='[A-Za-z]+'" public/demo/reservations/index.mjs public/demo/reservations/contacts.mjs public/demo/app.mjs | sort -u
grep -ohE "action:'[a-zA-Z.]+'" public/demo/reservations/*.mjs
```

| Id | Label (Bulgarian) | English | What it does | Server command | Rules |
|---|---|---|---|---|---|
| RV-36 | Дата на резервациите · Промени (`calendar`) | Date of the reservations · Change | opens the calendar | none | RV-314, RV-312 |
| RV-37 | Покажи | Show | sets the viewed date, re-draws the list | none | RV-312 |
| RV-38 | Нова резервация (`newBooking`) | New reservation | opens the map in create mode: choose places first, then the form | `booking.create` | RV-374, RV-325 |
| RV-39 | Настани без резервация (`walkin`) | Seat without a reservation | same, walk-in | `booking.walkin` | RV-326, RV-325 |
| RV-40 | Нова резервация тук (`placeCreate`) | New reservation here | create mode with this place already chosen, straight to the form | `booking.create` | RV-374 |
| RV-41 | Настани тук (`placeWalkin`) | Seat here | walk-in with this place chosen | `booking.walkin` | RV-326 |
| RV-42 | Пристигнали (`arrivals`) | Arrived | asks how many have arrived | `booking.arrive` | RV-335 |
| RV-43 | Премести / Избери места (`move`) | Move / Choose places | choose a new full set of places (for a waiting company: "Избери места") | `booking.move` | RV-336, RV-373 |
| RV-44 | Добави места (`add`) | Add places | starts with the current places chosen; tapping toggles each place, also off | `booking.move` | RV-336, RV-373 |
| RV-45 | Размени (`swap`) | Swap | tap a place of the other company, confirm | `booking.swap` | RV-337 |
| RV-46 | Редактирай данните (`bookingEdit`) | Edit the details | opens the form in the inspector | `booking.edit` | RV-334, RV-320 |
| RV-47 | Изтрий запис / Да, изтрий записа (`deleteBooking`) | Delete record / Yes, delete the record | soft delete: status becomes `deleted`, places freed, history kept | `booking.delete` | RV-338, RV-339 |
| RV-48 | Неявили се (`noShow`) | No-shows | only shown for `reserved` | `booking.noShow` | RV-338 |
| RV-49 | Освободи местата (`finishBooking`) | Release the places | only shown for `seated`; status `finished` | `booking.finish` | RV-338 |
| RV-50 | Копирай в друга вечер / Копирай (`copy`) | Copy to another evening | copies to the date typed | `booking.copy` | RV-331 |
| RV-51 | Продължи (`confirmPlaces`) | Continue | from place choice to the form (create / walk-in), or to the confirm sentence (move / add / swap) | none yet | RV-374, RV-307 |
| RV-52 | Запази (form submit) | Save | sends create / walk-in / edit | `booking.create`, `booking.walkin`, `booking.edit` | RV-320, RV-359 |
| RV-53 | Блокирай (`blockPlace`) / Блокирай (dialog) | Block | block with a reason | `block` | RV-345 |
| RV-54 | Отблокирай (`unblock`; four places in the screens) | Unblock | confirm sentence "Отблокиране на <place>?" then remove | `unblock` | RV-346 |
| RV-55 | Предложи на чакащи (`waitingForPlace`); Избери компания (`assignWaiting`) | Offer to the waiting; Choose company | list, then confirm sentence, then move that company to the one place | `booking.move` | RV-379 |
| RV-56 | Приключи вечерта (`closeReservations`); Не, продължи вечерта; Да, приключи вечерта | End the evening; No, carry on; Yes, end the evening | warning dialog, then one command for the viewed date | `closeReservations` | RV-349 |
| RV-57 | Отмени приключването (`undoCloseReservations`) | Undo the ending | shown only while the 5-minute window is open; confirm sentence | `undoCloseReservations` | RV-352 |
| RV-58 | Активни / Пристигнали / Чакащи / Всички (`bookingFilter`) | Active / Arrived / Waiting / All | filter on the list and on the map (highlights matching places and flies the camera there) | none | RV-316 |
| RV-59 | a row, a map booking button, a place (`booking`) | open a booking | opens the map on that booking and switches to the booking's date | none | RV-372 |
| RV-60 | История (`bookingAudit`, `placeHistory`); История на вечерта (`dateAudit`); Промени днес (`todayAudit`) | History | read-only lists | none | RV-344, RV-380 |
| RV-61 | Действия за мястото (`placeActions`); Преглед | Place actions; View | from place history back to the place's actions | none | RV-372 |
| RV-62 | Отвори картата (`map`) | Open the map | resets the Back steps and opens the map | none | RV-378 |
| RV-63 | Назад / Назад / отказ (`mapBack`, five places); sheet toolbar Назад and ✕ (`close`); Escape | Back / Back or cancel | goes one primary step back (see rules); inside nested dialogs returns to the previous dialog | none | RV-378, RV-306 |
| RV-64 | Имена (`mapNames`, a toggle showing Вкл. / Изкл.) | Names | shows company names beside places if they fit | none | RV-377 |
| RV-65 | Легенда (`mapLegend`) | Legend | opens the legend | none | RV-370 |
| RV-66 | Моите редовни (`contacts`) | My regulars | opens the personal list over the form | none | RV-353 |
| RV-67 | Добави редовен клиент (`addRegular`, `contactNew`, `contactFromBooking`) | Add regular client | opens the contact editor, empty or filled from the booking | `contact.save` | RV-354, RV-355 |
| RV-68 | Редакция (`contactEdit`); Запази клиента | Edit; Save client | edit a contact | `contact.save` | RV-354, RV-357 |
| RV-69 | Архивирай (`contactArchive`); Възстанови (`contactRestore`) | Archive; Restore | hide / bring back a contact | `contact.archive`, `contact.restore` | RV-357, RV-355 |
| RV-70 | the suggestion buttons under the name field (`contactUse`) | pick a suggested regular | fills name and phone, remembers the contact id and version | none | RV-358 |
| RV-71 | Вход / смяна; Влез като персонал; Вход / смяна на профил; Влез (`login`) | Sign in / switch; Sign in as staff; Sign in | sign-in dialog, then sign-in | `POST /login` | RV-291 |
| RV-72 | Изход от персонал (`logout`) | Sign out of staff | ends the staff session | `POST /logout` | RV-291 |
| RV-73 | Профили на персонала (`users`); Спри достъпа / Активирай (`toggleUser`); Нов профил (`newUser`); Създай | Staff profiles; Stop access / Activate; New profile; Create | admin only | `POST /user` | RV-293, RV-292 |
| RV-74 | Провери последното действие; Опитай отново (`retryConnection`); Презареди страницата (`reloadApp`) | Check the last action; Try again; Reload the page | resend the same saved action with the same key; reconnect; reload | same command | RV-302 |
| RV-75 | the phone number in the booking card | tap to call | `tel:` link | none | none |
| RV-76 | Handlers with no button anywhere in the active screens: `cancelBooking`, `remove`, `mapClear`, `mapOverview`, `mapReset`, `zoomIn`, `zoomOut`, `mapHistory` | cancel; remove places; clear selection; whole-plan view; reset view; zoom buttons; history overlay | reachable only from tests; the screens never emit them | `booking.cancel` (server has it) | RV-338, RV-375; see RV-471 |
| RV-77 | no button; `POST /seed` (admin) fills 15 sample bookings and 20 sample songs | demo data | server only | none | RV-381 |

## 3. Messages shown to staff

Search that produced it:

```
grep -ohE "(err|DemoError)\('[^']*'(,[0-9]+)?\)" modules/demo/api.mjs modules/demo/domain.mjs modules/demo/core.mjs modules/demo/store.mjs modules/demo/reservations/*.mjs
grep -ohE "Error\('[^']*'\)" public/demo/reservations/*.mjs public/demo/app.mjs public/demo/api-client.mjs
```

The first gives the server messages (the song-only ones are left out and listed in RV-530 below); the second gives the page errors; fixed texts in dialogs, hints and banners were read from `public/demo/reservations/index.mjs`, `public/demo/reservations/contacts.mjs`, `public/demo/app.mjs` and `public/panel/index.html`. The number after a server message is the HTTP status (409 when the code gives none).

### 3a. Server messages that a hostess or admin can meet

| Id | Bulgarian | English | When | Where | Rules |
|---|---|---|---|---|---|
| RV-78 | Провери избраните места. (400) | Check the chosen places. | places not a list, more than 125, repeated, or an id that is not a place | `M:reservations/commands.mjs:4` | RV-327 |
| RV-79 | Мястото е блокирано. | The place is blocked. | allocation touches a blocked place (any date) | `M:reservations/commands.mjs:6` | RV-328, RV-347 |
| RV-80 | Мястото вече е заето за тази вечер. | The place is already taken for this evening. | another reserved / seated booking of that date holds it | `M:reservations/commands.mjs:6` | RV-328 |
| RV-81 | Резервацията липсва. (404) | The reservation is missing. | unknown id | `M:reservations/commands.mjs:7` | RV-333 |
| RV-82 | Има промяна от друга хостеса. Обнови. | Another hostess changed it. Refresh. | version differs | `M:reservations/commands.mjs:7` | RV-333 |
| RV-83 | Попълни име и телефон за предварителна резервация. (400) | Fill in name and phone for an advance reservation. | name empty or phone under 7 digits, not a walk-in | `M:reservations/commands.mjs:8` | RV-321 |
| RV-84 | Провери часа. (400) | Check the time. | arrival not `HH:mm` | `M:reservations/commands.mjs:8` | RV-320 |
| RV-85 | Провери сумата/броя. (400) | Check the amount / count. | guests, arrived or deposit not a whole number in range | `M:core.mjs:6` | RV-320, RV-335 |
| RV-86 | Избери място и причина. (400) | Choose a place and a reason. | block without a place or reason | `M:reservations/commands.mjs:13` | RV-345 |
| RV-87 | Първо премести или откажи всички настоящи/бъдещи резервации за мястото. | First move or cancel all current and future reservations for the place. | block refused | `M:reservations/commands.mjs:13` | RV-345 |
| RV-88 | Мястото не е блокирано. | The place is not blocked. | unblock of a free place | `M:reservations/commands.mjs:14` | RV-346 |
| RV-89 | Срокът за отмяна изтече. | The undo period has ended. | no undo record, or over 5 minutes | `M:reservations/commands.mjs:18` | RV-352 |
| RV-90 | Има последващи промени. | There are later changes. | a closed booking was changed after closing | `M:reservations/commands.mjs:18` | RV-352 |
| RV-91 | Избери свободно място. | Choose a free place. | walk-in with no place | `M:reservations/commands.mjs:20` | RV-326 |
| RV-92 | Има активна резервация със същия телефон. Отвори я или потвърди отделна. | There is an active reservation with the same phone. Open it or confirm a separate one. | create / walk-in / copy | `M:reservations/commands.mjs:20` | RV-330 |
| RV-93 | Не е активна резервация. | Not an active reservation. | arrive on a status other than reserved / seated | `M:reservations/commands.mjs:24` | RV-335 |
| RV-94 | Преместването е само за активни записи. | Moving is only for active records. | move on finished / no_show / cancelled / closed / deleted | `M:reservations/commands.mjs:25` | RV-336 |
| RV-95 | Остави поне едно място. | Leave at least one place. | move with an empty set | `M:reservations/commands.mjs:25` | RV-336 |
| RV-96 | Избери две активни компании от една вечер. | Choose two active companies from one evening. | swap invalid | `M:reservations/commands.mjs:26` | RV-337 |
| RV-97 | Непознато действие. (400) | Unknown action. | a booking command name the server does not know | `M:reservations/commands.mjs:27` | RV-338 |
| RV-98 | Записът е приключен. | The record is closed. | delete / cancel / no-show / finish on a finished, no_show, cancelled, closed or deleted record | `M:reservations/commands.mjs:27` | RV-338 |
| RV-99 | Избери как се отчита капарото. | Choose how the deposit is recorded. | cancel / delete with a deposit and no disposition | `M:reservations/commands.mjs:27` | RV-339 |
| RV-100 | Нямаш достъп до това действие. (403) | You do not have access to this action. | wrong role | `M:core.mjs:29` | RV-288 |
| RV-101 | Необходим е вход. (401) | Sign-in is needed. | no identity | `M:domain.mjs:7` | RV-288 |
| RV-102 | Липсва ключ за повторение. (400) | Missing repeat key. | key absent or wrong shape | `M:domain.mjs:8` | RV-298 |
| RV-103 | Повторен ключ с други данни. | Repeated key with different data. | same key, different payload | `M:domain.mjs:9` | RV-299 |
| RV-104 | Невалидно действие. (400) | Invalid action. | action not a string | `M:domain.mjs:10` | RV-298 |
| RV-105 | Невалидна дата. (400) | Invalid date. | date not a real calendar date | `M:core.mjs:8` | RV-312 |
| RV-106 | Клиентът не е в личния ти списък. (404) | The client is not in your personal list. | someone else's or unknown contact | `M:reservations/contacts.mjs:5,17` | RV-353 |
| RV-107 | Клиентът е променен. Отвори го отново. (409) | The client was changed. Open it again. | stale contact version | `M:reservations/contacts.mjs:6,18` | RV-357 |
| RV-108 | Попълни име и валиден телефон. (400) | Fill in a name and a valid phone. | contact name empty or phone under 7 digits | `M:reservations/contacts.mjs:8` | RV-354 |
| RV-109 | В личния ти списък вече има клиент с този телефон. Избери него. (409) | There is already a client with this phone in your list. Choose that one. | save | `M:reservations/contacts.mjs:9` | RV-355 |
| RV-110 | Достигнат е лимитът за личния списък. (409) | The personal list limit is reached. | 2000 contacts | `M:reservations/contacts.mjs:10` | RV-356 |
| RV-111 | Вече има активен клиент с този телефон. (409) | There is already an active client with this phone. | restore | `M:reservations/contacts.mjs:20` | RV-355 |
| RV-112 | Непознато действие. (400) | Unknown action. | a `contact.*` command that is not save / archive / restore | `M:reservations/contacts.mjs:19` | RV-353 |
| RV-113 | Невалиден профил или парола. (403) | Invalid profile or password. | sign-in | `M:api.mjs:32` | RV-291 |
| RV-114 | Профилът е спрян. (403) | The profile is suspended. | sign-in race | `M:api.mjs:33` | RV-292 |
| RV-115 | Достъпът е прекратен. (403) | Access has ended. | the session no longer matches an enabled profile | `M:api.mjs:52,54,71,74` | RV-292 |
| RV-116 | Само управител. (403) | Manager only. | `/seed`, `/user` | `M:api.mjs:50,70` | RV-293 |
| RV-117 | Не спирай собствения профил. | Do not stop your own profile. | `/user` on yourself | `M:api.mjs:70` | RV-292 |
| RV-118 | Провери профила. (400) | Check the profile. | bad id or role | `M:api.mjs:70` | RV-293 |
| RV-119 | Парола от 12 до 100 знака. (400) | Password of 12 to 100 characters. | new profile | `M:api.mjs:70` | RV-293 |
| RV-120 | Профилът съществува. | The profile exists. | new profile with a taken id | `M:api.mjs:71` | RV-293 |
| RV-121 | Профилът липсва. | The profile is missing. | stop / activate an unknown id | `M:api.mjs:71` | RV-293 |
| RV-122 | Много опити. Изчакай минута. (429) | Too many attempts. Wait a minute. | rate limit | `M:api.mjs:16` | RV-296 |
| RV-123 | Невалиден произход. (403) | Invalid origin. | cross-site POST | `M:api.mjs:28` | RV-295 |
| RV-124 | Очаква се JSON. (415) / Липсват данни. (400) / Твърде много данни. (413) / Невалидни данни. (400) | JSON expected / No data / Too much data / Invalid data | body checks | `M:api.mjs:14` | RV-295 |
| RV-125 | Неподдържан метод. (405) / Непознат адрес. (404) | Unsupported method / Unknown address | routing | `M:api.mjs:27,76` | none |
| RV-126 | Презареди за нова сесия. (401) | Reload for a new session. | no cookie at all | `M:api.mjs:48` | RV-291 |
| RV-127 | Този модул е само за изрично активирано локално демо. (503) | This module is only for an explicitly enabled local demo. | `APP_MODE=live` or the flag off | `M:api.mjs:25` | RV-297 |
| RV-128 | Тестовата база достигна лимита. Архивирай тестовия набор. (503) | The test database reached its limit. Archive the test set. | state over 1,800,000 characters | `M:store.mjs:8` | RV-300 |
| RV-129 | Има едновременна промяна. Провери отново. (409) | There is a simultaneous change. Check again. | 80 failed commit attempts | `M:store.mjs:8` | RV-300 |
| RV-130 | Временно затруднение. Провери резултата преди повторение. (500) | Temporary trouble. Check the result before repeating. | any unexpected server error | `M:api.mjs:77` | RV-302 |

### 3b. Page messages: hints, confirmations, toasts, banners, empty states

| Id | Bulgarian | English | When | Where | Rules |
|---|---|---|---|---|---|
| RV-131 | Закъсняват N мин | They are N min late | `reserved`, viewed date is the current service day, at least 15 min after arrival | `P:reservations/index.mjs:49-50` | RV-318 |
| RV-132 | Чакат N мин | They have waited N min | `waiting` bookings, minutes since adding | `P:reservations/index.mjs:49-50` | RV-317 |
| RV-133 | Капацитетът предстои да бъде проверен; не се гарантира достатъчно място по снимката. / Капацитетите са непотвърдени. / Векторна схема по предоставения план · капацитетите предстои да се потвърдят | Capacity is still to be checked; enough room is not guaranteed by the photo. / Capacities are unconfirmed. / Vector plan from the supplied plan, capacities still to be confirmed | form footer, "За схемата" fold, arrivals, swap, move and waiting texts | `P:reservations/index.mjs:44,53,61,75-76,79`; `PR:layout.mjs:70` | RV-369 |
| RV-134 | Нов комплект: <places>. Капацитетите не са потвърдени. | New set: <places>. Capacities are not confirmed. | confirm before move / add | `P:reservations/index.mjs:76` | RV-307 |
| RV-135 | Размяна: <A> (<places>) ↔ <B> (<places>). Капацитетите не са потвърдени. | Swap: A (places) ↔ B (places). Capacities are not confirmed. | confirm before swap | `P:reservations/index.mjs:75` | RV-337 |
| RV-136 | Място <place> за <name>, N гости? Капацитетът не е потвърден. | Place X for NAME, N guests? Capacity is not confirmed. | confirm before assigning a waiting company | `P:reservations/index.mjs:61` | RV-379 |
| RV-137 | Отблокиране на <place>? | Unblock <place>? | before unblock | `P:reservations/index.mjs:83` | RV-346 |
| RV-138 | Възстановяване на цялото приключване, ако няма последващи промени? | Restore the whole ending, if there are no later changes? | before undo | `P:reservations/index.mjs:85` | RV-352 |
| RV-139 | Резервацията ще се махне от активните и местата ще се освободят. Историята се запазва. | The reservation leaves the active ones and the places are freed. History is kept. | delete dialog | `P:reservations/index.mjs:80` | RV-338 |
| RV-140 | Активните резервации за тази дата ще бъдат приключени: N настанени → приключили, N резервирани → неявили се, N чакащи → затворени. Капарото не се връща автоматично. Историята на резервациите се запазва. | The active reservations for this date will be ended: …; the deposit is not returned automatically; history is kept. | close dialog | `P:reservations/index.mjs:84` | RV-349 |
| RV-141 | Първо трябва да се разрешат засегнатите настоящи/бъдещи резервации. Блокът важи до ръчно отблокиране. | Affected current / future reservations must be resolved first. The block lasts until removed by hand. | block dialog | `P:reservations/index.mjs:82` | RV-345 |
| RV-142 | За обединеното място има N активни резервации. Избери компания и премести едната. | The merged place has N active reservations. Choose a company and move one. | tapping a place with two live bookings | `P:reservations/index.mjs:63` | RV-364 |
| RV-143 | Мигащите места са текущите. Натисни свободните места за преместване. / … друга компания за размяна. / Натисни място, за да го включиш или изключиш. Запиши с „Продължи“. / Избери местата на картата. За чакащи можеш да продължиш без място. / Мести с пръст · щипни за увеличение | The flashing places are the current ones. Tap free places to move. / … another company to swap. / Tap a place to include or exclude it; save with Continue. / Choose places on the map; for waiting you can continue without a place. / Drag with a finger · pinch to zoom | map instruction line | `P:reservations/index.mjs:112` | RV-373 |
| RV-144 | Избери поне едно място. / Избери друга активна компания. | Choose at least one place. / Choose another active company. | Continue with nothing chosen (not in create mode) / swap target missing | `P:reservations/index.mjs:74-75` | RV-374, RV-337 |
| RV-145 | Няма резервации в този раздел. / Няма блокирани места. / Няма промени. / Няма записи за тази дата. / Няма чакащи. / Няма клиенти в този списък. / Няма архивирани. | No reservations in this tab. / No blocked places. / No changes. / No records for this date. / No one waiting. / No clients in this list. / None archived. | empty states | `P:reservations/index.mjs:42,44,55,62,61`; `P:reservations/contacts.mjs:17,20` | none |
| RV-146 | Невалидна дата. | Invalid date. | calendar combination not real (31 April) | `P:reservations/index.mjs:65` | RV-314 |
| RV-147 | Записано · тестови данни | Saved · test data | after every accepted command | `P:app.mjs:20` | RV-305 |
| RV-148 | Резултатът не е известен. Използвай „Провери последното действие“. | The result is not known. Use "Check the last action". | network failure or 5xx after a command | `P:app.mjs:20` | RV-302 |
| RV-149 | Първо провери последното непотвърдено действие. / Влез с профила, изпратил непотвърденото действие. / Изчакай текущото действие. | First check the last unconfirmed action. / Sign in with the profile that sent the unconfirmed action. / Wait for the current action. | new command while one is unconfirmed, wrong profile, or busy | `P:app.mjs:19-20` | RV-302 |
| RV-150 | Няма актуална връзка. Действието не е потвърдено. | No current connection. The action is not confirmed. | command while offline | `P:app.mjs:19` | RV-303 |
| RV-151 | Свързано · <time> / Няма актуална връзка · показан е последният изглед | Connected · time / No current connection · the last view is shown | connection line | `P:app.mjs:17` | RV-303 |
| RV-152 | Последното действие още не е потвърдено. | The last action is not confirmed yet. | banner | `PP:index.html:2` | RV-302 |
| RV-153 | Достъпът до сайта трябва да се поднови. Презареди страницата и влез отново. / Няма потвърждение за действието. Използвай „Провери последното действие“. / Сървърът временно не отговори правилно. Опитай отново. / Временно затруднение. Опитай отново. | Site access must be renewed. Reload and sign in again. / No confirmation for the action. Use "Check the last action". / The server did not answer correctly for the moment. Try again. / Temporary trouble. Try again. | non-JSON, redirected, 5xx | `P:api-client.mjs:16,19` | RV-302 |
| RV-154 | Сесията е прекратена. Влез отново. | The session has ended. Sign in again. | 401 / 403 while polling | `P:app.mjs:18` | RV-292 |
| RV-155 | Влез с индивидуален профил на хостеса или управител. / Необходим е профил на персонал. | Sign in with an individual hostess or manager profile. / A staff profile is needed. | other roles | `P:reservations/index.mjs:44`; `P:reservations/contacts.mjs:28` | RV-288 |
| RV-156 | Личен списък · <name>. Вижда се само от твоя профил. / Личната бележка не се копира в резервацията. / От моите редовни · <note> / Клиентът липсва. | Personal list · name. Only your profile sees it. / The private note is not copied to the reservation. / From my regulars / The client is missing. | contact screens | `P:reservations/contacts.mjs:20,24,39` | RV-353, RV-358 |
| RV-157 | Информационен запис. Не се извършва плащане или refund. | Information only. No payment or refund is made. | deposit fold in the form | `P:reservations/index.mjs:53` | RV-340 |
| RV-158 | Местата остават за цялата компания. Капацитетите са непотвърдени. | The places stay with the whole company. Capacities are unconfirmed. | arrivals dialog | `P:reservations/index.mjs:79` | RV-335 |
| RV-159 | Без капаро и пристигнали гости; проверява се свободният комплект. | No deposit and no arrived guests; the free set is checked. | copy dialog | `P:reservations/index.mjs:81` | RV-331 |
| RV-160 | По ред на добавяне. Капацитетът е непотвърден; прецени компанията преди избор. | In order of adding. Capacity is unconfirmed; judge the company before choosing. | waiting dialog | `P:reservations/index.mjs:61` | RV-379 |
| RV-161 | Резервирана · Настанени · Чакащи · Приключила · Неявили се · Изтрит запис · Отменена · Приключен | Reserved · Seated · Waiting · Finished · No-show · Deleted record · Cancelled · Closed | the label for each status value (`reserved`, `seated`, `waiting`, `finished`, `no_show`, `deleted`, `cancelled`, `closed`) | `P:shared.mjs:8` | RV-324 |
| RV-162 | Няма · Получено (detail card) / Отбелязано получено (form) · За връщане · Върнато · Задържано | None · Received / Marked received · To return · Returned · Retained | deposit status labels; the card and the form word `held` differently | `P:reservations/index.mjs:35,53` | RV-340 |
| RV-163 | Реално действие: <time> · резервационна дата <date> | Real action: time · reservation date | each history entry | `P:reservations/index.mjs:55` | RV-344 |

---

## 4. Data records and fields

Search that produced it: `grep -n "s\.bookings\|s\.blocks\|s\.contacts\|s\.audit\|s\.closeUndo\|s\.users\|s\.sessions\|s\.commands" -r modules/demo`; the empty state is `newState()` at `M:core.mjs:28`; the booking object is built at `M:reservations/commands.mjs:20`; the place catalogue is `PR:layout.mjs:8-57`; page-only state is the `let` list at `P:reservations/index.mjs:11-12`. Everything below lives in **one** stored JSON object (see RV-164), there are no separate tables.

### 4a. Records

| Id | Record | What it is | Where | Rules |
|---|---|---|---|---|
| RV-164 | Stored state | One row `restro_demo_state` (`id` 1, `version`, `payload` text) holding every collection for every feature (bookings, blocks, contacts, audit, repeat results, staff, sessions, and the song-side collections). One venue only. | `M:store.mjs:6-8`; `drizzle/0005_thankful_apocalypse.sql:1`; `db/schema.ts:35` | RV-300, RV-301 |
| RV-165 | Booking | One company's reservation, waiting entry or walk-in for one service date. Kept in `bookings`, keyed by id. | `M:reservations/commands.mjs:20` | see the fields below |
| RV-166 | Block | A place kept out of use until unblocked, keyed by place id in `blocks`. | `M:reservations/commands.mjs:13` | RV-345, RV-346, RV-347 |
| RV-167 | Personal regular client | One person in one staff member's own list, in `contacts` (created on first write). | `M:reservations/contacts.mjs:11,15` | RV-353 |
| RV-168 | Audit entry | One line of history; append-only list `audit`, shared with the song side. | `M:core.mjs:18` | RV-343, RV-344, RV-308 |
| RV-169 | Close record | Remembered state of every booking an evening-close touched, per date, in `closeUndo`. | `M:reservations/commands.mjs:16` | RV-349, RV-352, RV-351 |
| RV-170 | Repeat record | For each command: the exact payload and its result, keyed by `<actor id>:<key>`, in `commands`. Never pruned. | `M:domain.mjs:9,41` | RV-299, RV-309 |
| RV-171 | Staff profile | id, name, role, enabled, salt, hash, in `users`. | `M:api.mjs:8,70` | RV-293, RV-292 |
| RV-172 | Staff sign-in | SHA-256 of the cookie token → user and expiry, in `sessions`. Removed only on sign-out or when the profile is stopped. | `M:api.mjs:33,35,71` | RV-291, RV-292 |
| RV-173 | Place catalogue | The 118 reservable places and the drawing around them (rooms, sofas, columns, walls, notes). Code, not stored data. | `PR:layout.mjs`, `PR:structure.mjs`, `PR:plan-trace.mjs`, `PR:orthogonal-plan.mjs` | RV-362, RV-363, RV-364 |
| RV-174 | Page-only state (never saved) | viewed date, filter, mode, chosen places, source booking, zoom and pan, name toggle, focused booking / place, form draft, the Back steps, and in `sessionStorage` key `restro-v2-pending` the unconfirmed command | `P:reservations/index.mjs:11-12`; `P:app.mjs:20,40` | RV-378, RV-302, RV-313 |

### 4b. Booking fields

| Id | Field | Meaning and limits | Rules |
|---|---|---|---|
| RV-175 | `id` | random UUID made by the server | none (generated) |
| RV-176 | `date` | service date `YYYY-MM-DD`; fixed at creation (edit never changes it; copy makes a new record) | RV-312, RV-329, RV-311 |
| RV-177 | `tableIds` | list of canonical place ids; empty only for `waiting` | RV-327, RV-328, RV-364, RV-336 |
| RV-178 | `name` | company or person; up to 100 characters; may be empty only for a walk-in | RV-320, RV-321, RV-322, RV-382 |
| RV-179 | `phone` | as typed, up to 40 characters; the comparison form is normalised | RV-320, RV-321, RV-323, RV-330 |
| RV-180 | `guests` | expected guests, whole number 1–100 | RV-320, RV-335 |
| RV-181 | `arrived` | guests who arrived; 0 at creation, equal to `guests` for a walk-in, 1–100 through "Пристигнали" | RV-325, RV-335 |
| RV-182 | `arrival` | expected arrival, `HH:mm`; an estimate, not a time slot; required also for walk-ins | RV-320, RV-318, RV-329 |
| RV-183 | `note` | free text up to 500 characters | RV-320, RV-322 |
| RV-184 | `deposit` | whole euro cents 0–10,000,000; information only | RV-320, RV-340, RV-339 |
| RV-185 | `depositStatus` | `none`, `held`, `to_return`, `returned`, `retained` | RV-320, RV-339, RV-341 |
| RV-186 | `depositMethod` | free text up to 30; the form offers empty, "В брой", "Карта", "Банков превод", "Друго" | RV-320 |
| RV-187 | `status` | `reserved`, `seated`, `waiting`, `finished`, `no_show`, `cancelled`, `closed`, `deleted` | RV-324, RV-325, RV-335, RV-336, RV-338, RV-349 |
| RV-188 | `walkin` | true for "Настани без резервация" | RV-325, RV-321, RV-334 |
| RV-189 | `createdAt` | server time of creation (milliseconds) | RV-315, RV-317 |
| RV-190 | `updatedAt` | server time of the last change | RV-333 |
| RV-191 | `version` | starts at 1, +1 on every change | RV-333 |
| RV-192 | `createdBy`, `createdByName` | profile id and name of the creator, set from the signed-in profile (a value sent by the page is ignored); copy sets the copier | RV-332 |

Fields the page sends but the server does not store: `allowDuplicate` (RV-330), `saveRegular`, `regularId`, `regularVersion` (RV-359), `reason` (RV-342), `otherId`, `otherVersion` (RV-337), `place` (RV-345), `date` for close, undo and copy.

### 4c. Block, contact, audit, close record, staff

| Id | Field | Meaning and limits | Rules |
|---|---|---|---|
| RV-193 | block key | canonical place id (a block saved under `t-41` before the merge still works for `t-40`) | RV-348, RV-345 |
| RV-194 | block `reason` | required, up to 250 characters | RV-345 |
| RV-195 | block `at`, `actor` | when and who | RV-345, RV-343 |
| RV-196 | contact `id`, `owner`, `name`, `phone`, `note`, `archived`, `createdAt`, `updatedAt`, `version` | `owner` is the signed-in profile (any `owner` sent is ignored); name up to 100; phone up to 40, at least 7 digits; note up to 1000 and private | RV-353, RV-354, RV-355, RV-356, RV-357, RV-361 |
| RV-197 | audit `id`, `actor`, `actorName`, `action`, `entity`, `at`, `date`, `before`, `after`, `reason` | `id` counts up across the whole state; `at` is the real time; `date` is the booking's service date (null for non-booking); `before` / `after` are full copies; `reason` up to 250 | RV-343, RV-344, RV-342 |
| RV-198 | close record `at`, `rows`, `versions` | time of closing, copies of every booking touched (before), version each had after closing | RV-349, RV-352 |
| RV-199 | staff `id`, `name`, `role`, `enabled`, `salt`, `hash` | id `a-z0-9-`, 3–30; roles created: `hostess`, `dj`; hash is PBKDF2 | RV-293, RV-291 |
| RV-200 | staff sign-in `user`, `expires` | 12 hours from sign-in | RV-291, RV-292 |

### 4d. Place catalogue fields (static)

| Id | Field | Meaning | Rules |
|---|---|---|---|
| RV-201 | `id` | `t-<number>` for tables and booths (`t-53a`, `t-25.1` …), `bar-<n>-seat-<m>` for stools; stable; `t-41` is an alias of `t-40` | RV-362, RV-364, RV-365 |
| RV-202 | `label` (and `mapLabel`) | what staff read; some differ from the id (`t-40` → "40/41", `t-64a` → "84", `t-65a` → "85", `t-56` → "55", `t-28` → "0", stools "Бар N · стол X") | RV-366, RV-363 |
| RV-203 | `kind`, `shape`, `r`, `w`, `h` | `booth` (round, 1–16), `sofa-table` (square), `table` (round or rectangle), `stool` (small round) | RV-367 |
| RV-204 | `x`, `y` | position from the photo through a calibration matrix | RV-368 |
| RV-205 | `zone` (tables), `bar` (stools), `verified`, `needsReview` | grouping words ("Горен салон", "Сцена", "Долен салон", "Бар 1 / 2", "Бар 3"); used only by the legacy page; stools carry `verified: true` | RV-368 |
| RV-206 | capacity | **no such field exists**; every text says capacity is unconfirmed | RV-369 |

### 4e. Status values

Search that produced it: `grep -n "status" modules/demo/reservations/commands.mjs public/demo/shared.mjs` and the `statuses` table at `P:shared.mjs:8`; deposit values at `M:reservations/commands.mjs:8`; place states at `P:reservations/index.mjs:119` and `P:style.css:1`.

| Id | Value | How a record gets it, and what it can do next | Screen word | Rules |
|---|---|---|---|---|
| RV-207 | booking `reserved` | create with places; move of a `waiting` booking. Next: arrive → `seated`; noShow, finish, delete, cancel; close → `no_show`. Holds its places. | Резервирана | RV-324, RV-328, RV-318, RV-338, RV-349 |
| RV-208 | booking `seated` | walk-in; arrive. Next: finish, delete, cancel, noShow (the server allows it, no button); close → `finished`. Holds its places. | Настанени | RV-324, RV-335, RV-338, RV-349 |
| RV-209 | booking `waiting` | create without places. Next: move → `reserved`; delete, cancel, noShow, finish; close → `closed`. Holds nothing. | Чакащи | RV-324, RV-317, RV-336, RV-349 |
| RV-210 | booking `finished` | finish; close of `seated`. Nothing moves it on (only the close undo). | Приключила | RV-324, RV-338, RV-352 |
| RV-211 | booking `no_show` | noShow; close of `reserved`. Same as above. | Неявили се | RV-324, RV-338, RV-352 |
| RV-212 | booking `cancelled` | `booking.cancel` only (no screen sends it). Terminal. | Отменена | RV-324, RV-338, RV-339 |
| RV-213 | booking `closed` | close of `waiting`. Only the close undo reverses it. | Приключен | RV-324, RV-349, RV-352 |
| RV-214 | booking `deleted` | `booking.delete`; the "soft delete". Terminal, still listed under "Всички", still editable. | Изтрит запис | RV-324, RV-338, RV-334 |
| RV-215 | deposit `none` | default; also what a form or client that omits the field stores. | Няма | RV-341, RV-320 |
| RV-216 | deposit `held` | chosen in the form. Cannot be chosen when ending a booking. | Получено / Отбелязано получено | RV-341, RV-340 |
| RV-217 | deposit `to_return` | form, or the choice when deleting or cancelling. | За връщане | RV-341, RV-339 |
| RV-218 | deposit `returned` | same. Never set by the program. | Върнато | RV-341, RV-339 |
| RV-219 | deposit `retained` | same. | Задържано | RV-341, RV-339 |
| RV-220 | place state free | no block and no live booking on the viewed date. Green. | Свободно | RV-371, RV-370 |
| RV-221 | place state reserved | first live booking is `reserved`. Orange. | Резервирано | RV-371, RV-370 |
| RV-222 | place state seated | first live booking is `seated`. Red. | Настанени | RV-371, RV-370 |
| RV-223 | place state blocked | a block exists for the place or its alias. Grey. | Блокирано | RV-371, RV-347 |
| RV-224 | place state historical | purple, only if the history overlay were on; no button turns it on. | (none in the legend) | RV-371, RV-370 |
| RV-225 | drawing flags | `selected` (pulses), `moving-source`, `filter-highlight` (outline), `dim` (faded, 25% opacity: cannot be tapped in this mode), `allocation-conflict` ("N!" badge). | none | RV-373, RV-316, RV-364 |

## 5. Commands on the server

Search that produced it: `grep -ohE "action==='[a-zA-Z.]+'|p\.action==='[a-zA-Z.]+'|'booking\.[a-zA-Z]+'" modules/demo/reservations/*.mjs modules/demo/domain.mjs` and `grep -on "path==='/[a-zA-Z]*'" modules/demo/api.mjs`. All commands go through `POST /api/demo/command` with `action` and `key` (`M:api.mjs:73-75`), except the sign-in routes. Role for all rows: hostess or admin (RV-288). Every command is repeat-safe by key (RV-298, RV-299) and each is a single commit (RV-300).

| Id | Command | Inputs | What it checks and does | Audit | Rules |
|---|---|---|---|---|---|
| RV-226 | `booking.create` | `date`, `tableIds`, name, phone, guests, arrival, note, deposit fields, `allowDuplicate?`, `reason?`, `saveRegular?` | new booking; no places → `waiting`, with places → `reserved` | `booking.create` | RV-320, RV-321, RV-327, RV-328, RV-330, RV-325, RV-359 |
| RV-227 | `booking.walkin` | same, at least one place | status `seated`, `arrived` = `guests`; name and phone optional | `booking.walkin` | same as above plus RV-326 |
| RV-228 | `booking.copy` | `id`, `version`, `date`, `allowDuplicate?` | new booking with the source's data and places on the new date, deposit cleared | `booking.copy` | RV-331, RV-328, RV-330 |
| RV-229 | `booking.edit` | `id`, `version`, details | replaces the details; date, places, creator unchanged | `booking.edit` | RV-334, RV-320, RV-333 |
| RV-230 | `booking.arrive` | `id`, `version`, `arrived` | only `reserved` / `seated`; status `seated`; `guests` raised if lower | `booking.arrive` | RV-335 |
| RV-231 | `booking.move` | `id`, `version`, `tableIds` | replaces the full set; `waiting` becomes `reserved` | `booking.move` | RV-336, RV-328 |
| RV-232 | `booking.swap` | `id`, `version`, `otherId`, `otherVersion` | exchanges the two place sets in one commit | two entries (the other company first) | RV-337 |
| RV-233 | `booking.delete` | `id`, `version`, `depositStatus?`, `reason?` | status `deleted` | `booking.delete` | RV-338, RV-339 |
| RV-234 | `booking.cancel` | same | status `cancelled`; no screen sends it | `booking.cancel` | RV-338, RV-339 |
| RV-235 | `booking.noShow` | `id`, `version` | status `no_show` | `booking.noShow` | RV-338 |
| RV-236 | `booking.finish` | `id`, `version` | status `finished` | `booking.finish` | RV-338 |
| RV-237 | `block` | `place`, `reason` | adds a block | `block` | RV-345 |
| RV-238 | `unblock` | `place` | removes it | `unblock` | RV-346 |
| RV-239 | `closeReservations` | `date` | ends the evening for that date | one entry per booking | RV-349, RV-350 |
| RV-240 | `undoCloseReservations` | `date` | puts them back, all or nothing | one entry per booking | RV-352 |
| RV-241 | `contact.save` | `id?`, `version?`, name, phone, note | new or updated personal contact | none | RV-354, RV-355, RV-356, RV-357, RV-361 |
| RV-242 | `contact.archive`, `contact.restore` | `id`, `version` | hides / brings back | none | RV-357, RV-355 |
| RV-243 | `POST /login`, `POST /logout` | profile, password | staff session | none | RV-291, RV-296 |
| RV-244 | `POST /user` | create: id, name, role, password; or id + enabled | admin: new profile, or stop / activate (stopping deletes its sessions) | `user` entry on stop / activate and create | RV-293, RV-292 |
| RV-245 | `POST /seed` | none | admin: adds the sample evening | none for the batch itself; the commands it runs write their own | RV-381 |

## 6. Outside services

Search that produced it: `grep -rn "fetch(\|https\?://" modules/demo public/demo public/reservations --include=*.mjs` and `grep -n "import " scripts/demo-server.mjs "app/api/demo/[...path]/route.ts"`; `package.json` and `.dev.vars.example` for names. Nothing in the reservations screens calls a service other than the MVP's own server.

| Id | Service | Used for | Needed by reservations? | Rules |
|---|---|---|---|---|
| RV-246 | SQLite through Node's built-in `node:sqlite` (local runner), file `.demo-v2/state.sqlite`, write-ahead log, 10 s busy wait | storing the state | yes (local) | RV-300, RV-301 |
| RV-247 | Cloudflare D1 through the `DB` binding, and Cloudflare Workers hosting | the same state when hosted | yes (hosted) | RV-300 |
| RV-248 | Browser built-ins: `Intl` with time zone `Europe/Sofia`, `dialog`, SVG, pointer events, `requestAnimationFrame`, `sessionStorage`, Web Crypto (UUID, SHA-256, PBKDF2) | dates, map, unconfirmed action, sign-in | yes | RV-311, RV-376, RV-302, RV-291 |
| RV-249 | OpenCV, run once by hand on the venue photograph to trace walls; not a dependency of the app | the drawing of the plan | no (design time only) | RV-368 |
| RV-250 | YouTube Data API (key `YOUTUBE_API_KEY`) | song search | no | none for reservations |
| RV-251 | Stripe test adapter `modules/payments/stripe.mjs` | song payments; not connected | no | none |
| RV-252 | Clubinno (the club's current reservation system) | nothing: decided that Restro replaces it with no connector or sync | no | RV-383 |
| RV-253 | Mistral (the club's sales system) | nothing for reservations | no | none |
| RV-254 | e-mail delivery | nothing for staff; guest recovery codes are shown on screen in demo mode | no | none |
| RV-255 | `package.json` lists Next, React, Drizzle, shadcn pieces for the hosted wrapper and the older pages; the active panel is plain JavaScript modules with no framework | the wrapper | no | none |

## 7. Settings and flags

Search that produced it: `grep -rn "env\.[A-Z_]*\|process.env.[A-Z_]*" modules/demo scripts/demo-server.mjs "app/api/demo/[...path]/route.ts"` and `.dev.vars.example`. There is no settings screen and no per-venue or per-user setting for reservations.

| Id | Setting | Effect | Where | Rules |
|---|---|---|---|---|
| RV-256 | `APP_MODE` (`demo` or `live`) | `live` makes the whole demo API answer 503; `demo` also lets the auto-sample flag work | `M:api.mjs:21,25,55`; `S:demo-server.mjs:11` | RV-297 |
| RV-257 | `DEMO_V2_ENABLED` (must be `'true'`) | otherwise 503 | `M:api.mjs:21,25` | RV-297 |
| RV-258 | `HOSTED_DEMO` | `true` means the table is created by migration, not by the code | `M:api.mjs:20,21,29`; `M:store.mjs:6` | none |
| RV-259 | `LOCAL_DEMO` | `true` shows e-mail codes on screen (song side) | `M:api.mjs:37,64` | none for reservations |
| RV-260 | `DEMO_AUTO_SAMPLES` | `true` (and `APP_MODE=demo`) adds the sample evening on a snapshot, once per service day; the local runner does not set it | `M:api.mjs:55-56`; `M:fixtures.mjs:71-78` | RV-381 |
| RV-261 | `PRIVATE_DEMO` | only the legacy server reads it | `modules/reservations/api.mjs:34` | none |
| RV-262 | `YOUTUBE_API_KEY` | song search | `S:demo-server.mjs:13` | none |
| RV-263 | `RESTRO_DEMO_PORT` (default 5181) | local port; the runner only accepts the host `127.0.0.1:<port>` | `S:demo-server.mjs:16,18` | none |
| RV-264 | `DB` binding | the state store | `M:api.mjs:20` | RV-300 |
| RV-265 | fixed values in code (no setting) | service day ends 06:30, staff session 12 h, late after 15 min, undo of closing 5 min, 125 places per booking, guests 1–100, 2000 contacts, 1,800,000-character state, rate limits | the rule rows named here | RV-311, RV-291, RV-318, RV-352, RV-327, RV-320, RV-356, RV-301, RV-296 |

## 8. Timers and scheduled work

Search that produced it: `grep -n "setInterval\|setTimeout\|AbortSignal.timeout\|Max-Age\|expires:\|300000\|43200\|390" modules/demo public/demo scripts/demo-server.mjs -r`. No timer ever changes a booking: nothing releases, expires or closes anything by the clock.

| Id | Timer | Value | Where | Rules |
|---|---|---|---|---|
| RV-266 | page asks the server for a new snapshot | every 3 s while connected, 10 s after an error, and again when the tab becomes visible, on `online`, and after every command | `P:app.mjs:18,38` | RV-304 |
| RV-267 | one request gives up | 15 s | `P:api-client.mjs:7` | RV-302 |
| RV-268 | server-side background pass that only settles song payments | every 2 s in the local runner (nothing for bookings) | `S:demo-server.mjs:15`; `M:api.mjs:21` | none for reservations |
| RV-269 | staff sign-in lifetime | 12 h (cookie and stored expiry) | `M:api.mjs:33` | RV-291 |
| RV-270 | window to undo "Приключи вечерта" | 5 min (300,000 ms) | `M:reservations/commands.mjs:18`; `M:domain.mjs:47` | RV-352 |
| RV-271 | "Закъсняват" threshold | 15 min after arrival; worked out only when the page draws | `PR:planner.mjs:17` | RV-318, RV-319 |
| RV-272 | service day rollover | 06:30 Sofia (the viewed date does not move by itself while the page is open) | `M:core.mjs:7`; `P:reservations/index.mjs:11` | RV-311, RV-313 |
| RV-273 | map flight | 240 ms, ease-out cubic, skipped with reduced motion | `P:reservations/map-camera.mjs:11-12`; `P:reservations/index.mjs:109` | RV-376 |
| RV-274 | wheel zoom re-draw after 100 ms; tap ignored for 80 ms after a drag; toast shown 6.5 s | small page timers | `P:reservations/index.mjs:139,141`; `P:app.mjs:16` | RV-372 |
| RV-275 | commit retries | up to 80 attempts, random wait up to 100 ms | `M:store.mjs:8` | RV-300 |
| RV-276 | rate-limit window | one minute | `M:api.mjs:16` | RV-296 |
| RV-277 | cookie lifetime | staff 12 h; guest 30 days (song side) | `M:api.mjs:13,30,33` | RV-291 |
| RV-278 | sample evening | at most once per service day | `M:fixtures.mjs:71-78` | RV-381 |
| RV-279 | clean-up or deletion by age | **none exists** for bookings, audit, repeat records, sign-ins or contacts | (absence) `grep -n "delete s\." -r modules/demo` | RV-308, RV-309, RV-310 |

## 9. Roles and permissions

Search that produced it: `grep -n "role(\|\.role" -r modules/demo`; `M:api.mjs:8,11,70`; `M:domain.mjs:44-47`. Roles in the data: `admin` (shown "Управител"), `hostess`, `dj`, `guest` (anonymous song visitor).

| Id | Role / capability | What it can do for reservations | Where | Rules |
|---|---|---|---|---|
| RV-280 | `admin` (manager) | everything a hostess can, plus `/user` (create hostess / DJ profiles, stop, activate) and `/seed`; sees the staff list | `M:reservations/commands.mjs:12`; `M:api.mjs:50,70`; `M:domain.mjs:47` | RV-288, RV-293 |
| RV-281 | `hostess` | all reservation commands for every booking (not only her own), her own contacts only, history of every booking | same | RV-288, RV-353, RV-344 |
| RV-282 | `dj` | nothing for reservations: refused with "Нямаш достъп до това действие." and receives no bookings in the snapshot | `M:domain.mjs:47`; `T:demo-v2.test.mjs:81` | RV-288, RV-289 |
| RV-283 | `guest` | nothing; there is no public booking route, no name or phone is ever sent to a guest | `D:API-CONTRACT-BG.md:43`; `M:domain.mjs:47` | RV-288, RV-289 |
| RV-284 | who receives `bookings`, `blocks`, history, `closeUndo` | `admin` and `hostess` only, all dates at once | `M:domain.mjs:47` | RV-289 |
| RV-285 | who receives `contacts` | `admin` and `hostess`, filtered to `owner` = self; the administrator does not see other accounts' lists | `M:domain.mjs:47`; `T:regular-contacts.test.mjs:7-14` | RV-353 |
| RV-286 | who the actor is | taken from the server session cookie; a creator, owner or actor sent by the page is ignored | `M:api.mjs:11,74`; `T:booking-author.test.mjs:8-11` | RV-290 |
| RV-287 | one phone, several hostesses | allowed in the records; implemented as "Вход / смяна" with a password | `P:app.mjs:28` | RV-291 |

---

# Rules and defaults

How it was found: every `if` / `err(` / `integer(` / `text(` / `sort(` / `setTimeout` in the reservation code paths was read (`grep -n "err(\|integer(\|text(\|\.sort(\|\.slice(\|Math\.\(min\|max\)" modules/demo/reservations/*.mjs modules/demo/core.mjs modules/demo/domain.mjs public/demo/reservations/*.mjs public/reservations/{layout,planner,labels,selection}.mjs`), plus the config files and data tables named in each row. "Decided by" points to a row in "Their decisions"; "no record" means no number in `docs/decisions/` or the later docs states it (the later docs are cited where they do). Rows are grouped; a rule that several fields share is stated once and referenced.

## A. Access, sign-in, identity

| Id | Rule | Where | Decided by |
|---|---|---|---|
| RV-288 | Every reservation and contact command needs the role `hostess` or `admin`; anyone else gets "Нямаш достъп до това действие." (403). The reservations screen is drawn only for those two roles. | `M:reservations/commands.mjs:12`; `M:reservations/contacts.mjs:3,14`; `M:core.mjs:29`; `P:reservations/index.mjs:44` | RV-384, RV-385 (admin also allowed: differs) |
| RV-289 | `bookings` (every date, every status, with phone numbers), `blocks`, history rows of `booking.*` / `block` / `unblock` / `closeReservations` / `undoCloseReservations`, and the close-undo expiry times go to `admin` and `hostess` only; `contacts` only the caller's own; the staff list (without password data) goes to `admin` only; DJ and guests get none of it. | `M:domain.mjs:47` | RV-388, RV-384 |
| RV-290 | The acting person comes from the server's cookie session, never from the page: a creator, owner or actor id sent by the page is ignored; a staff cookie that is unknown, expired or belongs to a stopped profile is not accepted. Snapshot and command re-check the profile again inside the commit. | `M:api.mjs:11,54,74`; `T:booking-author.test.mjs:8-11`; `T:regular-contacts.test.mjs:8` | RV-411 |
| RV-291 | Sign-in is profile id + password. The password is kept as PBKDF2-SHA-256, 100,000 rounds, per-profile salt; a password over 200 characters is refused; 8 tries a minute per profile id; the session lasts 12 hours; the cookie is HttpOnly, SameSite=Strict, Path=/, and Secure on https; "Изход" deletes the session. | `M:api.mjs:7,13,32-35` | RV-412 (mechanism, session length: open), RV-455, RV-443 |
| RV-292 | Stopping a profile deletes all its sessions at once; the next snapshot or command of that person fails with 403 "Достъпът е прекратен."; an admin cannot stop their own profile. Enabling again needs no new password. | `M:api.mjs:11,54,70-71,74`; `T:demo-v2.test.mjs:90` | RV-442, RV-411 |
| RV-293 | Only admin. New profile: id of lowercase letters, digits, hyphen, 3–30 characters; role `hostess` or `dj` only (never a new admin); password 12–100 characters; name up to 60 (the id if empty); a taken id is refused. There is no call to change a password and no staff "forgot password". Creating, stopping and activating write a `user` history entry (without the password); no screen shows these entries, because the page's history filter leaves them out. | `M:api.mjs:69-71` | RV-425, RV-411 |
| RV-294 | On first start the store holds four enabled profiles: `admin` ("Управител"), `host1` ("Елена"), `host2` ("Мария"), `dj` ("DJ"), all with one shared test password (not recorded in this file). | `M:api.mjs:8` | no record |
| RV-295 | A POST must carry the site's own `Origin` and not be marked cross-site (403 "Невалиден произход."); content type JSON (415); body at most 16,384 bytes (413); a JSON object (400); only GET and POST (405). | `M:api.mjs:14,26-28` | no record |
| RV-296 | Per minute and per running process: sign-in 8 per profile id, commands 1500 per identity; song side: search 30, e-mail 5, recovery 6. Kept in memory, so not shared between servers. A wrong-password burst for one profile id blocks that profile's own sign-in for the minute. | `M:api.mjs:15-16,32,37,58,64,74`; `D:API-CONTRACT-BG.md:26` | no record |
| RV-297 | If `APP_MODE` is `live`, or `DEMO_V2_ENABLED` is not `'true'`, every call answers 503 "Този модул е само за изрично активирано локално демо." | `M:api.mjs:25` | RV-415 |

## B. Commands, retries, storage, the page's behaviour on failure

| Id | Rule | Where | Decided by |
|---|---|---|---|
| RV-298 | A command needs a `key` of 16–80 characters from letters, digits, underscore, hyphen (else 400 "Липсва ключ за повторение."); `action` must be a string. The page makes a new UUID for each action. | `M:domain.mjs:8,10`; `P:app.mjs:19` | no record (`D:SYSTEM-AND-BACKEND-BG.md:231`) |
| RV-299 | Same person + same key + identical JSON text returns the saved result and changes nothing again; the same key with other data is refused ("Повторен ключ с други данни."). Field order counts, because the comparison is on text. | `M:domain.mjs:9,41` | RV-444 |
| RV-300 | Every change is "read the state, change it, save only if nobody else saved meanwhile". On a clash it re-reads and tries again, up to 80 times, waiting a random time of up to 100 ms; if nothing changed nothing is written; a command that fails leaves no trace. After 80 failures: 409 "Има едновременна промяна. Провери отново." Two hostesses asking for the same place therefore never both win. | `M:store.mjs:8`; `T:demo-v2.test.mjs:78` | RV-399, RV-404, RV-408 (all-or-nothing) |
| RV-301 | The whole stored state may not exceed 1,800,000 characters; above it every change is refused (503 "Тестовата база достигна лимита. Архивирай тестовия набор."). Bookings, history, repeat records, staff and the song side share this one cap. | `M:store.mjs:8` | no record |
| RV-302 | If a command gets no readable JSON answer (network, an HTML page, a 5xx), the page saves `{profile, payload}` in `sessionStorage`, shows the banner, blocks every new command, and "Провери последното действие" resends the identical payload with the same key. A 409 is a normal refusal, not an unknown outcome. Nothing is ever resent by itself. A request gives up after 15 s. | `P:app.mjs:19-20,37,40`; `P:api-client.mjs:7,14-19`; `T:demo-api-client.test.mjs:4-18` | RV-444 |
| RV-303 | While the last poll failed, a new command is refused on the page ("Няма актуална връзка. Действието не е потвърдено."); the last view stays, with the line "Няма актуална връзка · показан е последният изглед" (no time of the last update in that line). | `P:app.mjs:17,19` | RV-444 |
| RV-304 | The page asks for a snapshot every 3 s (10 s after an error, and again on tab focus and when the browser goes online). An unchanged snapshot answers 304 by ETag (server time left out of the comparison). The screen is redrawn only if the content changed, and not while a text field in the main area has focus or a dialog is open (unless forced after a command), so a map left open does not show another hostess's change until the next action. | `P:app.mjs:18,38`; `M:api.mjs:56`; `P:api-client.mjs:8,20` | RV-444 (partly) |
| RV-305 | After a successful command the page forces a snapshot; on the reservations screen, for `booking.*` commands, the map reopens on the saved booking (also after a delete) and the toast "Записано · тестови данни" shows. | `P:app.mjs:20`; `P:reservations/index.mjs:69` | no record |
| RV-306 | Dialogs stack: a dialog opened over another keeps the earlier one's live elements, so Back (button or Escape) returns to it with typed values intact; opening the map empties the stack; closing the sheet clears everything. | `P:sheet-history.mjs:2-16`; `P:app.mjs:11-14,22`; `T:sheet-history.test.mjs` | no record (`D:personal-regulars.md:13`) |
| RV-307 | Moves, place-set changes, swaps, assigning a waiting company, unblocking and undoing a close go through a "Потвърждение" dialog with one sentence and "Потвърди"; the command is sent only on that. | `P:app.mjs:23`; `P:reservations/index.mjs:61,75-76,83,85` | RV-399 |
| RV-308 | History is never trimmed, and every snapshot sends all of it to every hostess and admin. | `M:core.mjs:18`; `M:domain.mjs:47` | RV-423 |
| RV-309 | Repeat records (`commands`) and ended sign-in rows are never removed. | `M:domain.mjs:41`; `M:api.mjs:33` | RV-423 |
| RV-310 | Nothing deletes bookings, contacts, history or sign-ins by age; there is no purge, anonymise or export. | `grep -n "delete s\." -r modules/demo` shows only block, session and close-record removals | RV-423, RV-450, RV-422 |

## C. Dates and the service day

| Id | Rule | Where | Decided by |
|---|---|---|---|
| RV-311 | The service day ends 06:30 Europe/Sofia: before 06:30 the day is still the previous date. The server (`dayAt`) and the page (`serviceDate`) both apply it. | `M:core.mjs:7`; `P:reservations/index.mjs:11`; `T:demo-v2.test.mjs:81` | RV-434 and RV-458 (stated for the DJ evening); not stated for reservations (RV-503) |
| RV-312 | A date must be `YYYY-MM-DD`, a real calendar day, not before `0001-01-01` (so up to 9999). Past and far-future dates are accepted (2101 is in a test). Else 400 "Невалидна дата." | `M:core.mjs:8`; `T:demo-v2.test.mjs:81` | RV-409, RV-410 |
| RV-313 | The screen opens on today's service date worked out from the browser's clock when the page loads; it does not advance at 06:30 while the page stays open. | `P:reservations/index.mjs:11` | no record |
| RV-314 | "Календар" has three 5-row lists (day 1–31, month names, year from 50 before to 50 after the shown year, limited to 1–9999) and a field for an exact year (1–9999). A combination that is not a real date (31 April) gives "Невалидна дата.". There is no marker on today and none on dates that hold bookings. | `P:reservations/index.mjs:65` | RV-409, RV-410 |
| RV-315 | The list for a date, and the map's booking list, are sorted by creation time, then id; not by arrival time. | `P:reservations/index.mjs:31,44` | no record (`D:SYSTEM-AND-BACKEND-BG.md:172`) |
| RV-316 | Four filters, default "Активни". Активни = `reserved` + `seated`; Пристигнали = `seated`; Чакащи = `waiting`; Всички = every status of the date (finished, no_show, cancelled, closed and deleted too). The number beside each is that date's count. On the map a filter also highlights the matching places and flies the camera to them. | `P:reservations/index.mjs:30-31,44,60,106` | no record |
| RV-317 | For `waiting` bookings the hint is the minutes since creation, rounded down. | `P:reservations/index.mjs:49` | RV-403 |
| RV-318 | "Закъсняват N мин" only for status `reserved`, only when the viewed date is the current service day, and only from 15 whole minutes after the arrival time (14:59 → nothing, 15:00 → 15). Arrival times from 00:00 to 06:29 belong to the morning after the service date. Sofia time with the summer-time change is resolved by three correction passes. No automatic release. | `PR:planner.mjs:3-18`; `P:reservations/index.mjs:11,49`; `T:tables.test.mjs:62-66` | RV-387 |
| RV-319 | Late and waiting minutes are worked out only when the page draws, and the page redraws only when data changed, so the numbers stand still on an unchanged list. They use the browser's clock. | `P:app.mjs:18`; `P:reservations/index.mjs:49` | no record |

## D. Creating and changing a booking

| Id | Rule | Where | Decided by |
|---|---|---|---|
| RV-320 | Field limits: name up to 100 characters; phone up to 40; guests a whole number 1–100; arrival `HH:mm` from 00:00 to 23:59 (required even for a walk-in); note up to 500; deposit a whole number of cents 0–10,000,000 (0 if not sent); deposit status one of `none`, `held`, `to_return`, `returned`, `retained` (anything else is stored as `none`); deposit method up to 30 characters. The form adds: guests min 1 max 100, deposit €0–€100000 in steps of 0.01 (rounded to cents), note max 500. Defaults on the form: guests 2, arrival 23:00. | `M:reservations/commands.mjs:8`; `M:core.mjs:5-6`; `P:reservations/index.mjs:53-54`; `P:shared.mjs:10` | RV-388, RV-393, RV-435 |
| RV-321 | A booking that is not a walk-in needs a name and a phone with at least 7 digits (400 "Попълни име и телефон за предварителна резервация."); a walk-in needs neither. The copy command skips this check (RV-479). | `M:reservations/commands.mjs:8` | RV-388 |
| RV-322 | Every typed text is Unicode-normalised (NFKC), loses control characters and the characters `<` and `>`, is trimmed, and is cut to its limit (default 500). All text is HTML-escaped when drawn. | `M:core.mjs:5`; `P:shared.mjs:2` | no record |
| RV-323 | To compare phones: keep only digits and `+`; a leading `00` becomes `+`; a leading `0` followed by exactly 8 or 9 digits becomes `+359`. The stored phone keeps what was typed. | `M:core.mjs:9` | RV-400 says "normalized" but gives no rule |
| RV-324 | Booking statuses and who sets them: `reserved` (create with places; move of a `waiting`), `seated` (walk-in; arrive), `waiting` (create without places), `finished` (finish; close of `seated`), `no_show` (noShow; close of `reserved`), `cancelled` (cancel; no screen sends it), `closed` (close of `waiting`), `deleted` (delete). Only `reserved` and `seated` hold places ("live"). | `M:reservations/commands.mjs:5,16,20,24-27`; `P:shared.mjs:8` | RV-416 |
| RV-325 | A walk-in is created `seated` with `arrived` = `guests`; a booking with places is `reserved`, `arrived` 0; a booking without places is `waiting`, `arrived` 0. | `M:reservations/commands.mjs:20` | RV-392, RV-394 |
| RV-326 | A walk-in without a place is refused (409 "Избери свободно място."); the page also refuses to go on with nothing chosen when the mode is walk-in, but allows "Нова резервация" with no place (a waiting company). | `M:reservations/commands.mjs:20`; `P:reservations/index.mjs:74` | RV-392 |
| RV-327 | A list of places must be a list, at most 125 entries, no repeats, each a real place (the alias `t-41` is accepted and replaced by `t-40`); else 400 "Провери избраните места." | `M:reservations/commands.mjs:4` | no record (the legacy page capped at 20: `PR:selection.mjs:23`; `T:tables.test.mjs:59`) |
| RV-328 | Before places are saved (create, walk-in, copy, move, swap, undo of closing) each place must be not blocked (any date; an alias counts) and not held by another `reserved` / `seated` booking of the same date; a `waiting` booking holds nothing. The check is inside the commit, so a second phone asking for the same place gets "Мястото вече е заето за тази вечер.". | `M:reservations/commands.mjs:6,18,20,25,26`; `T:demo-v2.test.mjs:78` | RV-386, RV-405 |
| RV-329 | A booking holds its places for the whole service date; arrival time is only an estimate. Nothing frees a place by the clock: staff free places by finish, no-show, delete or the evening close. | `M:reservations/commands.mjs:6` (no time in the check) | RV-386 |
| RV-330 | On create, walk-in and copy: if the normalised phone is not empty and another booking of the same date in `reserved`, `seated` or `waiting` has the same one, the save is refused (409 "Има активна резервация със същия телефон. Отвори я или потвърди отделна.") unless the page sends `allowDuplicate`. The form's way is a tick "Създай отделна резервация при същия телефон"; there is no link to open the other booking. Edit does not check. Finished, no_show, cancelled, closed and deleted bookings do not trigger it. The place check runs first. | `M:reservations/commands.mjs:20`; `P:reservations/index.mjs:53` | RV-400, RV-414, RV-429 |
| RV-331 | `booking.copy` (needs the source's current version): a new id, creator = the person copying, status `reserved` (or `waiting` if the source has no places), `arrived` 0; keeps name, phone, guests, arrival, note and the same places; deposit 0 / `none` / empty; checks the places on the new date and the duplicate phone; the source is unchanged; works from any status, also from `deleted` ones; no name / phone check. | `M:reservations/commands.mjs:20`; `P:reservations/index.mjs:81` | RV-401 |
| RV-332 | `createdBy` and `createdByName` are set from the signed-in profile (name, else id) when the booking is made; edits and other changes never alter them; the page shows "Направена от <name>", falling back to the creation history entry, then the profile list, then "Не е записан". | `M:reservations/commands.mjs:20`; `PR:booking-author.mjs:2-6`; `T:booking-author.test.mjs` | RV-411 (each change tied to a profile); the "Направена от" line is not in the records |
| RV-333 | Every change to an existing booking must carry its current `version` (else 409 "Има промяна от друга хостеса. Обнови."); each change adds 1 and sets `updatedAt`. | `M:reservations/commands.mjs:7,28` | RV-390, RV-399 |
| RV-334 | `booking.edit` replaces name, phone, guests, arrival, note and the three deposit fields. Allowed in every status (also closed and deleted records). It does not change date, places, status, `arrived` or creator. It does not re-check duplicate phones. It does not check that guests is at least `arrived`. A walk-in may keep its name and phone empty. | `M:reservations/commands.mjs:23` | RV-414, RV-428 |
| RV-335 | `booking.arrive` only on `reserved` / `seated` (else "Не е активна резервация."); `arrived` a whole number 1–100; `guests` is raised to `arrived` if lower; status becomes `seated` for the whole company (all its places); arrived may later be lowered. | `M:reservations/commands.mjs:24` | RV-394, RV-395, RV-407 |
| RV-336 | `booking.move` replaces the whole set of places: only on `reserved`, `seated`, `waiting` (else "Преместването е само за активни записи."), at least one place ("Остави поне едно място."); a `waiting` booking becomes `reserved`; allocation re-checked. "Премести", "Добави места" and "Избери места" all send this one command; there is no command that adds a place, and no way to send a booking back to `waiting`. | `M:reservations/commands.mjs:25`; `D:API-CONTRACT-BG.md:91,101` | RV-397 (waiting → place), no record for the rest |
| RV-337 | `booking.swap`: both companies `reserved` / `seated`, same date, different bookings; their full place sets are exchanged and each is checked as if the other had left; any failure undoes everything; both versions +1; two history entries. The page picks the second company by tapping one of its places, then shows both place sets in the confirm sentence. | `M:reservations/commands.mjs:26`; `P:reservations/index.mjs:75`; `T:demo-v2.test.mjs:78` | RV-399 |
| RV-338 | `booking.delete`, `.cancel`, `.noShow`, `.finish` work only from `reserved`, `seated`, `waiting` (else "Записът е приключен."); they set `deleted`, `cancelled`, `no_show`, `finished`; nothing is erased and the places are free again; no command moves a record back to `reserved` or `waiting`. The page has buttons for delete, no-show (only on `reserved`) and "Освободи местата" (only on `seated`); cancel has none. | `M:reservations/commands.mjs:27`; `P:reservations/index.mjs:35,40,80`; `T:reservation-delete.test.mjs` | RV-393, RV-387, RV-404 |
| RV-339 | Delete and cancel of a booking with a deposit above 0 need a `depositStatus` of `to_return`, `returned` or `retained` (else "Избери как се отчита капарото."); no-show, finish and the evening close never change a deposit. | `M:reservations/commands.mjs:16,27`; `P:reservations/index.mjs:80` | RV-393, RV-404 |
| RV-340 | A deposit is information only: no payment, transfer or refund is made or started; every change is kept in history with before and after; the form says so. | `M:reservations/commands.mjs:8,27` (no money call); `P:reservations/index.mjs:53` | RV-393, RV-433, RV-435, RV-436 |
| RV-341 | Deposit status values and words: `none` Няма, `held` Получено (card) / Отбелязано получено (form), `to_return` За връщане, `returned` Върнато, `retained` Задържано. | `P:reservations/index.mjs:35,53,80` | RV-393 |
| RV-342 | Any reservation command may carry a reason up to 250 characters, saved in history. The booking form and the end dialogs call it optional ("по желание"); blocking requires one. | `M:core.mjs:18`; `P:reservations/index.mjs:53,80,82`; `M:reservations/commands.mjs:13` | RV-432, RV-433 |
| RV-343 | Every successful reservation command adds history entries inside the same commit: who (id and name), action, booking id, real time, the booking's service date, before and after, reason. Close and undo write one per booking, swap writes two (the other company first), block and unblock one, contact commands none. | `M:core.mjs:18`; `M:reservations/commands.mjs:13-28`; `M:reservations/contacts.mjs:13-22` | RV-411, RV-431, RV-414 |
| RV-344 | History is shown to admin and hostess for every date; the page filters it by booking ("История"), by service date ("История на вечерта") and by real calendar date in Sofia ("Промени днес", midnight to midnight, not the service day). Each entry shows the real time and the service date apart, and a folded before / after. | `M:domain.mjs:47`; `P:reservations/index.mjs:55,86-88` | RV-414, RV-428, RV-431 |

## E. Blocks

| Id | Rule | Where | Decided by |
|---|---|---|---|
| RV-345 | The place must exist and a reason of up to 250 characters is required (400 "Избери място и причина."). Refused (409) if any `reserved` or `seated` booking dated today's service day or later holds it; the message names nobody. The block has no date and stays until unblocked; saved with reason, time and actor; one history entry. | `M:reservations/commands.mjs:13` | RV-402, RV-405, RV-406 |
| RV-346 | The place must be blocked (else "Мястото не е блокирано."); no reason asked; one history entry. | `M:reservations/commands.mjs:14` | RV-402, RV-405 |
| RV-347 | A blocked place cannot be allocated on any date; the map draws it grey; closing an evening and undoing it never touch blocks. | `M:reservations/commands.mjs:6,16` | RV-405 |
| RV-348 | A block saved under `t-41` still protects `t-40` and the other way round; it can be removed from the combined place. | `PR:layout.mjs:74`; `T:venue-plan.test.mjs:38-39`; `T:reservation-map-actions.test.mjs:24-27` | `D:venue-plan-2026-10-27.md:7` only |

## F. Ending the evening

| Id | Rule | Where | Decided by |
|---|---|---|---|
| RV-349 | `closeReservations(date)`: for that date `seated` → `finished`, `reserved` → `no_show`, `waiting` → `closed`; version +1 and one history entry each; one close record is kept. It works for any valid date, also a future one (no check that the evening is over). The dialog shows the three counts first and nothing is sent until "Да, приключи вечерта". | `M:reservations/commands.mjs:16`; `P:reservations/index.mjs:84`; `T:reservation-map-actions.test.mjs:59-66` | RV-404 |
| RV-350 | The close never sets or returns a deposit; the dialog says so. | `M:reservations/commands.mjs:16`; `P:reservations/index.mjs:84` | RV-404 |
| RV-351 | A second close of the same date replaces the earlier close record, even when it touched nothing, which removes the chance to undo the first. | `M:reservations/commands.mjs:16` | no record |
| RV-352 | Allowed up to 5 minutes (300,000 ms) after the close. Each booking must still have the version it got on closing (else "Има последващи промени."), and every place must be free again (not blocked, not taken since); then all are restored to their old values, version +1, one history entry each, and the close record is deleted. If anything fails nothing is restored. The "Отмени приключването" button shows only while the window is open. | `M:reservations/commands.mjs:18`; `P:reservations/index.mjs:44`; `T:demo-v2.test.mjs:80,88` | RV-408 |

## G. Personal regular clients

| Id | Rule | Where | Decided by |
|---|---|---|---|
| RV-353 | A contact belongs to the signed-in profile; an `owner` sent by the page is ignored; someone else's or an unknown contact gives 404 "Клиентът не е в личния ти списък."; the administrator gets no wider view; guests and DJs get none. | `M:reservations/contacts.mjs:3-5,11,17`; `M:domain.mjs:47`; `T:regular-contacts.test.mjs:7-14` | none in the interviews (`D:personal-regulars.md:3`) |
| RV-354 | Name (up to 100) and phone (up to 40, at least 7 digits) are required (400 "Попълни име и валиден телефон."); the private note is up to 1000 and is kept when a later save sends none; every save sets `archived` to false. | `M:reservations/contacts.mjs:7-8,11` | none |
| RV-355 | Not two active contacts of one owner with the same normalised phone (409); restoring an archived one re-checks; archived ones do not count. | `M:reservations/contacts.mjs:9,20` | none |
| RV-356 | 2000 contacts per profile, archived ones counted, checked only when creating (409 "Достигнат е лимитът за личния списък."). | `M:reservations/contacts.mjs:10` | none |
| RV-357 | A change to an existing contact must carry its current `version` (409 "Клиентът е променен. Отвори го отново."); each change adds 1. Archive and restore are reversible. | `M:reservations/contacts.mjs:6,18-21`; `T:regular-contacts.test.mjs:15-20` | none |
| RV-358 | Under the name field, once 2 characters are typed, up to 8 active contacts whose name contains the text (case-insensitive, Bulgarian collation, sorted by name) are offered; nothing is chosen unless tapped; tapping fills name and phone, remembers id and version and shows "От моите редовни" with the private note; typing again forgets the pick. | `P:reservations/contacts.mjs:2-3,9-10,36-39`; `T:regular-contacts.test.mjs:27-30` | none (`D:personal-regulars.md:7`) |
| RV-359 | The tick "Запази / обнови в моите редовни" on save: the contact is checked first (as in `contact.save`, with the booking's name and phone), then the booking is made; both are written in one commit or neither. A picked contact is updated (needs its version); an unpicked one whose phone is already in the list refuses the whole save. The contact's note never goes into the booking, nor the booking note into the contact. A walk-in without name or phone cannot use it. | `M:domain.mjs:36-37`; `M:reservations/contacts.mjs:2-11`; `T:regular-contacts.test.mjs:21-25,31-36` | none (`D:personal-regulars.md:9`) |
| RV-360 | The personal list shows active contacts sorted by name, searchable by name or phone; archived ones sit in a folded "Архивирани" with "Възстанови". It opens over the booking form and returns to it with the typed values kept. | `P:reservations/contacts.mjs:15-21`; `D:personal-regulars.md:7` | none |
| RV-361 | Contact changes are not written to history. | `M:reservations/contacts.mjs` (no `audit` call) | `D:personal-regulars.md:3` says private notes stay out of the shared history |

## H. Places, map and navigation

| Id | Rule | Where | Decided by |
|---|---|---|---|
| RV-362 | 118 places: 76 tables and booths and 42 bar stools. Booths `t-1` … `t-16`. Other tables: `t-17 t-18 t-19 t-22 t-24 t-25 t-25.1 t-26 t-28 t-29 t-31 t-32 t-33 t-34 t-37 t-39 t-40 t-42 t-43 t-44 t-45 t-46 t-47 t-48 t-49 t-50 t-51 t-52 t-53a t-53b t-54 t-55 t-56 t-59a t-59b t-60 t-61 t-62 t-63 t-64a t-64b t-65a t-65b t-66 t-67 t-68 t-69 t-70 t-71 t-72 t-73 t-74 t-75 t-76 t-77 t-80 t-81 t-82 t-83 t-101`. Stools: see RV-363. Ids never change when the drawing changes. | `PR:layout.mjs:8-24,25,46-57`; `T:venue-plan.test.mjs:12-19` | `D:venue-plan-2026-10-27.md` (the paper plan); the interviews give no place list (RV-446) |
| RV-363 | Bar 1 has 16 stools (ids `bar-1-seat-1` … `-12` and `-15` … `-18`), Bar 2 has 15 (`bar-2-seat-1` … `-15`), Bar 3 has 11 (`bar-3-seat-1` … `-7`, `-10`, `-11`, `-12`, `-14`). Visible numbers run 1…N with no gaps in each bar; the label is "Бар N · стол X". The interview baseline speaks of 48 stools. | `PR:layout.mjs:46-57`; `T:venue-plan.test.mjs:12-19`; `D:venue-plan-2026-10-27.md:6` | RV-416 (48; replaced by the venue-plan doc) |
| RV-364 | `t-40` is the only drawn object (label "40/41"). `t-41` is kept as an alias: every list of places is turned into canonical ids on save (`t-41` → `t-40`); old records under `t-41` are not rewritten; allocation, block, history and selection treat both as one place; two old live bookings on the two ids stay reachable through a chooser dialog, and the map shows a badge "2!". | `PR:layout.mjs:71-74`; `M:reservations/commands.mjs:4`; `T:venue-plan.test.mjs:30-37`; `P:reservations/index.mjs:63,119` | `D:venue-plan-2026-10-27.md:7` |
| RV-365 | Not places any more: `bar-1-seat-13`, `-14`, `-19` and `bar-3-seat-8`, `-9`, `-13`. Old records using them show "Бар N · старо място M"; a new command that lists one is refused (it is not in the catalogue), so such a record must be moved to a real place before its places can be saved again. | `PR:layout.mjs:77`; `M:reservations/commands.mjs:4`; `D:venue-plan-2026-10-27.md:8` | `D:venue-plan-2026-10-27.md:8` |
| RV-366 | Shown labels that differ from the id: `t-40` "40/41", `t-64a` "84", `t-65a` "85", `t-56` "55", `t-28` "0"; a trailing a / b is dropped (`t-53a`, `t-53b` → "53"; `t-59a`, `t-59b` → "59"; `t-64b` → "64"; `t-65b` → "65"); `t-25.1` stays "25.1". So the printed numbers 53, 55 and 59 appear on two different places each. | `PR:layout.mjs:28,32`; `D:venue-plan-2026-10-27.md:9` | `D:venue-plan-2026-10-27.md:9` |
| RV-367 | Kind and shape: `booth` for `t-1`…`t-16` (round, radius 27 × scale); `sofa-table` (square) for 26 ids (`t-44 t-43 t-53a t-53b t-64a t-65a t-59a t-59b t-60 t-63 t-77 t-80 t-81 t-76 t-75 t-74 t-73 t-66 t-69 t-67 t-68 t-22 t-24 t-19 t-18 t-17`); rectangles for `t-45 t-42 t-29` (48×24), `t-40` (30×54), `t-52` (27×48), `t-70` (24×48); other photo-"rect" tables are drawn square; the rest are small round (radius 14 × scale); stools are round, radius 8 × scale. | `PR:layout.mjs:25-32,46,57` | `D:venue-plan-2026-10-27.md:5` ("user-requested shape conventions") |
| RV-368 | Positions come from photo pixels through one calibration matrix (four paper corners → a 1000×1414 plane, × 1.5); 118 photo anchors are recorded and tested; walls are straight horizontal / vertical runs traced by hand over the rectified photo (`orthogonal-plan.mjs`; `structure.mjs` walls are imported but not drawn); also drawn: 26 room labels, 24 sofas, 28 columns, 9 notes, 3 fixtures. The `zone` words and `needsReview` flags belong to the legacy page. | `PR:layout.mjs:1-6,34-45,58-69`; `PR:plan-trace.mjs:2-3`; `PR:orthogonal-plan.mjs:5-74`; `PR:structure.mjs:16-24`; `D:plan-calibration.md` | `D:plan-calibration.md`, `D:venue-plan-2026-10-27.md` (not in the interviews) |
| RV-369 | No place has a capacity; nothing compares guests with places; no capacity warning and no override exist. Texts say capacity is unconfirmed. | `PR:layout.mjs:32,70`; `P:reservations/index.mjs:53` | RV-398, RV-446 |
| RV-370 | Colours: free `#35a566` (green), reserved `#ce6a24` (orange), seated `#d85461` (red), blocked `#666` (grey), historical `#8979a5` (purple, never shown, see RV-471), chosen `#b9a5ff` (pulses). Reserved labels are dark, the rest white. | `P:style.css:1` | RV-395 says "seated/blue" |
| RV-371 | A place is drawn as: blocked if any block matches (alias counts); else the status of the first `reserved` / `seated` booking of the viewed date; else free. A place that holds two live bookings (old `t-40` and `t-41` records) gets a badge "2!". On a closed past evening every place is drawn free (finished, no_show, closed and deleted are not live). | `P:reservations/index.mjs:114,119` | RV-410 (differs) |
| RV-372 | Tapping a place: in a mode it toggles the choice (swap: replaces it with the one place); otherwise two live bookings → chooser; a booking → opens it (and switches the viewed date to its date); a blocked place → dialog with "Отблокирай"; a free place → its actions. A drag longer than 4 px is not a tap; Enter or Space also select. | `P:reservations/index.mjs:70,120,134` | no record |
| RV-373 | Which places can be tapped: no mode → all; swap → only places of another live booking; remove → only the booking's own; move / add / create / walk-in → not blocked and not held by another live booking (own places stay tappable, so "Добави места" can also take a place off). The page sets no limit on how many places are chosen; the server accepts 125. | `P:reservations/index.mjs:72,119,120` | no record (the legacy `selection.mjs` forbids removing in "add" and caps at 20) |
| RV-374 | Create and walk-in: places are chosen first (none is allowed for create → a waiting company), "Продължи" shows the form under the map, Back from the form returns to the map with places and typed values intact. A walk-in must have at least one place chosen. Move / add / swap: "Продължи" → confirm sentence → command. | `P:reservations/index.mjs:73-78,122` | RV-392, RV-397, RV-399 |
| RV-375 | Zoom between 0.6 and 4 by wheel (factor e^(−deltaY × 0.0015)), pinch or code; the zoom buttons exist only as unreachable handlers (×1.25, ×0.8). Two views are defined (main salon `75 195 1190 1280`, whole plan `75 60 1350 1990`); the whole-plan view is unreachable. | `P:reservations/index.mjs:90,94,125-141`; `PR:layout.mjs:80-81` | none |
| RV-376 | When a booking, place or filter is opened the camera flies there: 240 ms, ease-out cubic, never above scale 1.55, group bounds plus 200 units of margin; skipped with reduced-motion; cancelled by touch, wheel or any new step; only the SVG transform changes during the flight. | `P:reservations/map-camera.mjs:1-12`; `P:reservations/index.mjs:104-111`; `T:map-camera.test.mjs` | none (`D:plan-calibration.md:19`) |
| RV-377 | "Имена" shows company names beside their places: text 13 screen pixels, cut to 22 characters plus "…", placed below, above, right or left of the place in that order of preference, only where it fits inside a box of 950×960 units (smaller than the plan, see RV-469) without touching another name, room, table, sofa or column; if nothing fits the name is hidden. The prefix "Демо ·" is stripped. | `P:reservations/map-names.mjs:4-8`; `PR:labels.mjs:3-13`; `P:reservations/index.mjs:117`; `T:map-names.test.mjs` | none |
| RV-378 | Back: before each primary change (opening a booking, a filter, edit, a mode, the form, a place's actions) the page keeps a snapshot of date, mode, chosen places, source, name toggle, filter, focus, draft, zoom / pan, typed form values, folded sections and the inspector's scroll (up to 40, oldest dropped); Back / Escape / ✕ pops one; with none left it closes the map. Saving a booking drops the editing steps; closing the map or changing profile clears all. Zooming and place taps in a mode add no step. | `P:reservations/map-steps.mjs:2-17`; `P:reservations/index.mjs:13-22,58,69`; `P:app.mjs:12`; `T:map-steps.test.mjs`; `T:reservation-map-actions.test.mjs:98-106` | none (`D:personal-regulars.md:15`; `D:decisions/README.md:21` say these came later) |
| RV-379 | "Предложи на чакащи" (on a free place) lists the date's `waiting` bookings by creation time with minutes waited and a note that capacity is unconfirmed; "Избери компания" → confirm sentence → `booking.move` of that company to that one place. Nothing is offered automatically when a place is released, and nothing is filtered by size. | `P:reservations/index.mjs:61` | RV-397, RV-403 |
| RV-380 | "История" on a place lists the viewed date's bookings that hold or held it, any status, each with "Преглед". | `P:reservations/index.mjs:62` | RV-410 |

## I. Demo data and seeded values

| Id | Rule | Where | Decided by |
|---|---|---|---|
| RV-381 | `POST /seed` (admin) or, when `DEMO_AUTO_SAMPLES` is on, the first snapshot of each service day adds 20 songs and 15 bookings once per batch key: Рожден ден на Мария (t-9, t-10, 8 guests); Компанията на Борис (t-14, 6 guests, 3 arrived); Бар компания (bar-2-seat-1 … 3, 3 arrived); Гости без резервация (t-15, walk-in, 2); Чакащи голяма компания (no place, 8, added 35 min ago); Чакащи двойка (no place, 2, 12 min ago); Отказана с капаро (t-16, deposit 5000 cents, `held`, "В брой", then cancelled); Неявили се (t-17, 5, no_show); Компанията на Калина (t-18, 4, arrival 22:30); Утре вечер (t-9, +1 day); Утре малка компания (t-2, +1 day); Следващата седмица (t-29, t-24, +7 days, 10 guests, deposit 10000, `held`, "Банков превод"); Вчера първа компания and Вчера втора компания (both t-22, −1 day, finished, the second with arrival 01:00); Миналата седмица (t-39, −7 days, cancelled). Places taken or blocked are swapped for free ones; phones are `+0000000NNNN`, walk-in none. | `M:fixtures.mjs:5-66,71-78`; `M:api.mjs:49-56` | no record |
| RV-382 | A name that starts with "Демо ·" or "Демо :" is shown without that prefix in the list and on the map, for real data as well. | `P:reservations/index.mjs:49,117` | no record |
| RV-383 | No code reads from or writes to Clubinno or any other reservation system, and nothing imports existing bookings. | `grep -rni "clubinno" modules public/demo public/reservations public/panel lib app scripts` finds only two comments in legacy files saying it is not connected (`modules/reservations/README.md:5`, `public/reservations/index.html:7`) | RV-413, RV-426, RV-427 |

---

# Their decisions

The fourth source: what the club's owner decided, as written in the MVP's own records. Read: `docs/decisions/reservations-interview-2026-10-18.txt` (all of it: R1–R27 and the unnumbered additions), `questionnaire-2026-10-18.txt` (all Q1–Q47; the ones touching reservations, staff accounts, devices, deposits, guest contact data, Clubinno or the venue plan are rows below), `questions-by-recipient-2026-10-18.txt` (all; the touching items are rows below), the DJ interview (only the service-day line, `dj-interview-2026-10-18.txt:24`), and the later notes `docs/OPEN-QUESTIONS-BG.md`, `docs/personal-regulars.md`, `docs/plan-calibration.md`, `docs/venue-plan-2026-10-27.md`. I translated faithfully and did not judge whether a decision is good. These are about song requests, payments, the DJ session, music rights or the payment provider and are **not** rows here; they belong to the song-request inventory: Q1–Q8, Q10–Q14, Q20–Q21, Q30, Q33–Q40, Q45–Q47; Z01–Z05, Z07–Z09; every P, M and J item; F01–F06; A01–A07, A10; T02, T04–T07, T09. Q14, Q20, Q21 and Z09 (end of the DJ evening) are the song-side twins of R18.

Source file shorthands: `INT` = `docs/decisions/reservations-interview-2026-10-18.txt`, `QST` = `docs/decisions/questionnaire-2026-10-18.txt`, `QBR` = `docs/decisions/questions-by-recipient-2026-10-18.txt`, `OQ` = `docs/OPEN-QUESTIONS-BG.md`. "Reason" is only what the record says; "none recorded" means the record gives none.

Marks: **decided and built** · **decided, not built** · **decided, built differently** · **open in their records**. A replaced row has no mark; the row that replaced it has.

The records are marked "historical" at their top (`INT:1`): later decisions about Stripe, the cooldown, 06:30, prepare / start and the dropped song pre-approval win. None of those touches reservations except the 06:30 boundary (RV-434).

Reading problem in `INT`: the headings at `INT:113-117` (deferred map check, R26, R27) are stacked at the top and their bodies follow at `INT:119-125` in another order: `INT:119-121` is R27's text, `INT:123` is R26's text, `INT:125` is the deferred map check's text. I matched them by content.

## 1. The reservations interview, R1 to R27

| Id | Source | Decision (translated) | Reason | Mark | Proof, or replaced by |
|---|---|---|---|---|---|
| RV-384 | R1, `INT:11` | The first release is for staff only. Guest self-service online reservations are a later stage. | none recorded beyond "later stage" | decided and built | no public booking route (`D:API-CONTRACT-BG.md:43`); bookings reach only admin / hostess (`M:domain.mjs:47`); `M:reservations/commands.mjs:12` |
| RV-385 | R1 clarification, `INT:24` | The reservation module is only for hostesses, not for guests or other staff roles (DJ, waiters). Do not infer permission from merely having a staff account. How exactly hostesses sign in stays to be confirmed. | none recorded | decided, built differently | DJ is refused (`T:demo-v2.test.mjs:81`) but `admin` can do everything a hostess can (`M:reservations/commands.mjs:12`), and `OQ:12` says the owner wants the manager mostly to watch and lists the split as open |
| RV-386 | R2, `INT:12` | A reservation holds its chosen tables / bar seats for the whole venue evening. Arrival time is an estimate, not a booking interval. Staff release places explicitly; no automatic time-slot turnover. | none recorded | decided and built | `M:reservations/commands.mjs:6` (no time in the check); no timer changes a booking |
| RV-387 | R3, `INT:25` | More than 15 minutes after the expected arrival, show a late warning without releasing places. The hostess may wait, update the arrival time, or mark no-show and release the places. Deposit consequences and reversing a no-show are to be specified separately. | none recorded | decided, built differently | warning shows from exactly 15 min ("at least", not "more than": `PR:planner.mjs:17`, `T:tables.test.mjs:63`), only in the list, only for the current service day, only on `reserved` (`P:reservations/index.mjs:11,49`); edit and "Неявили се" exist (`P:reservations/index.mjs:35,40`); no-show reversal is not built |
| RV-388 | R4, `INT:26` | Phone is required for advance reservations and optional for walk-ins. Guest phone data is limited to authorised hostesses. No customer self-service screens or guest payment flows. | none recorded | decided and built | `M:reservations/commands.mjs:8`; `M:domain.mjs:47` |
| RV-389 | R5, `INT:30` | Deferred by the owner: whether each hostess has an own login and profile. Not an approval of shared credentials. | owner deferred | replaced | replaced by RV-411 |
| RV-390 | R6, `INT:31` | Authorised hostesses may edit all reservations of their venue whoever made them, so shifts can hand over. | shift handover | decided and built | no creator check in `M:reservations/commands.mjs:7`; creator stays visible (`PR:booking-author.mjs`) |
| RV-391 | R6, `INT:31` | Venue isolation still applies. | none recorded | decided, not built | one venue only; no venue field on a booking (`M:reservations/commands.mjs:20`); `D:SYSTEM-AND-BACKEND-BG.md:227` says the single-venue demo does not prove isolation |
| RV-392 | R7, `INT:32` | A direct "Seat Walk-In" action from a free table or bar seat, recording the guest count and an optional name, without a prior reserved state; phone stays optional; the places are claimed atomically with collision protection and history. | none recorded | decided and built | `M:reservations/commands.mjs:20`; `P:reservations/index.mjs:36,66` |
| RV-393 | R8, `INT:36` | Deposits stay informational: no collection, transfer or refund. When a reservation is cancelled the hostess records To Return / Returned / Retained; these are manually reported, never set to Returned automatically; keep the amount and the change history. Reasons and receipt-method fields are not approved by this answer. | none recorded | decided, built differently | the three choices are asked on delete and cancel (`M:reservations/commands.mjs:27`), but the only screen route is "Изтрий запис" (status `deleted`); `cancelBooking` has no button (`P:reservations/index.mjs:80`; RV-482) |
| RV-394 | R9, `INT:37` | Keep expected and arrived guests apart (e.g. Arrived 3 of 8); update arrivals without a new booking; all places stay held for the company. Colouring of the whole group, guest-count reductions and extra arrivals remained to resolve; do not free seats because guests are missing. | none recorded | decided and built | `M:reservations/commands.mjs:24`; `P:reservations/index.mjs:35,51`; a reduction below `arrived` is not guarded (RV-487) |
| RV-395 | R10, `INT:41` | At the first arrivals mark all places of the company seated (blue) and show arrived against expected; the remaining places stay with the same reservation. | none recorded | decided, built differently | status turns `seated` for the whole company (`M:reservations/commands.mjs:24`); seated is drawn red, not blue (`P:style.css:1`) |
| RV-396 | R10, `INT:41` | Venue arrived-guest metrics must use the actual arrived count, not the expected count. | none recorded | decided, not built | no venue figure or total exists in the screens or the snapshot (`M:domain.mjs:47`) |
| RV-397 | R11, `INT:42` | When places are released, show suitable waiting companies as suggestions; the hostess picks and confirms; nothing is seated automatically; fit by party size depends on verified capacities, which do not exist, so do not invent them. | none recorded | decided, built differently | an on-demand list from a free place, in order of adding, no size filter, one place assigned (`P:reservations/index.mjs:36,61`); nothing is shown when a place is released |
| RV-398 | R12, `INT:46` | Once verified capacities are configured, warn when expected guests exceed them (8 guests / 6 places); an authorised hostess may continue and the override is audited; unknown capacity is neither zero nor enough. | none recorded | decided, not built | no capacity field (`PR:layout.mjs:32`); texts only say it is unconfirmed (`P:reservations/index.mjs:53`) |
| RV-399 | R13, `INT:47` | A separate "Swap Companies" action: choose two reservations, preview the exchanged assignments, confirm once; swap complete place sets atomically, keep each company's guest, contact, deposit, arrival and status; a conflict rejects the whole swap; capacity warnings follow R12; no moment where a third company can take either set. | none recorded | decided and built | `M:reservations/commands.mjs:26`; `P:reservations/index.mjs:75` (the preview is one sentence naming both place sets); `T:demo-v2.test.mjs:78` |
| RV-400 | R14, `INT:51` | Warn on the same normalised phone for the same evening, showing the matching reservation and the choices Open Existing / Create Separate; no uniqueness rule; later decide which closed records warn; never merge silently. | one contact can organise separate groups | decided, built differently | refusal text plus a tick box (`M:reservations/commands.mjs:20`; `P:reservations/index.mjs:53`); the other booking is not shown or linked (RV-492); which records warn: see RV-414 |
| RV-401 | R15, `INT:52` | "Copy to Another Evening": a new reservation with name, phone, expected guests and requested places if still free on the target evening; no arrived guests and no carried deposit; the original stays; confirm the target date and availability before saving; a conflict creates no partial allocation and substitutes nothing. | none recorded | decided and built | `M:reservations/commands.mjs:20`; `P:reservations/index.mjs:81`; availability is checked at save, not shown before |
| RV-402 | R16, `INT:56` | "Block Place" for a table or bar seat with a required reason; a distinct blocked state; no allocation or seating until the hostess unblocks; not a guest reservation; never silently displace a reservation; date scope, handling of occupied places and unblock history left to acceptance details. | none recorded | decided and built | `M:reservations/commands.mjs:13-14`; `P:reservations/index.mjs:36,82` |
| RV-403 | R17, `INT:57` | The waiting list is ordered by time of adding, with elapsed waiting time; when places free up, offer suitable companies in that order; the hostess chooses; no mandatory automatic assignment; stable server order and verified capacities govern. | none recorded | decided and built | `P:reservations/index.mjs:31,49,61` (no capacity filter) |
| RV-404 | R18, `INT:61` | A hostess "Close Evening", separate from DJ sessions: preview what is affected; finish seated companies, mark reserved non-arrivals no-show, close waiting companies; keep all history, delete nothing; deposits stay manual; scoped, retry-safe, no silent partial close; no transfer to another evening and no reset of place blocks; partly arrived companies follow the seated rule. | none recorded | decided and built | `M:reservations/commands.mjs:16`; `P:reservations/index.mjs:84`; `T:demo-v2.test.mjs:80` |
| RV-405 | R19, `INT:69` | Place blocks last across evenings until a hostess unblocks them; keep reason and block / unblock history; closing an evening does not clear them; allocation checks include blocks; resolve existing future reservations before blocking. | none recorded | decided and built | `M:reservations/commands.mjs:6,13,14,16` |
| RV-406 | R20, `INT:73` | Before blocking a place that has active reservations for current or future evenings, show every affected reservation and make the hostess move or cancel them first; never move or cancel automatically; re-check the whole scope atomically at the commit; a cancellation keeps deposit follow-up and history. | none recorded | decided, built differently | the block is refused with one sentence and no list (`M:reservations/commands.mjs:13`; RV-493); the re-check is inside the commit |
| RV-407 | R21, `INT:77` | A hostess may raise expected / arrived counts when extra people come (8 of 8 → 10 of 10); apply the capacity warning and override of R12; no automatic extra place. | none recorded | decided and built | `M:reservations/commands.mjs:24` raises `guests` to `arrived`; the capacity warning is not there because R12 is not built |
| RV-408 | R22, `INT:78` | Allow undoing an accidental Close Evening within five minutes, only if every affected reservation is unchanged and its places can be restored without taking anyone's later places or breaking blocks; all or nothing, with history; otherwise say why it is refused; no financial transfer is undone (none exists). | none recorded | decided and built | `M:reservations/commands.mjs:18`; `T:demo-v2.test.mjs:80,88` |
| RV-409 | R23, `INT:82` | Hostesses must inspect reservations on the map for past and future evenings. An iPhone-style scrolling date picker with day, month and year columns, easy to move, no arbitrary short horizon; the chosen date drives map and list; show the chosen evening apart from Today; browsing writes or closes nothing; usable by keyboard and button as well as touch. The backend date check (then only 20xx) must be reconciled. | none recorded | decided, built differently | three 5-row lists and an exact-year field instead of wheels, no marker for Today (`P:reservations/index.mjs:65`); native list controls are keyboard-operable; the check now accepts 0001–9999 (`M:core.mjs:8`); browsing writes nothing |
| RV-410 | R24, `INT:88` | Keep reservations tied to their service date, reachable by calendar, map and list for past, current and future dates. The historical map shows the places used or reserved that evening even after closing, with every sequential reservation reachable when a place is chosen; a finished past booking does not occupy the place today. Future dates allow creating, with no business horizon; per-date conflicts and persistent blocks apply to every future booking; closing never erases calendar history; calendar markers only from really saved bookings; no claim of unlimited retention. | none recorded | decided, built differently | a closed evening draws every place free (`P:reservations/index.mjs:114,119`); the history overlay that would colour used places has no button (RV-471); the sequential bookings of a place are in the place history list (`P:reservations/index.mjs:62`); no calendar markers |
| RV-411 | R25, `INT:109` | Each hostess gets an own profile. All authorised hostesses may edit the venue's reservations and each change is tied to the authenticated profile. The sign-in may be remembered on a work phone or tablet; when someone leaves, her individual access is stopped, including active sessions. Replaces R5; no shared profiles, no access to other venues; a client-sent actor id proves nothing. | none recorded | decided and built | `M:api.mjs:8,11,69-71,74`; `M:reservations/commands.mjs:20`; sessions last 12 h only (RV-412) |
| RV-412 | R25 second paragraph, `INT:111` | The sign-in mechanism, the session length and revocation, and who creates and stops profiles are "to follow as technical / administrative details". | none recorded | open in their records | the code chose: password sign-in, 12 h, admin creates and stops (`M:api.mjs:32-35,69-71`) |
| RV-413 | R26 / Q15–Q16, heading `INT:115`, body `INT:123` | Restro fully replaces Clubinno as the main reservation system. No parallel register and no planned sync. No Clubinno connector because of the old photos; the photos stay a reference for geometry and numbers. If confirmed future reservations exist at the switch, a verified way of entering them is still to come; no automatic import or switching off of a real system is allowed. Mistral sales and fiscal questions stay separate. | none recorded | decided and built | nothing connects to Clubinno (RV-383) |
| RV-414 | R27 / Q17–Q19, heading `INT:117`, body `INT:119-121` | Hostesses may edit past and closed reservations. The history of the service date shows every change to its reservations even if made on another day, with real date and time, authenticated author and before / after; the real time is never replaced. A repeated phone warns only for active reservations and waiting entries of the same evening; refused, finished and no-show records do not warn but stay in the calendar. Hostesses keep the reservations and do the checked first entry of existing future ones; the manager watches. No approved automatic import or sync. | none recorded | decided and built | `M:reservations/commands.mjs:20,23`; `M:core.mjs:18`; `T:demo-v2.test.mjs:79` |

## 2. The unnumbered additions in the interview

| Id | Source | Decision (translated) | Reason | Mark | Proof, or replaced by |
|---|---|---|---|---|---|
| RV-415 | note, `INT:5` | 18 Oct update: the owner explicitly allowed the implementation in the demo. The older "wait" notes no longer block the demo; real payments and external integrations stay excluded. | none recorded | decided and built | live mode is refused (`M:api.mjs:25`); no Clubinno / Mistral connector |
| RV-416 | baseline, `INT:14-16` | Not additional owner approvals: grouped places; states reserved / seated / waiting / cancelled / finished; moving, adding and removing places; staff action history; protection against simultaneous edits; deposit informational; the map is derived from a photo and labels / capacities need venue checking; the then layout "includes 48 reservable bar seats, 15 with verified Bar 2 labels". | none recorded | decided, built differently | 42 stools: 16 / 15 / 11 (`PR:layout.mjs:46-57`; `D:venue-plan-2026-10-27.md:6`); eight statuses, not five (`P:shared.mjs:8`); "removing places" has no button |
| RV-417 | open frontier, `INT:18-20` | Open: late-arrival and no-show policy, required contact fields, capacity rules, staff permissions, deposit meaning and changes, waiting-list allocation, closing a night, the outside source of truth. | none recorded | replaced | replaced one by one by RV-387, RV-388, RV-398, RV-385 and RV-411, RV-393, RV-403, RV-404, RV-413 |
| RV-418 | still awaiting, `INT:63-65` | R5 (individual profiles) deferred; scope and length of blocks undecided. | none recorded | replaced | replaced by RV-411 and RV-405 |
| RV-419 | history question, `INT:84` | What a past map means: final state or places used during that evening; one place may have several completed bookings in one evening. | none recorded | replaced | replaced by RV-410 |
| RV-420 | legal review, `INT:90-92` | The owner asks for a Bulgarian legal and licence review before implementation: indefinite identifiable history, public name / amount disclosure, the payment-service role, music rights, fiscal documents; a capacity override cannot waive lawful safety limits; implementation "remains on hold" until the owner says so. | the owner's request | open in their records | no lawyer chosen (RV-438); the hold on the demo is lifted by RV-415; the research files it names are missing from the snapshot |
| RV-421 | legal priority, `INT:94-96` | Follow the owner's explicit legal-priority requirement; continued discussion is no permission for integration or real payments. | none recorded | open in their records | its text is in `RESTRO-LEGAL-PRIORITY.md`, which is not in the snapshot |
| RV-422 | L2, `INT:98-100` | Calendar history does not mean keeping names and phones forever. The owner wants the needed contacts kept for a specific dispute or unpaid bill; procedure, term and basis are open. | none recorded | open in their records | no code for it (RV-310) |
| RV-423 | deferred question, `INT:103-105` | To settle with the owner and a lawyer: how far back reservations are kept per evening, which fields stay in calendar history, how long name, phone and private notes are kept, which justified exceptions apply for a dispute. No term chosen; neither "never delete" nor "delete after an arbitrary period" is accepted. | the owner asked to defer | open in their records | nothing deletes anything (RV-310) |
| RV-424 | deferred map check, heading `INT:113`, body `INT:125` | The owner wants the exact numbers and capacities of tables and bar stools to stay among the general open questions; no answer is needed now and no values may be invented; uncertain numbers and capacities stay unconfirmed; reliable suggestions need checking with the venue; this is no permission to change the layout. | owner deferred | open in their records | `PR:layout.mjs:70`; later layout changes came from the paper plan (`D:venue-plan-2026-10-27.md`) |

## 3. The questionnaire (Q-numbers are the conversation order, not the R numbers)

| Id | Source | Decision (translated) | Reason | Mark | Proof, or replaced by |
|---|---|---|---|---|---|
| RV-425 | Q9, `QST:35,43` | The manager, or an administrator they name, creates and stops the hostess and DJ profiles; staff cannot register themselves with staff rights. Answer: yes. Named persons are not known. | none recorded | decided and built | `M:api.mjs:69-71` (admin only, role hostess or dj, no public sign-up) |
| RV-426 | Q15, `QST:51,59` | Restro becomes the main register for reservations, with no parallel manual keeping of the same new bookings in Clubinno. Answer: Restro replaces Clubinno wholly; a future switch, not a done one. | none recorded | decided and built | RV-383 |
| RV-427 | Q16, `QST:53,60` | No automatic sync with Clubinno or Mistral in the first version; carrying over future bookings needs its own verified plan first. Answer: Clubinno is not an integration target; this does not cancel the separate Mistral work for payments / fiscal reporting. | none recorded | decided and built | RV-383 |
| RV-428 | Q17, `QST:66,76` | Proposed: after the evening, ordinary hostesses only read history and only the manager corrects, with a reason. Answer: hostesses may edit past and closed reservations; changes show in the history of the booking's service date even when made another day; the real date and time, the authenticated author and before / after are kept; no rewriting of the real time, no bypass of rights, conflicts or financial rules. | none recorded | decided and built | the proposal is replaced by the answer, which is built the same as RV-414 |
| RV-429 | Q18, `QST:68,77` | The repeated-phone warning covers active reservations and waiting entries of the same evening only; refused, finished and no-show records stay in history but do not warn; the warning does not forbid a separate reservation. | none recorded | decided and built | `M:reservations/commands.mjs:20` |
| RV-430 | Q19, `QST:70,78` | The manager supplies a checked list of already confirmed future reservations before the real switch; answer: hostesses are the main operators of this checked first entry, the manager watches, there is no Clubinno sync and no automatic import, and confirmed future bookings are not ignored. The exact way "is still to come". | none recorded | open in their records | only ordinary entry exists; no import (`QST:62` says a verified plan is needed) |
| RV-431 | Q22, `QST:85,94` | Besides the booking-evening history there is a general log by the real date of each action and by hostess profile ("what each hostess changed today, also for other evenings"); one audit record shows in both views, time unchanged. | none recorded | decided, built differently | "Промени днес" lists all people together for the Sofia calendar date, midnight to midnight, with no per-hostess filter (`P:reservations/index.mjs:88`) |
| RV-432 | Q23, `QST:87,95` | Correcting a reservation of a closed evening has a reason field; it is optional and an empty reason does not block; old and new values, author and real time are kept anyway. | none recorded | decided and built | `P:reservations/index.mjs:53`; `M:core.mjs:18` |
| RV-433 | Q24, `QST:89,96` | Changing a deposit amount or status has a reason field, optional; old and new values, author and time always kept; the deposit stays informational. | none recorded | decided and built | the same optional reason; history stores before / after |
| RV-434 | Q25, `QST:100,112` | Keep the temporary boundary, now 06:30 Europe/Sofia instead of 06:00. It means no automatic capture, refund or deletion at that hour. The final protection for a forgotten close stays open; the explicit close and the warning stay. | none recorded | decided and built | `M:core.mjs:7`; stated for the DJ evening; reservations borrow it (RV-503); the forgotten-close fallback is open and is a song-side matter |
| RV-435 | Q26, `QST:102,113` | The club does not use deposits at present; the deposit stays optional, with an optional way of receiving (cash, card, bank transfer, other). A missing deposit blocks nothing; no real payment in this module. | the club does not use deposits at present | decided and built | `P:reservations/index.mjs:53` (select: empty, В брой, Карта, Банков превод, Друго) |
| RV-436 | Q27, `QST:104,114` | No document or payment reference field on the deposit "for now". | none recorded | decided and built | the booking has no such field (`M:reservations/commands.mjs:8`) |
| RV-437 | Q28, `QST:106,115` | Hostesses record the deposit and its changes; the manager follows through the log; old and new values are kept whatever the reason. | none recorded | decided and built | history stores before / after (`M:core.mjs:18`); the manager is an `admin` who sees all history; there is no manager-only view |
| RV-438 | Q29, `QST:119,131` | No Bulgarian lawyer is chosen for the concrete review; the legal review before a real start stays open. | none recorded | open in their records | nothing in the code |
| RV-439 | Q31, `QST:123,133` | Shared work phones or tablets are allowed, but mainly the hostesses' own phones are expected; individual profiles and revoking access / sessions stay; on a shared device there is a clear change of user; BYOD settings and terms are set when building. | none recorded | decided and built | "Вход / смяна" with password (`P:app.mjs:28`); revoke: RV-292; the BYOD settings remain open |
| RV-440 | Q32, `QST:125,134` | No own domain or service e-mail yet, one is planned soon; no provider chosen or purchase allowed; the demo may simulate sending. | none recorded | open in their records | staff sign-in uses no e-mail |
| RV-441 | Q41, `QST:184,198` | Until a domain / e-mail provider is chosen, codes and links are shown only in a clearly marked test mode and not really sent; test secrets are not exposed in production. | none recorded | decided and built | `M:api.mjs:37,64` (`LOCAL_DEMO`); it concerns guest recovery on the song side; staff sign-in has no e-mail codes |
| RV-442 | Q42, `QST:186,199` | Stopping a hostess or DJ profile also ends access on devices already signed in, not just the next sign-in. | none recorded | decided and built | RV-292 |
| RV-443 | Q43, `QST:188,200` | Changing person on a shared device needs the new person to authenticate, not just to pick a name. | none recorded | decided and built | `P:app.mjs:28`; `M:api.mjs:32` |
| RV-444 | Q44, `QST:190,201` | Offline, the last snapshot stays visible with its update time; reservation and payment actions are not shown as accepted without server confirmation; an unknown, already-sent result is cleared through the identical operation after reconnecting, with no new booking by assumption. | none recorded | decided, built differently | everything but the time: the offline line carries no "updated at" time (`P:app.mjs:17`); the rest is RV-302, RV-303, RV-299 |

## 4. The questions-by-recipient list and the MVP's own later open list

| Id | Source | Decision or question (translated) | Reason | Mark | Proof, or replaced by |
|---|---|---|---|---|---|
| RV-445 | Z06, `QBR:21,173` | Who at the venue creates and stops hostess / DJ profiles, restores work access and handles lost devices; which devices are shared. Update: the manager or a named administrator; the actual persons stay unknown. | none recorded | open in their records | the role exists (RV-425); no names, no device list |
| RV-446 | Z10, `QBR:29` | The exact numbers, shapes and positions of tables and stools, the capacities and any permitted limits; a verified plan. "Explicitly deferred by the owner." | owner deferred | open in their records | RV-369; the layout came from the paper plan (`D:venue-plan-2026-10-27.md:3`) |
| RV-447 | Z11, `QBR:31-33` | Is Restro the main reservation register or does Clubinno stay; is import / sync needed. | none recorded | replaced | replaced by RV-426 and RV-427; only the first-entry plan stays open (RV-430) |
| RV-448 | Z12, `QBR:35,176` | May past and closed bookings be corrected, by whom, which fields; which closed or refused records warn on a repeated phone. | none recorded | replaced | replaced by RV-428 and RV-429 |
| RV-449 | Z13, `QBR:37,177` | The club's real policy on receiving, returning and keeping deposits and who records them. Update: deposits are not usual now; optional method; no payment-reference field; history keeps before / after. | none recorded | replaced | replaced by RV-435, RV-436, RV-437 |
| RV-450 | A08, `QBR:129` | How long names, phones, notes, client lists, e-mails, reports, individual audit and backups are kept; which calendar data may stay after real anonymising. "The terms for reservations are an explicitly deferred question." | owner deferred | open in their records | RV-310 |
| RV-451 | A09, `QBR:131` | How a specific dispute or unpaid bill is documented so that only the needed evidence is kept; who may see it; when the exception is reviewed or ended. No general blacklist is approved. | none recorded | open in their records | no such feature in the code |
| RV-452 | A11, `QBR:135` | Extra e-commerce, accessibility, platform and contract requirements for the real screens and roles; the rules for deposits and no-shows. | none recorded | open in their records | none |
| RV-453 | F07, `QBR:109` | How really received, returned or kept deposits outside the reservation module are documented and tied to Mistral and the accounts. | none recorded | open in their records | the deposit is information only (RV-340) |
| RV-454 | F08, `QBR:111` | Which financial documents have a mandatory keeping time and how they are kept apart from unneeded reservation contacts. | none recorded | open in their records | RV-310 |
| RV-455 | T01, `QBR:149,178` | The mechanism for hostess and DJ sign-in and administration, session lengths, revocation, shared-device access. Update: individual sign-in, authenticated change of person, a stopped profile loses its sessions; domain, provider and terms are to come. | none recorded | open in their records | RV-291 chose one |
| RV-456 | T03, `QBR:153` | Where the API, database, notices and the periodic payment check are hosted; logs, monitoring, backups and restore; how the approved data policy and isolation between venues are kept. | none recorded | open in their records | RV-247, RV-246; no isolation (RV-391) |
| RV-457 | T08, `QBR:163` | Which central Restro specs, user and venue models and routes must be reconciled at the merge; migrations, moving permitted data, a way back. | none recorded | open in their records | this port |
| RV-458 | DJ interview 11, `dj-interview-2026-10-18.txt:24,206` | The temporary service-night boundary is 06:00 Europe/Sofia, to be revisited so the reset follows the DJ session end. | none recorded | replaced | replaced by RV-434 (06:30) |
| RV-459 | `OQ:12` | The owner wants the manager mainly to watch the reservations; the demo admin has write powers; split manager and administrator if the target roles should follow this. | none recorded | open in their records | `M:reservations/commands.mjs:12` |
| RV-460 | `OQ:16` | `booking.move` can set the final set of places; if a separate "remove places" flow is wanted, define what happens to the last place (waiting or cancel); "Изтрий запис" is something else. | none recorded | open in their records | `P:reservations/index.mjs:72` (a `remove` handler with no button) |
| RV-461 | `OQ:17` | The club's real deposit policy, documents, roles and the link to a future payment. | none recorded | open in their records | none |
| RV-462 | `OQ:26` | A verified plan and capacities, and the first entry of already made future reservations. | none recorded | open in their records | none |
| RV-463 | `OQ:27` | Real staff roles, who provisions and revokes accounts, and the rules for personal and shared devices. | none recorded | open in their records | none |
| RV-464 | `OQ:19` | Mobile end-to-end checks with the target's sign-in, Back, drafts, permissions and real conflict scenarios. | none recorded | open in their records | none (`D:merge-guide.md:50-54` lists the checks) |

---

# Built but never decided

Behaviours found in the code with no number in `docs/decisions/` behind them. Where a later note (`docs/personal-regulars.md`, `docs/plan-calibration.md`, `docs/venue-plan-2026-10-27.md`, `docs/OPEN-QUESTIONS-BG.md`, `docs/SYSTEM-AND-BACKEND-BG.md`) describes the behaviour, it is named; those notes record what was built, not what the owner decided, and `docs/decisions/README.md:21` says so for the map, Back, personal clients and soft delete. Rows are grouped; the groups marked "named by the lead" are the ones you asked me to look for on purpose. Everything here is from reading the code; nothing was run (the demo walk will confirm what is on screen).

## A. Map and Back (named by the lead)

| Id | Behaviour | Where | What the records say |
|---|---|---|---|
| RV-465 | Back is a stack of up to 40 saved snapshots (date, mode, chosen places, source, name toggle, filter, focus, form draft, zoom / pan, typed values, folded sections, inspector scroll). Steps are pushed before opening a booking, a filter, edit, a mode, the form, a place's actions; Back pops one and, when none is left, closes the map. Saving a booking drops the editing steps; closing the map or changing profile clears the stack. | `P:reservations/map-steps.mjs:2-17`; `P:reservations/index.mjs:13-22,58,69` | `D:personal-regulars.md:15` (2026-10-29); nothing in the interviews |
| RV-466 | Escape, the ✕ and the toolbar "Назад" all do the same as Back; inside the map this pops a step, in other dialogs it shows the previous dialog with its live elements. | `P:app.mjs:11-14,27`; `P:sheet-history.mjs` | `D:personal-regulars.md:13,15`; `D:merge-guide.md:45` |
| RV-467 | The map flies to a booking, place or filter: 240 ms, ease-out, never above scale 1.55; skipped with reduced motion; any touch cancels it. | `P:reservations/map-camera.mjs`; `P:reservations/index.mjs:104-111` | `D:plan-calibration.md:19` only |
| RV-468 | "Имена" toggle with pill labels: 13 screen pixels, 22 characters, placed beside the place only when free of other drawings. | `P:reservations/map-names.mjs`; `PR:labels.mjs` | `D:SYSTEM-AND-BACKEND-BG.md:180` |
| RV-469 | By reading: a name is accepted only if its box lies inside x ≤ 950 and y ≤ 960 (`PR:labels.mjs:10`), but the plan stretches to about y = 1300 (booth `t-1` sits near y ≈ 1265, `t-31` near 1228), so names of places in the lower part of the venue (lower salon, the lower bar areas) would never show. Not run; confirm in the walk. | `PR:labels.mjs:10`; `PR:layout.mjs:5,80-81` | none |
| RV-470 | The four list filters also act on the map: matching places are outlined and the camera flies to them; the same tabs sit inside the map. | `P:reservations/index.mjs:42,60,106,119` | `D:SYSTEM-AND-BACKEND-BG.md:172` |
| RV-471 | Code with no entry point in the active screens: `cancelBooking`, `remove` ("Премахване на места"), `mapClear`, `mapOverview` (whole-plan view), `mapReset`, `zoomIn`, `zoomOut`, `mapHistory` (the "used places" overlay that paints purple), the `placeCreate` / `placeWalkin` branch inside `reservationAction` (the shell intercepts these first, `P:app.mjs:33`), `bindReservations` (looks for `#service-date`, which no longer exists), the wall list imported from `structure.mjs`, and the legacy `selection.mjs`. The venue-plan note still says "the main salon and complete plan have separate views". | `P:reservations/index.mjs:11,58,66,68,72,80,90-94,143`; `P:app.mjs:33`; `PR:selection.mjs`; `D:venue-plan-2026-10-27.md:5` | `D:personal-regulars.md:13` says the history toggle was replaced by the legend |
| RV-472 | An open map does not repaint when another hostess changes something; it shows the last drawn state until the viewer acts, and then a stale version gives "Има промяна от друга хостеса. Обнови." | `P:app.mjs:18` | none |
| RV-473 | Five colours and a pulsing choice; reserved is orange, seated red; the legend has four swatches. | `P:style.css:1`; `P:reservations/venue-map.mjs:15` | `D:SYSTEM-AND-BACKEND-BG.md:178`; RV-395 said blue for seated |
| RV-474 | The whole drawing (118 anchors, 26 room labels, 24 sofas, 28 columns, 9 notes, straight walls, shape conventions) comes from the paper plan and the photo work, not from an interview; "the user-requested shape conventions" are mentioned but not written down. | `PR:layout.mjs`; `PR:orthogonal-plan.mjs`; `D:plan-calibration.md:7,17` | `D:plan-calibration.md`, `D:venue-plan-2026-10-27.md` |
| RV-475 | Stools: 16 / 15 / 11 with visible numbers 1…N and gaps in the internal ids; the interview says 48. | `PR:layout.mjs:46-57` | RV-416; `D:venue-plan-2026-10-27.md:6` |
| RV-476 | Six former stool ids are no longer places; old records show "старо място" and cannot be re-saved with those ids. | `PR:layout.mjs:77`; `M:reservations/commands.mjs:4` | `D:venue-plan-2026-10-27.md:8` |
| RV-477 | The 40 / 41 merge: one drawn object, an alias for old data, a chooser dialog and a "2!" badge when two live bookings sit on it. | `PR:layout.mjs:71-74`; `P:reservations/index.mjs:63,119` | `D:venue-plan-2026-10-27.md:7` |

## B. Actions (copy, swap, soft delete named by the lead)

| Id | Behaviour | Where | What the records say |
|---|---|---|---|
| RV-478 | Copy also carries the note; works from a finished, no-show, closed, cancelled or deleted record; target date typed in a plain date field with no availability preview. | `M:reservations/commands.mjs:20`; `P:reservations/index.mjs:81` | RV-401 names name, phone, guests, places only |
| RV-479 | Copy does not run the name and phone check, so copying a walk-in (empty name and phone) makes a `reserved` booking with no contact, which an advance reservation may not have. | `M:reservations/commands.mjs:20` | RV-388 |
| RV-480 | Swap is started on one company, finished by tapping a place of the other, with one confirm sentence; only two live companies of one date; capacities not shown. | `P:reservations/index.mjs:72,75,119` | RV-399 (preview wording not specified) |
| RV-481 | "Изтрий запис" is not a delete: the status becomes `deleted` ("Изтрит запис"), places are freed, history kept. A deleted record stays in "Всички", in the place history, can be opened and edited, cannot be restored, and the map reopens on it right after deleting. | `M:reservations/commands.mjs:27`; `P:shared.mjs:8`; `P:app.mjs:20`; `T:reservation-delete.test.mjs` | `D:merge-guide.md:42`, `D:SYSTEM-AND-BACKEND-BG.md:187`; RV-393 spoke of cancellation |
| RV-482 | The `cancelled` status and `booking.cancel` exist on the server and in the sample data, but no screen sends it; staff end a booking by delete, no-show or release. | `M:reservations/commands.mjs:27`; `P:reservations/index.mjs:80`; `M:fixtures.mjs:55,63` | RV-416 lists "cancelled" as a baseline state |
| RV-483 | No command takes a company back from `seated` to `reserved`, lowers `arrived` to 0, sends a booking back to `waiting` (the last place cannot be removed), or reverses a no-show; only the whole-evening undo within 5 minutes reverses anything. | `M:reservations/commands.mjs:24-27` | RV-387 left no-show reversal for later; `OQ:16` |
| RV-484 | "Пристигнали" can lower the number already entered; the status stays `seated`. | `M:reservations/commands.mjs:24` | none |
| RV-485 | A walk-in must still be given an expected arrival (default 23:00), stored as its `arrival`. | `M:reservations/commands.mjs:8,20`; `P:reservations/index.mjs:53` | RV-392 |
| RV-486 | Edit is allowed on every status, including closed and deleted ones, and on a finished past evening without an extra warning. | `M:reservations/commands.mjs:23` | RV-414 allows past edits; deleted records are not mentioned |
| RV-487 | Edit may set expected guests below the number arrived; nothing checks it. | `M:reservations/commands.mjs:8,23` | RV-394 left reductions open |
| RV-488 | An edit that does not send the deposit fields stores deposit 0, status `none`, method empty (the form always sends them; another client would wipe a deposit). | `M:reservations/commands.mjs:8,23` | none |
| RV-489 | "Приключи вечерта" works for any valid date, including a future one, where it would turn every reservation into `no_show`. | `M:reservations/commands.mjs:16` | RV-404 |
| RV-490 | A second close of a date replaces the earlier undo record, even when it changed nothing. | `M:reservations/commands.mjs:16` | RV-408 |
| RV-491 | Assigning a waiting company from the suggestion list moves it to the one tapped place only. | `P:reservations/index.mjs:61` | RV-397 |
| RV-492 | The repeated-phone warning does not show or open the other booking; the hostess must tick a box to go on. | `M:reservations/commands.mjs:20`; `P:reservations/index.mjs:53` | RV-400 |
| RV-493 | A refused block names no reservation; the hostess must find them herself. | `M:reservations/commands.mjs:13` | RV-406 |

## C. Personal regular clients (named by the lead)

| Id | Behaviour | Where | What the records say |
|---|---|---|---|
| RV-494 | The whole feature: a private list per profile with name, phone, private note, archive and restore, suggestions while typing a name, a tick to save from a booking, limits of 2000 contacts, 8 suggestions, 2 typed characters, note up to 1000, one active contact per phone. | `M:reservations/contacts.mjs`; `P:reservations/contacts.mjs`; `M:domain.mjs:36-37` | `D:personal-regulars.md` only; the interviews never mention it |
| RV-495 | Saving a booking with the tick for a person whose phone is already in the list, without picking that person, refuses the whole booking. | `M:reservations/contacts.mjs:9`; `T:regular-contacts.test.mjs:31-36` | `D:personal-regulars.md:9` |
| RV-496 | Contact changes leave no history at all; the administrator cannot see others' lists even for support. | `M:reservations/contacts.mjs` | `D:personal-regulars.md:3` |

## D. Limits, defaults and rules nobody wrote down (named by the lead)

| Id | Behaviour | Where | What the records say |
|---|---|---|---|
| RV-497 | At most 125 places per booking on the server, none on the page; the legacy page and server capped it at 20. | `M:reservations/commands.mjs:4`; `PR:selection.mjs:23` | none |
| RV-498 | Guests 1–100; name 100; phone 40; note 500; reason 250; block reason 250; deposit up to 10,000,000 cents (€100,000); deposit method 30. | `M:reservations/commands.mjs:8,13`; `M:core.mjs:5,18` | none |
| RV-499 | A phone starting with 0 and 8–9 more digits is read as +359…; the comparison drops all other characters. | `M:core.mjs:9` | RV-400 says "normalized" only |
| RV-500 | The repeated-phone check runs on create, walk-in and copy only. | `M:reservations/commands.mjs:20,23` | RV-400 |
| RV-501 | The list is ordered by when a booking was made, not by expected arrival. | `P:reservations/index.mjs:31,44` | `D:SYSTEM-AND-BACKEND-BG.md:172` |
| RV-502 | The late hint exists only on the list, only for the current service day, only on `reserved`, from exactly 15 minutes, and never updates by itself; it uses the browser's clock. | `PR:planner.mjs:3-18`; `P:reservations/index.mjs:11,49`; `P:app.mjs:18` | RV-387 |
| RV-503 | The 06:30 rule was decided for the DJ evening; reservations use the same function for "today", for the default date and for the block check, and the page computes it from the browser's clock once at load. The first reservations interview said nothing; the legacy README says 06:00. | `M:core.mjs:7`; `P:reservations/index.mjs:11`; `M:reservations/commands.mjs:13`; `modules/reservations/README.md:23` | RV-434, RV-458 |
| RV-504 | "Промени днес" cuts the day at midnight Sofia time, not at the service-day boundary, and lists everyone together. | `P:reservations/index.mjs:88` | RV-431 |
| RV-505 | Every hostess receives every history entry of every date with each snapshot (full before / after copies, phone numbers included). | `M:domain.mjs:47` | RV-390 allows editing all; says nothing on history size |
| RV-506 | History, repeat records and expired sign-ins grow without limit and share the 1,800,000-character cap with the song side. | `M:domain.mjs:41`; `M:core.mjs:18`; `M:store.mjs:8` | RV-423 |
| RV-507 | The phone in a booking card is a tap-to-call link. | `P:reservations/index.mjs:35` | none |
| RV-508 | Names starting "Демо ·" are shown without the prefix, in real data too. | `P:reservations/index.mjs:49,117` | none |
| RV-509 | Near-identical words for different states: `finished` "Приключила", `closed` "Приключен"; `held` is "Получено" on the card and "Отбелязано получено" on the form. | `P:shared.mjs:8`; `P:reservations/index.mjs:35,53` | none |
| RV-510 | Form defaults: guests 2, arrival 23:00. | `P:reservations/index.mjs:53` | none |

## E. Staff accounts and sign-in (R25 left the details open)

| Id | Behaviour | Where | What the records say |
|---|---|---|---|
| RV-511 | The manager profile has all hostess powers. | `M:reservations/commands.mjs:12` | RV-459 |
| RV-512 | There is no way to change or reset a staff password; a stopped profile is simply started again with the old one. | `M:api.mjs:69-72` | RV-412 |
| RV-513 | Eight wrong tries in a minute block that profile id's sign-in for everyone, so anyone can lock out a hostess by typing her id. | `M:api.mjs:32` | none |
| RV-514 | The home screen and the sign-in dialog print the test password in clear text. | `P:app.mjs:21,28` | `README.md` (demo profiles) |
| RV-515 | New profiles can only be hostess or DJ. | `M:api.mjs:70` | RV-425 |
| RV-516 | Profile creation, stopping and activating write history entries that no screen can show. | `M:api.mjs:71`; `M:domain.mjs:47` | none |
| RV-517 | A sign-in lasts 12 hours, so "remembered on the work phone" ends after a night. | `M:api.mjs:33` | RV-411 |

---

# Shared with song requests

One line per piece the two products share, and the rows above that rest on it. The song-request inventory must reuse or replace the same piece.

| Id | Shared piece | Where | Rows that depend on it |
|---|---|---|---|
| RV-518 | Staff sign-in, profiles, roles, 12-hour sessions, stop / activate, the four seeded profiles; DJ and hostess use the same login | `M:api.mjs:8,11,31-35,69-72` | RV-291, RV-292, RV-293, RV-294, RV-288, RV-296, RV-71, RV-72, RV-73, RV-27, RV-28, RV-280, RV-281, RV-282, RV-411, RV-412, RV-425, RV-439, RV-442, RV-443, RV-455 |
| RV-519 | One command door `POST /command`, one dispatcher, repeat keys and replay, role checks, and the page's "unconfirmed action" handling | `M:domain.mjs:6-41`; `M:api.mjs:73-75`; `P:app.mjs:19-20,37`; `P:api-client.mjs` | RV-298, RV-299, RV-302, RV-303, RV-305, RV-102, RV-103, RV-148, RV-149, RV-444 |
| RV-520 | One stored JSON state with a version check on every write, two backends (SQLite file locally, D1 hosted), the 1,800,000-character cap, ETag snapshots | `M:store.mjs`; `M:api.mjs:54-56`; `drizzle/0005_thankful_apocalypse.sql` | RV-300, RV-301, RV-308, RV-309, RV-304, RV-164, RV-246, RV-247, RV-456 |
| RV-521 | One snapshot for everybody (3 s poll, filtered by role), the connection line, the offline behaviour | `M:domain.mjs:44-47`; `P:app.mjs:17-18` | RV-289, RV-304, RV-266, RV-151 |
| RV-522 | `dayAt`: the 06:30 Sofia service day | `M:core.mjs:7` | RV-311, RV-345, RV-313, RV-434, RV-458 |
| RV-523 | One append-only history list and one writer; DJ actions write into the same list and the hostess snapshot filters them out | `M:core.mjs:18`; `M:domain.mjs:47` | RV-343, RV-344, RV-168, RV-308 |
| RV-524 | The panel page, dialog sheet with Back stack, toast, nav, sign-in prompt | `PP:index.html`; `P:app.mjs`; `P:sheet-history.mjs` | RV-1, RV-306, RV-307, RV-63, RV-466 |
| RV-525 | Text clean-up and whole-number checks | `M:core.mjs:5-6` | RV-322, RV-320, RV-85 |
| RV-526 | Same-origin and size checks, per-minute limits (the command limit counts reservation and song commands together) | `M:api.mjs:14-16,28,74` | RV-295, RV-296 |
| RV-527 | Anonymous guest cookie, guest links, e-mail codes and recovery. Reservations never use them, but the page calls `/session` at start, which gives even staff a guest cookie | `M:api.mjs:30,36-68`; `P:app.mjs:40` | RV-32, RV-441 |
| RV-528 | One sample-data batch adds 20 songs and 15 bookings together and is triggered by one flag | `M:fixtures.mjs`; `M:api.mjs:49-56` | RV-381, RV-260, RV-77 |
| RV-529 | Wrapper, runner, environment flags, the 2-second background pass | `S:demo-server.mjs`; `app/api/demo/[...path]/route.ts`; `M:api.mjs:20-25` | RV-256, RV-257, RV-258, RV-259, RV-264, RV-268, RV-297 |
| RV-530 | About 15 server messages are song-only and left out of the message list: "Приемът на заявки е спрян.", "Потвърди сумата и тестовите условия преди задържане.", "Въведи приемливо лично име или избери псевдоним.", "Избери песен от търсенето.", "Песента вече е заявена…", "Подкрепите са затворени…", "Подготовката вече е започнала.", "Няма собствен задържан принос.", "Редакцията на поздрава е затворена.", "Освободеният поздрав…", "Няма потвърдено събрана сума…", "Посочи причина.", "Опиши проблема.", "Нямаш достъп.", "Заявката липсва.", plus the e-mail and link messages | `M:domain.mjs:12-32`; `M:api.mjs:40-67` | none for reservations |
| RV-531 | `tests/demo-v2.test.mjs` mixes both products; `tests/parallel-reservations.mjs` is, despite its name, a stress script for the song payment route `/api/dj/payments` (legacy), not for reservations | `T:demo-v2.test.mjs`; `T:parallel-reservations.mjs:16,47` | the golden-master tests for the close and undo rows come from `T:demo-v2.test.mjs:80,88` |

## Missing files and what they leave unsettled

The records link to 15 files that are not in the snapshot (the brief said eleven; I counted every distinct link target in `docs/**/*.md` and `docs/decisions/*.txt` and checked each against the folder). Found by: for every Markdown link `](…)` in those files, test whether the target exists.

| # | Missing file | Linked from | Rows I could not settle because of it |
|---|---|---|---|
| 1 | `RESTRO-DEMO-IMPLEMENTED-2026-10-18.md` | `INT:5`, DJ interview | status and limits of the demo as of 18 Oct: RV-415 is read from the line alone |
| 2 | `RESTRO-LEGAL-PRIORITY.md` | `INT:96,100`, `QBR` | RV-421, RV-422 text of the owner's legal requirement |
| 3 | `research/2026-10-18-reservations-bulgaria-legal.md` | `INT:92`, DJ interview | RV-420, RV-423, RV-450 reasoning |
| 4 | `research/2026-10-18-restro-bulgaria-legal-boundaries.md` | `INT:92`, DJ interview | same |
| 5 | `RESTRO-RESERVATIONS-OWNER-DECISIONS-2026-10-18.md` | `QBR:196` | the original numbered reservation decisions up to R25; `INT` is read as its copy |
| 6 | `RESTRO-QUESTIONNAIRE-ANSWERS-BG.md` | `QBR:171,193` | the original Q1–Q47 log; `QST` is read as its copy |
| 7 | `RESTRO-OPEN-QUESTIONS-BY-RECIPIENT-BG.md` | `QST:5` | the original of `QBR` |
| 8 | `RESTRO-ACCEPTANCE-SCENARIOS-BG.md` | `QBR:195` | acceptance details that R14, R16 and R20 say are defined "later" (which closed records warn, scope of blocks, handling of occupied places); I used R19, R20, R27 and Q18 instead |
| 9 | `RESTRO-IMPLEMENTATION-PLAN-BG.md` | `QBR:195` | the planned order of work; no row depends on it |
| 10 | `RESTRO-OWNER-DECISIONS-2026-10-18.md` | `QBR:196` | DJ decisions; song side |
| 11 | `RESTRO-LEGAL-REVIEW-PACK-BG.md` | `QBR:197` | RV-420 scope |
| 12 | `RESTRO-LEGAL-EVIDENCE-CHECKLIST-BG.md` | `QBR:197` | RV-420 scope |
| 13 | `research/2026-10-18-mypos-late-payments.md` | `QBR:198`, DJ interview | song / payments |
| 14 | `research/2026-10-18-mistral-integration-confirmation.md` | `QBR:198` | Mistral; no reservation row |
| 15 | `MISTRAL-QUESTIONS-BG.md` | `QBR:93` | M-questions; song / sales |

Rows that rest on the owner's own wording and that a missing file could change: RV-420, RV-421, RV-422, RV-423, RV-450, RV-451, RV-452, RV-453, RV-454. All carry the mark "open in their records" and no code is attached to them.

---

# Coverage and gaps

What is complete: screens, routes, buttons, server commands, messages (reservation-reachable server messages and the fixed page texts), data records, settings, timers, roles, the place catalogue (ids, labels, bar seat counts, aliases, kinds, colours), every R number, every Q, Z, A, F, T item that touches the listed topics.

What is **half covered** or not covered, plainly:

- **Not run.** Nothing was executed or looked at on screen. Whether a control works as the code reads (for example RV-469) is for the demo walk.
- **Geometry values.** Positions of the 118 anchors, the wall runs, the 24 sofas and 28 columns are data in `PR:layout.mjs`, `PR:orthogonal-plan.mjs`, `PR:plan-trace.mjs`, `PR:structure.mjs`; I listed what exists and how it is derived, not each coordinate. The Port should read them from the files.
- **Styles.** `public/demo/style.css` (417 lines, many very long) was read only for the status colours, the legend and motion rules; layout, spacing and look are not inventoried because looks do not carry over.
- **Legacy.** `modules/reservations/`, `public/reservations/app.mjs`, `index.html`, `style.css`, `map-lightbox.css`, `public/client`, `public/dj`, `public/panel/app.js`, `public/shared/*` and `lib/dj-*` were not inventoried; I looked at the legacy server's README and its tests only where they state a rule the active code shares. The legacy server had undo of single actions (`T:tables.test.mjs:38-56,67`); the active code does not, which is a behaviour the old page had and the new one lacks.
- **Song side.** `modules/demo/dj/`, `music-search.mjs`, `public/demo/client`, `public/demo/dj`, `modules/payments/stripe.mjs`, `lib/dj-youtube.mjs`, the song tests and the DJ interview beyond line 24 are not read.
- **MVP files not followed as instructions:** `CLAUDE.md`, `INTEGRATION.md`; `STRIPE.md` and `YOUTUBE-SETUP.md` only glanced at (song side).
- **Stories** are not in this file (a second agent is walking the demo).
- **Counts and wording of the messages** in section 3 were taken from the code; the songs-only ones are summarised in RV-530.
- **No verdicts.**

## Row counts

| Part | Section | Rows |
|---|---|---|
| Things | 1. Screens and routes | 35 |
| Things | 2. Buttons and actions | 42 |
| Things | 3a. Server messages that a hostess or admin can meet | 53 |
| Things | 3b. Page messages: hints, confirmations, toasts, banners, empty states | 33 |
| Things | 4a. Records | 11 |
| Things | 4b. Booking fields | 18 |
| Things | 4c. Block, contact, audit, close record, staff | 8 |
| Things | 4d. Place catalogue fields (static) | 6 |
| Things | 4e. Status values | 19 |
| Things | 5. Commands on the server | 20 |
| Things | 6. Outside services | 10 |
| Things | 7. Settings and flags | 10 |
| Things | 8. Timers and scheduled work | 14 |
| Things | 9. Roles and permissions | 8 |
| Rules and defaults | A. Access, sign-in, identity | 10 |
| Rules and defaults | B. Commands, retries, storage, the page's behaviour on failure | 13 |
| Rules and defaults | C. Dates and the service day | 9 |
| Rules and defaults | D. Creating and changing a booking | 25 |
| Rules and defaults | E. Blocks | 4 |
| Rules and defaults | F. Ending the evening | 4 |
| Rules and defaults | G. Personal regular clients | 9 |
| Rules and defaults | H. Places, map and navigation | 19 |
| Rules and defaults | I. Demo data and seeded values | 3 |
| Their decisions | 1. The reservations interview, R1 to R27 | 31 |
| Their decisions | 2. The unnumbered additions in the interview | 10 |
| Their decisions | 3. The questionnaire (Q-numbers are the conversation order, not the R numbers) | 20 |
| Their decisions | 4. The questions-by-recipient list and the MVP's own later open list | 20 |
| Built but never decided | A. Map and Back (named by the lead) | 13 |
| Built but never decided | B. Actions (copy, swap, soft delete named by the lead) | 16 |
| Built but never decided | C. Personal regular clients (named by the lead) | 3 |
| Built but never decided | D. Limits, defaults and rules nobody wrote down (named by the lead) | 14 |
| Built but never decided | E. Staff accounts and sign-in (R25 left the details open) | 7 |
| Shared with song requests | Shared with song requests | 14 |
| | **Total ids used** | **531** (RV-1 to RV-531) |
