# How QR ordering apps write orders into the POS

Made by: research subagent (Sonnet), 10-18, for ticket #36 of map #29 (Martin asked whether D112 matches common architecture).

Summary:
- Where I could read it, the QR products that document the point put a second guest's order **on the table's existing open check** (Toast with group ordering, Qerko `toBill`, storekit on Lightspeed K-series with batching on). None documents "a new check per order" as its design.
- Guest-owned tabs are the other documented model (me&u, Mr Yum, Toast pre-authorised tabs). Barsy's own help shows QR orders arriving as "accounts for confirmation" (staff approval).
- Most products asked about publish nothing on this: sunday, Ready, Zamboo, Otter, Chowly, Omnivore (its docs are behind a login) are [NOT FOUND].
- Four POS APIs have a documented guard for a retried add: Toast (unique `externalId` per line, 409 on reuse), Simphony Gen2 (`idempotencyId`, 300 s, single workstation), Square (`idempotency_key` plus `version`), Lightspeed K-series (`thirdPartyReference` must be unique, but its scope on an update is not stated).
- Lightspeed's integrator storekit does not retry an add to an existing bill after a failure and tells the venue to watch for missing rounds. That is the one documented case of an integrator treating adds as unsafe to repeat.
- Barsy has the add (`account_id`) but no documented guard for it (see the barsy note).
- Marks: [DOC] official docs, API reference or help centre; [VENDOR PAGE] marketing; [NOT FOUND] searched, nothing public; [READING] my inference. Numbers in brackets are sources at the end.

## 1. When a second order arrives at a table with an open check

Letters: (a) onto the table's existing check, (b) a new check on the table, (c) a guest-owned tab, (d) held for staff approval.

| Product | Answer | Evidence |
|---|---|---|
| Toast Mobile Order & Pay | (a) when group ordering is on; (c) for guest-started pre-authorised tabs | A guest "can scan the table's QR code, enter their name, and add to the existing tab"; the guide says "No need for multiple tabs or checks" [DOC] [1][2]. Guests can also open their own tab (standard or pre-authorised) [DOC] [3]. If nothing joins the check the article does not say [NOT FOUND]. |
| Toast Orders API (what partners like QR apps call) | (d) possible | An order created through the API can sit in `NEEDS_APPROVAL`: "The order is created but will not be fulfilled by the restaurant until an employee approves it" [DOC] [4]. |
| Square (QR code ordering) | (a), configuration unknown | "Consolidate orders from the same table into a single ticket" [VENDOR PAGE] [5]. How, and whether on by default: [NOT FOUND]. Square's own docs say UpdateOrder cannot update orders made in Square POS [DOC] [6], so an outside app cannot append to a ticket staff opened [READING]. |
| Lightspeed K-series Order & Pay / Order Anywhere | Lightspeed itself: [NOT FOUND]. Via integrator storekit: (a) with "Add to bill batching" on | storekit: "in-store table orders go to the existing open check rather than creating a new order"; it confirms the check still matches and adds to it; "two orders placed at the same moment go onto the same check rather than opening two" [DOC, third party] [7]. Lightspeed lists "Flex": diners and servers "add items to a combined table at the POS" [VENDOR PAGE] [8]. |
| sunday | [NOT FOUND] | Marketing says guests "scan, order, reorder and pay" and the Digital Bill page says guests "still place orders with staff" [VENDOR PAGE] [9]. |
| me&u | (c) | Tabs exist; food goes to the QR location; every printed order is already paid [DOC] [10]. The POS check mapping is [NOT FOUND]. |
| Mr Yum | (c) | One guest opens a tab, others join by a new QR or link [VENDOR PAGE] [11]. POS mapping [NOT FOUND]. |
| Qerko | (a) when the POS reports an open bill; new bill if the table is empty | The POS-side API has two order targets. `toBill`: the POS should "simply append the ordered items to the existing bill"; `toTable`: "create a new bill on the specified table" [DOC] [12]. Rejection codes include `BILL_LOCKED`, `BILL_CLOSED`, `TABLE_NOT_FOUND` [DOC] [13]. |
| Ready | [NOT FOUND] | Only trade press: payments synced and closed in the POS [VENDOR PAGE]. |
| Zamboo QR | [NOT FOUND] | Product page: phone ordering from the table, cart review before sending [VENDOR PAGE] [14]. |
| Barsy QR / online menu | (d) | Zones page: with a local QR menu the guest orders from the table and the order shows only to the user in charge of that zone, as "accounts for confirmation" [DOC] [15]. Whether it joins an open account: [NOT FOUND]. The web-shop guide lists four landings (client order, open account, closed account, transfer) [DOC] [16]; no table or existing-account rule there. |
| Deliverect (table ordering) | (a) possible; fallback is a note | With Sync Tables the channel sends the table id and the order is "opened directly on the POS table"; otherwise the table goes in the order notes [DOC] [17]. Joining an existing check is not stated [NOT FOUND]. |
| Grubbrr | (a) or new | "customers can scan a QR code at their table to create or join an order", via the HMS Host middleware [DOC] [18]. |
| Omnivore (Olo) | [NOT FOUND] | The core API docs are behind a login [19]. A third-party wrapper README shows "open ticket" needs a table id and "add item" takes a ticket id [20]; nothing on joining. |
| Otter, Chowly | [NOT FOUND] | No dine-in documentation found. |

