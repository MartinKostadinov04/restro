# Reservations port: user stories from the running demo

Date: 2026-10-30. Product: the Club Biad MVP, reservations only (song requests and the DJ page are out of scope). Stage 2 "Stories" of `.claude/skills/restro-flow/port.md`. Code inventory is a separate file (`2026-10-30-reservations-port-inventory.md`); this file does not repeat it.

## How the walk was done

- Demo: the made-up copy at `http://127.0.0.1:5181/panel/index.html`, in the built-in browser at the mobile preset (375 x 812), reset to desktop afterwards. Profiles used: `host1` (shown as "Елена · hostess"), `host2` ("Мария · hostess"), `admin` ("Управител · admin"). All data below is made up and lives only in that copy.
- Sign-in, the first reservation, Back, the filter tabs and the system Back button were done with real taps and typing. Most other taps were sent as click events to the same buttons (same handlers; only the pointer was missing), so the tap counts are by button, not by pixel. Zoom and move on the plan were done with the mouse wheel and a mouse drag; a real two-finger pinch was not possible.
- Two hostesses at once: the server accepts only `127.0.0.1`, and both tabs share one sign-in cookie, so "two hostesses" was done with two tabs where the second tab changed the data in between. The side effect is noted in RS-60.
- The network was dropped by stopping and restarting the demo server (RS-63).

## Counting rules

- Starting screen: the signed-in reservations list for tonight (called "the list"), unless the path says otherwise. The list is the page reached by «Маси» in the bottom bar.
- **Taps** = presses of buttons, tabs, map places and links. Typed or chosen values are counted apart as "fields". Native dropdown choices count as fields.
- Every step of "Back" is one tap: both the «Назад» button (top left) and the round close button (aria label "Затвори", top right) do the same thing, one step back.
- Bulgarian labels are quoted exactly; English in brackets is mine.
- Words used: "detail" = the screen "ДАННИ ЗА РЕЗЕРВАЦИЯТА" (reservation data) with the buttons below it; it lives inside the full-screen map dialog, under the map. "Form" = the booking form (Име, Телефон, ...).

## Stories

### Access

| Id | Story | Path (button labels) | Taps | What the screen showed at the end |
|---|---|---|---|---|
| RS-1 | As a hostess I want to sign in on my phone, so that I can work the night's reservations. | Home (signed out) → «Вход / смяна» → type Профил, type Парола → «Влез» → «Маси» | 3 + 2 fields | List "Място за всеки." Header shows "Елена · hostess" and "Свързано · hh:mm:ss ч.". The dialog closes by itself after «Влез»; the page stays on Home until «Маси» is tapped. |
| RS-2 | As a hostess I want to know when I mistyped, so that I can retry. | «Вход / смяна» → Профил, Парола (wrong) → «Влез» | 2 + 2 fields | Dialog stays open, red text "Невалиден профил или парола." Fields keep their values. The previous sign-in is not lost. |
| RS-3 | As a hostess I want to sign out, so that the phone is safe to hand over. | «Панел» → «Изход от персонал» | 2 | Header "Гост · guest". Opening «Маси» now shows "Индивидуален вход / Влез с индивидуален профил на хостеса или управител." and one button «Влез като персонал». |
| RS-4 | As a second hostess I want to switch the profile on a shared phone, so that my name is on what I do. | Any page → «Вход / смяна» → Профил, Парола → «Влез» | 2 + 2 fields | Header changes to "Мария · hostess"; same page and same date stay. The "Направена от" line on new reservations carries the new name. |
| RS-5 | As the manager I want to see and manage staff profiles, so that I control who can sign in. | Signed in as admin → «Панел» → «Профили на персонала» | 2 | List "Персонал": Управител · admin, Елена · hostess, Мария · hostess, DJ · dj, each "Активен", with «Спри достъпа» (stop access) on all but admin; «Нов профил» opens a form: "ID · латиница/цифри", "Име", "Роля" (Хостеса / DJ), "Парола · поне 12 знака", «Създай». Not submitted (it would create an account). The «Маси» screen is identical to the hostess's. |

