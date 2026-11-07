# What we need from the Zamboo API

Restro is a QR-to-phone ordering app: the guest scans the code on their table, sees the venue's menu and orders from their phone; when they pay, the venue's fiscal device has to print.

We have read the published `Zamboo api v1` description in full (OpenAPI 3.0.4, 45 operations) and made read-only calls against the demo installation. The menu reads well. The eleven points below are what we could not find for ordering and paying at a table. Each one says what is missing, why we need it, and how barsy's API does the same thing — not as a comparison of products, but because a working precedent is the quickest way to show what we are asking for. The barsy pages sit behind their integrator sign-in, so each point summarises what the page says as well as linking it.

Your own Zamboo web interface applies actions to an open bill, so this exists inside your product. **Our question is whether there is a second interface for tables and open bills, and whether you will open it to us.** Where the answer is "it already does that", the work is ours — we need the documentation and permission, nothing more.

---

## 1. A table on the order, and the venue's list of tables

**Missing.** Nothing carries a table. `BillDto` has no table field, and the word does not appear anywhere in the API description.

**Why we need it.** Our whole product is a QR code on a table. The guest scans table 7, and the order, the bar's ticket and the waiter all have to arrive at table 7. Without a table on the order there is nothing to route, and a venue with forty tables cannot use us at all.

