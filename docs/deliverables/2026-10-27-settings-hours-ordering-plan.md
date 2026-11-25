Made by: the part 1 ordering lead, 10-27, for #61 and #87. For: Martin, then the #87 build.

# Venue settings: Hours and Ordering (screen plan, #87)

Prototype beside it: `2026-10-27-settings-hours-ordering-prototype.html`. It is throwaway: it answers "can an owner set the club's nights and its ordering rules on a phone, quickly, without reading a manual?" Its bar switches desktop or phone, the section, the venue's state, the role, BG or EN, light or dark.

**Scope.** Two sections of the venue's Settings tab, placed by the grouping Martin confirmed (`2026-10-27-owner-settings-grouping.md`): **Hours** («Работно време») and **Ordering** («Поръчки»). Both write `venues.settings.ordering` (`packages/core/src/ordering-settings.ts`, through `core/apply`'s `setOrderingSettings`); every change is a `settings.changed` Log entry (`record` class, kept 18 months). What the Ordering box holds and its defaults are settled by D118 (refined by D121, D122 §4); this plan places them and draws them.

**The persona** (operational-screens.md): the owner, once while setting up and then a few times a season, on a laptop or on a phone at the venue; a manager who reads the hours but may not change them.

## 1. Stories and taps

Counted from the venue open on any tab: reaching a section is 2 taps on desktop (Settings, the section in the side list) and 4 on a phone (the tab menu and the section menu, two each). Today none of these exists (no screen). Comparables: Square's and Google Business Profile's business hours (a row per weekday, a switch for closed, times in place, "copy to other days"); Toast's online-ordering throttling (orders per time slot as one number) (known behaviour).

| # | Story (persona, device) | Target taps (desktop / phone) | Comparable |
|---|---|---|---|
| H1 | **Set the nights the club opens** (Thu–Sat, 23:00 to 05:00, last orders 04:30). Owner. | **6 / 8 + typing**: the section, Thu's switch (it opens the day's dialog), the three times, "Same hours on" Fri and Sat (2 ticks), Save. | Google Business Profile: switch the day, set times, "Copy to". |
| H2 | **Close one night** (a private event on Friday). | **3 / 5**: the section, Fri's switch; undo toast. | A switch per day. |
| H3 | **Change one night's hours.** | **4 / 6 + typing**: the section, the day's row, Save. | As H1. |
| H4 | **Change the check before opening** (rare). | **6 / 8**: the section, "Change", a Select and its value, Save. | — |
| O1 | **Set the venue's spot**, standing in the venue. | **3 / 5**: the section, "I'm at the venue – use this spot"; the browser asks for the location once. | D118. |
| O2 | **Change the cap per sent order**, or switch it off. | **4 / 6 + typing** (the pencil, Enter), or **3 / 5** for the switch. | Toast: an order total limit. |
| O3 | **Change the pace limit, the radius or the pass** (under "More"). | **5 / 7**: the section, More, the Select, the value. | Toast: orders per slot. |
| O4 | **Switch the location check off**, and read what that means. | **4 / 6**: the section, More, the switch; its consequence line shows at once; undo toast. | D118. |

## 2. Place

New rows for `docs/guides/admin-map.md`, after Settings › General:

| Screen (BG / EN) | Route | What it is for | Reached by | Taps | Taps (phone) |
|---|---|---|---|---|---|
| Настройки › Работно време / Settings › Hours | `…?tab=settings&section=hours` | The nights phones can order: each weekday's opening, last orders and closing; the check before opening. | Open, Settings, then the section. | 3 | 5 |
| Настройки › Поръчки / Settings › Ordering | `…?tab=settings&section=ordering` | The rules for ordering on the bill: open tables only, the cap, the location check, the pace, waiter calls. | Open, Settings, then the section. | 3 | 5 |

## 3. Hours, top to bottom

| Part | What it shows | Pattern |
|---|---|---|
| Heading | "Hours" and one line: "When guests can order from their phones. A night ends at {dayEnd}; times after midnight belong to the same night." | — |
| Seven rows, Monday first | The day, a switch (Open / Closed), and for an open day "23:00 – 05:00 · last orders 04:30"; a time after midnight carries "(next morning)"; on a phone the times wrap to a second line. Tapping an open row opens its dialog. | A single reversible write (the switch: saves at once, undo toast). |
| The day's dialog | Three time fields: Opens, Last orders, Closes; "Same hours on" with the other six days as ticks; Save. Opened by switching a closed day on (prefilled from the nearest open day, else empty) or by tapping an open row. | Add a thing: up to three fields, a dialog. Save is the primary action; Cancel loses nothing saved. |
| Before opening | One line: "From 2 h before opening Restro checks the connection to {pos} every 10 minutes; if it still fails 30 minutes before opening, you get an alert." "Change" opens a dialog with three selects. Only for a POS venue (a hand-made venue has nothing to check). | Pick one of a few: a Select each. |

