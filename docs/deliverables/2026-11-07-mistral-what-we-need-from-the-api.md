# What Restro needs from the Zamboo API, and how another POS does it

Made by: the lead session (Opus), 11-07. For: Martin, to send to Mistral Software (office@mistral.bg; fiscal service fiskal@mistral.bg). Companion to [2026-11-07-pos-api-requirements-checklist](2026-11-07-pos-api-requirements-checklist.md), which holds all 69 requirements and their verdicts.

**Before you send it, Martin.** Two notes.

1. It names barsy and its methods. That tells Mistral we have integrated a competitor. I think that helps — it shows we are not asking them to invent anything, and the precedent is a working Bulgarian POS under the same fiscal rules — but it is your call. If you would rather not name it, every "barsy" can become "another Bulgarian POS whose API we have integrated"; be aware the method names would still identify it to anyone in the trade.
2. Everything in the barsy column comes from its own published reference, read on 10-18 (`docs.lukanet.com/barsy.api`, pages cited per row) and from our connector's method map. Nothing is guessed. Where our reading left a point open, the row says so.

The eleven asks below are what the pilot needs, each with a reason and a working precedent. Rows marked *blocking* are the ones without which a venue cannot take orders through Restro at all. The "ref" column is our own requirement number, for when we talk about them.

---

## What we have already done, so you need not repeat it

**EN.** We have read your published API in full — `Zamboo api v1`, OpenAPI 3.0.4, 45 operations at `https://demorestaurant.zamboo.bg/swagger/v1/swagger.json` — and we have made read-only calls against the demo installation. We understand it to be the delivery and web-shop channel: the one Glovo, Bolt and Wolt use, which `GetExternalSystems` confirms. It reads the menu well and it accepts a complete standalone order with a customer, an address and a delivery time.

We are not asking you to build a new API. Your own Zamboo web interface applies actions to an open bill, so the capability exists in your product. **We are asking which of the eleven things below your table-service interface already does, and whether you will open it to us.** Where the answer is "it already does", the work is ours, not yours.

**BG.** Прочетохме публикуваното описание на вашето API изцяло — `Zamboo api v1`, OpenAPI 3.0.4, 45 операции на `https://demorestaurant.zamboo.bg/swagger/v1/swagger.json` — и направихме само четящи заявки към демо инсталацията. Разбираме го като канала за доставки и онлайн магазин: този, който ползват Glovo, Bolt и Wolt, което `GetExternalSystems` потвърждава. Той чете менюто добре и приема цялостна самостоятелна поръчка с клиент, адрес и час за доставка.

Не ви молим да изграждате ново API. Самият ваш уеб интерфейс Zamboo извършва действия върху отворена сметка, значи възможността съществува в продукта ви. **Питаме кои от единадесетте неща по-долу вашият интерфейс за обслужване на маси вече прави и ще ни го отворите ли.** Там, където отговорът е „вече го прави“, работата е наша, не ваша.

---

## 1. Read a table's open bills

*blocking — ref C22, C23, C24, C52*

**EN. What we need.** Given a table, the bills open on it, each with its rows, its total, what is paid and what is still owed, and whether it is open or closed. Per row: the item, the quantity, the price, who entered it and when.

**Why.** It is the foundation of everything else. A guest at table 7 opens our page and must see what is already on the table before adding to it. Without this read we cannot show a bill, cannot add to the right one, cannot tell our own rounds from the waiter's, and cannot find out whether a round we sent during a network failure actually landed. This is the single requirement that decides whether ordering can work at all.

**How barsy does it.** `Accounts_getlist`, filtered by `place_id` and open status, returns each bill with `total`, `discount`, `total_real`, `total_paid`, `total_remain`, `status` and `is_locked`. Each row carries `article_id`, `amount`, `current_price`, `date`, `user_name` (who placed it), `status` and `served_date`. `Places_getlistwithaccountsonly` lists only the tables that have an open bill, with a checksum so a refresh can skip unchanged tables. (`methods/accounts/getlist.html`, `methods/places/getlistwithaccountsonly.html`)

**BG. Какво ни трябва.** По дадена маса — отворените сметки по нея, всяка с редовете си, сумата, платеното и оставащото, и дали е отворена или затворена. По ред: артикул, количество, цена, кой го е въвел и кога.

