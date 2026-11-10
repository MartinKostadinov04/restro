# The merged branch, walked end to end: what is wrong and how badly

> Filed 2026-11-10 by the walk agent, for issue #387 (the agent pass; the designer pass is #349).
> Walked: `or/foundation` at `7273e82a` — ordering (#64), paying (#102) and reservations part 1
> (#321) together for the first time. Walked on the shared local app at `http://localhost:3200`
> (Demo Bar, the simulated POS, the simulated card provider), in Bulgarian, as three people in
> turn: the owner setting up, the staff on the night, the guest on the phone.
> Screenshots of everything visual below are in the `walk-2026-11-10-screens` folder beside this
> session's notes.

**How to read this.** Every point says the screen, what happens, what I expected, how to see it
again in one line, and how bad it is. **Blocking** = wrong figures, lost money, a dead end, or one
of the rules in `CLAUDE.md` broken. **Before the pilot** = it works, but it is confusing, slow, too
many taps, or the wrong word. **Polish** = a small ugliness. Where a point is my opinion about
design rather than a fault, it says so.

**Counts: 3 blocking, 16 before the pilot, 8 polish.**

The three worst: a real venue's guests cannot order at all (B1); reservations cannot be used at all,
because no venue can get a floor plan (B2); and the door tells the hostess a table was opened for
phones when none was (B3).

Two things I could not reach, and why, are at the end.

---

## Blocking

### B1. On the only template a venue can choose, the guest can do nothing but read the menu

**Screen:** the guest's phone, any venue on the "Редакционен пазар" template.

**What happens.** I switched Demo Bar from the hidden test template to "Редакционен пазар" — the
only one the composer offers — and published ("Версия 2 е на живо"). All four guest features were
on and stayed on: "Повикване на сервитьор", "Показване на сметката на масата", "Поръчка от
телефона", "Плащане от телефона". The table was open for phones and the phone showed its badge
("Маса 1"). The guest page then had **no "Добави", no bag, no bill, no waiter call and no pay** —
anywhere. Tapping an item opens a dish page that is nearly empty: the back arrow sits on top of the
title, the price, and then black space (screenshot 04). The composer's own "Преглед на услугите за
гостите" draws the bag correctly ("Сметка · 22,30 €") with made-up data, so the template can do it;
the live guest page simply is not given the services.

**Why.** `apps/web/src/guest/use-table-services.ts` binds the services for one template only —
`SHARED_ORDER_FACES = new Set(['qr-phone'])` — and `qr-phone` is the technical test template, which
`apps/web/src/faces/registry.ts` hides from venues.

**What I expected.** The template a venue can actually pick draws the bag, the bill, the waiter call
and paying, since the owner switched them on and published.

**Repro.** Demo Bar › Композитор › Дизайн › Смени › "Използвай този шаблон" › Публикувай, then open
the guest page at a table that is open for phones.

**This is already known, and it is not a regression.** The ordering acceptance guide
(`2026-10-30-ordering-acceptance-walk.md`) says it in its own words: "A real venue can't order yet:
the templates venues get don't draw the shared order until the menu designer's renderer (#239,
#171)." That work is on `st/foundation`, not on this branch. I am filing it as blocking anyway,
because it is the one thing that decides whether this branch can be put in front of a club: as it
stands, everything ordering and paying built is reachable only through a template no venue can
choose. Nothing here should be accepted as "a guest can order" until #239 and #171 land and this is
walked again.

### B2. Reservations cannot be used, because no venue can get a floor plan

**Screen:** Резервации › План, and Настройки › Резервации › Места.

**What happens.** План says *"Екипът на Restro рисува плана ти. Пиши ни с плана на залата."* — with
no address, no link, no button. Настройки › Резервации ends with *"Места — Местата се появяват тук,
след като планът на залата е готов."* (screenshot 08). In "Нова резервация", "Места" says *"Още без
място"* and offers both "Избери от списъка" and "Избери от плана"; both lead to the same nothing.
"Смени масите" on a booking says *"Докосни местата…"* with nothing to touch.

Nothing in the product creates a plan. The only code that makes one is a test fixture
(`apps/web/e2e/reservations-state.ts`) that writes straight into the database with the owner role,
for one e2e venue. The ticket's own note says part 1 ships no plan editor.

**What I expected.** Either a way for the venue to lay out its spots, or a screen that says plainly
what to send and to whom (an address, a form) — and screens that do not offer "Избери от плана" when
there can be no plan.

**Repro.** Demo Bar › Резервации › План.

**What this costs.** A booking can be taken and the party marked present, but it can never be put on
a spot. So: no table opens for phones from the door, a party's pay rule never reaches a table,
"Смени масите" does nothing, and Tonight never shows a booking against a table. Everything the
reservations spec built past the list is unreachable on a real venue. Even with B1 fixed, a club
could not run a night on this.

### B3. The door says a table was opened for phones when no table was opened

**Screen:** Резервации › Списък › a booking › "Настани" (the door).

**What happens.** I seated Иван Петров, a booking with no spot ("Места — Още няма"). The toast said
*"Иван Петров е настанена. Масата е отворена за телефони."* No table was opened — Тази вечер still
read *"0 от 16 са отворени за телефони"* at that moment, and the booking still had no spot
afterwards.

**Why.** `apps/web/src/reservations/door-actions.tsx` picks the toast before the write and never
looks at what came back: with a reservation and no spot it always uses
*"{party} е настанена. Масата е отворена за телефони."*

**What I expected.** With no spot: "Настанена. Още няма маса." — or the seating refused, with a
reason. The staff word must never claim a table is open when it is not; a hostess who believes it
sends guests to scan a code that will not work.

**Repro.** Резервации › Списък › a booking with no spot › Настани.

---

## Before the pilot

### P1. The payment tables are counted and drawn as if they were real tables

**Screen:** Тази вечер › Действия и маси; Маси и QR.

Demo Bar's POS has four "payment tables" (Маса PM1, PM2, PU1, PU2) that exist only to carry part
payments. Tonight draws them in the grid next to the real ones, greyed and marked *"Затворена"*, and
counts them: *"12 от 16 са отворени за телефони"*, and Маси и QR says *"16 маси, 12 с код"*. A
manager reads that as four tables somebody forgot to open. The print sheet already gets it right —
*"12 кода на 2 страници"* — so the right number is known somewhere.

**Expected:** the counts and the grid are about tables guests sit at; payment tables sit in their
own small group or are left out. **Repro:** Demo Bar › Тази вечер.

### P2. "Отвори всички" reports more tables than it opened

**Screen:** Тази вечер › Действия и маси › "Отвори всички".

The toast says *"Отворени са 16 маси за телефони"* while the line right beside it says *"12 от 16 са
отворени за телефони"* (screenshot 01). The four payment tables were skipped, correctly — the number
in the toast is simply every tile on the screen, not what was opened.
`packages/core/src/service/sittings.ts` already returns `{ opened, alreadyOpen, skipped }`; the
screen ignores it and counts tiles (`apps/web/src/tonight/tonight-panel.tsx`).

**Expected:** "Отворени са 12 маси за телефони", and a word about the ones skipped.
**Repro:** close all tables, then "Отвори всички".

### P3. The composer tells the owner that ordering and paying are not connected yet

**Screen:** Композитор › Дизайн › Функции за гостите.

Under every switch: *"Гостите ще видят това, когато поръчките бъдат свързани (етап 4)."* and, under
paying, *"…когато плащанията бъдат свързани (етап 5)."* (screenshot 03). Both lines are printed
always, whatever the venue's state. On this branch ordering works — I ordered and the round reached
the bill — so the owner is told the opposite of the truth.

**Expected:** the line appears only while that part really is not connected for this venue, and says
what is missing. **Repro:** Demo Bar › Композитор › Дизайн, scroll to "Функции за гостите".

### P4. The reservations screens ask for American dates and 12-hour times in a Bulgarian interface

**Screen:** Резервации (the day picker), "Нова резервация", the opening-hours dialog.

The board's day reads *"11/10/2026"*; "Нова резервация" offers *"От 09:30 PM"* and *"До --:-- --"*
(screenshot 07); the hours dialog shows *"06:00 PM"*, *"05:30 AM"*. The saved rows are right: the
guest record says *"10 ноември · 22:00"*, Работно време says *"18:00 – 06:00 (на сутринта)"*. So
Restro knows how to write a Bulgarian time; only the fields a hostess types into do not. They are
the browser's own date and time controls, taking the machine's locale.

**Expected:** 24-hour times and a Bulgarian date everywhere a hostess types one. A club that opens
at 18:00 and closes at 06:00 should never have to think about AM and PM.
**Repro:** Резервации › Нова резервация.

### P5. The POS's name is missing from a sentence in Settings

**Screen:** Настройки › Работно време › Преди отваряне.

*"От 2 ч преди отваряне Restro проверява връзката с **на** всеки 10 мин; ако още не работи 30 мин
преди отваряне, получавате известие."* (screenshot 06). The name of the POS should stand between
"с" and "на". The sentence has the right placeholder; the screen that draws it sits outside the
provider that fills it (`apps/web/src/settings/hours-panel.tsx` calls `useTillLabel()`, which only
the composer and the item sheet provide), so it comes out empty.

**Expected:** "…проверява връзката с test POS на всеки 10 мин…". **Repro:** Demo Bar › Настройки ›
Работно време.

### P6. Every table claims a pay-first rule on a venue where nothing is pay-first

**Screen:** Тази вечер › a table › the sheet.

Each table's sheet carries *"Плащане преди поръчка · правилото на клуба"*, on a venue where no
pay-first rule was ever set. The default settings say `applies: true`, which means only *"pay-first
is allowed here"*, and the sheet reads it as *"pay-first is in force here"*
(`apps/web/src/tonight/table-sheet.tsx`, `packages/core/src/pay-first-settings.ts`).

**Expected:** no line at all while the club's rule is "everything on the bill"; the line only when
somebody really set pay first. As it is, a waiter reading the sheet would ask a guest to pay up
front for no reason. **Repro:** Тази вечер › tap any table.

### P7. A man is told he "е настанена"

**Screen:** the door's toast.

*"Иван Петров е настанена."* The badge on the booking row — "Настанена" — is fine, because it
describes the резервация. The toast is not: it puts a person's name in front of a feminine verb.

**Expected:** a sentence that does not have to agree with a name: "Настанихме Иван Петров." or
"Компанията на Иван Петров е настанена." **Repro:** seat any booking with a man's name.

### P8. "Идвал 1 пъти, не е идвал 0 пъти"

**Screen:** Резервации › Гости › a guest.

The line reads *"Идвал 1 пъти, не е идвал 0 пъти, в твоя клуб."* It should be "1 път". Bulgarian
plurals are not handled here, although they are elsewhere (the Log has "{n, plural, one {# право}
other {# права}}").

**Expected:** "Идвал 1 път, не е идвал нито веднъж." **Repro:** Резервации › Гости › Иван Петров.

### P9. The Log hides which table's code was shown, and how many

**Screen:** Тази вечер › Дневник.

Three entries read *"Показан код за масата"* with no table (screenshot 12), next to entries that do
name one (*"Маса 9 е отворена за телефони · Маса 9 · Demo Owner"*). Showing all twelve codes at once
writes one line that names no table and no number, because the write only carries a table id when
exactly one table was revealed (`packages/core/src/service/table-codes.ts`).

**Expected:** "Показани кодове за 12 маси" for the whole sheet, "Показан код за Маса 7" for one. A
manager checking who revealed what cannot do it today.
**Repro:** Маси и QR › show the codes, then Тази вечер › Дневник.

### P10. The night's end says nothing about reservations

**Screen:** Тази вечер › Край на вечерта.

"Общо" has fourteen rows — tables opened, orders sent, money added, calls, pauses, alerts, payments,
tips, held money (screenshot 11). Not one is about bookings. After a night with two bookings on the
board, the night's summary does not mention them.

**Expected:** bookings for the night, how many were seated, how many never came, how many walk-ins
were given a place. This is the hostess's and the owner's number for the night.
**Repro:** Тази вечер › Край на вечерта.

### P11. The guest's phone opens in English at a Bulgarian club

**Screen:** the guest's phone.

Scanning a table code at Demo Bar opens the menu in English — "Table 1", "Cocktails", "NEW" — with
BG/EN at the top. Picking БГ works, but scanning another table's code starts again in English.

**My opinion, not a fault:** the venue's own language should win, and the guest's choice should
stick across that venue's tables. A club in Sofia whose guests get an English menu reads as somebody
else's product. **Repro:** open a table code in a clean browser.

### P12. Every item on the menu is badged "Ново"

**Screen:** the guest's phone, and the composer's preview.

All twenty-eight items carry *"Ново"*. A badge every item has says nothing.

**My opinion:** either the badge ages out (new for a week after the item first appears), or the demo
data stops marking everything new. Worth settling before a club sees it.
**Repro:** open the guest page.

### P13. The guest sheet ends with two "Затвори" buttons, and repeats the name

**Screen:** Резервации › Гости › a guest.

The sheet reads: "Резервирай маса / Редактирай / Още / **Затвори** / **Затвори**". The guest's name
is also printed twice at the top. One of the two is the corner X's label, but on the screen they
read as two identical buttons.

**Expected:** one close, one name. **Repro:** Резервации › Гости › tap a guest.

### P14. The dish page on the real template is almost empty

**Screen:** the guest's phone, "Редакционен пазар", tap an item.

Title, price, a large black area where a photo would be, a white band repeating the name, then more
black (screenshot 04). No description, no allergens, no "Добави". The back arrow overlaps the title.

Partly B1 (no "Добави", because the services are not bound) and partly the template: with no photo
the page has nothing to show. **Expected:** a dish page that still works without a photo, and a back
arrow that does not sit on the title. **Repro:** switch Demo Bar to "Редакционен пазар", publish,
tap an item.

### P15. The bill's freshness line argues with the message beside it

**Screen:** the guest's phone, the bill, right after sending a round.

The screen confirms the round was added and at the same moment the bill reads *"Updated 6 s ago"*
over a total that does not include it. The total catches up within half a minute or so.

**Expected:** while a sent round has not reached the bill, the bill says so ("Чака в сметката")
rather than presenting a stale total as fresh. **Repro:** send a round and watch the bill.

### P16. "Добави компания" does not say that it adds to the waiting list

**Screen:** Резервации › Списък › "Добави компания".

The button sits beside "Нова резервация" and reads as "add a party". The dialog explains itself —
*"Чакат от сега. Дай им място, щом се освободи."* — but only once it is open (screenshot 10). In
`GLOSSARY.md` these people are the **списък на чакащите**.

**Expected:** a button that says what it does, e.g. "Добави в чакащите". **Repro:** Резервации ›
Списък.

---

## Polish

### S1. Two words for the same thing, one under the other

"Добави компания" asks for *"Име (по избор)"* and, on the next line, *"Телефон (по желание)"*. Pick
one. (Screenshot 10.)

### S2. An address Restro does not understand hangs, or goes somewhere else

`?tab=settings&section=orders` quietly shows Общи instead; `?tab=tonight&view=nonsense` sits on
*"Зареждане…"* for ever. Expected: an unknown part falls back to the first one, and nothing waits
for ever.

### S3. While the codes load, Маси и QR says there are none

For a second or two the test-link box reads *"Първо създайте код за маса, после тествайте линка."*
on a venue with twelve codes, then fills in. Expected: the quiet loading state, not a wrong sentence.

### S4. Tonight's tables need sideways scrolling on a laptop

At 1200 px wide the table grid has its own horizontal scrollbar and the last column is cut off.
Expected: the tables wrap. This is the screen staff look at all night.

### S5. Swapping the template is announced as "colours and logo"

The publish dialog sums up a template change as *"Извън артикулите — Външният вид на менюто (цветове,
лого)"*. Changing the template is the largest change the guest page can have; it should be named.

### S6. The composer's live preview is cut off on a laptop

At 1200 px the right-hand preview column is clipped: the phone's frame runs off the right edge and
its bottom bar — where the bag sits — is below the fold, so the owner cannot see the thing the
preview exists to show.

### S7. The category strip does not follow the menu back up

Scrolling the guest menu up again leaves "Шотове и уиски" underlined while "Коктейли" is on screen.

### S8. Still there from the designer walk (#349)

- **B13:** the red spot warning stays after the location check is switched off.
- **B9:** "Собственик · 0 души".
- **B8:** the venues list says "Simulated POS"; inside the venue it is "test POS".

---

## What I could not reach, and why

1. **Paying.** The shared app's worker runs without `WORKER_PAYMENTS_SIM=on`, so the simulated
   provider is never registered and the worker's `/internal/payments/connection` answers 404. In the
   app this shows as *"Test card payments не се отвори. Проверете връзката и натиснете отново."* —
   which sends the owner to check a connection that cannot help, because the switch is in the
   environment, not in Restro. The paying acceptance guide's "Before you start" lists the paying
   `.env.local` lines but not this one. I could not set it myself: I must not touch that folder.
   **Recommendation:** add `WORKER_PAYMENTS_SIM=on` to the paying guide's step 7, and make the error
   say when the provider is simply not switched on in this environment.

2. **Anything that needs a floor plan** — seating a party on a spot, moving a party between tables,
   a table that has both a booking and an open bill, a party moved while a round is unsent, the
   night ending with a table still paying. Those are exactly the seams #387 asks about, and B2
   closes all of them. **Recommendation:** before the next walk, seed the walk environment with a
   floor plan the way `apps/web/e2e/reservations-state.ts` does for the e2e venue, or build the
   smallest plan editor.

**One thing I changed and could not change back.** To see the guest flow on a real template I
switched Demo Bar (the shared walk app on port 3200, database `restro_walk_all`) from the hidden
test template to "Редакционен пазар" and published it. The composer offers no way back, because the
test template is hidden from venues. Re-running `pnpm db:seed:dev` on that database puts it back.
Nothing else in the walk changed data beyond ordinary use: two bookings, one walk-in, a few rounds,
and opening and closing the tables.
