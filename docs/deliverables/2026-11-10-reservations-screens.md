# The reservations screens: what each one is for (for Martin)

> Filed 2026-11-10 by the walk agent, alongside the findings for issue #387. For: reading the
> reservations screens on `or/foundation` the way the two acceptance guides read ordering and
> paying — `2026-10-30-ordering-acceptance-walk.md`, `2026-10-30-paying-acceptance-walk.md`.
> This is a guide to the screens, not a list of faults; the faults are in
> `2026-11-10-walk-merged-branch.md`.

Reservations part 1 (spec #321) is merged into `or/foundation`. It gives a club a book of bookings
for each night, a door for marking people present, a list of guests, and the settings behind them.
It does **not** give a way to draw the room: until the venue has a floor plan, every screen below
that mentions a place ("място") will say there is none. That gap is B2 in the findings.

The words here are `GLOSSARY.md`'s: a **spot** (място) is a place a party sits — usually a table,
sometimes a booth or a stretch of bar; a **reservation** is a party booked for a night; a **walk-in**
is a party who turns up without one; the **waiting list** holds the parties with no spot yet; a
**sitting** is one party's stay at a table.

## Before you start (once)

Steps 1 to 6 are the ordering guide's "Before you start" — you need them once for all three guides.

1. **The branch:** `git checkout or/foundation`, `pnpm install`.
2. **The local Postgres** in its own terminal: `pnpm db:local`.
3. **A database of its own,** say `restro_accept_rv`; point `DATABASE_URL_OWNER` and `DATABASE_URL`
   at it, then `pnpm db:migrate` and `pnpm db:roles`.
4. **The demo data:** `pnpm db:seed:dev` — Demo Bar on the simulated POS, two bars, twelve tables.
5. **Run:** `pnpm sim:serve`, then `pnpm dev`. Open the app and sign in as the owner
   (`owner@demo-club.test`).
6. **Publish Demo Bar once:** Композитор › Публикувай.
7. **Turn time first.** Until Настройки › Резервации has a turn time, the board refuses to take a
   booking and says so: *"За резервации първо трябва време за маса. Задайте го в Настройки ›
   Резервации."* The demo data sets 180 minutes.
8. **There is no floor plan, and no way to make one.** Every "Избери от плана" leads to
   *"Екипът на Restro рисува плана ти. Пиши ни с плана на залата."* Everything below that depends on
   a spot can be read but not done.

---

## A. Where reservations live

Demo Bar's fifth tab, **Резервации**, holds three parts:

- **Списък** — the night's book of bookings. This is the hostess's screen.
- **План** — the room, spot by spot. Empty until a plan exists.
- **Гости** — the club's record of guests, who came and who did not.

The night follows the venue's service day (it ends at 07:00), so the hours after midnight belong to
the evening before.

## B. Списък — the night's book

**The header** carries two buttons:

- **Нова резервация** — a party booked for a time.
- **Добави компания** — a party waiting from now, with no time and no spot. It goes on the waiting
  list: *"Чакат от сега. Дай им място, щом се освободи."*

**The day** is a "Тази вечер" button and a date field. Moving off tonight shows what that night was
or will be. A past night reads *"Тази вечер е минала. Може да се чете, но не и да се променя."* —
unless the venue switched past nights on, and then *"…Клубът позволява промени по нея."*, and a
person without the right gets *"…но ролята ви не ги прави."* A finished night says *"Тази вечер е
приключена."*

**The filter chips** count what the night holds: Всички · Чакат място · Настанени · Закъсняват · Не
се явиха · Ненастанени · Заявени · Предстоящи · Отказани · Приключени.

**Each row** is one party: its time, its name, how many guests, its state as a badge, and — where
the next move is obvious — a button for it ("Дай място" for a party on the waiting list). The
chevron opens the party's sheet; the "…" opens the rest of the moves.

**When there is nothing:** *"Още няма резервации за тази вечер."*

## C. The party's sheet

Opened from a row. It holds, in order:

- **Гости** — how many.
- **Места** — the spots the party holds, or *"Още няма"*.
- **Запазени до** — when the hold runs out, where one was set.
- **Телефон**, **Бележка**, **Причина** (рожден ден, празненство, фирмено събитие, друго).
- **История** — when it was made and by whom (*"Приета от"*), when they arrived (*"Пристигнаха"*),
  when they left (*"Си тръгнаха"*).

**Its buttons:**

- **Смени масите** — add or drop spots: *"Докосни местата, за да ги добавиш или махнеш, после
  запази."* Taking a spot another party holds offers a swap — *"Да разменим ли с {party}?"* — and
  either side can be kept (*"Не разменяй"*). Where a bill is already open on the spot being left,
  Restro will not move it and says so: *"Сметката остава на {spot}. Премести я на касата."* That is
  rule 7 — Restro only does at the POS what a waiter does, and moving a bill is the till's job.
- **Дай място** — for a waiting party: *"Дай място на {party}"*, from the list or from the plan.
- **Правило за плащане** — this party's own rule for this sitting: "Правилото на клуба", "Всичко на
  сметката" or "Плащане преди поръчка", with *"Само за тази компания и само за това сядане."* A
  table that carries its own setting beats it, and the sheet says so: *"{spot} има свое правило:
  {rule}. То важи."* "Нови гости" at the table ends the sitting and the rule with it: *"Нови гости —
  правилото на клуба."* Only somebody with that right may change it.
- **Още** — Редактирай, Копирай в друга вечер, Не се яви, Откажи резервацията, Изтрий резервацията…
  (and Възстанови for one already cancelled).

**While writing a booking** the sheet warns rather than refuses:

- *"Клубът е затворен тази вечер. Все пак можеш да резервираш."*
- *"{guests} гости на {seats} места. Ако кажеш, минава."* — a party larger than the spot is a
  warning, never a refusal (the setting under Настройки › Резервации › Места).
- *"{name} вече има резервация за тази вечер в {time}."*

On a shared device every write asks a PIN.

## D. The door — marking people present

The door is the same Списък, used as people arrive.

- **Настани** on a booking marks the party present. **Marking them present on their spot is what
  opens that table for phones** — the one bridge between reservations and ordering.
- **Настани без резервация** takes a walk-in straight onto a spot.
- **Колко дойдоха?** asks the real number when it differs from the booking.
- Where the spot is held by somebody else: *"{party} е запазила {spot} от {time}."* or
  *"{party} е на {spot} от {time}. Първо я премести."*
- Where the spot still has an open bill, Restro asks **whose guests these are**: *"Същите гости
  ли са?"* — *"Същите гости — запази поръчката"* keeps the sitting (and the party's pay rule);
  *"Нови гости — започни отначало"* ends the sitting, opens a new one and drops the rule. A bill
  that stays open is said plainly: *"{spot} все още има отворена сметка. Поръчката на новата
  компания ще влезе в нея."*
- **Пристигнаха** and **Си тръгнаха** are recorded on the sheet.

## E. План — the room

Shows the venue's spots, with zoom, arrow-key panning and tab between spots
(*"Стрелките местят плана, плюс и минус увеличават, табулаторът минава от място на място."*). A
spot shows its name, its seats, and its state; tonight's holds are listed under **Тази вечер**
(*"Резервирано за {time}"*, *"Настанени от {time}"*, *"Закъснява от {time}"*, *"Блокирано ·
{reason}"*).

**Блокирай** takes a spot out of use: *"Никой няма да може да го резервира, докато не го
отблокираш. Компания, която седи там сега, го запазва, докато не си тръгне."* The reasons are
почистване, ремонт, повредено, частно събитие, друго.

A spot that is not a table carries *"На това място не се поръчва: то не е маса."* — it can hold a
party, but no bill and no phones.

**Today this screen is empty on every venue**, and says *"Екипът на Restro рисува плана ти. Пиши ни
с плана на залата."*

## F. Гости — the club's guest record

- **Търси по име или телефон**, with chips Всички · Редовни клиенти · Архивирани.
- **Добави редовен клиент** adds one by hand.
- A guest's sheet carries the phone, how often they came —
  *"Идвал {n} пъти, не е идвал {m} пъти, в твоя клуб."* with
  *"Приблизителна бройка за хостесата, не запис за пари."* — their last bookings, and
  **Резервирай маса**, **Редактирай**, **Още**.
- **Архивирай** takes a guest out of the lists without erasing them; erasing is its own step and
  asks for the password.
- Where the venue allows it, a manager keeps a **personal** list as well as the club's:
  the badge is *"В моя списък"*.

## G. Настройки › Резервации

- **Телефонът е задължителен** — whether a booking must carry a phone.
- **Мястото се пази** — the turn time, in minutes: *"Това е и най-краткото време преди следваща
  резервация на същото място."* Nothing can be booked without it.
- **Разреши редакция на минала вечер** — *"Който има правото, ще може да добавя, променя и трие
  резервации за вечери, които са минали."*
- **Управителят води личен списък с гости** — *"Освен общия списък на клуба, който виждат всички,
  които работят с резервации."*
- **Единични затворени дати** — the nights the club is shut. A booking on one is still allowed, with
  a warning.
- **Места** — *"Само предупреждение: по-голяма компания никога не се отказва."* and, below,
  the spots, once a plan exists.

The club's opening hours are **not** here; they are in Настройки › Работно време, and this panel
links to them.

---

## The words, and what each state means

**A reservation** is in one of these:

| Badge | Means |
| --- | --- |
| Заявена | Asked for, not yet accepted by the club. |
| Предстояща | Accepted, the party has not arrived. |
| Чака място | On the waiting list; no spot yet. |
| Закъснява | The time has passed and nobody came. *"Никое място не се освобождава само."* |
| Настанена | The party is in, on its spot. |
| Ненастанена | The night ended without a spot. |
| Не се яви | Marked as a no-show by staff. |
| Приключена | The party has left; the night is done with them. |
| Отказана | Cancelled, by the club or the guest. |

**A spot** is in one of these: **Свободно**, **Запазено** (held for a booking), **Настанени** (a
party is sitting), **Заето** (in use), **Закъснява**, **Блокирано**.

A held spot never frees itself. "Закъснява" is a prompt for the hostess, not an action: somebody has
to decide to give the spot away.

---

## Still yours, outside this guide

- Whether a hostess can be asked to work the night from the Списък alone, with no plan.
- What the club should be told to send, and to whom, when it wants its room drawn.
- Whether the waiting list needs a time estimate for the guest ("about 20 minutes"), or stays a
  staff-only queue.
- Prepayment and the booking page: both are part 2 and have no screens yet.

## What to report

For anything that does not read as written above: the screen, what it said, what you expected, and
whether it stopped you. Quote the Bulgarian you saw.
