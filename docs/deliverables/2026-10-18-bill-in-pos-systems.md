# What is a bill in POS systems in general?
### Research for the map "Ordering from the menu" (#29), ticket #31. Branch `research/bill-in-pos-systems`, never merged.

Question: how do common restaurant and bar POS systems model a bill, so Restro's own model of a bill knows no POS? Read on 2026-10-18 from each vendor's own documentation. barsy is the sibling ticket and is not covered here.

## The answers in short

1. **Is a bill tied to a table?** Not necessarily. In every system that exposes the field, the table is an optional attribute of the bill, not what the bill is. Toast's `table` on an order is optional; Lightspeed's `tableNumber` is not marked required; Simphony's `CheckTableObjectNum` is "when supported". Microinvest and Mistral/Zamboo are table-first in their screens, and neither says the table is optional. [DOC]
2. **Can a table hold several bills?** Yes, in every system that says anything about it. Toast keeps separate checks on one table after a transfer. Square creates a new check for one seat. Lightspeed's API returns "the oldest" open order when a table has several. Microinvest says it plainly: a new guest on an occupied table can have their own order and their own bill. Mistral/Zamboo splits a bill into several. [DOC]
3. **Can a bill exist with no table?** Yes, in the systems that document it: a named tab (Toast "tab name", Square open ticket with a ticket name, Simphony check "by ID" for bartenders, Lightspeed to-go orders). Mistral/Zamboo's page describes a bar tab that is later moved to a dinner table. Not documented in Microinvest. [DOC]
4. **Partial or early payment.** Almost everywhere a payment is a separate record that attaches to a bill, and a bill can carry several. The bill stays open until the balance is zero. Simphony, Lightspeed and uTill say so in their API or POS docs; Square says a split tender "isn't complete until there's no remaining balance". The documented ways to pay part are three: by amount, by equal shares, by named items (usually by first splitting the items onto a new bill). Toast and Mistral/Zamboo do not document a partial payment of an open check clearly. A deposit is a different thing and only Mistral/Zamboo and barsy document one. Bulgarian fiscal rules add a fixed shape for partial payments (see the fiscal section). [DOC]
5. **How an outside app's order enters.** Three patterns, all seen:
   - **A new bill each time.** Toast, Square and Lightspeed's "to-go" call create one new order/check per request. This is the easy path in all three.
   - **A round on an existing open bill.** Simphony (`AddToExistingCheck`), Toast (add selections to a check) and Lightspeed (a local order with the account's identifier) can do this. The caller must hold the bill's id; Simphony and Lightspeed identify it by number or by `accountIdentifier`, and Toast by the check's GUID.
   - **Held for staff approval.** Toast flags an API order as needing approval depending on the location's settings. Microinvest's phone app holds orders on the device until the waiter presses send.
   - Square is the exception: an order not created through its API "can't be updated", so an outside app cannot add a round to a ticket staff opened.
6. **Seats, splits, moves, merges.** Splitting by item and moving an item to another bill are everywhere. Splitting by seat and equal shares are in most. Merging bills is in most POS screens but is **not** in Toast's API. Moving a whole bill to another table is in most. Several of these are staff-screen functions, not API calls.

## How to read this document

| Tag | Meaning |
|---|---|
| [DOC] | Stated on the vendor's own documentation or help page, which is linked |
| [FORUM] | Stated by a vendor's staff on its developer forum. Weaker than the documentation |
| [SEARCH] | Seen only in a search result, page not opened. Not relied on |
| [READING] | My interpretation. Never fact |
| [NOT FOUND] | The source was read and is silent, or the page was unreachable |
| unknown | There is no documentation to check |

Terms in capitals are the vendor's own. Page numbers refer to the PDF's printed page where visible.

## Toast

Toast calls the pieces **order**, **check** and **selection**.

- An order holds one or more checks; most orders have one, and an order has several when guests split it to pay separately. The checks hold the items, prices and payments. [DOC] [Orders API overview](https://doc.toasttab.com/doc/devguide/portalOrdersApiOverview.html)
- **Table:** the order has an optional `table` that references a Toast table by GUID, and an optional `numberOfGuests`. A dining option (dine-in, takeout, curbside, delivery) is required. [DOC] [Order schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Order/). The overview says that for dine-in "you can specify a table", so a table is a choice, not a requirement. [DOC]
- **Tab (no table):** the check has a `tabName`, shown on the kitchen display. [DOC] [Check schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Check/). In the POS a tab is a running check named for a guest that orders are added to until it is paid; the article does not say a tab needs a table, and a tab opened by name alone saves no payment method. [DOC] [Start a Tab](https://support.toasttab.com/en/article/Starting-a-Tab-1492811100378)
- **Several bills per table:** moving a check onto a table that already has one makes Toast ask whether to merge or to keep them as separate orders on that table. [DOC] [Transfer Items, Checks, and Payments](https://support.toasttab.com/en/article/Transferring-Items-Checks-and-Payments); [SEARCH] for the exact wording of the prompt.
- **Splits and moves:** the API `split` call moves chosen items to a new check in the same order. A check with a payment cannot be split. Check-level discounts block the split. Even splits and partial quantities are not supported (use several payments on one check). **Checks cannot be merged through the API.** [DOC] [Split endpoint](https://doc.toasttab.com/doc/apiordersdraftdoc/apiOrdersSplitCheckEndpoint.html). In the POS, open checks with no payment can be combined; paid or closed checks cannot. A payment that was captured cannot be moved to another check. [DOC] [Transfer article](https://support.toasttab.com/en/article/Transferring-Items-Checks-and-Payments)
- **Outside order enters:** the API creates an order with a dining option and a check with at least one selection; payment is optional. The order's `source` reads `API`, and "depending on location configuration, the order may require approval before the kitchen receives it" (`approvalStatus` `NEEDS_APPROVAL`). [DOC] [First order](https://doc.toasttab.com/doc/devguide/apiOrdersFirstOrder.html), [Order object summary](https://doc.toasttab.com/doc/devguide/apiOrdersOrderObjectSummary.html). An app can also add selections to an existing check by posting to the check's GUID; closed orders become "restricted" after a while and then cannot take items. [DOC] [Adding items](https://doc.toasttab.com/doc/devguide/apiAddingItemsToACheck.html). An unpaid check is "OPEN"; the order is unpaid when no check has a payment. [DOC]
- **Payments from outside:** only `CREDIT` and `OTHER` (processed outside Toast) types; cash and Toast gift cards are not supported through the orders API. A check can take "one or more payments" in one request. A payment cannot be edited, except its tip. [DOC] [Orders API overview](https://doc.toasttab.com/doc/devguide/portalOrdersApiOverview.html), [Adding payments](https://doc.toasttab.com/doc/devguide/apiAddingPaymentsToACheck.html)
- **Unknown:** whether a payment smaller than the check total is accepted by the API. The pages say nothing about it. [NOT FOUND] Also unknown: how a partial payment shows on the POS.
- **Seats:** the POS can split by seat (table orders only) or evenly. [DOC] [Manage Payments](https://support.toasttab.com/en/article/New-POS-Managing-Payments)

## Square

Square's own terms drift by product and region: **order** in the API; **ticket**, **check** or **bill** in the help centre. [DOC] [Manage bills (AU)](https://squareup.com/help/au/en/article/6429-check-management-with-square-for-restaurants), [Manage checks (US)](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants)

- **Table:** the API `Order` has no table field. `ticket_name` is "a short-term identifier for the order, such as a customer's first name, a table number, or an auto-generated order number". [DOC] [Order object](https://developer.squareup.com/reference/square/objects/Order). In Square for Restaurants a check with a guest count is saved and stays on the floor plan, and dropping a table on an occupied table prompts to merge. [DOC] [Manage checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants)
- **Several bills per table:** yes in practice. A seat's menu has "Create new check", which moves that seat's items to a new check; "Transfer to Check" moves a seat to another check. [DOC] [Manage seats](https://squareup.com/help/us/en/article/8583-manage-seats-in-your-restaurant)
- **No table:** open tickets are saved orders you finish later, with a ticket name; the article does not mention tables. [DOC] [Open tickets](https://squareup.com/help/gb/en/article/5337-use-open-tickets-with-square). Open tickets over 500 items are marked full, and tickets open over 180 days are removed.
- **Splits, merges:** split by item, by seat (seat tracking must be on), equally, and one item into portions; the "Move ticket" function merges tickets. [DOC] [Split a check](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants), [Split and merge open tickets](https://squareup.com/help/us/en/article/8439-split-and-merge-open-tickets). Splitting a *payment* is by amount only, not by item. [DOC]
- **Partial / early payment:** the `PayOrder` call takes several payments on one order (split tender); each payment is created without auto-complete and then captured together. The order becomes `COMPLETED` only when the payments sum to the total. [DOC] [Pay for orders](https://developer.squareup.com/docs/orders-api/pay-for-orders). On the POS, "a split tender payment isn't complete until there's no remaining balance" and "must be completed within five minutes", or earlier payments could be voided. [DOC] [Split tender](https://squareup.com/help/article/5097-process-split-tender-payments-with-square). [READING] Square's split tender is a short checkout step, not a tab that stays partly paid for hours.
- **Outside order enters:** the Orders API creates a new order; the overview lists pickup, shipment, delivery and in-store fulfillments, and the order appears in the Order Manager once paid. [DOC] [Orders API](https://developer.squareup.com/docs/orders-api/what-it-does). An order that was not created through the API "has no version and can't be updated". [DOC] Order object. Creating an unpaid order and finishing it on the terminal is "isn't officially supported or documented" and varies by device and mode (Square staff, 18 Aug 2026), who point to taking payment through the API when the order is created. [FORUM] [thread](https://developer.squareup.com/forums/t/create-open-order-open-ticket-from-api/27237)
- **Unknown:** whether an outside app can append to an open ticket staff created: the object reference says no for orders created outside the API; the dine-in tab case is [NOT FOUND] in the documentation.

## Lightspeed Restaurant (K-Series)

Lightspeed K-Series calls the bill an **order** or **check** in the API and the **check**, **bill** or **receipt** in the staff help; an **account** is the system-wide record, and an **order profile** (`accountProfileCode`) is a preset type. [DOC] [Splitting a bill](https://k-series-support.lightspeedhq.com/hc/articles/360051089493-Splitting-a-bill), [Online Ordering API](https://api-docs.lsk.lightspeed.app/)

- **Table:** the Online Ordering API ("Order and Pay") has two ways to create an order. `POST /o/op/1/order/local` creates "a new dine-in order" and takes an optional `tableNumber` and `clientCount`. `POST /o/op/1/order/toGo` creates a takeaway or delivery order and has no table. [DOC] [Create Local Order](https://api-docs.lsk.lightspeed.app/operation/operation-apelocalorder), [spec](https://api-docs.lsk.lightspeed.app/source.json)
- **Several bills per table:** the "get open check by table" call returns "the oldest order" if there are several. So a table can hold more than one open order. [DOC] spec
- **Outside order enters, and a round on an open bill:** supplying `accountIdentifier` on the local order call updates the existing order instead of creating one; `tableNumber` and `clientCount` cannot be changed then. `thirdPartyReference` (1 to 48 characters) must be unique and a duplicate returns 409 Conflict. [DOC] Create Local Order. Whether the update adds items or replaces the item list is not stated. [NOT FOUND]
- **Pay a bill:** `POST /o/op/1/pay` "adds a payment to an existing order". [DOC] spec. [NOT FOUND] whether it accepts less than the balance.
- **Partial / early payment in the POS:** at the table, the terminal asks for a table number or name; split equally, or unequally by entering each amount; after each payment the server chooses "Next split", "Pay later" or "Pay remainder". [DOC] [Pay at Table](https://k-series-support.lightspeedhq.com/hc/en-us/articles/5012416749211-Pay-at-Table). Splitting the check itself is by seat or by covers (equal). [DOC] [Splitting a bill](https://k-series-support.lightspeedhq.com/hc/articles/360051089493-Splitting-a-bill)
- **Unknown:** merging (a "merging split checks" article exists; its steps were not read) and an open account with no table in the POS. [NOT FOUND]

## Oracle MICROS Simphony

Simphony calls the bill a **guest check** (or **check**). Source: the Transaction Services API guide, release 19.2, F32377-02 (a PDF I read in full text: [guide](https://docs.oracle.com/cd/F32325_01/doc.192/f32377.pdf)). [DOC]

- **Identity:** a check is found by `CheckNum` (a number assigned by the workstation, in a range set in the configuration) together with `CheckSeq` (the database sequence). They "are used to reference the guest check in subsequent operations". `CheckID` is "a name to identify a check. Duplicate check names on open checks are not allowed". (Chapter 2 and structure reference, p. 6-2, 6-4.) [DOC]
- **Table:** `CheckTableObjectNum` is the "object number of dining table for which the check created". It also appears as modifiable "(when supported)" on add. There is also an **order type** (for example Dine-in or Carry-out), a **revenue center** and an **employee** on every check. [DOC] Whether a check may omit the table is **not stated** in the API guide. In the POS the first-key choices are: begin check by number (key 400), by table (401), or by guest check ID (435, "typically bartenders"). [DOC] [Beginning a check](https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_begin_close_check.htm). An employee-class option "Table Number Entry Required to Begin/Pickup Checks" is mentioned in a 19.7 guide [SEARCH], not opened.
- **Several bills per table:** [NOT FOUND] stated. Check names must be unique among open checks, check numbers are separate per check, and split checks become separate checks with their own number. [DOC] [Split Check](https://docs.oracle.com/en/industries/food-beverage/simphony-essentials/simsl/t_check_func_split_check.htm)
- **Splits, moves, merges:** the POS splits by moving or sharing menu items to another check; each new check gets its own check number and can be changed independently. [DOC] **Transfer** changes who owns a check (employee or revenue center); starting a transfer while a check is open merges the two checks instead. [DOC] [Check Transfers](https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_checks_transfers.htm)
- **Outside order enters, and a round on an open bill:** `PostTransaction` creates a check; with a tender of type **Service Total** the check is created open, with a **Payment** tender it is closed. `AddToExistingCheckEx2` "is used to add items or payments to a guest check previously created", adding items, applying "partial or full payment", or a coupon, identified by `CheckNum` and `CheckSeq`. (Chapter 2, "Add to Transaction", pp. 2-3 to 2-6.) [DOC]
- **Partial / early payment:** "a tender with partial payment will still have the created check in the Open state only"; another tender for the balance can be added later with `AddToExistingCheckEx`. (Chapter 7, p. 7-12.) [DOC] This is the clearest statement of the model in any source read here.
- **Reading checks:** `GetOpenChecks` lists open checks; `GetChecks` takes a filter; `GetCheckDetail` returns one. (Chapter 3.) [DOC]
- **Unknown:** approval by staff (not in this guide), and whether table is mandatory for a dine-in order type.

## Microinvest (Bulgaria)

Microinvest's restaurant software is a front office, **Склад Pro Light в режим „Ресторант"**, over a back office, **Склад Pro**, with a mobile ordering app, **Microinvest Restaurant за Android**. Public manuals (in Bulgarian):

- Склад Pro Light: [manual](https://microinvest.net/Documents/1/Microinvest_Warehouse_Pro_Light.pdf). Android: [manual](https://microinvest.net/Documents/1/Android_Restaurant_BG.pdf). I found no separate "Ресторант Pro" manual. [DOC]
- **Terms:** an **order** is **поръчка**; the bill is **сметка**; the table is **маса**; the guest is **клиент** (partner). The restaurant mode "has technology for opening an order, interim close of an order, adding new items to an existing order, and final close". [DOC] Pro Light manual, section "Режим Ресторант".
- **Round on an open bill:** *Междинно приключване* ("interim close") sends the kitchen/bar/customer slips and "can be done many times, because it causes a new accumulation of goods to the chosen bill. This is the operation to use when the client wants to add something." (Pro Light manual, restaurant mode, about p. 25.) [DOC] This is a round in Restro's sense.
- **Table, several bills:** *Откриване на сметка* is used "whenever a new client takes a table". For an unknown guest the waiter picks only a table; for a regular client, a client then a table. When a new client sits at an occupied table and wants a separate order and bill, the waiter picks them as a separate client, "so several different clients, each with their own order and individual bill, can be managed at one table". (Android manual, screen "Избор на маса и клиент", p. 26.) [DOC]
- **No table:** the Android manual says the current table can be left unset and chosen later. A bill with no table at all, for example a bar tab, is **not stated**. [DOC] / [NOT FOUND]
- **Splits, moves, handover:** a *разделяне на поръчки* function is for clients at one table paying separately, or when operators hand over their open bills; new interim slips are printed afterwards. [DOC] Pro Light manual about p. 26. The *отложено плащане* ("deferred payment") button opens a second bill so that a first client can keep choosing items. [DOC]
- **Partial payment:** closing a bill chooses a payment type and sends it to the fiscal device; "the open bill is closed". A "combined payment" button enters several amounts of types defined in the back office. Paying part of an open bill is **not documented** in what I read. [DOC] / [NOT FOUND]
- **Outside order enters:** the Android app keeps orders on the device and sends them to the central system when the waiter presses *Изпращане* ("send"); it needs Склад Pro, Склад Pro Light, *eMenu Pro* and an SQL database, and a waiter sees only their own orders. (Android manual, introduction and the last screen.) [DOC] That is "held until a person sends it", over a database link, not a public API. An outside API is **unknown**.

## Mistral / Zamboo (Bulgaria)

Mistral Software's POS is documented as **Zamboo**; the fiscal research on PR 12 found no public API. Pages: [Ресторант](https://help.zamboo.bg/restaurant), [POS](https://www.zamboo.bg/pos.html). [DOC] for the help page, [VENDOR PAGE] for the marketing page.

- **Terms:** сметка (bill), маса (table), *разделяне* (split), *обединяване* (merge), *преместване* (move).
- **Table:** the help text starts a sale as "choose a table, add items to the bill, and press Payment". Bills without a table (quick sale, bar) are not covered on that page. The marketing page describes a guest served at the bar whose tab is later moved to the dinner-table: "прехвърлете сметката на масата за вечеря". [VENDOR PAGE] So a bar tab exists before a table.
- **Several bills per table:** the page does not say outright. It splits one bill into several ("РАЗДЕЛИ СМЕТКА": move items to a new bill in a window with the original and the new bill) and merges bills ("ОБЕДИНИ", into a receiving table). [DOC]
- **Moving:** "ПРЕМЕСТИ" moves a whole bill to another table. [DOC]
- **Payment:** the marketing page promises "смесено плащане на всяка разделена сметка" (mixed payment on every split bill). [VENDOR PAGE] Partial payment needs a deferred payment (*ОТЛОЖЕНО ПЛАЩАНЕ*) to exist; "ЧАСТИЧНО ПЛАЩАНЕ" then takes an amount and a payment type on it. [DOC] So Zamboo's partial payment is a payment on a credit sale, which the fiscal research could not match with Н-18 чл. 26а.
- **Outside order enters:** Zamboo's own Web Menu sends orders to the POS [VENDOR PAGE] ([pricing](https://www.zamboo.bg/pricing-zamboo.html), as quoted by the fiscal research, not re-opened). A third-party app: **unknown**. Waiter-side mobile ordering is not described on the pages read.

## One more system, uTill (Netherlands), for partial payments only

uTill's manual: paying part of a bill leaves "the remainder open"; the paid amount is "deducted from the total and spread across all articles", a receipt prints, the table stays open. Splitting is in equal parts or per article. [DOC] [uTill payment](https://docs.untill.com/mikel/payment). Included because it names the mechanism the Bulgarian rule must meet.

## Not found: other Bulgarian restaurant POS with public docs

A Bulgarian-language search for other restaurant POS products with public documentation returned only a generic СУПТО definition (not a POS manual). No other system was documented well enough to read. barsy is covered in the sibling ticket.

## What Bulgarian fiscal rules add

From the fiscal research, `docs/deliverables/2026-10-17-pos-integration-requirements.md` (partial-payment parts only; the law text is in that file, not re-read here).

- Н-18 чл. 26а: partial payments may go to a fiscal-device department "ЧАСТИЧНИ ПЛАЩАНИЯ" with the goods in free text between "#" signs. At the final payment all goods are registered, then a value discount equal to the amount paid in parts. [LAW, per the research]
- A deferred payment ("резерв 2 – отложено плащане") is allowed only for an ИАСУТД or for an invoice-type receipt (чл. 25, ал. 5; чл. 26б, ал. 1). [LAW, per the research]
- Annex 29 т. 10: when a sale has more than one payment, each gets its own fiscal receipt and, for listed software, every receipt carries the same УНП (unique sale number). [LAW, per the research]
- The research reading: the law does not ask for the number of payers. Paying by **named lines** (as separate items on a new bill) avoids the чл. 26а department, which neither barsy nor Mistral/Zamboo documents. A "split the bill evenly" button would need that department. [READING in the research]
- Annex 42: on NRA-listed software, an outside order must be in the POS before the venue commits to it; the guest may see "accepted" only after the POS has it. A new round added to an open sale must stay traceable before and after the import. [LAW, per the research]
- [READING] For this ticket: a bill must have a stable sale reference (УНП), and payments are separate records, each with its own receipt. This matches how every POS above attaches payments to a bill.
- Unknown: whether any of the systems above print the чл. 26а department for an API-entered partial payment. [NOT FOUND]

## The concepts compared

"All" = every system read; "most" = four or more of the six in the table (uTill is not a column; its one row of facts is in its section). A dash means the sources read do not say.

| Concept | Share | Toast | Square | Lightspeed K | Simphony | Microinvest | Mistral/Zamboo |
|---|---|---|---|---|---|---|---|
| The bill itself (what is owed) | **All** | check | check / ticket / bill; order (API) | check / order; account | guest check (`CheckNum` + `CheckSeq`) | сметка | сметка |
| Container above it | Some | order (holds 1+ checks) | order (API) | order / account | — | поръчка (order) | — |
| A line on the bill | **All** | selection | line item | item line | menu item / combo | стока (item) | артикул |
| Payment as a separate record on the bill | Most | payment (`CREDIT`/`OTHER`) | tender / payment | payment | tender media | вид плащане | плащане |
| Bill stays open until paid | Most | `paymentStatus` OPEN | order OPEN | open check | Open state | открита сметка | открита сметка |
| Several payments on one bill | Most | yes ("one or more") | yes (`PayOrder`) | yes (split) | yes (partial tender, add later) | combined payment | mixed payment |
| Add items to an open bill (a round) | Most | add selections | POS only; API orders only | `accountIdentifier` update | `AddToExistingCheck` | междинно приключване | — |
| Table on the bill | Most | `table` (optional) | via `ticket_name` or floor plan | `tableNumber` (optional) | `CheckTableObjectNum` | маса | маса |
| Several bills on one table | Most | yes | yes | yes | — | yes | via split |
| Bill with no table | Most | tab name | open ticket + name | to-go order | check by ID | — | bar tab moved later |
| Name / label on a bill | Most | tab name | ticket name | table name or order profile | check ID (unique among open) | клиент (partner) | — |
| Guest count | Most | `numberOfGuests` | covers | `clientCount` | guest count | — | — |
| Split by item | Most | split endpoint | split by item | by seat | move item to a new check | разделяне на поръчки | РАЗДЕЛИ СМЕТКА |
| Split equally | Most | split evenly | yes | by covers; at table, equal | — | — | — |
| Split by seat | Some | by seat | by seat | by seat | — | — | — |
| Split a payment by amount | Some | — | yes (amount only) | unequal split | partial tender | — | partial on a credit sale |
| Merge bills | Most | POS only (not API) | move ticket | — | add/transfer | — | ОБЕДИНИ |
| Move a bill to another table | Most | transfer to table | drag table / merge | transfer table | — | — | ПРЕМЕСТИ |
| Hand over a bill to another staff | Most | transfer check | assign check | — | transfer (ownership) | handover on split | оператор on move |
| Owner / waiter on the bill | **All** | server | team member | server | employee | оператор | оператор |
| Order type / channel | Most | dining option | fulfillment | order profile | order type | — | service place |
| Outside order creates a new bill | Most | yes | yes | yes (to-go and local) | yes | via sync | own Web Menu only |
| Outside order held for approval | Some | `NEEDS_APPROVAL` | — | — | — | waiter presses send | — |
| Idempotency key from the caller | Some | `externalId` per line | — | `thirdPartyReference` (unique) | — | — | — |
| Deposit / reservation money on a bill | Few | — | — | — | — | — | reservations (no deposit step) |
| Bar tab with a saved card | Some | tab + pre-authorization | — | — | — | — | — |

## What this means for Restro's model [READING]

- A bill is a set of items owed plus a set of payments, that stays open until the balance is zero. This holds in every source. It does not need a table.
- The table, the guest name, the guest count, the seat and the order type are optional attributes of a bill. Model them as optional fields, not as the bill's identity.
- A table should be able to point at several open bills; Lightspeed and Microinvest both say this in their own words.
- A round is "add items to an existing open bill, identified by the POS's id for it". Simphony and Microinvest model it directly, Toast and Lightspeed allow it, Square does not for bills it did not create. The platform needs both "new bill" and "round on bill" as ways in, and must handle a POS that offers only the first.
- Partial payment is a payment record on an open bill, not a special bill state. Paying by named items is a split first; paying by amount or by share is a payment on the same bill. Bulgarian rules treat the share case differently.
- The id of a bill the POS gave is the only handle to add to it; Lightspeed and Simphony make the caller keep it. Restro must store it as the POS's id (backend only, rule 3).

## Unknowns that need a vendor answer

1. Toast: does the payments call accept less than the check total? Does a partial payment keep the check open?
2. Square: can any outside app append to an open ticket staff created? (the object page says no for non-API orders)
3. Lightspeed K: does an update with `accountIdentifier` add to the items or replace them? Can `Apply a Payment` take less than the balance?
4. Simphony: is the table mandatory for a dine-in order type? Is there an approval step before the kitchen?
5. Microinvest: can a bill be opened with no table? Is a part of an open bill payable? Is there any API for an outside order, other than the eMenu database link?
6. Mistral/Zamboo: everything about an outside API, a bill with no table, and several bills on one table (Q for T69).
7. Whether any of these print the Н-18 чл. 26а department for an API-entered partial payment (also in the fiscal research).
