# The Zamboo API: what it is, and what it gives Restro

Made by: the lead session (Opus), 11-06, for Martin. For: T69, the go/no-go on Mistral as the pilot's POS, and the agent who will build the Mistral connector.

This replaces the "unknown" column of `2026-10-20-mistral-api-checker.md`. It is the living reference for Mistral Software (Zamboo): every row carries its source and the date it was learnt. Tags: **[DOC]** read in the OpenAPI description; **[TESTED]** a call made against the demo installation on 11-06; **[UNKNOWN]** not answerable from either.

## The short answer

Mistral **does have a documented API**, and the 10-20 conclusion ("no public API") is out of date. It is `Zamboo api v1`, OpenAPI 3.0.4, 45 endpoints, served without a login at `https://demorestaurant.zamboo.bg/swagger/v1/swagger.json`.

It is not the API Restro needs. It is the **delivery and web-shop channel** — the one Glovo, Bolt and Wolt plug into. It reads the menu well and it accepts a complete, standalone order. It has **no table, no open bill, no split, no payment taken on a bill and no fiscal receipt**. In the checker's three steps:

| Step | Verdict |
|---|---|
| 1. Menu from the POS | **yes**, and better than expected |
| 2. Ordering on the table's bill | **no** on this API |
| 3. Paying in the app | **no** on this API |

By Martin's own rule (checker 7.8), no R3 and no R6 means no ordering at a venue on this POS. But the conclusion to draw is not "no": Zamboo web already "applies an action to an open bill" from a browser, so a table-service interface exists inside the product. **The question for Mistral is now one question, not twenty-three:** this is your delivery channel — is there a second interface for tables and open bills, and will you open it to us? That is a far better question than the one we were going to send, and we only know to ask it because the delivery API is documented.

## 1. What was read and tested

| Source | What it is | Tag |
|---|---|---|
| `https://demorestaurant.zamboo.bg/swagger` → `/swagger/v1/swagger.json` (and `.yaml`) | `Zamboo api`, version `v1`, OpenAPI 3.0.4, 45 operations, 41 schemas. No login, no `securitySchemes` block. Descriptions are generated from the C# source and are unusually detailed — several name the internal method called | [DOC] 11-06 |
| Live read-only calls with Martin's key against `demorestaurant.zamboo.bg` | 14 GET endpoints called; no write was made. Raw responses kept out of the repository | [TESTED] 11-06 |
| `2026-10-20-mistral-api-checker.md` | the 20 actions Restro needs (R1–R20) and the three-step go/no-go | — |
| `docs/connector-questions.md` | the 56 POS questions (C1–C56); its Mistral lines are updated in the same change as this file | — |

**Authentication.** One `apiKey`, passed as a **query parameter** on every call. No header is offered. Absent or wrong key → `401` [TESTED]. The two `SportFacilities` write endpoints take the key in the request body instead — the same API, two placements [DOC]. No scopes, no expiry, no rotation and no per-endpoint rights are documented [UNKNOWN].

**Which installation.** `demorestaurant.zamboo.bg` is one venue's own host, so each venue appears to run its own Zamboo instance with its own key. A `dbGuid` parameter on most calls selects one of several attached databases; `GetAttachedDbs` lists them and returned an empty list here [TESTED], so the demo has one database.

## 2. The 45 endpoints, by what they do

**Menu and nomenclature (13).** `GetAllItems`, `GetAllSelectableItems`, `GetItemsByTagValue`, `GetItemContent`, `GetDefaultMenu`, `GetTags`, `GetTagValues`, `GetModifiers`, `GetAllergens`, `GetImage`, `GetNomenclatureExtraInfo`, `GetMealTypes`, `GetMealPlans`.

**Stock (1).** `GetMaterialAvailablity` — one material per call, returns a bare number.

**Orders (2).** `SaveOrder`, `SaveOrderDefPrice`. Both create a new sales order from a `BillDto` and return its operation GUID.

**Sales read-back (1).** `GetOrderSales` — every item sold in a date range, with quantity, price, discount and final amount.

**Customers and loyalty cards (14).** Read by guid, phone, email, card or external code; create, update and delete; attach and delete cards. `DeleteCustomerByExtCode` deletes the customer, all its cards and its mappings.

**Reservations (1 + 8).** `CreateReservation` (a table reservation: name, date, phone, email, guest count, note) and a whole `SportFacilities` controller — facilities, opening hours, pricing models, reservations, add and edit.

**Setup and health (3).** `GetExternalSystems`, `GetAttachedDbs`, `GetPayments`, plus `GET /api/Test` (returns 200 with an empty body [TESTED]).

**What is nowhere in the API:** tables, open bills, bill rows read back, splitting, merging, moving, taking a payment on a bill, closing a bill, the fiscal device, receipts, cash desks, cash periods, operators, rights, printers, kitchen or bar tickets, webhooks (which we do not want anyway, D41), rate limits, delta or "changed since" reads, and paging.