### Seeing the night

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-6 | As a hostess I want to see tonight's reservations at a glance, so that I know who is coming. | Open «Маси» | 1 (0 right after sign-in on the Маси page) | Top: "Дата на резервациите" with the long date and «Промени»; buttons «Нова резервация», «Настани без резервация», «Добави редовен клиент»; card "Приключване на вечерта"; four tabs with counts «Активни», «Пристигнали», «Чакащи», «Всички»; then one card per reservation: place chips, name, phone, "Направена от <hostess>", "2 / 4 гости" (arrived / booked), "23:00 пристигане", a status chip. Under the list: «История на вечерта», «Промени днес», "За схемата / Блокирани места", «Отвори картата». The card does not show the note or the deposit. |
| RS-7 | As a hostess I want to see only the reservations in one state, so that I find the next one fast. | Tab «Активни» / «Пристигнали» / «Чакащи» / «Всички» | 1 to filter, +1 to see the list | The full-screen map dialog opens at once (title "Карта · 2026-10-30") with the same filter and a compact list ("Иван Тестов / 6 · 4 гости"). One more tap on the close button shows the list page filtered. Meaning: «Активни» = reserved + seated (no waiting, finished, no-show, deleted); «Пристигнали» = seated; «Чакащи» = waiting list; «Всички» = everything incl. deleted. |
| RS-8 | As a hostess I want to look at another evening, so that I can prepare tomorrow or check yesterday. | «Промени» (button "Избери дата") → pick Ден, Месец, Година → «Покажи» | 2 + 3 fields | Dialog "Календар" is three dropdowns (Ден 1-31, Месец януари-декември, Година 1976-2076) plus "Или въведи точна година". No grid, no "today", no next/previous day. List shows the chosen date; the chosen date stays selected until changed again (it is not reset to today). |
| RS-9 | As a hostess I want a clear refusal for a date that does not exist. | «Промени» → Ден 31, Месец февруари → «Покажи» | 2 + 2 fields | Dialog stays; message "Невалидна дата." |
| RS-10 | As a manager I want to jump far ahead, so that I can take a booking for next year. | «Промени» → "Или въведи точна година" (2030 and 2095 tried) → «Покажи» | 2 + 3 fields | Date shows e.g. "15 март 2095 г."; any year works, the dropdown stops at 2076. |
| RS-11 | As a hostess I want to open a reservation, so that I can see and act on it. | Tap the card | 1 | Map dialog with the detail: status chip (Резервирана / Настанени / Чакащи / Приключила / Неявили се / Изтрит запис), place chips, "Гости 0 / 4", "Пристигане 23:00", "Телефон" (a call link), "Направена от Елена", note and "Капаро: 50.00 € · Получено" when set. Buttons depend on status: reserved or seated: «Пристигнали», «Премести», «Добави места», «Размени», «Редактирай данните», «Изтрий запис»; waiting: «Избери места», «Редактирай данните», «Изтрий запис»; finished, no-show, deleted: only «Редактирай данните». Plus "ЛИЧЕН СПИСЪК / Добави редовен клиент". |
| RS-12 | As a hostess I want to call the guest, so that I can confirm. | Card → phone link | 2 | Link goes to `tel:` with digits only. A walk-in without phone shows "Не е добавен". |
| RS-13 | As a manager I want to see what changed, so that I can settle a dispute. | «История на вечерта» (by reservation date) or «Промени днес» (all actions done today, any date); per reservation: card → «Редактирай данните» → «История» | 1, 1, or 3 | A long unpaged list. Each entry is "Елена · booking.move" (raw action code), "Реално действие: 30.10.26 г., 11:42 · резервационна дата 2026-10-30", the typed reason if any, and a closed "Преди / след" that opens raw JSON. No guest name on the entry, no filter. Back returns to the form it came from. |

