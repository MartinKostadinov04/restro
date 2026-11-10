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

**Counts: 5 blocking, 25 before the pilot, 10 polish.**

The three worst: a real venue's guests cannot order at all (B1); paying cannot be connected at all, so
nothing about paying has ever been walked by a person (B4); and reservations ship no way for a venue to
get a floor plan (B2) — I had to write a script against the service write path to walk them, which is
itself a finding (P18).

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

### B4. Paying cannot be set up at all, so nothing about paying has ever been walked by a person

**Screen:** Demo Bar › Настройки › Плащане.

**What happens.** The section itself is well made: *"Гостите плащат сметката си с карта от телефона.
Парите отиват направо в сметката на заведението в Test card payments."*, the checklist *"Преди да
започне плащането с карта"*, the smallest card payment, the tips line and the venue's legal details.
Press **"Свържи Test card payments"**, confirm the password, and the browser leaves for
`https://connect.sim-pay.test/onboard/<ref>` — a host that does not exist. The owner lands on the
browser's own error page. Coming back by hand to the address the provider is supposed to return to,
the section says *"Свързването още не е завършено в Test card payments."* and offers *"Продължи в
Test card payments"*, which leaves for the same dead address. There is no way out of the loop.

**Why.** The simulated provider always answers with that address
(`packages/payments/sim-pay/src/engine.ts:384`) and nothing rewrites it
(`apps/worker/src/payments/connection.ts:154`). The only code that ever had a connected simulated
account is the end-to-end harness, which builds the account inside its own process and never goes
near the owner's screen (`apps/worker/src/e2e/pay-harness.ts`, its own opening comment). The one
step a real owner must take has no working stand-in outside CI.

**What I expected.** The paying acceptance guide promises exactly that: *"**Connect:** with the
simulated provider it connects at once ("Connected: …")"* (`2026-10-30-paying-acceptance-walk.md`,
section A). It does not.

**What it costs.** Everything downstream is unreachable by hand: the guest's pay screen, the tip, the
card form, the receipt, the payment lines on Tonight, the night's end with a table still paying, and
every refusal in the guide's section F. The guest's phone shows the honest end of it — the bill is
drawn, and under it *"За да платите, попитайте сервитьора."*, because the venue has no provider
connected. Nobody, Martin included, can accept paying until this is fixed.

**Repro.** Demo Bar › Настройки › Плащане › "Свържи Test card payments" › password.

**Recommendation.** Give the simulated provider a form inside the app — a plain page on the dev
server that says it stands for the provider's form, with a "Done" button that returns to
`?connection=return` — or let `pnpm` mark the simulated account onboarded the way the harness does.
Either way, fix the guide's section A, which today states the opposite of what the build does.

**Judgement call on severity:** in production Stripe returns a real address, so this blocks accepting
the work rather than the pilot itself. I am filing it as blocking because nothing about paying can be
believed until a person has walked it once.

### B5. A tab opened by its own address shows an empty page — including the address the card provider returns the owner to

**Screen:** any `/venues/<id>?tab=…` address typed, bookmarked, or arrived at from outside.

**What happens.** Clicking the tabs inside the app works. Arriving at the same address directly does
not: the right tab is selected (`aria-selected="true"` on both Настройки and Плащане) and its panel is
on screen, but the panel's content never arrives — zero characters, still zero after twenty seconds
and after a reload. The page shows the venue header and the tab strip over a blank area.
`?tab=tonight` and `?tab=reservations` do the same, stuck on their skeletons; the content is in the
HTML the server sent, stranded in a hidden `<div>` the client never swaps in.

**Why this is worse than an awkward bookmark.** The address the card provider returns the owner to is
exactly this kind of address — `/venues/<id>?tab=settings&section=paying&connection=return`, built in
`apps/web/src/server/settings/paying-actions.ts`. The owner who finishes at the provider comes back to
a blank page, with no toast and no sign that anything was recorded. The same is true of a bar tablet
that opens Tonight as its home page: the tab strip and nothing else, all night.

