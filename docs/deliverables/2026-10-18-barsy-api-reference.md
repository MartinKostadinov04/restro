# barsy API reference for ordering (signed-in reading, 2026-10-18)

Ticket #34 of the map #29 "Ordering from the menu". The lead read these pages on docs.lukanet.com while Martin was signed in in the in-app browser, on 2026-10-18. These are Restro's own notes on what each page says, not copies. Base URL for every page: `https://docs.lukanet.com/barsy.api/`. Field names are barsy's. "Not stated" means the page says nothing about it.

Agents use this file instead of the site: the method pages need a sign-in that does not persist. Re-read a page only when a question here is marked open, or when barsy changes its API.

## What this answers for the map

| Question (ticket) | Answer from the docs | Page |
|---|---|---|
| Is a table required for a bill? (#35) | No. `place_id` is an optional field of the bill's input data; nothing marks it required. | `methods/accounts/place.html` |
| Can a table hold several open bills? (#35) | Yes. `Places_getlistwithaccountsonly` returns per table a count of open bills; `Accounts_mergebyplaceid` merges "all open bills on a table" into the oldest. | `methods/places/getlistwithaccountsonly.html`, `methods/accounts/mergebyplaceid.html` |
| Does `account_id` add a round to an open bill? (#35, #37) | Yes. `Accounts_place` "creates a new bill or continues an existing one (by `account_id`)" and adds new orders to it. Without `account_id` it creates a new bill. | `methods/accounts/place.html` |
| Can part of an open bill be paid? (#35) | Two routes. (1) `Payments_create` registers a payment and, through its `accounts` list, spreads the paid sum over those bills' remainders. Whether the bill must be open, and whether a fiscal receipt prints, is not stated. (2) `Accounts_getpaymentlink` makes a one-time public URL that pays the remainder, or a smaller `request_sum`, online. `Accounts_place` itself accepts payments only when it closes the bill. | `methods/payments/create.html`, `methods/accounts/getpaymentlink.html`, `methods/accounts/place.html` |
| Paying only one's own items (#35) | `Accounts_divide` moves chosen items and quantities from an open bill into a new bill (optionally with its own client and number of guests); that new bill is then paid and closed on its own. | `methods/accounts/divide.html` |
| Duplicates (#37) | `account.uuid` must be a valid UUID; a second request with the same uuid returns an error and creates nothing. No method reads a bill back by uuid: `AccountData` has no uuid field and `Accounts_getlist` has no uuid filter. | `faq/41-account-create-duplicate-protection.html`, `methods/accounts/getlist.html` |
| Reading the order's progress (#37) | `AccountData.service_status_id` / `service_status_name`; the `Accounts_getlist` filter names the values: 1 waiting for payment, 2 waiting for approval, 3 for service, 4 served, 5 delivered. `Accounts_servicestatusgetlist` returns the installation's configured statuses. Per row, `OrderData.status` / `order_status_title`, `served_date`, `served_by`. | `methods/accounts/getlist.html`, `methods/accounts/get.html`, `methods/accounts/servicestatusgetlist.html` |
| Cancelling a row on an open bill (#37) | Not a separate method. `Accounts_place` takes `reason_id` "needed for refusals", from `Reasons_getlist` (each reason says whether the refused item still leaves stock). How a refusal is sent (a row with a negative quantity is our reading, not stated for open bills) is open. A closed bill is reversed with `Accounts_storno`. | `methods/accounts/place.html`, `methods/reasons/getlist.html` |
| What a write needs (#37, setup) | Creating, editing or reversing bills and payments, and client orders, must come from a **registered cash desk** for that venue. The venue's admin assigns a personal cash desk to the API user; one cash desk per venue if the user works several venues. `Poses_getcurrent` checks it. | `faq/91-posnotfound.html` |
| Which venue a call acts in | Every request runs in one venue's context; pass `barsy_id` as a URL parameter, else barsy picks a default (`Barsys_getcurrent`). | `faq/40-account-create-multidelivery.html` |
| Prices | `OrderMakeData.original_current_price` can set a row's sale price; when omitted barsy uses the current price. Restro never sends it (rule 5). | `methods/accounts/place.html` |

## Methods

### Accounts_place: create or continue a bill, add orders, optionally pay and close
`methods/accounts/place.html`. barsy calls it its most powerful cash-desk method and recommends it over `Accounts_create` + `Accounts_close` for new integrations (mobile ordering, kiosks, online shops).
- `account_id` int: the bill to continue; omitted = a new bill.
- `account` AccountInputData: the bill's data (below).
- `orders` OrderMakeData[]: the rows to add.
- `payments` AccountPaymentInputData[]: payments made now; **accepted only when the bill is closed**.
- `flag_close_account` int, default 0: close the bill in this call.
- `reason_id` int, default -1: reason for the order, needed for refusals (`Reasons_getlist`).
- `client_code` string: a client card code.
- `invoice_data` InvoiceMakeData: issue an invoice for the bill.
- `print_shipment` int, default 0; `print_receipt` int, default 0 (local print of a slip for the order).
- `payments_for_current_user` int, default 1: payments are created as the API user.
- Returns int: the bill's number.

**AccountInputData** (also used by `Accounts_create`, `Accounts_createfromclientorder`):
- `uuid` string: unique bill id for duplicate protection; generated by barsy when omitted.
- `client_id` int, default 1 (Anonymous); `client` ClientInputData (create or recognise a client); `person_id`, `person`.
- `place_id` int: table, room or place (`Places_getlist`). Optional.
- `discount` float (whole bill), `ref_date` (document date), `persons` int (number of guests).
- `delivery_address`, `contact_name`, `phone`, `tracking_number`, `speditor_id`, `delivery_zone_id`, `delivery_date`.
- `account_alias` string: the bill's title, shown in bill lists.
- `description` string: free text **printed on the receipt**. `notes` string: free text **not printed**.
- `paid_due_date`: deferred payment until.
- `storno_data` InputStornoData: the bill this one reverses.
- `deal_id`, `calculate_orders_discount_flag`, `skip_account_discount_recalculate_flag` (default 0).
- `client_order_id` int, `external_source` object|int|null, `additional_data` object, `reservation_id` int: no description on the page.
- `lang_id` string: item names on the fiscal receipt in this language, where set.
- `calculate_start_date` bool, default false: for restaurant bills (`delivery_type` = no), false leaves the start of service empty so orders are visible at once; true computes it from the batch and `order_service_date`.
- `order_service_date` string: wanted completion time for this batch; barsy checks it and errors with the earliest possible time. Not stored.
- `currency_id`, `currency_rate`.

**OrderMakeData** (a row): `article_id` int; `amount` float; `original_current_price` float (sale price; current price when omitted; `current_price` is deprecated); `discount` float (row %, separate from the bill discount); `tax_id`; `modificators` ModificatorInputData[] (`mod_name`, `description`, `mod_type` 1 or 2, undescribed); `article_attributes`; `supplements` ArticleSupplementData[] (combo parts: `article_id`, `amount`, `supplement_price`, `supplement_group_id`, `discount`, `tax_id`, `article_attributes`, `lot_value`); `storno_of_account_id` (only with a negative quantity); `tax_region_id`.

**AccountPaymentInputData** (a payment inside `Accounts_place`): `paymethod_id` (`Paymentmethods_getlist`); `original_paid_sum` float in the payment's currency; `currency_id`; `req_value`; `payment_data` object (free keys); `transaction_id`; `ref_num`; `description`; `actual_paid_sum` (before change); `storno_sum`, `storno_of_account_id` (for reversing payments).

**InvoiceMakeData**: `gen_mode` (1 detailed, 2 summary, 3 summary over several bills); receiver company, EIK, VAT number, MOL, name, town, address, country; `print` bool.

### Accounts_create / Accounts_close
`methods/accounts/create.html`: opens a bill with `account` AccountInputData and optional `rows`; the bill stays open for more orders, payments and edits. Returns the bill id. barsy points integrations to `Accounts_place` instead.
`methods/accounts/close.html`: closes an open bill with `payments` (cash, card, cheque, voucher, mixed, several currencies), **prints the fiscal receipt on the configured fiscal device**, updates stock, optional shipment print, `client_code`. After closing, the bill is read-only for ordinary users. Returns nothing.

### Accounts_get / Accounts_getlist: read bills back
`methods/accounts/get.html`: `account_id`, `extra_properties` (`orders` grouped rows, `orders_history` every row, `payments` grouped, `payments_history` every payment, `account_period` default true, `close_pos_id`, `ref_id`, `remote_id`, `next_service_status`, `user_can_edit`, `confirmation_output_screen_check`). Returns AccountData.
`methods/accounts/getlist.html`: `filters` (below), `extra_properties` (same flags), `offset` (default 0), `length` (default 1000), `order_by` (`account_id`, `account_num`, `create_date`, `close_date`, `ref_date`, `last_order_date`, `total_sum`, `total_remain`, `status`, `client_id`, `user_id`, `barsy_id`, `place_id`; asc or desc).
Filters: `account_id`, `account_sid`, `barsy_id`, `user_id`, `paymethod_id`, `period_id`, `client_id`, `client_group_id`, `place_id`, `status` (0 open, 1 closed), `list_closed`, `list_opened`, `service_status_id` (1 waiting for payment, 2 waiting for approval, 3 for service, 4 served, 5 delivered), `service_statuses_with_confirmation_output_screen`, `place_zone_current_user`, `create_date`, `close_date`, `ref_date`, `last_order_date`, `delivery_date`. No uuid filter.

**AccountData** (what a bill reads back as): `account_id`, `account_sid`, `barsy_id`, `barsy_name`, `menu_id`, `create_date`, `close_date`, `user_id`/`user_name` (staff currently responsible), `place_id`, `place_num`, `place_type`, `place_type_name`, `salon_name`, `status` (0 open, 1 closed), `is_locked`, `client_id`, `client_name`, `person_id`, `person_name`, `total_sum`, `discount`, `total_real` (after discount: the final total), `total_paid`, `total_remain` (still owed), `total_sum_after_row_discount`, `total_sum_storno`, `total_paid_sum_storno`, `last_order_num`, `ref_date`, `description`, `notes`, `account_alias`, delivery fields, `orders`/`orders_history` (OrderData[], when asked), `pos_id`, `pos_name`, `close_pos_id`, `close_pos_name`, `period_id`, `persons`, `account_period`, `payment_name`, `paymethod_id`, `paid_due_date`, `account_num` (sequence in the cash period), `unp` (the sale's unique number, УНП), `payments` (PaymentGroupedData[]), `payments_history` (PaymentData[]), `deal_id`, `client_order_ids`, `service_status_id`, `service_status_name`, `user_can_edit`, `additional_data`, `lang_id`, `confirmation_output_screen_check`, `confirmation_outputs`, `preferred_paymethod_id`, `currency_id`, `currency_rate`, `remote_id` (a remote system), `ref_id` (the bill's id in a remote system; how it is set is not stated), `*_curr` variants of the sums. No uuid.

**OrderData** (one row, also `Orders_getlist`'s result): `order_id`, `account_id`, `barsy_id`, `pos_id`, `place_id`, `article_id`, `article_name`, `article_name_ml`, `article_type`, `stream_id` (kitchen or bar stream), `amount`, `current_price`, `actual_price`, `status`, `order_status_title`, `date`, `start_service_date`, `served_date`, `served_by`, `served_by_user`, `user_name` (who placed it), `process_time`, `order_ref_id` (the row's id in an outside system; how it is set is not stated); on request: `discount`, `tax*`, `line_total`, `original_current_price`, `current_pricelist_id`, `reason_id` (sale, return, storno, advance payment), `storno_of_account_id`, `modificators`, `article_attributes`, `outputs` (printers, screens, label printers, remote systems that the row went to).

**PaymentData** (one payment): `operation` (CRD income, DBT expense), `payment_id`, `barsy_id`, `period_id`, `paymethod_id`, `original_paid_sum`, `paid_sum`, `paid_used`, `available_sum`, `user_id`, `client_id`, `create_date`, `ref_date`, `delete_flag`, `fx` (1 = fiscal: it performs a fiscal operation), `confirmed`, `ref_num`, `description`, `req_value`, `payment_data`, `payment_print_data` (receipt print data), `transaction_id`, `storno_sum`, `storno_parent_id`, `currency_id`, `currency_rate`, `provider_id` (VPOS, POS terminal), `type_id` (-2 service, -1 unknown, 1 cash, 2 bank, 3 voucher, 4 cheque, 5 card present, 6 card not present, 7 other, 8 cash on delivery, 9 postal order, 10 barsy voucher fiscal, 11 bonus programme, 12 barsy voucher non-fiscal).
**PaymentGroupedData**: `paymethod_id`, `name`, `fx`, `paid_sum`, `payments_count`, `export_id`, `transaction_id`.

### Accounts_servicestatusgetlist
`methods/accounts/servicestatusgetlist.html`: no parameters; returns the installation's service statuses for a bill (operational progress independent of payment, e.g. accepted, in preparation, ready, served). Installations configure their own chains; used by kitchen displays and couriers.

### Accounts_divide, Accounts_move, Accounts_merge, Accounts_mergebyplaceid, Accounts_mergebyclientid, Accounts_clone
- `divide`: `old_account_id`, `orders` OrderMakeData[] (items and quantities to move), `persons`, `client_id` (default Anonymous). Creates a new bill with those rows and removes them from the original. Returns the new bill's id. Typical: each guest at a table pays their own items.
- `move`: `account_id`, `place_id`, `user_id`. Moves an open bill to another table and/or staff member; without the "direct transfer" right the new staff member must accept it first, and until then both see it. Returns nothing.
- `merge`: `accounts` (ids), `move_discount_to_orders` (default false). Rows go to the oldest bill; the others close empty. Closed or fiscally marked bills cannot be merged (storno first). Returns the merged bill's id.
- `mergebyplaceid`: `place_id`, optional `accounts` subset, `move_discount_to_orders`. Merges all open bills on a table into the oldest, whatever their clients.
- `mergebyclientid`: `client_id`, optional `accounts`, `move_discount_to_orders`.
- `clone`: `account_id`. A new bill copying client, rows, prices, notes; no payments or fiscal events; its own УНП.

### Accounts_save_notes
`methods/accounts/save_notes.html`: `id`, `values` (object or array). Updates notes and editable attributes of a bill without touching rows or payments; checks the user's right to edit the bill in its current status. The page does not list the keys of `values`.

### Accounts_storno / Accounts_getstornoreasons
- `storno`: `account_id` (a closed bill), `article_ids` (empty = all), `payments` (to refund; empty = all refunded), `storno_data` InputStornoData (`storno_reason`: return, mistake, reduction_tax_base; `unp`, `receipt_num`, `receipt_date`, `fm_num` of the reversed receipt). Creates a reversing bill with its own УНП and a storno fiscal receipt; irreversible. Returns the reversing bill's number.
- `getstornoreasons`: the standard reasons sent to the fiscal device (Н-18); the device refuses a storno without a valid one.

### Accounts_getpaymentlink
`methods/accounts/getpaymentlink.html`: `account_id`, `request_sum` (default: the remainder), `paymethod_id` (default: the guest chooses), `exp_hours` (default: system setting). Returns a one-time public URL to pay the bill online without signing in. Typical cases named: a link after leaving the table, paying a large bill in parts.

### Accounts_createfromclientorder
`methods/accounts/createfromclientorder.html`: `client_order_id`, `account_props` AccountInputData, `flag_close_account` (default 0), `payments` (accepted only when closing). Turns a client order into a cash-desk bill.

### Payments_create / Payments_getlist
- `create` (`methods/payments/create.html`): `paid_sum`, `client_id`, `paymethod_id`, `description`, `ref_num`, `ref_date`, `accounts` (bill ids to link: the sum is spread over their remainders), `payment_type` (undescribed). Returns the payment id. Typical cases named: a deposit for a future order, settling an old debt. Whether it prints a fiscal receipt, and whether a linked bill may be open, is not stated.
- `getlist` (`methods/payments/getlist.html`): `filters` (`payment_id`, `client_id`, `account_id`, `user_id`, `unused`, `storno_available`, `has_paid_sum`, `is_printed` = printed or fiscalised), `extra_properties` (base, full, invoices, receipt_data), `offset`, `length` (default 500), `order_by` (default `payment_id`).

### Paymentmethods_getlist
`methods/paymentmethods/getlist.html`: filters `paymethod_id`, `barsy_id`, `role_id`, `is_public`, `type_id`, `has_provider`, `provider_name`, `storno_enable`, `currency_id` and others. Returns per method: `paymethod_id`, `name`, `fx` (performs a fiscal operation), `public_name`, `type_id`, `provider_id`, `deny_anonymous` and more. Online methods appear only while the provider integration is healthy.

### Reasons_getlist
`methods/reasons/getlist.html`: reasons for refusing an order on an open bill; each has `reason_id`, `name`, `upd_store` (0 the refused item still leaves stock, 1 it does not).

### Orders_getlist
`methods/orders/getlist.html`: rows (not bills), filters by `account_id`, `order_id`, venue, period, client, payment method, dates (`date`, `served_date`), status and more; `length` default 10000. Returns OrderData.

### Places_getlistwithaccountsonly
`methods/places/getlistwithaccountsonly.html`: only tables with at least one open bill, with aggregated data; supports a checksum for incremental refresh. Returns PlaceAccountsData: `place` (PlaceData: `place_id`, `place_num`, `type_name`, `is_public`, `salon_id`, `salon_name`, `accounts_count` = open bills on the table) and `accounts` (AccountData).

### Messages_create
`methods/messages/create.html`: `id`, `values` (`recipients` names or ids, `subject`, `text`, `msg_type` default 5, `send_date`, `parent_id`), `action_type` (save or save_draft). Internal messages to staff users. Whether they reach the hall tablet is not stated (Q48).

### Client orders: Clientorders_create, _setstatus, _getstatuslistdata, _getpaymentlink
- `create`: `order` ClientOrderInputData (client, venue, delivery data, notes, `order_num` = an outside number), `rows`, `payments` (advance payments). A pre-order independent of any bill; it becomes a bill only when fulfilled. barsy may send webhook events after creation.
- `setstatus`: `client_order_id` (one or many), `status_id`; transitions are checked against the user's role and the current status.
- `getstatuslistdata`: the installation's statuses (`status_id`, `status_name`, `color`, end flags).
- `getpaymentlink`: as for bills, for a client order (e.g. a partial deposit).

### Poses_register / Poses_getcurrent
- `register`: `pos_id`; returns `poskey`, `barsy_public_key`, `has_cdx`. Registers a physical device as a cash desk; the registering user's session ends and the device then works with its key. Restro does not call it (D110: no POS registration).
- `getcurrent`: the cash desk of the current session (id, name, venue, hall, fiscal printer state, `generates_unp`, `default_place_id` and many UI settings). Use it to check that the API user has a registered cash desk.

### Webhooks (not used: D41, D110)
`integrations/40-webhooks.html`: one subscription per user per object type (`Webhooks_subscribe` with `event_type_id`: 1 articles, 2 bills, 3 client orders, 4 clients, 5 orders, 6 categories, 7 reservations, 8 modifiers, and a URL). Checked every minute; the payload holds only type, id and C/U/D, never the object; signed with `X-Signature` (HMAC-SHA256) and `X-Webhook-ID`; retries back off up to an hour; disabled after 14 days without success (`Webhooks_restart`).

### Pages with nothing more
- `integrations/60-orders.html` ("Sending an order as a bill to barsy"): a title and a link to the bill glossary entry; no content.
- `integrations/work-scenarios/public_orders.html`: the typical public-ordering flow (guest orders in an app or website, pays online or at the venue, the order goes to barsy as a bill with or without payment, the guest gets an order number and follows its status); points to the article-sync and order pages.
- `examples/accounts.html`: one PHP example of `Accounts_place` creating and closing a bill; positional arguments.
- `faq/100-calculations.html`: row total = amount × price with the row discount; bill total = sum of rows with the bill discount. The formulas are images; the page's worked example rounds to the stotinka.

## Still open after this reading (for Lukanet, with Q79)
1. Does `Payments_create` linked to an open bill print a fiscal receipt, leave the bill open, and count as a partial payment under Н-18 чл. 26а?
2. How is a single row refused on an open bill through the API: a negative row with `reason_id`? What does the bar get?
3. Can an integrator set `ref_id` / `order_ref_id`, so a bill or row can be found by our id?
4. Which `service_status_id` does a bill from the API get under each approval mode, and does approval or a decline show in it?
5. Does `Accounts_place` with a `place_id` honour the cash desk's approval mode ("For confirmation")?
6. `external_source`, `client_order_id`, `additional_data`: what do they accept and do?
7. Can integrators get this reference offline (a file or an OpenAPI description), since the docs sign-in does not persist?