## 2. Is a retried "add items" safe? The rule, quoted

- **Toast Orders API, add selections** (`POST /orders/{orderGuid}/checks/{checkGuid}/selections`). "The `externalId` values for the `Order`, `Check`, and `Selection` objects must be unique." "`HTTP 409 (conflict)`: Returned when you reuse an `externalId` that already exists." "`HTTP 400`: Returned when you include duplicate `externalId` values within the same request." "To prevent duplicate items during retries, ensure each new line item is assigned a unique `externalId`." [DOC] [21]. Also: "You cannot add items to a check in a restricted order" (a closed order becomes restricted after a time) [21]. Toast announced that uniqueness enforcement starts 2026-02-02; the page names Selection identifiers and gives no error code [DOC] [22]. Guard type: unique external reference per line; a retry gets 409, which means the first landed [READING].
- **Lightspeed K-series, local order.** `thirdPartyReference`: "The external reference provided for this order. Must be unique." The 409 example reads "reference has already been used 123456789." `accountIdentifier`: "If this is specified, the associated order will be updated"; `tableNumber` and `clientCount` cannot be updated. Whether supplied items are added or replace the item list: not stated. No retry or idempotency text [DOC] [23]. Whether a repeated reference is refused on an update is not stated [NOT FOUND].
- **Oracle Simphony Gen2 (`POST /checks/{checkRef}/round`).** Opt-in by header `Simphony-Features: detect-duplicate-request`; "you must provide a unique `idempotentcyId` value for each request"; covered: `POST /checks` and `POST /checks/{checkRef}/round`; ids "retained for 300 seconds"; "the scope of the `idempotencyId` is limited to a single workstation"; a match with a prior success returns the original response (`isCachedResponse` true); a duplicate during a pending request waits up to 30 seconds; if the POS received the first but has not processed it, the retry gets 400 `duplicate_request`, "duplicate request detected, no response found" [DOC] [24]. For the older `AddToExistingCheckEx` I found no guard text [NOT FOUND]; see the bill-in-pos note.
- **Square UpdateOrder.** `idempotency_key`: "A value you specify that uniquely identifies this update request"; resend with the same key "without worrying about creating duplicate updates" [DOC] [25]. `version` "must be set to the current version of the order or your request returns an error"; the stated purpose is to stop an update overwriting another app's change [DOC] [26]. Without a new key on each new update "you get a 200 response but the returned order doesn't reflect any of your updates" [26]. Square's key page does not give a retention period [27].
- **Omnivore, add item.** [NOT FOUND] in public sources; official docs need a login [19].
- **Deliverect.** Not an add-to-check API. Each channel order carries a `channelOrderId`, described as unique and not reusable for 48 hours after pickup (search extract; the page itself would not load for me) [DOC] [28]; duplicate ids are hidden as duplicates [DOC] [29]; the same id with status 100 means cancel [28]. A 201 does not prove the POS processed it [28].
- **Qerko.** The POS-side order methods define no uniqueness, duplicate or retry rule for `orderStart()`; Qerko says to contact its support [DOC] [12][13].

## 3. "The call timed out: did the round land?"

| Product | What is documented |
|---|---|
| Toast | Retry with the same line `externalId`: 409 means it exists. An order can be read back by its `externalId` ("GET the order with that externalId") [DOC] [30]. No read-back by line id found. |
| Square | Retry with the same `idempotency_key`; Orders can be re-read, and `version` guards stale writes [DOC] [25][26]. |
| Simphony Gen2 | Same `idempotencyId` within 300 s returns the cached response; after that window, unknown [DOC] [24]. |
| Lightspeed K-series | Reference uniqueness only; the outcome of storekit's orders comes back by webhook ("Accepted", receipt reference stored) [DOC, third party] [31]. storekit retries a new order up to 5 times but "Orders added to an existing bill ... are not retried — they are marked Failed on the first failure" and it advises venues to watch failed orders [31][7]. |
| Qerko | The POS answers `orderStart()` synchronously; timeouts and duplicates not documented [DOC] [12]. |
| Deliverect | Status webhook after the 201; no read-back by `channelOrderId` found [DOC] [28]. |
| me&u, Mr Yum, sunday, Ready, Zamboo, barsy QR, Otter, Chowly, Omnivore | Not documented [NOT FOUND]. |

## 4. Patterns

