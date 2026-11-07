# What the Zamboo API does not have, and how barsy does it

Restro is a QR-to-phone menu and ordering app for restaurants and clubs: the guest scans a code on the table, sees the venue's menu and orders from their phone.

We have read the published `Zamboo api v1` description in full (OpenAPI 3.0.4, 45 operations, `https://demorestaurant.zamboo.bg/swagger/v1/swagger.json`) and made read-only calls against the demo installation. The menu reads well. What follows is only what is missing for ordering and paying at a table, and for each one how barsy's API solves the same thing — so this is a concrete comparison and not a wish list.

Where the answer is "our table-service interface already does this", the work is ours. We need the documentation and permission to use it, nothing more.

(In English because the Zamboo API's own documentation is. We will gladly send it in Bulgarian.)

---

## 1. There is no table

**Missing.** Nothing carries a table. `BillDto` has no table field, and the word does not appear anywhere in the API description.

**Why we need it.** Our product is a QR code on a table. The guest scans table 7, and the order, the bar's ticket and the waiter all have to reach table 7.

**barsy.** `Places_getlist` returns the venue's tables, rooms and places. A bill carries an optional `place_id`. `Places_getlistwithaccountsonly` returns only the tables that have an open bill, with a checksum so an unchanged table can be skipped on a refresh.

## 2. A bill cannot be read

**Missing.** No endpoint returns a bill. `GetOrderSales` is a sales report for a date range — items sold with a date and an hour — not a bill; it carries neither our `ExtId` nor the operator.

**Why we need it.** The guest has to see what is already on the table before adding to it, we have to add to the right bill, and after a network failure we have to find out whether the round we sent actually landed.

**barsy.** `Accounts_getlist`, filtered by `place_id` and open status, returns each bill with `total`, `discount`, `total_real`, `total_paid`, `total_remain`, `status` and `is_locked`. Each row carries `article_id`, `amount`, `current_price`, `date`, `user_name` (who entered it), `status` and `served_date`.

## 3. Nothing can be added to an existing bill

**Missing.** `SaveOrder` and `SaveOrderDefPrice` always create a new standalone sale. No call appends to one.

**Why we need it.** A table orders five or six times across a night. If each of those is its own sale, the waiter who walks over with the bill cannot see what the guests ordered from their phones, and the venue ends the night reconciling by hand.

**barsy.** `Accounts_place` with an `account_id` continues an open bill; without one it creates a bill and returns its number. The bill carries `place_id` (the table), `account_alias` (a title staff see), `notes` (not printed), `description` (printed on the receipt) and `uuid` (our own unique code). Rows carry `article_id` and `amount`.

## 4. We have to price the order, and no total comes back

**Missing.** `price` is required on every `BillRowDto`. `SaveOrderDefPrice` fills a price in only where we send zero, and no call reads the applied total back.

**Why we need it.** Prices move during a night — happy hour, a promotion, a discount on a table — so the price we last synced is not the price the venue charges. And we will not take a guest's money for a total the POS has not confirmed.

**barsy.** `Accounts_place` sent without a price uses the article's current price. The bill then reads back with `total_real`, the final amount after prices and discounts, which a payment can be matched against.

## 5. A bill cannot be closed, paid or fiscalised

**Missing.** An order can be recorded as card-paid (`paymentKindGuid`, `sumPaid`), but nothing closes a bill, nothing mentions a fiscal device, and the only return value is an internal operation GUID.

**Why we need it.** A guest paying in our app is paying at the venue, and Bulgarian law requires a fiscal receipt for it. We never confirm a payment to a guest before the POS hands us a receipt reference.

**barsy.** `Accounts_close` with `payments` prints the fiscal receipt on the configured fiscal device, updates stock and leaves the bill read-only. Payments carry `paymethod_id`, `type_id` (5 card present, 6 card not present, and so on), an `fx` flag marking the payment as performing a fiscal operation, `payment_print_data` (the receipt print data), `transaction_id` and `ref_num` for the provider's reference. The sale number (`unp`) reads back on the bill. In barsy's own staff screens a bill closes only after the print succeeds.

## 6. A bill cannot be split, merged or moved

**Missing.** Nothing moves rows between bills.

**Why we need it.** Six people at a table; one leaves early and wants to pay for their two drinks. After seeing the bill at all, this is the most asked-for thing in the app.

**barsy.** `Accounts_divide` takes `old_account_id` and the items with quantities to move, creates a new bill with those rows and returns its id. `Accounts_merge` and `Accounts_mergebyplaceid` move rows into the oldest bill and close the others empty; a closed or fiscally marked bill cannot be merged. `Accounts_move` moves an open bill to another table and/or another staff member; without the "direct transfer" right the new staff member must accept it first.

## 7. An order cannot be cancelled or reversed

**Missing.** No call refuses a row or cancels an order.

**Why we need it.** The bar declines an order because the bottle is finished, or the guest leaves. Someone has to undo it, and the declined attempt has to be kept for the audit trail rather than deleted.

**barsy.** `Accounts_place` takes a `reason_id` from `Reasons_getlist`, which also says whether the item still leaves stock. For a bill already closed, `Accounts_storno` creates a reversing bill with its own УНП and a storno fiscal receipt naming the reversed receipt; `Accounts_getstornoreasons` returns the standard reasons the fiscal device requires under Н-18, and the device refuses a storno without a valid one.

## 8. There is no way to ask whether you can take an order right now

**Missing.** `GET /api/Test` is a liveness ping. The API has no cash desk, no cash period, no fiscal device state and no rights.

**Why we need it.** A POS goes down, runs out of paper, or closes its cash period at 5am while a guest is paying. We would rather refuse politely in the app than take money the POS cannot fiscalise.

**barsy.** `Poses_getcurrent` returns the cash desk of the current session — its id, name, venue, hall and the fiscal printer's state — and a write needs a cash desk assigned to the API user by the venue's administrator. `Misc_ping` and `Misc_ping_user` check reachability and credentials.

## 9. Three gaps in the menu

**Which options an item allows.** `GetModifiers` returns the sets, but nothing links a set to an item, and no item on the demo had any content (`GetItemContent` answered `404`). So a guest cannot choose a cooking degree or a mixer. — **barsy:** `Articlesupplements_get` returns a combo article's option groups: required or not, a minimum and a maximum, and each option with its current price. `Modificators_getlist` returns the modifiers.

**Allergens.** `GetAllergens` and `GetNomenclatureExtraInfo` both answer `204` with no body. Allergen information in writing is a legal requirement for us. — **barsy:** `Articledetails_gettree` returns characteristic keys, among them "Алергени".

**Whether an item may be sold.** `GetMaterialAvailablity` returns a bare number, and returned `0.0` for a drink that is on sale at a normal price, so "none left" cannot be told from "not counted". We will not grey out drinks that are on the shelf. — **barsy:** `Articles_getlist` takes `limits_by_barsys`, per-venue for-sale exceptions — a flag saying whether an item may be sold at this venue, rather than a quantity.

---

## Four small things we worked around

Not gaps in what the API does, just rough edges worth knowing about:

- An empty result comes back as `204` with no body rather than an empty list, so a client that expects JSON fails on it.
- The `ResError` body arrives as a double-encoded JSON string: every client unwraps it twice.
- `GetMealPlans` has no date filter and returned **49.7 MB** on the demo restaurant (9,372 plans). We would avoid calling it on a schedule.
- The `apiKey` travels in the query string, so it is written into server logs at both ends.

## Three things we also need to ask

- **Authorisation.** Under Наредба Н-18, чл. 52з, ал. 5 a venue may not add an outside module to registered sales software without the producer's written authorisation, and Приложение 32, т. 17 asks the venue to declare its links to other systems. Will you authorise Restro as a linked module at your customers' venues, on what terms and at what price, and what does the venue write in its Приложение 32 filing?
- **A sandbox.** Is `demorestaurant.zamboo.bg` a test installation we may write test orders to? We have only read from it; our rule is that development never touches a working venue's POS or a real fiscal device.
- **Keys.** Today one key reads a venue's whole customer base by phone, email or loyalty card and can permanently delete customers and cards, and `GetAttachedDbs` can return database connection strings. Are keys with a limited scope possible, and can a key be sent in a header instead of the URL?

## One more thing worth saying

The duplicate guard on `SaveOrder` — a `409` when an order with the same `ExtId` already exists — is the strongest part of the write side and exactly the protection an integration needs. If your table-service interface has the same guard on adding a round to a bill, most of our reliability problems are already solved.
