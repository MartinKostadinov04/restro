# Song requests port stories (Club Biad MVP)

Stage 2 of the Port flow (`.claude/skills/restro-flow/port.md`), the stories half: what a person does on the MVP's screens, and how many taps it takes. Product: song requests, row prefix `SR-S`. Walked 2026-11-18, written 2026-11-19. The rules half is `docs/deliverables/2026-11-18-song-requests-port-inventory.md` (`SR-1` to `SR-408`), read out of the code; reservations are a separate inventory. This file has no verdicts and no recommendations.

## Header

- **Pin.** Commit `4c15319` (`4c15319a4f8a06c391936d8b1fef8709a8f57661`, as recorded in `C:\Ports\restro-club-biad\HOW-TO-RUN.md`). The walk ran the throwaway copy under `C:\Ports\restro-club-biad\run\`, on the local address the personal link in `69` shows (`http://localhost:5190/panel/index.html`); nothing under `C:\Ports` was changed.
- **Method.** One session drove the running demo through the browser as a guest, as the DJ (`dj`) and as the manager (`admin`), on the MVP's own seeded data, and shot 80 screenshots numbered `00` to `84` (numbers 48–52 were never taken). That session ran out of its budget before writing anything; this file was written from the screenshots alone, by a second session that did not run the demo. Everything below was read off a picture. Where a picture does not settle something, it is a gap, not an inference, and it is listed under "What the screens show that no screenshot explains".
- **The screenshots** live beside this file in `docs/deliverables/2026-11-18-song-requests-port-stories/`, committed with it. Filenames carry the number and what the shot is (`24-dj-reject-dialog.jpg`). Consecutive numbers are consecutive steps of one walk, so the numbering is also the order in which the demo's state changed: a later shot shows a later state.
- **How to read a story.** Every story has an id `SR-S<n>`, one series for the whole file, never reused. A story's **Screenshots** line names the files it is made of. **Steps** name the screen and the control touched, in the MVP's own words. **What the screens say** quotes the text the screens show for that path, with no paraphrase.
- **Tap count.** A tap is one touch of a finger: a button, a tick, opening a dialog, a field (focusing it), a keyboard "done". Typing a line of text counts as one tap however long it is, so a filled field costs two (focus, type). Scrolling is not a tap. Each story counts the taps of that story alone, from the screen it starts on; where a story continues another, it says so and does not re-count the first one's taps. Where the walk left a prefilled value alone, the count says so, because changing it would cost two more.
- **Words.** Restro terms from `GLOSSARY.md` (Song request, Paid request, Boost, Backer, Request queue, Lock window, Hold, Capture, Release, Refund, Played, Skipped, DJ, Guest session, Payment provider). The MVP's own interface is in Bulgarian and is quoted exactly, with a plain English rendering after it. The MVP's own words, kept as they are: **заявка** / request (a song request), **подкрепа** / support and **принос** / contribution (a boost, and the payer a backer), **наддаване** / the bidding (its public request queue), **поздрав** / greeting, **заключени** / the locked ones (its lock window, fixed at three), **подготви** / prepare, **сигнал** / issue, **вечер** / night.
- **Prices.** Every amount in the screenshots is the club's own and is test money: the pages say "всички плащания са симулирани" (all payments are simulated) and "Справката не е фискален документ. Всички суми са тестови." (this statement is not a fiscal document; all amounts are test amounts).
- **Not in this file:** verdicts (keep, rebuild, drop), recommendations, rules read from the code (they are the other half), the demo's test password (it is printed on the MVP's home page and is visible in `04`, `05` and `62`; it is the MVP's local fixture, and it is not quoted here).

### Who acts

| Persona | How the MVP knows them | Where they act |
|---|---|---|
| Guest | a Guest session on one phone, shown as "Гост · guest" in the top bar; no sign-in | the guest page `#client` ("Гости") |
| DJ | staff profile `dj`, shown as "DJ · dj" | the DJ page `#dj` ("DJ") |
| Manager (admin) | staff profile `admin`, shown as "Управител · admin" | the same DJ page, plus the staff buttons on the home page |

---

# Guest stories

## SR-S1 — As a guest I want to reach the song page from the venue's page, so that I can ask for a song

**Screenshots:** `00-home-phone.jpg`, `01-guest-empty-queue-top.jpg`

**Steps.** The home page carries the title "Вечерта. На едно място." (the night, in one place) and three cards: "За гостите ↗ — Песни, подкрепи и лична справка" (for the guests — songs, supports and a personal statement), "DJ пулт ↗", "Резервации ↗". Tap the first card, or "Гости" in the bottom bar, and the guest page opens.

**Tap count: 1.**

**What the screens say.** Under the title: "Никакви реални плащания. Старите данни са отделени." (no real payments; the old data is kept apart). The guest page's heading is "ТВОЯТА ВЕЧЕР / Пожелай песен." (your night / wish for a song) with a pill "Приемаме заявки" (we are taking requests) and, under the search box, the price line "Песен от 5 € · подкрепа от 3 € · поздрав +3 €" (a song from 5 €, a support from 3 €, a greeting +3 €). The top bar shows "Гост · guest" and "Свързано · 23:56:12 ч." (connected, with the time).

