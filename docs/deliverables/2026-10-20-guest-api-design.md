# Guest API: technical design (#40)

Made by: the #40 session (Opus), 10-20. Reviewed by an Opus subagent (`2026-10-20-guest-api-second-opinion.md`), whose six must-fix findings are all taken. Martin decided the guest-facing points. For: whoever builds ordering from the menu (map #29). The binding text is D121; this file is the contract the build is briefed from. Nothing here is built (D79).

Inputs: D72, D102, D111, D112, D115–D120; `2026-10-19-table-bag-locking.md` ("Inputs for #40") and `2026-10-19-bag-locks-second-opinion.md`; A5 §5.1–5.2 and A5-P3, P4, P6, P7, P10; A6 G13; `2026-10-20-weak-signal-in-ordering-apps.md`.

## 0. The shape in one paragraph

The design has two endpoints on the web app, on the guest page's own origin, with no cookie:
- `GET /api/guest/state` returns one answer per table: bag, orders, payment locks, the bill's reading and the ordering state.
- `POST /api/guest/actions` takes one `GuestCommand` with an `actionId` and returns a `CommandResult` plus the fresh state.

The rest of the shape:
- **The table code** travels in a header, never in a path, query or log.
- **Tenant lookup.** The web resolves the code to tenant, venue and table through one pinned SECURITY DEFINER function. After that it works tenant-scoped under RLS and re-checks the code inside every transaction.
- **No POS calls from the web.** Readings, D111's knock and sending orders are worker jobs, and their outcome reaches the phone through the state.
- **Polling.** The phone polls, and the server's `next` sets the cadence. Push (SSE) is a later drop-in behind the same host interface.
- **One deep module** in core owns the order of the checks. The routes are thin adapters.

## 1. Endpoints

| Method and path | Credential | Request | Answer |
|---|---|---|---|
| `GET /api/guest/state?since=<version>&view=menu\|bag\|bill` | `Authorization: Table <code>` | none | `200 {unchanged: true, version, next}` or `200 TableState` |
| `POST /api/guest/actions` | same | `{command: GuestCommand, check?: {location?, pass?, human?, consentVersion?}, ageMs}` | `200 {result: CommandResult, state: TableState}`; `400` schema; `401 {code: 'code_retired'}`; `429` with `Retry-After` |

- **Same origin**, behind Cloudflare, so there is no CORS. The route reads no cookie, so there is no CSRF surface: the credential is a header that another site's page cannot set.
- **The code is in a header.** Railway's and Cloudflare's request logs carry paths, not this header. The route never logs headers or bodies. The code is already in `/t/<code>` and `?t=`; moving `?t=` to a `#t=` fragment is a later hardening outside #40.
- **Strict Zod both ways** (`.strict()`). The schemas live in `@restro/shell` (`services.ts`) and are shared by the route and the host client.
- **Bodies** are capped at 8 KB, enforced while reading the stream.
- **Answers** are `Cache-Control: no-store` and `Referrer-Policy: no-referrer` (A5-P3).
- **Forbidden-values walk.** Every answer goes through A5-P10's walk test: no POS ids, internal names, cost prices or phone ids.
- **Push later.** `GET /api/guest/stream` (SSE) would emit only `{version}`, and the client then GETs the state. Cloudflare's 100 s idle timeout needs a heartbeat. Not built now.

## 2. The table code and the tenant