### The floor plan

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-14 | As a hostess I want to see the floor plan with free and taken places. | «Отвори картата» | 1 | Dialog "Карта · <date>": plan on top (about 40% of the phone height), below it "Избери място от картата / Тук ще видиш данните и действията за него.", the four filter tabs, "Резервации · N" (list; excludes waiting), «Нова резервация», «Настани без резервация», «Добави редовен клиент». The plan opens at the zoom and position left from last time (names switched on, top-left corner), so the first view can be a quarter of the room. |
| RS-15 | As a hostess I want to zoom and move the plan. | Mouse wheel / two-finger pinch to zoom (0.6x to 4x), drag with one finger to move | 0 taps | There are no zoom buttons and no "fit to screen". Dragging does not select a place. The text under the plan says "Мести картата с пръст · данните имат отделен скрол". |
| RS-16 | As a hostess I want names and a colour key on the plan. | «Имена» (toggle "Изкл./Вкл."); «Легенда» | 1 each | With names on, a line says "Имена: 1 надпис. Увеличи за още." or "Имената са включени. Увеличи картата, за да се поберат." (names show only when zoomed in). The choice is kept after reload and server restart. Legend dialog: symbols Сепаре 1-16, Маса до диван, Малка маса, Правоъгълна маса, Бар стол, Диван, Колона; colours Свободно (green), Резервирано (orange), Настанени (red), Блокирано (grey). Back returns. |
| RS-17 | As a hostess I want to check one place. | «Отвори картата» → tap the place | 2 | Free: "10 / Свободно / ДЕЙСТВИЯ ЗА МЯСТОТО": «Нова резервация тук», «Настани тук», «Предложи на чакащи», «Блокирай», «История». Taken: that reservation's detail. Blocked: dialog "10 · блокирано / <reason> / Отблокирай" (no who or when). A place that is free tonight but booked on another date looks "Свободно" with no hint of the other date. |
| RS-18 | As a manager I want the history of one place. | «Отвори картата» → free place → «История» | 3 | "История на 6 / 30 октомври 2026 г. / Иван Тестов / Приключила · 23:00 / Преглед / Действия за мястото": readable by guest and status, unlike RS-13. |

### Booking and seating

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-19 | As a hostess I want to book a table for a guest who called, so that it is held. | «Нова резервация» → tap place → «Продължи» → type Име, Телефон (Очаквани гости default 2, Очаквано пристигане default 23:00) → «Запази» | 4 + 2 fields (+1 for guests) | Toast "Записано · тестови данни" (same text for every action). The user stays in the map dialog on the new reservation's detail, status "Резервирана", "Гости 0 / 4". One more tap on the close button reaches the list. Step 1 screen: title "Нова резервация", "Избери местата на картата. За чакащи можеш да продължиш без място.", "Натисни местата на картата" then "Избрани: 5". Form also has: «Запази / обнови в моите редовни» (tick), «Моите редовни», Бележка (500), "Капаро · по желание", two deposit dropdowns, "Причина за промяната · по желание", "Създай отделна резервация при същия телефон", and the line "Капацитетът предстои да бъде проверен; не се гарантира достатъчно място по снимката." |
| RS-20 | As a hostess I want to book without choosing a place, so that the party waits on the waiting list. | «Нова резервация» → «Продължи» (nothing selected) → Име, Телефон → «Запази» | 3 + 2 fields | Form headed "Чакащи без място". Detail: status "Чакащи", "Без място". The card shows "Без място" and "Чакат N мин". Actions: «Избери места», «Редактирай данните», «Изтрий запис» (no «Пристигнали»). |
| RS-21 | As a hostess I want to book from the map, so that I do not have to choose the place twice. | «Отвори картата» → free place → «Нова резервация тук» → Име, Телефон → «Запази» | 4 + 2 fields | Same result as RS-19. Form opens straight (the place is already chosen). «Настани тук» does the same for a walk-in. |
| RS-22 | As a hostess I want a warning when the same phone already has a booking, so that I do not double-book. | RS-19 path → «Запази» (refused) → tick "Създай отделна резервация при същия телефон" → «Запази» | 6 + 2 fields | First save keeps the form open and shows "Има активна резервация със същия телефон. Отвори я или потвърди отделна." Phone typed without spaces matched the one with spaces. The text offers "Отвори я" but there is no link or name of the other reservation. After the tick the booking saves and the detail opens. |
| RS-23 | As a hostess I want to seat people who walked in without a booking. | «Настани без резервация» → tap free place → «Продължи» → Име (Телефон is "по желание") → «Запази» | 4 + 1 field | Detail: status "Настанени", "Гости 3 / 3" (all counted as arrived), "Пристигане 23:00" shown even though they came now, "Телефон Не е добавен". Продължи with no place gives toast "Избери поне едно място." although the same sentence on screen says waiting parties may continue without a place. Tapping a taken place is ignored with no message. The form still shows "Очаквано пристигане". |
| RS-24 | As a hostess I want to hold bar stools for a small group. | «Нова резервация» → three stool taps → «Продължи» → Име, Телефон, Очаквани гости → «Запази» | 6 + 3 fields | "Избрани: Бар 1 · стол 13, Бар 1 · стол 12, Бар 2 · стол 14". Stools from two different bars were accepted with no warning. Detail and card list one line per stool. The stool numbers on the plan count from the other end of the bar than the internal order (internal seat 1 is "стол 13"). |
| RS-25 | As a hostess I want to book the merged 40/41 table. | «Нова резервация» → tap "40/41" → «Продължи» → Име, Телефон, Очаквани гости → «Запази» | 4 + 3 fields | One place labelled "40/41"; there is no separate 41 on the plan. Booking shows "40/41". |
| RS-26 | As a hostess I want to note a deposit, so that the manager can see it was taken. | In the form: "Капаро · по желание" (0 to 100000), dropdown (Няма / Отбелязано получено / За връщане / Върнато / Задържано), method (В брой / Карта / Банков превод / Друго) | +0 taps, 3 fields | Detail shows "Капаро: 50.00 € · Получено". No payment happens (every payment in the demo is simulated). The amount is not on the list card. |
| RS-27 | As a hostess I want Back to keep what I typed, so that a wrong table choice costs nothing. | In the form, type Име, Телефон, Очаквани гости, Бележка, Капаро → «Назад» (lower one, or the top-left one) → «Продължи» | 2 | Plan step returns with the old choice ("Избрани: 13"); after «Продължи» all five fields are as typed. |
| RS-28 | As a hostess I want to leave a form without saving. | Form → close button twice | 2 | First tap returns to the plan step; second leaves the dialog. The typed data is thrown away with no "discard?" question; reopening gives an empty form. |
| RS-29 | As a hostess I want a bad phone refused. | Form with phone "abc", "12" or "123456" → «Запази» | 1 | Refused with "Попълни име и телефон за предварителна резервация." (the same sentence as for a missing phone). Seven digits ("1234567") saved. No format check beyond that. An empty phone shows the browser's own English bubble "Please fill out this field." (not the app's). |

