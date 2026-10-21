# Locks and refreshes on the shared table bag

Made by: Opus subagent for #37, 10-19.

## For Martin

Nobody's phone ever holds a lock. Every change to the bag (adding, +1, removing, undo) takes the bag for about a hundredth of a second on our server, writes, and lets go. Two people tapping at once are simply put one after the other, and both taps count. Two actions need more than that, because they take time: **sending** and **paying**. While an order is going to the POS, the table's "turn" belongs to that order for up to about a minute and a half. A second Send still empties the bag at once, and its order waits its turn as "Sending…". While someone pays, the lines being paid are frozen: other phones see them greyed with "someone is paying for these". They come back on their own if the card is declined or the guest walks off, after at most 2 minutes before the bank's page opens and about 10 once it has. The server holds these turns, each with a deadline, so a dead phone or a crashed server never leaves the table stuck. Send and Pay carry what the guest saw. If a line they cover changed in the meantime, they are refused with "your table's bag changed" and the phone shows the fresh bag. Every other phone at the table sees a change within 2–3 seconds. **DB cost:** a club of 50 tables needs 50 database rows, one per table, reused all night (about 200 KB), and about 6,000–12,000 tiny writes a night. That is far below 1% of Supabase's smallest instance. Keeping old bags aside until the table's bills close lives in the same row, so it adds nothing.

## Proposal