## SR-S2 — As a guest I want to see that nothing has been asked for yet, so that I know the night has just begun

**Screenshots:** `01-guest-empty-queue-top.jpg`, `02-guest-empty-my-requests.jpg`

**Steps.** Scroll the guest page. Below the search box sit the empty request queue, then "Моите заявки" (my requests) with three buttons, then "Моите сигнали" (my issues).

**Tap count: 0** (scrolling only).

**What the screens say.** "Все още няма отворени заявки." (there are no open requests yet) · "Твоите заявки и приноси ще са тук." (your requests and contributions will be here) · "Няма подадени сигнали." (no issues submitted). The three buttons are "Запази личен линк" (save a personal link), "Добави имейл" (add an e-mail), "Възстанови достъп" (recover access).

## SR-S3 — As a guest I want to search for a song, so that I can pick the one I mean

**Screenshots:** `03-guest-search-error-no-key.jpg`, `15-guest-search-results-stubbed.jpg`

**Steps.** Tap the field "Търси в YouTube" under the label "Песен или изпълнител…" (song or performer), type a title or an artist, tap "Търси" (search). A result is a card with the thumbnail, the title, the artist, a "YouTube ↗" link and the button "Избери" (choose).

**Tap count: 3** (field, typing, "Търси").

**What the screens say.** On the demo PC the live search was not configured and the page answered "YouTube търсенето още не е настроено." (YouTube search is not set up yet) in red under the price line (`03`). For the rest of the walk the search was stubbed, so every later result card (`15`, `67`, `84`) is a stub, not what the MVP's own search returns. See "What could not be walked".

## SR-S4 — As a guest I want to add money to a song someone else asked for, so that it is played sooner

**Screenshots:** `06-guest-public-queue-17.jpg`, `07-guest-support-dialog.jpg`, `08-guest-support-saved-toast.jpg`, `09-guest-my-request-after-support.jpg`

**Steps.** In "Наддаване" each row shows its rank, thumbnail, title, "<artist> · <the requester's display name>", a "YouTube ↗" link, the status word, the total in euro, the button "Подкрепи" (support) and, under the row, the backers line ("Мартин 30,00 € · Ралица 3,00 €"). Tap "Подкрепи" on the row. The dialog opens on the song's title with "Име за показване" (display name, empty), the tick "Показвай ме като „Гост“" (show me as "Guest", ticked), "Моят принос (€)" prefilled with 3, the note, the required tick and the button "Задръж тестовата сума" (hold the test amount). Tick the confirmation and tap the button.

**Tap count: 3** (support, the confirmation tick, hold) — the display name and the 3 € were left as they came; typing a name would cost two more and changing the amount two more.

**What the screens say.** In the dialog: "Приносът е за едно общо изпълнение, без отделно пускане или личен поздрав. Сумата първо се задържа; събира се при подготовка. Няма допълнителна платежна такса." (the contribution is for one shared performance, with no separate play and no personal greeting; the amount is held first and collected at preparation; there is no extra payment fee). The required tick reads "Потвърждавам сумата и условията · тестово плащане" (I confirm the amount and the terms · test payment). After the tap a toast says "Записано · тестови данни" (saved · test data). "Believer" went from 33,00 € to 36,00 €, moved up the ranking (`06` against `08`), and appeared under "Моите заявки" with the status "Чака" (waiting) and the total 36,00 € (`09`).

## SR-S5 — As a guest I want to see what I put on a song, so that I know what is held

**Screenshots:** `09-guest-my-request-after-support.jpg`, `10-guest-request-detail-held.jpg`

**Steps.** Under "Моите заявки", tap "Детайли" (details) on the card. Continues SR-S4.

**Tap count: 1.**

**What the screens say.** The sheet carries the song's title, the status "Чака", then my own payment, "3,00 € · Песен" with "Задържана сума" (held amount) under it and a "Съобщи за проблем" (report a problem) button beside it, then "Оттегли моя принос" (withdraw my contribution), then the footer "Справката не е фискален документ. Всички суми са тестови."

## SR-S6 — As a guest I want to take my contribution back, so that my money is not held for a song I no longer want

**Screenshots:** `10-guest-request-detail-held.jpg`, `11-guest-withdraw-confirm.jpg`, `12-guest-after-withdraw-list.jpg`, `13-guest-detail-after-withdraw-released.jpg`

**Steps.** In the detail sheet tap "Оттегли моя принос", then "Потвърди" (confirm) in the confirmation sheet.

**Tap count: 2.**

**What the screens say.** The confirmation sheet is titled "Потвърждение" and asks "Оттегляне на собствения принос?" (withdraw your own contribution?). After confirming, the toast "Записано · тестови данни" shows, the card's total falls back to 33,00 € and the status stays "Чака" (`12`), and the detail shows the same payment as "Освободено" (released) in place of "Задържана сума" (`13`). The "Оттегли моя принос" button is still on the sheet after the release.

## SR-S7 — As a guest I want to be told when there is nothing left to withdraw, so that I do not think it failed

**Screenshots:** `13-guest-detail-after-withdraw-released.jpg`, `14-guest-withdraw-twice-error.jpg`