**Защо.** Това е основата на всичко останало. Гост на маса 7 отваря страницата ни и трябва да види какво вече е на масата, преди да добави. Без това четене не можем да покажем сметка, не можем да добавим към правилната, не можем да отличим своите кръгове от тези на сервитьора и не можем да разберем дали кръг, изпратен при прекъсване на мрежата, е стигнал. Това е единственото изискване, което решава дали поръчването е възможно.

**Как го прави barsy.** `Accounts_getlist` с филтър по `place_id` и отворен статус връща всяка сметка с `total`, `discount`, `total_real`, `total_paid`, `total_remain`, `status` и `is_locked`. Всеки ред носи `article_id`, `amount`, `current_price`, `date`, `user_name` (кой го е въвел), `status` и `served_date`. `Places_getlistwithaccountsonly` връща само масите с отворена сметка, с контролна сума, за да се пропуснат непроменените.

---

## 2. Add a round to a bill that already exists

*blocking — ref C10, C54, C20*

**EN. What we need.** One call that puts rows on an existing open bill — including a bill a waiter opened — and a way to open a new bill with rows when the table has none. Our own unique code travels with the call, and the bill's id comes back.

**Why.** A table orders five or six times across a night. If each of our orders becomes a separate sale, the waiter who walks over with the bill does not see what the guests ordered from their phones, and the venue ends the night reconciling by hand. In your current API every `SaveOrder` creates a new standalone order; nothing adds to one.

**How barsy does it.** `Accounts_place` with an `account_id` continues an existing bill; without one it creates a bill and returns its number. The bill carries `place_id` (the table), `account_alias` (a title staff see), `notes` (not printed), `description` (printed) and `uuid`, our own unique code. Rows carry `article_id` and `amount`. (`methods/accounts/place.html`)

**BG. Какво ни трябва.** Една заявка, която добавя редове към вече отворена сметка — включително сметка, отворена от сервитьор — и начин да отворим нова сметка с редове, когато масата няма такава. Нашият собствен уникален код пътува със заявката, а идентификаторът на сметката се връща.

**Защо.** Една маса поръчва пет-шест пъти през вечерта. Ако всяка наша поръчка стане отделна продажба, сервитьорът, който носи сметката, не вижда какво са поръчали гостите от телефоните си, и обектът приключва вечерта със сверяване на ръка. В сегашното ви API всяко `SaveOrder` създава нова самостоятелна поръчка; нищо не добавя към съществуваща.

**Как го прави barsy.** `Accounts_place` с `account_id` продължава съществуваща сметка; без него създава сметка и връща номера ѝ. Сметката носи `place_id` (масата), `account_alias` (заглавие, видимо за персонала), `notes` (не се печата), `description` (печата се) и `uuid` — нашия уникален код. Редовете носят `article_id` и `amount`.

---

## 3. A bill belongs to a table, and tables can be listed

*blocking — ref C13, C56*

**EN. What we need.** The venue's tables, each with an id we can hold, and a table on the bill. A table may have more than one open bill at a time.

**Why.** Our whole product is a QR code on a table. The guest scans table 7 and everything that follows has to reach table 7 — the order, the bar's ticket, the waiter. The word "table" does not appear anywhere in your published description, so today an order we send cannot be routed to one.

**How barsy does it.** `Places_getlist` returns the tables, rooms and places. `place_id` is an optional field on a bill, and `Places_getlistwithaccountsonly` counts the open bills per table, so several bills on one table are normal. (`methods/places/getlist.html`)

**BG. Какво ни трябва.** Масите на обекта, всяка с идентификатор, който можем да пазим, и маса върху сметката. Една маса може да има повече от една отворена сметка.

**Защо.** Целият ни продукт е QR код на масата. Гостът сканира маса 7 и всичко след това трябва да стигне до маса 7 — поръчката, бонът на бара, сервитьорът. Думата „маса“ не се среща никъде в публикуваното ви описание, така че днес изпратена от нас поръчка не може да бъде насочена към маса.

**Как го прави barsy.** `Places_getlist` връща масите, залите и местата. `place_id` е незадължително поле на сметката, а `Places_getlistwithaccountsonly` отчита отворените сметки по маса, така че няколко сметки на една маса са нормални.

