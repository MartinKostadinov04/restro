# Acceptance walk: ordering, paying and reservations on `or/acceptance`

2026-11-25. One walk over everything, as Martin asked on 11-10: ordering, paying and
reservations in a single pass, not three reviews. Walked by an agent session on branch
`or/acceptance` at `97e23c52` ("Merge or/foundation into main for acceptance", the head of
draft PR #554), against the demo venue **Club Biad Sofia** (79 tables, source `test POS`),
the simulated POS (`sim-pos`, scenario `club-biad`) and the simulated payment provider
(`sim-pay`, `WORKER_PAYMENTS_SIM=on`). No live key, no real card, no live venue's POS.

This is a report, not a repair. Nothing in product code was changed.

---

## 1. The verdict

**Yes — this branch is good enough to put in front of a club, once one blocking defect is
fixed.** A guest ordered from a phone onto the table's bill, saw the group's bill across two
tables, paid 54,00 € for both tables in one card payment, and got a payment number the
waiter can act on. Staff saw the order arrive, saw the note to carry, read a night's
arithmetic that reconciles against what was ordered and paid, and ended the night with a
careful, honest dialogue. Reservations took a booking over two places, warned sensibly about
seats, seated the party, handled a walk-in from the waiting list and resolved every booking
when the night closed. The venue Log carries the whole chain with actor, table and time.

The one blocker is small and mechanical: **every door dialogue that should name a table names
nothing** (section 4.1). It is one query and one fallback.

What the walk could *not* reach is more important than what it found: **the paying part of
spec #539 is not finished on this branch** (section 5).

### Three things worth Martin's own eyes

1. **The door dialogues with no table name** (4.1) — the hostess is told "⟨nothing⟩ still has
   an open bill" on a club with 79 numbered tables.
2. **The end-of-night numbers disagree with themselves** (4.2) — the night panel says
   "Не дошли 0 / Неседнали 0" while the close-the-night dialogue, on the same screen at the
   same moment, says "Не дошли: 3 / Неседнали: 1".
3. **The floor plan can never be fitted into its box** (4.3) — on a 79-spot room, staff can
   never see the whole floor at once, and at the smallest zoom 99 spots are unlabelled dots.

---

## 2. How it was walked, and what that limits

| | |
|---|---|
| Branch | `or/acceptance` @ `97e23c52` |
| Web app | Next.js 16.4.3 dev build (Turbopack), port 3500 |
| Database | local Postgres on 54329, database `restro_accept` |
| POS | `sim-pos`, scenario `club-biad`, port 4510 |
| Payments | `sim-pay`, account `simpay_club_biad`, `WORKER_PAYMENTS_SIM_CARD=accept` |
| Signed in as | `owner@club-biad.test` (Мартин, собственик) |
| Guest phones | two tabs at 375×812, table 17 and table 45 |

**One setup change was made, and nothing else.** The demo venue only takes orders between
22:00 and 06:00; the walk ran in the afternoon. Wednesday's ordering hours were changed from
22:00 to 10:00 so a guest could order at all. It is recorded in the venue Log like any other
setting change. No seed file and no product code was touched.

**What this environment cannot settle.** The walk ran on a development build, on a machine
that was at the same time running five other Restro dev servers, four workers and two
simulated POS servers. Page load times here mean nothing (section 6.1). A production build on
a quiet machine is still owed.

---

## 3. What holds

### Guest, on a phone

- The QR page opens on the venue's menu with the table named in the header ("Маса 17"), a
  language switch, a bill icon and a card icon.
- Ordering onto the table's bill works on both tables. The order reaches the bar and appears
  in Tonight.
- **The group's bill works** (#319). A party booked over spots for tables 17 and 45 and
  marked present forms one linked group; a phone at table 17 sees "Сметката на групата" with
  both tables' lines grouped by table and one total — 15,00 € + 39,00 € = 54,00 €.
- **One payment over several tables of a linked group works** (#542, D160 §3). The pay sheet
  names the provider, the payment went through, and the guest got "✓ Платено", the payment
  number **9R9F7**, the five paid lines, "Общо 54,00 €" and "Покажете този номер на
  сервитьора. Сервитьорът ще ви донесе касовата бележка."
- **The receipt survives a reload** — the paid state is read back from the server, not kept
  locally (D72).
- The second phone, at table 45, saw every line marked "Плаща се" while the first was paying.
- After the night ended, the menu says plainly: "Тази маса не е отворена за поръчки от
  телефон. Попитайте сервитьор."

### Staff, on Tonight

- Orders arrive on "Действия и маси"; "Чака вас" counts what needs a person.
- After a phone payment the waiter gets a card: "Занесете бележката — Маса 17: платено от
  телефона с реф. 9R9F7, 54,00 €. Бележка 0000002", with one button, "Занесена". Marking it
  done gives a toast with "Върни".
- The empty state is good: "Нищо не чака. Обажданията на масите и сигналите за пари се
  появяват тук."
- **The night's arithmetic reconciles.** Записани 6 · Без резервация 2 · Дошли 3 ·
  Места по резервации 42 · Седнали гости 18. Общо: отваряния на маси за телефони 11 ·
  изпратени поръчки 3 · добавени в сметките 3 · сума, добавена в сметките 135,00 € ·
  неизпратени 0 · непотвърдени 0 · повиквания на сервитьор 2 · паузи 1. Плащания 2 ·
  таксувани плащания с карта 169,50 € · плащания без потвърждение 0 · задържано 0,00 €.
  That matches what was ordered and paid during the walk plus the seeded bill.
- **The venue Log is the strongest part of the build.** Every step of the group payment is
  there in order and in plain Bulgarian: lines moved to a payment table → the last check →
  the bill closed → the card charged → the payment table released → both tables closed for
  phones — each with its actor (`Restro` for the worker, "Мартин (собственик)" for a person)
  and its table. Filters by kind and by night, and a CSV download.
- **Ending the night asks an honest question** before it acts: "Да приключим ли вечерта сега?
  След това нито един телефон не може да поръчва.", with the counts, a warning that the club
  closes at 06:00 and it is only 13:16, and two buttons where the destructive one is named
  for what it does ("Приключи вечерта по-рано"), not "OK".
- Ending the night then does the whole cascade and records it: five tables closed for phones,
  bookings resolved as приключена / неявила се / ненастанена, and the close itself —
  "Мартин (собственик) приключи вечерта по-рано · още отворени сметки: 2".

### Reservations

- The list has state filters with live counts.
- Booking a party over two places warns well: "9 гости при 8 седящи. Може да запазите и така."
  — it states the problem and leaves the decision with the hostess.
- Seating gives an undo toast.
- A walk-in from the waiting list can be seated on a chosen spot and is then listed as
  "Без резервация · Настанена" with "Върни".
- The Гости view has search, state tabs (Всички 8 / Редовни клиенти 1 / Архивирани 0) and a
  guest card with visits, no-shows and recent bookings — and it is careful about what the
  number means: "Приблизителна бройка за хостесата, не запис за пари."

### Navigation (D161)

- The venue sidebar carries every screen: Меню (Студио, Маси и QR), Поръчки (Тази вечер,
  Настройки), Резервации (Резервации, Настройки), Заведение (Настройки), Организация
  (Настройки). **Nothing is left reachable only by the old tabs.**
- The venue switcher at the top of the sidebar opens with the current venue ticked, "Всички
  заведения" and "Ново заведение". At organisation level the sidebar correctly drops the
  venue sections.
- **The phone's ☰ works properly**: a drawer with the venue switcher, all five sections, the
  current item highlighted, and it navigates and closes. The Tonight tab row becomes a
  dropdown on a phone, and the cards stay readable at 375 px.
- Settings keep their own sub-tabs inside the screen (Общи / Персонал и роли /
  Синхронизиране / Версии; Работно време / Поръчки / Плащане / Известия) — a screen's own
  sections, not orphan destinations.
- The payment settings screen answers a question the walk raised: tips show 0,00 € because
  **tips are deliberately not offered** — "Бакшиши не се предлагат: test POS още не може да
  го добави в същата касова бележка." That is an explanation, not a gap.

---

## 4. What does not hold

### 4.1 Blocks the pilot — every door dialogue names no table

**What I did.** Seated parties and used the door actions that warn about a table's state.

**What I expected.** "Маса 22 все още има отворена сметка."

**What happened.** " все още има отворена сметка." — the table's name is an empty string, so
the sentence begins with a space.

**Why.** `packages/core/src/service/reservations/arrive-checks.ts:141` selects only
`venueTables.name`; line 149 stores `row.tableName ?? ''` and line 292 reads it back with
another `?? ''`. `name` is nullable by design — `packages/db/src/schema.ts:1192` says "Our
name for it, or null (guests then see `number`)" and `number` is "null only when `name` is
set". **All 79 tables of the demo venue have a number and no name**, which the schema treats
as the normal case, so the name is always empty. The floor plan does it correctly:
`plan-read.ts:541` falls back `row.tableName ?? row.tableNumber ?? row.name`.

**Where it shows.** `apps/web/messages/bg.json:2874` (`d_bill_t`) and `:2878` (`d_free_t`),
rendered at `apps/web/src/reservations/door-actions.tsx:395` and `:406` and
`apps/web/src/reservations/change-tables.tsx:499`.

**Why it blocks.** A hostess at the door of a 79-table club is told that some table still has
an open bill and is not told which one. Every venue that labels its tables by number — which
is every venue the schema expects — sees this on every such dialogue.

### 4.2 Ugly but usable — the end-of-night numbers disagree with themselves

The night panel reports **Не дошли 0 · Неседнали 0 · Дял на неидването 0%**. The
close-the-night dialogue, opened from that same screen at that same moment, reports
**Не дошли: 3 · Неседнали: 1**. Both are on screen within one click of each other. A manager
closing the night cannot tell which number to believe. (The dialogue's numbers match what the
Log then records: three "Резервация: неявила се", one "ненастанена".)

### 4.3 Ugly but usable — the floor plan cannot be fitted into its box

The plan's viewport is `h-[60vh]` — 540 px tall at 1440×900. At 1:1 the room is 1103×1252.
**"Покажи целия план" does not fit the plan**: it resets the transform to identity (scale 1),
leaving more than half the room off-screen. Zooming out with "−" bottoms out at about 0.6×,
where the room is 662×751 — still 1.4× taller than its pane — and the button stays enabled
while doing nothing further. At that zoom **99 spots render as unlabelled circles under
30 px**; their names exist only as `aria-label`. So there is no zoom at which a person can
see the whole room, and no zoom at which the small spots are identifiable.

Two smaller things on the same screen: the plan canvas swallows the mouse wheel, so the page
below it cannot be scrolled with a wheel while the pointer is over the plan (and the plan box
runs past the bottom of the window); and each zoom step fires a `floorPlanAction` server
round-trip — fourteen clicks produced twenty POSTs.

### 4.4 Ugly but usable — a group payment is presented as belonging to one table

The payment covered tables 17 and 45. The guest's receipt is headed "Маса 17" and lists all
five lines with no indication that two tables were paid. The waiter's card in Tonight is
likewise headed "Маса 17" only — **the guests at table 45 get no slip at all**, so a waiter
working that table has nothing telling them it is settled. After the payment, the phone at
table 45 falls back to "Все още няма поръчки." instead of saying the bill was paid.

### 4.5 Ugly but usable — a second guest paying is not told why he cannot

While one phone was paying, a guest on the other phone who tapped Pay got a sheet with
nothing selectable and the hint "Изберете поне един ред." He is never told that his table is
already being paid.

### 4.6 Ugly but usable — the place picker and the door contradict each other

The reservation place picker marks a spot "Свободно" while seating on that same spot warns
that its bill is still open. Two meanings of "free" on one screen.

### 4.7 Ugly but usable — ending the night leaves no trace on the screen

After "Приключи вечерта по-рано" the dialogue closes, the button disappears, and nothing
says the night was ended. The line above still reads "Досега тази вечер · вечерта приключва
в 07:00", which is now untrue. The Log has it; the screen does not.

### 4.8 Cosmetic

- A ticked line in the pay sheet is a filled grey square with no checkmark; ticked and
  unticked differ only by fill, in a dark theme, on a phone.
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
- The menu name truncates to "Club Bi…" in the Studio on a phone, squeezed by its chip.
- Next.js 16.4.3's own CLI reports a known security advisory for this version on every start.

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
outline on the plan, and the waiter's card named one table (4.4).

**Switching between venues** could not be exercised: the demo has one venue, so only the
switcher's shape could be checked, not the switch.

---

## 6. Corrections, and what this environment could not judge

### 6.1 A reported "blank Tonight screen" was a measurement artefact — withdrawn

Earlier in this walk, opening a Tonight view straight from its URL appeared to leave the
screen on "Зареждане…" indefinitely, and that was on its way into this report as a pilot
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

### 6.2 The POS instance's name is shown to staff — probably right

"2 сметки остават отворени в test POS", "Restro проверява връзката с test POS", "Липсва име
за менюто в test POS", "Бакшиши не се предлагат: test POS…". This is the integration
instance's own display name, which the owner chooses, not a vendor string leaking out of the
connector — rule 3 is not breached. It only reads oddly because the demo's instance is called
"test POS". Worth knowing, not worth a ticket.

### 6.3 Not a defect: no tip step

See section 3 — the payment settings screen states the reason.

---

## 7. Open questions, each with a recommendation

1. **Does the walk's blocker get fixed before the merge, or after?** Recommendation: before.
   4.1 is one query and one fallback in `arrive-checks.ts`, mirroring `plan-read.ts:541`, plus
   a test that a numbered table renders its number. It is smaller than the risk of a hostess
   seating a party on an occupied table at the pilot.
2. **Which number is right in 4.2?** Recommendation: the dialogue's, because the Log agrees
   with it. The night panel should count the same way, and one of the two should be renamed
   if they are genuinely measuring different things.
3. **Is the paying part of #539 meant to be in the pilot?** Martin's standing position
   (11-21) is that the pilot runs the full workflow including paying. If sharing by amount is
   part of that, #544 and #545 are on the pilot's critical path and should be scheduled now;
   if it is not, that is a scope cut and should be said out loud rather than assumed.
4. **Does a group payment need to reach the other tables' waiters?** Recommendation: yes —
   one card per table of the group, each saying the party paid, or one card that names every
   table. As it stands a waiter at table 45 has no record that it was settled (4.4).

---

## 8. Out-of-scope observations

- Zooming the floor plan costs a server round-trip per step (4.3). Worth one look at whether
  the zoom needs the server at all.
- A `pg` deprecation warning — "Calling client.query() when the client is already executing a
  query" — appears in the web server console during ordinary use. Harmless today; it will be
  an error in `pg@9`.
- Screenshots from this walk are in the session scratchpad, not in the repository (11-24).
  Everything they showed is in the words above.