The day switch turned off keeps the day's times, so turning it on again restores them (Undo is the same as switching back). A save that fails `serviceHoursProblem` stays in the dialog with the problem under the field in the owner's words (strings §7).

## 4. Ordering, top to bottom (D118's box)

| Part | What it shows | Pattern |
|---|---|---|
| Heading | "Ordering" and one line: "Rules for orders guests put on the table's bill. Pay-first items are not limited by these." | — |
| Only at open tables | Switch, on: "Only at tables a waiter has opened". | Single reversible write. |
| The cap | "Largest order on the bill without paying first": "€150" with a pencil, and a switch for off. | Rename (a pencil opens the value in place; Enter saves, Escape cancels). |
| The venue's spot | Not set: a warning line "Set the venue's spot, or nobody can order on the bill while the location check is on." and the button "I'm at the venue – use this spot". Set: "Set on 27 Oct, 21:40 · See on a map" and "Use where I am now" (outline). | The one primary action of the section, while unset. |
| More (collapsed) | "Check guests are in the venue" (switch, on; off shows "Anyone with a photo of a table code could order onto that table's bill."); "How far from the spot counts as inside" (Select: 100, 150, 200, 300, 500 m); "How long a passed check lasts" (Select: 30 min, 1 h, 2 h, 3 h, 4 h, 6 h); "Most orders per table in 15 minutes" (Select: 3–20, or Off); "A waiter call waits" (Select: 5, 10, 15, 20, 30, 45, 60 min). Under it one line: "Call a waiter is switched on in the Composer, under Guest features." with the link. | Single reversible writes; Pick one of a few (Select: more than five options). |

D118's labels say "round"; the GLOSSARY term is **sent order** and the guest's word is "order", so the labels say "order".

## 5. The one primary action

Hours: none filled on the page; in the day's dialog, **Save**. Ordering: **"I'm at the venue – use this spot"** while the spot is unset; otherwise none (every control saves at once).

## 6. States

| State | What the screen does |
|---|---|
| **First visit** (never saved) | Hours: every day Closed, and above the rows one line: "Phones can't order until you open at least one night." Ordering: D118's defaults shown as set, the spot unset with its warning. |
| **Set up** | As §3 and §4. |
| **Loading** | Skeleton rows, `aria-busy`. |
| **Failed to load** | "Couldn't load the settings. Check the connection; it tries again by itself." in place of the rows. |
| **A save fails** | The error toast that stays and names the fix ("Check the connection and switch it again"); the control returns to its saved value. |
| **Hours that don't fit the night** | The dialog keeps the values and shows the problem under the field (§7); Save stays enabled. |
| **The password again** | A signed-in owner whose last sign-in is older than 15 minutes (D122 §7): the first change opens "Enter your password to change settings" (the existing sign-in check, not a new form); the change is applied after it. |
| **A role that may not change it** (no `settings.guards`, e.g. a manager) | Values read-only, no switches or pencils, and one line at the top: "Only someone with the right to change settings can change these." Never disabled controls. |
| **A shared device** (signed in on the bar tablet) | Settings never open with a PIN (D122 §7): the Settings tab shows "Settings need your own sign-in." and nothing else. |
| **A hand-made venue** | No "Before opening" (nothing to check); everything else the same. |
| **The location prompt refused** | "Your browser didn't share the location. Allow it for this site, or set the spot on a phone at the venue." Nothing changes. |
| **The location reading too rough** (circle of doubt above 100 m) | "The reading is too rough ({n} m). Step away from walls or turn Wi-Fi on, and try again." Nothing changes. |
| **The longest Bulgarian text** | Labels wrap above their control on a phone; values and times never truncate; no row scrolls sideways at 390 px. |
| **Tonight is running** | A change applies from the next action: hours from the next night unless the night is open now, in which case the toast says "Applies from now."; nothing already sent changes. |

## 7. Strings (BG and EN)

Under `copy-rules.md`; GLOSSARY terms ("sent order" as "order" for the owner, "service day" as "night", "table", "location check", "location pass" as "passed check").