**How barsy does it.** [`Places_getlist`](https://docs.lukanet.com/barsy.api/methods/places/getlist.html) returns the venue's tables, rooms and halls, each with an id we store. A bill carries `place_id` as an optional field, so an order can go to a table or to none. [`Places_getlistwithaccountsonly`](https://docs.lukanet.com/barsy.api/methods/places/getlistwithaccountsonly.html) returns only the tables that currently have an open bill, which is what a floor view needs, and it supports a checksum so an unchanged table can be skipped on a refresh.

## 2. Reading a table's open bills

**Missing.** No endpoint returns a bill. `GetOrderSales` is a sales report over a date range — items sold with a date and an hour — and carries neither our `ExtId` nor the operator.

**Why we need it.** A guest ordering their third round has to see what is already on the table, and we have to add to the right bill rather than start a new one. After a timeout we also have to find out whether the round we sent actually landed, before we risk sending it twice. Every other point depends on this one.

**How barsy does it.** [`Accounts_getlist`](https://docs.lukanet.com/barsy.api/methods/accounts/getlist.html) takes filters including the table and the open status, and returns each bill with its rows, its total before and after discounts, the sum paid, the sum still owed, its status, and whether it is locked for editing. Each row carries the article, the quantity, the price used, the time and the name of the user who entered it — which is how we tell our own rounds from the waiter's.

## 3. Adding a round to a bill that is already open

**Missing.** `SaveOrder` and `SaveOrderDefPrice` always create a new standalone sale. No call appends to an existing one.

**Why we need it.** A table orders five or six times across a night. If each of our orders becomes its own sale, the waiter who walks over with the bill cannot see what the guests ordered from their phones, and the venue spends the end of the night reconciling by hand.

**How barsy does it.** One method does both: [`Accounts_place`](https://docs.lukanet.com/barsy.api/methods/accounts/place.html) with an `account_id` appends rows to that open bill; without one it opens a bill and returns its number. The call carries the table, a title the staff see, a note that is not printed, a description that is printed on the receipt, and our own unique code for the order.

## 4. The POS prices the order, and gives us the total back

**Missing.** `price` is required on every `BillRowDto`; `SaveOrderDefPrice` fills a price in only where we send zero. No call returns the total the POS applied.

**Why we need it.** A club's prices move during the night — happy hour, a promotion, a discount on one table — so the price from our last sync is not what the venue charges. And before we take a guest's money we have to show them a total the POS agrees with, not one we calculated ourselves.

**How barsy does it.** [`Accounts_place`](https://docs.lukanet.com/barsy.api/methods/accounts/place.html) sent without a price uses the article's current price in the POS, so the POS stays the authority on money. The bill then reads back through [`Accounts_getlist`](https://docs.lukanet.com/barsy.api/methods/accounts/getlist.html) with its final total after prices and discounts, which is the figure a payment is matched against.

## 5. Closing a bill with a payment, and the fiscal receipt

**Missing.** An order can be recorded as card-paid (`paymentKindGuid`, `sumPaid`), but nothing closes a bill, nothing mentions a fiscal device, and the only thing returned is an internal operation GUID.

**Why we need it.** A guest paying in our app is paying at the venue, and Bulgarian law requires a fiscal receipt for that. We never tell a guest their payment succeeded before the POS has handed us a receipt reference — otherwise a venue could take money with nothing printed, which is the one mistake we cannot make.

**How barsy does it.** [`Accounts_close`](https://docs.lukanet.com/barsy.api/methods/accounts/close.html) takes the payments, prints the fiscal receipt on the venue's configured device, updates stock, and leaves the bill read-only afterwards. A payment names its method and its type (card present, card not present, cash and so on), carries a flag marking it as performing a fiscal operation, and keeps the provider's transaction reference; the receipt's print data reads back with the payment through [`Payments_getlist`](https://docs.lukanet.com/barsy.api/methods/payments/getlist.html), and the sale's unique number reads back on the bill.

## 6. Splitting, merging and moving a bill

**Missing.** Nothing moves rows between bills.

**Why we need it.** Six people at a table and one leaves early, wanting to pay for their own two drinks. A waiter does this at the POS in seconds, and in the app it is the most asked-for thing after seeing the bill at all.

**How barsy does it.** [`Accounts_divide`](https://docs.lukanet.com/barsy.api/methods/accounts/divide.html) takes the original bill and the items with quantities to move, creates a new bill from them and returns its id; that new bill is then paid and closed on its own. [`Accounts_merge`](https://docs.lukanet.com/barsy.api/methods/accounts/merge.html) moves rows into the oldest bill and closes the others empty, and refuses when a bill is already closed or fiscally marked. [`Accounts_move`](https://docs.lukanet.com/barsy.api/methods/accounts/move.html) moves an open bill to another table or another member of staff.

## 7. Cancelling a row, and reversing a bill already closed

**Missing.** No call refuses a row or cancels an order, and there is no storno.

**Why we need it.** The bar declines a round because the bottle is finished, or the guest leaves before it arrives. Someone has to undo it without a waiter hand-deleting our rows, and the declined attempt has to survive for the audit trail rather than disappear.

**How barsy does it.** An order row can carry a reason chosen from the list the POS supplies through [`Reasons_getlist`](https://docs.lukanet.com/barsy.api/methods/reasons/getlist.html), which also states whether the item still leaves stock. For a bill that is already closed, [`Accounts_storno`](https://docs.lukanet.com/barsy.api/methods/accounts/storno.html) creates a reversing bill with its own unique number and a storno fiscal receipt naming the receipt being reversed, with the reason taken from the standard Н-18 list in [`Accounts_getstornoreasons`](https://docs.lukanet.com/barsy.api/methods/accounts/getstornoreasons.html) that the fiscal device itself demands.

## 8. Asking whether an order can be taken right now

**Missing.** `GET /api/Test` is a liveness ping. The API has no cash desk, no cash period, no fiscal device state and no rights.

**Why we need it.** A POS loses its network, runs out of paper, or closes its cash period at 5am while a guest is paying. We would much rather tell the guest "pay at the bar tonight" than accept money the POS cannot fiscalise.

**How barsy does it.** [`Poses_getcurrent`](https://docs.lukanet.com/barsy.api/methods/poses/getcurrent.html) returns the cash desk the session is working on — its venue, its hall and the fiscal printer's state — and a write requires a cash desk assigned to that user by the venue's administrator, so a misconfigured venue fails before a guest is ever involved. [`Misc_ping_user`](https://docs.lukanet.com/barsy.api/methods/misc/ping_user.html) checks reachability and credentials separately from that.

## 9. Which options an item allows

**Missing.** `GetModifiers` returns the modifier sets, but nothing links a set to an item. No item on the demo installation had any content, and `GetItemContent` answered `404` for every item we tried.

**Why we need it.** A guest ordering a gin has to pick the tonic, and a steak has to carry its cooking degree. If we cannot tell which options an item allows, we either offer none and the order is wrong at the bar, or offer all of them and the order is nonsense.

**How barsy does it.** [`Articlesupplements_get`](https://docs.lukanet.com/barsy.api/methods/articlesupplements/get.html) returns the option groups of one article: whether a group is required, its minimum and maximum number of choices, and each option with its current price — enough to build the choice screen and price it correctly. [`Modificators_getlist`](https://docs.lukanet.com/barsy.api/methods/modificators/getlist.html) returns the modifier lists themselves.

## 10. Allergens per item

**Missing.** `GetAllergens` and `GetNomenclatureExtraInfo` both answer `204` with no body.

**Why we need it.** Allergen information in writing is a legal requirement for us, and on a phone menu there is no waiter standing there to be asked. A venue that cannot show it cannot sell food through us.

**How barsy does it.** Article characteristics come back from [`Articledetails_gettree`](https://docs.lukanet.com/barsy.api/methods/articledetails/gettree.html) as a tree of keys and values, among them "Алергени", which we map onto the fourteen regulated allergens.

## 11. Whether an item may be sold

**Missing.** `GetMaterialAvailablity` returns a bare number, and returned `0.0` for a drink that is on sale at a normal price, so "none left" cannot be told apart from "not counted in stock".

**Why we need it.** We may hide an item or mark it sold out, but we must never hide something the bar is happily pouring — that costs the venue money and makes the menu look broken. A number we cannot interpret forces us to ignore the signal altogether.

**How barsy does it.** [`Articles_getlist`](https://docs.lukanet.com/barsy.api/methods/articles/getlist.html) carries per-venue for-sale exceptions, so the answer is a flag — may this item be sold at this venue — rather than a quantity that needs interpreting.

---

## Three questions outside the API

- **Authorisation.** Under Наредба Н-18, чл. 52з, ал. 5 a venue may not add an outside module to registered sales software without the producer's written authorisation, and Приложение 32, т. 17 asks the venue to declare its links to other systems. Will you authorise Restro at your customers' venues, on what terms and at what price, and what does the venue declare?
- **A sandbox.** Is `demorestaurant.zamboo.bg` a test installation we may write test orders to? We have only read from it so far; our rule is that development never touches a working venue's POS or a real fiscal device.
- **Keys.** One key today reads a venue's whole customer base by phone, email or loyalty card and can delete customers and cards, and it travels in the query string, so it lands in server logs at both ends. Are keys with a limited scope possible, and can a key be sent in a header instead?

## Four small things we hit

- An empty result comes back as `204` with no body rather than an empty list, which breaks a client that expects JSON.
- The `ResError` body is a double-encoded JSON string, so every client unwraps it twice.
- `GetMealPlans` has no date filter and returned 49.7 MB on the demo restaurant, so we would avoid calling it on a schedule.
- `GetDefaultMenu` returns categories whose `Name` and `AltName` are empty; the labels have to be joined from `GetTags` by `TagValueGuid`.

One thing you got right that we would keep: the `409` when an order repeats an `ExtId`. If the same guard applies to adding a round to an existing bill, most of an integration's reliability problems are solved before they start.
