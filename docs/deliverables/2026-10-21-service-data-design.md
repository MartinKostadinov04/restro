Made by: Opus design agent for #55, 10-21. For: the ordering lead.

# Service data: its tables, its write path, staff roles and how long each record is kept

A technical proposal for #55 (map #29). It informs and never binds (D114): the lead decides the technical rows and takes the role questions to Martin. It builds on D111, D115–D122 and on the logs of #37 (`2026-10-19-order-life-decision-log.md`), #39 (`2026-10-20-failure-pause-decision-log.md`), #40 (`2026-10-20-guest-api-decision-log.md`) and #54 (`2026-10-21-refunds-disputes-decision-log.md`), and on the Log design (`2026-10-20-service-log-design.md`) and the lock design (`2026-10-19-table-bag-locking.md`). No settled row is reopened. Words follow `GLOSSARY.md` and D122 §2.

## In plain words

Service data (sittings, orders, sent orders, payments, waiter calls, pauses, alerts, the Log) lives in its own tables, written only by `applyService(command)` in `core`, the twin of `apply(changeSet)`. Every row says who caused it and through which job, never anything about a guest's phone. The app deletes nothing; the nightly purge erases on schedule through `restro_purge`. Staff act through per-venue roles built from a fixed permission list, with a PIN on a shared device.

## 1. The tables

**Shared by every table below.**
- `tenant_id` NOT NULL, composite foreign keys `(tenant_id, x_id)` as in the menu tables, and FORCE row-level security through `restro.enable_tenant_rls`.
- `venue_id` and, where it applies, `service_date`: the venue's service day, which ends at 07:00.
- **Provenance** (rule 2, §2.2): `source`, `actor` and `job_id`, all NOT NULL. A row updated in place carries the provenance of its last write, and the history is in the Log or the step records.
- Ids are opaque, prefixed and 128-bit (`packages/core/src/ids.ts`). New kinds: `st` sitting, `to` order (`tableOrder`), `ol` order line, `so` sent order, `py` payment, `wc` waiter call, `al` alert, `pa` pause, `br` bar, `rl` role, `sm` staff member, `dv` shared device. Append-only rows (Log entries, payment steps, notices) use an identity `seq` that never appears in a link.
- **Never stored in service data** (D111, D117, D118, rule 3): card digits of any kind, the last four included; a guest's phone, device, IP, browser or push identifier; the guest's position; the paying phone's token; the table code (it lives only on `tables`); POS ids outside the columns marked *backend* below; secrets, POS keys or raw POS requests. Backend columns never reach a guest; a POS bill number and a receipt number may show on admin screens (D120 5.5).

**Sittings, and tables open for phones** (`sittings`, `st_`). A table is open for phones exactly while it has a sitting with no end; there is no separate flag. Columns: table, service day, `opened_at` and how (one table or Open all), `ended_at` and `end_reason` (bill closed, staff closed, new guests, closing hour, code re-issued), `had_bill_lines` (so a table opened before the waiter's first item isn't ended by being empty, D122 §4), and the provenance of opening and end. Indexes: partial unique `(tenant_id, table_id)` where `ended_at is null` (one open sitting per table); `(venue_id, service_date)`.

