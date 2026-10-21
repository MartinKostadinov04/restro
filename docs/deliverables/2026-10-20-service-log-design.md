Made by: architecture subagent (Opus), 10-20, for the #39 grilling "Failure and pause during service" (map #29). Informs, never binds (D114).

# How to keep the Log: the order and everything that happened to it

## In plain words (for Martin)

Keep two things, the way Stripe, Shopify and Square do:

1. **The order itself, with only its current state** (Waiting, Sending, Added, Not sent…) and a few key times on it. This is D111's order record, kept 18 months. It answers "where does this order stand now?" in one look.
2. **A separate list of entries, one new entry for every step.** "Order 4K7 sent to the POS, 23:14:02." "No answer, checking, 23:14:32." "Added, 23:14:41." An entry is written once and never changed or removed (until its time is up). The same list also holds the venue's service events: a table paused, the venue paused, the owner's "Pause ordering" switch, an alert sent, a guard tripped.

The Log screen is that list, searchable by the guest's short reference, table, time and kind. Entries are kept a month; the orders themselves stay 18 months.

Your options: "a new record for each stage" is option 2, the common practice. "Only the latest stage" is option 1, which everyone keeps too, but alone it forgets the story. "A JSON of stages with booleans" is what none of the products below do (§1).

## What comparable software does

