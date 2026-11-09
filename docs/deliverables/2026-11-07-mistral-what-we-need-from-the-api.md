# What we need from the Zamboo API

Restro is a phone ordering app: the guest scans the QR code on their table, sees the venue's menu, orders and pays from their phone, and the venue's fiscal device issues the receipt.

We read the published `Zamboo api v1` description (OpenAPI 3.0.4, 45 operations, 42 schemas) and made read-only calls against the demo installation. The menu reads well. Table service we did not find: an order cannot be tied to a table, a table's running bill cannot be read, lines cannot be added to an already open bill, a bill cannot be closed with a payment and a fiscal receipt, and a bill cannot be split.

Below we first say what the app has to do and what it needs from the POS for each of those, then go into the detail of the points we did not find. We have worked from barsy's publicly available documentation, so each point shows briefly how the same thing is solved there — not as a product comparison, but because a working example is the fastest way to show what we are after. The barsy pages sit behind an integrator login, so besides the link we also summarise what is on the page.

Everything here is read from the description. Where something exists and we have not seen it, say so and the work is ours. If these actions already exist in another interface of yours — the Zamboo web interface appears to work on open bills from a browser — our question is whether you will open access to it.

## What the app has to do

- The guest sees the venue's menu → reading the nomenclature, prices and categories. **Works.**
- Orders, and the order goes to their table, at the bar that serves it → an order tied to a table, and which bar serves the table. **Point 1.**
- Sees what is already on the table → reading the running bill with its lines and totals. **Point 2.**
- Orders again, and the new lines join the same bill → adding lines to an open bill. **Point 3.**
- Sees a price the POS confirms → the POS sets the price and returns it. **Point 4.**
- Pays in the app and gets a fiscal receipt → closing a bill with a payment and returning the receipt's details. **Point 5.**
- Pays for their own items only → splitting a bill. **Point 6.**
- An order can be refused before the bill is closed → refusing a line. **Point 7.**
- We do not offer ordering when the POS cannot accept it → reading the state. **Point 8.**
- The guest picks an item's required options → reading the options. **Point 9.**
- Sees the allergens → reading allergens per item. **Point 10.**
- We do not show an item that cannot be sold → reading whether it is sellable. **Point 11.**

---

## 1. An order cannot be tied to a table

**What we did not find.** Nothing in the API carries a table. `BillDto` has no table field, and the word does not appear in the description. There is also no list of the venue's tables, and nothing saying which bar serves a given table.

**Why we need it.** The app starts at the QR code on the table. The order, the bar ticket and the waiter all have to reach that same table. Which bar serves the table decides where the order prints; we read it from the POS so the venue does not enter it a second time.

