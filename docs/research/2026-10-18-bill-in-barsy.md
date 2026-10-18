# What is a bill in barsy?

Research for wayfinder ticket #30 (map #29, "Ordering from the menu"). Written 2026-10-18 on branch `research/bill-in-barsy`; this branch is never merged. Planning research only: no code.

**Sources.** barsy's official documentation only: `docs.lukanet.com/barsy.help` (public) and `docs.lukanet.com/barsy.api`. No sign-in was attempted and no password typed. Every `barsy.api` page (every method, object, example and FAQ page) returns the login form when fetched without signing in, checked on 2026-10-18 for all pages named in this file. The only API-side material that is public is the page index `https://docs.lukanet.com/barsy.api/searchindex.js`.

**Tags on every fact**
- **[DOC]** stated on a public help page, URL given.
- **[INDEX]** only a word, method name or field name found in the public search index of a sign-in page. It proves the name appears on that page. It does not say what the page says.
- **[SIGN-IN]** the answer is on a page behind sign-in; the page is listed in "For ticket #34" at the end.
- **[NOT FOUND]** searched in the public help and index; no statement.
- **[READING]** my interpretation, not a fact.

**Words.** GLOSSARY.md has no entry for bill or round. This file says **bill** for barsy's *сметка* ("account" in the API names `Accounts_*`), **table** for a *място* (place) of type *маса*, and **round** for the lines a waiter confirms together. barsy has no word for a round: see Q4.

---

## Short answers

| Question | Answer | Status |
|---|---|---|
| What is a bill? | The one document of a sale. It holds the lines (items), the total, the payments, the table, the staff member and the status. One bill = one sale. | documented |
| Can a table hold several open bills? | barsy's venue mode lets staff keep many open bills at once and merge or split them, and its own API can merge all open bills of one table. It never says "one table, many bills" in a sentence. | partly documented; rest behind sign-in |
| Must a bill belong to a table? | No by use (counter, delivery, kiosk, web-shop bills exist). Whether the API field is optional is not public. | partly documented; rest behind sign-in |
| Can part of a bill be paid while the rest stays open? | Not as a normal staff action. The documented routes are: a deposit (*капаро*) paid before, an advance payment or package card used when closing, and one case where a failed second card payment leaves a locked, part-paid bill. A payment record can be added to a bill later. | partly documented; API behind sign-in |
| Split and move | Staff screens can move a bill to another table, merge and split bills. The API names `Accounts_move`, `Accounts_divide`, `Accounts_merge`, `Accounts_mergebyplaceid`, `Accounts_mergebyclientid`, `Accounts_clone` exist. What they do exactly is behind sign-in. | names [INDEX]; behaviour [SIGN-IN] |
| Reading a bill back | `Accounts_get` and `Accounts_getlist` carry total, paid, remaining, payments, order lines and history, and the table. Their field names are visible; the page text is not. | [INDEX] |
| Pay-first order | barsy has no single "pay first" concept. Its own QR menu opens a **new** bill for every order. Online payment can send the order to the kitchen only after payment. A bill can be created already closed through the API (the web-shop scenario), which produces its own receipt at closing. | documented in pieces |

---

## Q1. What a bill is, and how it relates to a table, a hall and a cash desk