### The waiting list

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-30 | As a hostess I want to give a waiting party places, so that they can sit. | Card → «Избери места» → tap two places → «Продължи» → «Потвърди» | 6 | Screen is titled "Преместване" with "Мигащите места са текущите. Натисни свободните места за преместване."; confirm "Потвърждение / Нов комплект: 8, 4. Капацитетите не са потвърдени." Result: status "Резервирана" with both places; the party is no longer on «Чакащи». |
| RS-31 | As a hostess I want to offer a freed place to the party that has waited longest. | «Отвори картата» → free place → «Предложи на чакащи» → «Избери компания» → «Потвърди» | 5 | "Чакащи · място 12 / По ред на добавяне. Капацитетът е непотвърден; прецени компанията преди избор." then rows "Чакащи Двама · 2 гости / Чакат 0 мин"; confirm "Място 12 за Чакащи Двама, 2 гости? Капацитетът не е потвърден." Result: status "Резервирана" at place 12. |

### Arrival

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-32 | As a hostess I want to mark that the guests arrived. | Card → «Пристигнали» → set number → «Запази» | 3 + 1 field | Dialog "Пристигнали гости / Пристигнали от 4 / Местата остават за цялата компания. Капацитетите са непотвърдени." The number starts at 1 for a first arrival (the party size must be typed), and at the current count afterwards. Result: status "Настанени", "Гости 4 / 4"; the place turns red on the plan. The button keeps the label «Пристигнали» (the same word as the tab). |
| RS-33 | As a hostess I want to record that only part of the party came, then the rest. | Same as RS-32 with 2, later again with 4 | 3 + 1 field each | After the first: status "Настанени", "Гости 2 / 4". The whole set of places stays held. The number can be lowered again (3 to 1 accepted), never to 0. |
| RS-34 | As a hostess I want a warning when more people arrive than booked. | RS-32 with a number above the booking (9 on a booking of 6) | 3 + 1 field | No warning. The booking is rewritten to "Гости 9 / 9". |
| RS-35 | As a hostess I want to mark arrival of a booking for another date. | Another date → card → «Пристигнали» → «Запази» | 4 + 2 fields | Accepted for tomorrow's booking (status "Настанени") with no question. |

