# What Restro needs from a POS API, and what Zamboo's API covers

Made by: the lead session (Opus), 11-07, for Martin. For: T69, #48, and every POS Restro ever looks at.

This is the yardstick: **69 requirements** Restro has on a POS's API, in plain words, each marked for how Zamboo's published API answers it. The requirements are POS-neutral — the same list judges barsy, Zamboo, or any system a future venue runs. The Zamboo column is the 11-06 reading and live probing recorded in [2026-11-06-zamboo-api-review](2026-11-06-zamboo-api-review.md); the full question behind each service row, with barsy's answer beside Mistral's, is in `docs/connector-questions.md` under the same C-number.

Three ways to use it: hand a vendor the rows marked ✗ or ? as a precise statement of what we need; judge a new POS in an afternoon; and see at a glance what a connector would have to work around.

| Mark | Meaning |
|---|---|
| ✓ | covered: the API does this, confirmed in its own description or by a live call |
| ◐ | partly: it does some of it, or does it in a way that needs work around it |
| ✗ | absent: nothing in the API does this |
| ? | not stated: the API neither offers it nor rules it out — it is a question for the producer |

**Need:** *blocking* = the pilot cannot run without it; *later* = it can wait past the pilot.

## The count

| Group | Requirements | ✓ | ◐ | ? | ✗ |
|---|---|---|---|---|---|
| The menu (M1–M13) | 13 | 3 | 4 | 0 | 6 |
| Service: the 56 POS questions (C1–C56) | 56 | 2 | 10 | 7 | 37 |
| **All** | **69** | **5** | **14** | **7** | **43** |

Of the **40 blocking** service requirements: **1** met, **7** partly, **6** a question for Mistral, **26** absent.

The absences are not scattered. They fall in one block: tables, open bills, reading a bill back, splitting it, taking a payment on it, and the fiscal receipt. Everything the pilot's ordering and paying flows stand on.

## Part 1 — the menu (M1–M13)

What the platform needs in order to show a venue's real menu on a guest's phone and keep it current.

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| M1 | A list of just the items a guest may order, apart from stock and kitchen raw materials | blocking | ◐ | `GetDefaultMenu` with the `WebCategory` tag gives a usable 61 items. `GetAllSelectableItems` returned `[]` on the demo, and `GetAllItems` returns all 336 nomenclature entries including raw materials and 195 priced 0 |
| M2 | A public name per item, not the internal one | blocking | ✓ | `Name` on each menu item |
| M3 | A second language for guests who do not read the venue's | blocking | ◐ | `AltName`; empty on 3 of the 61 |
| M4 | A price per item | blocking | ✓ | `BasePrice`, a JSON number (`8.49`; elsewhere `1.99000`) — parse as a decimal string, never as a float (rule 8) |
| M5 | Categories with their names and the order they are shown in | blocking | ◐ | The 12 categories come back with `Name` and `AltName` **empty**; the labels have to be joined from `GetTags` by `TagValueGuid`. No ordering field |
| M6 | A description per item | later | ✗ | `Description` and `AltDescription` empty on all 61. Restro's own enrichment covers it |
| M7 | A photo per item | later | ✗ | `ImagePath` is `/css/img/noimage.png` on every item and every category. `GetImage` exists but the demo has nothing to serve |
| M8 | The options a guest may choose, and which items allow which | blocking | ✗ | `GetModifiers` lists 4 sets — one empty, one internal (ЗА ТУК / ЗА ВКЪЩИ / ДОСТАВКА), one spices, one cooking degree (`RARE`, with no English on the first value). **Nothing links a set to an item**, so no choice can be expressed |
| M9 | Allergens per item | blocking (the law) | ✗ | `GetAllergens` and `GetNomenclatureExtraInfo` both answer `204`, no body |
| M10 | Whether an item is sold out | blocking | ✗ | `GetMaterialAvailablity` returns a bare `0.0` — and returned `0.0` for a drink on sale at a normal price. "None left" cannot be told from "not counted", so it would hide available drinks, which rule 5 forbids |
| M11 | A stable id per item that survives a rename | blocking | ✓ | `GId` per item |
| M12 | A read of only what changed since last time | later | ✗ | No "changed since" parameter anywhere; every sync is a full read of everything. One unguarded call (`GetMealPlans`) returned **49.7 MB** on a demo restaurant |
| M13 | No internal fields in what we are handed | blocking | ◐ | `Prime` — the cost price — ships with every menu item and has to be stripped before anything leaves the backend (rule 3) |

