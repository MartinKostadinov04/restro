# How other software decides a table visit
Made by: research subagent (Sonnet), 10-18, for ticket #36 "What is a table visit" of map #29.

Summary:
- No product I could read defines a "table visit" as its own stored object. In every case the visit is either the open check(s) on the table, a guest-owned tab, or a short-lived session token.
- The POS side is the same: Toast, Lightspeed K-series and Simphony give a check a table reference and expose no table status or table session in their APIs. "Occupied" is a screen colour, derived from open checks.
- Only one product documents a table state gate (a table that goes back to "Held" when an order completes). Only one documents a session time-out (30 minutes of inactivity, and it is not one of the products asked about).
- Nobody I read documents a location (geolocation) check. The location is the table code in the QR.
- What happens to the page when a check closes, and what the next guest sees, is undocumented for nearly every product asked about.
- Barsy's public help has no table-status or QR-session page. Its web-order guide does describe an order "created and closed immediately" (pay-first).
- Marking: [DOC] = official docs, help centre or API reference; [VENDOR PAGE] = marketing or press; [NOT FOUND] = searched, nothing public. [READING] = my inference.

## A. QR order-and-pay apps

**Toast Mobile Order & Pay.** Each table has its own QR code [DOC] (1). A server can open the check at the POS and guests "join the same check" by scanning; group ordering must be on, guests enter a name and add to the same tab [DOC] (1)(2). Guests can pay their own items or the whole check [DOC] (1). Guests close the tab from their phone, and staff are told to remind them [DOC] (2). Staff can also close a tab on the POS [DOC] (3). Table colour goes from yellow to white when payment completes (Toast's mobile-payments flow; seen in a search extract of article 4, not opened) [DOC]. After the check closes, what the QR shows, a time-out, and a location check: [NOT FOUND] in articles 1, 2, 3.

**Square.** Each QR code maps to one ordering location such as a table; orders from one table can be consolidated into one ticket [VENDOR PAGE] (5). Session end, next guest, time-out, location: [NOT FOUND].

**Lightspeed K-series (Order Anywhere / Order & Pay).** The marketing page says guests scan a table QR, order, and close their own bill [VENDOR PAGE] (6). The API reference has "Get Open Check by Table" (`GET /o/op/1/order/table/{tableNumber}/getCheck`), which "returns an open order for a specific table" and, if more than one order sits on the table, returns the oldest [DOC] (7). A second call reads a check by `accountIdentifier` (an account id such as `A78094.69`); the page does not say whether closed checks come back [DOC] (8). An Order and Pay webhook group exists [DOC] (9). A third-party integrator (storekit) fetches the open check for the table number when a guest scans, confirms the check still exists before adding to it, waits and re-checks so simultaneous orders join one check, and closes its own bill when the amount due is zero or the check was settled at the POS [VENDOR PAGE, third party] (10). Lightspeed's own session rules: [NOT FOUND].

**Sunday.** Table QR gives menu access; when guests ask for the check, staff give a receipt with a unique QR and the guest pays by phone [VENDOR PAGE] (11). Session start/end, next guest, time-out, location: [NOT FOUND].

**me&u / Mr Yum.** me&u staff guide: orders are linked to the QR code scanned; a guest can start a tab and move around, but food goes to the QR location [DOC] (12). Mr Yum: one guest scans to open a tab; others join through a new QR on the first guest's phone or a shared link [VENDOR PAGE] (13). Check-closed behaviour, next guest, time-out, location: [NOT FOUND].

**Qerko.** Guest scans the table's code or taps NFC, pays all or part; the register gets a notification [VENDOR PAGE] (14). With Storyous, the bill closes automatically as paid (seen in a search extract; the page returned 403) (15). Table-session rules: [NOT FOUND].

**Ready.** App-free; payments are synced to the POS and closed [VENDOR PAGE, trade press] (16). Rest: [NOT FOUND].

**Zamboo QR menu.** Product page: ordering by phone from the table, cart review before sending [VENDOR PAGE] (17). How the order meets a POS bill, and any session: [NOT FOUND]. The help centre top page lists only product sections (18).

**Barsy QR / online menu.** The Zones page says that with a local QR menu a guest can order from the table, and the order shows only to the user whose zone holds that table, under "accounts for confirmation" [DOC] (19). The website-order guide lists four ways the shop's order can land: an open client order for review, an open account, a closed account "created and closed immediately" (no staff review), or a stock transfer [DOC] (20). Table QR session, time-out, location: [NOT FOUND].

**Other findings (not on the list, for contrast).**
- Fleksa: "Session expires after 30 minutes of inactivity"; guest re-scans the table QR [DOC] (21).
- Bank of America's POS: a table must be in "Held" status to accept QR orders; when an order is fully completed the table returns to Held, "New customers can scan the same QR code" [DOC] (22).
- SwiftPOS Order Away: each table QR is the same location link with a table value, e.g. `?location=Table 12` [DOC] (23).

## B. POS systems

**Toast.** Table colours: green, red, yellow, blue, grey, and "dotted border: the table is empty" [DOC] (24). How a table returns to empty, "table turn", "clear table": [NOT FOUND] (24)(25). Several checks can sit on one table, and "All checks" shows open, paid and closed ones [DOC] (25). The API order has a `table` reference only; "no table status or table session field" [DOC] (26). An order is closed when all its checks are closed; a check's `paymentStatus` CLOSED means nothing is due but "is not prevented" from going back to OPEN or PAID; the check `closedDate` is set when payment and tip are added, or in the nightly batch if there is no tip [DOC] (26)(27).

**Square for Restaurants.** The floor plan can turn a table yellow, then red, by how long its check has been open [DOC] (28). Merged tables show as occupied (28). What frees a table, and "clear table": [NOT FOUND].

**Lightspeed K-series.** The Floor plan screen shows "occupied and available tables"; "Covers" counts the separate orders on occupied tables [DOC] (29). The tables API returns `number`, `reference`, `id`, `active`, `description`, `defaultClientCount`, and no status [DOC] (30). What frees a table after payment: [NOT FOUND] (29).

**Oracle Simphony.** A check has `CheckTableObjectNum`; `GetOpenChecks` lists open checks; the dining-table list is configuration. No table-status operation appears [DOC] (31). Found by keyword search of the 19.2 guide, not read in full.

**Barsy.** The account is "the central document of a Sale", records the place (table, room), and is open or closed; closing needs balanced payments [DOC] (32). Accounts can be moved to another table [DOC] (33). Table free/occupied status, "close table": [NOT FOUND] in the pages I could read. Billiards is the one place a table session exists: opening an account starts the timer and lights, closing the account ends it [DOC] (34). [READING] So in barsy a table is in use exactly while an open account sits on it.

**Microinvest Restaurant, uTill/unTill, Zamboo POS, Mistral.** [NOT FOUND] (searched; no public table-status page returned).

**Other.** Fleksa POS: "Complete payment to free up tables"; a table with several orders stays occupied until all are complete [DOC] (35). Revolut POS and Lightspeed O-series are said, in search extracts only (pages returned 403), to have a "mark table as free" and a "ready to be cleared" state; treat as unverified.

## C. What this means for Restro

Four patterns, facts first.

1. **Visit = while the table has an open check (no separate object).** Toast (order closed when all checks closed; empty table), Lightspeed K-series (open check by table, oldest first), Simphony, Fleksa POS (frees when all orders complete), barsy (account open/closed), storekit on Lightspeed (bill closes at zero due).
   *Pay-first:* [READING] the check is closed at once, so the table counts as empty straight after ordering. A group ordering a second round would open a new check, so the "visit" would end after every round. Under this pattern, pay-first needs another rule to keep one visit across rounds.

2. **Guest-owned tab.** Mr Yum (tab opened by the first scan, shared by link), Toast group tab (join the check, pay own items), me&u (tab tied to the scanned QR). The visit is whatever the first guest started.
   *Pay-first:* [READING] a tab that is paid per order never stays open, so this pattern also needs the group to stay linked by something else. None of the sources says how.

3. **Session that expires.** Only Fleksa documents it: 30 minutes of inactivity, then re-scan [DOC] (21). None of the products asked about publishes a time-out.
   *Pay-first:* [READING] unaffected by checks; it ends by time, so a closed check does not matter.

4. **Table state gate or staff clear.** Bank of America POS: the table returns to Held when an order is completed, and the same QR works for the next guest [DOC] (22). A staff "clear table" step exists in Revolut and Lightspeed O-series per unverified extracts. In Toast, Lightspeed K-series and Square, I found no staff clear action documented.
   *Pay-first:* in the Bank of America case the table is back to Held the moment the order is fully completed [DOC] (22); the other two are [NOT FOUND].

Also: none of the products read here checks the phone's location; "where" is the table code in the QR (23). No product documents what a new guest sees on a page left open by the previous group.

## Sources
1. https://support.toasttab.com/en/article/Mobile-Order-and-Pay-Overview
2. https://support.toasttab.com/en/article/Staff-Training-Guide-Toast-Mobile-Order-and-Pay
3. https://support.toasttab.com/en/article/Toast-Mobile-Order-and-Pay-FAQs
4. https://support.toasttab.com/en/article/Setting-up-mobile-payments-and-digital-menus (search extract only)
5. https://squareup.com/us/en/online-ordering/qr-code-ordering
6. https://www.lightspeedhq.com/uk/pos/restaurant/order-anywhere/ (from search extract)
7. https://api-docs.lsk.lightspeed.app/operation/operation-apechecklookup
8. https://api-docs.lsk.lightspeed.app/operation/operation-apechecklookupwithaccountidentifier
9. https://api-docs.lsk.lightspeed.app/group/endpoint-order-and-pay-webhook
10. https://storekit.com/docs/guides/integrations/pos/lightspeed/pay-at-table
11. https://sundayapp.com/digital-bill/
12. https://meandu.helpjuice.com/en_US/us/foh-staff-training-material-ncr
13. https://www.eposnow.com/au/resources/mr-yum/
14. https://www.qerko.com/eng/pay
15. https://help.storyous.com/hc/en-gb/articles/37996092747409 (search extract; 403)
16. https://hospitalitytech.com/ready-launches-app-free-order-table-platform-restaurants (search extract; 403)
17. https://zamboo.bg/web-menu.html
18. https://help.zamboo.bg
19. https://docs.lukanet.com/barsy.help/120-posx/110-zones.html
20. https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html
21. https://fleksa.com/docs/end-customer/qr-ordering/4-1-authentication
22. https://merchanthelp.bankofamerica.com/Point-of-Sale-Solution-QR-Codes
23. https://help.swiftpos.com.au/configure-for-order-at-table
24. https://support.toasttab.com/en/article/Creating-Service-Areas-and-Table-Setup-1493049150430?lang=en_US
25. https://support.toasttab.com/en/article/New-POS-Managing-Tables
26. https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Order/
27. https://doc.toasttab.com/doc/devguide/apiOrdersOrderObjectSummary.html
28. https://squareup.com/help/au/en/article/8146
29. https://k-series-support.lightspeedhq.com/hc/articles/360050328494
30. https://api-docs.lsk.lightspeed.app/operation/operation-apegettables
31. https://docs.oracle.com/cd/F32325_01/doc.192/f32377.pdf
32. https://docs.lukanet.com/barsy.help/210-dictionary/account.html
33. https://docs.lukanet.com/barsy.help/120-posx/025-account-move.html
34. https://docs.lukanet.com/barsy.help/220-workflows/billiards.html
35. https://support.fleksa.com/en/articles/15419177-table-management
Unverified extracts: https://developer.revolut.com/docs/guides/in-person-payments/pos/ios-app/table-service ; https://o-series-support.lightspeedhq.com/hc/articles/31329411093659