### Changing places

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-36 | As a hostess I want to add a table to a party. | Card → «Добави места» → tap place → «Продължи» → «Потвърди» | 5 | Screen "Добавяне на места / Натисни място, за да го включиш или изключиш. Запиши с „Продължи“." with the old places pre-chosen; confirm "Нов комплект: 5, 3." Detail shows both. |
| RS-37 | As a hostess I want to take a table away. | Same screen: tap an old place to switch it off | 5 | Works ("Нов комплект: 8"). The screen name is still "Добавяне". A party cannot go back to the waiting list: switching off the last place gives "Избери поне едно място." |
| RS-38 | As a hostess I want to move a party. | Card → «Премести» → tap new place → «Продължи» → «Потвърди» | 5 | "Преместване / Мигащите места са текущите. Натисни свободните места за преместване." Confirm "Нов комплект: 9." The new set replaces all old places. |
| RS-39 | As a hostess I want to swap two parties. | Card → «Размени» → tap the other party's place → «Продължи» → «Потвърди» | 5 | "Размяна / Мигащите места са текущите. Натисни друга компания за размяна." Confirm "Размяна: Иван Тестов (9) ↔ Петя Дубликат (6)." Both cards change places. A tap on a free place is ignored without a message, and «Продължи» then says "Избери поне едно място." |

### Editing, copying, ending

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-40 | As a hostess I want to change a booking's name, phone, party size, time, note or deposit. | Card → «Редактирай данните» → change fields → «Запази» | 3 + fields | The edit screen is headed "Данни за резервацията" and starts with four buttons: «История», «Копирай в друга вечер», «Изтрий запис», plus one of «Неявили се» (reserved) or «Освободи местата» (seated). The same form follows, with "Причина за промяната · по желание". Back to the detail with the new data. Places are not editable here. Changing a phone to one that another reservation already uses saved without the warning of RS-22. |
| RS-41 | As a hostess I want to copy a booking to another evening. | Card → «Редактирай данните» → «Копирай в друга вечер» → pick date → «Копирай» | 4 + 1 field | Dialog "Копирай <name> / Нова вечер / Без капаро и пристигнали гости; проверява се свободният комплект." The date starts as the same date; copying to it is refused with "Мястото вече е заето за тази вечер." After a good copy the toast is the usual "Записано · тестови данни" and the screen goes back to the original booking, not the copy. A deleted booking can be copied to its own date, which is the only way found to bring it back. |
| RS-42 | As a hostess I want to mark a party that never came. | Card → «Редактирай данните» → «Неявили се» → reason → «Потвърди» | 4 | Confirm dialog is headed with the guest name only ("Чакащи Двама / Записът ще остане в историята. / Причина · по желание"). Status "Неявили се"; the place is free on the plan. Only offered for status "Резервирана". |
| RS-43 | As a hostess I want to free the tables when a party leaves. | Card → «Редактирай данните» → «Освободи местата» → «Потвърди» | 4 | Dialog headed with the guest name only, same text as RS-42. Status "Приключила"; place free. Only offered for status "Настанени". |
| RS-44 | As a hostess I want to cancel a booking. | Card → «Изтрий запис» → «Да, изтрий записа» | 3 | Dialog "Изтрий запис? / Минала Резервация · 5 / Резервацията ще се махне от активните и местата ще се освободят. Историята се запазва." There is no separate "cancel" button; delete is the cancel. After it the detail shows "Изтрит запис" with «Редактирай данните» only; the deleted booking can still be edited and saved. If a deposit exists the dialog adds a dropdown "Капаро" (За връщане [default], Върнато, Задържано) without showing the amount; the choice is shown as "Капаро: 50.00 € · Задържано". |

### Blocking places

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-45 | As a manager I want to take a broken place out of use. | «Отвори картата» → free place → «Блокирай» → reason → «Блокирай» | 4 + 1 field | Dialog "Блокиране на 10 / Причина · задължителна / Първо трябва да се разрешат засегнатите настоящи/бъдещи резервации. Блокът важи до ръчно отблокиране." Empty reason gives the toast "Избери място и причина." After saving the user lands on the list, in "За схемата / Блокирани места": "10 / Счупен стол / Отблокирай". A place with a reservation tonight offers no «Блокирай» at all. |
| RS-46 | As a manager I want a clear refusal when someone is booked there. | Free-tonight place with a booking on another date → «Блокирай» → reason → «Блокирай» | 4 + 1 field | Refused: "Първо премести или откажи всички настоящи/бъдещи резервации за мястото." It does not say which reservation or which date, and "откажи" has no button (only delete). |
| RS-47 | As a manager I want to put the place back. | List: «Отблокирай» → «Потвърди»; or map: place → «Отблокирай» → «Потвърди» | 2 or 4 | Confirm "Отблокиране на 10?" (reason not repeated). Returns to the list. |