**The order** (`table_orders`, `to_`). One row per sitting, inserted on the first add and updated in place (the lock design's shape). Columns: sitting, table, `version` (only rises), `lines` jsonb (`{id: ol_…, itemId: nd_…, optionIds, qty, note, rev, heldBy: py_…|null, removedAt}`, no price), `earlier` and `earlier_at` (the earlier order and its Restore), `recent_actions` (a ring of the last 64 action ids and their results), `idle_expires_at`. When the sitting ends the service path empties `lines`, `earlier` and `recent_actions`, so unsent notes go at once. Unique `(tenant_id, sitting_id)`; fillfactor 70 and no index on changing columns, so updates stay HOT.

**Sent orders** (`sent_orders`, `so_`).
- Columns:
  - sitting, table, bar, service day;
  - `kind`: on the bill or pay first;
  - `reference`: the short code a waiter reads, such as K7Q;
  - `state`: Waiting, Sending, Checking, Awaiting approval, Added, Not sent, Unconfirmed;
  - `reason`: a code from a fixed list;
  - `lines` jsonb, each line `{id: ol_…, itemId, optionIds, qty, unitPriceMinor, name}`. The `ol_` id carries over from the order, the name is as the guest saw it, and there is no note;
  - `total_minor`;
  - `bill_before_minor`, for the alert's "Bill before this order: €46.00";
  - `pos_bill_ref` and `matched_lines`: *backend*;
  - `action_id`, `duplicate_of`;
  - `sent_at`, `settled_at`;
  - `retain_until`.
- Money is integer minor units through `money`.
- The sent order's id is the server-generated key Restro sends to the POS where the POS deduplicates (rule 9).
- Indexes:
  - unique `(tenant_id, action_id)`, used by idempotency;
  - unique `(venue_id, service_date, reference)`;
  - `(table_id, created_at desc)`, for the 15-minute duplicate warning;
  - partial `(venue_id, service_date)` where the state is Unconfirmed, Waiting, Sending or Checking, for Tonight;
  - `(retain_until)`.

**Order notes** (`sent_order_notes`). One row per noted line: `sent_order_id`, `line_id`, `note`, `service_date`. The notes are kept apart from the sent order so that the 31-day erasure of fix 30 is a row delete by `restro_purge` and not a column update (§4). Alerts, Telegram and the Log never read this table. Primary key `(tenant_id, sent_order_id, line_id)`; index `(service_date)`.

**Locks** (`locks`). One row per thing that can be held, reused all night and never deleted.
- Columns:
  - `scope`, from a fixed list:
    - order slot, per table (D115's one sent order in flight);
    - order payment, per sitting;
    - bill payment, per table;
    - payment table, per payment table (D122 §8: one payment per payment table at a time);
  - `key`: our id of what is held;
  - `holder`: a `so_` or `py_` id, or null;
  - `fence`, a bigint that rises on every take;
  - `taken_at`, `deadline`, `released_at`.
- Key `(tenant_id, scope, key)`. Deadlines are compared with the database's `now()` and never with a phone's clock (D117).
- A bar's queue is not a lock. It is the order in which waiting payments of that bar take their payment tables' locks.

**Readings** (`bill_readings`). One row per table, overwritten by each reading and emptied when the sitting ends. It is "kept for minutes, never as a record" (GLOSSARY).
- Payment tables have a row too, for `readIsolated`.
- Columns:
  - `seq`, `read_at`;
  - `complete`, since a partial reading is a failed reading (D122 §6);
  - `bill_state`: none, open, closed or empty;
  - `lines` jsonb, each line `{itemId: nd_|null, name, qty, unitPriceMinor, totalMinor, discount, fromRestro, posLineRef}`. `posLineRef` is *backend*;
  - `total_minor`, `paid_minor`.
- It keeps no waiter or POS-user identity, only whether Restro entered the line.
- Key `(tenant_id, table_id)`.

**Payments** (`payments`, `py_`). The record that holds the dispute evidence of D122 §8 and the refunds of #54.
- Columns:
  - kind: pay first or bill;
  - the real table, the payment table, the bar, sitting, service day;
  - `confirmed_lines`: the lines and prices the guest confirmed, from a fresh reading. Each line keeps its *backend* POS reference;
  - `amount_minor`, `tip_minor`, `refunded_minor`;
  - `state`;
  - `provider_account_id` (the venue's payment account), `provider_payment_id`, `auth_code`;
  - `three_ds`: passed, attempted, failed or not asked;
  - `receipt_number`, `fiscal_memory_number`;
  - `dispute_state` (none, open, closed), `dispute_opened_at`, `dispute_closed_at`;
  - `action_id`, `lock_fence`, `retain_until`.
- Indexes:
  - unique `(tenant_id, action_id)`;
  - unique `(provider_account_id, provider_payment_id)`;
  - `(venue_id, service_date)`;
  - `(venue_id, amount_minor, created_at)`, so a venue can find a payment by date and amount (#54 2.4);
  - `(retain_until)`.
- Never stored: the receipt email. It goes in the job that hands it to the POS and is never put in a Restro table (law file §3).

**Payment steps** (`payment_steps`). Append-only and written before the next step runs (D122 §8). This is the "money events" table of the Log design's open question 3.
- Columns:
  - `seq`, `payment_id`;
  - `step`: confirmed, authorised, declined, isolated, read back, check failed, closed, captured, released, lines returned, unconfirmed, alert answered, refund, storno done, dispute opened, dispute closed;
  - `attempt`;
  - `details` jsonb, checked with Zod;
  - provenance.
- Indexes: unique `(payment_id, step, attempt)`, used by idempotency; `(payment_id, seq)`.

**The provider's notices** (`payment_notices`). Each is stored once, by its id. Columns: provider account, notice id, kind, `received_at`, `processed_at`, and the payment once it is matched. The payload is checked and reduced to the fields Restro uses, so card data never reaches it. Unique `(provider_account_id, notice_id)`. Unsigned notices are only counted, in the logs.

**The Log** (`log_entries`). As the Log design §2 proposed:
- `seq`, `at`, `service_date`;
- `kind`: order states, read-back, pauses, the owner's switch, alerts, tripped guards, waiter calls, sittings, settings changes;
- `sent_order_id`, `payment_id`, `table_id`, `sitting_id`;
- `from_state`, `to_state`, `reason`;
- `via`: guest page, Tonight, Telegram, worker or provider;
- `details`, checked with Zod;
- `retention`: `night` (31 days) or `record` (18 months, for guard and permission changes, D122 §7);
- provenance.

Payment steps are not written twice: the Log screen reads `payment_steps` beside `log_entries`. Indexes: `(venue_id, at desc)`, `(sent_order_id, seq)`, `(venue_id, table_id, at desc)`, `(retention, service_date)`. A tripped guard writes one entry per table, guard and minute, with a count (Log design 6.4).

**Waiter calls** (`waiter_calls`, `wc_`): table, sitting, service day, `called_at`, `state` (open, done, lapsed), `done_at`, `done_by`, `via`. No text from the guest, no identity. A partial unique index on `(tenant_id, table_id)` where open, so a second tap returns the open call.

**Alerts** (`alerts`, `al_`) and **pauses** (`pauses`, `pa_`), named because the Log, Tonight and the evidence point at them.
- An alert: kind, subject, `raised_at`, `next_repeat_at`, `done_at`, `done_by`, `via`, the permission needed to answer it, the Telegram message reference (*backend*). Money-alert answers are also copied into `payment_steps`.
- A pause: scope (connection, venue, bar, table) and target, cause, whether Restro started it, `started_at`, `lifted_at` and by whom, the breaker's probe count and next probe, moved by D122 §6's pure function with an injected clock.

**The location pass.** Nothing is stored (D121 3.5, GLOSSARY). The pass is an HMAC over the venue, the table code's generation, the sitting and the expiry, with a key in the environment. It is checked against the open sitting and against `tables.code_generation`, a new column. The per-phone rate counters of D122 §4 stay in the web process's memory with a time-to-live of minutes and are never written to the database.

**Supporting tables.**
- `bars` (`br_`): a name, the connector's *backend* key, read from the POS and never edited. `tables` gains `bar_id`, `is_payment_table` and `code_generation`.
- `service_days`: one row per venue and service day, written at its end. It holds the totals and the count of mismatches, and keeps D111's "then only as totals" after orders are erased.
- The roles tables are in §5.

## 2. The write path

### 2.1 One entry point beside `apply()`

`packages/core/src/service/`, exported as `@restro/core/service`:
- `applyService(pool, command, context) → { result, state }`: the only function that writes service tables.
  - `command` is one Zod-checked discriminated union. Guest commands: order add, change, remove, undo, restore; send; pay start; pay later; call a waiter. Staff commands: open, close, Open all, Close all, new guests, resume, pause, lift, alert done, storno done, mark disputed, settings and roles. Worker commands: record a reading, sent-order transition, payment step, pause transition, end of sitting, record a notice, sweep, close the service day.
  - Each command declares its allowed origins (guest, staff, worker) and the permission it needs.
  - `context` carries the clock, the pass key and the actor as the caller resolved it.
  - The result is D72's accepted or refused with a code, and never a local success.
- `readTableState` and `readTonight`: read-only, on `withTenant`.

Behind this small interface (internal seams, each tested on its own): the table-code lookup, `lockLiveVenue`, the row locks and the lock module, the pure state machines (sent order, payment saga, breaker, sitting end), the permission check, the Log appender, the pass check and the idempotency replay. The deletion test: without the module, every route handler, server action and worker job would re-derive locking, expiry, logging and permissions.

**Why it is separate from `apply()`.**
- **The lock is wrong.** `apply()` serialises a tenant's whole document behind `lockTenantDocument`, and a full pull may hold it for seconds. Service writes run up to about 10 a second per venue and need a lock per table.
- **The model is different.** `apply()` handles layers, scopes, value hashes and rule 5. Service data is state machines with deadlines.
- **The records are different.** `events` needs a node on every row and is kept two months (D96). The Log has no node and is kept 31 days.

### 2.2 Provenance on service data (rule 2)

- `source`: one of `guest`, `staff`, `worker`, `provider`, `restro` (the Restro team), `pos` (a fact seen in a reading).
- `actor`:
  - `system`;
  - `user:us_…`, a signed-in account;
  - `staff:sm_…`, a person identified by PIN;
  - `integration:in_…`;
  - `guest`, with nothing after it.
- `job_id`: the worker's job run, or a request id the server generates for each web request (also written to the pino logs). The phone's action id is kept in `action_id` for idempotency and never stands in for the job.
- `via` says whether a staff answer came from Tonight or Telegram (D122 §7).

**may change D122 §9:** "the same provenance columns" should read "source, actor and job, NOT NULL", without `layer`. A layer means a slot in the menu's layer stack, and service data has no layer stack. A constant `layer = 'service'` would satisfy the wording and carry no meaning.

### 2.3 Taking a lock is the only conditional update

A take is one statement that either wins or returns nothing:

```sql
insert into restro.locks as l (tenant_id, venue_id, scope, key, holder, fence, deadline, …)
values (…, 'order_slot', 'tb_…', 'so_…', 1, now() + interval '90 seconds', …)
on conflict (tenant_id, scope, key) do update
  set holder = excluded.holder, fence = l.fence + 1, taken_at = now(), deadline = excluded.deadline
  where l.holder is null or l.deadline < now()
returning fence;
```

Every other write runs D117's short pattern:
1. Take the row with `SELECT … FOR UPDATE`. The order row comes first, then a sent order or payment row, then the lock row, so two writers can never deadlock.
2. Decide in memory, as `apply()` does.
3. Write without a condition.

This covers release and renewal: under the row lock, the holder compares its id and fence and then clears the lock. Nothing inside such a transaction calls the POS or the provider. `lock_timeout` is 2 s.

An expired lease is taken over by the next take. The sweeper moves its old holder on: an expired order slot becomes Checking, never Waiting (D115). An expired payment returns its lines.

### 2.4 Idempotency

- **Edits to the order:** the ring of 64 action ids on the order row. A repeat gets the first answer.
- **Send and Pay:** unique `(tenant_id, action_id)` on `sent_orders` and `payments`, so a repeat gets the stored result all service day (D121 2.4). A deliberate re-send after the duplicate warning is a new action that names `confirmDuplicateOf`.
- **Worker steps:** unique `(payment_id, step, attempt)`. A sent order's transition is decided under its row lock from its current state, so a repeated job changes nothing.
- **The provider's notices:** unique by their id.
- **Staff actions** are idempotent by nature. "Resume" on a running table, "Done" on a done alert and "Open" on an open table each return the current state and who did it. No action table is needed.

### 2.5 Who calls it

- **The web app's two endpoints (D121).** `POST /api/guest/actions` resolves the table code through the pinned lookup (D121 5.3), checks Turnstile at Send (network, so it stays in the handler) and calls `applyService` as `guest`; `GET /api/guest/state` calls `readTableState`. Neither calls a POS (D121 5.5).
- **Tonight's server actions** call it as `staff`, with the actor from the session or the PIN (§5).
- **The worker** calls it as `worker`: POS writes and readings, the payment saga, probes, sweeps, notices, the end of the service day. Telegram's "Done" arrives by long polling in the worker, so no new public webhook. The provider's notices need one web endpoint that only verifies and stores (built only when the tracker says so).

### 2.6 Import boundaries

Only `core` imports the write side of `db`, as today.
- Widen `db-write-only-from-core-apply` to `^packages/core/src/(apply|service)/`. Name it `db-write-only-from-core-write-paths`.
- New rule: `@restro/core/service` may be imported only by `apps/web/app/api/guest/`, the admin's server actions in `apps/web/src/server/` and `apps/worker`. Add it to the list of things `packages/shell`, `packages/faces/*` and the guest pages may never import.
- New test, the **write-target guard**, in `packages/core`, pinning which tables each folder writes: `core/apply` the menu, venue and settings tables, never a service table; `core/service` the service tables and, of the menu side, only `tables.code_generation`; one crossing, `service/log.appendLogEntry(tx, …)`, for a menu-side writer whose change the Log must show. Like the vendor-word baseline, it only tightens (D67).
- Rejected: a second door, `@restro/db/service-write`, with a transaction type narrowed to service tables. Narrowing Drizzle's generics is brittle, and a code re-issue needs both kinds of table in one transaction.

## 3. Row-level security

Every service table is tenancy `tenant`, with FORCE RLS on `app.tenant_id` (one `enable_tenant_rls` line per table). Both roles are held to it, there is no owner role and no `BYPASSRLS` in app code, and the Data API stays off. App privileges, the fewest that work:

| Table | App role | Purge role |
|---|---|---|
| `sittings`, `table_orders`, `sent_orders`, `locks`, `bill_readings`, `payments`, `payment_notices`, `waiter_calls`, `alerts`, `pauses`, `bars`, `service_days`, roles tables | SELECT, INSERT, UPDATE | SELECT, DELETE |
| `log_entries`, `payment_steps`, `sent_order_notes` | SELECT, INSERT (append-only) | SELECT, DELETE |

- `APP_DELETE_TABLES` is unchanged.
- Updates to `payments` are limited to the state, reference, dispute and refund columns by a trigger that refuses changes to `confirmed_lines`, `amount_minor` and `provider_payment_id`. This follows the pattern of the `snapshots` trigger.

**The anonymous guest.** The table code becomes a tenant through the one pinned security-definer lookup of D121 5.3. With D122 §9 the lookup takes the code's hash. After that, every request runs in `withTenant` or a tenant-scoped write as usual.

**The provider's notices** arrive without a tenant. Recommendation: put our `py_` and `tn_` ids in the reference or metadata the provider echoes back, then verify the signature and act inside that tenant. Whether myPOS echoes metadata is unknown. If it doesn't, a second pinned lookup is needed, which is a guardrail change for Martin (D67).

**The Restro team** reads one tenant at a time by setting the tenant scope after an operator check in the app. It never bypasses RLS.

## 4. Retention

| What | Kept | Erased |
|---|---|---|
| Log entries `night` | 31 days by service day (D120) | daily purge |
| Log entries `record`: guard and permission changes | 18 months (D122 §7) | daily purge |
| Order notes (`sent_order_notes`) | 31 days (fix 30) | daily purge, row delete |
| `table_orders` | emptied when the sitting ends; the row 31 days | the service path empties it; the purge deletes the row |
| `sent_orders`, `sittings` | 18 months from the service day (D111), and as long as a payment that pays them | daily purge by `retain_until` |
| `payments`, `payment_steps`, matched `payment_notices` | 18 months from the service day; while a dispute is open; 6 months after it closes (D122 §8) | daily purge by `retain_until` and `dispute_state <> 'open'` |
| Unmatched notices, `waiter_calls`, `alerts`, `pauses` | 31 days | daily purge |
| `bill_readings`, `locks` | overwritten in place; no history | with the table or the venue |
| `service_days` (totals) | until the venue is purged | venue purge |
| Staff members who left | 18 months after archiving, while `record` entries name them; the PIN hash is cleared on archiving | daily purge |

The service path sets `retain_until` at the end of the service day, moves it when a dispute opens and sets it to the close plus 6 months when it closes; the purge only compares the column, so a purge bug can never cut evidence short.

**Who erases.** The worker's daily purge (04:30 Europe/Sofia) gains a service-retention step, per tenant through `withTenantPurge` on `restro_purge`. It deletes in dependency order (notes, steps and notices, payments, sent orders, sittings) and writes one content-free `purge_log` row of a new kind, `service`, with counts. The venue purge (D83) erases every service row of the venue. The app deletes nothing, and `restro_purge` keeps no UPDATE anywhere, which is why notes are rows of their own rather than a column purge. Adding these tables to the purge role is a guardrail change: D120 5.4 approved the Log only (question M5).

**The export offered before erasure** (law file §3). Settings › Service records offers a CSV of the sent orders, payments with their evidence and the Log, for any range still held; the bin and "Delete permanently" offer the same; the end-of-night CSV (#54 3.1) already gives a file per night. Restro keeps no archive of its own, which would outlive the erasure. If Н-18 чл. 52к, ал. 3 obliges the venue to keep these records (lawyer's question 10), the export puts that duty with the venue, and the DPA says so.

## 5. Staff roles

**Who is who.**
- A **staff member** (`staff_members`, `sm_`) is a person of the organisation: display name, an optional Better Auth user (own sign-in), `pin_hmac`, `pin_set_at`, the Telegram user link, `archived_at`. Bartenders need no email or account.
- A **role** (`venue_roles`, `rl_`) belongs to one venue. Columns: name, the permission list, and `default_kind` (staff, manager, owner, or null for a venue's own role).
- **Assignment** (`staff_assignments`): one role per staff member per venue.

**Beside Better Auth's organisation roles.** `auth_member.role` stays as it is: owner, admin, member.
- An organisation's owner or admin holds every venue permission at every venue implicitly. It is never stored, so nobody can lock the organisation out.
- A `member` gets service permissions only through an assignment.
- The menu-side checks in `apps/web/src/server/roles.ts` stay. Sold out moves from organisation roles to the venue permission `sold_out` when Tonight is built.
- Better Auth's own dynamic roles were set aside because they are organisation-wide, not per venue.

**Beside D99's DJ role.** The DJ stays an organisation role run by its own owner (D100). Venue roles hold no permission for song requests, and the DJ holds no service permission, so the two never meet. **may change D100 (later, its owner's call):** the DJ could become a venue role with one permission for song requests, so one role model serves both.

**The permission list** (fixed in code; Zod-checked keys; defaults per D122 §7 and #54 3.4):

| Permission | What it allows | Staff | Manager | Owner |
|---|---|---|---|---|
| `tables.open_close` | open, close, Open all, Close all, New guests | ✓ | ✓ | ✓ |
| `tables.resume` | resume a paused table | ✓ | ✓ | ✓ |
| `ordering.pause` | Pause ordering, all bars or one | ✓ | ✓ | ✓ |
| `ordering.lift` | lift a staff pause | | ✓ | ✓ |
| `alerts.answer` | Done on live alerts and waiter calls, money alerts included | ✓ | ✓ | ✓ |
| `sold_out` | mark and unmark sold out | | ✓ | ✓ |
| `log.view` | the Log | | ✓ | ✓ |
| `night.view` | end-of-night sections 1–3, without tips | ✓ | ✓ | ✓ |
| `night.view_full` | the whole page, tips and CSV | | ✓ | ✓ |
| `money.follow_up` | Storno done, Mark as disputed, Dispute evidence | | ✓ | ✓ |
| `settings.guards` | guards, limits, service hours, pre-opening check | | | ✓ |
| `settings.codes` | re-issue table codes | | | ✓ |
| `settings.payment_tables` | mark payment tables | | | ✓ |
| `settings.alerts` | alert recipients, Telegram group | | | ✓ |
| `settings.roles` | roles, staff, PINs, shared devices | | | ✓ |

- The default roles are read-only. A venue copies one to make its own (question M2).
- Every change to a role, an assignment or a `settings.*` value is a `record` Log entry, kept 18 months.

**The PIN on a shared device.**
- An owner marks a signed-in browser as a **shared device** of one venue (`shared_devices`, `dv_`: name, venue, the session it belongs to). Which account signs it in is the venue's choice (D122 §7).
- On a shared device every staff write asks for a 4-digit PIN. The server finds the staff member by `HMAC(pepper, tenant ‖ pin)`, which is unique per organisation, with the pepper kept in the environment.
- That person's own role decides the action, never the signed-in account's role. The Log names the person.
- A PIN unlocks Tonight's permissions only. `settings.*` always needs a person's own sign-in, with the password asked again after 15 minutes (D122 §7). So a guessed PIN never reaches settings.
- After 5 wrong PINs in 5 minutes the device waits, with growing pauses, and a `guard.tripped` entry is written.
- PINs are generated by Restro, which avoids the leak of "that PIN is taken" (question M3).

**Where permissions are checked.** On the server only, inside `applyService`. In the same transaction the service path loads the actor's assignment, or the organisation role, and compares it with the command's declared permission. `readTonight` filters what it returns in the same way. The interface only hides what the server would refuse anyway.

## 6. Decision table

| # | Proposed decision | Why | Who decides |
|---|---|---|---|
| 1 | The service path is `applyService(command)` in `core/service`, beside `apply()` | different lock, model and records (§2.1) | lead |
| 2 | Provenance is `source`, `actor`, `job_id` NOT NULL, plus `via`; no `layer` (may change D122 §9) | a layer has no meaning outside the menu | lead, then Martin for the D-change |
| 3 | One `locks` table; a take is the one conditional statement; other writes lock the row and decide in memory | D122 §9 taken literally; one place for deadlines | lead |
| 4 | Idempotency: a ring on the order, unique action ids, unique step attempts, notices by id, staff actions idempotent by nature | D121 2.4; no table that grows | lead |
| 5 | One order row per sitting, emptied at the end | GLOSSARY "one per table and sitting" | lead |
| 6 | Notes in their own rows, deleted at 31 days | the purge role keeps no UPDATE | lead |
| 7 | Payment steps are the money events; the Log reads them and they are not written twice | Log design Q3 | lead |
| 8 | Log `retention` class: `night` 31 days, `record` 18 months | D122 §7 and §8 in one table | lead |
| 9 | `retain_until` set by the service path; the purge only compares | evidence is never cut short by purge logic | lead |
| 10 | Widen the write rule to `core/apply` and `core/service`, plus a write-target guard test | one db door, enforced split | lead |
| 11 | The provider's notices carry our ids back; otherwise a pinned lookup | no new RLS exception if avoidable | lead; Martin if a lookup is needed |
| 12 | Rate counters in web memory, never stored | D122 §4 "minutes only" | lead |
| 13 | Telegram by long polling in the worker | no new public endpoint | lead |
| 14 | Organisation owners and admins hold every venue permission implicitly | no lockout; today's admin behaviour | lead |
| 15 | A PIN unlocks Tonight only; settings need one's own sign-in | a 4-digit secret is weak | lead |
| 16 | Permissions are checked only inside `applyService` and `readTonight` | server-only (brief) | lead |
| M1 | **The default role names.** Recommend Staff, Manager, Owner, where a venue's Owner is also what every organisation owner and admin holds. The alternative is "Venue owner", to avoid confusion with the organisation's owner | names are Martin's | Martin |
| M2 | **Can a venue change the defaults?** Recommend no: it copies one into its own role | defaults stay safe and gain new permissions as features ship | Martin |
| M3 | **The PIN: generated or chosen?** Recommend generated by Restro, unique in the organisation, with "New PIN" for the person or an owner | a chosen PIN that is refused as taken reveals someone else's | Martin |
| M4 | **Staff with a PIN only, no account?** Recommend yes | bartenders without email still appear by name in the Log | Martin |
| M5 | **Give `restro_purge` DELETE on the new service tables?** Recommend yes; D120 5.4 covered the Log only | a guardrail change (D83, D67) | Martin |
| M6 | **Sold out for Staff by default?** Recommend no, Manager and Owner, as D122 §7's list doesn't give it to staff | a default role's contents | Martin |

## 7. Schema changes and migrations (in words)

1. New id kinds in `core/ids.ts`: `st`, `to`, `ol`, `so`, `py`, `wc`, `al`, `pa`, `br`, `rl`, `sm`, `dv`.
2. One migration per group of tables, in order:
   - bars, and the new columns on `tables`;
   - sittings, orders, locks, readings;
   - sent orders and notes;
   - payments, steps, notices;
   - the Log, waiter calls, alerts, pauses, service days;
   - staff members, roles, assignments, shared devices.

   Each gets its `_rls` migration and its entry in `table-access.ts`. `pnpm db:roles` grants as in §3.
3. The `purge_log` kind check gains `service`.
4. The `payments` trigger that refuses changes to the confirmed amounts and lines.
5. The pinned lookup of a table code by its hash (D121 5.3, D122 §9), with its grant in `scripts/roles.ts`.
6. The dependency-cruiser changes and the write-target guard test of §2.6.
7. New secrets in `.env.example` only: the pass HMAC key and the PIN pepper.
8. Worker jobs: the service retention step of the purge, the end of the service day, the sweeper, Telegram polling.

Nothing runs against staging or production without Martin's OK.

## 8. Risks and open points

- **The table code stored as a hash (D122 §9)** conflicts with what exists today. `tables.qr_token` is plain, names the published file `t/<token>.json`, and is what the admin prints on stickers. **May change D122 §9:** keep a sealed copy (D55's pattern) beside the hash so stickers can be printed again, and name the file by the code's SHA-256. Recommend a ticket of its own, outside #55.
- **The Restro team's access** (D120 2.7 lifts any pause; fix 28's raw POS log) needs an operator identity the code lacks. Recommend a small ticket; until then, a member account per tenant.
- **The raw POS call log** (`pos_calls`, fix 28): append-only, 31 days, Restro team only. Recommend designing it in the connector work with the privileges of §3.
- **Vendor words.** A provider name in a schema check would break the vendor-word guard's intent. Recommend the provider kind on a `payment_accounts` row of the integration layer, never in `payments`.
- **Rate counters assume one web instance.** With two, limits are at most twice as loose. Recommend accepting it for the pilot; move them into Postgres when Railway runs more than one.
- **Н-18 чл. 52к, ал. 3** is unknown (lawyer's question 10). Recommend keeping the retention as proposed; the export carries the duty.
- **A waiter call's lapse time** is #50's. Recommend 15 minutes, as a setting, until then.
- **The breaker's state** survives worker restarts on the active `pauses` row. Recommend a test that a restart mid-backoff neither lifts nor doubles a pause.