Three mechanisms, each used only where it fits:
- **A row lock** (`SELECT … FOR UPDATE` on the table's bag row) for every change, held for one database transaction only: about 5–20 ms, with `lock_timeout` 2 s. Nothing in that transaction calls the POS or the payment provider.
- **Optimistic checks**, only where the meaning depends on what the guest saw (Send and Pay). Each bag line has its own `rev`, and the bag has a `version` that only ever goes up.
- **Leases ("turns")** held by a server-side record, never by a phone, for the two slow actions already decided: one order in flight per table (D115) and one payment at a time (D112).

Edits are commands, not "set to N" (the shared-bag opinion's G5), so they need no version: a +1 on the current bag is always meaningful.

| Action | What it takes | How long | Checked against | What a loser sees |
|---|---|---|---|---|
| **Add** item | bag row lock | ~10 ms | line limit (50), live menu | nothing: it waits milliseconds, and both adds land. An identical item (same options and note) merges into one line |
| **+1 / −1** | bag row lock | ~10 ms | the line exists and is not held by a payment; quantity 1–50 | on a held line: "someone is paying for these". −1 at 1 = Remove |
| **Remove** line | bag row lock | ~10 ms | the line is not held | the line is marked removed (not deleted) for an undo window of 5 s, plus 5 s of grace on the server |
| **Undo** | bag row lock | ~10 ms | carries the Remove's `actionId`; inside the window | after the window: "too late to undo". After a Send the line simply returns to the new bag (it was never sent) |
| **Send** | bag row lock, then a new `orders` row in the same transaction | ~20 ms; then the **order slot**, from the first POS call to Added / Not sent / Unconfirmed: ≤30 s call + ≤60 s check | the `(lineId, rev)` of exactly the on-the-bill lines it sends, plus the live menu (R8) and the duplicate rule | lines changed: refused "your table's bag changed", fresh bag in the answer. Slot busy: **not** refused. The order is stored as Waiting and the phone shows "Sending…" |
| **Pay** (pay-first lines) | bag row lock; the ticked lines get `heldBy = py_…`; the **bag payment slot** | ~20 ms; then the slot: 2 min until the provider's checkout opens, then until settled or the venue's abandon time (~10 min) | the `(lineId, rev)` of the ticked lines, live prices, not already held | lines changed: "your table's bag changed". Slot busy: Pay disabled, "someone is paying (8 min left)" |
| Pay settles / declines / abandons | bag row lock (worker) | ~10 ms | the payment's state | yes: the held lines leave the bag for good. Decline or abandon: `heldBy` cleared, and the lines return to every phone |

- **Why Send checks only its own lines.** A pay-first line added, or being paid, a second before should not refuse a Send of the beers. That keeps Martin's "refused if the bag changed" rule, but only where the change matters.
- **The order slot is not a bag lock.** Send moves the lines out of the bag and frees the bag in the same ~20 ms. The slot lives on the order: a partial unique index, one row per table in `sending | checking`. A worker job per table takes the oldest Waiting order. An expired lease becomes Checking, never Waiting again (A5 §5.1, D115). Awaiting approval does not hold the slot unless a POS call is open.
- **Pay does not take the order slot.** That matches the pay-first opinion's P9: a pay-first POS bill is new, stamped and retry-safe.
- **Lock order.** Always the bag row first, then the order or payment row, so a worker returning lines and a phone sending can never deadlock.
- **Idempotency (D72).** A repeated `actionId` gets the first answer and is never applied twice:
  - **bag edits:** the bag row keeps a ring of its last 64 `actionId`s and the version each produced;
  - **Send and Pay:** a unique `(tenant_id, action_id)` on `orders` and `payments` answers a repeat all service day (R11).
  - Two deliberate taps on +1 are two actions, so +2. A double tap on Send is one action: the face disables the button while pending, and a retry reuses the id.
- **Duplicate warning.** It comes back as `rejected` with `duplicateOf: od_…` and the minutes since. "Send again" is a new action with `confirmDuplicateOf` set, because reusing the first `actionId` would only replay the refusal.

## Refresh

Martin's "refresh after a lock is released" is the version bump.
- **The acting phone** gets the new bag in its own answer: instant.
- **Every other phone** polls one table-state call: `GET /api/guest/table/<token>/state?since=<v>`. It returns "unchanged" (a few bytes) or the bag, the table's orders still in flight, the active payment marker, and the reading's sequence and time (D111). Never a POS call.
- **How often:** every 2 s on the bag and bill screens, 10 s on the menu, and none while the tab is hidden. It also refreshes at once when the tab comes back.

**Load (50 tables, 8 phones a table):**

| Case | Phones with the page open | Calls | Database read per call | Per night (6 h) |
|---|---|---|---|---|
| Realistic | ~100 | about 35 a second | the bag's version and the table's state versions: one indexed row, about 0.3 KB | about 750,000 calls; about 230 MB of Supabase egress (3 GB a month at 12 nights) |
| Worst case | all 400, every 2 s | 200 a second | the same | at about 2 ms of server time a call, about 0.4 vCPU while it lasts (about $2 a month on Railway) |

Neither case calls the POS.

**Push upgrade (for #40).** Put the same versions on Postgres `LISTEN/NOTIFY` and send them over Server-Sent Events. Changes then arrive in under a second, and the database reads for polling drop to zero. It needs:
- one direct (session-mode) Postgres connection per web replica, since Supabase's transaction pooler cannot LISTEN;
- a heartbeat under Cloudflare's 100 s proxy idle timeout;
- a fallback to polling in weak basement signal.

Recommendation: ship polling first, with a contract whose only event is "table state version changed", so push can replace it later without changing a face.

## Where it lives

- **Not a `core.apply` change set.** The bag writes no `field_values`, `events`, documents or snapshots, so rule 1 is untouched. It is a sibling writer in `packages/core/src/apply/bag.ts`, the same kind of door as `tables.ts` and A5's `orders.ts`, so only `core/apply` imports `@restro/db/write`. Send calls the order insert from `orders.ts` (and Pay calls the one from `payments.ts`, later) inside the bag's transaction, so lines move atomically.
- **The module's interface is small:**
  - `applyBagAction(pool, tableToken, action)` → `{ result: CommandResult, state: TableState }` for add, change, remove, undo, send and pay start;
  - `readTableState(pool, tableToken, since)`;
  - `sweepBags(pool, now)` for the worker.
  - Hidden behind them: token lookup, `lockLiveVenue`, the row lock, revs, the action ring, the undo window, lazy expiry on every read and write (`expires_at` against the database's `now()`, never the phone's clock), menu re-checks and the order and payment hand-off. Deletion test: without it, each route and job would re-derive the locking and expiry.
- **Table `table_bags`** (tenancy `tenant`, RLS through `enable_tenant_rls`). One row per table, created on first add with `INSERT … ON CONFLICT DO NOTHING` and **updated in place forever**. Columns:
  - `tenant_id`, `table_id` (unique, composite FK), `venue_id`, `version bigint`;
  - `lines jsonb`: `[{id: bl_…, itemId: nd_…, optionIds, qty, note, rev, heldBy, removedAt, removedBy}]`;
  - `opened_at`, `expires_at`, `parked jsonb`, `parked_at`, `recent_actions jsonb`, `service_date`.
  - App privileges are SELECT, INSERT and UPDATE only: no DELETE, so CLAUDE.md's "never delete rows" holds. The purge role gets SELECT and DELETE for D83. Leave changing columns unindexed and set fillfactor to 70, so updates stay HOT.
- **Ids.** New kinds `bl` (bag line), `od` and `py`; only our prefixed ids, never POS ids (rule 3). Lines carry no price: estimates come from the face with core's money module, and the server prices at Send and Pay.
- **Tenancy for an anonymous write.** The guest API resolves the table code through A5-P6's `restro.guest_table_by_token(text)` (security definer, the only routine granted to `restro_app`). It returns the tenant, venue, table and state, and the request then runs in `withTenantWrite(tenant)` with RLS as usual. The token is never stored on the bag or the order.
- **Rule 4 holds.** The static guest page reads the menu from the CDN and the bag only through the guest API, which is the host.
- **Shell contract (`services.ts`).** `ServiceState` gains `bag: BagView`, and `GuestCommand` gains `bag.add`, `bag.change {delta}`, `bag.remove` and `bag.undo`. `order.send` and `pay.start` carry `lines: [{lineId, rev}]` in place of today's `order.send.lines`. Faces stay pure (D72).
- **Kept, and for how long (D111).** No phone, device or IP identifier and no per-line tag. The `actionId`s are per action, not per phone. The ring is cleared with the bag, and `action_id` on orders and payments is nulled at the service day's end. Rate limits per table code and IP are applied at Cloudflare, not stored by us.

## Old bags and cost

**Lifetime.**
- **Timeout:** `expires_at` is set when the bag goes from empty to non-empty, at the venue's timeout, and restarts at each Send.
- **Parking:** on timeout, the live lines move to `parked` in the same row. The sweep flushes `parked` once the reading shows the table has no open POS bill, and at the service day's end.
- **Flushing:** sets the columns to empty and bumps the version. No row is deleted.

**Numbers, for a club with 50 tables and 8 phones a table, on Supabase Postgres:**

| What | Size |
|---|---|
| Rows | 50: one per table, the same 50 rows every night. 100 clubs = 5,000 rows |
| Bytes | up to ~4 KB a row with 10 live and 10 parked lines: about 200 KB in total |
| Bag writes a night | about 6 rounds × about 20 edits per table = 120–250, × 50 tables = 6,000–12,500, about 0.5 a second on average and ~10 a second at peak. Postgres's smallest instance takes thousands a second |
| Write-ahead log | about 6–8 KB per write ≈ 75–100 MB a night, recycled |
| Dead row versions | about 10,000 a night, cleared by autovacuum |
| Orders (not bag cost, D111) | ~300 orders and ~3,000 lines a night, kept 18 months: tens of MB |
| Supabase egress | the polling egress above (a few GB a month) |

Answer: no, keeping old bags aside is not expensive. It is two extra columns on rows that exist anyway.

## Failure cases

- **The web process crashes mid-transaction.** Postgres rolls back and the row lock dies with the connection. The phone retries with the same `actionId` and it is applied once.
- **It crashes after commit, before answering.** The retry finds the `actionId` (the ring, or the unique key on orders and payments) and returns the current state.
- **A stuck transaction.** `lock_timeout` 2 s and `statement_timeout` 5 s on bag writes. The face retries automatically once, then shows "try again". Code review rule: no outbound call inside `bag.ts`'s transaction.
- **The worker dies holding the order slot.** The lease expires (~45 s) and the order becomes Checking: read back, never resent (D115).
- **The paying phone dies.** The payment is finished by the server from the provider's notice (D112). The lease returns the lines after 2 min if the checkout never opened, otherwise after the abandon time.
- **The phone loses its network.** The bag shows its age and edits are disabled, not queued. A pending command is retried with the same `actionId` once the phone is back.
- **Two tabs on one phone.** They are separate actions. The second tab's Send finds its lines gone, is refused with "bag changed", and its refresh shows the order "Sending…". Storage is shared, so both tabs know "my payment".
- **The table gets a new code, the venue is deleted, or the menu is republished.**
  - New code: the old code stops resolving and the bag is flushed (see question 6).
  - Deleted venue: `lockLiveVenue` refuses.
  - Republished menu: Send and Pay re-check prices and availability (R8).
- **The POS is down (D102).** Send is refused with the lines kept in the bag (D72). At most 3 Waiting orders per table; beyond that: "an order from your table is still on its way".

## Open questions

1. **Bag payment and bill payment: one slot each, or one per table?** Recommend one each, as D112 reads: they touch different things, and a bottle bought during a split is realistic. Both show "someone is paying".
2. **When the timer starts.** Recommend: at the first line and again at each Send, not at every tap, so stray taps cannot keep a bag alive forever. Warn "this bag clears in 5 min".
3. **Do guests see parked lines?** Recommend yes, one line: "3 items from earlier, add back". Otherwise there is no reason to keep them.
4. **Who may cancel a payment holding lines?** Recommend: only the phone that started it (it holds the `py_` in its storage), plus the short 2-minute lease before the checkout opens.
5. **Merge identical lines?** Recommend yes: fewer lines, and there is no "who added it" to keep apart.
6. **Does a new table code flush the bag?** Recommend yes: a new code is issued because the old one leaked.
7. **Awaiting approval:** is it a Restro state before the POS, or a POS status? Recommend that the order slot is held only while a POS call is unresolved, whichever it is.
8. **Send's check scope:** exactly the sent lines (recommended) or the whole bag version.

## Inputs for #40

- Resolve the table code once per request with `guest_table_by_token`, then run tenant-scoped. Never put the token in storage or logs.
- Endpoints:
  - `GET …/table/<token>/state?since=<v>`: "unchanged" or the full table state;
  - `POST …/table/<token>/actions`: one `GuestCommand` with an `actionId`, answering `CommandResult` plus the fresh state.
- Every answer carries `bagVersion`, line `rev`s, the order states (Waiting, Sending, Checking, Added, Not sent, Unconfirmed, Awaiting approval), the active payment marker with its deadline, and the reading's sequence and time.
- Polling: 2 s on the bag and bill screens, 10 s on the menu, none when hidden. Push (SSE with LISTEN/NOTIFY) is a drop-in later; the event is only "version changed".
- Strict Zod both ways. Line ids `bl_`. No prices in commands.
- Refusal codes the face words:
  - `bag_changed` (comes with the fresh state);
  - `line_held`, `undo_expired`, `menu_changed`, `duplicate`;
  - `ordering_paused`, `orders_queued_full`.
- Rate limits per table code and IP at Cloudflare. No IP stored.
- Answer within the ~20 ms write. Never hold a request open on the POS: the order's progress comes through state.