**The menu verdict:** buildable. M8, M9 and M10 are real gaps, and M1 and M5 need a connector that knows the right path and the trap beside it.

## Part 2 — service (C1–C56)

### Connecting and setting up

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| C1 | An API with written documentation, a service sign-in, terms and a price | blocking | ✓ | `Zamboo api v1`, OpenAPI 3.0.4, 45 operations, no login. Terms and price unasked (A2) |
| C2 | The reference as a file, not behind a login | later | ✓ | Served as JSON and YAML |
| C3 | A test installation, apart from live venues | blocking | ? | `demorestaurant.zamboo.bg` answers reads; whether it is a sandbox safe to write to is unconfirmed (A3) |
| C4 | On the tax authority's list of approved sales software, accepting an outside order as an import, with the producer's authorisation | blocking | ? | Not in the API's gift to answer (A2) |
| C5 | What the venue must set up before we may write: cash desk, open period, payment method, rights | blocking | ✗ | No cash desk, no cash period, no rights anywhere in the API |
| C6 | How a call says which venue it acts in | later | ◐ | A `dbGuid` selects one of the attached databases; `GetAttachedDbs` lists them (empty on the demo). Each venue appears to run its own host and key |
| C7 | Ask the POS whether it can take an order and a payment right now | blocking | ✗ | `GET /api/Test` is a liveness ping; the fiscal device is not in the API at all |
| C8 | The rights a waiter needs on a bill we opened | blocking | ✗ | No rights model in the API |
| C9 | The rights our API user needs on bills staff opened | blocking | ✗ | As C8 |

### Sending an order

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| C10 | Open a bill in one call with items, a table, a title, free text and our own order code, and get the bill's id back | blocking | ✗ | `SaveOrder` creates a **standalone** sale from a `BillDto` that has no table. It does accept our `extId` and returns an operation GUID |
| C11 | A row can carry the guest's choice of option, extra or combo part | blocking | ◐ | `matContent` and `linkedRowGuId` exist and `GetItemContent` is documented to return choosers — but no demo item had any content, and nothing links an item to its allowed options (A8) |
| C12 | The POS prices each row itself, so the guest is charged the POS's price | blocking | ✗ | The other way round: `price` is **required** on every row. `SaveOrderDefPrice` fills one in only where we send 0, and nothing reads the applied total back |
| C13 | An order can go to a table, and a table can hold several open bills | blocking | ✗ | No table and no open bill anywhere in the API. The word "table" does not appear in its 121 KB description |
| C14 | An outside order reaches the bar and kitchen the way a waiter's does | blocking | ? | Not stated (A5) |
| C53 | The bar can approve or decline an outside order, and we can read that back | later | ? | `orderValidationType` (0–2) may be this setting; values undocumented, nothing reads a decision back (A4) |
| C54 | Add a round to an open bill staff opened | later | ✗ | Every `SaveOrder` creates a new order; no call adds to an existing one |