**The external systems tell the story.** `GetExternalSystems` returned four: **Glovo**, **Bolt**, **Wolt** and **WebOrders** (`extId` 999, `selectOrderType` 5, `orderValidationType` 2) [TESTED]. This is the aggregator channel, and `WebOrders` is very probably what Zamboo Web Menu uses. The two enums are undocumented integers and are the most interesting undocumented thing in the API: `orderValidationType` may be the approval-at-the-bar setting D116 wants.

## 3. Each action Restro needs

The checker's 20 rows, re-read against the API. "Need" is unchanged from 10-20.

| # | Action | Need | Verdict | Evidence |
|---|---|---|---|---|
| R1 | Read the menu | must | **yes** | §4 below. Items, categories, prices, modifiers, allergens, images, meal plans [TESTED] |
| R2 | List the tables, and the bar each belongs to | should | **no** | no table anywhere in the API [DOC] |
| R3 | **Read a table's bill with its rows** | **must (go/no-go)** | **no** | no bill-reading endpoint of any kind [DOC] |
| R4 | Who entered each row, and when | should | **no** | `GetOrderSales` has the date and hour of a sold row, no operator [DOC] |
| R5 | Is the table open | must | **no** | follows R3 |
| R6 | **Add a round to a table's bill** | **must** | **no** | `SaveOrder` always creates a new standalone sales order; `BillDto` has no table and there is no "add to bill" call [DOC] |
| R7 | Refuse a duplicate round | should | **yes** | `409` when an order with the same `ExtId` already exists for that external system. The one strong guarantee on the write side [DOC] |
| R8 | A note on a round that prints on the bar ticket | should | **partly** | `BillDto.description` and `BillRowDto.description` exist; whether either prints anywhere is [UNKNOWN] |
| R9 | Approval at the bar, read back | later | **maybe** | `ExtSysSettingsModel.orderValidationType` (0, 1, 2), undocumented values; nothing reads a decision back |
| R10 | Move chosen lines, part of a quantity, to another table | pay | **no** | no split, merge or move [DOC] |
| R11 | A round on a virtual table closed with a card payment in one go | pay | **partly** | `BillDto` carries `paymentKindGuid` and `sumPaid`, so an order can be *recorded* as card-paid; nothing says a fiscal receipt is issued, and nothing about one comes back [DOC] |
| R12 | Close a bill with a card payment, printing the fiscal receipt | pay | **no** | no close, no fiscal device [DOC] |
| R13 | Read back the closed bill: receipt number, УНП, a copy | pay | **no** | `SaveOrder` returns an operation GUID and nothing else [DOC] |
| R14 | Read Restro's virtual tables and confirm they are empty | pay | **no** | follows R3 |
| R15 | A cheap read for health checks; is the fiscal printer ready | should | **partly** | `GET /api/Test` is a cheap liveness check [TESTED]; the fiscal device is not in the API at all |
| R16 | Sign-in model: one POS user for all bars, or one per bar | must | **partly** | one `apiKey` per installation, `dbGuid` for attached databases; no users, no bars, no per-bar key [DOC] |
| R17 | Several card payments on one close | later | **no** | one `paymentKindGuid` per order [DOC] |
| R18 | Pay an amount off an open bill | out at the pilot | **no** | — |
| R19 | Storno and refunds | not needed | **no** | — |
| R20 | **Written authorisation** under Н-18 чл. 52з, ал. 5 | **must** | **still to ask** | unchanged by anything here |

Two rows moved from "unknown" to "yes": **R1** and **R7**. The three that decide ordering — **R3, R5, R6** — are no on this API.

## 4. The menu, in detail (R1)

This is the part worth building on, and the demo showed a clear right way and wrong way to read it.

**The wrong way: `GetAllItems`.** 336 items [TESTED], and it is the whole nomenclature: 203 of them are raw materials (`СУРОВИНИ КУХНЯ`, `СУРОВИНИ БАР`), 195 have a price of 0, and 266 have no English name at all. Reading the menu from this call would put litres of vodka and kitchen stock on the guest's page. `GetAllSelectableItems`, which sounds like the answer, returned an empty list [TESTED].

**The right way: the `WebCategory` tag.** `GetTags` returns a `WebCategory` tag whose 12 values are the web menu's categories, each with a Bulgarian `text` and an English `altText` (`1.САЛАТИ` / `1.SALADS`) [TESTED]. `GetItemsByTagValue` returns the items of one category, and `GetDefaultMenu` returns the whole structure in one call, each category carrying its `TagValueGuid`.

Through that path the demo's menu is **61 items in 12 categories, every one priced, and only 3 without an English name** [TESTED]. That is a usable menu.