**What I expected.** An address the app itself hands to an outside service brings the owner back to
the screen it names.

**Repro.** Open `http://localhost:3200/venues/<id>?tab=tonight` in a fresh tab.

**Caveat, and it matters.** I only had the development server (Turbopack), and Suspense that never
resolves can be a development-only fault. **Check this on a production build before ranking it.** If
it reproduces there, it is the worst thing on this list for staff; if it does not, it is a developer
annoyance and belongs in polish.

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

### P17. The switch that turns paying on in a developer's environment lives in one file, and that file is a test config

**Screen:** none — the environment.

**What happens.** `WORKER_PAYMENTS_SIM` appears exactly once in the repository outside the code that
reads it: `apps/web/playwright.config.ts:96`. It is in no `.env.example`, in no guide, in no script.
Without it the worker never builds the simulated provider, its `/internal/payments/connection`
answers 404, and the owner's screen says *"Test card payments не се отвори. Проверете връзката и
натиснете отново."* — sending them to check a connection that cannot help, because the switch is in
the environment, not in Restro.

**What it means.** Paying works in CI and has never worked for a person following the guide. That is
how B4 stayed invisible.

**Fixed in this pull request:** `.env.example` now carries the line, commented out, in the payments
block, and the paying guide's step 7 names it and says the worker must be restarted.

**Still recommended:** when the provider is simply not switched on in this environment, say that,
instead of blaming the connection.

### P18. A venue's floor plan can only be made by someone writing a script

**Screen:** Резервации › План (B2 is what the hostess sees).

**What happens.** Part 1 ships the commands but no screen: `plan.save`, `spot_kind.save`, `spot.save`
and `spot.set_seats` all exist in `packages/core/src/service/reservations/`, and the service write
path accepts them. Nothing in the product calls them. To walk reservations at all I wrote a throwaway
script against `applyService`. It worked first time — sixteen commands, no refusals — which is the
point: the engine is finished and the way in is missing.

**What I expected.** A supported way for Restro's own team to give a venue its plan, the way
`pnpm sim-pos` is the supported way to play the till.

**Recommendation.** A `pnpm` command beside `sim-pos` that takes a venue and a small file of spots and
sends the same three commands. The exact sequence I used is in the appendix at the end of this file,
so it does not have to be worked out again.

### P19. `pnpm sim-pos` quietly talks to whichever simulator answers first

**Screen:** none — the terminal.

**What happens.** `pnpm sim-pos` defaults to `http://127.0.0.1:4010`
(`packages/connectors/sim-pos/src/cli.ts:29`) and reads no `.env.local`. With two walk environments on
one machine — which is how this walk and the menu designer's walk run side by side — a waiter command
meant for the second environment lands in the first one's simulator, silently and successfully.
Nothing says which simulator answered.

**What I expected.** The command reads its environment's own `SIM_POS_URL`, or at least prints the
address it is about to use.

**Repro.** Start two simulators; run `pnpm sim-pos ops` with no `SIM_POS_URL` set.

### P20. Tonight does not say who is sitting at the table

**Screen:** Тази вечер › Действия и маси › a table.

**What happens.** I seated "Elena Dimitrova · 6 гости" on Маса 1 from the door, and the toast said so.
The table's own sheet in Tonight then reads *"Маса 1 — Main bar · отворена от 21:53 — 2 изпратени
поръчки — Сметка: 40,00 € — Плащане преди поръчка · правилото на клуба"*. No name, no number of
guests, no booking. The list behind it says only *"Отворена"*.

**What I expected.** The waiter looking at a table sees whose booking it is, as the hostess does — the
two screens are about the same table on the same night.

**Repro.** Seat a booking on a table, then open that table in Тази вечер.

### P21. "Смени масите" calls the whole room "Заето", then lets you take any of it anyway

**Screen:** Резервации › a seated booking › Смени масите.