1. **Shape check.** The route reads the header and checks it against `TABLE_TOKEN_PATTERN`. A bad shape is a 401 with no database call.
2. **The lookup.** `restro.guest_table_by_token(text)` returns `(tenant_id, venue_id, table_id, state)`, where state is `live`, `hidden` or `venue_not_live`.
   - It is `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, restro`.
   - The migration REVOKEs it from PUBLIC; only `restro_app` gets EXECUTE.
   - Its owner must be able to read `tables` under FORCE RLS. CI tests this with the owner's real attributes.
   - A6 G13 (Martin OK'd it, D121): `rls-guard.test.ts` gets one pinned exception. The test asserts this exact name, signature, return columns, language, volatility and search_path, that it is the only definer function in `restro`, and that `restro_app` is the only grantee.
3. **A memo, as a hint only.** Code → (tenant, venue, table) is memoised per process for 30 s (an LRU of a few thousand). The memo only picks the tenant. Every transaction re-checks the code: `withTenant`/`withTenantWrite` join on `qr_token = $code` and "not hidden", and writes also take `lockLiveVenue`. A retired or replaced code fails at once (`code_retired`), not after 30 s.
4. **The code is never stored** on a bag, order, payment or log, and never echoed.

## 3. TableState: what a phone may see

```ts
TableState = {
  version: number,          // one counter per table (table_bags.version), see §6
  next: number,             // ms to the next poll; the client bounds it to 2_000..30_000
  table: { label: string },
  ordering: {
    state: 'on' | 'paused',                     // what pauses it, and how it lifts, is D120's
    onBill: 'open' | 'not_open' | 'unknown',    // D118's open-table rule, from the reading
    locationCheck: boolean,                     // the venue checks location (D118)
    passMinutes: number,                        // the venue's location-pass time (D121)
    roundCapMinor: number | null,               // D118's cap, so the face can warn before Send
    paceLimited: boolean,                       // D118's pace limit reached
  },
  bag: {
    lines: [{ id: 'bl_…', itemId: 'nd_…', optionIds: ['nd_…'], qty, note, rev,
              mode: 'on_bill' | 'pay_first', held: 'py_…' | null }],
    removed: [{ id: 'bl_…', undoSeconds }],                   // "Removed · Undo"
    earlier: [{ id: 'eb_…', lines: [/* same, no rev */], setAsideAgoSeconds }],
  },
  orders: [{ id: 'od_…', status: 'sending' | 'awaiting_approval' | 'added' | 'not_sent' | 'unconfirmed',
             reason: RefusalCode | null, ref: string | null, endedAgoSeconds: number | null }],
  payments: [{ id: 'py_…', scope: 'bag' | 'bill', phase, secondsLeft, lineIds }],   // no holder
  bill: {
    readAgoSeconds, status: 'fresh' | 'stale' | 'unavailable',
    rounds: [{ id: 'rd_…', origin: 'guest' | 'staff', time,
               lines: [{ id: 'bn_…', name, qty, total, state: 'owed' | 'paid' | 'awaiting_approval', seen }] }],
    total, paid, owed,      // ViewMoney, the POS's own figures
  } | null,
}
```

- **Orders show only on the sending phone** (D121, Martin).
  - The state lists the table's orders that are in flight or ended in the last few minutes. It carries no phone data.
  - The host keeps the `od_` ids its own commands created (session storage, wiped at the end of the service day) and shows only those.
  - An Unconfirmed order stays on that phone until the guest closes it.
  - Other phones see the lines leave the bag and the round reach the bill.
  - Waiting, Sending and Checking all show as `sending` (D116).
- **Bill ids.** `rd_` and `bn_` are HMAC(server key, tenant + POS row id). They are stable across readings and meaningless outside Restro.
  - The worker computes them when it writes the reading. It writes two parts: the public projection the phone gets, and a private map back to POS rows used at pay time.
  - The web never sees a POS id.
- **Bill line names.** A line takes the item's name in Restro, through `source_links`, even when the item is hidden from the menu. A row Restro can't match shows "Other item". On a POS venue every item is synced, so that is a safety fallback (Martin).
- **`seen`** is a per-line content fingerprint (HMAC of name, quantity and total), used for the knock (§5).
- **No prices on bag lines.** The face estimates with the snapshot and core's money (D72). The server prices from the snapshot and the overlay at Send.
- **Never in the state:**
  - other tables;
  - who added, sent or paid anything;
  - phone or network ids;
  - waiter names;
  - POS bill numbers or ids;
  - internal names;
  - cost prices.
- **`services.ts` changes.** `BillRoundView.actionId` is dropped, since a round answers no phone.

## 4. Commands

Every command carries an `actionId`: a uuid made at the tap and reused on every retry.

| kind | fields | outcome |
|---|---|---|
| `bag.add` | itemId, optionIds, qty, note | accepted; identical lines merge |
| `bag.change` | lineId, delta (±1..±50) | accepted; going below 1 removes |
| `bag.remove` | lineId | accepted; the undo window opens |
| `bag.undo` | removeActionId | accepted, or `undo_expired` |
| `bag.restore` | earlierId | accepted; the lines rejoin, merged |
| `order.send` | lines [{lineId, rev}] (the on-the-bill lines seen), confirmDuplicateOf? (`od_`) | `pending` with `subjectId: od_…` (stored Waiting), or rejected with a code |
| `pay.quote`, `pay.start`, `pay.cancel` | unchanged now; the payment map sets the new shapes | — |
| `service.request`, `service.cancel`, `receipt.action` | unchanged | unchanged |

- `CommandResult` gains `code: RefusalCode | null` and `subjectId: string | null`. `message` stays for host-made text, and faces word the codes through shell strings.
- **Refusal codes:**
  - bag: `bag_changed` (with the fresh state), `line_held`, `undo_expired`, `bag_full`;
  - menu and ordering: `item_unavailable` {itemId}, `menu_changed`, `duplicate` {duplicateOf, minutesAgo}, `ordering_paused`, `orders_queued_full`, `table_not_open`;
  - guards: `location_needed`, `location_failed`, `round_cap` {capMinor}, `pace_limited`, `human_check`;
  - payments: `payment_busy`, `lock_expired`, `not_holder`, `bill_changed`, `below_minimum`;
  - the request itself: `rate_limited`, `code_retired`, `stale_action`, `unavailable`.
- **Idempotency.**
  - Bag edits record their actionIds in a ring of the last 64 on the bag row. A repeat answers the first result.
  - Orders have `unique (tenant_id, action_id)`. `action_id` is nulled at the end of the service day (D111: nothing tied to a phone's tap outlasts it).
  - The actionId is looked up before anything else, Turnstile's siteverify included.
- **Time limit on retries.** The host sends `ageMs`, the time since the tap. An edit older than 30 s, or a Send older than 60 s, is refused `stale_action` and the phone refreshes. This stops a phone returning from a lost signal from landing an old edit or Send.
- **Two Sends at once make one order** (D117). If the sent (lineId, rev) pairs already sit in an order in flight, the answer is `pending` with that `od_`, not `bag_changed`.

## 5. The guards on the request (D118, D119, D121) and the knock (D111)

The host adds the guards to the envelope. The face never sees coordinates, passes or Turnstile tokens: it sends `bag.add` or `order.send` and draws a consent sheet when the answer is `location_needed`.

- **Which actions are located:** at a venue with the check on, every bag command that touches an on-the-bill line, and `order.send` with on-the-bill lines. Never paying, never pay-first lines.
- **Flow.**
  1. The first such action without a pass is answered `location_needed`.
  2. The face shows the consent screen (D121's text) once per phone per service day (D119). The host remembers consent or refusal in session storage until the service day ends.
  3. On Allow, the host calls `navigator.geolocation` (10 s timeout) and re-sends with `check.location = {lat, lng, accuracyM}` and `consentVersion`.
  4. The server runs the pure circle-touch test (`core/ordering/guards.ts`), drops the position and, on success, answers with a **location pass**.
- **The location pass** is an opaque HMAC-sealed note: `{venueId, tableId, expiresAt, consentVersion}`.
  - `expiresAt` is now plus the venue's `passMinutes` (default 120, 30–360), cut at the end of the service day.
  - The phone holds it and sends it as `check.pass`. The server verifies the seal, the venue, the table and the expiry. Restro stores no copy.
  - Another table's code needs a new check.
  - Each on-the-bill order records "location check passed, consent vN" from the pass (D119).
- **Never stored.** Positions are never written, logged or sent to Sentry: when Sentry is installed, its scrubber drops `check`. Zod errors are formatted by path only. A trip is counted without the position.
- **Turnstile**, at on-the-bill Send only (D119: managed mode, pre-clearance and feedback off).
  - The host runs it at Send. The server calls siteverify outside the database transaction with `idempotency_key = actionId`, after the actionId lookup.
  - A missing or invalid token gets `human_check` (fail closed).
  - The check fails open only when the server itself sees siteverify unavailable. Each fail-open is counted, and the location check, cap and pace still apply.
- **Cap and pace** (D118) are checked at Send, from live prices (snapshot and overlay) and the table's orders of the last 15 minutes.
- **Open table.** At Send, the latest reading decides if it is under 60 s old. The worker settles it, since it reads the table's open POS bills anyway to pick the oldest (D115). If there is none, the order is Not sent `table_not_open` and the lines go back.
- **Duplicate** (D117): rejected `duplicate` with the older `od_` and its minutes. "Send again" is a new action with `confirmDuplicateOf`.
- **Knock** (D111). Bill actions carry the `bn_` ids and `seen` fingerprints of the lines they act on.
  - The web stores the intent and answers `pending`. A worker job reads the POS and compares those lines only.
  - A changed or missing line gets `bill_changed`, with the fresh bill in the state. A friend's new round doesn't refuse it.
  - The payment map builds the path that lets the payment proceed.
- **Fresh readings on demand.** Opening the bill (`view=bill`) asks for a fresh reading when the shared one is older than 15 s.
  - It is a singleton job per table, so at most one read per table is in flight.
  - A per-connection reading budget keeps it within D111's "a few times a minute".

## 6. Polling, the version and back-off

- **Cadence** (D121):
  - 2 s on the bag and bill screens, and 10 s on the menu;
  - 2 s on any screen while the table has an order in flight or a payment lock;
  - none while hidden, and one poll at once on becoming visible;
  - no idle slow-down (Martin);
  - the server's `next` overrides this, so Restro can slow every phone under load.
- **Optimistic bag edits** (Martin; `2026-10-20-weak-signal-in-ordering-apps.md`).
  - The host applies the edit to its local copy with the shared pure `applyBagCommand` and posts it.
  - On a refusal it rolls back to the server's state and the face shows the code's line.
  - Send and Pay are never optimistic (D72).
- **Errors** (a network failure, a 5xx or a 429) retry after 4, 8, 16 and then 30 s, with jitter. `Retry-After` wins.
  - After about 10 s without a good answer, D120's paused presentation takes over: "Ordering is paused right now, please order from a waiter". The last bag stays visible and the phone retries quietly.
  - Send is blocked, not queued. A command already in flight is retried with its actionId within its `ageMs` limit.
  - After a Send with no answer, D120's "We can't reach Restro right now…" shows with the reference.
- **One version per table.**
  - Every writer that changes anything in TableState goes through `withTableState(tx, tableId, fn)`. It upserts and locks the bag row first (one lock order for all writers), runs `fn` and bumps `version`. No triggers.
  - The reading, orders and payment locks bump it the same way.
  - **Changes that only time makes** (an undo window closing, a bag going idle, a lock running out) are covered by `next_change_at` on the bag row. A GET past that moment runs the due transitions and bumps the version.
- **Phones without services** never poll: no confirmed table code, or the venue has no services on.

## 7. Abuse limits

- **Cloudflare (Free).**
  - Its single rate-limiting rule covers `POST /api/guest/actions`, per IP, generously, since a club's guests share one Wi-Fi address.
  - It has a 10 s period, a 10 s block, and matches on path only (https://developers.cloudflare.com/waf/rate-limiting-rules/).
  - DDoS protection is Cloudflare's own.
- **Web.** An in-process token bucket per code for GETs.
- **Per table** (no IP kept):
  - 60 bag commands a minute (Martin), counted from the action ring. A trip gets `rate_limited` ("Slow down a moment"), a Log entry (D120) and a Restro-team alert, grouped like D118's pace trips.
  - 50 lines and quantity 50 (`SERVICE_LIMITS`), 3 Waiting orders (`orders_queued_full`), and D118's cap and pace.
- **Bad codes.** A wrong shape is a 401 before the database. A well-formed unknown code costs one indexed lookup.
- **Accepted for the pilot and counted:** someone outside with a photo of the code changing pay-first lines (D121).

## 8. Modules and seams

- **`core/guest/act.ts`**: one deep module, `readTableState(code, since, view)` and `actGuest(code, command, checks)`.
  - It owns the order of the checks: shape, actionId, age, code in the transaction, rate, guards, apply.
  - Its ports are `verifyHuman` (the Turnstile adapter, with a fake in tests), the clock and the HMAC key.
  - The routes in `apps/web/app/api/guest/*` are thin adapters: parse, call and serialise.
- **`applyBagCommand(bag, cmd, now)`**: pure, shared by `core/apply/bag.ts` (the server writer, a sibling of `tables.ts` under rule 1) and the admin preview's in-memory host. Two adapters make it a real seam.
- **Other core modules:**
  - `core/apply/orders.ts` (A5-P7);
  - `core/apply/readings.ts`, written by the worker;
  - pure `core/ordering/guards.ts` (location circle-touch, cap, pace, pass seal);
  - `core/guest/project.ts` (rows to TableState, the rule-3 projection, with the walk test).
- **The host client** `apps/web/src/guest/services-client.ts`: `createTableServices({code, fetch, storage, geo, human, clock})`.
  - It is the only `fetch` to the guest API (A5-P10's `order-client.ts`).
  - It handles polling, back-off, optimistic edits, actionIds and `ageMs`, the consent memory, the location pass, Turnstile, own-order ids and later the holder token.
  - It exposes `subscribe`. `ServiceBinding` stays `{state, dispatch}` for the face.
- **The bag flush when the bills close** is a transition: from at least one open POS bill to none, seen across two readings. It never drops held lines (D117).
- **Rule 4** still holds. The shell's input is the snapshot, the live overlay and the context. The bag, bill, orders and payments are the host's service state (D71, D72), given to the face beside the view model. `live.json`'s `ordering` block (A5-P4) is the published, cacheable switch, and the state's `ordering` is the live per-table one. The menu works with all of this down (D102).

## 9. Storage for the build (Martin OK'd it, D121)

- `table_bags`: one row per table, reused all night. It holds `version`, `next_change_at`, the action ring, lines, removed and earlier bags.
- `orders`, `order_lines`, `commands` and attempts (A5-P7). `orders` has a unique (tenant, action_id).
- `table_readings`: one row per table, updated in place. It holds the public projection and the private map. POS data is kept for minutes and cleared by the sweep (D111).
- Later, `payments`. Its lock lease keeps only the hash of the holder token, cleared when the lock ends; the payment map sets the details.
- Id kinds: `bl`, `eb`, `od`, `cm`, `py`, `rd`, `bn`.
- D118's trip counters.
- The function `guest_table_by_token`.

## 10. Not decided here

- **D120 owns** pause triggers and lifting, alerts and the Log, and the paused and "can't reach Restro" wording.
- **The payment map owns:**
  - the `pay.start` and `pay.cancel` shapes and payment phases;
  - `below_minimum` and `lock_expired`;
  - whether Turnstile runs on Pay;
  - abuse of payment locks from outside;
  - the knock's proceed path.
- **Later:** the waiter-call backend.
- **The privacy list:** how long order notes are kept.
- **The field test:** Safari may prompt for location again within a night (`docs/open-items.md`).