### Closing the evening

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-48 | As a hostess at the end of the night I want to close the evening in one go. | «Приключи вечерта» → «Да, приключи вечерта» | 2 | Dialog "Да приключим вечерта? / 2 ноември 2026 г. / Активните резервации за тази дата ще бъдат приключени: / 0 настанени → приключили / 1 резервирани → неявили се / 0 чакащи → затворени / Капарото не се връща автоматично. Историята на резервациите се запазва." and buttons «Не, продължи вечерта» / «Да, приключи вечерта». After: statuses changed, a new button «Отмени приключването» beside «Приключи вечерта» (which still works on a closed night with all-zero counts). |
| RS-49 | As a hostess I want to undo a closing done by mistake. | «Отмени приключването» → «Потвърди» | 2 | Dialog "Възстановяване на цялото приключване, ако няма последващи промени?" Result: the earlier statuses are back. If any reservation was edited after the closing: toast "Има последващи промени." (not which); the dialog stays and the button stays. |

### My regular clients (personal list per staff member)

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-50 | As a hostess I want to keep my own list of regulars, so that I can book them in fewer keystrokes. | «Добави редовен клиент» → Име, Телефон, "Лична бележка · само за твоя профил" → «Запази клиента» | 2 + 3 fields | Dialog "Нов редовен клиент" (note: "Личната бележка не се копира в резервацията."). Saved; the list page is back. |
| RS-51 | As a hostess I want regulars suggested when I type a name. | In the form type 3 letters of the name → tap the suggestion | 1 + typing | A suggestion "Стоян Редовен 0899 100 200" appears under the name; tapping fills name and phone and shows "От моите редовни · Обича маса до сцената" (the personal note, display only). |
| RS-52 | As a hostess I want to save a booking's guest as a regular. | Card → «Добави редовен клиент» (name and phone prefilled) → «Запази клиента»; or tick «Запази / обнови в моите редовни» in the form | 3, or +1 | Returns to the detail. |
| RS-53 | As a hostess I want to pick a regular from my list. | In the form «Моите редовни» | 1 | Dead end: the list "Моите редовни клиенти / Личен списък · Елена. Вижда се само от твоя профил." has search "Търси име или телефон", «Редакция» and «Архивирай» per row and «Архивирани», but no way to pick a row into the form. Picking only works by typing (RS-51). |
| RS-54 | As a hostess I want to edit, archive and bring back a regular. | «Добави редовен клиент» → «Моят списък» → «Редакция» → fields → «Запази клиента»; or «Архивирай» (no question) ; then «Архивирани» → «Възстанови» | 3, 3, 5 | Archive moves the row into the closed "Архивирани" section; restore returns it. |
| RS-55 | As a hostess I want a warning for a regular that already exists. | «Добави редовен клиент» → same phone → «Запази клиента» | 2 + 2 fields | "В личния ти списък вече има клиент с този телефон. Избери него." There is no way to pick (see RS-53). |
| RS-56 | As a second hostess I expect my regulars to be mine. | Sign in as host2 → «Добави редовен клиент» → «Моят списък» | 3 | "Личен списък · Мария. ..." and "Няма клиенти в този списък." Elena's regulars are not visible. Admin has a third, separate list. |

