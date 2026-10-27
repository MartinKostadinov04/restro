Made by: the part 1 ordering lead, 10-27, for #61 and #87. For: Martin, then the #87 build.

# Venue settings: Staff and roles (screen plan, #87)

Prototype: `2026-10-27-settings-staff-alerts-prototype.html` (with the Alerts section). Throwaway: it answers "can an owner add a bartender, give them a PIN, and set who may do what, in a few taps and without an email?"

**Scope.** The venue's Settings › **Staff and roles** («Персонал и роли»), placed by the confirmed grouping (`2026-10-27-owner-settings-grouping.md`), `?tab=settings&section=staff`, for `settings.roles`. Three parts on one page: **People**, **Roles**, **Shared devices**. The backend is built (#72, `packages/core/src/service/staff.ts`): `staff.add`, `staff.rename`, `staff.assign`, `staff.unassign`, `staff.archive`, `staff.link_account`, `pin.reset`, `pin.reveal`, `role.copy`, `role.update`, `role.archive`, `device.mark_shared`, `device.revoke`; each is a `record` Log entry. A PIN is drawn by Restro, never typed by the owner, and seen again only through `pin.reveal` (logged).

**What the backend already decides** (shown, not chosen here): staff belong to the organisation and hold one role per venue; nobody hands out or manages more than they hold (a manager can't give the Owner role, nor manage the owner); the three default roles are read-only, a venue copies one to make its own; a shared device is marked from that device's own sign-in and revoked from another.

## 1. Stories and taps

Reaching the section: 2 taps on desktop, 4 on a phone (as Hours). Comparables: Square's Team (name, permission set per location, a passcode generated or set), Toast's Employees (jobs with permission groups; copy a job), Lightspeed's users and roles (known behaviour).

| # | Story (spec #64) | Target taps (desktop / phone) | Comparable |
|---|---|---|---|
| P1 | **Add a bartender** by name with a generated PIN, no email (53). | **4 / 6 + typing**: the section, "Add person", the name (the role is Staff by default), "Add"; the PIN shows in the result. | Square: add a team member, passcode generated. |
| P2 | **See a person's PIN** (54). | **3 / 5**: the section, the eye on the person's row; shown 30 seconds, then hidden. | Square: show passcode. |
| P3 | **Give a person a new PIN** (54). | **4 / 6**: the section, "…", "New PIN"; the new PIN shows in the result. | — |
| P4 | **Change a person's role here.** | **4 / 6**: the section, the role on the row (a Select), the role. | Toast: change job. |
| P5 | **Remove a person from this venue** (they keep other venues) or **for good**. | **4 / 6**: "…", "Remove from {venue}" (undo toast). For good: **5 / 7**, a dialog naming the consequence. | — |
| P6 | **Let a manager use their own phone** (link the person to an account of the organisation). | **5 / 7**: "…", "Link to an account", pick, Save. | — |
| R1 | **Make my own role** from a default one, with other permissions (52). | **5 / 7 + typing**: Roles, "Copy" on the role, the name, ticks, "Save". | Toast: copy a job. |
| R2 | **Change what my role may do.** | **4 / 6**: the role's row, the tick (saves at once, undo toast). | — |
| D1 | **Make this browser the bar tablet** (55), on the tablet itself. | **4 / 6 + typing**: the section, "Make this browser a shared device", the name ("Bar tablet"), "Make shared". | Toast: device setup per location. |
| D2 | **Stop a device being shared** (from another device). | **4 / 6**: the device's "Stop sharing", confirm. | — |

## 2. Place

| Screen (BG / EN) | Route | What it is for | Reached by | Taps | Taps (phone) |
|---|---|---|---|---|---|
| Настройки › Персонал и роли / Settings › Staff and roles | `…?tab=settings&section=staff` | The venue's people (role, PIN), its roles and what each may do, and its shared devices. | Open, Settings, then the section. | 3 | 5 |

## 3. The page, top to bottom

| Part | What it shows | Pattern |
|---|---|---|
| **People** heading, with "Add person" (outline; the page's primary action while the list is empty, filled then) | — | Add a thing (two fields: a dialog). |
| A person's row | The name; under it the role here as a Select (P4); the PIN as "••••" with an eye button (P2); "Telegram linked" when it is (Alerts' plan); "Own phone" when linked to an account; "…" with Rename, New PIN, Link to an account / Unlink, Remove from {venue}, Remove for good. A person the actor may not manage: the row shows name and role only, no controls, and "Only {role} can change this person." | A list of records; the secondary actions of a row ("…"); Pick one of a few (Select). |
| Add person (dialog) | Name; Role (Select, Staff first). "Add". Then the result in place: "{name}'s PIN is 4821. They use it on the bar tablet." with "Done". | Add a thing. |
| New PIN | No confirmation (the old PIN stops at once, nothing is lost: a new one is shown); the result shows the PIN as Add does; no undo (a PIN can't be put back). | — |
| Remove from {venue} | One tap; undo toast. | Remove a thing that can come back. |
| Remove for good | A dialog: "{name} is removed from every venue and their PIN stops working. Their past actions stay in the Log." Buttons: "Remove {name}" and "Keep". | Remove a thing for good. |
| **Roles** heading | Each role a row: its name, "{n} people", and a chevron; the three defaults carry "Default" and open read-only; each has "Copy". | A list; everything about one thing (a side sheet). |
| A role's sheet | The name (rename in place, own roles only); the permissions as ticks in three groups (Tonight, Records, Settings) with the owner's words (§6); "Archive role" at the bottom (own roles with no people). A tick the actor doesn't hold is shown unticked and read-only with "You can't give what you don't hold." Settings ticks carry the line "Needs the person's own sign-in; a PIN never opens settings." | Single reversible writes (ticks save at once, undo toast). |
| **Shared devices** heading | Each device: its name, "Since {date}", "Stop sharing". On a device that is not shared: "Make this browser a shared device" (outline) with one line "From then on this browser asks for a PIN for every action and can't open settings." | A list of records; remove for good (a dialog: the device must be signed in again by its owner to be shared again). |

## 4. The one primary action

"Add person" while there are none; once there are people, none filled (the page is mostly reading and changing rows).

## 5. States

| State | What the screen does |
|---|---|
| **No people yet** | The empty-state block: "Add the people who work at {venue}. Each gets a PIN for the bar tablet; no email needed." and "Add person" (filled). |
| **Loading / failed** | Skeleton rows / "Couldn't load the staff. Check the connection; it tries again by itself." |
| **A PIN shown** | The four digits in tabular figures for 30 seconds, then "••••" again; the Log has "PIN shown: {name}". |
| **Refusals** | `permission_denied`: "You can't change {name}: they hold rights you don't." `role_name_taken`: "There's already a role called {name}." `pins_exhausted` (no free PIN left): "Couldn't make a new PIN. Try again; if it keeps failing, ask Restro." `account_taken`: "That account is already linked to {other}." `already_shared`: "This browser is already a shared device." `role_in_use`: "Move its people to another role first." `permission_not_held`: the tick stays read-only (above); a staff or role that is gone: the list reloads. |
| **Many people** (a 50-person club) | One list, alphabetical, with a search field above it once there are more than 12. |
| **The password again** | As Hours: after 15 minutes the first change asks for the password. |
| **No `settings.roles`** | The section is not in the list (nothing here is useful read-only, and names with roles are staff data); a link to it opens General. |
| **Restro's admin team** | Everything an owner sees, plus any role's ticks; never "Make this browser a shared device" (D122 §7). |
| **A shared device** | Settings need own sign-in (as Hours). |
| **The longest Bulgarian text** | Permission labels wrap; the PIN and the role Select never truncate; no sideways scroll at 390 px. |

## 6. Strings (BG and EN)

| Key | Bulgarian | English |
|---|---|---|
| `sf_title` | Персонал и роли | Staff and roles |
| `sf_people` / `sf_roles` / `sf_devices` | Хора / Роли / Общи устройства | People / Roles / Shared devices |
| `sf_add` | Добави човек | Add person |
| `sf_name` / `sf_role` | Име / Роля | Name / Role |
| `sf_add_go` | Добави | Add |
| `sf_pin_new` | ПИН-ът на {name} е {pin}. Използва го на таблета на бара. | {name}'s PIN is {pin}. They use it on the bar tablet. |
| `sf_done` | Готово | Done |
| `sf_empty` | Добавете хората, които работят в {venue}. Всеки получава ПИН за таблета на бара; не е нужен имейл. | Add the people who work at {venue}. Each gets a PIN for the bar tablet; no email needed. |
| `sf_show_pin` / `sf_hide_pin` | Покажи ПИН / Скрий ПИН | Show PIN / Hide PIN |
| `sf_rename` / `sf_newpin` | Преименувай / Нов ПИН | Rename / New PIN |
| `sf_link` / `sf_unlink` | Свържи с акаунт / Махни акаунта | Link to an account / Unlink the account |
| `sf_own_phone` | Собствен телефон | Own phone |
| `sf_remove_here` | Махни от {venue} | Remove from {venue} |
| `sf_remove_all` | Премахни завинаги | Remove for good |
| `sf_remove_all_body` | {name} се премахва от всички заведения и ПИН-ът му спира да работи. Миналите му действия остават в дневника. | {name} is removed from every venue and their PIN stops working. Their past actions stay in the Log. |
| `sf_remove_all_go` / `sf_keep` | Премахни {name} / Остави | Remove {name} / Keep |
| `sf_cant_manage` | Само {role} може да променя този човек. | Only {role} can change this person. |
| `sf_role_people` | {n} души | {n} people |
| `sf_default` | По подразбиране | Default |
| `sf_copy` | Копирай | Copy |
| `sf_copy_name` | Копие на {role} | Copy of {role} |
| `sf_archive_role` | Архивирай ролята | Archive role |
| `sf_cant_give` | Не можете да дадете право, което нямате. | You can't give what you don't hold. |
| `sf_own_signin` | Изисква собствен вход; ПИН никога не отваря настройките. | Needs the person's own sign-in; a PIN never opens settings. |
| `sf_g_tonight` / `sf_g_records` / `sf_g_settings` | Тази вечер / Записи / Настройки | Tonight / Records / Settings |
| `perm.tables.open_close` | Отваря и затваря маси за телефони | Open and close tables for phones |
| `perm.tables.resume` | Пуска отново спряна маса | Resume a paused table |
| `perm.ordering.pause` | Спира поръчките | Pause ordering |
| `perm.ordering.lift` | Пуска поръчките отново | Turn ordering back on |
| `perm.alerts.answer` | Отговаря на известия | Answer alerts |
| `perm.sold_out` | Маркира изчерпани артикули | Mark items sold out |
| `perm.log.view` | Вижда дневника | See the Log |
| `perm.night.view` | Вижда края на вечерта, без бакшиши | See the end of the night, without tips |
| `perm.night.view_full` | Вижда целия край на вечерта, с бакшиши и CSV | See the whole end of the night, tips and CSV |
| `perm.money.follow_up` | Проследява плащанията: сторно и спорове | Follow up payments: stornos and disputes |
| `perm.settings.guards` | Променя работното време и правилата за поръчки | Change hours and ordering rules |
| `perm.settings.codes` | Прави нови кодове на масите | Make new table codes |
| `perm.settings.payment_tables` | Маркира маси за плащане | Mark payment tables |
| `perm.settings.alerts` | Избира кой получава известия; свързва Telegram | Choose who gets alerts; link Telegram |
| `perm.settings.roles` | Управлява персонала, ролите, ПИН-овете и устройствата | Manage staff, roles, PINs and devices |
| `sf_dev_make` | Направи този браузър общо устройство | Make this browser a shared device |
| `sf_dev_line` | След това този браузър иска ПИН за всяко действие и не отваря настройките. | From then on this browser asks for a PIN for every action and can't open settings. |
| `sf_dev_name` | Име на устройството | Device name |
| `sf_dev_go` | Направи общо | Make shared |
| `sf_dev_since` | От {date} | Since {date} |
| `sf_dev_stop` | Спри споделянето | Stop sharing |
| `sf_dev_stop_body` | „{device}“ отново ще е обикновен вход. За да стане общо пак, собственикът влиза на него. | "{device}" becomes an ordinary sign-in again. To share it again, its owner signs in on it. |
| `sf_e_denied` | Не можете да промените {name}: има права, които вие нямате. | You can't change {name}: they hold rights you don't. |
| `sf_e_taken` | Вече има роля „{name}“. | There's already a role called {name}. |
| `sf_e_pins` | Не се получи нов ПИН. Опитайте пак; ако продължи, пишете на Restro. | Couldn't make a new PIN. Try again; if it keeps failing, ask Restro. |
| `sf_e_account` | Този акаунт вече е свързан с {other}. | That account is already linked to {other}. |
| `sf_e_shared` | Този браузър вече е общо устройство. | This browser is already a shared device. |
| `sf_e_in_use` | Първо преместете хората ѝ в друга роля. | Move its people to another role first. |
| `sf_fail` | Персоналът не се зареди. Проверете връзката; ще опита отново сам. | Couldn't load the staff. Check the connection; it tries again by itself. |

## 7. Questions for Martin

None: the backend (D122 §7, #72) settles who may do what. The permission words in §6 are his to accept with the strings.

**Martin 10-27:** confirmed the Staff and roles screen as drafted, with its permission words.
