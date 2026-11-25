# Walk-through notes, st/foundation at 70e88983 (agent, for Martin)

**Status 2026-11-09:** the five bugs this walk found are fixed and merged into `st/foundation`: B1 (#344, #353), B2 (#345, #352), B23 (#346, #351), B3 (#347, #354), B4 (#348, #355). The low-priority items and the review follow-ups are in #349.

Walked on 2026-11-08 at http://localhost:3100 (database `restro_walk_st`), signed in as the owner, following `docs/deliverables/2026-11-07-walkthrough-st-foundation.md`, sections 2 to 5. The admin was in Bulgarian. The guest phone was 390 px wide; Tonight was 1180 px.

## Summary

- 18 points: **5 passed**, **5 partly**, **2 failed**, **5 not tested**, 1 answered on paper (2.6).
- **Failed:** 3.4: after staff press Handled, the guest's phone never says «Повикването е прието»; it keeps spinning on "waiting". 3.3: the bill shows item names from the unpublished draft.
- **Not tested:** 2.5 (Demo Bar has no photos, so two columns do nothing), 3.5 (turning the location check on asks for your password), 3.6 and 4.4 (Wi-Fi cannot be cut here), 3.7 (paying is not connected).
- **Look at these yourself:**
  1. The five Styles on a real phone. Club fits a club best.
  2. The call-handled bug (B1).
  3. Re-enable the location check: Settings › Поръчки › Още. **I left it OFF.** Turning it back on asks for your password.
  4. DA-18 on a venue with photos.
  5. The Tonight tables grid. It is cut off at tablet width (B4).
- **What I changed on Demo Bar:**
  - Published versions 2 and 3. Version 3 is live with the **Club** style.
  - Hid Heineken and Craft IPA.
  - Renamed Каменица to «Каменица 0,5 л».
  - Made a QR code for table 7 and opened table 7.
  - Added the staff member "Test Waiter".
  - Sent one order and two calls, and marked both calls handled.

## Section 2: the owner's admin

### 2.1 Venues list
- **Saw:** One card per venue with «Чернова» or «На живо», «Отвори», «Преглед на менюто», «Източник: Simulated POS» and «Заведение в Simulated POS Demo Bar».
- **Taps compared with the admin map:**

  | Action | Taps |
  |---|---|
  | Hide | 1 |
  | Rename an item from the POS | 3 plus typing (the map says "3?"; it is 3) |
  | Mark sold out (venue made by hand) | 2 |
  | Publish | 2 |
  | Pick a Style | 3 (Design, the tile, Готово) |

- **Matches the list?** Yes.
- **Problems:**
  - Inside the venue the same source is called «test POS» (B8).
  - Picking a Style really costs 3 + 2 taps to publish. The Design page has no Publish button, so you must go back to the Studio first (B14).
- **Answer for Martin:** Yes.

### 2.2 Structure
- **Saw:**
  - Hiding is one switch tap and gives the badge «Скрито». There is no Undo toast and no confirmation.
  - Rename: the item, the pencil, type, «Запази». You get «Записано», the badge «Заменено» and «Върни».
  - Every POS item has «1 проблем» and the warning «Липсва име за менюто в test POS: показва се собственото му име».
  - On the venue made by hand (Demo Club Sofia), «…» › «Изчерпано тази вечер» gives the badge and the chip «Изчерпани (1)».
  - Sold-out note in the item sheet: «Изчезва от менюто за гостите до около 15 секунди…» ("It leaves the guest menu within about 15 seconds.").
  - Guinness («Не се продава в test POS») is absent from the guest menu, which is correct.
- **Matches the list?** Partly.
- **Problems:**
  - On the POS venue, the owner reads «Само собственик или администратор може да отбелязва артикул като изчерпан». The real reason is that the POS decides what is sold out (B3).
  - Demo Club Sofia, a venue made by hand, shows the badge «От barsy», which is a vendor name (B7).
  - Its menu picker was sometimes empty.
- **Answer for Martin:** Change it: fix the wrong reason on POS venues. The rest is yes.

### 2.3 Guest features («Функции за гостите»)
- **Saw:**
  - Switches for «Повикване на сервитьор» (7 kinds), «Показване на сметката на масата», «Поръчка от телефона» and «Плащане от телефона».
  - The card has its own «Запази». After saving it says «Запазено. Гостите ще го видят след следващото публикуване».
  - I turned the waiter call off. The guest page kept the button until I published version 2, and then it was gone.
  - I turned it on again. It came back after version 3.
  - The guest page can lag up to 30 s after a publish (B15).
- **Matches the list?** Partly.
- **Problems:**
  - Stale notes under the switches: «Гостите ще видят това, когато поръчките бъдат свързани (етап 4)» and «…плащанията бъдат свързани (етап 5)». Ordering is already built (B5).
  - The publish dialog lists this change as «Заглавието или въведението на менюто», which is the wrong label (B6).
- **Answer for Martin:** Yes on behaviour. Change the two notes and the label.

### 2.4 Studio › Design
- **Saw:**
  - **Basic level («Основно»):** Style tiles (Basic, Editorial, Soft, Classic, Club), «Моите стилове», «Запази като стил…», colours, fonts, logo and «Подредба за всички менюта».
  - **Advanced level («Разширено»):** the design pages Общи, Заглавна част, Навигация, Секции, Артикули, Снимки, Етикети и алергени, Страница на артикула, Панели и долна част, Повикване на сервитьор, Сметка, Поръчка, Плащане and Разписка.
  - The preview has «Телефон» (390), «Таблет» (820) and «Компютър» (1280), plus «Светъл» and «Тъмен».
  - «Отмени» (Undo) stepped back correctly through two changes, one per tap. «Незапазено» shows while there are changes.
  - «Готово» gave «Дизайнът е запазен. Гостите ще го видят при следващото публикуване.» Publishing then showed Club on the guest page.
- **Matches the list?** Yes.
- **Problems:**
  - Picking Club switched the preview to «Тъмен», and it stayed dark for the other Styles (low).
  - In Classic, the prices are in a bold sans font next to serif names (B16).
  - In Club, the top bar on the guest page sits tight on the venue name (B17).
- **Answer for Martin:** **YOUR CALL**, per Style:

  | Style | What it looks like | My recommendation |
  |---|---|---|
  | Basic | Light, neutral, safe | Yes as the default, but not a club look |
  | Editorial | Black title band, heavy upper-case names | Yes; good for a cocktail bar |
  | Soft | Rounded cards, pill tabs | A café look, weakest for a club. Yes, but do not push it to clubs |
  | Classic | Serif, spaced upper-case section titles with rules | Wine bar or restaurant. Change it: make the price font match |
  | Club | Dark, heavy display font, all caps | Yes; the best fit for the pilot. Give the top bar some room |

### 2.5 DA-18 (large names, two columns)
- **Saw:** I set «Размер на името: Голям» and «Подредба: Две колони». Nothing changed: Demo Bar has no photos, and two columns only apply to items with a photo. Without photos the names were 19 px and the prices 14 px.
- **Matches the list?** NOT TESTED on screen.
- **Code check:** In `packages/faces/editorial-market/src/renderer-rules.test.tsx`, the test pins a 14 px name over a 16 px price for two columns with the large name size.
- **Problems:** «Две колони» does nothing visible on a venue without photos, and nothing says why (B12).
- **Answer for Martin:** **YOUR CALL**. Recommendation: change it, so the name is at least as big as the price. When the name is smaller than the price, the guest reads the price before the drink. Facts: this only shows on photo cards, and the audit called it an accepted departure from the old look.

### 2.6 DA-O4 (every venue lands on Basic on deploy day)
- **Saw:** Nothing to see; this is a paper question.
- **Answer for Martin:** **YOUR CALL**. Recommendation: yes, if no paying venue is live by then. Facts: each owner gets a Style back by picking one and publishing, which is 5 taps.

### 2.7 Settings › Ordering, Paying, Staff and roles
- **Saw:**
  - The location check was on by default (I switched it off for the test).
  - With the check on, this line shows: «Задайте мястото на заведението, иначе никой не може да поръчва на сметка, докато проверката на местоположението е включена.»
  - The order limit «150,00 €».
  - Paying: «Свържи Test card payments», «Най‑малко плащане с карта 0,50 €» and «Бакшиш не се предлага: test POS още не може да го добави в същата касова бележка.»
  - Staff: «Добави човек» creates a person and shows a generated PIN. The roles are Персонал, Мениджър and Собственик.
  - No greyed-out buttons were seen.
- **Matches the list?** Partly.
- **Problems:**
  - The seed does not connect paying, but the list assumes paying is on.
  - Собственик shows «0 души» while the owner exists (B9).
  - The spot warning stays even with the check off (B13).
  - Changing settings asks for the password again after 15 minutes. That stopped me from switching the check back on.
- **Answer for Martin:** Yes on wording. Change the owner count.

## Section 3: the guest's phone (390 px)

### 3.1 Menu
- **Saw:** "Table 7", BG/EN, the bill and card icons, and the items with prices. Club is live now.
- **Matches the list?** Yes.
- **Problems:**
  - Every item has a «NEW» badge, which is noisy.
  - The section tab marker was once doubled after scrolling (not confirmed).
  - The backdrop behind sheets is light grey on the dark page.
  - The Next.js "N" dev button covers the Call a waiter button (dev only).
- **Answer for Martin:** Yes for Club. Change the NEW badge rule.

### 3.2 Bag and Send
- **Saw:** "View bag approx. €10.50", then "Total (approx.)", "Allergies or special requests? Tell the staff.", "Send 2 items", "Sending…", "Added to your bill" and "Show this to your waiter".
- **Matches the list?** Partly. Sending works. The DA-1 lines are NOT TESTED because paying is not connected.
- **Words in the code:**

  | English | Bulgarian |
  |---|---|
  | "Your bill is under the minimum for card payment" | «Сметката ви е под минимума за плащане с карта» |
  | "Pay cash" | «Плати в брой» |
  | "Another payment is in progress, try again in a moment" | «В момента върви друго плащане, опитайте пак след малко» |

- **Problems:** "Nothing on the table order yet." sits right above "Added to your bill" (B10).
- **Answer for Martin:** Yes to the three lines (see section 5).

### 3.3 Bill
- **Saw:**
  - "YOUR TABLE'S BILL", "Everything ordered at this table, from the app and from the waiter.", "Updated 2 s ago", "Left to pay €61.00" and "Pay €61.00".
  - The waiter's round from sim-pos appeared within about 8 s, bringing the total to €94.05.
- **Matches the list?** Partly.
  - The discount line is NOT TESTED: sim-pos has no discount command. The code (`viewSignedMinor`) draws "-4,00 €".
  - **Failed:** the bill and Pay sheets showed «Каменица 0,5 л» from the unpublished draft while the menu showed «Каменица 500 мл» (B2).
- **Answer for Martin:** Yes to the minus line. Change it: fix the draft-name leak.

### 3.4 Call a waiter
- **Saw:**
  - The sheet "CALL A WAITER" offers Call the waiter, Bring the bill, Ice, Water, Glasses, Clean the table and Card terminal, then Send.
  - After sending: "Waiter called / We are waiting for the team to confirm it. / Ice". Adding Water joined the same call ("Ice, Water").
  - There is no Cancel.
  - In Bulgarian: «Сервитьорът е повикан / Чакаме екипът да я потвърди.»
- **Matches the list?** No.
- **Problems:**
  - **B1:** after staff press «Обслужено» the phone never shows «Повикването е прието». In `call-sheet.tsx`, `SHOWN` leaves out `'done'`, so the sheet falls back to the spinner, or to the picker once reopened.
  - «Чакаме екипът да я потвърди»: the «я» has nothing to point to, because the title's subject is «Сервитьорът».
  - The lost-connection case is NOT TESTED. The words are in the code.
- **Answer for Martin:** Change it (B1). Your answers on "no Cancel" and the wording are in section 5.

### 3.5 Location check
- **NOT TESTED.** Turning the check back on asks for your password, and the browser here cannot share a location.
- **Code check:**
  - `sheets.tsx` draws «Спри проверката на местоположението» / "Stop location check" on the bag, bill, Pay and Call sheets while the check is held.
  - The words "Allow location to see and add to your table's order and bill." and "Allow location" are in `strings.ts`.
- **Answer for Martin:** Walk it yourself on a real phone.

### 3.6 Weak connection
- **NOT TESTED** (Wi-Fi cannot be cut here).
- **Code check:** `ConnectionLine` in `bag-bar.tsx` shows "Weak connection. Nothing new was sent yet, we keep trying." at the top of the menu when no sheet is open.
- **Answer for Martin:** Yes on the words.

### 3.7 Pay
- **NOT TESTED** (paying is not connected).
- **Saw:** The Pay sheet says «Какво плащате? / За да платите, попитайте сервитьора.», but the Pay button with the amount still shows on the bill (B23).
- **Code check:** «Има текущо плащане, докоснете за да го видите» / "Payment in progress, tap to see" (`PaymentProgress`).
- **Answer for Martin:** Check the 48 px Paid number on a real payment.

## Section 4: Staff Tonight screen (1180 px)

### 4.1 Open tables
- **Saw:** «Масите още не са отворени / Отворете ги за телефони, за да започнат поръчките. / Отвори всички». One tap on Маса 7 gave «Маса 7 е отворена за телефони» with «Върни». As the owner, no PIN was asked.
- **Matches the list?** Partly. The shared tablet and PIN flow are NOT TESTED: they need a staff sign-in.
- **Problems:**
  - The tables grid is cut off sideways at 1180 px: the 5th column is clipped and a scrollbar appears (B4).
  - The payment tables PM1, PM2, PU1 and PU2 show as «Затворена».
- **Answer for Martin:** Yes, it is few taps. Change the grid width.

### 4.2 Needs you
- **Saw:** «Маса 7: Лед, Вода», «току-що» and «Обслужено». It appeared about 11 s after Send. The table card read «Вика». After Handled: «Маса 7: обслужено» with «Върни», then «Нищо не чака». «Чака вас» comes first, then the tables.
- **Matches the list?** Yes. The Log line has the table: «Повикването от Маса 7 е прието (Лед, Вода) · Маса 7 · Demo Owner».
- **Answer for Martin:** Yes. It is calm and the one accent holds.

### 4.3 Sent orders, Log, End of the night
- **Saw:**
  - «Поръчки»: «PF9 14:06 Маса 7 · 2 артикула · 15,00 € Добавена». Opening it shows «Сметка acc 1 #2 в test POS» and the steps «Чака · Телефон на гост», «Изпраща се · Restro», «Добавена · Restro».
  - The «Дневник» lines name who did it.
  - «Край на вечерта» shows totals, including «Бакшиши 0,00 €» for the owner.
- **Matches the list?** Yes. The tablet view (no tips) is NOT TESTED.
- **Problems:**
  - «acc 1 #2» reads like a code, not a bill number (B18).
  - «Променени настройки: настройка» says nothing (B19).
- **Answer for Martin:** Yes, with those two wording fixes.

### 4.4 Offline
- **NOT TESTED** (Wi-Fi cannot be cut here). The code has `offline-line.tsx`.

## Section 5: open points

1. **Sold-out wording (DA-14).** **YOUR CALL.** Recommendation: yes, the item disappears rather than being greyed out. Staff read «Изчезва от менюто за гостите до около 15 секунди…». Fix B3 separately.
2. **«Повикването е прието».** **YOUR CALL.** Recommendation: change it to «Обслужено», the same word as the staff button. «Прието» reads as "received", so the guest keeps waiting for someone to come. The Log uses «е прието» too; change both. Today the guest never sees this line anyway (B1).
3. **"Your bill is under the minimum for card payment" / "Pay cash".** **YOUR CALL.** Recommendation: yes to both. In Bulgarian, «Плати в брой» uses the same informal button form as «Разреши».
4. **No Cancel on an open call (DA-10).** Recommendation: yes. The team cannot take a call back, and the call joins kinds instead.
5. **DA-18.** **YOUR CALL.** Change it, so the name is at least as big as the price (see 2.5).
6. **The five Styles.** **YOUR CALL.** See the table in 2.4. Club for the pilot. Fix the fonts in Classic.
7. **DA-O14.** **YOUR CALL.** Recommendation: leave it for now. Locking is safe. Make "Try again" the same everywhere when paying is released.
8. **DA-O4.** **YOUR CALL.** Yes, if no paying venue is live yet.
9. **DA-O16.** **YOUR CALL.** Recommendation: hide "Stop location check" on Pay while a payment is running, and keep it everywhere else. Otherwise the bill vanishes in the middle of a payment.
10. **DA-O17.** **YOUR CALL.** Recommendation: yes, say why ("no connection" or "refused"), and do it with the paying release.

## Bugs found

| id | point | steps | expected | saw | severity |
|---|---|---|---|---|---|
| B1 | 3.4 | Guest sends a call with the sheet open; staff press «Обслужено» | «Повикването е прието» | The spinner stays on «Чакаме екипът да я потвърди»; reopening shows the picker | high |
| B2 | 3.3 | Rename a POS item, do not publish, open the guest bill with that item | The published name | The draft name «Каменица 0,5 л» on the bill and Pay | medium |
| B3 | 2.2 | Owner opens a POS item › sold out | "The POS sets sold out" | «Само собственик или администратор може…» | medium |
| B4 | 4.1 | Tonight at 1180 px | 5 columns fit | 5th column clipped, sideways scrollbar | medium |
| B23 | 3.7 | Pay on, provider not connected; open the bill | No Pay button, or the reason | "Pay €61.00" leads to «За да платите, попитайте сервитьора» | medium |
| B5 | 2.3 | Studio › Функции за гостите | Current notes | «(етап 4)», «(етап 5)» | low |
| B6 | 2.3 | Change a guest feature, Publish | "Guest features" | «Заглавието или въведението на менюто» | low |
| B7 | 2.2 | Demo Club Sofia, Structure | No vendor name | «От barsy» | low |
| B8 | 2.1 | Venues list, then inside the venue | One name | «Simulated POS» and «test POS» | low |
| B9 | 2.7 | Settings › Персонал и роли | Собственик: 1 | «0 души» | low |
| B10 | 3.2 | Send an order | One clear state | "Nothing on the table order yet." above "Added to your bill" | low |
| B12 | 2.5 | Two columns on a venue without photos | A visible change or a hint | No change | low |
| B13 | 2.7 | Location check off | No warning | The spot warning still shows | low |
| B14 | 2.4 | Design › Готово | Publish reachable | Must go back to the Studio | low |
| B15 | 2.3 | Publish, reload the guest page right away | New version | The old version for up to 30 s (`current.json` max-age=30) while the admin says «Гостите я виждат вече» | low |
| B16 | 2.4 | Classic style | Matching fonts | Sans bold prices next to serif names | low |
| B17 | 3.1 | Club, guest page at 390 px | Space under the top bar | The bar sits tight on «Demo Bar» | low |
| B18 | 4.3 | Open a sent order | A readable bill number | «Сметка acc 1 #2 в test POS» | low |
| B19 | 4.3 | Change a setting, then open the Дневник | What changed | «Променени настройки: настройка» | low |
| B20 | 3.1 | Scroll the menu, watch the section tabs | One marker | Doubled once (not confirmed) | low |
| B21 | all | Any page | No server warnings | pg DeprecationWarning "client.query() when the client is already executing a query" | low |
| B22 | 3.1 | Guest menu | NEW on new items only | NEW on every item | low |