Three cautions for the connector:

- **Category names come back empty from `GetDefaultMenu`**: every one of the 12 had `Name` and `AltName` as `""`, while the label sat in the tag value's `text`/`altText` [TESTED]. So read the categories from `GetTags` and join on `TagValueGuid`; do not trust `GetDefaultMenu`'s own category names.
- **No descriptions and no images** in the demo: all 61 items had an empty `Description` and `ImagePath` of `/css/img/noimage.png` [TESTED]. Restro's own enrichment supplies both, which D64 and D87–D92 already allow on a POS venue.
- **Options and add-ons are a gap.** `GetModifiers` returns real modifier sets (e.g. steak doneness `RARE`…`WELL DONE`) [TESTED], and `GetItemContent` is documented to return choosers with quantity limits for operation-type items — but not one of the first 40 sellable items had any content (`404`, "Item not found") [TESTED]. So nothing in the API links an item to the modifiers it allows. On this installation, items with options cannot be read as such (C11).
- **Sold out cannot be read.** `GetMaterialAvailablity` is one call per item and returned `0.0` for a priced, sellable item [TESTED]. Zero cannot be told from "not stock-tracked", so it is no basis for marking an item sold out. Under rule 5 we may only ever be more cautious than the POS, so a wrong zero would hide a drink that is on sale: do not wire this up without an answer from Mistral.

**The cost of a menu sync.** Items, allergens, images, content and availability are each one call per item: a 61-item menu is roughly 1 + 4×61 calls, and a club's full nomenclature would be 1 + 4×336. There is no delta read and no paging, so every sync is a full read — which at least suits rule 6, since a single unpaged response cannot half-fail.

## 5. Quirks a connector must handle

These are contract facts, all [TESTED] on 11-06, and each one is a Zod boundary.

1. **Prices are JSON numbers with five decimals**: `"basePrice":1.99000`, `"basePrice":0.00000`. Rule 8 holds exactly as it does for barsy: parse losslessly from the decimal text, convert, round half-up. Never the parsed float.
2. **Empty results are `204` with no body**, not `200` with `[]` — `GetAllergens` and `GetNomenclatureExtraInfo` both did this. A parser that expects JSON will throw on a perfectly normal answer.
3. **Error bodies are double-encoded**: the `404` from `GetItemContent` was a JSON *string* containing JSON — `"{\r\n \"ErrorCode\": 107,\r\n \"Message\": \"Item not found …\"\r\n}"`. Parse twice, and the error does name the offending guid.
4. **Some answers are not JSON at all**: `GetMaterialAvailablity` returns a bare `0.0`, and `GET /api/Test` returns an empty body with `200`.
5. **One response was 49.7 MB.** `GetMealPlans` returned 9,372 meal plans carrying 74,976 embedded item records, because it is documented to load everything active from now to `DateTime.MaxValue` and takes no date parameter and no paging. The worker must never call it unguarded.
6. **Internal fields come down with every item** — `primePrice` (the cost price), `code`, `storeGuid`, `vatGuid`, and internal type names like `СУРОВИНИ БАР`. Rule 3: strip all of it before anything reaches a snapshot, the shell or a face.
7. **VAT is not resolvable**: every item's `vatGuid` was all-zeroes, while the rate is implied by the item type's name (`ПРОДАЖБИ БАР 20%`, `ПРОДАЖБИ БАР 9%`) [TESTED]. Never parse a tax rate out of a name; ask.
8. **We send the price, the POS does not price the row.** `price` is required on every `BillRowDto`; `SaveOrderDefPrice` only fills a price in when we send 0. Nothing reads the applied total back. So C12 and C36 — "the guest must pay what they were shown", proved by reading the POS's own total before taking money — cannot be satisfied here.

## 6. Security and privacy

Worth Martin's attention before any key is handed over, and worth raising with Mistral.

1. **The key is in the URL.** Every call carries `?apiKey=…`, so the credential lands in the web server's logs, any proxy's logs and any browser history on both sides. Ask for a header. Until then the connector must keep whole URLs out of its logs (our logs are structured and never carry secrets anyway).
2. **One key does everything.** The same key that reads the menu can read the venue's entire customer base by phone, email or card, and can create, update and permanently delete customers, loyalty cards and their mappings. There are no scopes. For a pilot club this is a GDPR exposure the venue should understand before it issues one, and Restro's connector must call only the menu endpoints — a boundary worth a guardrail test in the package, not just a convention.
3. **The contract can hand out database credentials.** `GetAttachedDbs` returns a `connectionString` per attached database. It was an empty list on the demo, so nothing leaked here, but at a venue with attached databases this endpoint would return connection strings to any key holder. Restro should never call it.
4. **Reservations may be writable without the venue's involvement.** `SportFacilities/AddReservation` and `EditReservation` take the key in the body; `EditReservation` edits any reservation by its integer `id`, and ids are sequential. Not our feature, but if a venue's key ever leaks, its booking book is editable.
5. No rate limits, no versioning beyond `v1`, no deprecation policy and no terms are published [UNKNOWN].