### Two hostesses

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-57 | As a hostess I want to see the other hostess's bookings, so that we do not clash. | Other hostess saves a booking; wait; look at the list | 0 | New card appears in a few seconds with no reload ("Направена от Мария"). The header's "Свързано · hh:mm:ss ч." clock ticks. Blocks and regulars: blocks are shared, regulars are not. |
| RS-58 | As a hostess I want to be told when someone changed the reservation I am editing. | Both open «Редактирай данните»; one saves; the other «Запази» | 1 | The second form is not refreshed or marked while open. «Запази» gives "Има промяна от друга хостеса. Обнови." There is no refresh button; typed values stay; every further «Запази» gives the same sentence. Only leaving and reopening shows the new data (typed data lost). |
| RS-59 | As a hostess I want a clear message when the other hostess took my place first. | Both fill the form for the same free table; the second saves | 1 | "Мястото вече е заето за тази вечер." Form stays. Stepping back shows the place as taken but still counted in "Избрани: 19". |
| RS-60 | (Side effect found) As a hostess I do not expect another sign-in to change my name. | Another tab on the same phone signs in as another profile | 0 | Within seconds the header of the first tab flips to the other name ("Елена" to "Мария") and its next save is made as the other person, with no message. Harness artefact of one cookie per browser, but it is how a shared phone behaves. |

### When things break

| Id | Story | Path | Taps | End screen |
|---|---|---|---|---|
| RS-61 | As a hostess I want to know when the connection is gone, and not lose my form. | Server stopped; form open; «Запази»; server back; «Запази» | 2 | Header text turns into "Няма актуална връзка · показан е последният изглед". The save gives "Няма актуална връзка. Действието не е потвърдено." The form stays with the typed data. When the server returned, the header said "Свързано" again by itself and the second «Запази» saved. The sign-in survived the restart. The hidden box "Последното действие още не е потвърдено / Провери последното действие" did not appear in this case. |
| RS-62 | As a hostess I want the phone's Back button to behave. | Form open → system Back | 1 | The whole reservations page is left to Home ("Вечерта. На едно място."), dialogs closed, draft gone. Dialogs do not use browser history, so only the in-app «Назад» steps back one level. |

## Things that felt wrong or surprising

What was seen, not how to redesign it. Numbers refer to the stories.

1. **Filter tabs open the map** (RS-7). Tapping «Чакащи» on the list covers the page with the full-screen map; one more tap on the round close button is needed to see the filtered page.
2. **Two ends of one word.** «Пристигнали» is a tab (seated parties) and a button (record arrival); the status after arrival is "Настанени" (seated); the status after "close evening" or the button «Неявили се» is also "Неявили се". A tired hostess has to know which is which (RS-7, RS-32, RS-42).
3. **Actions hidden one screen deep.** Finish ("Освободи местата"), no-show ("Неявили се"), copy and per-booking history sit under «Редактирай данните», not on the detail (RS-40 to RS-43). Their confirm dialogs are headed only with the guest's name, with the text "Записът ще остане в историята.", so the screen does not say whether you are finishing or marking a no-show.
4. **No cancel.** Only "Изтрий запис". Texts elsewhere speak of "откажи" (RS-46). A deleted booking stays editable, and the only way back is to copy it to its own date (RS-41, RS-44).
5. **Stale forms and unclear conflicts.** An open edit form never learns that someone else changed the booking; the refusal says "Обнови" but there is nothing to tap, and the same refusal repeats (RS-58). After a place clash the dead place is still "Избрани" (RS-59).
6. **A button that leads nowhere.** «Моите редовни» in the form opens a list you cannot pick from. The duplicate-regular message says "Избери него" and there is nothing to choose (RS-53, RS-55). The duplicate-phone message says "Отвори я" with no link and no name (RS-22).
7. **Arrival numbers.** The number starts at 1, so a party of 8 needs a typed 8. Typing more than booked silently rewrites the party size (9 of 6 became 9 / 9). The same dialog says "Капацитетите са непотвърдени" in every places dialog: the app never knows table sizes (RS-32, RS-34).
8. **History is for programmers.** Raw codes such as "booking.arrive", no guest name on an entry, raw JSON in "Преди / след", no filter, no paging (RS-13).
9. **Dates.** Three dropdowns and a field for the year; no today, tomorrow or next-day buttons; a past date accepts new bookings, a future date accepts arrival marks; the map header shows "2026-10-30" while the list shows "30 октомври 2026 г." (RS-8, RS-35).
10. **The list hides the useful.** It is in creation order, not arrival time (a 01:30 booking sat last under 23:00 ones); there is no search by name or phone; the note and the deposit are not on the card (RS-6).
11. **Place state across dates.** A place free tonight but booked tomorrow looks "Свободно"; blocking it is refused with a message that names no booking (RS-17, RS-46). An occupied place has no «Блокирай» (RS-45).
12. **Silent ignores.** Tapping a taken place in walk-in mode, or a free place in swap mode, does nothing and says nothing. «Продължи» then shows "Избери поне едно място." even where the on-screen hint says waiting parties may continue (RS-23, RS-39).
13. **Leaving costs the draft without asking.** Close button twice, or the system Back, throws the typed form away (RS-28, RS-62).
14. **Toast text.** Every success says the same "Записано · тестови данни"; a copy gives no sign where the copy is (RS-41). The "Назад" label appears twice on most screens and means "one step back" for both buttons.
15. **Phone checks.** Under 7 digits is refused with the sentence for a missing phone; the empty field shows the browser's English bubble; phone is stored as typed so the same number can sit in the list in two spellings; editing a phone to a duplicate is not warned (RS-29, RS-40).
16. **Odd plan labels.** Two different places are both labelled "53", both "59" and both "55"; one place is labelled "0"; bar stools count down in the plan label ("Бар 1 · стол 13" for the first seat). A booking on one of the twins shows only the number (RS-24, RS-25).
17. **Camera.** The plan opens on the last zoom and position, which can show only a corner of the room; there is no way to reset it, no zoom buttons (RS-14, RS-15).
18. **A waiting party shown as moving.** "Избери места" opens a screen titled "Преместване"; "Добави места" also removes places; a reserved party cannot be sent back to the waiting list (RS-30, RS-37).
19. **Undo is all-or-nothing.** After closing the evening, one edit makes the undo refuse for good, with "Има последващи промени." and the button stays (RS-49).
20. **Walk-in shows a planned time.** A walk-in has "Пристигане 23:00" (the default planned time) as if it were a time of arrival (RS-23).
21. **Demo only:** the Home page and the sign-in dialog print the profile names and the shared test password. Intended for the demo; noted so it is not ported.

