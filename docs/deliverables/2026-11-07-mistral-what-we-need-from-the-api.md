# What we need from the Zamboo API

Restro is a QR-to-phone ordering app: the guest scans the code on their table, sees the venue's menu and orders from their phone; when they pay, the venue's fiscal device has to print.

We have read the published `Zamboo api v1` description in full (OpenAPI 3.0.4, 45 operations, 42 schemas) and made read-only calls against the demo installation. The menu reads well. The eleven points below are what we could not find for ordering and paying at a table, and after them eleven questions about behaviour the description does not settle. Each point says what is not in the description, why we need it, and how barsy's API does the same thing — not as a comparison of products, but because a working precedent is the quickest way to show what we are asking for. The barsy pages sit behind their integrator sign-in, so each point summarises what the page says as well as linking it.

Everything here is read from the description, so where a capability exists and we simply could not see it, say so and the work is ours. **The question underneath all of it: is there a second interface for tables and open bills, and will you open it to us?** Your Zamboo web interface appears to apply actions to an open bill from a browser — if that is right, the capability already exists inside your product and what we need is the documentation and permission.

**If you answer only one thing, answer the first question in the second half** — what `SaveOrder` prints and returns. If it already issues a fiscal receipt and can hand the reference back, points 3, 4 and 5 all change shape.

---

## 1. A table on the order, and the venue's list of tables

**Not in the API description.** Nothing carries a table. `BillDto` has no table field, and the word does not appear anywhere in the description (the only matches are inside "selectable").

**Why we need it.** Our whole product is a QR code on a table. The guest scans table 7, and the order, the bar's ticket and the waiter all have to arrive at table 7. Without a table on the order there is nothing to route, and a venue with forty tables cannot use us at all. We also need to know which bar or hall serves each table, because that is what decides where the round prints; we read that from the POS and never let the venue retype it in Restro.