### Not sending twice

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| C15 | The same order sent twice is refused the second time | blocking | ◐ | **Yes for an order:** `409` when an order with the same `ExtId` exists for that external system. No idempotency header |
| C16 | The refusal is tellable from every other error and names what already exists | blocking | ◐ | `409` against `404` and `401`, body a `ResError` with `ErrorCode` and `Message` — double-encoded as a JSON string. Whether it names the order: open (A6) |
| C17 | The duplicate check holds when two identical calls arrive together, and is remembered long enough | blocking | ? | Not stated (A6) |
| C18 | A call cut off halfway is all-or-nothing | blocking | ? | Not stated, and `SaveOrder`'s own description is a multi-step write |
| C19 | Yes, no and failed are distinguishable | blocking | ◐ | `200` with the GUID, `401`, `404`, `409` with a `ResError`. Also `204` with no body for an empty result, and two endpoints that answer with no JSON at all |
| C20 | A round added to a bill is guarded the same way | later | ✗ | Nothing adds to a bill, so there is nothing to guard |
| C21 | Our own id can be set on a bill and a row, read back and filtered by | later | ◐ | `extId` per order, and a duplicate is refused — but no call reads an order back by it, and rows carry no id of ours |
| C52 | After a timeout, read the table's bills to learn whether the round landed | blocking | ✗ | No bill reading. `GetOrderSales` lists sold rows for a date range without `extId` and without the operator, so a timed-out write cannot be matched |

### Reading a bill back

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| C22 | Read a table's open bills with rows, totals, paid, owed, open or closed | blocking | ✗ | **No bill-reading endpoint of any kind. This is the go/no-go, and it fails** |
| C23 | Per row: item, quantity, price, who placed it, when, served or not | blocking | ✗ | As C22 |
| C24 | How a row staff removed reads back | blocking | ✗ | As C22 |
| C25 | Find a bill again after staff moved, merged or split it | later | ✗ | As C22, and no split, merge or move exists to follow |
| C26 | A read limit we can live inside, and a read of only what changed | later | ✗ | No published rate limit, no versioning policy, no "changed since" |

### Splitting, merging and moving bills

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| C27 | Move chosen items onto a new bill, so one guest pays their own part | blocking | ✗ | No split, merge or move in the API |
| C28 | A split refuses cleanly when the quantity is already gone | blocking | ✗ | As C27 |
| C29 | The split and the close can be one request | blocking | ✗ | As C27 |
| C30 | Merge several bills of one table | blocking | ✗ | As C27 |
| C31 | After a timeout, tell whether the split happened | later | ✗ | As C27 |
| C55 | Name the exact row to split off, not just an item and a quantity | blocking | ✗ | As C27 |
| C56 | The new bill of a split lands on the table and reads back there | blocking | ✗ | As C27 |

### Paying and closing

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| C32 | Close a bill with a card payment, and the POS prints the receipt | blocking | ✗ | No close and no fiscal device in the API |
| C33 | Items, payment and close in one call (a pay-first order) | blocking | ◐ | `paymentKindGuid` and `sumPaid` let an order be recorded as card-paid in one call. Nothing says a fiscal receipt is issued, and nothing about one comes back (A1) |
| C34 | A bill closes itself when fully paid, or we close it | blocking | ✗ | No bill lifecycle in the API |
| C35 | A payment that does not equal the total is refused | blocking | ✗ | We send the price and the total; nothing checks it |
| C36 | Read the total back after the POS's prices and discounts, then pay exactly that | blocking | ✗ | As C35. **The guard that protects the guest cannot be built on this API** |
| C37 | One payment can cover a table's several bills | blocking | ✗ | One order carries one `paymentKindGuid` |
| C38 | A payment type for "card paid in the app": fiscal, kept apart from card at the bar, carrying the provider's reference | blocking | ◐ | `GetPayments` lists the installation's kinds — Cash (0), Card (1), Bank (5) — and an order names one. Whether any is fiscal and can carry the reference: open (A1) |
| C39 | A close sent twice does not pay twice | blocking | ✗ | There is no close. For an order, C15's refusal applies |
| C40 | Pay an amount against a bill without closing it, each with its own receipt | later | ✗ | Nothing of the kind |
| C41 | What happens when the fiscal device cannot print | blocking | ✗ | The fiscal device is not in the API |
| C42 | Which fiscal device prints, and where the paper comes out | blocking | ✗ | As C41 |