- **Stripe:** each object (a payment) carries its current `status`; every change also creates a separate, immutable `Event` holding the object at that moment, retrievable for 30 days ([events](https://docs.stripe.com/api/events)). Raw API calls are a third record, the request log ([request logs](https://docs.stripe.com/development/dashboard/request-logs), [retention](https://support.stripe.com/questions/stripe-request-log-retention-period)).
- **Shopify:** the order has its own status fields; its timeline is a list of `Event` rows (`action` such as `placed`, `message`, `createdAt`, `subject`), one event type for every kind of subject ([BasicEvent](https://shopify.dev/docs/api/admin-graphql/latest/objects/BasicEvent)). Events older than a year are no longer served while orders stay ([changelog](https://shopify.dev/changelog/events-data-now-limited-to-one-year-retention)).
- **Square:** the order holds `state` (OPEN, COMPLETED, CANCELED, DRAFT) and a `version` that rises on every update ([OrderState](https://developer.squareup.com/reference/square/objects/OrderState), [UpdateOrder](https://developer.squareup.com/reference/square/orders-api/update-order)).
- **Toast:** the order carries flags and dates (`voided`, `voidDate`); history comes through reports with who, approver and when ([voids](https://support.toasttab.com/article/Voiding-Items-Payments-and-Checks), [reports](https://support.toasttab.com/en/article/Exceptions-Report-Overview)). No public per-check history found.
- **OWASP:** an entry records when, where, who and what (action, object, result, reason), never session ids, tokens, passwords, personal or card data, and is protected against change and deletion ([cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)).
- **Microsoft on event sourcing:** complex, costly to leave, and for most systems plain current-state storage is enough; it also clashes with deleting data ([pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)).
- **Postgres:** dropping a monthly partition beats a bulk DELETE, but partitioning pays off only for very large tables, roughly beyond the server's memory ([partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)).

## 1. Recommendation: (b) current state on the order plus an append-only log

**Recommended (b).** The order row keeps its current state, updated in place inside the one transition writer; every transition, in the same transaction, appends one Log entry. This is Stripe's and Shopify's shape.

**Rejected:**
- **(a) current state only.** Cannot answer D111's evidence question ("I ordered and it never came": when was it sent, how long did the check take, what did the POS say). It loses who did what, which OWASP and every POS report keep.
- **(c) full event sourcing.** The current state would be rebuilt from entries on every guest poll and lock check (D117), and Microsoft names its conflict with deleting data, which the purge (D83) does. The POS is the truth for the bill (D111); Restro's order is a short-lived delivery record, not a ledger to replay.
- **(d) one JSON column of stages with booleans and timestamps.** A step can happen twice (Checking; approval then decline), and a boolean has no room for who, why or the POS's answer. Two writers (the worker, an approval read-back) would rewrite the same JSON. A venue pause has no order to hang on. Searching "every Unconfirmed tonight" inside JSON is awkward, and the stage list is frozen in the column (D116 already replaced A5's states once). What the products do keep on the object is a few milestone times (Toast's `voidDate`), so the order row gets plain columns: `sent_at`, `settled_at`, `final_reason`.

**One log or several: one Log for the venue's service, separate from two other records.**
- **The Log (new):** orders, payments, table and venue pauses, the owner's switch, alerts, guard trips. One table with a `kind`, as Shopify's one Event type covers every subject. The staff screen needs them interleaved: "the venue paused at 23:10, then table 12's order was Not sent".
- **Not the menu change log (`events`).** Its rows require a node (`node_id` NOT NULL with a foreign key to `nodes`), a field, a layer and a scope; an order has none. Its readers are the composer and the resolver.
- **Not the raw POS exchange.** A5 §5.1's append-only `command_attempts` (a safe summary of each call to the POS) and Fable's undecided 30-day raw log (D111) are the equivalent of Stripe's request log: for the Restro team, technical, separate from the Log. A Log entry points to its attempt by id.

## 2. What one entry holds

| Field | Notes |
|---|---|
| `seq` | identity, the order of entries; never in a URL |
| `tenant_id`, `venue_id` | row-level security and every search |
| `at`, `service_date` | time, and the venue's service day (ends 07:00) |
| `kind` | a fixed list: `order.state` (Waiting, Sending, Checking, Awaiting approval, Added, Not sent, Unconfirmed), `order.read_back`, `payment.*` (later), `table.paused` / `table.resumed`, `venue.paused` / `venue.resumed`, `ordering.switch`, `alert.sent`, `guard.tripped` |
| `order_id` (`od_`), `payment_id`, `table_id` (`tb_`) | each nullable; set when the entry is about one |
| `from_state`, `to_state` | for state changes |
| `reason` | a code from a fixed list (`sold_out`, `pos_refused`, `no_answer`, `guard_pace`, `owner_switch`…), translated on screen |
| `source`, `actor`, `job_id` | NOT NULL, rule 2: `guest`, `worker`, `owner`, `restro`; a staff user's id, or `system:<job>`; never anything about a guest's phone |
| `attempt_id` | the `command_attempts` row, if any |
| `details` | small, schema-checked (Zod) JSON: item count, total in minor units, the POS bill's number as staff know it, how long the check took, alert channel and recipient role |

**Never in an entry:** a phone, device, IP or browser identifier, or the paying phone's token (D111, D117); the guest's position (D118: never written anywhere); card data, provider secrets, POS keys or passwords; raw POS requests or responses; free text a guest typed (it stays on the order line). POS ids never leave the backend (rule 3): the Log is an admin screen, and the guest's API returns none of it.

## 3. The Log screen and "a month back"

**Search.** Always inside one venue. Default view: tonight's service day, newest first, one line per order with its current state and a fold-out of its entries, service events interleaved (Shopify's timeline). Filters: guest reference (exact, the short reference shown on Unconfirmed, D116), table, time or service day, kind (Orders, Payments, Pauses, Alerts, Guards) and state ("only Unconfirmed and Not sent"). Indexes: `(venue_id, at desc)`, `(order_id, seq)`, `(venue_id, table_id, at desc)`, and the reference on `orders (venue_id, service_date, reference)`.

**Retention (proposal).** The Log's entries: 31 days, counted by service day, then erased by the daily purge. The order and payment rows: 18 months (D111), then totals; they keep the current state, the milestone times, the reason, the POS bill reference and the provider's reference. This mirrors Stripe (events 30 days, objects kept) and Shopify (events one year, orders kept).

**Trade-off.** After a month, a late card dispute (up to 540 days) is answered from the order and payment rows, not step by step. That is enough to show sent, added, at what time and onto which POS bill; the venue's POS and the provider keep their own records (D111). Keeping entries 18 months would cost about 0.5 million rows per venue and holds more than the screen needs. Two months instead of one would share the change log's purge rule (D96).

## 4. Fit with the rules

- **Rule 1.** Orders are not field values or change sets; like `tables` and `places`, they are side tables written by core's own writers inside `core/apply` (A5: `placeOrder`, `recordOutcome` in `core/apply/orders.ts`). Each transition writer updates the order and appends its entry in one transaction; a test pins that no state change lands without one. Pauses, the switch, alerts and guard trips get writers there too.
- **Rule 2.** `source`, `actor`, `job_id` NOT NULL. The app role has INSERT and SELECT on the Log, no UPDATE and no DELETE, pinned in `packages/db/src/table-access.ts`.
- **Purge (D83).** `restro_purge` gets DELETE on the Log (and on orders, payments and `command_attempts` when they exist): age after 31 days, everything on a venue purge. Adding tables to the purge role's list is a guardrail change for Martin's OK, as D83 was. A row-by-row delete, as `purgeChangeLog` does, is fine at this size.

## 5. Cost at night (50-table club)

Assumptions: about 6 orders per table per night, 300 orders. A normal order writes 3 entries (Waiting, Sending, Added), 4 with approval; about 1 in 20 adds Checking and Unconfirmed; refused orders (sold out, guards) write 2. Payments, once built, about 4 each. Service events: tens.

- About 1,000–1,500 entries per night without payments, 1,500–2,500 with them.
- At about 400 bytes per entry with indexes: about 1 MB per night, about 30,000 entries and 15 MB per venue per month at 15 nights.
- Peak about one insert per second, nothing for Postgres. Monthly partitions pay off only near the server's memory (several hundred venues); then partition by month and drop old partitions.

## 6. Open questions

1. **31 days or two months?** Recommend 31 days, as asked; two months only if one purge rule for both logs matters more.
2. **Who sees which kinds?** Recommend: owners and managers see everything of their venue; `alert.sent` entries addressed to the Restro team and the attempt details show only to the Restro team.
3. **Payments in the Log or only in the planned append-only money-events table?** Recommend: the payments spec decides; if it builds money events, the Log shows them by reading that table, not by writing twice.
4. **Guard floods.** A bot at the pace limit could write thousands of entries. Recommend: one `guard.tripped` entry per table, guard and minute with a count in `details`; D118's per-table counts read from it.
5. **The short reference.** Recommend: unique per venue and service day, stored on the order; its format is the guest API's (#40).
6. **Bag edits.** Recommend: not logged (D117 keeps no "who added it"); only Send, which makes an order.
7. **Does the POS bill's number count as a POS id under rule 3?** Recommend: allowed on admin screens only, since staff find the bill by it in the POS; never on guest pages or in URLs.