- **A bill is the central document of a sale.** It describes one deal: which items were sold, to which client, by which user, "at which place (table, room)", the prices, the payments and the status. The header holds client, place, totals, delivery. The lines are "orders to the bill" (*поръчки към сметка*), one item per line. [DOC] [Сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account.html)
- **One bill is one sale.** "A sale is not a separate document with its own number. It is expressed through the account: one account record = one sale." [DOC] [Продажба](https://docs.lukanet.com/barsy.help/210-dictionary/sale.html)
- **A line is not a document.** A line has item, quantity, price, a flow (where it is prepared: kitchen or bar), modifiers, a note and a status (ordered, ready, served). A bill may hold lines in different statuses; the sale closes at bill level, not line level. [DOC] [Поръчка към сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account-order.html)
- **Life cycle.** *Open*: lines are added, prices and client change. *Closed*: payments balance (or credit, with the right), a fiscal receipt is issued, stock goes down. After closing the bill is not edited, only reversed (*сторно*) or corrected, with rights and audit. [DOC] [Сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account.html)
- **Where a bill comes from.** Directly at a cash desk; from a customer request (*клиентска заявка*); from a reservation; from a subscription; from a kiosk or the public portal. [DOC] same page.
- **Bill or customer request.** A customer request is an order accepted but not yet a sale: it has stages, can be dropped, and stock and fiscal come later. A diner ordering at a table gets a bill. A deposit is taken on the request and carried onto the bill when it becomes one. [DOC] same page. The FAQ page `200-faq/200-sales/account-vs-client-order` also exists [DOC, not read in full].
- **Table (place) and hall.** Halls (*салони*) are created in Settings » Places; inside a hall the venue places *places* of chosen types. The scheme lets staff tell "places, areas and halls where they can open bills for clients". [DOC] [Настройки на места](https://docs.lukanet.com/barsy.help/110-admin/180-settings/places/scheme_editor.html)
- **Place types** are a fixed list: table, bar stool, billiard, client pager, room, table for 4, table in perspective, other. [DOC] [Типове обекти](https://docs.lukanet.com/barsy.help/extra/place_types.html)
- **Zones** are sets of places used only to route "bills to approve" to the staff member responsible for the zone. A place belongs to at most one zone. [DOC] [Зони](https://docs.lukanet.com/barsy.help/120-posx/110-zones.html)
- **Cash desk (*каса*, POS terminal).** The device and profile through which a user registers sales and payments. Each cash desk is tied to one trading site (*търговски обект*), a hall and a set of peripherals (fiscal printer, drawer, KDS). Kinds: stationary, mobile (a waiter's tablet), and **personal** (assigned to one user, created automatically, "also used for limited API access by outside applications"). A waiter on a tablet serves table 7, but his turnover is booked under his personal cash desk, not the device. [DOC] [Каса](https://docs.lukanet.com/barsy.help/210-dictionary/pos.html)
- **Bill carries all of them.** `Accounts_get` lists `place_id`, `place_num`, `place_type_name`, `pos_id`, `pos_name`, `close_pos_id`, and the word for "hall" (салон) appears on the page. [INDEX] [searchindex](https://docs.lukanet.com/barsy.api/searchindex.js), page `methods/accounts/get` (sign-in)
- **API registration.** The API must be called from a cash desk registered for the trading site: the error "the current request must be sent from a registered cash desk for this trading site" has its own FAQ page, and `Poses_register`, `Poses_getcurrent` and `Poses_getlist` exist. [INDEX] pages `faq/91-posnotfound`, `methods/poses/*` (sign-in). The help page above ties this to the personal cash desk. [DOC]

Unknown: how the API chooses the hall; whether a hall can hold two cash desks' bills (the help says a desk links to one hall, nothing more). [NOT FOUND]

## Q2. Can one table hold several open bills? Can a bill exist with no table?

**Several open bills.**
- Mode *Заведение* (venue) of the sales screen offers "the possibility of many open bills at the same time, merging and splitting them". The shop mode offers "many open bills at the same time" too. [DOC] [Режим на каса](https://docs.lukanet.com/barsy.help/120-posx/011_mode_posx.html). This page says many open bills; it does not say "on one table".
- The sales screen lists "operations with bills (moving, merging, splitting, transferring)". [DOC] [Продажби](https://docs.lukanet.com/barsy.help/120-posx/index.html)
- barsy's own QR menu: "every new order automatically opens a new bill or customer request". [DOC] [Настройки на публичния достъп](https://docs.lukanet.com/barsy.help/110-admin/100-catalog/public/settings.html). Two scans of the same table's QR code therefore give two bills, unless a flow outside the public docs merges them.
- Method names that point the same way: `Accounts_mergebyplaceid` (merge open bills by table), `Accounts_mergebyclientid` (by client); `Places_getlist` has `accounts_count`; `Places_getlistwithaccountsonly` returns a table with its bills (`PlaceAccountsData`). [INDEX] pages `methods/accounts/mergebyplaceid`, `methods/places/getlist`, `methods/places/getlistwithaccountsonly`, `objects/placeaccountsdata`.
- [READING] These show barsy expects more than one open bill per table and has tools to join them. Whether the cash-desk screen stops a waiter from opening a second bill on a table that has one is not stated. [NOT FOUND]
- [SIGN-IN] The text of `Accounts_mergebyplaceid`, `Accounts_merge`, `Places_getlist`, `Places_getlistwithaccountsonly`, `PlaceAccountsData`.

**A bill with no table.**
- Bills are created "at a cash desk, a table, delivery, etc."; the sale is also made from a customer request, a reservation, a subscription, a kiosk or the public portal. Shop sales ("quick sale at the counter") and delivery orders are bills. [DOC] [Продажба](https://docs.lukanet.com/barsy.help/210-dictionary/sale.html), [Сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account.html)
- Web-shop orders can be recorded as an open bill or a closed bill created through the API. [DOC] [Отразяване на клиентска заявка](https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html)
- [READING] Counter, delivery and web-shop bills have no table, so a bill does not need one. The page for creating a bill via the API lists `place_id` and `delivery_zone_id` as fields [INDEX]; whether `place_id` is required is [SIGN-IN] (`methods/accounts/create`, `methods/accounts/place`, `objects/accountinputdata`).

## Q3. Paying part of a bill while the rest stays open

What the public help says, each separately:

1. **Payments are records tied to a bill.** One bill can have one or more payments (tab "Payments" in the bill view). A bill that is not paid has no payment attached, and the amount is drawn from the client's wallet (a debt); the payment "can be added later when it really happens" through "New payment". [DOC] [Плащания към сметка](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/payments.html)
2. **Closing needs balanced payments.** "To close a bill the sum of linked payments (except with special rights) must cover the total." A payment can be in several methods: cash, card, mixed, wallet. [DOC] [Плащане](https://docs.lukanet.com/barsy.help/210-dictionary/payment.html)
3. **Mixed payment** at closing: the "Mixed" button turns the methods into amount fields so several methods form the total. [DOC] [Смесено плащане](https://docs.lukanet.com/barsy.help/200-faq/200-sales/smeseni-plashtania.html)
4. **A part-paid open bill exists in one documented case.** If a mixed payment by two cards fails on the second card, the bill is saved, the first payment is recorded, and the bill is **locked**: no lines can be added, removed or changed. The operator sees the remaining amount and can choose another method, or unlock the bill (with rights) to correct it. If a guest then refuses the whole bill, the rest is closed "fictitiously in cash" and the whole bill is reversed in cash so the fiscal device is right. [DOC] [Плащане с POS терминал](https://docs.lukanet.com/barsy.help/120-posx/pos_terminal_cases.html)
5. **Deposits (*капаро*).** Two routes. (a) *Advance payment*: a payment of the client without a bill, loaded to the wallet, then picked with the "Advance payment" button when closing a later bill; if it covers part, the "paid now" field shows the remainder. (b) *Package card* "Капаро": sold as an item with its own receipt and barcode, and later used on a bill as a negative line; the final receipt is for the sum minus the deposit. A used deposit cannot be used again. [DOC] [Отложено плащане](https://docs.lukanet.com/barsy.help/220-workflows/10_payments.html), [Как да ползваме капаро](https://docs.lukanet.com/barsy.help/200-faq/200-sales/kaparo.html)
6. **Deposit on a customer request:** recorded on the request (with a fiscal receipt under sales-software rules), carried onto the bill when the request becomes one; only the remainder is paid. [DOC] [Плащане](https://docs.lukanet.com/barsy.help/210-dictionary/payment.html)
7. **A payment without a bill ("free payment").** It can be hooked later to a bill or request; useful for an advance when the bill is not yet known. [DOC] same page.
8. **Payment link.** Lets a guest pay "a specific bill or customer request" online; the payment shows in the bill's Payments tab. It needs the paid "public cash desk" resource and an extra billed cash desk. [DOC] [Линкове за плащане](https://docs.lukanet.com/barsy.help/110-admin/100-catalog/public/payments-links.html). `Accounts_getpaymentlink` has `request_sum` and its page carries words for "the table", "the remainder" and "parts". [INDEX] `methods/accounts/getpaymentlink`. [READING] A payment link may allow paying part of the remaining bill; the page behind sign-in decides. [SIGN-IN]
9. **API.** `Payments_create` has `account_id`, `client_id`, `paid_sum`, `paymethod_id`, `payment_type`; `Accounts_place` carries `payment_data`, `paymethod_id`, `actual_paid_sum`, `original_paid_sum`, `flag_close_account`, `print_receipt`, `print_ship`; `Accounts_close` carries `payment`. [INDEX] pages `methods/payments/create`, `methods/accounts/place`, `methods/accounts/close`, `objects/accountpaymentinputdata`. The 2026-10-17 fiscal research recorded from a signed-in read on 2026-10-08 that, through the API, payments were accepted only when closing and `print_receipt` was a local print. That is a secondary record, not re-verified here. [REPO 10-08 via `docs/research/2026-10-17-pos-integration-requirements.md`, branch `origin/ad/research-fiscal-rules`, row "Register an app payment" and P1.2]

Receipt timing: at closing the bill, "a fiscal receipt is issued". Nothing public says a payment on a still-open bill prints a receipt. [DOC] [Сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account.html); [NOT FOUND] for a receipt on a part payment of an open bill.

[READING] Summary: barsy has no ordinary "pay part of the table's bill and keep it open" action in the public help. It has deposits and advance payments used at closing, payment records added to a bill, and (by name) payments through the API. Whether the API accepts a payment on an open bill without closing it, and what then prints, are the open questions for ticket #34 and for Lukanet (the fiscal rule for partial payments is in the fiscal research, P2.3).

## Q4. Rounds, rows and the bar ticket

- Waiter steps: pick the table, pick items, press **Confirm** if the bill stays open and the client will order more; press **Close** to pay. Confirm creates the bill with the entered lines and it stays open for more orders. [DOC] [Продажби](https://docs.lukanet.com/barsy.help/120-posx/020-sale.html), [Нова продажба](https://docs.lukanet.com/barsy.help/200-faq/200-sales/nova-prodajba.html)
- Lines go to the kitchen or bar by their flow; the dictionary example "add one more salad to table 5" is a new line in the open bill. [DOC] [Поръчка към сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account-order.html)
- barsy has **no object called a round** in the public help. A round is the set of lines added in one Confirm. [NOT FOUND] for any grouping field.
- `Accounts_get` shows `orders_history`, `last_order_num`, `next_service_status`, `service_status_id`/`name`. [INDEX] `methods/accounts/get`. [SIGN-IN] what they are.
- Edits to an open bill are kept in a history; lowering a quantity requires a reason, and some reasons take the item out of stock. [DOC] [Корекция на отворена сметка](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/02-otkaz.html)
- Whether `Accounts_place` with an existing `account_id` appends lines to an open bill: the field `account_id` is on the page's index entry [INDEX]; behaviour [SIGN-IN].

## Q5. Splitting and moving bills

- **Move a bill to another table (UI):** select the table, "Move", choose "Table", name the new table, Confirm. [DOC] [Местене на сметка](https://docs.lukanet.com/barsy.help/120-posx/025-account-move.html)
- **Split, merge, clone open bills:** listed as a capability of the account document and of the sales screen. No help page describes the steps. [DOC] [Сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account.html), [Продажби](https://docs.lukanet.com/barsy.help/120-posx/index.html); [NOT FOUND] for a how-to
- **API names:** `Accounts_divide`, `Accounts_merge`, `Accounts_mergebyplaceid`, `Accounts_mergebyclientid`, `Accounts_move`, `Accounts_clone`. [INDEX] [Accounts index](https://docs.lukanet.com/barsy.api/methods/accounts/index.html) (sign-in, names via search index)
- Index words on `Accounts_divide`: `old_account_id`, `storno_of_account_id`, `client_id`, `articles`, `quantity`, and words for "separate the table", "part", "paid", "open account". [INDEX] `methods/accounts/divide`. Index words on `Accounts_move`: `account_id`, `place_id`, `Places_getlist`. [INDEX] `methods/accounts/move`. [SIGN-IN] what each does, what it returns, whether splitting by item and by amount are both possible.
- Reversal (*сторно*) of a closed bill and of a payment exist in the staff screens, with limits by payment method. [DOC] [Сторно](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/05-storno.html) (listed in the Accounts index, not read in full)

## Q6. Reading a bill back

`Accounts_get` and `Accounts_getlist` show, by field name [INDEX] (pages are sign-in): `account_id`, `account_num`, `place_id`, `place_num`, `place_type_name`, `pos_id`, `pos_name`, `close_d…`, `close_pos_id`, `person_id`, `client_id`, `service_status_id`, `total_sum`, `total_sum_after_row_discount`, `total_paid`, `total_remain`, `payments_count`, `payments_history`, `orders_history`, `payment_print_data`, `unp`, `delete_flag`; `Accounts_getlist` also `list_open` and an output-screen/confirmation flag. `Places_getlistwithaccountsonly` returns tables with the same bill data. [INDEX] pages `methods/accounts/get`, `methods/accounts/getlist`, `methods/places/getlistwithaccountsonly`, `objects/accountdata`, `objects/placeaccountsdata`.

[SIGN-IN] types and meaning of every field, filters of `Accounts_getlist` (`AccountsListFiltersData`), whether open bills of one table can be read in one call, and paging.

## Q7. What changes for a pay-first order?

- **No separate pay-first mode in the public help.** The nearest documented pieces:
  1. **Approval mode "Directly after payment"** for orders that arrive from an outside system (public menu, an integrated digital menu or website): the order is sent to the printers and screens only after payment is made. Other modes: none, manual, automatic ("on online payment the approval is skipped; if the order is 'pay on delivery' it follows manual approval"). [DOC] [Настройка на сметки / одобрение](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/04-approval-orders.html)
  2. **Own bill per order.** barsy's public QR menu opens a new bill (or a customer request) for each new order, on a special "public user"; a QR or online order left unpaid is stored on that user, and at closing the site the manager can annul all such unpaid bills at once. [DOC] [Настройки](https://docs.lukanet.com/barsy.help/110-admin/100-catalog/public/settings.html), [Приключване на ТО](https://docs.lukanet.com/barsy.help/200-faq/240-settings/close-period.html). The same page states a scan shows "You are ordering from table No. 8", and each place has its own public URL. [DOC] [QR](https://docs.lukanet.com/barsy.help/110-admin/100-catalog/public/qr-orders.html)
  3. **Zones:** an order from a QR code appears only to the user responsible for the zone of that table; if no one holds the zone, everyone sees it. [DOC] [Зони](https://docs.lukanet.com/barsy.help/120-posx/110-zones.html)
  4. **API ways to record an outside order:** (a) create a customer request (`Clientorders_create`); (b) create an open bill (`Accounts_create`, `Accounts_place`); (c) create a bill that is **already closed** (same methods), so quantities drop at once; (d) a stock transfer. Scenario 3 (closed bill) needs no staff to process the order, with the drawback that false orders cannot be checked first. [DOC] [Сценарии](https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html)
- **Receipt.** The fiscal receipt is issued when a bill closes, so a bill created already closed has its own receipt; a request's deposit has one "with sales software". A customer request does not produce a receipt until its bill closes. [DOC] [Сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account.html), [Плащане](https://docs.lukanet.com/barsy.help/210-dictionary/payment.html). Which fiscal device prints when the API closes a bill is not stated in the public help. [NOT FOUND] (also in the fiscal research, P1.2)
- **Card-not-present payment method** exists: "Карта(неприсъствена)" and "Карта(присъствена)". [DOC, via fiscal research row G4] How an API payment of that type is fiscalised is not documented. [NOT FOUND]
- [READING] In barsy, pay-first with its own receipt is a **separate bill created and closed in one step**, or a separate bill held by the "pay first, then process" approval mode. Putting a paid item onto the table's still-open bill without printing a receipt for it is not a documented path. [SIGN-IN] decides whether the API allows a payment on an open bill (Q3).

---

## What stays unknown from public pages

1. Is `place_id` required to create a bill through the API?
2. Does `Accounts_place` with an existing `account_id` add lines to an open bill, or only create?
3. Can the API pay part of an open bill without closing it? What prints then?
4. Exact behaviour of `Accounts_divide`, `Accounts_move`, `Accounts_merge*`, `Accounts_clone`.
5. Whether the cash-desk screen blocks a second open bill on one table.
6. Which fiscal device prints when the API closes a bill; per-payment receipts.
7. Whether barsy's own QR menu adds to an existing open bill of that table (the settings page says each new order "opens a new bill or request"; any exception is not public).
8. Round: no grouping field known.

## For ticket #34 (pages behind sign-in to read)

API pages, base `https://docs.lukanet.com/barsy.api/`:
- `methods/accounts/index`, `create`, `place`, `close`, `divide`, `merge`, `mergebyplaceid`, `mergebyclientid`, `move`, `clone`, `get`, `getlist`, `getpaymentlink`, `createfromclientorder`, `servicestatusgetlist`, `storno`, `getstornoreasons`, `getbytaxes`, `save_notes`
- `methods/places/index`, `getlist`, `getlistwithaccountsonly`
- `methods/payments/create`, `getlist`; `methods/paymentmethods/getlist`
- `methods/clientorders/create`, `get`, `setstatus`, `getpaymentlink`
- `methods/poses/register`, `getcurrent`
- `objects/accountdata`, `accountinputdata`, `accountpaymentinputdata`, `accountslistfiltersdata`, `placedata`, `placeaccountsdata`, `paymentinputdata`, `paymentdata`, `paymentmethoddata`
- `examples/accounts`, `faq/40-account-create-multidelivery`, `faq/41-account-create-duplicate-protection`, `faq/91-posnotfound`
- `integrations/40-webhooks`

Questions to put to the signed-in read: items 1–7 above, plus the paging and filters of `Accounts_getlist`.

## Public help pages used

All under `https://docs.lukanet.com/barsy.help/`: `210-dictionary/account`, `sale`, `account-order`, `payment`, `pos`; `120-posx/index`, `011_mode_posx`, `020-sale`, `025-account-move`, `110-zones`, `pos_terminal_cases`; `110-admin/180-settings/places/scheme_editor`; `extra/place_types`; `110-admin/160-pos/accounts/payments`, `02-otkaz`, `04-approval-orders`; `110-admin/100-catalog/public/settings`, `qr-orders`, `payments-links`; `200-faq/200-sales/nova-prodajba`, `kaparo`, `smeseni-plashtania`; `200-faq/240-settings/close-period`; `220-workflows/10_payments`, `90-eshop`.

## Out of scope here

How POS systems in general model bills, tables and parts of a bill is a separate ticket of the map. This file is barsy only.
