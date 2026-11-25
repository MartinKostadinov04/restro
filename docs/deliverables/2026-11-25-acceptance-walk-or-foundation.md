# Acceptance walk: ordering, paying and reservations on `or/acceptance`

2026-11-25. One walk over everything, as Martin asked on 11-10: ordering, paying and
reservations in a single pass, not three reviews. Walked by an agent session on branch
`or/acceptance` at `97e23c52` ("Merge or/foundation into main for acceptance", the head of
draft PR #554), against the demo venue **Club Biad Sofia** (79 tables, source `test POS`),
the simulated POS (`sim-pos`, scenario `club-biad`) and the simulated payment provider
(`sim-pay`). No live key, no real card, no live venue's POS.

This is a report, not a repair. Nothing in product code was changed.

**The standard this walk is judged against** (Martin, 11-25): does it work. Every screen
reached, every flow completed end to end, nothing throwing, the venue Log and the night's
arithmetic right, money held, captured and released correctly. UI and UX improvements are
the next cycle's: what looks or feels wrong is recorded in section 6, which is not part of
the verdict. "Ugly but usable" is a pass. A blocker is only something that stops a person
completing what they came to do, or that gets the money or the Log wrong.

---

## 1. The verdict

**Yes. It works, and there is no blocker.** Nothing in this walk stopped a person completing
what they came to do, and nothing got the money or the Log wrong.

| What the acceptance asks | Verdict |
|---|---|
| Every screen reached | **Yes** — every screen in the D161 sidebar, every sub-tab, both Tonight views and the guest surfaces. None 404'd, none failed to render. |
| Every flow completed end to end | **Yes** — guest order to bar to bill to payment to receipt to waiter's slip; booking to door to seating to waiting list to the night's close. |
| Nothing throwing | **Yes** — no product error in the browser console or the server log across the whole walk. The only noise is dev-server HMR websocket retries and a `pg` deprecation warning. |
| The venue Log right | **Yes** — every write in this walk is in the Log, in order, with its actor, table and reason, including the whole payment chain and the end-of-night cascade. |
| The night's arithmetic right | **Yes** — every total reconciles against what was ordered and paid. Figures in section 3. |
| Money held, captured and released | **Yes, all three.** Held and captured over a linked group of two tables in one payment; released when a guest backed out. Evidence in section 3. |

### Three things worth Martin's own eyes

1. **The paying part of spec #539 is not finished on this branch** (section 5). Sharing a bill
   by amount exists as an engine only: #544, #545, #540 and #546 are open, so there is no
   guest screen and no Tonight line for it. That is scope, not a defect — but it decides
   whether the pilot can run the full workflow he insists on (11-21).
2. **The demo-setup instructions have three gaps** (section 7) that each cost this walk real
   time, and would cost him the same on his own run-through.
3. **The one content defect worth fixing early:** every door dialogue that should name a table
   names nothing (6.1). It does not block — the hostess picked the table herself and can
   finish — but it is one query and one fallback, and it is on a screen the pilot's hostess
   uses all night.

---

## 2. How it was walked, and what was changed to walk it

| | |
|---|---|
| Branch | `or/acceptance` @ `97e23c52` |
| Web app | Next.js 16.4.3 dev build (Turbopack), port 3500 |
| Database | local Postgres on 54329, database `restro_accept` |
| POS | `sim-pos`, scenario `club-biad`, port 4510 |
| Payments | `sim-pay`, account `simpay_club_biad` |
| Signed in as | `owner@club-biad.test` (Мартин, собственик) |
| Guest phones | two tabs at 375x812, tables 17 and 45 |

**Three setup changes were made, and nothing else. No product code, no seed file, no
committed file.**

1. **Wednesday's ordering hours were changed from 22:00 to 10:00**, through the app, so a
   guest could order in the afternoon. Recorded in the venue Log like any other setting
   change (`settings.changed`, reason `ordering`). It had to be done twice, because change 3
   put it back.
2. **`WORKER_PAYMENTS_SIM_CARD` was cleared in the git-ignored `.env.local`, and the worker
   restarted**, to walk the release path. With `=accept` the simulated bank takes the card at
   the moment the hold is made, so a payment can never be abandoned before the hold and the
   release can never be reached from outside the worker process. It was restored to `accept`
   and the worker restarted again at the end of the walk, so the demo is back as the
   instructions expect.
3. **`pnpm db:seed:demo` was re-run** after the night had been ended, to reopen tables for
   phones. Once a night is closed, Tonight deliberately refuses to open a table
   (`table-sheet.tsx:170`, "A closed night opens nothing"), and the service day does not roll
   until 07:00, so the documented demo script is the only way back. It is idempotent and it
   is the project's own script.

**What this environment cannot settle.** The walk ran on a development build, on a machine
also running five other Restro dev servers, four workers and two simulated POS servers. Page
load times here mean nothing (section 8.1). A production build on a quiet machine is still
owed one measurement.

---

## 3. Money: held, captured and released

### Held and captured — one payment across a linked group (#542, D160 section 3)

A party was booked over spots for tables 17 and 45 and marked present, which forms one linked
group. A phone at table 17 then saw **"Сметката на групата"** with both tables' lines grouped
by table and one total — 15,00 EUR + 39,00 EUR = **54,00 EUR** — and paid all of it in one
card payment. The guest got "Платено", the payment number **9R9F7**, the five paid lines,
"Общо 54,00 EUR" and "Покажете този номер на сервитьора. Сервитьорът ще ви донесе касовата
бележка." The second phone, at table 45, showed every line marked "Плаща се" while the first
was paying. **The receipt survives a reload** — the paid state is read back from the server,
not kept locally (D72).

The Log carries the whole chain in order and in plain Bulgarian: lines moved to a payment
table, the last check, the bill closed, the card charged, the payment table released, both
tables closed for phones. Each entry names its actor (`Restro` for the worker,
"Мартин (собственик)" for a person) and its table.

### Released — a guest who backs out

A guest at table 17 ordered one Текила (4,50 EUR), it reached the bar and the bill, and the
guest started to pay and then tapped **"Плати по-късно"**.

| | |
|---|---|
| Provider steps | `createHold` to `done`, then `release` to `attempting` to `done` |
| Payment row | state `released`, reason `cancelled`, `captured_minor` null, settled 11:49:39 |
| Log | one entry, `payment.state`, `cancelling` to `released`, reason `cancelled` |
| Tonight | "Плащания 3 · 2 таксувани · **1 освободени** · 0 без потвърждение" and the line **"Плащане за Маса 17, 4,50 EUR: освободено (гостът се отказа) · Маса 17 · Бар 2"** |
| The guest | went back to the line picker with the line still payable; nothing charged |

Nothing was captured, the hold was given back at the provider, and the money columns moved
correctly: **Таксувани плащания с карта stayed at 169,50 EUR** and **Задържано по плащания
без потвърждение stayed at 0,00 EUR**.

### The arithmetic reconciles

After the release, Tonight's end-of-night panel read:

- Изпратени поръчки **4** · добавени в сметките **4** · неизпратени **0** · непотвърдени **0**
- Сума, добавена в сметките **139,50 EUR** — the three orders of the walk (4,50 + 15,00 +
  115,50 = 135,00 EUR) plus the tequila of the release walk (4,50 EUR)
- Плащания **3** · таксувани **2** · освободени **1** · без потвърждение **0**
- Таксувани плащания с карта **169,50 EUR** = the seeded bill's 115,50 EUR plus the group's
  54,00 EUR; the released 4,50 EUR is correctly not in it
- Бакшиши **0,00 EUR** (tips are deliberately not offered — see section 4),
  Задържано **0,00 EUR**
- Отваряния на маси за телефони **19** · Повиквания на сервитьор **2** · Паузи **1**
- Резервации: Записани 6 · Без резервация 2 · Дошли 3 · Не дошли 3 · Отказани 1 ·
  Неседнали 1 · Места по резервации 42 · Седнали гости 18 · Дял на неидването 60%

---

## 4. What was completed end to end

### Guest, on a phone

- The QR page opens on the venue's menu with the table named in the header ("Маса 17"), a
  language switch, a bill icon and a card icon.
- Ordering onto the table's bill works on both tables. The order reaches the bar and appears
  in Tonight, and the phone is told "Добавено към сметката ви".
- The group's bill works (#319) — one bill across two tables, grouped by table, one total.
- Paying works, including over a linked group, and so does backing out (section 3).
- After the night ended, the menu says plainly: "Тази маса не е отворена за поръчки от
  телефон. Попитайте сервитьор."

### Staff, on Tonight

- Orders arrive on "Действия и маси"; "Чака вас" counts what needs a person.
- After a phone payment the waiter gets a card: "Занесете бележката — Маса 17: платено от
  телефона с реф. 9R9F7, 54,00 EUR. Бележка 0000002", with one button, "Занесена". Marking it
  done gives a toast with "Върни".
- The empty state is good: "Нищо не чака. Обажданията на масите и сигналите за пари се
  появяват тук."
- The venue Log is the strongest part of the build: filters by kind and by night, a CSV
  download, and a sentence per entry that a manager can read without training.
- **Ending the night asks an honest question** before it acts: "Да приключим ли вечерта сега?
  След това нито един телефон не може да поръчва.", with the counts, a warning that the club
  closes at 06:00 and it is only 13:16, and two buttons where the destructive one is named for
  what it does ("Приключи вечерта по-рано"), not "OK".
- Ending the night then does the whole cascade and records it: five tables closed for phones,
  bookings resolved as приключена / неявила се / ненастанена, and the close itself —
  "Мартин (собственик) приключи вечерта по-рано · още отворени сметки: 2". The actions screen
  afterwards carries the standing note "Вечерта приключи в 13:17. Затвори ги в test POS."

### Reservations

- The list has state filters with live counts.
- Booking a party over two places warns well: "9 гости при 8 седящи. Може да запазите и така."
  — it states the problem and leaves the decision with the hostess.
- Seating gives an undo toast. A walk-in from the waiting list can be seated on a chosen spot
  and is then listed as "Без резервация · Настанена" with "Върни".
- The Гости view has search, state tabs (Всички 8 / Редовни клиенти 1 / Архивирани 0) and a
  guest card with visits, no-shows and recent bookings — and it is careful about what the
  number means: "Приблизителна бройка за хостесата, не запис за пари."

### Navigation (D161) — every screen reached

- The venue sidebar carries every screen: Меню (Студио, Маси и QR), Поръчки (Тази вечер,
  Настройки), Резервации (Резервации, Настройки), Заведение (Настройки), Организация
  (Настройки). **Nothing is left reachable only by the old tabs.**
- Reached and rendered in this walk, each without error: Студио · Маси и QR · QR print sheet ·
  Тази вечер (Действия и маси, Поръчки, Дневник, Край на вечерта) · Настройки на поръчките
  (Работно време, Поръчки, Плащане, Известия) · Резервации (Списък, План, Гости) · Настройки
  на резервациите · Настройки на заведението (Общи, Персонал и роли, Синхронизиране, Версии) ·
  Настройки на организацията (Общи, Интеграции, Изтрити заведения) · /venues · the guest menu,
  bill, bag and pay sheets.
- The venue switcher opens with the current venue ticked, "Всички заведения" and "Ново
  заведение". At organisation level the sidebar correctly drops the venue sections.
- **The phone's hamburger menu works properly**: a drawer with the venue switcher, all five
  sections, the current item highlighted, and it navigates and closes. The Tonight tab row
  becomes a dropdown on a phone, and the cards stay readable at 375 px.
- The payment settings screen answers a question the walk raised: tips show 0,00 EUR because
  **tips are deliberately not offered** — "Бакшиши не се предлагат: test POS още не може да го
  добави в същата касова бележка." That is an explanation, not a gap.

---

## 5. What could not be walked, and why

**Sharing a bill by amount, with a hold per card, has no guest surface on this branch.** The
brief asked for it; it cannot be done. #543 built the engine and its own text says so: "The
guest screens and Tonight's button are their own tickets." Nothing in `apps/web/src`,
`packages/faces` or `packages/shell` references `share.start`, `share.hold`,
`share.withdraw`, `share.cancel` or `guestShare` — the feature lives only in
`packages/core/src/service`, `apps/worker` and the schema.

Under spec #539 the following are **open**, so the paying part of the spec is not finished:

| Ticket | State | What is missing |
|---|---|---|
| #544 Group payment: the guest's screens (Split the amount) | open | the whole guest flow for sharing by amount |
| #545 Group payment in Tonight: the sharing line and Cancel sharing | open | staff can neither see nor cancel a share |
| #540 Linked groups in Tonight: the outline on the plan, the party on the table's sheet | open | a group's tables share no outline on the plan; the sheet does not show the party |
| #546 Refunding an undeliverable line to every card in proportion | open | — |

This explains two things the walk noticed in passing: the group's two tables had no shared
outline on the plan, and the waiter's card named one table (6.4).

**Switching between venues** could not be exercised: the demo has one venue, so only the
switcher's shape could be checked, not the switch.

**A card the bank refuses** could not be walked. The simulator's refusals are scripted
in-process (`engine.fault`), which only its own tests can reach; nothing outside the worker
can play the guest at the form. The release was therefore walked through a guest who backs
out, which is the same release call at the provider (`release` to `done`) and the more common
case anyway. A refused card is covered by the package's own tests in CI.

---

## 6. Next-cycle material — what looks or feels wrong

**None of this is a blocker.** It is recorded because Martin asked for it, and it belongs to
the next cycle, not to this acceptance.

### 6.1 Door dialogues name no table

**What happens.** A door dialogue that should read "Маса 22 все още има отворена сметка."
reads " все още има отворена сметка." — the table's name is an empty string, so the sentence
begins with a space.

**Why.** `packages/core/src/service/reservations/arrive-checks.ts:141` selects only
`venueTables.name`; line 149 stores the name or an empty string and line 292 reads it back
with the same fallback. `name` is nullable by design — `packages/db/src/schema.ts:1192` says
"Our name for it, or null (guests then see `number`)" and `number` is "null only when `name`
is set". **All 79 tables of the demo venue have a number and no name**, which the schema
treats as the normal case, so the name is always empty. The floor plan does it correctly:
`plan-read.ts:541` falls back through `tableName`, then `tableNumber`, then `name`.

**Where it shows.** `apps/web/messages/bg.json:2874` (`d_bill_t`) and `:2878` (`d_free_t`),
rendered at `apps/web/src/reservations/door-actions.tsx:395` and `:406` and
`apps/web/src/reservations/change-tables.tsx:499`.

**Why it is not a blocker.** The hostess picked that table herself a moment earlier, the
dialogue is advice rather than a gate, and she can finish the seating. No money and no Log
entry is wrong. It is still the first thing worth fixing in the next cycle: one query and one
fallback, mirroring `plan-read.ts:541`.

### 6.2 The floor plan cannot be fitted into its box

The plan's viewport is `h-[60vh]` — 540 px tall at 1440x900. At 1:1 the room is 1103x1252.
**"Покажи целия план" does not fit the plan**: it resets the transform to identity (scale 1),
leaving more than half the room off-screen. Zooming out with "minus" bottoms out at about
0.6x, where the room is 662x751 — still 1.4x taller than its pane — and the button stays
enabled while doing nothing further. At that zoom **99 spots render as unlabelled circles
under 30 px**; their names exist only as `aria-label`. So there is no zoom at which a person
can see the whole room, and no zoom at which the small spots are identifiable. The plan canvas
also swallows the mouse wheel, and each zoom step fires a `floorPlanAction` server
round-trip — fourteen clicks produced twenty POSTs.

### 6.3 The night panel and the close dialogue word the same numbers differently

Before the night is closed, the night panel reports **Не дошли 0 · Неседнали 0 · Дял на
неидването 0%** while the close-the-night dialogue, on the same screen, reports **Не дошли: 3
· Неседнали: 1**. This is not an arithmetic error: the panel is reporting the record — nobody
had been marked a no-show yet — and the dialogue is forecasting what the close will do. After
the close the panel reads **Не дошли 3 · Неседнали 1 · Дял на неидването 60%**, which agrees
with the Log. The two should be worded so a manager can tell "so far" from "if you close now".

### 6.4 A group payment is presented as belonging to one table

The payment covered tables 17 and 45. The guest's receipt is headed "Маса 17" and lists all
five lines with no indication that two tables were paid. The waiter's card in Tonight is
likewise headed "Маса 17" only — **the guests at table 45 get no slip at all**. After the
payment, the phone at table 45 falls back to "Все още няма поръчки." instead of saying the
bill was paid. #540 and #545 are the tickets that would carry this.

### 6.5 A second guest paying is not told why he cannot

While one phone was paying, a guest on the other phone who tapped Pay got a sheet with nothing
selectable and the hint "Изберете поне един ред." He is never told that his table is already
being paid.

### 6.6 A phone keeps showing a closed sitting's receipt

Reopening the pay sheet on a table whose sitting had ended and begun again showed the previous
sitting's "Платено 9R9F7 54,00 EUR" as the current state. There is a way out ("Към
сметката"), and the new bill is correct behind it, but the first thing the next guests see on
that phone is somebody else's paid receipt.

### 6.7 The night panel's subtitle does not know the night ended

After "Приключи вечерта по-рано", the Край на вечерта panel still reads "Досега тази вечер ·
вечерта приключва в 07:00". The actions screen does say it ("Вечерта приключи в 13:17"), and
the Log has the whole cascade; only this one line is stale.

### 6.8 The place picker and the door contradict each other

The reservation place picker marks a spot "Свободно" while seating on that same spot warns
that its bill is still open. Two meanings of "free" on one screen.

### 6.9 Cosmetic

- A ticked line in the pay sheet is a filled grey square with no checkmark; ticked and unticked
  differ only by fill, in a dark theme, on a phone.
- All three "whole bill" toggles carry `aria-pressed="true"` at once, so nothing marks the
  active choice.
- The seating toast says "Масата е отворена за телефони" (singular) after opening two tables.
- "Места по резервации 42" sums all six party sizes including the cancelled booking;
  "Записани 6" also counts the cancelled one that is listed separately as "Отказани 1".
- A guest card's recent booking reads "6 гости · 2" — the bare "2" is the table, with no word
  before it, where the list view writes "място 22".
- Four of the nine sidebar items are the word "Настройки", told apart only by their section
  heading.
- Guest pages keep the bill and card icons in the header after the night has ended.
- The menu name truncates to "Club Bi..." in the Studio on a phone, squeezed by its chip.
- Order codes mix alphabets — ГЩЦ and ЕБН beside QCF — on the same screen.
- `/settings/deleted` and `?tab=settings&section=versions` are not the real slugs
  (`deleted-venues`, `versioning`); the first 404s with the raw unstyled Next.js page, in
  English, with no way back.
- Next.js 16.4.3's own CLI reports a known security advisory for this version on every start.

---

## 7. The demo-setup instructions need three additions

Each of these cost this walk real time and would cost the same on Martin's own run-through.

1. **`.env.local` has no `BARSY_ENV`.** Without it the simulated POS is hidden from
   `/settings/integrations` — the systems picker shows only barsy and says "Още няма избрана
   система", and the existing `sim` instance gets no settings tab. That is by design
   (`apps/web/src/connectors/server.ts`: `simOffered` allows only `development`, `test`,
   `staging`), but the demo instructions should say to set `BARSY_ENV=development`.
2. **Re-running `pnpm db:seed:demo` overwrites the owner's ordering hours.** The seed is
   idempotent about the night, but it writes `serviceHours` back to 22:00–06:00, silently
   undoing a setting changed through the app.
3. **Once the night is ended, there is no way back except re-seeding.** Tonight deliberately
   disables "Отвори за телефони" on a closed night, and the service day does not roll until
   07:00. Anyone walking the demo should end the night last, or know that `pnpm db:seed:demo`
   is how to reopen tables.

A fourth, smaller note: settings refuse to save 15 minutes after sign-in and ask for the
password again. That is correct and the dialogue is clear — but it opens over whatever dialog
you were in, so a change can look as though it simply did not save. It cost three attempts
here before the password dialogue was noticed.

---

## 8. Corrections

### 8.1 A reported "blank Tonight screen" was a measurement artefact — withdrawn

Earlier in this walk, opening a Tonight view straight from its URL appeared to leave the
screen on "Зареждане..." indefinitely, and that was on its way into this report as a pilot
blocker. **It is not a defect.** The screen renders; `get_page_text` and `main.innerText` were
returning only an `sr-only` live region while the visible content was present. Screenshots —
ground truth — show `?tab=tonight&view=night`, `&view=log` and `&view=actions` all rendered
within three to five seconds of a direct URL load.

What is true is that the same load sometimes took far longer. The server answered in about
1.3 s every time; the delay was in the browser. On this machine that means nothing: it was
running six Next dev servers, four workers and two simulated POS servers at once, and a cold
dev page load pulls roughly 500 unbundled Turbopack chunks. **Nobody should conclude anything
about speed from this walk.** What is worth one measurement on a production build: a Tonight
URL pulls the chunks for Studio, the composer, publishing, settings, the plan editor, tables
and a face, not only Tonight.

### 8.2 "The end-of-night numbers disagree with themselves" — withdrawn as an error

An earlier version of this report called the 0/0 versus 3/1 difference a wrong sum. It is not:
the two numbers mean different things and both are right. See 6.3, where it is recorded as a
wording problem.

### 8.3 "Ending the night leaves no trace on the screen" — narrowed

The actions screen does say it, and the Log has the whole cascade. Only the night panel's own
subtitle is stale. See 6.7.

### 8.4 The POS instance's name is shown to staff — probably right

"2 сметки остават отворени в test POS", "Restro проверява връзката с test POS", "Липсва име
за менюто в test POS", "Бакшиши не се предлагат: test POS...". This is the integration
instance's own display name, which the owner chooses, not a vendor string leaking out of the
connector — rule 3 is not breached. It only reads oddly because the demo's instance is called
"test POS". Worth knowing, not worth a ticket.

---

## 9. Open questions, each with a recommendation

1. **Is the paying part of #539 meant to be in the pilot?** Martin's standing position (11-21)
   is that the pilot runs the full workflow including paying. If sharing a bill by amount is
   part of that, #544 and #545 are on the pilot's critical path and should be scheduled now; if
   it is not, that is a scope cut and should be said out loud rather than assumed. This is the
   one question that changes what happens next.
2. **Does a group payment need to reach the other tables' waiters?** Recommendation: yes — one
   card per table of the group, each saying the party paid, or one card that names every table.
   As it stands a waiter at table 45 has no record that it was settled (6.4). #545 is the
   natural home.
3. **Does 6.1 get fixed inside this merge or in the next cycle?** Recommendation: next cycle,
   with the rest of section 6 — it is not a blocker by the standard set for this walk, and
   holding the merge for it buys nothing.
4. **Should the demo-setup instructions be updated now?** Recommendation: yes, before Martin's
   own run-through. Section 7 is three lines of documentation.

---

## 10. Out-of-scope observations

- Zooming the floor plan costs a server round-trip per step (6.2). Worth one look at whether
  the zoom needs the server at all.
- A `pg` deprecation warning — "Calling client.query() when the client is already executing a
  query" — appears in the web server console during ordinary use. Harmless today; it will be
  an error in `pg@9`.
- `service_days` holds no row for this night although it was closed and `night.closed` is in
  the Log. Worth one check that the row is written where it is expected to be.
- Screenshots from this walk are in the session scratchpad, not in the repository (11-24).
  Everything they showed is in the words above.