---

## 4. The POS prices the order, and the total reads back

*blocking — ref C12, C35, C36*

**EN. What we need.** We send items and quantities; the POS applies its own price and its own discounts, and we read the resulting total back before anyone pays.

**Why.** Two reasons, and the second is the serious one. First, a club's prices change during the night — happy hour, a promotion, a table's discount — and the price we last synced is not the price the venue charges. Second, we will not take a guest's money for a total the POS has not confirmed. In your current API `price` is required on every row, `SaveOrderDefPrice` fills one in only where we send zero, and no call reads the applied total back; so the guest would be charged a number we calculated, not one the venue did.

**How barsy does it.** `Accounts_place` sent without a price uses the item's current price. The bill then reads back with `total_real`, the final amount after prices and discounts, which is the number a payment can be matched against. (`methods/accounts/place.html`, `methods/accounts/getlist.html`)

**BG. Какво ни трябва.** Ние изпращаме артикули и количества; POS прилага своята цена и своите отстъпки, а ние прочитаме получената сума, преди някой да плати.

**Защо.** По две причини, и втората е сериозната. Първо, цените в един клуб се менят през вечерта — happy hour, промоция, отстъпка за маса — и цената от последната ни синхронизация не е цената, която обектът начислява. Второ, няма да вземем пари от гост за сума, която POS не е потвърдил. В сегашното ви API `price` е задължително на всеки ред, `SaveOrderDefPrice` попълва цена само където изпратим нула, и никоя заявка не връща приложената сума; тоест гостът би платил число, изчислено от нас, а не от обекта.

**Как го прави barsy.** `Accounts_place` без изпратена цена ползва текущата цена на артикула. След това сметката се чете с `total_real` — крайната сума след цени и отстъпки — числото, срещу което може да се сравни плащане.

---

## 5. Close a bill with a payment, and give us the fiscal receipt

*blocking — ref C32, C34, C37, C41, C42, C43*

**EN. What we need.** Close an open bill with a payment of a named kind, have the venue's fiscal device print, and get a receipt reference back — the sale number, the receipt number, the date and time, the device. Also: what happens when the device cannot print.

**Why.** A guest who pays in our app is paying at the venue, and Bulgarian law needs a fiscal receipt for it. Our rule is absolute: we never confirm a payment to a guest until the POS has handed us a receipt reference. Your current API can record an order as card-paid (`paymentKindGuid`, `sumPaid`), but nothing closes a bill, nothing mentions the fiscal device, and the only thing that comes back is an internal operation id — so we could never prove to the guest, or to a tax inspection, that their payment was fiscalised.

**How barsy does it.** `Accounts_close` with `payments` prints the fiscal receipt on the configured fiscal device, updates stock and leaves the bill read-only. Payments carry `paymethod_id`, `type_id` (5 card present, 6 card not present, and so on), a `fx` flag that marks a payment as performing a fiscal operation, `payment_print_data` (the receipt print data), `transaction_id` and `ref_num` for the provider's reference. The sale number (`unp`) reads back on the bill. In the staff screens a bill closes only after the print succeeds. (`methods/accounts/close.html`, `methods/payments/getlist.html`)

**BG. Какво ни трябва.** Затваряне на отворена сметка с плащане от посочен вид, отпечатване от фискалното устройство на обекта и връщане на референция към бона — номер на продажбата, номер на бона, дата и час, устройство. Също: какво става, когато устройството не може да печата.

**Защо.** Гост, който плаща в приложението ни, плаща в обекта, а българският закон изисква фискален бон за това. Правилото ни е безусловно: не потвърждаваме плащане на гост, докато POS не ни е върнал референция към бона. Сегашното ви API може да отрази поръчка като платена с карта (`paymentKindGuid`, `sumPaid`), но нищо не затваря сметка, никъде не се споменава фискално устройство, а единственото, което се връща, е вътрешен идентификатор на операция — така че не бихме могли да докажем нито на госта, нито при проверка, че плащането е фискализирано.