## Reached and not reached

### Reached (walked)

- Screens: Home (signed out and in, and as admin), sign-in dialog, «Маси» (signed out and in), the list with all four tabs, calendar dialog, map dialog in all modes (browse, new booking, walk-in, add, move, swap, assign waiting, single place), legend dialog, names toggle, detail, edit screen, arrival dialog, confirm dialogs (places, delete, no-show, finish, close evening, undo, unblock, copy), booking history, evening history, today's history, place history, regulars (new, list, edit, archive, restore, search field seen), staff list and new-profile form (admin).
- Actions: sign-in, wrong password, sign-out, switch profile; new booking with places, without places, from a map place, with duplicate phone; walk-in (from the list and from a place); bar stools and 40/41; deposit fields and each deposit dropdown state seen; waiting-list assignment (two ways); arrival full, partial, over, lower; add, remove, move, swap places; edit; copy (same date refused, other date, deleted booking); no-show; finish; delete (plain and with deposit); block, refused block, unblock (list and map); close evening and undo (ok and refused); regulars (add, suggest, save from booking, tick in form, archive, restore, edit, duplicate, personal per profile); Back at each step with a half-filled form; browser Back; two sessions on one reservation and on one place; offline and back; zoom by wheel and drag.
- Roles: guest (signed out), host1, host2, admin. Admin's Маси page showed no difference from the hostess's.

### Not reached, with the reason

- **Real two-finger pinch and touch drag:** the pane has a mouse only; wheel zoom and mouse drag were used.
- **Two hostesses at the very same moment with two real devices:** one browser, one cookie; the two-tab method (RS-57 to RS-60) shows the stale-form and place-clash outcomes but not two live identities.
- **Failure in the middle of a save** (request sent, reply lost): needs a network cut at the right instant. The "Последното действие още не е потвърдено / Провери последното действие" box and the saved retry key are therefore not seen.
- **«Спри достъпа» (stop a profile) and «Нов профил» submitted:** stopping a profile would lock out the profiles needed for the walk; the new-profile form takes a password and would create an account. Only the screens were read.
- **Session expiry and the "access must be renewed" message** (the API client has one): no way to expire a session without waiting.
- **Several bookings on one place in the same evening** (the map has a "placeBookings" branch): no sequence of normal taps produced two live bookings on one place.
- **Service day rule (ends 07:00) and "today" at night:** the demo clock was 11:30 to 12:00; the list opened on the calendar date only.
- **Guests page, DJ page, song requests, payments:** out of scope for this file.
- **YouTube search:** no key in the demo (not needed for reservations).