| Key | Bulgarian | English |
|---|---|---|
| `st_hours` | Работно време | Hours |
| `st_hours_lede` | Кога гостите могат да поръчват от телефона. Вечерта свършва в {dayEnd}; часовете след полунощ са от същата вечер. | When guests can order from their phones. A night ends at {dayEnd}; times after midnight belong to the same night. |
| `st_hours_none` | Телефоните не могат да поръчват, докато не отворите поне една вечер. | Phones can't order until you open at least one night. |
| `st_open` / `st_closed` | Отворено / Затворено | Open / Closed |
| `st_day_line` | {opens} – {closes} · последни поръчки {last} | {opens} – {closes} · last orders {last} |
| `st_next_morning` | (на сутринта) | (next morning) |
| `st_opens` / `st_last` / `st_closes` | Отваря / Последни поръчки / Затваря | Opens / Last orders / Closes |
| `st_same_on` | Същите часове в | Same hours on |
| `st_save` / `st_cancel` | Запази / Отказ | Save / Cancel |
| `st_err_last` | Последните поръчки трябва да са след отварянето. | Last orders must come after opening. |
| `st_err_close` | Затварянето не може да е преди последните поръчки. | Closing can't come before last orders. |
| `st_err_dayend` | Затварянето трябва да е преди края на вечерта ({dayEnd}). | Closing must be before the night ends ({dayEnd}). |
| `st_err_15` | Последните поръчки трябва да са поне 15 минути преди края на вечерта ({dayEnd}). | Last orders must be at least 15 minutes before the night ends ({dayEnd}). |
| `st_preopen` | От {start} преди отваряне Restro проверява връзката с {pos} на всеки {every}; ако още не работи {alert} преди отваряне, получавате известие. | From {start} before opening Restro checks the connection to {pos} every {every}; if it still fails {alert} before opening, you get an alert. |
| `st_change` | Промени | Change |
| `st_ordering` | Поръчки | Ordering |
| `st_ordering_lede` | Правила за поръчките, които гостите пишат на сметката на масата. Не важат за артикулите, платени предварително. | Rules for orders guests put on the table's bill. Pay-first items are not limited by these. |
| `st_open_only` | Само на маси, отворени от сервитьор | Only at tables a waiter has opened |
| `st_cap` | Най-голяма поръчка на сметка без предварително плащане | Largest order on the bill without paying first |
| `st_spot_unset` | Задайте мястото на заведението, иначе никой не може да поръчва на сметка, докато проверката на местоположението е включена. | Set the venue's spot, or nobody can order on the bill while the location check is on. |
| `st_spot_use` | В заведението съм – използвай това място | I'm at the venue – use this spot |
| `st_spot_set` | Зададено на {date} · Виж на картата | Set on {date} · See on a map |
| `st_spot_again` | Използвай къде съм сега | Use where I am now |
| `st_more` | Още | More |
| `st_loc` | Проверка дали гостите са в заведението | Check guests are in the venue |
| `st_loc_off` | Всеки със снимка на кода на масата ще може да поръчва на сметката ѝ. | Anyone with a photo of a table code could order onto that table's bill. |
| `st_radius` | Колко далеч от мястото се брои за вътре | How far from the spot counts as inside |
| `st_pass` | Колко трае една успешна проверка | How long a passed check lasts |
| `st_pace` | Най-много поръчки на маса за 15 минути | Most orders per table in 15 minutes |
| `st_off` | Изключено | Off |
| `st_call` | Повикването на сервитьор чака | A waiter call waits |
| `st_call_where` | Повикването на сервитьор се включва в Композитора, в „Функции за гостите“. | Call a waiter is switched on in the Composer, under Guest features. |
| `st_readonly` | Само човек с право да променя настройките може да ги промени. | Only someone with the right to change settings can change these. |
| `st_own_signin` | Настройките изискват ваш собствен вход. | Settings need your own sign-in. |
| `st_fail` | Настройките не се заредиха. Проверете връзката; ще опита отново сам. | Couldn't load the settings. Check the connection; it tries again by itself. |
| `st_saved` | Запазено | Saved |
| `st_now` | Важи от сега. | Applies from now. |
| `st_loc_denied` | Браузърът не сподели местоположението. Разрешете го за този сайт или задайте мястото от телефон в заведението. | Your browser didn't share the location. Allow it for this site, or set the spot on a phone at the venue. |
| `st_loc_rough` | Отчитането е твърде неточно ({n} м). Отдалечете се от стените или включете Wi-Fi и опитайте пак. | The reading is too rough ({n} m). Step away from walls or turn Wi-Fi on, and try again. |

## 8. Questions for Martin, each with a recommendation

- **Q1. The venue's spot: "I'm at the venue – use this spot" only, for the pilot, and the pin on a map later?** D118 offers both. A map needs a map library and map tiles from an outside service (a new dependency, and the owner's browser calls that service). Recommendation: yes: the one-tap button for the pilot (the owner sets it once, inside the club), and "See on a map" as a plain link to check it; the pin on a map comes when a venue can't stand inside to set it.
- **Q2. Labels say "order", not D118's "round"?** Recommendation: yes; the GLOSSARY's term is sent order, and an owner calls it an order.

**Martin 10-27:** confirmed the Hours and Ordering screen as drafted, Q1 and Q2 as recommended (the spot by "I'm at the venue" only for the pilot, the map pin later; labels say "order").