1. **One check per table, rounds appended.** Toast group ordering [1][2]; Qerko `toBill` [12]; storekit on Lightspeed K-series [7]; Square's "consolidate" claim [5]. POS needs: find the table's open check (Lightspeed "Get Open Check by Table" [32]; Qerko `getTableContents`) and add items by its id. Retry safety, where documented: Toast `externalId` per line, Simphony `idempotencyId`, Square key plus `version`. storekit instead refuses to retry.
2. **New check (or ticket) per order, staff merge.** I found no product that documents this as its design. It is what a plain "create order" call does by default [READING], and Square's community forum has a user saying one table can hold many checks (search extract, not opened). Deliverect's channel orders are separate orders unless a table id attaches them [17]. POS needs: only a create call with a caller reference (Lightspeed `thirdPartyReference`, barsy `uuid`) and a merge for staff.
3. **Guest-owned tab, closed at the end.** me&u [10], Mr Yum [11], Toast pre-authorised tabs [3]. POS needs: nothing special for ordering, but the tab is a payment object (a stored card) held by the QR app; how it maps to POS checks is [NOT FOUND].
4. **Staff approval gate.** Barsy's zone-based "accounts for confirmation" [15]; Toast `NEEDS_APPROVAL` [4]. POS needs: a pending state the API can create.
5. **Pay-only, reading the POS check.** Qerko pay, sunday Digital Bill, storekit pay-at-table; the POS creates all orders [9][7]. Not a way to write orders.

## 5. Where Restro's D112 sits (facts only)

- Products documented as adding to the table's open check: Toast (group ordering), Qerko (`toBill`), storekit on Lightspeed. None documents opening a new check per order as its design; the closest is the default behaviour of a create call (pattern 2).
- Products documented with guest-owned tabs: me&u, Mr Yum, Toast. Barsy's own QR menu is documented as staff-confirmed accounts.
- Capability that would let Restro append rounds to the table's open check: (1) read the table's open check, and (2) add items to it by id, ideally with (3) a duplicate guard on the add. From Restro's barsy note: `Accounts_place` with `account_id` continues an existing bill, `Accounts_getlist` filters by `place_id` and `status` open; (3) is missing: `uuid` protects only new bills and there is no lookup by our code.
- The documented guards that would give (3) elsewhere are per-line external ids (Toast), request idempotency ids (Simphony Gen2, Square) or a unique order reference (Lightspeed, unclear on updates).
- Whether any product on the list uses barsy's append is unknown [NOT FOUND]; none of the researched QR products has a public barsy integration page.

## Sources

1. https://support.toasttab.com/en/article/Mobile-Order-and-Pay-Overview
2. https://support.toasttab.com/en/article/Staff-Training-Guide-Toast-Mobile-Order-and-Pay
3. https://support.toasttab.com/en/article/Toast-Mobile-Order-and-Pay-FAQs
4. https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Order/ and https://doc.toasttab.com/doc/devguide/apiOrdersFirstOrder.html
5. https://squareup.com/us/en/online-ordering/qr-code-ordering
6. https://developer.squareup.com/docs/orders-api/manage-orders/update-orders
7. https://storekit.com/docs/guides/integrations/pos/lightspeed/pay-at-table.md
8. https://www.lightspeedhq.com/uk/integrations/meandu/
9. https://sundayapp.com/digital-bill/
10. https://meandu.helpjuice.com/en_US/us/foh-staff-training-material-ncr
11. https://www.eposnow.com/au/resources/mr-yum/
12. https://docs.qerko.com/docs/extension-orders and https://docs.qerko.com/docs/flows
13. same pages as 12 (error codes listed on the orders extension page)
14. https://zamboo.bg/web-menu.html
15. https://docs.lukanet.com/barsy.help/120-posx/110-zones.html
16. https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html
17. https://developers.deliverect.com/v1.1-restaurants/docs/how-to-handle-eat-in-orders
18. https://help.grubbrr.com/articles/1911598739-how-to-create-and-manage-tables-in-the-grubbrr-portal
19. https://panel.omnivore.io/docs/api/1.0/tickets (login page only)
20. https://github.com/lfrichter/omnivore (third-party wrapper)
21. https://doc.toasttab.com/doc/devguide/apiAddingItemsToACheck.html
22. https://api-updates.toasttab.com/announcements/ann_z11cnPVqO0LjR
23. https://api-docs.lsk.lightspeed.app/operation/operation-apelocalorder
24. https://docs.oracle.com/en/industries/food-beverage/simphony/omsstsg2api/detect_dup_requests.html
25. https://developer.squareup.com/reference/square/orders-api/update-order
26. https://developer.squareup.com/docs/orders-api/manage-orders/update-orders
27. https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency
28. https://developers.deliverect.com/page/channel-orders (via search extract)
29. https://developers.deliverect.com/v3.0-ordering-experience/docs/troubleshooting
30. https://doc.toasttab.com/openapi/orders/operation/ordersPost/
31. https://storekit.com/docs/guides/integrations/pos/lightspeed/orders.md
32. https://api-docs.lsk.lightspeed.app/operation/operation-apechecklookup