## 7. Go / no-go

**Step 1, the menu: yes.** A Mistral venue's real menu, prices and category structure can be read today, through the `WebCategory` path, with Restro supplying descriptions and photos. Sold-out marking is not safe yet, and options cannot be read. This alone is worth having: the pilot's guest page would show the club's real menu instead of one typed by hand, and D90 fixes a venue's source at creation, so getting this right at the start matters.

**Step 2, ordering on the bill: no, on this API.** R3 and R6 both fail. Nothing in the delivery channel touches a table or an open bill.

**Step 3, paying in the app: no, on this API.** No close, no fiscal receipt, no receipt reference, and no way to read a total back before taking money.

**My recommendation.** Do not read this as "Mistral is out". Read it as: we have found the wrong door, and it is well documented. Three things follow, and none of them needs a decision from you today beyond the first:

1. **Ask Mistral the one question** (§8). Their own Zamboo web applies actions to open bills from a browser, so the interface exists; whether it is offered to integrators, documented and authorised is the whole of it.
2. **Keep building against `sim-pos`.** Nothing here changes the ordering build on `or/foundation`: it was always written against the simulated POS until a real connector exists, and D124's switches cite question numbers, not a POS.
3. **The fallback is unchanged and now cheaper.** If the answer is no, the pilot can still run on this API with the menu read from the POS and no ordering — better than the hand-made menu we assumed as the fallback on 10-20.

What I would *not* do: build a Mistral connector on `SaveOrder`. An order that lands as a delivery ticket with no table, no bill and no receipt is not Restro's ordering feature, and it would need unpicking later.

## 8. What is left to ask Mistral

The 23 questions of `2026-10-21-mistral-questions.md` were written when we thought there was no API. Most are now answered or pointless. What remains, in the order they matter. Elsewhere — in `docs/connector-questions.md` and in the tracker — these ten are cited as **Mistral A1–A10**, keeping their numbers here.

1. **Is there a second interface for tables and open bills?** Zamboo web applies actions to an open bill from a browser. Can an outside application read a table's open bills with their rows, add a round to one, split it, and close it with a card payment that prints the venue's fiscal receipt? Is it documented, and may Restro use it? (This replaces old questions 3, 8, 10–15, 17, 22, 23.)
2. **Written authorisation** under Н-18 чл. 52з, ал. 5, with terms and price, for Restro to connect to a venue's installation — and is Zamboo on the NRA's list of sales software, under which name and version? (Old 1, 5, 21.)
3. **A test installation.** Is `demorestaurant.zamboo.bg` your sandbox, safe for an outside app to write test orders to? If not, can Restro have one? Development never runs against a live venue (rule 7).
4. **The two undocumented enums**: what do `ExtSysSettingsModel.selectOrderType` (0–6) and `orderValidationType` (0–2) do? Does either mean the bar approves an order before it counts, and can the decision be read back? (Old 14.)
5. **`SaveOrder` in practice**: where does such an order appear — does it reach the kitchen and bar screens and printers, does it print anything on the fiscal device, and what does `BillDto.description` print on? (Old 13.)
6. **The `ExtId` guarantee**: is the duplicate check safe when two identical calls arrive together, how long is an `ExtId` remembered, and is it per external system or per installation? (C15–C17.)
7. **Sold out**: is `GetMaterialAvailablity` maintained for bar and kitchen items, and how is "not stock-tracked" told from zero?
8. **Options**: what links an item to the modifiers it allows, and why does `GetItemContent` return 404 for sellable items?
9. **Keys**: can the key travel in a header, can it be scoped to the menu endpoints only, and how is it rotated?
10. **Per-bar logins**: does each bar sign in separately, and does one key act across all of them? (Old 19.)

Questions 2, 4, 6, 7, 18, 20 of the old list are answered or dropped. Question 1 above is the one that decides everything; the rest only matter if it is a yes.

## 9. Out of scope, worth a line

- **The API has table reservations** (`CreateReservation`: name, date, phone, email, guest count, note) and a full sport-facilities booking module. The Club Biad port's reservations feature (outside the MVP, pinned read-only) would have a POS-side home at a Mistral venue. Not now; worth remembering.
- **`GetOrderSales`** gives item-level sales for a date range with discounts resolved. If Restro ever wants to show a venue what it sold, that is the call — and it is the only read-back of anything that happened at the till.
- **Loyalty cards.** The customer and card endpoints are a complete loyalty surface. If a club ever wants the guest's card recognised in the app, it exists. It is also the reason the key is as dangerous as §6 says.