**What happens.** Every spot but one reads *"Заето"* — Маса 2 to Маса 8 and Сепаре 1 to Сепаре 4 — on a
night with two parties in the room. The only *"Свободно"* is the bar. A spot is "Заето" because its
table is open for phones, which after "Отвори всички" is every table in the building. Tapping a "Заето"
spot selects it with no warning at all, and Запази goes through.

**What I expected.** "Заето" to mean a party is there. A table merely open for phones is not occupied;
if the word is kept, taking one should at least say what is being taken.

**Repro.** Тази вечер › "Отвори всички", then Резервации › a seated booking › Смени масите.

### P22. The guest's bill disappears the moment staff move the party

**Screen:** the guest's phone, at the table the party left.

**What happens.** The phone showed *"Сметката на масата"* with four lines and *"За плащане: 40,00 €"*.
The hostess moved the party to Маса 2 — correctly, and with the right warning to staff (see "What held
up well") — and the phone's bill section vanished entirely. What is left is *"Тази маса не приема
поръчки от телефон в момента."* The guest is not told where their 40,00 € went, that it is still on
Маса 1, or that their new table has its own code to scan.

**What I expected.** One line on the phone: the bill stayed with the old table, ask the waiter, or scan
the code on the new one.

**Repro.** Open a table's guest page, send a round, then move that booking to another table.

### P23. "Добави" stays live on a table that takes no orders

**Screen:** the guest's phone, at a table closed for phones.

**What happens.** After the table was closed, every *"Добави"* button stays enabled. Tapping one adds
nothing and says nothing of its own; the only feedback is a sentence further down the page, *"Тази маса
не приема поръчки от телефон в момента."*, which was already there before the tap. A guest taps,
nothing moves, and they tap again.

**What I expected.** The buttons go quiet, or the tap itself says why.

**Repro.** Close a table for phones in Тази вечер, then tap "Добави" on its guest page.

### P24. "Същите гости ли са?" is about the table, and reads as if it were about the guests

**Screen:** the door, and Смени масите.

**What happens.** Seating a party on a table that is open for phones, and moving a party onto one, both
stop on *"Същите гости ли са? — Масата вече е отворена за телефони."* with *"Същите гости — запази
поръчката"* and *"Нови гости — започни отначало"*. The question is about whoever was on that table's
phones before; the staff member reading it has just named the party standing in front of them, so it
reads as a question about those people. On a night where "Отвори всички" opened every table, it appears
on every single seating.

**What I expected.** The question names the other side — "На тази маса вече има поръчка от телефон.
Същата компания ли е?" — and does not appear at all for a table whose phones have ordered nothing.

**Repro.** Тази вечер › "Отвори всички", then seat any booking.

### P25. The guest's phone asks the server every two seconds, all night

**Screen:** none — the guest page's own traffic.

**What happens.** The phone polls `/api/guest/state?view=bill` and the server answers `"next": 2000`
every time, changed or not: 150 requests in five minutes from one idle phone at a quiet table. The
answer is small (`{"unchanged":true,…}`), but the cadence never backs off while the guest is only
reading the menu.

**What I expected.** The gap grows while nothing is happening and shrinks when it is — which the code
already does for orders in flight (`cadence(view, inFlight)`), just not for a quiet table.

**Judgement call,** and a number worth measuring rather than guessing: three hundred phones in a club
is a hundred and fifty requests a second at the web app, each one reaching Postgres. Worth measuring
before the pilot, not after.

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

### S9. The night's end counts more opened tables than the venue has

**Screen:** Тази вечер › Край на вечерта.

*"Отворени маси за телефони — 25"* at a venue with sixteen tables. It is counting openings, not
tables, but the words say tables. Either count tables, or say *"отваряния"*.

### S10. "Тази маса не приема поръчки" is printed twice, one line under the other

**Screen:** the guest's phone, at a table closed for phones.

The same sentence sits in the notice line and again in the bag area, directly beneath itself. It does
not multiply with taps; it is simply there twice.

## What held up well

Worth saying, because it is the seam #387 was most worried about: **moving a seated party between
tables is handled carefully.** The move closed the old table for phones, opened the new one, asked
about the phones already on the destination, wrote *"Резервация смени масите при отворена сметка"* into
the Log with the person's name, offered *"Върни"*, and told the staff the one thing only they can act
on — *"Сметката остава на Маса 1. Премести я на касата."* That is the right division of work with the
till, and it says so in plain words.

Also sound: the ordering seam itself. A round sent from the phone was on the table's bill within
seconds (*"Добавено към сметката ви"*, and the bill above it went from 29,50 € to 40,00 €), Tonight
counted it (*"2 изпратени поръчки · Сметка: 40,00 €"*), and the night's end counted it again. The
payment settings screen, the booking sheet with its payment rule and its history, and the end-of-night
totals are all clear and in good Bulgarian.

---

## What I could not reach, and why

1. **Everything about paying past the owner's settings screen** — the guest's pay screen, the card
   form, the tip, the receipt, the payment lines on Tonight, the night's end with a table still paying.
   Not the environment's fault this time: the provider cannot be connected at all (B4). The guest's
   phone is honest about it — *"За да платите, попитайте сервитьора."*

2. **A party moved while a round is still unsent.** I moved a party whose round was already sent and on
   the bill. Moving one mid-bag needs two hands at once; it is the one seam left unwalked and the next
   thing to try.

3. **The night's end itself.** I read Край на вечерта but did not run it, and did not use "Затвори
   всички": this walk's database may be shared with the walk Martin is using on port 3100, and ending a
   night is not something to do to someone else's screen. It should be run on a database of its own.

**What I changed, and how to put it back.** On the shared walk app (port 3200, database
`restro_walk_all`): Demo Bar now has a floor plan ("Основна зала", thirteen spots) and three spot kinds,
made through the service write path; it is back on the hidden test template `qr-phone` and published,
because the template a venue can actually choose draws no services at all (B1); one booking was seated,
moved to Маса 2 and left there; a few rounds were sent; and a connection to the simulated card provider
was started and is stuck half-done (B4). `pnpm db:seed:dev` on that database puts all of it back.

---

## Appendix: how Demo Bar got its floor plan

Kept here so it need not be worked out again, and as the shape of the `pnpm` command P18 asks for.
Every write goes through the service write path — no raw SQL, no owner role — so the rows carry their
provenance and the Log shows the work.

The script ran from the walk environment's own folder, so that it had that environment's `.env.local`,
its `node_modules` and Node 24:

```
pnpm exec node --experimental-transform-types \
  --env-file=<walk folder>/.env.local \
  --import file:///<walk folder>/apps/web/scripts/register-ts.mjs <script>.ts
```

The script builds one context and sends sixteen commands through `applyService`:

```ts
const context = () => ({
  tenantId: TENANT,
  venueId: VENUE,
  origin: 'staff',
  actor: { kind: 'user', userId: OWNER, sessionId: 'walk-plan-script' },
  jobId: newId('jb'),
  signedInAt: new Date(),
})
const send = async (command) => {
  const { result } = await applyService(pool, command, context())
  if (result.status !== 'accepted') throw new Error(result.code)
}
```

in this order, because each step needs the one before it:

1. `{ type: 'spot_kind.save', key, label, symbol, defaultSeats, sortKey }` — once per kind (`table`,
   `booth`, `counter`). A spot of a kind the venue has not defined is refused `spot_kind_missing`.
2. `{ type: 'plan.save', name: 'Основна зала', makeCurrent: true }` — answers the `planId`;
   `makeCurrent` takes the flag off the venue's other plan.
3. `{ type: 'spot.save', planId, name, kind, shape, x, y, width, height, seats?, tableId? }` — once per
   spot. Whole numbers inside the 10 000 grid; `circle` must be square and `booth` cannot be turned, or
   the shape checks refuse it. `tableId` is what ties a spot to an orderable table; the bar counter has
   none.

Two things worth knowing before writing it again: the actor must be `kind: 'user'` (a staff PIN is
refused `own_sign_in_required` for `settings.*`), and `sessionId` only has to be a string that is not a
live `shared_devices` row.