**Steps.** Tap "Оттегли моя принос" again on the released payment, then "Потвърди".

**Tap count: 2.**

**What the screens say.** The confirmation sheet stays open and shows, in red under the button, "Няма собствен задържан принос." (there is no held contribution of your own).

## SR-S8 — As a guest I want to be told the song is already in the queue, so that I support it instead of asking twice

**Screenshots:** `15-guest-search-results-stubbed.jpg`, `16-guest-song-checkout-top.jpg`, `17-guest-song-checkout-bottom.jpg`, `18-guest-duplicate-song-error.jpg`

**Steps.** Search (SR-S3), tap "Избери" on the result, which opens the checkout on the song's title: "Име за показване", the tick "Показвай ме като „Гост“" (ticked), "Сума за песента (€)" prefilled with 5, "Поздрав по желание · +3 €" (an optional greeting) as a text box, the four sentences, the required tick, "Задръж тестовата сума". Tick the confirmation and tap the button.

**Tap count: 3** from the open results list (choose, tick, hold); **6** counted from the empty search field.

**What the screens say.** In the checkout: "DJ може да откаже. Първи в наддаването не означава непременно следващ за пускане. Сумата първо се задържа; събира се при подготовка. Няма допълнителна платежна такса." (the DJ may refuse; first in the bidding does not necessarily mean next to be played; the amount is held first and collected at preparation; there is no extra payment fee). The attempt is refused in red under the button: "Песента вече е заявена. Подкрепи отворената заявка." (the song is already requested; support the open request). Above the request queue the page explains the order: "№1 е следващ за DJ подготовката. Вече подготвени песни могат да са пред него. DJ може да откаже; неизпълнената услуга се освобождава/възстановява." (no. 1 is next for the DJ's preparation; already prepared songs may be ahead of it; the DJ may refuse, and a service not delivered is released or refunded). The queue's heading carried a count pill, "Наддаване 17".

## SR-S9 — As a guest I want to ask for a song with a greeting, so that it is dedicated to someone

**Screenshots:** `36-guest-song-checkout-filled-greeting.jpg`, `37-guest-own-song-request-queued.jpg`, `38-guest-detail-song-with-greeting-pending.jpg`

**Steps.** In the checkout, tap "Сума за песента (€)" and type the amount (40), tap "Поздрав по желание · +3 €" and type the greeting ("Честит рожден ден, Мария!" — happy birthday, Maria!), tick the confirmation, tap "Задръж тестовата сума". Continues SR-S8's path from the result card.

**Tap count: 6** from the open checkout (amount field, typing, greeting field, typing, tick, hold); **9** counted from the empty search field.

**What the screens say.** The request appears under "Моите заявки" as "Levels · Avicii · Гост a183a", status "Чака", total 40,00 € (`37`) — the display name is the pseudonym the ticked box gave, not a name that was typed. Its detail (`38`) lists two payments of mine: "3,00 € · Поздрав" with "Задържана сума", and "40,00 € · Песен" with "Задържана сума", each with its own "Съобщи за проблем" button, then "Поздрав: Честит рожден ден, Мария! · Проверява се" (greeting: … · being reviewed) and "Оттегли моя принос". The greeting is charged as its own 3 € payment of kind "Поздрав".

## SR-S10 — As a guest I want to change a greeting the DJ refused, so that the song still carries my words

**Screenshots:** `40-guest-greeting-rejected-notice.jpg`, `41-guest-edit-greeting-dialog.jpg`, `53-guest-detail-locked-request-still-withdrawable.jpg`

**Steps.** On the guest page, under my request's card, an amber notice and the button "Промени поздрав" (change the greeting). Tap it, tap the text box, type the new text, tap "Изпрати за преглед" (send for review).

**Tap count: 4.**

**What the screens say.** The notice: "Поздравът е отказан. Можеш да го промениш; без одобрение песента ще е без поздрав." (the greeting was refused; you can change it — without approval the song will go without a greeting). The dialog is "Редакция на поздрав" (edit the greeting) with the label "Текст · до 180 знака" (text, up to 180 characters), the sentence "Всяка редакция изисква ново DJ одобрение." (every edit needs a new DJ approval) and the button "Изпрати за преглед". After sending, the detail reads "Поздрав: Честит рожден ден, Мария! Наздраве! · Проверява се" (`53`).

## SR-S11 — As a guest I want to report that something went wrong with my money, so that someone looks at it

**Screenshots:** `38-guest-detail-song-with-greeting-pending.jpg`, `42-guest-report-problem-form.jpg`, `43-guest-issue-received.jpg`, `47-guest-issue-with-dj-reply.jpg`

**Steps.** In the detail sheet, tap "Съобщи за проблем" beside the payment in question, tap "Какво се случи?" (what happened?), type the problem, tap "Изпрати сигнал" (send the issue). The issue is raised against one payment, not against the request.

**Tap count: 4.**

**What the screens say.** In the form: "Първи човешки отговор до два работни дни. Това не е срок за банковото връщане." (a first human answer within two working days; this is not a deadline for the bank refund). Afterwards "Моите сигнали" carries a card headed "Получен · 037b7090" (received, with the issue's id) over my own text, "Сумата е задържана, но песента не е пусната" (the amount is held but the song has not been played). Once the DJ answers, the same card reads "Разглежда се · 037b7090" (being looked at) with my text, the DJ's text under it ("Песента ви е в опашката; ще бъде пусната по ред." — your song is in the queue; it will be played in turn) and the line "Получен 19.11.26 г., 0:04 · цел за първи отговор 21.11.26 г., 0:04" (received … · target for a first answer …).

## SR-S12 — As a guest I want to see that my request is with the DJ, so that I know why nothing can be added to it

**Screenshots:** `53-guest-detail-locked-request-still-withdrawable.jpg`

**Steps.** Open "Детайли" on my request once the DJ has it in the locked three.

**Tap count: 1.**

**What the screens say.** Under the status "Чака": "Заявката е при DJ. Нови подкрепи са затворени." (the request is with the DJ; new supports are closed). Both my payments still read "Задържана сума", the greeting still reads "Проверява се", and "Оттегли моя принос" is still offered.

## SR-S13 — As a guest I want to pull a request back even while the DJ holds it, so that I stop it being played

**Screenshots:** `53-guest-detail-locked-request-still-withdrawable.jpg`, `54-guest-after-withdrawing-locked-request.jpg`, `55-guest-detail-cancelled-after-withdraw.jpg`

**Steps.** Tap "Оттегли моя принос", then "Потвърди". Continues SR-S12.

**Tap count: 2.**

**What the screens say.** The card's total falls to 0,00 € and its status word becomes "Отменена" (cancelled) (`54`). The detail (`55`) shows "Отменена" over the same line "Заявката е при DJ. Нови подкрепи са затворени.", with both payments now "Освободено" — the 3 € greeting and the 40 € song alike — while the greeting text and its "Проверява се" state stay on the sheet.

## SR-S14 — As a guest I want to see when my money has actually been taken, so that I can tell a hold from a payment

**Screenshots:** `56-guest-detail-prepared-paid.jpg`

**Steps.** Open "Детайли" on a request the DJ has prepared.

**Tap count: 1.**

**What the screens say.** The sheet reads "Готова за старт" (ready to start) over "Заявката е при DJ. Нови подкрепи са затворени.", and the payment "50,00 € · Песен" now carries "Платено" (paid) in place of "Задържана сума". Only "Съобщи за проблем" is offered: the withdraw button is gone from the sheet.

## SR-S15 — As a guest I want to be told a song cannot be asked for again yet, so that I pick a different one

**Screenshots:** `35-guest-cooldown-error.jpg`

**Steps.** In the checkout for a song that has just been played, tick the confirmation and tap "Задръж тестовата сума".

**Tap count: 2** from the open checkout.

**What the screens say.** In red under the button: "Песента може да се заяви след 00:32:30 ч." (the song can be requested after 00:32:30) — a clock time, not a countdown. In the same shot the "Задръж тестовата сума" button is greyed out.

## SR-S16 — As a guest I want to see that the night is no longer taking requests, so that I do not try to pay

**Screenshots:** `67-guest-intake-stopped-pill.jpg`, `68-guest-request-error-intake-closed.jpg`, `84-guest-after-night-closed.jpg`

**Steps.** Open the guest page after the DJ has stopped intake, or after the night is closed. The search box, the price line and the results still work; the checkout still opens and still accepts the tick.

**Tap count: 2** from the open checkout, to reach the refusal.

**What the screens say.** The pill under the heading changes from "Приемаме заявки" to "Приемът е спрян" (intake is stopped). Trying anyway is refused in red under the button: "Приемът на заявки е спрян." (the taking of requests is stopped). `84`, after the night was closed, shows the same stopped pill and a working search.

## SR-S17 — As a guest I want a link that gets me back to my requests, so that I do not lose them with the browser

**Screenshots:** `02-guest-empty-my-requests.jpg`, `69-guest-personal-link-dialog.jpg`

**Steps.** Under "Моите заявки", tap "Запази личен линк".

**Tap count: 1** to see the link; copying it out of the read-only field is the phone's own gesture and is not counted.

**What the screens say.** "Личен защитен линк" (personal secure link) over "Пази го като парола. Срокът в демото е 30 дни." (keep it like a password; in the demo it lasts 30 days), a read-only field labelled "Копирай и запази" (copy and keep) holding an address of the form `http://localhost:5190/panel/index.html#a…`, and under it "Без запазен линк или потвърден имейл не обещаваме възстановяване. Производствените срокове предстоят." (without a saved link or a confirmed e-mail we promise no recovery; the production deadlines are still to come).

## SR-S18 — As a guest I want to leave an e-mail address, so that I can get back in if I lose the link

**Screenshots:** `70-guest-add-email-dialog.jpg`, `71-guest-email-test-code-step.jpg`

**Steps.** Tap "Добави имейл", tap the field "Имейл", type the address, tap "Подготви тестов код" (prepare a test code); the dialog turns into "Потвърди имейла" (confirm the e-mail) with the code printed on it; tap the field "Код", type the code, tap "Потвърди".

**Tap count: 7.**

**What the screens say.** "Имейл по желание" (an optional e-mail) over "Само за възстановяване на достъпа. Няма маркетингов абонамент. Изпращането е симулирано." (only for recovering access; no marketing subscription; the sending is simulated). The second step prints "Тестов код: 139428" on the page — in the demo the code is shown rather than sent.

## SR-S19 — As a guest I want to recover my requests on another phone, so that losing a phone does not lose my money

**Screenshots:** `72-guest-recover-access-dialog.jpg`, `73-guest-recover-code-step.jpg`

**Steps.** Tap "Възстанови достъп", tap the field "Потвърден имейл" (confirmed e-mail), type the address, tap "Поискай код" (ask for a code); the dialog turns into "Въведи кода" (enter the code); tap the field "Код", type the code, tap "Възстанови" (recover).

**Tap count: 7.**

**What the screens say.** The second step says "Ако има потвърден адрес, е подготвен код." (if there is a confirmed address, a code has been prepared) — the same answer whether or not the address is known — and prints "Локален тестов код: 261399" under it.

---

# DJ stories

The DJ screens below were walked at about 800 px wide, not at phone width (see "What could not be walked").

## SR-S20 — As a DJ I want the DJ page closed to guests, so that only staff can work the set

**Screenshots:** `19-dj-gate-signed-out.jpg`, `04-staff-login-dialog.jpg`

**Steps.** Open "DJ" while signed in as nobody: the page shows only a sign-in card. Tap "Влез като персонал" (sign in as staff), tap "Профил", type the profile, tap "Парола", type the password, tap "Влез" (enter).

**Tap count: 6.**

**What the screens say.** The card reads "Индивидуален вход — Влез с профил DJ или управител." (individual sign-in — sign in with a DJ or manager profile). The sign-in sheet is "Вход за персонал" with "Профил" and "Парола" and, under them, a line naming the demo's profiles and printing its test password in clear.

## SR-S21 — As a DJ I want one screen with the set on it, so that I can see what to play next

**Screenshots:** `20-dj-home-locked-top.jpg`, `21-dj-queue-list.jpg`

**Steps.** Open "DJ" signed in as `dj`. Scroll.

**Tap count: 0.**

**What the screens say.** Breadcrumb "DJ / ПОДГОТОВКА", heading "Твоят сет." (your set). A control card with four buttons — "Спри приема" (stop intake), "Планирай край" (plan the end), "Предай на друг DJ" (hand over to another DJ), "Приключи вечерта" (close the night) — over the line "Край: — · граница на вечерта 06:30 · всички плащания са симулирани" (end: — · the night's boundary 06:30 · all payments are simulated). Then "Заключени · 3/3" (locked, three of three) with the note "Само за DJ · редът се запазва независимо от сумата" (DJ only · the order is kept regardless of the amount); its three rows carry the title, "<artists> · <requester>", a "YouTube ↗" link, the status "Чака", the amount and "Детайли", and only the first row also carries "Подготви" (prepare). Below it "Наддаване" lists ten rows ranked by total (35,00 €, 34,00 €, 33,00 €, 25,00 €, 22,00 €, 20,00 €, …) with a "Покажи още 10" (show 10 more) button, then "Отказани / отменени" (refused / cancelled), then "Сигнали" (issues).

## SR-S22 — As a DJ I want to read one request in full, so that I can decide on it and on its greeting

**Screenshots:** `22-dj-detail-locked-song-greeting.jpg`, `39-dj-detail-greeting-pending-review.jpg`, `23-dj-detail-queue-song.jpg`

**Steps.** Tap "Детайли" on a row.

**Tap count: 1.**

**What the screens say.** The sheet carries the title, then "Чака · 7,00 € за класиране" (waiting · 7,00 € for the ranking), then the greeting in a quoted block ("Специален поздрав за компанията на Александър!" — a special greeting for Alexander's company), then "Поздрав: Одобрен · редакция 1" (greeting: approved · revision 1) or "Поздрав: Проверява се · редакция 1", with the buttons "Одобри поздрав" (approve the greeting) and "Откажи поздрав" (refuse the greeting). Then each payment as "<name> · <amount> · Поздрав" or "· Песен" with "Задържана сума" under it and a "Тестов резултат" (test result) dropdown set to "Успех" (success). A request that is not in the locked three also carries "Приеми · без събиране на сума" (accept · without collecting money) and "Откажи / пропусни" (refuse / skip), over the note "Тестовите резултати се избират преди „Подготви“. След 10 секунди може да продължи с успешните; изключените се изясняват/възстановяват." (the test results are chosen before "prepare"; after 10 seconds it can continue with the successful ones; the excluded ones are clarified or refunded).

## SR-S23 — As a DJ I want to refuse a song, so that the queue holds only what I will play

**Screenshots:** `23-dj-detail-queue-song.jpg`, `24-dj-reject-dialog.jpg`, `25-dj-reject-no-reason-error.jpg`, `26-dj-rejected-list.jpg`, `27-dj-rejected-detail.jpg`

**Steps.** In the detail sheet tap "Откажи / пропусни", tap the reason box, type the reason, tap "Откажи и върни/освободи сумите" (refuse and refund/release the amounts).

**Tap count: 5** counted from the list (details, refuse, field, typing, confirm).

**What the screens say.** The dialog is "Отказ / пропускане" with the label "Причина · задължителна" (reason · required). Tapping the button with the box empty is refused: "Посочи причина за отказа." (state a reason for the refusal). After the refusal the request leaves the queue and appears under "Отказани / отменени" with the status word "Отказана" (refused) and the amount 0,00 € (`26`); its detail reads "Отказана · 0,00 € за класиране" and its payment "Освободено" (`27`). The amount it carried before (16,00 €) is gone from the sheet.

## SR-S24 — As a DJ I want to prepare the first locked song and then say it has started, so that the queue follows what is really playing

**Screenshots:** `20-dj-home-locked-top.jpg`, `28-dj-prepared-ready-for-start.jpg`, `29-dj-confirm-actual-start.jpg`, `30-dj-now-playing.jpg`

**Steps.** Tap "Подготви" on the head of "Заключени". The row's status becomes "Готова за старт" (ready to start) and its button becomes "Песента започна" (the song has started). Tap that, then "Потвърди".

**Tap count: 3 captured.** No screenshot covers what the head looked like between the tap on "Подготви" and "Готова за старт", so a step may be missing from this count (see the gaps).

**What the screens say.** The confirmation reads "Потвърди действителния старт на песента." (confirm the song's actual start). After it the song moves out of the locked list and onto the control card as a row with a ▶ mark, the status "Свири" (playing), its amount, and the buttons "Приключи песента" (finish the song) and "Отмени погрешен старт" (undo a wrong start); the locked list promotes the next song to the head and gives it "Подготви" (`30`).

## SR-S25 — As a DJ I want to undo a start I pressed by mistake, so that the song goes back to where it was

**Screenshots:** `30-dj-now-playing.jpg`, `31-dj-undo-start-confirm.jpg`, `32-dj-after-undo-ready-again.jpg`

**Steps.** On the playing row tap "Отмени погрешен старт", then "Потвърди".

**Tap count: 2.**

**What the screens say.** The confirmation reads "Отмяна на погрешен старт? Само до 60 секунди и без последващи промени." (undo a wrong start? only within 60 seconds and with no changes after it). The song returns to the head of "Заключени · 3/3" with "Готова за старт" and the button "Песента започна"; the control card has no playing row again.

## SR-S26 — As a DJ I want to mark the song finished, so that the next one can be prepared

**Screenshots:** `32-dj-after-undo-ready-again.jpg`, `33-dj-finish-confirm.jpg`, `34-dj-after-finish-song-gone.jpg`

**Steps.** With the song playing, tap "Приключи песента", then "Потвърди".

**Tap count: 2** from the playing state.

**What the screens say.** The confirmation reads "Песента приключи?" (has the song finished?). Afterwards the song is gone from the page altogether — neither on the control card nor in "Заключени" — and the locked list has moved up, the new head carrying "Подготви" (`34`).

## SR-S27 — As a DJ I want to answer a guest's problem, so that they know it is being looked at

**Screenshots:** `44-dj-issues-list-received.jpg`, `45-dj-issue-reply-dialog.jpg`, `46-dj-issue-reviewing.jpg`

**Steps.** In "Сигнали" tap "Отговор" (reply) on the card, tap "Отговор към клиента" (answer to the customer), type the answer, tap "Запази отговора" (save the answer).

**Tap count: 4.** The tick "Приключи сигнала" (close the issue) was left unticked; ticking it is one more tap.

**What the screens say.** The list card is headed "Получен · 037b7090" over the guest's text and the line "19.11.26 г., 0:04 · цел за отговор 21.11.26 г., 0:04". The dialog "Отговор по сигнал" (answer on an issue) shows the payment at the top — "40,00 € · Задържана сума" — then the answer box, the tick "Приключи сигнала", and the note "Записът на отговор не извършва refund." (recording an answer does not perform a refund; the MVP leaves the English word in its Bulgarian). After saving, the card's heading changes to "Разглежда се · 037b7090" and the guest sees the answer (SR-S11).

## SR-S28 — As a DJ I want to stop taking new requests, so that I can close the set

**Screenshots:** `65-dj-stop-intake-confirm.jpg`, `66-dj-intake-stopped-button-flipped.jpg`, `67-guest-intake-stopped-pill.jpg`

**Steps.** Tap "Спри приема", then "Потвърди".

**Tap count: 2.**

**What the screens say.** The confirmation asks "Спиране на новите заявки?" (stop the new requests?). Afterwards the same button reads "Отвори приема" (open intake) and nothing else on the DJ page changes; on the guest page the pill becomes "Приемът е спрян" at once.

## SR-S29 — As a DJ I want to set when the night ends, so that intake stops by itself

**Screenshots:** `74-dj-planned-end-dialog.jpg`, `75-dj-planned-end-past-error.jpg`, `76-dj-planned-end-saved.jpg`

**Steps.** Tap "Планирай край", tap the date-and-time field, type the time, tap "Запази" (save).

**Tap count: 4.**

**What the screens say.** "Планиран край" (planned end) with the label "Дата и час по часовника на устройството" (date and time by the device's clock) over an `mm/dd/yyyy --:-- --` field, the note "Приемът спира 30 минути по-рано. Удължаването не го отваря автоматично." (intake stops 30 minutes earlier; extending it does not re-open it automatically), and "Запази". A time already past is refused with "Избери бъдещ край." (choose an end in the future). After saving, the control line changes from "Край: —" to "Край: 19.11.26 г., 0:14 · граница на вечерта 06:30 · всички плащания са симулирани".

## SR-S30 — As a DJ I want to hand the set to the next DJ, so that the queue carries on without me

**Screenshots:** `77-dj-handover-confirm.jpg`, `78-dj-after-handover-no-change.jpg`

**Steps.** Tap "Предай на друг DJ", then "Потвърди".

**Tap count: 2.**

**What the screens say.** The confirmation asks "Предаване на сета без изчистване на опашката?" (hand the set over without clearing the queue?). Afterwards the toast "Записано · тестови данни" shows and the page is unchanged: the same four buttons, the same playing song, the same locked three, the same signed-in profile in the top bar. Nothing on the screen names the DJ it went to.

## SR-S31 — As a DJ I want to be warned that the planned end has passed, so that I decide instead of drifting

**Screenshots:** `80-dj-overdue-banner.jpg`

**Steps.** Leave the page open past the planned end.

**Tap count: 0.**

**What the screens say.** An amber banner above the control card: "Планираният край е минал. Удължи или приключи вечерта изрично." (the planned end has passed; extend or close the night explicitly). The control card and the playing row are unchanged under it.

## SR-S32 — As a DJ I want to close the night, so that every unplayed request is settled at once

**Screenshots:** `79-dj-close-night-confirm.jpg`, `81-dj-close-night-confirm-when-overdue.jpg`, `82-dj-night-closed-empty-locked.jpg`, `83-dj-closed-night-cancelled-list.jpg`

**Steps.** Tap "Приключи вечерта", read the preview, tap "Потвърди".

**Tap count: 2.**

**What the screens say.** The confirmation counts the work before it happens: "Приключване: 13 непуснати заявки · 177,00 € за освобождаване/връщане. Неизвестните ще се проверяват отделно." (closing: 13 unplayed requests · 177,00 € to release or refund; the unknown ones will be checked separately). Afterwards the page reads "Заключени · 0/3" with the empty state "Няма заключени заявки." (there are no locked requests) and "Наддаване · 0"; a fifth button, "Нова вечер" (a new night), joins the control card, which still reads "Край: 19.11.26 г., 0:14 · граница на вечерта 06:30 · всички плащания са симулирани" (`82`). "Отказани / отменени" now lists every unplayed request at 0,00 €, most with the status word "Отменена" and one — "Where Are Ü Now" — with "Проблем с плащането" (a problem with the payment) (`83`).

---

# Manager (admin) stories

## SR-S33 — As a manager I want the DJ's screen, so that I can work the set when the DJ cannot

**Screenshots:** `64-admin-dj-playing-and-locked-zero-euro.jpg`, `57-admin-dj-page-issues.jpg`

**Steps.** Sign in as `admin` (as in SR-S20) and open "DJ".

**Tap count: 0** beyond the sign-in.

**What the screens say.** The top bar reads "Управител · admin" and the page is the DJ's page unchanged: the same control card, the playing row with "Приключи песента" and "Отмени погрешен старт", "Заключени · 3/3", the same "Сигнали" list. `64` also shows a locked request at 0,00 € whose row still reads "Готова за старт" — the amount on it had been refunded (SR-S34), and it kept its place in the locked three.

## SR-S34 — As a manager I want to give a guest their money back, so that a wrong charge is put right

**Screenshots:** `57-admin-dj-page-issues.jpg`, `58-admin-issue-reply-with-refund-button.jpg`, `59-admin-refund-dialog.jpg`, `60-admin-after-refund.jpg`, `61-admin-issue-dialog-refunded.jpg`, `64-admin-dj-playing-and-locked-zero-euro.jpg`

**Steps.** In "Сигнали" tap "Отговор" on the guest's issue; the reply dialog now carries an extra button. Tap "Възстанови тази тестова сума" (refund this test amount), tap the reason box, type the reason, tap "Потвърди тестовото връщане" (confirm the test refund).

**Tap count: 5.** Answering the guest in words is SR-S27's four taps on top of this; the refund and the answer are two separate saves.

**What the screens say.** The guest's issue reads "Сумата е платена по грешка, искам връщане" (the amount was paid by mistake, I want it back) and is headed "Получен · 59d6e74c". In the reply dialog the payment line reads "50,00 € · Платено" and the extra button "Възстанови тази тестова сума" sits beside "Запази отговора"; the same dialog for the DJ shows no such button (`45` against `58`). The refund sheet is "Възстановяване · тест" with "Причина · задължителна" and the note "Връща цялата сума само на избрания принос. Решението по сигнала се записва отделно." (it returns the whole amount of the chosen contribution only; the decision on the issue is recorded separately). After confirming, re-opening the reply dialog shows "50,00 € · Възстановено · тест" (`61`), the issue card still reads "Получен · 59d6e74c" (`60`), and the request itself now stands at 0,00 € in the locked three (`64`).

## SR-S35 — As a manager I want to see and stop staff profiles, so that only the right people can work tonight

**Screenshots:** `05-home-profiles-signed-in.jpg`, `62-admin-home-profiles-and-staff-button.jpg`, `63-admin-staff-profiles-dialog.jpg`

**Steps.** On "Панел", in the box "Профили за демото" (profiles for the demo), tap "Профили на персонала" (staff profiles).

**Tap count: 1.**

**What the screens say.** The box lists the demo's profiles by role and prints the local test password in clear, over "Профилите са фиктивни и само за тази изолирана база. За независим гост отвори частен прозорец или излез от персоналния профил." (the profiles are fictitious and only for this isolated database; for an independent guest open a private window or sign out of the staff profile), with the buttons "Вход / смяна на профил", "Изход от персонал" (sign out of staff) and "Профили на персонала". The dialog "Персонал" lists each profile as "<name> · <role>" over "Активен" (active) — "Управител · admin", "Елена · hostess", "Мария · hostess", "DJ · dj" — each with "Спри достъпа" (stop the access) except the signed-in manager's own, and "Нов профил" (a new profile) at the foot.

---

# What the screens show that no screenshot explains

1. **The step between "Подготви" and "Готова за старт" (`20` → `28`).** No shot catches what the head of the locked list looks like while the payment is being collected, or what its button says then. SR-S24's tap count may therefore be one short.
2. **How a request enters the locked three.** `47` shows my request queued at 40,00 €; `53` shows the same request locked and closed to supports. Nothing in between was shot, so what moved it — the DJ, the queue emptying, or a timer — cannot be read off the pictures.
3. **What reorders the queue.** `06` and `08` show "Believer" at 33,00 € ranked third and then at 36,00 € ranked higher, but no screenshot shows the list redrawing or says what the rank is computed from.
4. **Where the 50 € request of `56` and `64` came from.** Its checkout falls in the missing numbers 48–52.
5. **Why the greeting was refused.** `39` shows the DJ's two greeting buttons; `40` shows the guest's amber notice. The refusal itself was not shot, and no reason field appears on either side — the guest is told it was refused, not why.
6. **The display name "Гост a183a".** The ticked box "Показвай ме като „Гост“" produced a pseudonym with a five-character suffix. Nothing on screen explains the suffix, whether it is stable for the night, or whether another guest could get the same one.
7. **What a handover does.** After "Предай на друг DJ" (`77`, `78`) the page is unchanged and the top bar still shows `dj`. No screen names the DJ the set went to or shows the handover anywhere afterwards.
8. **"Проблем с плащането" in `83`.** One of the thirteen requests the night-close settled carries that status word while the rest read "Отменена". No screenshot shows what made it different.
9. **The two-working-day target.** `44` and `47` show "Получен 19.11.26 г., 0:04 · цел за първи отговор 21.11.26 г., 0:04" — the target is exactly two days later to the minute, and nothing on screen says whether weekends are counted.
10. **The test-result dropdown.** It appears on every held payment in the DJ's detail sheets (`22`, `23`, `39`) and was left at "Успех" throughout. The three other values, and what the sheet looks like after a refusal or a delay, were never shown.
11. **The issue ids** (`037b7090`, `59d6e74c`) are shown to the guest and to staff alike; nothing on screen says what they are for.
12. **The toast** "Записано · тестови данни" covers part of the page in `08`, `09`, `12`, `28`, `30`, `34`, `43`, `54`, `60`, `66`, `76`, `78` and `82`, and in a few of them it hides a line of the very list that had just changed.

# What could not be walked

1. **The real search.** The live search needs a YouTube API key the session did not have: `03` is the MVP's own answer, "YouTube търсенето още не е настроено." For the rest of the walk the search was stubbed, so the result cards in `15`, `67` and `84` are stubs. Everything the MVP's own search does — paging with "Още резултати", retrying with "Опитай отново", its cached-results notice, what a long result list looks like — was not walked, and SR-S3 covers only the shape of the search box and of one result card.
2. **Numbers 48–52** were never taken. They sit between the guest's issue being answered (`47`) and the locked request's detail (`53`), and they are where a second request at 50 € and its preparation would have been.
3. **Paths with no screenshot at all:** the "Нов профил" dialog behind the staff list; "Нова вечер" and a second night after a close; "Покажи още 10" expanded; "Приеми · без събиране на сума" (the DJ accepting without collecting); any test result other than "Успех", and so the excluded-contribution line the DJ's note mentions; "Без поздрав" (removing a greeting); what happens to a request when the guest who asked for it withdraws but other backers remain; the personal link actually opened on a second device (the `#access=` address); an issue closed with "Приключи сигнала" ticked; the connection-lost panel and the unconfirmed-action banner the shell carries.
4. **Widths.** The guest side and the home page were walked at phone width; the DJ page and the manager's screens at about 800 px. The DJ page at phone width — the width a DJ would actually hold — was not walked, so none of SR-S20 to SR-S34's layouts, and none of their tap counts, are a phone's.
5. **One guest only.** The whole walk ran from one Guest session. Two guests supporting the same song at the same time, a second guest's view of my request, and anything that depends on two phones at once were not walked.
6. **The amounts** in every shot are the club's own prices on the MVP's seeded data, in test money.