### Receipts and fiscal

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| C43 | A receipt reference back after a close or a pay-first order | blocking | ✗ | `SaveOrder` returns only the operation GUID. **We never take a guest's money without one** |
| C44 | An electronic receipt to the guest | later | ✗ | Nothing of the kind |
| C45 | Which operator is recorded on what we create | later | ◐ | `userGuid` is sent by us; which operator the POS records is unasked |

### Refusals and cancelling

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| C46 | A refusal says why, in a form we can read and act on | blocking | ◐ | A `404` with a `ResError` covers a failed material or customer check and names the guid; the catalogue of reasons is open |
| C47 | One unsellable row: the whole call refused, or that row dropped, named | blocking | ? | Not stated (A5) |
| C48 | Refuse a row or cancel a bill we opened, as a waiter would | later | ✗ | No cancel and no row refusal |
| C49 | A bill opened but never completed can be annulled and kept for the audit trail | later | ✗ | As C48 |

### Anything else

| # | Requirement | Need | Zamboo | Evidence |
|---|---|---|---|---|
| C50 | What the end of the POS's cash period does to open bills and writes in flight | later | ✗ | No cash period in the API |
| C51 | Tell staff inside the POS that an order or a payment needs a person | later | ✗ | No message to staff and no note on a bill; `description` is free text whose printing is open |

## Part 3 — what the Zamboo API does cover

The 45 operations, by what they are for. Only 17 of them are anywhere near what Restro needs.

| Group | Operations | Restro's use |
|---|---|---|
| Menu and items | 14 | **the one part that works** — Part 1 above |
| Customers and loyalty cards | 15 | none. Read a customer by phone, email or card; create, update, **delete** customers and cards |
| Reservations: sport facilities, courts, pricing, opening hours | 9 | none |
| Orders | 2 | `SaveOrder`, `SaveOrderDefPrice` — each creates a new standalone sale |
| Reporting | 1 | `GetOrderSales`: every item sold in a date range. A report, not a bill |
| Plumbing | 4 | payment kinds, external systems, attached databases, a liveness ping |

Two things tell you what this API is for. The order it takes carries a customer, an address, a delivery mode and a delivery date. And `GetExternalSystems` on the demo answers: **Glovo, Bolt, Wolt, WebOrders**. This is the aggregator door. Delivery has no tables, so the API has none.

## Part 4 — before a venue issues a key

Not a requirement on the API so much as a condition on using it. The key is a single query-string parameter with no scopes, so one key:

- reads the venue's entire customer base by phone, email or loyalty card, and can **permanently delete** customers and cards;
- rides in the web address, so it is written into server logs at both ends;
- can return database connection strings through `GetAttachedDbs` (an empty list on the demo, but the field is in the contract).

A venue must be told that plainly before it hands one over, and the pilot club's key must not be the key a developer holds.

## Part 5 — the seven rows that are questions, not answers

Six blocking requirements and one later one are marked ? because the API neither offers nor rules them out. They map onto the questions already with Mistral (A1–A10 in the 11-06 review):

| Rows | Question |
|---|---|
| C13, C22, C54, and with them C10, C23–C31 and C32–C43 | **A1. Is there a second interface for tables and open bills, and will you open it to us?** This one row decides the pilot |
| C4, and C1's terms and price | A2. Authorisation under Н-18 чл. 52з, ал. 5, and the terms and price of using the API |
| C3 | A3. Is `demorestaurant.zamboo.bg` a sandbox we may write test orders to? |
| C53 | A4. What `orderValidationType` does, and whether a decline reads back |
| C14, C47 | A5. Where an outside order appears in the venue, and what happens to a row that cannot be sold |
| C17, C16 | A6. The duplicate guard under concurrency, and what the refusal names |
| C11 | A8. How an item is linked to the options it allows |

**What would change this document.** If A1 comes back yes, Part 2 is re-run against that interface and most of Part 1 and Part 4 still stand — the menu, the money handling and the key's privileges do not change. If A1 comes back no, the pilot's menu can still come from the POS with ordering off, and the 26 absent blocking rows are the reason why.