**How barsy does it.** [`Places_getlist`](https://docs.lukanet.com/barsy.api/methods/places/getlist.html) returns the venue's tables, rooms and halls, each with an id we store. A bill carries `place_id` as an optional field, so an order can go to a table or to none. [`Places_getlistwithaccountsonly`](https://docs.lukanet.com/barsy.api/methods/places/getlistwithaccountsonly.html) returns only the tables that currently have an open bill, which is what a floor view needs, and it supports a checksum so an unchanged table can be skipped on a refresh.

## 2. Reading a table's open bills

**Not in the API description.** No endpoint returns a bill: `BillDto` appears only as the request body of `SaveOrder` and `SaveOrderDefPrice`, never in a response. `GetOrderSales` is a sales report over a date range — items sold with a date and an hour. Its rows carry `orderGuid`, so a sale can be found by the GUID you returned to us, but nothing can be found by the `ExtId` we chose, and nothing names the operator.

**Why we need it.** A guest ordering their third round has to see what is already on the table, and we have to add to the right bill rather than start a new one. Every other point depends on this one. Four things we need on the bill, beyond its rows and its totals:

- **Lookup by our own reference.** After a timeout we have to find out whether the round we sent landed before we risk sending it twice. We can only do that by the `ExtId` we generated, because a GUID we never received is no use to us.
- **How a row that staff removed reads back** — a negative row, a row netted down, or a status. Before we capture a card payment we re-read the bill, and we must be able to tell a line the bar voided from a line someone moved to another bill. We lower what we charge a guest only on the first.
- **When the bill was opened.** We never add a guest's order to a bill left open from the night before; with no opening time, that check simply cannot run.
- **Which rows are ours.** Per row, the time and the user who entered it, so we can tell our own rounds from the waiter's.

**How barsy does it.** [`Accounts_getlist`](https://docs.lukanet.com/barsy.api/methods/accounts/getlist.html) takes filters including the table and the open status, and returns each bill with its rows, its total before and after discounts, the sum paid, the sum still owed, its status, and whether it is locked for editing. Each row carries the article, the quantity, the price used, the time and the name of the user who entered it.

## 3. Adding a round to a bill that is already open

**Not in the API description.** `SaveOrder` and `SaveOrderDefPrice` always create a new standalone sale. No call appends to an existing one.

**Why we need it.** A table orders five or six times across a night. If each of our orders becomes its own sale, the waiter who walks over with the bill cannot see what the guests ordered from their phones, and the venue spends the end of the night reconciling by hand.

**How barsy does it.** One method does both: [`Accounts_place`](https://docs.lukanet.com/barsy.api/methods/accounts/place.html) with an `account_id` appends rows to that open bill; without one it opens a bill and returns its number. The call carries the table, a title the staff see, a note that is not printed, a description that is printed on the receipt, and our own unique code for the order.

## 4. The POS prices the order, and gives us the total back

**Not in the API description.** `price` is required on every `BillRowDto`. `SaveOrderDefPrice` fills one in where we send zero, but its description says it loads the material's **base** price — not the price in force at one in the morning during a promotion. No call returns the total the POS applied.

**Why we need it.** A club's prices move during the night — happy hour, a promotion, a discount on one table — so the price from our last sync is not what the venue charges, and the base price is not either. Before we take a guest's money we have to show them a total the POS agrees with, not one we calculated ourselves.

We may be close here already: `BillRowDto.timeDiscount` is an `AppliedTimeDiscount` carrying `campaignName`, `regularPrice`, `priceListPrice`, `unitPrice` and `appliedAt`. Does the server compute and return that when we save a row, and does it apply the campaign price rather than the base price? If so this point is mostly answered and we have simply misread it.

**How barsy does it.** [`Accounts_place`](https://docs.lukanet.com/barsy.api/methods/accounts/place.html) sent without a price uses the article's current price in the POS, so the POS stays the authority on money. The bill then reads back through [`Accounts_getlist`](https://docs.lukanet.com/barsy.api/methods/accounts/getlist.html) with its final total after prices and discounts, which is the figure a payment is matched against.

## 5. Closing a bill with a payment, and the fiscal receipt

**Not in the API description.** `BillDto` carries `paymentKindGuid` and `sumPaid`, so an order can be sent as paid — but the description does not say what that does, whether anything is settled, or whether a receipt is issued. Nothing closes a bill, nothing mentions a fiscal device, and the only thing returned is an internal operation GUID. `PaymentKindDto.typePayment` is a `TypePaymentEnum` of sixteen values, none of them named, so we cannot tell which one means a card.

**Why we need it.** A guest paying in our app is paying at the venue, and Bulgarian law requires a fiscal receipt for that. We never tell a guest their payment succeeded before the POS has handed us a receipt reference. Otherwise a venue could take money with nothing printed, which is the one mistake we cannot make. Concretely we need back, on the close: the sale's unique number, the receipt number, the device number, and the date and time. And where several bills sit behind one table and the guest pays everything, we need to know whether that is one close with one receipt or a close per bill.

**How barsy does it.** [`Accounts_close`](https://docs.lukanet.com/barsy.api/methods/accounts/close.html) takes the payments, prints the fiscal receipt on the venue's configured device, updates stock, and leaves the bill read-only afterwards. A payment names its method and its type (card present, card not present, cash and so on), carries a flag marking it as performing a fiscal operation, and keeps the provider's transaction reference; the receipt's print data reads back with the payment through [`Payments_getlist`](https://docs.lukanet.com/barsy.api/methods/payments/getlist.html), and the sale's unique number reads back on the bill.

## 6. Splitting a bill, and moving it

**Not in the API description.** Nothing moves rows between bills.

**Why we need it.** Six people at a table and one leaves early, wanting to pay for their own two drinks. A waiter does this at the POS in seconds, and in the app it is the most asked-for thing after seeing the bill at all. Splitting is the one the guest needs; merging and moving stay with staff. Four details decide whether we can offer it safely: can a split name the exact row, or only an item and a quantity — and if two rows hold the same item, which one does it take? Which table does the new bill land on? What happens if the quantity has already gone? And is a split followed by a close one request or two, because between two requests someone else can pay. One more: when a bill carries a discount on the whole bill rather than on rows, what happens to that discount if part of it is split off? Until we know, we have to tell the guest to ask a waiter at any discounted table.

**How barsy does it.** [`Accounts_divide`](https://docs.lukanet.com/barsy.api/methods/accounts/divide.html) takes the original bill and the items with quantities to move, creates a new bill from them and returns its id; that new bill is then paid and closed on its own. [`Accounts_move`](https://docs.lukanet.com/barsy.api/methods/accounts/move.html) moves an open bill to another table or another member of staff.

## 7. Cancelling a row before the bill is closed

**Not in the API description.** No endpoint refuses a row or cancels an order. `BillRowDto` does carry `deletedQty` and `status`, neither of them explained — do those do this, and do they work after the order has been saved?

**Why we need it.** The bar declines a round because the bottle is finished, or the guest leaves before it arrives. Someone has to undo it without a waiter hand-deleting our rows, and the declined attempt has to survive for the audit trail rather than disappear. To be clear about the limit: reversing a bill that is already closed, and refunding, stay with the venue's staff at the till. We only need to read that it happened, never to do it ourselves.

**How barsy does it.** An order row can carry a reason chosen from the list the POS supplies through [`Reasons_getlist`](https://docs.lukanet.com/barsy.api/methods/reasons/getlist.html), which also states whether the item still leaves stock.

## 8. Asking whether an order can be taken right now

**Not in the API description.** `GET /api/Test` is the only endpoint with no summary and no description, and it returns `200` with no body, so we assume it is a liveness ping. Beyond it the API has no cash desk, no cash period, no fiscal device state and no rights.

**Why we need it.** A POS loses its network, runs out of paper, or closes its cash period at 5am while a guest is paying. We would much rather tell the guest "pay at the bar tonight" than accept money the POS cannot fiscalise.

**How barsy does it.** [`Poses_getcurrent`](https://docs.lukanet.com/barsy.api/methods/poses/getcurrent.html) returns the cash desk the session is working on — its venue, its hall and the fiscal printer's state — and a write requires a cash desk assigned to that user by the venue's administrator, so a misconfigured venue fails before a guest is ever involved. [`Misc_ping_user`](https://docs.lukanet.com/barsy.api/methods/misc/ping_user.html) checks reachability and credentials separately from that.

## 9. Reading an item's choices when the item is not an operation

**This one may be our misreading, so it is a question first.** `GetItemContent` does return what we need: `MaterialContentApiDto` → `steps[]` → `materialChooser`, with `title`, `qtyLimit`, `maxQty`, `rowQtyLimit` and a priced `materialList`. Your own sample response shows "Choose a bun". That is exactly the shape we want.

The trouble is reaching it. Your description says the `404` with `ErrorCode 107` means the item was not found **or the item is not an operation**, and every drink we tried on the demo installation answered `404`. So: how do we read the choices for an item that is not an operation — a gin that needs a tonic chosen? Is `GetAllSelectableItems` that mechanism, and if so what does it return? `GetModifiers` gives us the modifier sets with their values inline, but nothing we found links a set to an item.

**Why we need it.** A guest ordering a gin has to pick the tonic, and a steak has to carry its cooking degree. If we cannot tell which options an item allows, we either offer none and the order is wrong at the bar, or offer all of them and the order is nonsense. Our rule is that an item whose required choice we cannot read is withdrawn from the phone and the guest is told to order it from a waiter — so this question decides how much of the menu is orderable at all.

**How barsy does it.** [`Articlesupplements_get`](https://docs.lukanet.com/barsy.api/methods/articlesupplements/get.html) returns the option groups of one article for any article, not only a composite one: whether a group is required, its minimum and maximum number of choices, and each option with its current price.

## 10. Allergens that arrive, and that we can match

**Partly there.** `GetAllergens` exists, takes a `materialGuid` and declares `200` with `AllergenDto[]` — but on the demo installation it answers `204` with no body, for every item we tried, and `204` is not in the description. `GetNomenclatureExtraInfo` does the same.

Two questions, then. Why does a documented `200` come back as an empty `204` — is the demo simply unpopulated, or does the endpoint need something we are not sending? And `AllergenDto` carries only `name` and `altName`, no code: are those free text typed by the venue, or a fixed list? We have to match what you send onto the fourteen allergens the law names, and matching free Bulgarian text written by each venue is not something we would stake a guest's allergy on.

**Why we need it.** Allergen information in writing is a legal requirement for us, and on a phone menu there is no waiter standing there to be asked. A venue that cannot show it cannot sell food through us.

**How barsy does it.** Article characteristics come back from [`Articledetails_gettree`](https://docs.lukanet.com/barsy.api/methods/articledetails/gettree.html) as a tree of keys and values, among them "Алергени", which we map onto the fourteen regulated allergens.

## 11. Whether an item may be sold

**Not in the API description.** `GetMaterialAvailablity` returns a bare number, and returned `0.0` for a drink that is on sale at a normal price, so "none left" cannot be told apart from "not counted in stock". `GetAllSelectableItems` sounds as though it answers this, but it has no description at all, and on the demo installation it returned an empty list — what does it mean by selectable, and how does it differ from `GetAllItems`? `MaterialDto` also carries `flags` and `itemType`, neither explained.

**Why we need it.** We may hide an item or mark it sold out, but we must never hide something the bar is happily pouring — that costs the venue money and makes the menu look broken. A number we cannot interpret forces us to ignore the signal altogether.

**How barsy does it.** [`Articles_getlist`](https://docs.lukanet.com/barsy.api/methods/articles/getlist.html) carries per-venue for-sale exceptions, so the answer is a flag — may this item be sold at this venue — rather than a quantity that needs interpreting.

---

## Eleven things the description does not settle

These are not missing endpoints but behaviour we could not read anywhere, and each one decides something we have to build. Short answers are enough.

- **What does `SaveOrder` print and return?** This is the one we would most like answered. It already takes `paymentKindGuid` and `sumPaid`, but today it returns only an operation GUID. If it also prints a fiscal receipt, and can hand back the receipt reference — sale number, receipt number, device, date and time — then it is most of a pay-at-the-table path on its own. While you are there: what are `TypePaymentEnum`'s sixteen values? barsy does the equivalent in one call, where [`Accounts_place`](https://docs.lukanet.com/barsy.api/methods/accounts/place.html) takes the payments together with a close-the-bill flag and accepts payments only when the call closes the bill.

- **Does an order sent through the API reach the bar, and does the ticket carry the detail?** A round that does not print on the right bar's ticket printer and appear on its screen is a drink nobody pours; our pilot club prints its tickets per bar. Nothing in the description mentions printers, screens or tickets. Three things: is the routing a venue setting that an API order follows the way a waiter's order does; do the options the guest chose and any note on the row actually appear on that ticket; and does anything print on the fiscal device? We read Наредба Н-18, чл. 7а, ал. 2 as not allowing a служебен бон for client orders, and would rather hear your reading than assume ours.

- **Is a round all or nothing, and does a refusal name the item?** If one item sold out since our last menu sync, does the POS refuse the whole round or quietly drop that row? We tell the guest "nothing was sent, something ran out — send the rest when you're ready", which is only honest if the call is atomic and the error names what failed. Two more on the same call: does the POS finish a call after the sender has hung up, and can a row still land minutes after we have given up and stopped looking? Your description names `ErrorCode 107`; is there a full list of codes, the way barsy publishes its refusal reasons through [`Reasons_getlist`](https://docs.lukanet.com/barsy.api/methods/reasons/getlist.html)?

- **If a payment times out and we send it again, can anything be paid twice?** You already refuse a repeated `ExtId` on an order with a `409`, which is the strongest guarantee in the API — so first, the fine print on the one that exists: does the refusal name the order that already exists, is it safe when two identical requests arrive at once, how long is a code remembered, does it still hold once the bill is closed, and is it per venue or global? (`ExtSysSettingsModel.generateExtNumber` may already be part of this answer.) Then the same promise on the call that takes money: can a close carry our own reference, is a repeat refused, and can we read back by that reference whether the bill closed and with which receipt? When we cannot prove a close either way we have to ask staff to settle it by hand.

- **What happens when the fiscal device fails during a close?** No paper, no link, printer switched off: does the call fail, or does the bill close with nothing printed? And at a venue with a till per bar, which device prints for a payment taken through the API, so we can tell the guest where to collect the receipt? In barsy's POS screens a close checks the device link and marks the bill closed only after the print succeeds ([Продажби](https://docs.lukanet.com/barsy.help/120-posx/020-sale.html)), which is the behaviour we would want from a close made through an API too.

- **Can a close carry an amount above the bill's total?** Guests tip in our app, and the Bulgarian tax authority's opinion of 23.10.2025 puts a card tip on the fiscal receipt, in tax group А with no VAT. So, three separate things: can a close take an amount above the total at all; if it can, does it arrive as a payment type or as an article on the bill; and does it print on the same fiscal receipt as the drinks? `MaterialDto.vatGuid` suggests the tax group per item is already there. Where the answer is no, we simply show no tip row at that venue.

- **Can a sale be issued as an electronic receipt?** Some guests would rather have the receipt by email than on paper. Can the POS issue the sale as an electronic receipt from the venue's fiscal device, can the API mark a sale electronic and take the guest's email address, and does the POS send the receipt itself or hand us the file? Related, and something only you can tell us: is Zamboo listed with the revenue agency as sales software, and under which name? That bears on the authorisation question below as well.

- **Which currency, and how does the POS round?** Prices come back as plain numbers and nothing names a currency anywhere in the description. They are also typed as `double`, with five decimals in practice (`1.99000`), and a floating-point double is not a safe way to carry money. We hold money in whole cents and never re-round what the POS has decided, so we need three things stated: the currency of prices and totals, whether the POS rounds per row or per bill and in which direction, and whether a price is ever anything other than an exact number of cents. A total we compute differently from yours by one cent is a guest disputing a receipt.

- **What do `orderValidationType` and `selectOrderType` mean?** `GetExternalSystems` returned `WebOrders` with `selectOrderType` 5 and `orderValidationType` 2. The description bounds them — `ExtSysOrderValidationType` is 0 to 2 and `ExtSysSelectOrderType` is 0 to 6 — but names none of the values. If `orderValidationType` is approval of an outside order at the bar, it decides whether we can offer a venue the choice between an order going straight through and one a bartender accepts first.

- **Can staff and the API work on the same bill, and does one key serve a venue's bars?** Can a waiter split, close and take cash at the till on a bill opened through the API, and can the API read and close a bill a waiter opened? Which rights does each side need? And separately: `GetAttachedDbs` and the `dbGuid` parameter suggest one key can reach several installations — is that how a venue with several bars is arranged, with one database per bar, or does each bar need its own key?

- **Is there a rate limit, and a cheap way to ask what changed?** Guests' phones refresh a table's bill every few seconds and our worker polls the tables, so a published limit is a number we need before we build. barsy's table read supports a checksum so an unchanged table can be skipped ([`Places_getlistwithaccountsonly`](https://docs.lukanet.com/barsy.api/methods/places/getlistwithaccountsonly.html)); anything of that kind — a checksum, a "changed since" filter — saves both sides a great deal of traffic.

## Three questions outside the API

- **Authorisation.** Under Наредба Н-18, чл. 52з, ал. 5 a venue may not add an outside module to registered sales software without the producer's written authorisation, and Приложение 32, т. 17 asks the venue to declare its links to other systems. Will you authorise Restro at your customers' venues, on what terms and at what price, and what does the venue declare?
- **A test installation.** Is `demorestaurant.zamboo.bg` a test installation we may write test orders to? We have only read from it so far; our rule is that development never touches a working venue's POS or a real fiscal device, training mode included. Does Zamboo have a training mode, and can the API tell us an installation is in it? We stop a connection the moment a live venue's POS looks to be in training.
- **Keys.** One key today reads a venue's whole customer base by phone, email or loyalty card and can delete customers and cards, and it travels in the query string, so it lands in server logs at both ends. The description also has no `securitySchemes`, `security` or `servers` block at all. Are keys with a limited scope possible, and can a key be sent in a header instead?

## Four small things we hit

- An empty result comes back as `204` with no body rather than an empty list, which breaks a client that expects JSON — and the description promises otherwise in at least two places: `GetAllCustomerByExtSys` says no matches return an empty list, and `GetCustomerCardsByExtCode` says an empty collection.
- The `ResError` body is a double-encoded JSON string, so every client unwraps it twice. It shows in the description: the `404` and `409` of `SaveOrder` and `SaveOrderDefPrice` and the `404` of `GetItemContent` declare a bare `string` schema while the text says a JSON-serialised `ResError`, where every other error response references `ResError` properly.
- `GetMealPlans` has no date filter — `apiKey` is its only parameter — and returned 49.7 MB on the demo restaurant, so we would avoid calling it on a schedule.
- `GetDefaultMenu` returns categories whose `Name` and `AltName` are empty; the labels have to be joined from `GetTags` by `TagValueGuid`, out of `text` and `altText`.

One thing you got right that we would keep: the `409` when an order repeats an `ExtId`. Extending that same guard to adding a round to an open bill and to taking a payment would solve most of an integration's reliability problems before they start.