**How barsy does it.** [`Places_getlist`](https://docs.lukanet.com/barsy.api/methods/places/getlist.html) returns the venue's tables, halls and places, each with its own id, and a bill carries `place_id`. [`Places_getlistwithaccountsonly`](https://docs.lukanet.com/barsy.api/methods/places/getlistwithaccountsonly.html) returns only the tables that currently have an open bill, and supports a checksum so an unchanged table can be skipped.

## 2. A table's running bill cannot be read

**What we did not find.** No request returns a bill. `BillDto` appears only as the request body of `SaveOrder` and `SaveOrderDefPrice`, never in a response. `GetOrderSales` is a sales report for a period, not a table's running bill.

**Why we need it.** This is the foundation of everything else. Without it we cannot show the guest the bill, add to the right bill, work out what they owe, or check what changed before we take money.

**What the bill has to carry.** The lines with quantities and prices, the total before and after discounts, what has been paid and what is left, and besides that:

- lookup by the reference we sent (`ExtId`), so that after a dropped connection we can check whether the order arrived instead of sending it a second time;
- what a line removed by staff looks like — a negative line, a reduced quantity or a status — so we can tell a voided line from one moved to another bill;
- the time the bill was opened, so we never add to a bill left over from the previous day;
- who entered each line, so we can tell our own lines from the waiter's.

**How barsy does it.** [`Accounts_getlist`](https://docs.lukanet.com/barsy.api/methods/accounts/getlist.html) takes filters by table and state and returns the bill with its lines, the totals, what is paid, what is left and whether it is locked for editing. Each line carries the item, the quantity, the price, the time and the user who entered it.

## 3. Lines cannot be added to an already open bill

**What we did not find.** `SaveOrder` and `SaveOrderDefPrice` always create a new standalone sale. There is no request that adds lines to an existing bill.

**Why we need it.** A table orders several times over an evening. If every order becomes its own sale, the table's bill is not whole and the venue reconciles it by hand.

**How barsy does it.** [`Accounts_place`](https://docs.lukanet.com/barsy.api/methods/accounts/place.html) with `account_id` adds lines to that bill; without `account_id` it opens a new one and returns its number. The request carries the table, a note for staff, a description for the receipt and our own code for the order.

## 4. The price comes from us, and it should come from the POS

**What we did not find.** `price` is required on every `BillRowDto`. `SaveOrderDefPrice` fills a price in, but its description says it loads the item's base price. No request returns the amount the POS finally applied.

**Why we need it.** Prices change through the evening — promotions, happy hour, a discount for one table. We cannot show or charge a price the POS has not confirmed.

**It may already be there.** `BillRowDto.timeDiscount` carries `campaignName`, `regularPrice`, `priceListPrice` and `unitPrice`. Does the server work that out when a line is saved, and does it apply the campaign price instead of the base price?

**How barsy does it.** [`Accounts_place`](https://docs.lukanet.com/barsy.api/methods/accounts/place.html) with no price sent uses the item's current price in the POS, and the bill is read back with its final total through [`Accounts_getlist`](https://docs.lukanet.com/barsy.api/methods/accounts/getlist.html).

## 5. A bill cannot be closed with a payment and a fiscal receipt

**What we did not find.** `BillDto` carries `paymentKindGuid` and `sumPaid`, but the description does not say what they do. Nothing closes a bill, a fiscal device is mentioned nowhere, and what comes back is an internal GUID. `PaymentKindDto.typePayment` is `TypePaymentEnum` with sixteen values, none of them named, so we cannot tell which one means card.

**Why we need it.** Paying in the app is paying at the venue, and the law requires a fiscal receipt. We never tell a guest they have paid before the POS has returned a reference to the receipt.

**What the close has to return.** The sale's unique number, the receipt number, the device number, and the date and time. And when several bills sit behind one table, whether a payment is one close with one receipt or one close per bill.

**How barsy does it.** [`Accounts_close`](https://docs.lukanet.com/barsy.api/methods/accounts/close.html) takes the payments, prints the fiscal receipt on the venue's device, updates stock and makes the bill read-only. A payment carries its method and type, a flag that it performs a fiscal operation, and the provider's reference; the receipt's details are read with the payment through [`Payments_getlist`](https://docs.lukanet.com/barsy.api/methods/payments/getlist.html).

## 6. A bill cannot be split

**What we did not find.** Nothing moves lines between bills.

**Why we need it.** At the table one guest wants to pay for their own items only. Splitting is what the guest needs; merging and moving stay the staff's work.

**What has to be clear.** Can the split name the exact line, or only an item and a quantity — and if two lines are the same, which one is taken? Which table does the new bill stand on? What happens if the quantity is no longer there? Are a split and a close one request or two? And what happens to a whole-bill discount when part of the bill is taken off — until we know, on a table with such a discount we tell the guest to ask a waiter.

**How barsy does it.** [`Accounts_divide`](https://docs.lukanet.com/barsy.api/methods/accounts/divide.html) takes the bill and the items with quantities, creates a new bill and returns its id; the new one is paid and closed on its own. [`Accounts_move`](https://docs.lukanet.com/barsy.api/methods/accounts/move.html) moves an open bill to another table or another member of staff.

## 7. A line cannot be refused

**What we did not find.** No request refuses a line or cancels an order. `BillRowDto` carries `deletedQty` and `status`, neither of them explained.

**Why we need it.** The bar refuses an order because the item has run out, or the guest leaves before it arrives. It has to be cancelled without a waiter deleting lines by hand, and the refusal has to stay in the records. Storno on a closed bill and giving money back stay the work of staff at the till — we want only to read that it happened, never to do it.

**How barsy does it.** A refusal carries a reason from a list the POS publishes through [`Reasons_getlist`](https://docs.lukanet.com/barsy.api/methods/reasons/getlist.html); the list also says whether the item goes out of stock.

## 8. There is no way to ask whether the POS can accept an order right now

**What we did not find.** `GET /api/Test` is the only request with no summary and no description; it returns `200` with no body, so we take it for a liveness check. Beyond it there is no till, no till period, no fiscal device state and no rights.

**Why we need it.** The POS loses its connection, runs out of paper or closes the till period. It is much better to tell the guest "pay at the bar" than to take money the POS cannot put on a receipt.

**How barsy does it.** [`Poses_getcurrent`](https://docs.lukanet.com/barsy.api/methods/poses/getcurrent.html) returns the till the session works on — the venue, the hall and the state of the fiscal printer. [`Misc_ping_user`](https://docs.lukanet.com/barsy.api/methods/misc/ping_user.html) checks reachability and credentials separately from that.

## 9. An item's options can be read only for some items

**What we found.** `GetItemContent` returns exactly what we need: `MaterialContentApiDto` → `steps[]` → `materialChooser`, with a title, a minimum and maximum, and a priced list. But the description says `404` with `ErrorCode 107` means "item not found or the item is not an operation", and every drink we tried answered `404`.

**The question.** How are the options read for an item that is not an operation — a gin that needs a tonic chosen? Is `GetAllSelectableItems` that mechanism, and what does it return? `GetModifiers` gives us the modifier lists, but we found nothing that ties a list to an item.

**Why we need it.** An item whose required options we cannot read is one we cannot offer for ordering — the guest orders it from a waiter. This answer decides how much of the menu is orderable at all.

**How barsy does it.** [`Articlesupplements_get`](https://docs.lukanet.com/barsy.api/methods/articlesupplements/get.html) returns an item's option groups, for every item and not only a composed one: whether the group is required, the minimum and maximum choices, and each option with its price.

## 10. Allergens arrive empty and without a code

**What we found.** `GetAllergens` exists and declares `200` with `AllergenDto[]`, but on the demo installation it answers `204` with no body for every item we tried, and `204` is not in the description. `GetNomenclatureExtraInfo` does the same.

**The questions.** Is the demo database simply not filled in, or does the request need something we are not sending? And `AllergenDto` carries only `name` and `altName`, with no code — is that free text entered by the venue, or a fixed list?

**Why we need it.** Allergens are a legal requirement, and on a phone there is no waiter to ask. We have to map your values onto the fourteen allergens the law names, and free text written separately by every venue is not a reliable basis for that.

**How barsy does it.** An item's characteristics come from [`Articledetails_gettree`](https://docs.lukanet.com/barsy.api/methods/articledetails/gettree.html) as a tree of keys and values, "Allergens" among them.

## 11. Whether an item can be sold cannot be read

**What we did not find.** `GetMaterialAvailablity` returns only a number, and returned `0.0` for a drink that sells normally, so "out of stock" cannot be told apart from "not stock-tracked". `GetAllSelectableItems` has no description and returned an empty list. `MaterialDto` carries `flags` and `itemType`, neither explained.

**Why we need it.** We can hide an item or mark it sold out, but we must never hide something the bar is pouring happily — that costs the venue money. A signal we cannot read forces us to ignore it.

**How barsy does it.** [`Articles_getlist`](https://docs.lukanet.com/barsy.api/methods/articles/getlist.html) carries per-venue sale exceptions — a flag, not a quantity that needs interpreting.

---

## Questions about behaviour

These are not missing requests but behaviour we found described nowhere. Short answers are enough.

- **What does `SaveOrder` do with `paymentKindGuid` and `sumPaid`?** Does it print a fiscal receipt, and can it return the receipt's reference — the sale number, the receipt number, the device, the date and time? And what are the sixteen values of `TypePaymentEnum`? In barsy, [`Accounts_place`](https://docs.lukanet.com/barsy.api/methods/accounts/place.html) takes the payments together with a flag that closes the bill, and accepts payments only when the request closes the bill.
- **Does an order sent through the API reach the bar?** The description mentions no printers, screens or tickets. Is the routing a venue setting that an API order follows the way a waiter's order follows it? Do the guest's chosen options and the note on a line actually appear on that ticket? And does anything print on the fiscal device — we read Наредба Н-18, чл. 7а, ал. 2 as not allowing a service docket for customer orders, and would rather hear your reading.
- **Is an order all-or-nothing, and does the refusal name the item?** If an item ran out after our last menu sync, does the POS refuse the whole order or quietly drop that line? We tell the guest "nothing was sent, something has run out", which is only honest if the request is atomic and the error names the item. Does the POS finish a request after the caller has disconnected, and can a line arrive minutes after we gave up? And is there a full list of error codes?
- **Can anything be paid twice if a request is repeated?** You already refuse a repeated `ExtId` with `409`, which is the strongest guarantee in the API. Does the refusal name the order that already exists; is it safe when two identical requests arrive at once; how long is a code remembered; does it still hold after the bill is closed; is it per venue or global? (`ExtSysSettingsModel.generateExtNumber` may be part of this answer.) And then the same at the request that takes money: can the close carry a reference of ours, is a repeat of it refused, and can we read from that reference whether the bill is closed and with which receipt?
- **What happens when the fiscal device fails mid-close?** Does the request fail, or does the bill close with nothing printed? And in a venue with a till at every bar, which device prints for a payment taken through the API? In barsy's till screens the close checks the device connection and marks the bill closed only after a successful print ([Продажби](https://docs.lukanet.com/barsy.help/120-posx/020-sale.html)).
- **Can the close take an amount above the bill's total?** Guests tip in our app, and the NRA's opinion of 23.10.2025 puts a card tip on the fiscal receipt, in tax group А with no VAT. Is such an amount accepted at all; does it arrive as a payment kind or as a line on the bill; and does it print on the same receipt? `MaterialDto.vatGuid` suggests the per-item tax group is already there.
- **Can a sale be issued as an electronic receipt?** Can the venue's device issue the receipt electronically, can the API take the guest's email, and does the POS send the file itself or hand it to us? And is Zamboo on the NRA's register of sales management software, under which name?
- **Which currency, and how does the POS round?** Nothing names a currency anywhere in the description, and prices are typed as `double` and arrive with five decimals (`1.99000`). We hold money in whole stotinki and never re-round what the POS has decided, so we need three things stated: the currency, whether rounding is per line or per bill and in which direction, and whether a price can ever be anything other than an exact number of stotinki.
- **What do `orderValidationType` and `selectOrderType` mean?** `GetExternalSystems` returned `WebOrders` with `selectOrderType` 5 and `orderValidationType` 2. The description bounds them (0–2 and 0–6) but names no value. If `orderValidationType` is approval at the bar, it decides whether we can offer a venue the choice between an order that goes straight through and one the bartender accepts first.
- **Can staff and the API work on the same bill?** Can a waiter split, close and take cash on a bill opened through the API, and can the API read and close a bill a waiter opened? What rights does each side need? And separately: `GetAttachedDbs` and the `dbGuid` parameter suggest one key can reach several installations — is that how a venue with several bars is set up, or does each bar need its own key?
- **Is there a rate limit, and a cheap way to read only what changed?** Guests' phones refresh the table's bill often, and our worker walks the tables, so a published limit is a number we need before we build. In barsy the table read supports a checksum so an unchanged table can be skipped ([`Places_getlistwithaccountsonly`](https://docs.lukanet.com/barsy.api/methods/places/getlistwithaccountsonly.html)); a checksum or a "changed since" filter saves traffic on both sides.

## Questions outside the API

- **Authorisation.** Наредба Н-18, чл. 52з, ал. 5: a venue may not attach an external module to registered sales management software without the producer's written authorisation, and Приложение 32, т. 17 requires the venue to declare its links to other systems. Will you authorise Restro at your clients' venues, on what terms and at what price, and what does the venue declare?
- **Test installation.** Is `demorestaurant.zamboo.bg` a test installation we may write to? So far we have only read from it. Our development never touches a live venue's POS or a real fiscal device, training mode included. Does Zamboo have a training mode, and can the API tell us an installation is in it?
- **Keys.** Today one key reads a venue's whole customer base by phone, email or card and can delete customers and cards, and it travels in the request URL, which means it lands in server logs on both sides. The description also has no `securitySchemes`, `security` or `servers` block. Are scoped keys possible, and can the key be sent in a header instead?

## Small things we ran into

- An empty result comes back as `204` with no body instead of an empty list, which breaks a client expecting JSON. The description promises otherwise in two places: `GetAllCustomerByExtSys` says no matches return an empty list, and `GetCustomerCardsByExtCode` an empty collection.
- The body of `ResError` is a double-encoded JSON string, so every client unwraps it twice. `404` and `409` on `SaveOrder` and `SaveOrderDefPrice` and `404` on `GetItemContent` declare a plain `string` schema while the text says a JSON-serialised `ResError`; every other error response points at `ResError` properly.
- `GetMealPlans` has no date filter — `apiKey` is its only parameter — and returned 49.7 MB for the demo restaurant, so we would not call it on a schedule.
- `GetDefaultMenu` returns categories whose `Name` and `AltName` are empty; the labels have to be joined from `GetTags` by `TagValueGuid`.

One last thing you have got right: the `409` on an order that repeats an `ExtId` already used. The same protection on adding to an open bill and on taking a payment would solve most of an integration's reliability problems before they arise.