**Как го прави barsy.** `Accounts_close` с `payments` отпечатва фискалния бон на конфигурираното устройство, обновява наличностите и прави сметката само за четене. Плащанията носят `paymethod_id`, `type_id` (5 карта присъствена, 6 карта неприсъствена и т.н.), флаг `fx`, който отбелязва, че плащането извършва фискална операция, `payment_print_data` (данните за печат на бона), `transaction_id` и `ref_num` за референцията на доставчика. Номерът на продажбата (`unp`) се чете върху сметката.

---

## 6. Split, merge and move a bill

*blocking — ref C27, C28, C29, C30, C31, C55, C56*

**EN. What we need.** Move chosen rows and quantities off an open bill onto a new one, so one guest can pay their own part; merge a table's bills into one; and a clear answer when the quantity has already gone.

**Why.** Six people at a table, one leaves early and wants to pay for their two drinks. Today the waiter does this at the POS in seconds; in our app it is the single most asked-for thing after seeing the bill at all. Nothing in your published API splits, merges or moves anything.

**How barsy does it.** `Accounts_divide` takes the old bill and the rows with quantities, creates a new bill with them and returns its id. `Accounts_merge` and `Accounts_mergebyplaceid` move rows into the oldest bill and close the others empty; a closed or fiscally marked bill cannot be merged. `Accounts_move` moves an open bill to another table and/or another staff member, and without the "direct transfer" right that member must accept it first — until then both see it. Our reading left two points open there, which we would ask of you too: whether a divide and a close are atomic together, and which row is taken when two rows share an item. (`methods/accounts/divide.html`; methods `Accounts_merge`, `Accounts_mergebyplaceid`, `Accounts_move`)

**BG. Какво ни трябва.** Преместване на избрани редове и количества от отворена сметка в нова, за да може един гост да плати своята част; обединяване на сметките на една маса; и ясен отговор, когато количеството вече е изчерпано.

**Защо.** Шест души на маса, един си тръгва по-рано и иска да плати своите две напитки. Днес сервитьорът го прави на POS за секунди; в нашето приложение това е най-искането нещо след самото виждане на сметката. Нищо в публикуваното ви API не разделя, обединява или премества.

**Как го прави barsy.** `Accounts_divide` взема старата сметка и редовете с количества, създава нова сметка с тях и връща идентификатора ѝ. `Accounts_merge` и `Accounts_mergebyplaceid` преместват редовете в най-старата сметка и затварят останалите празни; затворена или фискално отбелязана сметка не може да се обединява. `Accounts_move` премества отворена сметка към друга маса и/или друг служител, като без право на „директен трансфер“ служителят трябва първо да я приеме и дотогава и двамата я виждат.

---

## 7. Cancel or refuse a row, as a waiter would

*later — ref C48, C49*

**EN. What we need.** Refuse a row, or cancel a bill we opened, within the POS's own rules, with a reason; and an order that was never completed annulled but kept for the audit trail.

**Why.** The bar declines an order — the bottle is gone, the guest leaves. Someone has to undo it, and it should not be a waiter deleting our rows by hand. Fiscal rules also want the declined attempt kept, not erased.

**How barsy does it.** `Accounts_place` takes a `reason_id` from `Reasons_getlist`, which also says whether the item still leaves stock. For a bill already closed, `Accounts_storno` creates a reversing bill with its own УНП and a storno fiscal receipt, naming the reversed receipt; `Accounts_getstornoreasons` returns the standard reasons the fiscal device requires under Н-18, and the device refuses a storno without a valid one. (`methods/reasons/getlist.html`; methods `Accounts_storno`, `Accounts_getstornoreasons`)

**BG. Какво ни трябва.** Отказване на ред или анулиране на сметка, която сме отворили, по правилата на самия POS и с причина; и поръчка, която никога не е завършена, да бъде анулирана, но запазена за одитната следа.

**Защо.** Барът отказва поръчка — бутилката е свършила, гостът си тръгва. Някой трябва да го отмени, и това не бива да е сервитьор, който ръчно трие наши редове. Фискалните правила също искат отказаният опит да се запази, не да се заличи.

**Как го прави barsy.** `Accounts_place` приема `reason_id` от `Reasons_getlist`, който казва и дали артикулът излиза от наличност. За вече затворена сметка `Accounts_storno` създава сторниращa сметка със свой УНП и сторно фискален бон, посочвайки сторнирания бон; `Accounts_getstornoreasons` връща стандартните причини, които фискалното устройство изисква по Н-18, и устройството отказва сторно без валидна причина.

---

## 8. Tell us whether you can take an order and a payment right now

*blocking — ref C5, C7, C8, C9, C50*

**EN. What we need.** Before we take a guest's money: a call that says the cash desk is there, the cash period is open and the fiscal device is ready. Also, in writing, what the venue must set up before we may write at all, and which rights our API user and the venue's waiters each need. And what the end of the cash period does to an open bill and to a write in flight.

**Why.** A club's POS goes down, runs out of paper, or closes its period at 5am while a guest is paying. We would rather refuse politely in the app than take money the POS cannot fiscalise. Your `GET /api/Test` is a liveness ping; nothing in the API mentions a cash desk, a cash period, rights or the fiscal device.

**How barsy does it.** `Poses_getcurrent` returns the cash desk assigned to the API user and the fiscal printer's state, and a write needs a cash desk assigned by the venue's admin. `Misc_ping` and `Misc_ping_user` check reachability and credentials. (Method `Poses_getcurrent`: the cash desk of the current session — its id, name, venue, hall and the fiscal printer's state.) Our reading left open whether that state is enough to promise a receipt will print — a question we have for Lukanet too, and would ask you.

**BG. Какво ни трябва.** Преди да вземем пари от гост: заявка, която казва, че касата е налична, касовият период е отворен и фискалното устройство е готово. Освен това, в писмен вид: какво трябва да настрои обектът, преди да имаме право да пишем, и какви права са нужни на нашия API потребител и на сервитьорите. И какво прави краят на касовия период с отворена сметка и с заявка в движение.

**Защо.** POS в клуб спира, свършва хартията или периодът се затваря в 5 сутринта, докато гост плаща. Предпочитаме да откажем учтиво в приложението, вместо да вземем пари, които POS не може да фискализира. Вашето `GET /api/Test` е проверка за живост; никъде в API няма каса, касов период, права или фискално устройство.

**Как го прави barsy.** `Poses_getcurrent` връща касата, назначена на API потребителя, и състоянието на фискалния принтер, а записът изисква каса, назначена от администратора на обекта. `Misc_ping` и `Misc_ping_user` проверяват достъпност и достоверност на данните.

---

## 9. A refusal we can act on, and one row that cannot be sold

*blocking — ref C46, C47*

**EN. What we need.** When a write is refused, a machine-readable reason we can tell apart: bill closed, bill locked, item gone, no cash desk, period closed, item not sellable, payment not equal to the total, fiscal device unavailable. And when one row of an order cannot be sold, whether the whole call is refused or that row is dropped, with the item named.

**Why.** The guest is holding their phone waiting. "Something went wrong" is not an answer; "the Beluga is finished, the rest of your round is on its way" is. Your `404` with a `ResError` covers a failed item or customer check and names the guid, which is a good start — we would like the catalogue of the other reasons. (One small thing: the `ResError` body arrives as a double-encoded JSON string, which every client has to unwrap twice.)

**How barsy does it.** Our 10-18 reading did not settle this either: we have the same question open with Lukanet. So this is an ask of both of you, not a comparison.

**BG. Какво ни трябва.** При отказан запис — машинно четима причина, която можем да различим: затворена сметка, заключена сметка, изчерпан артикул, липсваща каса, затворен период, непродаваем артикул, плащане, различно от сумата, недостъпно фискално устройство. И когато един ред от поръчка не може да се продаде — отказва ли се цялата заявка, или този ред се изпуска, с посочен артикул.

**Защо.** Гостът чака с телефона в ръка. „Нещо се обърка“ не е отговор; „Beluga свърши, останалото от кръга ви идва“ е. Вашият `404` с `ResError` покрива неуспешна проверка на артикул или клиент и посочва guid, което е добро начало — бихме искали каталога на останалите причини. (Една малка бележка: тялото на `ResError` идва като двойно кодиран JSON низ, който всеки клиент трябва да разопакова два пъти.)

**Как го прави barsy.** Нашето четене от 10-18 не изясни и това: имаме същия отворен въпрос към Lukanet. Тоест това е молба и към двама ви, не сравнение.

---

## 10. Three things missing from the menu

*blocking — ref M8, M9, M10*

**EN. What we need.** Three gaps in what the menu read gives us, each of which we hit on the demo installation:

- **Which options an item allows.** `GetModifiers` lists the sets, but nothing links a set to an item, so a guest cannot choose a cooking degree or a mixer. On the demo, no item had any content at all, and `GetItemContent` answered `404`.
- **Allergens.** `GetAllergens` and `GetNomenclatureExtraInfo` both answered `204` with no body. Allergen information in writing is a legal requirement for us, not a nicety.
- **Whether an item may be sold.** `GetMaterialAvailablity` returns a bare number, and returned `0.0` for a drink on sale at a normal price. We cannot tell "none left" from "not counted", and we will not grey out drinks that are on the shelf.

**How barsy does it.** `Articlesupplements_get` returns the option groups of one combo article — required or not, minimum and maximum, and each option with its current price — which is exactly the link that is missing. `Modificators_getlist` returns the modifiers. `Articledetails_gettree` returns characteristic keys, among them "Алергени", which is how we map allergens. For sellability, `Articles_getlist` takes `limits_by_barsys`, per-venue for-sale exceptions — a flag that says whether an item may be sold here, which is what a menu needs, rather than a stock quantity nobody can interpret. (`methods/articlesupplements/get.html`, `methods/modificators/getlist.html`, `methods/articledetails/gettree.html`, `methods/articles/getlist.html`)

**BG. Какво ни трябва.** Три липси в това, което дава четенето на менюто, и трите срещнати на демо инсталацията:

- **Кои опции допуска един артикул.** `GetModifiers` връща групите, но нищо не свързва група с артикул, така че гост не може да избере степен на изпичане или добавка. На демото нито един артикул не имаше съдържание, а `GetItemContent` отговори с `404`.
- **Алергени.** `GetAllergens` и `GetNomenclatureExtraInfo` отговориха с `204` без тяло. Информацията за алергени в писмен вид е законово изискване за нас, не удобство.
- **Дали артикулът може да се продава.** `GetMaterialAvailablity` връща само число и върна `0.0` за напитка, която се продава на нормална цена. Не можем да отличим „няма наличност“ от „не се води на отчет“, а няма да скриваме напитки, които са на рафта.

**Как го прави barsy.** `Articlesupplements_get` връща групите опции на даден комбиниран артикул — задължителна или не, минимум и максимум, и всяка опция с текущата ѝ цена — точно връзката, която липсва. `Modificators_getlist` връща модификаторите. `Articledetails_gettree` връща характеристики, сред които „Алергени“, с което картографираме алергените. За продаваемост `Articles_getlist` приема `limits_by_barsys` — изключения за продажба по обект, тоест флаг дали артикулът може да се продава тук, което е нужното на едно меню, вместо количество наличност, което никой не може да разчете.

---

## 11. Two operational things

*later — ref C26, M12, C15, C17*

**EN. What we need.** A read that returns only what changed since last time, and a documented request limit so we can schedule our syncs inside it. And a written answer on the duplicate guard: your `409` on a repeated `ExtId` is the strongest thing on your write side and exactly the protection we need — we would like to know whether it holds when two identical calls arrive at the same moment, how long a code is remembered, and whether it is per venue or global.

**Why.** We sync menus for every venue on a schedule, and one of your calls (`GetMealPlans`) returned 49.7 MB on a demo restaurant because it has no date filter. We would rather not be the integration that hammers your customers' servers. And the duplicate guard is what stops a guest's round being added twice when the network drops mid-send.

**How barsy does it.** `Places_getlistwithaccountsonly` supports a checksum for an incremental refresh, and `Articles_getlist` pages with `order_by` and per-venue filters. Its documented limits we have not settled either; that question is open with Lukanet too.

**BG. Какво ни трябва.** Четене, което връща само промененото от последния път, и документиран лимит на заявките, за да планираме синхронизациите в неговите рамки. И писмен отговор за защитата от дублиране: вашият `409` при повторен `ExtId` е най-силното от записващата страна и точно защитата, която ни трябва — бихме искали да знаем дали държи, когато две еднакви заявки пристигнат едновременно, колко дълго се помни кодът и дали е по обект или глобален.

**Защо.** Синхронизираме менютата на всеки обект по график, а една от вашите заявки (`GetMealPlans`) върна 49,7 MB за демо ресторант, защото няма филтър по дата. Не бихме искали да сме интеграцията, която натоварва сървърите на клиентите ви. А защитата от дублиране е това, което пази кръга на гост да не бъде добавен два пъти при прекъсване на мрежата насред изпращането.

**Как го прави barsy.** `Places_getlistwithaccountsonly` поддържа контролна сума за постъпково обновяване, а `Articles_getlist` се страницира с `order_by` и филтри по обект. Документираните му лимити също не са изяснени за нас; този въпрос е отворен и към Lukanet.

---

## The three things that are not about the API

**EN.** Separately from the eleven above, and before any of them can be used at a venue:

1. **Authorisation.** Under Наредба Н-18, чл. 52з, ал. 5, a venue may not add outside modules to registered sales software without the producer's written authorisation, and Приложение 32, т. 17 asks the venue to declare its links to other systems. Will you authorise Restro as a linked module for ordering and payments at your customers' venues — on what terms, at what price, and what does the venue write in its Приложение 32 filing?
2. **A test installation.** Is `demorestaurant.zamboo.bg` a sandbox we may write test orders to? We have only read from it so far, and our rule is that development and tests never touch a live venue's POS or a real fiscal device.
3. **Keys.** Today one API key, passed in the query string, reads a venue's whole customer base by phone, email or loyalty card and can permanently delete customers and cards; `GetAttachedDbs` can return database connection strings. Are scoped keys possible — a key that may read the menu and act on bills but not touch customers — and can a key be sent in a header rather than in the URL, where it is written into every server log?

**BG.** Отделно от единадесетте по-горе и преди което и да е от тях да бъде ползвано в обект:

1. **Разрешение.** Съгласно Наредба Н-18, чл. 52з, ал. 5, обектът не може да добавя външни модули към регистриран СУПТО без писмено разрешение на производителя, а Приложение 32, т. 17 изисква деклариране на връзките с други системи. Ще разрешите ли Restro като свързан модул за поръчки и плащания в обектите на ваши клиенти — при какви условия, на каква цена, и какво вписва обектът в Приложение 32?
2. **Тестова инсталация.** `demorestaurant.zamboo.bg` тестова среда ли е, в която можем да записваме тестови поръчки? Досега само сме чели от нея, а правилото ни е, че разработката и тестовете никога не докосват POS на работещ обект или истинско фискално устройство.
3. **Ключове.** Днес един API ключ, подаван в адреса на заявката, чете цялата клиентска база на обекта по телефон, имейл или карта и може да изтрие безвъзвратно клиенти и карти; `GetAttachedDbs` може да върне низове за връзка с база данни. Възможни ли са ключове с ограничен обхват — ключ, който може да чете менюто и да действа по сметки, но не докосва клиенти — и може ли ключът да се подава в заглавна част вместо в URL, където попада във всеки сървърен журнал?

---

## Where each ask comes from

| Ask | Our requirements | Need |
|---|---|---|
| 1. Read a table's open bills | C22, C23, C24, C52 | blocking |
| 2. Add a round to an existing bill | C10, C54, C20 | blocking |
| 3. Tables | C13, C56 | blocking |
| 4. The POS prices it, the total reads back | C12, C35, C36 | blocking |
| 5. Close with a payment, and the fiscal receipt | C32, C34, C37, C39, C41, C42, C43 | blocking |
| 6. Split, merge, move | C27, C28, C29, C30, C31, C55, C56 | blocking |
| 7. Cancel or refuse a row | C48, C49 | later |
| 8. Can you take an order right now | C5, C7, C8, C9, C50 | blocking |
| 9. A refusal we can act on | C46, C47 | blocking |
| 10. Options, allergens, sellability | M8, M9, M10 | blocking |
| 11. Changed-only reads, the duplicate guard | C26, M12, C15, C17 | later / blocking |
| Not about the API: authorisation, a sandbox, keys | C4, C3, C1 | blocking |

That is all 26 blocking requirements the checklist marks absent, plus three it marks partly (C15 and C17 in ask 11, C46 in ask 9) and the three menu gaps. The 16 requirements marked *later* are deliberately left out: they can wait past the pilot, and a shorter list is likelier to be answered.
